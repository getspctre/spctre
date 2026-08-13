import { CheckCircle2, KeyRound, ShieldCheck, Terminal } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAuthSession } from "@/lib/auth-session";
import { isDemoTenant } from "@/lib/demo-guard";
import { approveCliOnboarding } from "./actions";
import { PendingSubmitButton } from "@/app/pending-submit-button";
import { loadSelfServeSignupSlot } from "@/lib/ee-adapters/self-serve-signup";
import { SelfServeSignupForm } from "@/app/self-serve-signup-form";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

export default async function CliOnboardingApprovePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("onboarding.cli_approve");
  const params = await searchParams;
  const code = typeof params.code === "string" ? params.code : "";
  const approved = params.approved === "1";
  const error = typeof params.error === "string" ? params.error : "";
  const workspace = typeof params.workspace === "string" ? params.workspace : "";
  const session = await getAuthSession().catch(swallow("getAuthSession", null));

  if (session && isDemoTenant(session.tenantId)) redirect("/");

  // Only resolved for a signed-out visitor: a signed-in one is already past the
  // point where making an account could help.
  const approvePath = `/onboarding/cli/approve?code=${encodeURIComponent(code)}`;
  const returnTo = encodeURIComponent(approvePath);
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
          <Terminal size={16} />
          <div>
            <span className="meta">{t("request_code")}</span>
            <p>
              <code>{code || t("missing")}</code>
            </p>
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
            {t("approved_description")}
            <code>{workspace || t("default_workspace")}</code>
            {t("approved_description_suffix")}
          </p>
        </div>
      ) : session ? (
        <form action={approveCliOnboarding} className="toolbar">
          <input name="code" type="hidden" value={code} />
          <PendingSubmitButton disabled={!code} pendingLabel="Approving…">
            <ShieldCheck size={16} />
            {t("approve")}
          </PendingSubmitButton>
        </form>
      ) : (
        <>
          <div className="toolbar">
            <Link className="button buttonPrimary" href={`/login?next=${returnTo}`}>
              <ShieldCheck size={16} />
              {t("sign_in")}
            </Link>
          </div>
          {signupAvailable ? <SelfServeSignupForm returnTo={approvePath} /> : null}
        </>
      )}
    </section>
  );
}
