/**
 * Vocabulary tables for `classifySemanticIntent`.
 *
 * These are deliberately data, not logic. The gateway decision path is
 * implemented twice — once here in TypeScript and once in Go (`apps/worker`) —
 * because the worker serves delegated decide traffic. Duplicating *logic*
 * across the two engines is testable with the shared conformance fixtures;
 * duplicating *vocabulary* is not, because a keyword added here and forgotten
 * in Go is a silent enforcement gap that no test or type checker would catch.
 *
 * So this module is the single source of truth, and the Go copy is generated
 * from it (`pnpm generate:semantic-topics`, verified fresh in CI). Edit the
 * tables here and regenerate; never hand-edit the Go side.
 *
 * Ordering is significant: topics are evaluated in array order and the first
 * match wins, so the generated file must preserve it.
 */

/** A safety topic: if the check prompt mentions a trigger, look for keywords. */
export interface SemanticTopic {
  /** Stable identifier, for debugging and conformance-fixture references. */
  id: string;
  /** Substrings of the check prompt that activate this topic. */
  promptTriggers: string[];
  /** Substrings of the search space that confirm a match. */
  keywords: string[];
}

export const SEMANTIC_TOPICS: SemanticTopic[] = [
  {
    id: "credentials",
    promptTriggers: [
      "credential",
      "secret",
      "password",
      "api key",
      "api_key",
      "private key",
      "private_key",
      "token",
      "auth",
    ],
    keywords: [
      "password",
      "token",
      "secret",
      "credentials",
      "api_key",
      "api key",
      "private_key",
      "private key",
      ".env",
      "passwd",
      "shadow",
      "auth_token",
      "auth_headers",
      "authorization",
    ],
  },
  {
    id: "unprofessional",
    promptTriggers: ["unprofessional", "behavior", "harassment", "rude", "swear", "insult"],
    keywords: [
      "stupid",
      "dumb",
      "idiot",
      "annoy",
      "swear",
      "insult",
      "lazy",
      "ignore policy",
      "bypass safety",
      "shut up",
    ],
  },
  {
    id: "destructive",
    promptTriggers: ["destructive", "danger", "delete", "drop", "destroy", "remove"],
    keywords: [
      "delete",
      "drop",
      "truncate",
      "destroy",
      "rm -rf",
      "wipe",
      "format",
      "shutdown",
      "terminate",
      "uninstall",
      "purge",
      "remove",
    ],
  },
  {
    id: "fraud",
    promptTriggers: ["fraud", "scam", "steal", "exfiltrate", "leak"],
    keywords: [
      "fraud",
      "scam",
      "transfer",
      "bypass",
      "hack",
      "exploit",
      "steal",
      "drain",
      "exfiltrate",
      "leak",
      "compromise",
    ],
  },
  {
    id: "pii",
    promptTriggers: ["pii", "personal data", "regulated data", "sensitive data", "phi", "ssn"],
    keywords: [
      "ssn",
      "social security",
      "date of birth",
      "date_of_birth",
      "passport",
      "driver's license",
      "drivers license",
      "credit card",
      "card number",
      "cvv",
      "phi",
      "medical record",
      "diagnosis",
      "bank account",
      "routing number",
      "national id",
      "tax id",
    ],
  },
];

/** Dropped from the prompt before the token-ratio fallback. */
export const SEMANTIC_STOP_WORDS: string[] = [
  "a",
  "an",
  "the",
  "of",
  "in",
  "to",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "and",
  "or",
  "but",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "should",
  "would",
  "could",
  "will",
  "shall",
  "can",
  "may",
  "might",
  "must",
];

/**
 * Words too generic to carry intent on their own. If every prompt word that
 * matched is in this set, the token-ratio fallback does not fire.
 */
export const SEMANTIC_GENERIC_WORDS: string[] = [
  "read",
  "write",
  "file",
  "call",
  "run",
  "execute",
  "command",
  "tool",
  "show",
  "get",
  "list",
  "view",
  "open",
  "close",
  "input",
  "output",
  "data",
  "value",
];

/** Minimum share of prompt words that must appear for the fallback to match. */
export const SEMANTIC_MATCH_RATIO = 0.5;
