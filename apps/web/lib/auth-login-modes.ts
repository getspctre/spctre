/**
 * Whether credential-free sign-in as a configured principal is available.
 *
 * `loginWithPrincipal` authenticates on a principal id supplied by the form and
 * nothing else — no password, no link, no factor. It exists so a developer can
 * move between seeded identities locally, and it is a complete authentication
 * bypass anywhere it is reachable.
 *
 * Disabled when EITHER production signal is set, deliberately. NODE_ENV alone
 * was the gate, and `lib/config/runtime.ts` is explicit that it must not be
 * trusted for this: a production Node process is required to declare
 * SPCTRE_RUNTIME_MODE rather than rely on NODE_ENV. A deployment that declares
 * the runtime mode but loses NODE_ENV — a self-host, a different orchestrator,
 * an edited Dockerfile — would otherwise offer sign-in as any principal. The
 * two variables have drifted apart in this repository's own images before.
 *
 * Read straight from the environment rather than through `getRuntimeConfig()`,
 * which validates the whole runtime configuration and throws on an unrelated
 * problem. A login surface must not fail to answer this question.
 */
export function isConfiguredUserLoginEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.SPCTRE_RUNTIME_MODE?.trim() === "production") return false;
  return process.env.SPCTRE_ENABLE_CONFIGURED_USER_LOGIN !== "false";
}
