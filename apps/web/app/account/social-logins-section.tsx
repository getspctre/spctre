"use client";

import { useTranslations } from "next-intl";
import { unlinkSocialIdentityForm } from "./account-actions";

interface SocialLoginsSectionProps {
  googleEnabled: boolean;
  githubEnabled: boolean;
  linkedIdentities: { provider: "GOOGLE" | "GITHUB"; externalEmail: string | null }[];
}

export function SocialLoginsSection({
  googleEnabled,
  githubEnabled,
  linkedIdentities,
}: SocialLoginsSectionProps) {
  const t = useTranslations("account.social");
  const googleLinked = linkedIdentities.find((i) => i.provider === "GOOGLE");
  const githubLinked = linkedIdentities.find((i) => i.provider === "GITHUB");

  // Prevent unlinking if it's the only login path
  const canUnlink = linkedIdentities.length > 1;

  return (
    <section className="panel">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h2>{t("title")}</h2>
        <p className="meta">{t("description")}</p>
      </div>

      <div style={{ display: "grid", gap: "16px" }}>
        {googleEnabled && (
          <article
            className="row"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <div style={{ display: "grid", gap: "2px" }}>
              <h3 style={{ margin: 0 }}>{t("google")}</h3>
              {googleLinked ? (
                <p className="meta" style={{ margin: 0 }}>
                  {t("linked", { value: googleLinked.externalEmail ?? t("yes") })}
                </p>
              ) : (
                <p className="meta" style={{ margin: 0 }}>
                  {t("not_linked")}
                </p>
              )}
            </div>
            {googleLinked ? (
              <form action={unlinkSocialIdentityForm}>
                <input type="hidden" name="provider" value="GOOGLE" />
                <button
                  className="button"
                  type="submit"
                  disabled={!canUnlink}
                  title={!canUnlink ? t("cannot_unlink") : undefined}
                >
                  {t("disconnect")}
                </button>
              </form>
            ) : (
              <a className="button" href="/api/auth/google/authorize?next=/account">
                {t("connect")}
              </a>
            )}
          </article>
        )}

        {githubEnabled && (
          <article
            className="row"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <div style={{ display: "grid", gap: "2px" }}>
              <h3 style={{ margin: 0 }}>{t("github")}</h3>
              {githubLinked ? (
                <p className="meta" style={{ margin: 0 }}>
                  {t("linked", { value: githubLinked.externalEmail ?? t("yes") })}
                </p>
              ) : (
                <p className="meta" style={{ margin: 0 }}>
                  {t("not_linked")}
                </p>
              )}
            </div>
            {githubLinked ? (
              <form action={unlinkSocialIdentityForm}>
                <input type="hidden" name="provider" value="GITHUB" />
                <button
                  className="button"
                  type="submit"
                  disabled={!canUnlink}
                  title={!canUnlink ? t("cannot_unlink") : undefined}
                >
                  {t("disconnect")}
                </button>
              </form>
            ) : (
              <a className="button" href="/api/auth/github/authorize?next=/account">
                {t("connect")}
              </a>
            )}
          </article>
        )}

        {!googleEnabled && !githubEnabled && <p className="meta">{t("empty")}</p>}
      </div>
    </section>
  );
}
