import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, KeyRound, PlayCircle, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { launchDemoCloud, loginWithPrincipalForm, verifyMfaLoginForm } from "@/app/auth-actions";
import { getAuthSession, listAllLoginPrincipals } from "@/lib/auth-session";
import { DEMO_TENANT_ID } from "@/lib/demo";
import { listPrincipalMfaMethods } from "@/lib/domains/auth/service";
import { DEMO_PRINCIPAL_IDS } from "@/lib/demo";
import { getOidcConfig, getSamlConfig, getSamlProviderForTenant } from "@/lib/enterprise-auth";
import { EmailAuthForm } from "./email-auth-form";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { SmsMfaTrigger } from "./sms-mfa-trigger";
import { isConfiguredUserLoginEnabled } from "@/lib/auth-login-modes";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

type LoginSession = Awaited<ReturnType<typeof getAuthSession>>;

// Resolve which sign-in options are available for this deployment/session.
async function loadLoginOptions(session: LoginSession) {
  const configuredUserLoginEnabled = isConfiguredUserLoginEnabled();
  const demoPrincipalIds = new Set<string>(Object.values(DEMO_PRINCIPAL_IDS));
  const principals = configuredUserLoginEnabled
    ? (await listAllLoginPrincipals().catch(swallow("listAllLoginPrincipals", [])))
      .filter((principal) => principal.tenant_id !== DEMO_TENANT_ID && !demoPrincipalIds.has(principal.id))
    : [];
  const oidcEnabled = Boolean(getOidcConfig());
  const localSignupEnabled = process.env.LOCAL_SIGNUP_ENABLED === "true";
  const samlEnvConfigured = Boolean(getSamlConfig());
  const samlProviderConfigured =
    samlEnvConfigured &&
    Boolean(await getSamlProviderForTenant(DEMO_TENANT_ID).catch(swallow("getSamlProviderForTenant", null)));
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID?.trim());
  const githubEnabled = Boolean(process.env.GITHUB_CLIENT_ID?.trim());

  const ssoConfigured = oidcEnabled || samlProviderConfigured || googleEnabled || githubEnabled;

  const enrollments = session
    ? await listPrincipalMfaMethods({
        principalId: session.principalId,
        tenantId: session.tenantId,
      }).catch(swallow("listPrincipalMfaMethods", []))
    : [];
  const hasSmsMfa = enrollments.some((e) => e.mfaType === "SMS") && getSpctrePlan() !== "oss";

  return {
    configuredUserLoginEnabled,
    principals,
    oidcEnabled,
    localSignupEnabled,
    samlProviderConfigured,
    googleEnabled,
    githubEnabled,
    ssoConfigured,
    hasSmsMfa,
  };
}

type LoginOptions = Awaited<ReturnType<typeof loadLoginOptions>>;

function SsoButtons({
  options,
  labels,
}: {
  options: LoginOptions;
  labels: {
    github: string;
    google: string;
    oidc: string;
    or: string;
    saml: string;
  };
}) {
  return (
    <>
      {options.oidcEnabled ? (
        <a className="button buttonPrimary" href="/api/auth/oidc/authorize">
          {labels.oidc}
        </a>
      ) : null}

      {options.samlProviderConfigured ? (
        <a className="button buttonPrimary" href="/api/auth/saml/authorize">
          {labels.saml}
        </a>
      ) : null}

      {options.googleEnabled ? (
        <a className="button" href="/api/auth/google/authorize">
          {labels.google}
        </a>
      ) : null}

      {options.githubEnabled ? (
        <a className="button" href="/api/auth/github/authorize">
          {labels.github}
        </a>
      ) : null}

      {options.ssoConfigured ? (
        <div className="loginDivider">
          <span />
          <span className="metadata">{labels.or}</span>
          <span />
        </div>
      ) : null}
    </>
  );
}

function LocalAccountForm({
  labels,
  next,
  principals,
}: {
  labels: {
    empty: string;
    field: string;
    hint: string;
    select: string;
    submit: string;
  };
  next: string;
  principals: LoginOptions["principals"];
}) {
  return (
    <form action={loginWithPrincipalForm} className="loginForm">
      <input type="hidden" name="next" value={next} />
      <div className="loginFieldGroup">
        <label className="metadata" htmlFor="principalId">{labels.field}</label>
        <p className="meta" style={{ marginBottom: 4, fontSize: 12 }}>{labels.hint}</p>
        <select id="principalId" name="principalId" className="input" defaultValue="" required disabled={!principals.length}>
          <option value="" disabled>
            {principals.length ? labels.select : labels.empty}
          </option>
          {principals.map((principal) => (
            <option key={principal.id} value={principal.id}>
              {principal.display_name}
              {principal.email ? ` (${principal.email})` : ""}
            </option>
          ))}
        </select>
      </div>
      <button className="button buttonPrimary" type="submit" disabled={!principals.length}>
        {labels.submit}
      </button>
    </form>
  );
}

