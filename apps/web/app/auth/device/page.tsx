import { CheckCircle2, KeyRound, Monitor, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAuthSession } from "@/lib/auth-session";
import { isDemoTenant } from "@/lib/demo-guard";
import { approveDevice } from "./actions";
import { PendingSubmitButton } from "@/app/pending-submit-button";
import { loadSelfServeSignupSlot } from "@/lib/ee-adapters/self-serve-signup";
import { SelfServeSignupForm } from "@/app/self-serve-signup-form";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

export default async function DeviceAuthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("auth.device");
  const params = await searchParams;
  const prefillCode = typeof params.user_code === "string" ? params.user_code.toUpperCase() : "";
  const approved = params.approved === "1";
  const error =
    params.errorCode === "missing_code"
      ? t("errors.missing_code")
      : typeof params.error === "string"
        ? params.error
        : "";
  const workspace = typeof params.workspace === "string" ? params.workspace : "";
  const session = await getAuthSession().catch(swallow("getAuthSession", null));

  if (session && isDemoTenant(session.tenantId)) redirect("/");

  // This is where `spctre cloud login` sends an operator, so it is the first
  // page a prospect with no account ever sees. Only resolved when signed out.
  const devicePath = `/auth/device${prefillCode ? `?user_code=${encodeURIComponent(prefillCode)}` : ""}`;
  const signupAvailable = session
    ? false
    : await loadSelfServeSignupSlot()
        .then((slot) => slot.available())
        .catch(swallow("loadSelfServeSignupSlot", false));

  return (
    <section className="panel onboardingPanel">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p className="meta">{t("description")}</p>
        </div>
        {approved ? (
          <span className="pill pillAllow">
            <CheckCircle2 size={14} />
            {t("approved_badge")}
          </span>
        ) : null}
      </div>

      {error ? <p className="callout calloutBlock">{error}</p> : null}

      <div className="onboardingSteps">
        <div className="contextNode">
          <Monitor size={16} />
          <div>
            <span className="meta">{t("device_code")}</span>
            <p>{t.rich("format", { code: (chunks) => <code>{chunks}</code> })}</p>
          </div>
        </div>
        <div className="contextNode">
          <ShieldCheck size={16} />
          <div>
            <span className="meta">{t("principal")}</span>
            <p>{session ? session.displayName : t("auth_required")}</p>
          </div>
        </div>
        <div className="contextNode">
          <KeyRound size={16} />
          <div>
            <span className="meta">{t("token_scope")}</span>
            <p>
              <code>bundle:read</code> / <code>evidence:write</code> / <code>heartbeat:write</code>
            </p>
          </div>
        </div>
      </div>

      {approved ? (
        <div className="emptyState">
          <CheckCircle2 size={22} className="sectionIcon" />
          <h3>{t("approved_title")}</h3>
          <p className="meta">
            {t("approved_description")} <code>{workspace || t("default_workspace")}</code>.
          </p>
        </div>
      ) : session ? (
        <form action={approveDevice} className="formStack">
          <label className="fieldLabel" htmlFor="device-user-code">
            {t("device_code")}
          </label>
          <input
            id="device-user-code"
            name="user_code"
            type="text"
            className="textInput"
            placeholder="SPCTRE-XXXX-XXXX"
            defaultValue={prefillCode}
            autoComplete="off"
            autoFocus={!prefillCode}
            required
          />
          <div className="toolbar">
            <PendingSubmitButton pendingLabel="Approving…">
              <ShieldCheck size={16} />
              {t("approve")}
            </PendingSubmitButton>
          </div>
        </form>
      ) : (
        <>
          <div className="toolbar">
            <Link
              className="button buttonPrimary"
              href={`/login?next=${encodeURIComponent(devicePath)}`}
            >
              <ShieldCheck size={16} />
              {t("sign_in")}
            </Link>
          </div>
          {signupAvailable ? <SelfServeSignupForm returnTo={devicePath} /> : null}
        </>
      )}
    </section>
  );
}
