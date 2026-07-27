export function isConfiguredUserLoginEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.SPCTRE_ENABLE_CONFIGURED_USER_LOGIN !== "false";
}
