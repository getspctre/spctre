// Review domain surface. The implementation is split by responsibility into
// focused modules; this file re-exports them so existing importers and module
// mocks keep a single stable entrypoint. The review *page model* is a
// presentation concern and deliberately lives with the route
// (app/review/review-page-model.ts), not here.
export type { BlastRadius, BranchRevision } from "@/lib/repositories/policy";

export { addApprovalDecision, getApprovalDetail, listPendingApprovals } from "./approvals";

export { getPublishReadiness, publishRevisionDecision } from "./publish";
export type { PublishReadiness } from "./publish";
export { sessionReviewActor, tokenReviewActor } from "./actor";
export type { ReviewActorResolution, ReviewActorResolver } from "./actor";

export {
  type DraftRevisionState,
  type CommitRevisionState,
  createDraftRuleRevisionDecision,
  commitRuleRevisionDecision,
} from "./rule-authoring";
