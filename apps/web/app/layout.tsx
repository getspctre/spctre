import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { getShellPageModel } from "@/lib/domains/workspace/service";
import { DegradedDataNotice } from "./degraded-data-notice";
import { Sidebar } from "./sidebar";
import { TopNav } from "./top-nav";
import { getWorkspaceContext } from "@/lib/workspace";
import { WorkspaceCookieNormalizer } from "./workspace-cookie-normalizer";
import { getAuthSession } from "@/lib/auth-session";
import { getAppViewMode } from "@/lib/app-view-mode-server";
import { FeatureFlagProvider } from "./feature-flags";
import { getFeatureFlagSnapshot } from "@/lib/feature-flags";
import { resolveTenantPlan } from "@/lib/entitlements/features";
import { EscalationBanner } from "./escalation-banner";
import { resolveI18nRequestConfig } from "@/lib/i18n/request-config";
import { NextIntlClientProvider } from "next-intl";

export const metadata: Metadata = {
  title: "Spctre Control Plane",
  description:
    "Stack-neutral policy operations and runtime evidence for AGT-compatible agent governance",
  icons: { icon: "/icon.svg" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const i18n = await resolveI18nRequestConfig();
  if (headersList.get("x-is-docs") === "true") {
    return (
      <html lang="en" suppressHydrationWarning>
        <body>{children}</body>
      </html>
    );
  }

  const session = await getAuthSession();
  // The snapshot handed to every client component below is the viewer's, not
  // the deployment's. Sending the deployment's would advertise — and let the
  // client act on — features the tenant has not bought, on a hosted deployment
  // running at the highest plan it sells.
  const plan = await resolveTenantPlan(session?.tenantId ?? null);
  const featureFlags = getFeatureFlagSnapshot(plan);
  const hasAppAccess = Boolean(session && (!session.requireMfa || session.mfaVerified));

  if (!hasAppAccess || !session) {
    return (
      <html lang={i18n.locale}>
        <body>
          <NextIntlClientProvider locale={i18n.locale} messages={i18n.messages}>
            <FeatureFlagProvider flags={featureFlags} plan={plan}>
              {children}
            </FeatureFlagProvider>
          </NextIntlClientProvider>
        </body>
      </html>
    );
  }

  const workspaceContext = await getWorkspaceContext();
  const appViewMode = await getAppViewMode();
  const { branchCount, escalationCount, escalationPreview, isAdmin, degraded } =
    await getShellPageModel({
      tenantId: workspaceContext.tenantId,
      workspaceId: workspaceContext.workspaceId,
      principalId: session.principalId,
    });
  return (
    <html lang={i18n.locale}>
      <body>
        <WorkspaceCookieNormalizer
          tenantId={workspaceContext.tenantId}
          workspaceId={workspaceContext.workspaceId}
          enabled={workspaceContext.needsCookieNormalization}
        />
        <NextIntlClientProvider locale={i18n.locale} messages={i18n.messages}>
          <FeatureFlagProvider flags={featureFlags} plan={plan}>
            <div className="shell">
              <Sidebar
                branchCount={branchCount || undefined}
                escalationCount={escalationCount || undefined}
                activeWorkspaceId={workspaceContext.workspaceId}
                workspaceOptions={workspaceContext.workspaces}
              />
              <div className="mainFrame">
                <TopNav
                  tenantLabel={workspaceContext.tenantSlug}
                  activeTenantId={workspaceContext.tenantId}
                  tenantOptions={workspaceContext.tenants}
                  workspaceLabel={workspaceContext.workspaceSlug}
                  activeWorkspaceId={workspaceContext.workspaceId}
                  workspaceOptions={workspaceContext.workspaces}
                  activePrincipalName={session?.displayName}
                  activePrincipalEmail={session?.email}
                  signedIn={Boolean(session)}
                  isAdmin={isAdmin}
                  escalationCount={escalationCount || undefined}
                  initialViewMode={appViewMode}
                />
                {escalationCount ? (
                  <EscalationBanner
                    count={escalationCount}
                    escalationsHref={`/${workspaceContext.workspaceSlug}/escalations`}
                    items={escalationPreview}
                  />
                ) : null}
                <main className="main">
                  {degraded ? <DegradedDataNotice /> : null}
                  {children}
                </main>
              </div>
            </div>
          </FeatureFlagProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
