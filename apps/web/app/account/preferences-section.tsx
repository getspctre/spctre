"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { localeLabels, supportedLocales, type SupportedLocale } from "@/lib/i18n/messages";
import { setLocalePreference } from "../locale-actions";

interface PreferencesSectionProps {
  locale: SupportedLocale;
}

export function PreferencesSection({ locale }: PreferencesSectionProps) {
  const t = useTranslations("account.preferences");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<SupportedLocale>(locale);

  function handleChange(next: SupportedLocale) {
    setValue(next);
    startTransition(async () => {
      await setLocalePreference(next);
      router.refresh();
    });
  }

  return (
    <section className="panel">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h2>{t("title")}</h2>
        <p className="meta">
          {t("description")}
        </p>
      </div>

      <div style={{ display: "grid", gap: "8px", maxWidth: "320px" }}>
        <label className="workspaceFieldLabel" htmlFor="account-locale-select">
          {t("display_language")}
        </label>
        <select
          id="account-locale-select"
          className="input"
          value={value}
          disabled={pending}
          onChange={(event) => handleChange(event.currentTarget.value as SupportedLocale)}
        >
          {supportedLocales.map((option) => (
            <option key={option} value={option}>
              {localeLabels[option]} ({option.toUpperCase()})
            </option>
          ))}
        </select>
        {pending ? <p className="meta">{t("saving")}</p> : null}
      </div>
    </section>
  );
}
