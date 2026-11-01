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
export * from "./evidence/manifest";
export * from "./evidence/paths";
export * from "./evidence/archive";
export * from "./evidence/verify";
export * from "./orchestration/types";
export * from "./orchestration/runner";
export * from "./orchestration/run-directory";
export * from "./orchestration/report";
export * from "./orchestration/self-check";
export * from "./runtime/types";
export * from "./runtime/platform/defaults";
export * from "./runtime/dsh/asar";
export * from "./runtime/dsh/discover";
export * from "./runtime/dsh/home";
export * from "./runtime/dsh/launch";
export * from "./runtime/dsh/http-session";
export * from "./runtime/dsh/credential-store";
export * from "./orchestration/context";
export * from "./orchestration/instance";
export * from "./orchestration/concurrent";
export * from "./orchestration/cleanup";
export * from "./orchestration/freeze";
export * from "./orchestration/page-check";
export * from "./orchestration/batch";
export * from "./orchestration/primitives";
export * from "./orchestration/scenario-run";
export * from "./orchestration/install-package";
export * from "./orchestration/checks/logs-readable";
export * from "./runtime/platform/binary-writer";
export * from "./runtime/dsh/isolation";
export * from "./runtime/dsh/model-configurator";
export * from "./runtime/dsh/cleanup-scan";
export * from "./runtime/dsh/git-state";
export * from "./runtime/dsh/npm-pack";
export * from "./adapters/browser/loader";
