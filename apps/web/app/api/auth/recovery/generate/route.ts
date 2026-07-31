import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { generateRecoveryCodes } from "@/lib/domains/auth/service";
import { isDemoTenant } from "@/lib/demo-guard";
import { swallow } from "@/lib/platform/swallow";

async function handlePostApiAuthRecoveryGenerate() {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  if (isDemoTenant(session.tenantId)) {
    return NextResponse.json(
      { error: "Recovery code generation is not available in Demo Mode." },
      { status: 403 }
    );
  }

  const codes = await generateRecoveryCodes({
    principalId: session.principalId,
    tenantId: session.tenantId,
  });

  return NextResponse.json({ codes }, { headers: { "cache-control": "no-store" } });
}

export { handlePostApiAuthRecoveryGenerate as POST };
