import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getAuthSession } from "@/lib/auth-session";
import { getAccountPageModel } from "@/lib/domains/auth/service";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { isDemoTenant } from "@/lib/demo-guard";
import { normalizeLocale } from "@/lib/i18n/messages";
import { SettingsHeader } from "@/components/settings-header";

import { TotpSection } from "./totp-section";
import { PasskeySection } from "./passkey-section";
import { RecoveryCodesSection } from "./recovery-codes-section";
import { SocialLoginsSection } from "./social-logins-section";
import { SmsSection } from "./sms-section";
import { ActiveSessionsSection } from "./active-sessions-section";
import { PreferencesSection } from "./preferences-section";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const t = await getTranslations("account");
  const session = await getAuthSession().catch(() => null);
  if (!session) {
    redirect("/login");
  }

  const {
    passkeys,
    enrollments,
    unusedRecoveryCodes,
    linkedIdentities,
    activeSessions,
  } = await getAccountPageModel(session.principalId, session.tenantId);

  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID?.trim());
  const githubEnabled = Boolean(process.env.GITHUB_CLIENT_ID?.trim());
  const plan = getSpctrePlan();
  const visibleSessions = isDemoTenant(session.tenantId)
    ? activeSessions.filter((s) => s.id === session.sessionId)
    : activeSessions;

  const locale = normalizeLocale(await getLocale());

  return (
    <>
      <SettingsHeader eyebrow={t("eyebrow")} title={t("title")} />

      <section className="adminAuthStack accountSettingsStack" aria-label={t("settings_label")}>
        {/* Compact preference first */}
        <PreferencesSection locale={locale} />

        {/* Sign-in & MFA factors, grouped */}
        <TotpSection existingEnrollments={enrollments} />
        {plan !== "oss" && <SmsSection existingEnrollments={enrollments} />}
        <PasskeySection passkeys={passkeys} />
        <RecoveryCodesSection unusedCount={unusedRecoveryCodes} />

        {/* Variable-height lists that grow with entries last */}
        <SocialLoginsSection googleEnabled={googleEnabled} githubEnabled={githubEnabled} linkedIdentities={linkedIdentities} />
        <ActiveSessionsSection currentSessionId={session.sessionId} activeSessions={visibleSessions} />
      </section>
    </>
  );
}
