import Link from "next/link";
import { KeyRound } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function AwaitingAccessPage() {
  const t = await getTranslations("auth.awaiting_access");
  return (
    <main className="authNoticePage">
      <section className="authNoticePanel">
        <KeyRound size={22} className="sectionIcon" />
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p className="meta">
            {t("description")}
          </p>
        </div>
        <Link className="button" href="/login">
          {t("back")}
        </Link>
      </section>
    </main>
  );
}
