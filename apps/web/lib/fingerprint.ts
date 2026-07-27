const ADJECTIVES = [
  "golden", "silver", "crimson", "azure", "obsidian", "amber", "jade", "coral",
  "iron", "slate", "ember", "storm", "swift", "silent", "bright", "dark",
  "frost", "fire", "cloud", "stone", "delta", "lunar", "solar", "cosmic",
  "arcane", "steady", "quiet", "sharp", "clean", "clear",
];

const NOUNS_A = [
  "eagle", "falcon", "hawk", "raven", "wolf", "bear", "fox", "lynx",
  "stag", "owl", "crane", "heron", "osprey", "cobra", "bison", "seal",
  "crow", "lark", "wren", "kite", "hart", "ibis", "viper", "finch",
  "robin", "swift", "merlin", "dingo", "otter", "marten",
];

const NOUNS_B = [
  "apollo", "atlas", "nexus", "sigma", "delta", "echo", "nova", "orion",
  "vega", "lyra", "sol", "zephyr", "titan", "ceres", "mars", "ares",
  "zeus", "hera", "pallas", "triton", "eos", "iris", "janus", "mira",
  "phoebe", "rhea", "tethys", "proteus", "ariel", "oberon",
];

/**
 * Converts a sha256 artifact hash to a memorable 3-word alias.
 * Deterministic: same hash always yields the same alias.
 * Suitable for referencing policy signatures in meetings and audits.
 */
export function hashToFingerprint(hash: string): string {
  const hex = hash.replace(/^sha256:/i, "").replace(/[^0-9a-f]/gi, "");
  if (!hex || hex.length < 12) return hash;
  const i1 = parseInt(hex.slice(0, 4), 16) % ADJECTIVES.length;
  const i2 = parseInt(hex.slice(4, 8), 16) % NOUNS_A.length;
  const i3 = parseInt(hex.slice(8, 12), 16) % NOUNS_B.length;
  return `${ADJECTIVES[i1]}-${NOUNS_A[i2]}-${NOUNS_B[i3]}`;
}
