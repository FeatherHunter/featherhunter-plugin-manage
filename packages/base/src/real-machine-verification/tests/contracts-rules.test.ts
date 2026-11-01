import { describe, expect, it } from "vitest";

import type { BatchName, CommitSha, Sha256Hex } from "../contracts/branding";
import {
  batchBlockingReason,
  judgeEvidenceBinding,
  judgeFreshness,
  parseBatchRecord,
  type BatchRecord,
} from "../contracts/batch-rules";
import {
  candidateIdentityOf,
  describeCandidateVerdict,
  isPathInside,
  judgeCandidate,
  parseCandidateManifest,
  type CandidateFacts,
  type CandidateManifest,
} from "../contracts/candidate-rules";
import {
  compareSkillSets,
  describeComparison,
  inspectShippedSkills,
  readFrontmatterName,
} from "../contracts/skills-rules";

type Json = Record<string, unknown>;

const COMMIT = "a".repeat(40) as CommitSha;
const OTHER_COMMIT = "b".repeat(40) as CommitSha;
const SHA = "c".repeat(64) as Sha256Hex;
const SHA2 = "d".repeat(64) as Sha256Hex;
const BATCH = "20261101-a" as BatchName;
const GENERATED_AT = "2026-11-01T10:00:00+08:00";

const pkgOf = (json: Json): Json => json.package as Json;

function manifestJson(mutate?: (json: Json) => void): Json {
  const json: Json = {
    schemaVersion: 2,
    generatedAt: GENERATED_AT,
    tool: "freeze-candidate",
    version: "1.9.0",
    validity: "release",
    sourceStable: true,
    git: { commit: COMMIT, branch: "main", dirty: false },
    package: {
      tgzPath: "/work/batch/pkg/plugin.tgz",
      tgzBytes: 1234,
      tgzSha256: SHA,
      filename: "plugin.tgz",
      files: [{ path: "lib/client.js", bytes: 10, sha256: SHA }],
      fileCount: 1,
      fileDigest: SHA,
      manifestDigest: SHA2,
      buildCommit: COMMIT,
    },
  };
  mutate?.(json);
  return json;
}

function manifestOrThrow(mutate?: (json: Json) => void): CandidateManifest {
  const parsed = parseCandidateManifest(manifestJson(mutate));
  if (!parsed.ok) throw new Error(`test fixture is invalid: ${parsed.error.message}`);
  return parsed.value;
}

function candidateFacts(overrides: Partial<CandidateFacts> = {}): CandidateFacts {
  const manifest = manifestOrThrow();
  return {
    manifest,
    identity: candidateIdentityOf(manifest, "/work/batch/candidate.json", SHA2),
    manifestPath: "/work/batch/candidate.json",
    batchDir: "/work/batch",
    generatedAtMs: Date.parse(GENERATED_AT),
    batchStartedAtMs: Date.parse(GENERATED_AT) - 60_000,
    currentHead: manifest.git.commit,
    base: { ref: "main", tip: manifest.git.commit, expectedVersion: manifest.version },
    commitContainsBase: true,
    expectedVersion: manifest.version,
    tgzOnDisk: { exists: true, sha256: manifest.package.tgzSha256 },
    recomputedFileDigest: manifest.package.fileDigest,
    ...overrides,
  };
}

function problemCodes(facts: CandidateFacts): string[] {
  return judgeCandidate(facts).problems.map((problem) => problem.code);
}

/* ------------------------------------------------------------------- candidate */

