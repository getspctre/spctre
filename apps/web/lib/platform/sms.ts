import { fetchWithTimeout } from "@/lib/platform/fetch-timeout";
import { logger } from "@spctre/platform/logging";
import { getRuntimeConfig } from "@/lib/config/runtime";

/**
 * Whether the offline development path below may be taken.
 *
 * That path is a genuine authentication bypass, not a stub: it issues a
 * placeholder `sessionInfo` and then accepts any six-digit code against it, so
 * a deployment that reaches it has SMS MFA that reports as enrolled and
 * enforces nothing. It is correct with no Firebase project to talk to and a
 * developer reading the code off their own console; it is a hole anywhere else.
 *
 * Gated on the runtime mode rather than NODE_ENV because
 * `lib/config/runtime.ts` makes SPCTRE_RUNTIME_MODE the authoritative
 * declaration and refuses to start a production Node process without it. The
 * client-side reCAPTCHA guard in `lib/platform/recaptcha.ts` is not a
 * substitute: it runs in the browser, and both MFA routes accept a direct POST.
 */
function offlineDevFallbackAllowed(): boolean {
  return getRuntimeConfig().mode !== "production";
}

function maskPhone(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  return digits.length > 2 ? `***${digits.slice(-2)}` : "***";
}

function maskPhoneNumbers(input: string): string {
  return input.replace(/\+?\d[\d\s().-]{5,}\d/g, "<redacted-phone>");
}

export async function sendSmsOtp(
  phoneNumber: string,
  recaptchaToken: string = "mock-server-token",
): Promise<string> {
  const firebaseApiKey = process.env.FIREBASE_API_KEY?.trim();
  if (!firebaseApiKey) {
    if (!offlineDevFallbackAllowed()) {
      // Refuse to mint an enrollment that nothing can verify. The caller
      // answers 502 with this message, so the operator learns the deployment
      // is misconfigured instead of the tenant acquiring a factor that accepts
      // any code.
      logger.error("sms.not_configured", { delivery_kind: "sms-otp" });
      throw new Error(
        "SMS verification is unavailable: this deployment has no FIREBASE_API_KEY configured.",
      );
    }
    // Dev fallback mode: write to console for offline testing
    console.log(`\n==================================================`);
    console.log(`[SMS-DEV-OTP] Phone: ${maskPhone(phoneNumber)}`);
    console.log(`[SMS-DEV-OTP] Dev mode — enter any 6-digit code to verify.`);
    console.log(`==================================================\n`);
    return "dev-session-info";
  }

  // Real GCP/Firebase Auth dispatch
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${firebaseApiKey}`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber, recaptchaToken }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error("sms.firebase_send_failed", {
      status: response.status,
      response_body: maskPhoneNumbers(errorBody),
    });
    throw new Error("Failed to dispatch verification SMS via Google Cloud / Firebase API.");
  }

  const data = await response.json();
  if (!data.sessionInfo) {
    throw new Error("Firebase response missing sessionInfo.");
  }
  return data.sessionInfo;
}

export async function verifyFirebasePhoneAuth(sessionInfo: string, code: string): Promise<boolean> {
  const firebaseApiKey = process.env.FIREBASE_API_KEY?.trim();
  if (!firebaseApiKey) {
    if (!offlineDevFallbackAllowed()) {
      // Fail closed rather than throw: a rejected code is the honest answer to
      // this request, and it is also what retires any enrollment already
      // holding the placeholder sessionInfo. The log is what tells an operator
      // why a factor stopped verifying.
      logger.error("sms.verify_not_configured");
      return false;
    }
    // Dev fallback mode
    return sessionInfo === "dev-session-info" && /^\d{6}$/.test(code);
  }

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${firebaseApiKey}`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionInfo, code }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error("sms.firebase_verify_failed", {
      status: response.status,
      response_body: maskPhoneNumbers(errorBody),
    });
    return false;
  }
  return true;
}
