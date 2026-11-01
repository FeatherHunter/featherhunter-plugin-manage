/**
 * Public entry point of the real-machine-verification capability.
 *
 * This directory is self-contained by design: nothing outside it imports it, and
 * it imports nothing from `core/` or `client/`. A plugin repository consumes it
 * through `dsh-featherhunter-plugin-base/real-machine-verification`; the same
 * import works from a test, a scenario file or `dsh-verify`.
 */
export * from "./contracts/branding";
export * from "./contracts/result";
export * from "./contracts/check";
export * from "./contracts/evidence-contract";
export * from "./contracts/identity";
export * from "./contracts/verification-profile";
export * from "./contracts/ports";
export * from "./contracts/launch-plan";
export * from "./contracts/run-state";
export * from "./contracts/candidate-rules";
export * from "./contracts/batch-rules";
export * from "./contracts/profile-rules";
export * from "./contracts/skills-rules";
export * from "./contracts/scenario";
export * from "./capability-description";
export * from "./docs";
export * from "./declaration/loader";
export * from "./evidence/store";
export * from "./orchestration/types";
export * from "./orchestration/runner";
export * from "./orchestration/run-directory";
export * from "./orchestration/report";
export * from "./orchestration/self-check";
export * from "./runtime/types";
export * from "./runtime/platform/defaults";
export * from "./runtime/dsh/asar";
export * from "./runtime/dsh/discover";
