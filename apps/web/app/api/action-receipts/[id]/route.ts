import { makeMeta, withTraceId } from "@spctre/api-contracts";
import { verifyActionReceipt } from "@spctre/policy-schema";
import { getAuthSession } from "@/lib/auth-session";
import { getActionReceipt } from "@/lib/repositories/action-receipts";
import { getActiveScope } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const traceId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const [session, scope] = await Promise.all([
    getAuthSession().catch(() => null),
    getActiveScope().catch(() => null),
  ]);
  if (!session || !scope) {
    return withTraceId(Response.json({ error: "Authentication and workspace context are required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
  }
  const { id } = await params;
  const receipt = await getActionReceipt({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, receiptId: id }).catch(() => null);
  if (!receipt) {
    return withTraceId(Response.json({ error: "Action receipt not found.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  }
  return withTraceId(Response.json({ receipt, verification: verifyActionReceipt(receipt), meta: makeMeta(traceId) }), traceId);
}
