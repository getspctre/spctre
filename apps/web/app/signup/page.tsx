import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { localDevSignup } from "./actions";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("auth.signup");
  if (process.env.LOCAL_SIGNUP_ENABLED !== "true") {
    redirect("/login?error=local_signup_disabled");
  }

  const params = searchParams ? await searchParams : {};
  const error = typeof params.error === "string" ? params.error : null;
  const next = typeof params.next === "string" ? params.next : "";

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }}>
      <section className="panel" style={{ width: "100%", maxWidth: "480px", gap: "12px" }}>
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2>{t("title")}</h2>
          <p className="meta">
            {t.rich("description", {
              code: (chunks) => <code>{chunks}</code>,
            })}
          </p>
        </div>

        <form action={localDevSignup} style={{ display: "grid", gap: "10px" }}>
          <input type="hidden" name="next" value={next} />
          <label>
            <span>{t("display_name")}</span>
            <input className="input" name="displayName" placeholder={t("display_name_placeholder")} required />
          </label>
          <label>
            <span>{t("email")}</span>
            <input className="input" name="email" type="email" placeholder={t("email_placeholder")} required />
          </label>
          <button className="button buttonPrimary" type="submit">
            {t("submit")}
          </button>
        </form>

        {error ? <p className="meta workspaceError">{t("error", { error })}</p> : null}

        <Link className="button" href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>
          {t("back")}
        </Link>
      </section>
    </main>
  );
}