function DemoCloudPanel({
  labels,
}: {
  labels: {
    defaultPersona: string;
    description: string;
    launch: string;
    tenant: string;
    title: string;
    warning: string;
    workspace: string;
  };
}) {
  return (
    <section className="loginPanel loginDemoPanel">
      <div className="loginPanelHeader">
        <div className="loginPanelTitle">
          <ShieldCheck size={16} color="var(--accent)" />
          <h2>{labels.title}</h2>
        </div>
        <p className="meta">
          {labels.description}
        </p>
      </div>

      <div className="loginDemoDetails">
        <div>
          <span className="metadata">{labels.tenant}</span>
          <code>tenant-demo</code>
        </div>
        <div>
          <span className="metadata">{labels.workspace}</span>
          <code>workspace-demo</code>
        </div>
        <div>
          <span className="metadata">{labels.defaultPersona}</span>
          <code>Nora Owner</code>
        </div>
      </div>

      <form action={launchDemoCloud}>
        <button className="button buttonPrimary loginLaunchDemoButton" type="submit">
          <PlayCircle size={15} />
          {labels.launch}
          <ArrowRight size={15} />
        </button>
      </form>
      <p className="meta">
        {labels.warning}
      </p>
    </section>
  );
}

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("auth.login.page");
  const params = searchParams ? await searchParams : {};
  const next = typeof params.next === "string" ? params.next : "";
  const session = await getAuthSession();
  if (session && (!session.requireMfa || session.mfaVerified)) {
    redirect("/");
  }

  const options = await loadLoginOptions(session);
  const { configuredUserLoginEnabled, principals, localSignupEnabled, ssoConfigured, hasSmsMfa } = options;

  return (
    <main className="loginPage">
      <div className="loginAccessShell">

        <header className="loginAccessHeader">
          <div className="loginBrandLockup">
            <div className="loginBrandMark">
              <BrandLogo size={24} />
            </div>
            <div>
              <h1 className="loginBrandTitle">Spctre</h1>
              <p className="metadata loginBrandMeta">{t("brand_meta")}</p>
            </div>
          </div>
          <p className="metadata loginAccessHeaderNote">
            {ssoConfigured
              ? t("header_note_sso")
              : t("header_note")}
          </p>
        </header>

        <div className="loginAccessGrid">
          <section className="loginPanel loginPanelPrimary">
            <div className="loginPanelHeader">
              <div className="loginPanelTitle">
                <KeyRound size={16} color="var(--accent)" />
                <h2>{t("title")}</h2>
              </div>
              <p className="meta">
                {ssoConfigured
                  ? t("description_sso")
                  : t("description")}
              </p>
            </div>

            <SsoButtons
              options={options}
              labels={{
                github: t("sso.github"),
                google: t("sso.google"),
                oidc: t("sso.oidc"),
                or: t("sso.or"),
                saml: t("sso.saml"),
              }}
            />

            <EmailAuthForm />

            {session?.requireMfa && !session.mfaVerified ? (
              <form action={verifyMfaLoginForm} className="loginForm">
                <input type="hidden" name="next" value={next} />
                {hasSmsMfa && <SmsMfaTrigger />}
                <div className="loginFieldGroup">
                  <label className="metadata" htmlFor="mfaCode">{t("mfa.code")}</label>
                  <input
                    id="mfaCode"
                    name="code"
                    className="input"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    minLength={6}
                    maxLength={6}
                    placeholder="123456"
                    required
                  />
                </div>
                <button className="button buttonPrimary" type="submit">
                  {t("mfa.submit")}
                </button>
                <p className="meta">{t("mfa.description")}</p>
              </form>
            ) : null}

            {typeof params.error === "string" ? (
              <p className="loginMessage loginMessageError">
                {t("auth_error", { error: params.error })}
              </p>
            ) : null}
            {typeof params.ok === "string" ? (
              <p className="loginMessage">
                {params.ok === "local_signup_created"
                  ? t("local_signup_created")
                  : params.ok}
              </p>
            ) : null}

            {configuredUserLoginEnabled ? (
              <LocalAccountForm
                labels={{
                  empty: t("local.empty"),
                  field: t("local.field"),
                  hint: t("local.hint"),
                  select: t("local.select"),
                  submit: t("local.submit"),
                }}
                next={next}
                principals={principals}
              />
            ) : null}

            {localSignupEnabled ? (
              <Link
                className="button loginSecondaryAction"
                href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
              >
                {t("create_local")}
              </Link>
            ) : null}

            <Link className="loginSecondaryAction" href="/login/recover">
              {t("recover")}
            </Link>

          </section>
          <DemoCloudPanel
            labels={{
              defaultPersona: t("demo.default_persona"),
              description: t("demo.description"),
              launch: t("demo.launch"),
              tenant: t("demo.tenant"),
              title: t("demo.title"),
              warning: t("demo.warning"),
              workspace: t("demo.workspace"),
            }}
          />
        </div>
      </div>
    </main>
  );
}
