"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { revokeSessionForm, type RevokeSessionState } from "./account-actions";

interface ActiveSession {
  id: string;
  created_at: Date | string;
  last_seen_at: Date | string;
  expires_at: Date | string;
  user_agent: string | null;
  ip_address: string | null;
}

interface ActiveSessionsSectionProps {
  currentSessionId: string;
  activeSessions: ActiveSession[];
}

function RevokeButton({ sessionId }: { sessionId: string }) {
  const t = useTranslations("account.sessions");
  const [state, action, pending] = useActionState<RevokeSessionState, FormData>(
    revokeSessionForm,
    null,
  );
  return (
    <div style={{ display: "grid", gap: "4px", alignItems: "end", justifyItems: "end" }}>
      <form action={action}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <button className="button" type="submit" disabled={pending}>
          {pending ? t("revoking") : t("revoke")}
        </button>
      </form>
      {state?.errorCode && (
        <p className="meta workspaceError" style={{ margin: 0, fontSize: "12px" }}>
          {t(`errors.${state.errorCode}`)}
        </p>
      )}
    </div>
  );
}

interface UserAgentLabels {
  browser: string;
  unknownDevice: string;
  unknownOs: string;
}

function parseUserAgent(
  ua: string | null,
  labels: UserAgentLabels,
  t: (key: any, values?: any) => string,
): string {
  if (!ua) return labels.unknownDevice;
  const uaLower = ua.toLowerCase();

  let browser = labels.browser;
  if (uaLower.includes("firefox")) browser = "Firefox";
  else if (uaLower.includes("chrome") && !uaLower.includes("chromium")) browser = "Chrome";
  else if (uaLower.includes("safari") && !uaLower.includes("chrome")) browser = "Safari";
  else if (uaLower.includes("edge")) browser = "Edge";
  else if (uaLower.includes("opera")) browser = "Opera";

  let os = labels.unknownOs;
  if (uaLower.includes("macintosh") || uaLower.includes("mac os x")) os = "macOS";
  else if (uaLower.includes("windows")) os = "Windows";
  else if (uaLower.includes("linux")) os = "Linux";
  else if (uaLower.includes("iphone") || uaLower.includes("ipad")) os = "iOS";
  else if (uaLower.includes("android")) os = "Android";

  return t("device_label", { browser, os });
}

export function ActiveSessionsSection({
  currentSessionId,
  activeSessions,
}: ActiveSessionsSectionProps) {
  const t = useTranslations("account.sessions");
  const userAgentLabels: UserAgentLabels = {
    browser: t("browser"),
    unknownDevice: t("unknown_device"),
    unknownOs: t("unknown_os"),
  };
  return (
    <section className="panel">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h2>{t("title")}</h2>
        <p className="meta">{t("description")}</p>
      </div>

      <div style={{ display: "grid", gap: "16px", marginTop: "8px" }}>
        {activeSessions.length === 0 ? (
          <p className="meta">{t("empty")}</p>
        ) : (
          activeSessions.map((session) => {
            const isCurrent = session.id === currentSessionId;
            const parsedDevice = parseUserAgent(session.user_agent, userAgentLabels, t);
            const createdDate = new Date(session.created_at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            });
            const lastSeenDate = new Date(session.last_seen_at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            });

            return (
              <article
                key={session.id}
                className="row"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px",
                  border: "1px solid var(--line)",
                  borderRadius: "8px",
                }}
              >
                <div style={{ display: "grid", gap: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>{parsedDevice}</h3>
                    {isCurrent && (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          background: "oklch(0.97 0.04 152)",
                          color: "oklch(0.38 0.09 152)",
                          padding: "2px 6px",
                          borderRadius: "999px",
                        }}
                      >
                        {t("this_device")}
                      </span>
                    )}
                  </div>
                  <p className="meta" style={{ margin: 0, fontSize: "12px" }}>
                    {t("ip_created", { ip: session.ip_address ?? t("unknown") })}{" "}
                    <span suppressHydrationWarning>{createdDate}</span>
                  </p>
                  <p className="meta" style={{ margin: 0, fontSize: "12px" }}>
                    {t("last_active")} <span suppressHydrationWarning>{lastSeenDate}</span>
                  </p>
                </div>

                {!isCurrent && <RevokeButton sessionId={session.id} />}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
