import { NextRequest, NextResponse } from "next/server";
import { workerInternalSecret } from "@/lib/platform/config";
import { reportUsageForCurrentPeriod } from "@/lib/domains/billing/usage-reporting";

export const dynamic = "force-dynamic";

/**
 * Report a tenant's measured usage to the billing provider.
 *
 * Internal, worker-triggered, and shaped like the archive-evidence route: the
 * scheduler lives in the worker, while the work needs the entitlement catalog
 * and the commercial slot, which live here.
 *
 * Reporting is a per-tenant request rather than a sweep so a single tenant's
 * provider failure cannot stall everyone else's billing.
 */
export async function POST(req: NextRequest) {
  const secret = workerInternalSecret();
  if (!secret) {
    return NextResponse.json({ error: "Worker secret not configured." }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let tenantId: unknown;
  try {
    ({ tenantId } = await req.json());
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  if (typeof tenantId !== "string" || !tenantId.trim()) {
    return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
  }

  const result = await reportUsageForCurrentPeriod(tenantId.trim());

  // A failed provider call is reported as 502 so the caller can retry it. The
  // submission row already records the attempt, so a retry resumes rather than
  // starting a second charge.
  if (result.status === "failed") {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json(result);
}
