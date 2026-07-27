import { fetchWithTimeout } from "@/lib/platform/fetch-timeout";
import { logger } from "@spctre/platform/logging";

function maskPhone(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  return digits.length > 2 ? `***${digits.slice(-2)}` : "***";
}

function maskPhoneNumbers(input: string): string {
  return input.replace(/\+?\d[\d\s().-]{5,}\d/g, "<redacted-phone>");
}

export async function sendSmsOtp(phoneNumber: string, recaptchaToken: string = "mock-server-token"): Promise<string> {
  const firebaseApiKey = process.env.FIREBASE_API_KEY?.trim();
  if (!firebaseApiKey) {
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
    body: JSON.stringify({
      phoneNumber,
      recaptchaToken,
    }),
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
    // Dev fallback mode
    return sessionInfo === "dev-session-info" && /^\d{6}$/.test(code);
  }

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${firebaseApiKey}`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionInfo,
      code,
    }),
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
