"use client";

const RECAPTCHA_CONTAINER_ID = "firebase-recaptcha-container";

function ensureRecaptchaContainer(): HTMLElement {
  let container = document.getElementById(RECAPTCHA_CONTAINER_ID);
  if (container) return container;

  container = document.createElement("div");
  container.id = RECAPTCHA_CONTAINER_ID;
  container.style.position = "fixed";
  container.style.right = "12px";
  container.style.bottom = "12px";
  container.style.zIndex = "2147483647";
  document.body.appendChild(container);
  return container;
}

export async function getRecaptchaToken(): Promise<string> {
  if (process.env.NODE_ENV !== "production") {
    return "mock-server-token";
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim();

  if (!apiKey || !authDomain) {
    // Reaches the operator as-is: both callers surface the thrown message. Say
    // that the deployment is missing configuration rather than that something
    // went wrong, because nothing the user can do will change it. NEXT_PUBLIC_*
    // values are inlined at build time, so this cannot be fixed by setting an
    // environment variable on an already-built image.
    throw new Error(
      "SMS verification is unavailable: this deployment was built without Firebase reCAPTCHA configuration.",
    );
  }

  const [{ getApps, initializeApp }, { getAuth, RecaptchaVerifier }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);

  const app =
    getApps()[0] ??
    initializeApp({
      apiKey,
      authDomain,
      ...(projectId ? { projectId } : {}),
      ...(appId ? { appId } : {}),
    });

  const verifier = new RecaptchaVerifier(getAuth(app), ensureRecaptchaContainer(), {
    size: "invisible",
  });

  try {
    return await verifier.verify();
  } finally {
    verifier.clear();
  }
}