describe("parseCandidateManifest", () => {
  it("accepts a well-formed manifest and normalizes fileCount to the file list", () => {
    const parsed = parseCandidateManifest(manifestJson((json) => delete pkgOf(json).fileCount));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.package.fileCount).toBe(1);
    expect(parsed.value.package.files).toHaveLength(1);
    expect(parsed.value.package.buildCommit).toBe(COMMIT);
  });

  it("rejects an unknown schema version instead of guessing", () => {
    const parsed = parseCandidateManifest(manifestJson((json) => (json.schemaVersion = 1)));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toContain("schemaVersion");
  });

  it("rejects an empty file list, because it proves nothing about the build", () => {
    const parsed = parseCandidateManifest(
      manifestJson((json) => {
        pkgOf(json).files = [];
        pkgOf(json).fileCount = 0;
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.hint).toContain("empty file list");
  });

  it("rejects a fileCount that disagrees with the file list", () => {
    const parsed = parseCandidateManifest(manifestJson((json) => (pkgOf(json).fileCount = 3)));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toContain("fileCount");
  });

  it("rejects Windows separator paths that would poison the digest", () => {
    const parsed = parseCandidateManifest(
      manifestJson((json) => (pkgOf(json).files = [{ path: "lib\\client.js", bytes: 1, sha256: SHA }])),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toContain("/-separated path");
  });

  it("rejects a filename that is not a tarball", () => {
    const parsed = parseCandidateManifest(manifestJson((json) => (pkgOf(json).filename = "plugin.zip")));
    expect(parsed.ok).toBe(false);
  });

  it("treats a missing buildCommit as unknown, not as a mismatch", () => {
    const manifest = manifestOrThrow((json) => delete pkgOf(json).buildCommit);
    expect(manifest.package.buildCommit).toBeNull();
  });
});

describe("judgeCandidate", () => {
  it("passes a candidate that matches the batch", () => {
    const verdict = judgeCandidate(candidateFacts());
    expect(verdict.ok).toBe(true);
    expect(verdict.problems).toEqual([]);
    expect(verdict.identity.version).toBe("1.9.0");
  });

  it("reports the root cause first: wrong HEAD before a stale tarball", () => {
    const codes = problemCodes(
      candidateFacts({ currentHead: OTHER_COMMIT, tgzOnDisk: { exists: true, sha256: SHA2 } }),
    );
    expect(codes[0]).toBe("head-mismatch");
    expect(codes).toContain("tgz-hash-mismatch");
  });

  it("rejects a candidate copied in from another batch directory", () => {
    expect(problemCodes(candidateFacts({ manifestPath: "/elsewhere/candidate.json" }))).toContain("not-in-batch-dir");
  });

  it("rejects a candidate frozen before the batch opened", () => {
    const codes = problemCodes(candidateFacts({ batchStartedAtMs: Date.parse(GENERATED_AT) + 1 }));
    expect(codes).toContain("older-than-batch");
  });

  it("rejects an artifact built from another commit", () => {
    const manifest = manifestOrThrow((json) => (pkgOf(json).buildCommit = OTHER_COMMIT));
    expect(problemCodes(candidateFacts({ manifest }))).toContain("build-commit-mismatch");
  });

  it("rejects an unstable source tree", () => {
    const manifest = manifestOrThrow((json) => (json.sourceStable = false));
    expect(problemCodes(candidateFacts({ manifest }))).toContain("source-unstable");
  });

  it("rejects a commit that does not contain the baseline", () => {
    expect(problemCodes(candidateFacts({ commitContainsBase: false }))).toContain("commit-not-contains-base");
  });

  it("treats an undeterminable ancestry as a problem, not a pass", () => {
    expect(problemCodes(candidateFacts({ commitContainsBase: null }))).toContain("commit-not-contains-base");
  });

  it("does not judge the baseline when the batch recorded none", () => {
    const codes = problemCodes(candidateFacts({ base: null, commitContainsBase: null, expectedVersion: null }));
    expect(codes).toEqual([]);
  });

  it("rejects a version that disagrees with the baseline", () => {
    expect(problemCodes(candidateFacts({ expectedVersion: "2.0.0" }))).toContain("version-mismatch");
  });

  it("rejects a missing tarball and a replaced tarball", () => {
    expect(problemCodes(candidateFacts({ tgzOnDisk: { exists: false, sha256: null } }))).toContain("tgz-missing");
    expect(problemCodes(candidateFacts({ tgzOnDisk: { exists: true, sha256: SHA2 } }))).toContain("tgz-hash-mismatch");
  });

  it("rejects a file list edited after freezing", () => {
    expect(problemCodes(candidateFacts({ recomputedFileDigest: SHA2 }))).toContain("file-digest-mismatch");
  });

  it("describes both the verdict and every problem", () => {
    const ok = describeCandidateVerdict(judgeCandidate(candidateFacts()));
    expect(ok).toContain("candidate ok");
    const bad = describeCandidateVerdict(judgeCandidate(candidateFacts({ currentHead: OTHER_COMMIT })));
    expect(bad).toContain("head-mismatch");
    expect(bad).toContain("freeze again");
  });
});

describe("isPathInside", () => {
  it("accepts the directory itself and anything below it", () => {
    expect(isPathInside("/work/batch", "/work/batch")).toBe(true);
    expect(isPathInside("/work/batch/x/y", "/work/batch/")).toBe(true);
  });

  it("is case-insensitive for Windows paths and normalizes separators", () => {
    expect(isPathInside("C:\\Work\\Batch\\pkg\\x.tgz", "c:/work/batch")).toBe(true);
    expect(isPathInside("C:\\Work\\Batches\\x", "C:\\Work\\Batch")).toBe(false);
  });

  it("does not treat a sibling with a common prefix as inside", () => {
    expect(isPathInside("/work/batch-2/x", "/work/batch")).toBe(false);
  });
});

/* ----------------------------------------------------------------------- batch */

function batchJson(mutate?: (json: Json) => void): Json {
  const json: Json = {
    schemaVersion: 1,
    batchName: BATCH,
    batchDir: "/work/batch",
    createdAt: "2026-11-01T10:00:00+08:00",
    updatedAt: "2026-11-01T10:00:00+08:00",
    status: "active",
    startHead: COMMIT,
    startBranch: "main",
    base: { ref: "main", tip: COMMIT, expectedVersion: "1.9.0", allowOutdated: false },
    candidate: candidateIdentityOf(manifestOrThrow(), "/work/batch/candidate.json", SHA2),
    preflightOk: true,
  };
  mutate?.(json);
  return json;
}

function recordOrThrow(mutate?: (json: Json) => void): BatchRecord {
  const parsed = parseBatchRecord(batchJson(mutate));
  if (!parsed.ok) throw new Error(`test fixture is invalid: ${parsed.error.message}`);
  return parsed.value;
}

describe("parseBatchRecord", () => {
  it("normalizes a missing base to null, so 'no baseline' is an explicit state", () => {
    const record = recordOrThrow((json) => delete json.base);
    expect(record.base).toBeNull();
  });

  it("drops a corrupt candidate identity instead of half-believing it", () => {
    const record = recordOrThrow((json) => ((json.candidate as Json).commit = "nope"));
    expect(record.candidate).toBeNull();
  });

  it("rejects an unknown schema version", () => {
    expect(parseBatchRecord(batchJson((json) => (json.schemaVersion = 99))).ok).toBe(false);
  });

  it("rejects an invalid batch name", () => {
    expect(parseBatchRecord(batchJson((json) => (json.batchName = ".."))).ok).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(parseBatchRecord(batchJson((json) => (json.status = "done"))).ok).toBe(false);
  });
});

describe("judgeFreshness", () => {
  const checkedAt = "2026-11-01T11:00:00+08:00";

  it("stays active while HEAD and the baseline are unchanged", () => {
    const verdict = judgeFreshness({ record: recordOrThrow(), currentHead: COMMIT, baseTipNow: COMMIT }, checkedAt);
    expect(verdict.status).toBe("active");
    expect(verdict.problems).toEqual([]);
    expect(verdict.endHead).toBe(COMMIT);
    expect(verdict.endCheckedAt).toBe(checkedAt);
    expect(verdict.message).toContain("active");
  });

  it("goes stale when HEAD moved", () => {
    const verdict = judgeFreshness({ record: recordOrThrow(), currentHead: OTHER_COMMIT, baseTipNow: COMMIT }, checkedAt);
    expect(verdict.status).toBe("stale");
    expect(verdict.problems.map((problem) => problem.code)).toContain("head-moved");
  });

  it("goes stale when the baseline advanced, even though HEAD stands still", () => {
    const verdict = judgeFreshness({ record: recordOrThrow(), currentHead: COMMIT, baseTipNow: OTHER_COMMIT }, checkedAt);
    expect(verdict.problems.map((problem) => problem.code)).toContain("baseline-advanced");
    expect(verdict.message).toContain("baseline main advanced");
  });

  it("goes stale when the batch recorded no baseline", () => {
    const verdict = judgeFreshness({ record: recordOrThrow((json) => delete json.base), currentHead: COMMIT, baseTipNow: null }, checkedAt);
    expect(verdict.problems.map((problem) => problem.code)).toContain("no-baseline");
  });

  it("goes stale when the baseline cannot be read, rather than assuming it did not move", () => {
    const unreadable = judgeFreshness(
      { record: recordOrThrow(), currentHead: COMMIT, baseTipNow: null, baseReadError: "unknown ref" },
      checkedAt,
    );
    expect(unreadable.problems.map((problem) => problem.code)).toContain("baseline-unreadable");
    const unresolvable = judgeFreshness({ record: recordOrThrow(), currentHead: COMMIT, baseTipNow: null }, checkedAt);
    expect(unresolvable.problems.map((problem) => problem.code)).toContain("baseline-unreadable");
  });

  it("notes explicitly that an outdated base was allowed", () => {
    const record = recordOrThrow((json) => ((json.base as Json).allowOutdated = true));
    const verdict = judgeFreshness({ record, currentHead: COMMIT, baseTipNow: OTHER_COMMIT }, checkedAt);
    expect(verdict.problems.map((problem) => problem.code)).toEqual(["outdated-base-allowed"]);
  });
});

describe("judgeEvidenceBinding", () => {
  const identity = { batchName: BATCH, commit: COMMIT, packageSha256: SHA2 };

  it("accepts evidence collected against this batch's candidate", () => {
    const result = judgeEvidenceBinding({
      record: recordOrThrow(),
      meta: { batchName: BATCH, candidate: identity },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(identity);
  });

  it("rejects evidence from another batch", () => {
    const result = judgeEvidenceBinding({
      record: recordOrThrow(),
      meta: { batchName: "20261101-b", candidate: identity },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("identity-mismatch");
  });

  it("rejects evidence with no identity at all", () => {
    const result = judgeEvidenceBinding({ record: recordOrThrow(), meta: { batchName: BATCH } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("no candidate identity");
  });

  it("rejects a different commit or a different candidate file", () => {
    const otherCommit = judgeEvidenceBinding({
      record: recordOrThrow(),
      meta: { batchName: BATCH, candidate: { ...identity, commit: OTHER_COMMIT } },
    });
    expect(otherCommit.ok).toBe(false);
    const otherManifest = judgeEvidenceBinding({
      record: recordOrThrow(),
      meta: { batchName: BATCH, candidate: { ...identity, packageSha256: SHA } },
    });
    expect(otherManifest.ok).toBe(false);
  });
});

describe("batchBlockingReason", () => {
  it("blocks a batch whose preflight failed", () => {
    expect(batchBlockingReason(recordOrThrow((json) => (json.preflightOk = false)))).toContain("preflight failed");
  });

  it("blocks a batch without a frozen candidate", () => {
    expect(batchBlockingReason(recordOrThrow((json) => delete json.candidate))).toContain("no frozen candidate");
  });

  it("returns null for a usable batch", () => {
    expect(batchBlockingReason(recordOrThrow())).toBeNull();
  });
});

/* ---------------------------------------------------------------------- skills */

function skill(name: string, source = "bundled") {
  return { name, source };
}

describe("compareSkillSets", () => {
  it("accepts the registry when it holds exactly the declared set", () => {
    const comparison = compareSkillSets(
      { names: ["grilling", "tdd", "research"], expectedCount: 3 },
      [skill("research"), skill("tdd"), skill("grilling")],
    );
    expect(comparison.ok).toBe(true);
    if (!comparison.ok) return;
    expect(comparison.value.ok).toBe(true);
    expect(describeComparison(comparison.value)).toContain("exactly the 3 declared");
  });

  it("names missing and unexpected bundled skills", () => {
    const comparison = compareSkillSets(
      { names: ["a", "b"], expectedCount: 2 },
      [skill("a"), skill("b"), skill("c")],
    );
    expect(comparison.ok).toBe(true);
    if (!comparison.ok) return;
    expect(comparison.value.missing).toEqual([]);
    expect(comparison.value.extra).toEqual(["c"]);
    expect(comparison.value.ok).toBe(false);
    expect(describeComparison(comparison.value)).toContain("unexpected c");
  });

  it("ignores extra skills from other sources, because they are not this plugin's business", () => {
    const comparison = compareSkillSets({ names: ["a"], expectedCount: 1 }, [skill("a"), skill("project-skill", "project")]);
    expect(comparison.ok).toBe(true);
    if (!comparison.ok) return;
    expect(comparison.value.extra).toEqual([]);
    expect(comparison.value.ok).toBe(true);
  });

  it("reports duplicates in the registry", () => {
    const comparison = compareSkillSets({ names: ["a"], expectedCount: 1 }, [skill("a"), skill("a")]);
    expect(comparison.ok).toBe(true);
    if (!comparison.ok) return;
    expect(comparison.value.duplicated).toEqual(["a"]);
    expect(comparison.value.ok).toBe(false);
  });

  it("rejects a declaration whose count disagrees with its names", () => {
    const comparison = compareSkillSets({ names: ["a", "b"], expectedCount: 3 }, [skill("a"), skill("b")]);
    expect(comparison.ok).toBe(false);
    if (comparison.ok) return;
    expect(comparison.error.message).toContain("expectedCount");
  });

  it("rejects a declaration that lists a name twice", () => {
    const comparison = compareSkillSets({ names: ["a", "a"], expectedCount: 2 }, [skill("a")]);
    expect(comparison.ok).toBe(false);
  });
});

describe("readFrontmatterName", () => {
  it("reads the name from a frontmatter block", () => {
    expect(readFrontmatterName("---\nname: grilling\ndescription: x\n---\nbody\n")).toBe("grilling");
  });

  it("strips matching quotes and a BOM", () => {
    expect(readFrontmatterName('\uFEFF---\nname: "grilling"\n---\n')).toBe("grilling");
    expect(readFrontmatterName("---\nname: 'tdd'\n---\n")).toBe("tdd");
  });

  it("returns null rather than guessing when the fence or the key is missing", () => {
    expect(readFrontmatterName("name: grilling\n")).toBeNull();
    expect(readFrontmatterName("---\ndescription: x\n---\n")).toBeNull();
    expect(readFrontmatterName("---\n")).toBeNull();
    expect(readFrontmatterName("---\nname:   \n---\n")).toBeNull();
  });
});

describe("inspectShippedSkills", () => {
  const frontmatter = (name: string): string => `---\nname: ${name}\ndescription: x\n---\n`;

  it("returns the declared names in sorted order", () => {
    const inspected = inspectShippedSkills([
      { dirName: "tdd", content: frontmatter("tdd") },
      { dirName: "grilling", content: frontmatter("grilling") },
    ]);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.value.names).toEqual(["grilling", "tdd"]);
    expect(inspected.value.mismatches).toEqual([]);
    expect(inspected.value.missingFrontmatter).toEqual([]);
  });

  it("catches a frontmatter name that disagrees with the directory, which the host drops silently", () => {
    const inspected = inspectShippedSkills([{ dirName: "grilling", content: frontmatter("grill") }]);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.value.names).toEqual([]);
    expect(inspected.value.mismatches).toEqual([{ dirName: "grilling", declared: "grill" }]);
  });

  it("separates missing frontmatter from mismatched frontmatter", () => {
    const inspected = inspectShippedSkills([{ dirName: "broken", content: "no frontmatter here" }]);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.value.missingFrontmatter).toEqual(["broken"]);
  });

  it("rejects an empty directory set as a prerequisite, not as a pass", () => {
    const inspected = inspectShippedSkills([]);
    expect(inspected.ok).toBe(false);
    if (inspected.ok) return;
    expect(inspected.error.code).toBe("prerequisite");
  });
});
