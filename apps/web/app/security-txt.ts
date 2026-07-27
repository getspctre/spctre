const SECURITY_CONTACT = "mailto:security@spctre.dev";
const POLICY_URL = "https://github.com/spctre/spctre/security/policy";
const SECURITY_TXT_URL = "https://spctre.dev/.well-known/security.txt";

function securityTxt(): string {
  return lines([
    `Contact: ${SECURITY_CONTACT}`,
    `Policy: ${POLICY_URL}`,
    `Canonical: ${SECURITY_TXT_URL}`,
    "Preferred-Languages: en",
    "Hiring: https://spctre.dev",
    "",
    "# Spctre targets acknowledgement within 3 business days.",
    "# Confirmed vulnerabilities target patch or mitigation within 90 days."
  ]);
}

export function securityTxtResponse(): Response {
  return new Response(securityTxt(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600"
    }
  });
}

function lines(values: string[]): string {
  return `${values.join("\n")}\n`;
}
