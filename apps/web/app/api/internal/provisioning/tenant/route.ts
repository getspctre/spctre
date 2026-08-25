import { NextRequest, NextResponse } from "next/server";
import { provisioningSecret } from "@/lib/platform/config";
import { bearerSecretMatches } from "@/lib/platform/internal-auth";
import { provisionHostedTenant } from "@/lib/domains/provisioning/service";

export const dynamic = "force-dynamic";

/**
 * Provision the tenant, workspace, owner and baseline policy for a completed
 * hosted checkout.
 *
 * Server-to-server only: the checkout surface presents a shared secret. This
 * exists so the control plane owns workspace creation rather than having
 * another service write its tables directly.
 */
export async function POST(req: NextRequest) {
  const secret = provisioningSecret();
  if (!secret) {
    return NextResponse.json({ error: "Provisioning secret not configured." }, { status: 500 });
  }

  if (!bearerSecretMatches(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: {
    email?: string;
    name?: string;
    company?: string;
    plan?: string;
    lifecycleStatus?: string;
    billingCustomerId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const result = await provisionHostedTenant({
    email: body.email ?? "",
    displayName: body.name ?? "",
    company: body.company,
    plan: body.plan,
    lifecycleStatus: body.lifecycleStatus,
    billingCustomerId: body.billingCustomerId,
  });

  if ("error" in result) {
    const status =
      result.error === "invalid_request" ? 400 : result.error === "database_required" ? 503 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(
    {
      tenantId: result.tenantId,
      workspaceId: result.workspaceId,
      principalId: result.principalId,
      created: result.created,
    },
    { status: result.created ? 201 : 200 },
  );
}
