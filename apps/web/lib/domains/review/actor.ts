import { findActorById, getActiveActor, type Principal } from "@/lib/actors";

/**
 * How a review action learns who is acting.
 *
 * The acting principal has to be resolved against the workspace that owns the
 * revision or branch, and that workspace is only known after the domain has
 * looked it up. So the lookup stays inside the domain and the caller supplies
 * the identity source: the browser session for the review UI, the token's own
 * principal for a service token.
 *
 * Both sources resolve to the same `Principal`, carrying the same reviewer
 * roles and publish scopes, so approving through the API and approving through
 * the UI are authorized identically. A service token cannot name an actor it
 * does not belong to — the principal comes from the token row, not the request
 * body.
 */
export interface ReviewActorResolution {
  /**
   * Who the caller claims to be, known even when no grant backs it, so a
   * refusal names the principal that was refused.
   */
  principalId: string | null;
  /** The granted principal, or null when the claim carries no grant here. */
  actor: Principal | null;
}

export type ReviewActorResolver = (context: {
  workspaceId: string | null;
  tenantId: string;
}) => Promise<ReviewActorResolution>;

/** The signed-in reviewer. Throws when there is no session, as it always has. */
export const sessionReviewActor: ReviewActorResolver = async (context) => {
  const { actor } = await getActiveActor({
    workspaceId: context.workspaceId ?? undefined,
    tenantId: context.tenantId,
  });
  return { principalId: actor?.id ?? null, actor: actor ?? null };
};

/**
 * The principal a service token was issued to. Resolves to null when that
 * principal holds no permission grant in the workspace, which the callers
 * report as a denial rather than an authorization.
 */
export function tokenReviewActor(principalId: string): ReviewActorResolver {
  return async (context) => ({
    principalId,
    actor: await findActorById(principalId, {
      workspaceId: context.workspaceId ?? undefined,
      tenantId: context.tenantId,
    }),
  });
}
