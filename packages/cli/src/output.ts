export type OutputFormat = "text" | "json" | "sarif";

/**
 * Resolves output format with the following priority:
 *   1. commandFormat arg (command-local --format or --output flag)
 *   2. Global --output flag scanned from process.argv
 *   3. SPCTRE_OUTPUT env var
 *   4. "text" default
 */
export function getOutputFormat(commandFormat?: string): OutputFormat {
  const resolve = (v: string | undefined): OutputFormat | null => {
    if (v === "json") return "json";
    if (v === "sarif") return "sarif";
    if (v === "text") return "text";
    return null;
  };

  if (commandFormat) return resolve(commandFormat) ?? "text";

  const idx = process.argv.findIndex((a) => a === "--output");
  const global = idx !== -1 ? process.argv[idx + 1] : undefined;
  return resolve(global) ?? resolve(process.env.SPCTRE_OUTPUT) ?? "text";
}

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function printProgress(message: string): void {
  process.stderr.write(message + "\n");
}
