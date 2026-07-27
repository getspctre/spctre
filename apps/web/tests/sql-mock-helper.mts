/**
 * Shared helper to intercept policy context validation SELECT queries in tests.
 * Resolves to the expected array of revision and branch ID pairs mapped from input parameters,
 * or returns a fallback array. Returns null if the query is not a validation SELECT.
 */
export function handleValidationSelect(joined: string, args: unknown[]): Record<string, unknown>[] | null {
  if (joined.includes("SELECT PR.ID, PR.BRANCH_ID") || joined.includes("POLICY_REVISION")) {
    const arrays = args.slice(1).filter(Array.isArray) as string[][];
    if (arrays.length >= 2) {
      const revisionIds = arrays[0];
      const branchIds = arrays[1];
      return revisionIds.map((id, index) => ({
        id,
        branch_id: branchIds[index]
      }));
    }
    return [{ id: "r-1", branch_id: "b-1" }];
  }
  return null;
}
