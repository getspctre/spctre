import { NextRequest, NextResponse } from "next/server";
import {
  provisioningCheckoutPlans,
  provisioningGrantSecret,
  provisioningSecret,
} from "@/lib/platform/config";
import { bearerSecretMatches } from "@/lib/platform/internal-auth";
import { provisionHostedTenant } from "@/lib/domains/provisioning/service";

export const dynamic = "force-dynamic";

/**
 * What the presented credential is allowed to ask for.
 *
 * `checkout` is the surface that provisions after a payment. It may create the
 * tiers it can sell and its tenants are customers.
 *
 * `grant` is an operator credential for internal accounts — employees, testers,
 * dogfooding. It may create any plan, including tiers that are never sold
 * self-serve, and its tenants are marked INTERNAL so billing never charges them.
 */
type ProvisioningCaller = { role: "checkout"; allowedPlans: string[] } | { role: "grant" };

function resolveCaller(authorization: string | null): ProvisioningCaller | null {
  // The grant credential is checked first: were the two ever configured to the
  // same value, the caller should get the narrower authority, not the wider one.
  const checkout = provisioningSecret();
  if (checkout && bearerSecretMatches(authorization, checkout)) {
    return { role: "checkout", allowedPlans: provisioningCheckoutPlans() };
  }

  const grant = provisioningGrantSecret();
  if (grant && bearerSecretMatches(authorization, grant)) {
    return { role: "grant" };
  }

  return null;
}

/**
 * Provision the tenant, workspace, owner and baseline policy for a completed
 * hosted checkout, or for an operator's internal grant.
 *
 * Server-to-server only: the caller presents a shared secret. This exists so
 * the control plane owns workspace creation rather than having another service
 * write its tables directly.
 *
 * The two credentials are not interchangeable. Previously one secret could
 * provision any plan, so a leak of the checkout surface's secret was enough to
 * mint the top tier — the endpoint authenticated the caller without ever
 * authorizing what it asked for.
 */
export async function POST(req: NextRequest) {
  if (!provisioningSecret() && !provisioningGrantSecret()) {
    return NextResponse.json({ error: "Provisioning secret not configured." }, { status: 500 });
  }

  const caller = resolveCaller(req.headers.get("authorization"));
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: {
    email?: string;
    name?: string;
    company?: string;
    plan?: string;
    lifecycleStatus?: string;
    billingCustomerId?: string;
    salesStatus?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const requestedPlan = body.plan?.trim().toUpperCase();
  if (caller.role === "checkout" && requestedPlan && !caller.allowedPlans.includes(requestedPlan)) {
    return NextResponse.json({ error: "plan_not_permitted_for_credential" }, { status: 403 });
  }

  // Only an operator grant produces an internal account. A checkout that asked
  // for one would be claiming its customer owes nothing.
  const requestedSalesStatus = body.salesStatus?.trim().toUpperCase();
  if (caller.role === "checkout" && requestedSalesStatus && requestedSalesStatus !== "CUSTOMER") {
    return NextResponse.json(
      { error: "sales_status_not_permitted_for_credential" },
      { status: 403 },
    );
  }

  const result = await provisionHostedTenant({
    email: body.email ?? "",
    displayName: body.name ?? "",
    company: body.company,
    plan: body.plan,
    lifecycleStatus: body.lifecycleStatus,
    billingCustomerId: body.billingCustomerId,
    salesStatus: caller.role === "grant" ? (body.salesStatus ?? "INTERNAL") : "CUSTOMER",
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
