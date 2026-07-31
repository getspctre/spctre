import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { renamePasskey } from "@/lib/domains/auth/service";
import { swallow } from "@/lib/platform/swallow";

async function handlePostApiAuthPasskeyRename(request: Request) {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let passkeyId: string;
  let name: string;
  try {
    const body = (await request.json()) as { passkeyId?: unknown; name?: unknown };
    passkeyId = typeof body.passkeyId === "string" ? body.passkeyId.trim() : "";
    name = typeof body.name === "string" ? body.name.trim() : "";
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!passkeyId) {
    return NextResponse.json({ error: "missing_passkey_id" }, { status: 400 });
  }

  const ok = await renamePasskey({
    passkeyId,
    tenantId: session.tenantId,
    principalId: session.principalId,
    name,
  });

  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export { handlePostApiAuthPasskeyRename as POST };
