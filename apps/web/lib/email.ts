import { fetchWithTimeout } from "@/lib/platform/fetch-timeout";
import { logger } from "@spctre/platform/logging";

const FROM_EMAIL = process.env.MAGIC_LINK_FROM_EMAIL?.trim() || "noreply@spctre.dev";
const APP_NAME = "Spctre";

const EMAIL_ADDRESS_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

function maskEmails(input: string): string {
  return input.replace(EMAIL_ADDRESS_PATTERN, "<redacted-email>");
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function sendMagicLinkEmail(params: {
  to: string;
  magicLink: string;
}): Promise<"sent" | "smtp-not-configured"> {
  const resendKey = process.env.RESEND_API_KEY?.trim();

  if (!resendKey) {
    if (isProduction()) {
      // The magic link is a single-use auth credential; never emit it (or the
      // recipient address) to production logs on a missing-key misconfiguration.
      logger.error("email.smtp_not_configured", { delivery_kind: "magic-link" });
    } else {
      // Development fallback: log to console so devs can follow the link
      console.info(`[magic-link] To: ${params.to}\n${params.magicLink}`);
    }
    return "smtp-not-configured";
  }

  const res = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [params.to],
      subject: `Sign in to ${APP_NAME}`,
      text: `Click this link to sign in:\n\n${params.magicLink}\n\nThis link expires in 15 minutes and can only be used once.`,
      html: `<p>Click the link below to sign in to ${APP_NAME}:</p><p><a href="${params.magicLink}">${params.magicLink}</a></p><p>This link expires in 15 minutes and can only be used once.</p>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error("email.resend_delivery_failed", {
      delivery_kind: "magic-link",
      status: res.status,
      response_body: maskEmails(body),
    });
  }

  return "sent";
}

export async function sendAlertEmail(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<"sent" | "smtp-not-configured"> {
  const resendKey = process.env.RESEND_API_KEY?.trim();

  if (!resendKey) {
    if (isProduction()) {
      logger.error("email.smtp_not_configured", { delivery_kind: "alert" });
    } else {
      console.info(`[alert-email] To: ${params.to}\nSubject: ${params.subject}\n\n${params.text}`);
    }
    return "smtp-not-configured";
  }

  const res = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [params.to],
      subject: params.subject,
      text: params.text,
      html: `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap;">${escapeHtml(params.text)}</pre>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error("email.resend_delivery_failed", {
      delivery_kind: "alert",
      status: res.status,
      response_body: maskEmails(body),
    });
  }

  return "sent";
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendMemberInviteEmail(params: {
  to: string;
  inviterName?: string | null;
  role: string;
  loginUrl: string;
}): Promise<"sent" | "smtp-not-configured"> {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const subject = `You're invited to ${APP_NAME}`;
  const inviter = params.inviterName ? `${params.inviterName} invited you` : `You were invited`;
  const text = `${inviter} to join ${APP_NAME} as ${params.role}.\n\nSign in to accept the invitation:\n\n${params.loginUrl}\n\nThis invitation uses your existing email sign-in or SSO flow.`;

  if (!resendKey) {
    if (isProduction()) {
      logger.error("email.smtp_not_configured", { delivery_kind: "member-invite" });
    } else {
      console.info(`[member-invite] To: ${params.to}\n${params.loginUrl}`);
    }
    return "smtp-not-configured";
  }

  const res = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [params.to],
      subject,
      text,
      html: `<p>${escapeHtml(inviter)} to join ${APP_NAME} as <strong>${escapeHtml(params.role)}</strong>.</p><p><a href="${escapeHtml(params.loginUrl)}">Sign in to accept the invitation</a></p><p>This invitation uses your existing email sign-in or SSO flow.</p>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error("email.resend_delivery_failed", {
      delivery_kind: "member-invite",
      status: res.status,
      response_body: maskEmails(body),
    });
  }

  return "sent";
}
