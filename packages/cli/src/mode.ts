export function isNonInteractive(): boolean {
  return (
    process.argv.includes("--non-interactive") ||
    process.env.CI === "true" ||
    process.env.SPCTRE_NON_INTERACTIVE === "1"
  );
}
