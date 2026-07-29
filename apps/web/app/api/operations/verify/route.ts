import { getAuthSession } from "@/lib/auth-session";
import { verifyOperationsLedger } from "@/lib/domains/operations/service";
import { getActiveScope } from "@/lib/workspace";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handleGetApiOperationsVerify(request: Request) {
  const traceId = extractTraceId(request);
  const session = await getAuthSession().catch(() => null);
  if (!session) return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);

  const ctx = await getActiveScope().catch(() => null);
  if (!ctx) return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);

  const url = new URL(request.url);
  // Verification re-hashes every entry in the Rust addon; benchmarking showed the
  // SHA-256 compute dominates (~90% of the call) while the JSON-over-N-API
  // marshalling is a minority cost, so there's nothing to win by reshaping that
  // boundary. The ceiling exists to bound peak memory, not CPU: `payload` is
  // arbitrary jsonb, and a batch is briefly held three times over (JS rows + the
  // stringified boundary + Rust's parsed Vec). 2,000 keeps a worst-case run to
  // ~65ms / <10MB even with fat payloads; this is a hand-triggered forensic
  // endpoint, so a higher ceiling buys nothing.
  const limit = Math.max(10, Math.min(2000, Number.parseInt(url.searchParams.get("limit") ?? "500", 10) || 500));

  const verification = await verifyOperationsLedger({ tenantId: ctx.tenantId, limit });

  return withTraceId(Response.json({ ...verification, meta: makeMeta(traceId) }, { status: verification.verified ? 200 : 409 }), traceId);
}

export { handleGetApiOperationsVerify as GET };
