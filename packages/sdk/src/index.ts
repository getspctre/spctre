export { createSpctreClient } from "./client.js";
export type { SpctreClient, SpctreClientOptions } from "./client.js";
export type { paths, components, operations } from "./schema.js";
export {
  publicationContentHash,
  retainPublicationContentArtifact,
  signPublicationFacts,
  submitPublicationAttestation,
} from "./publication-attestations.js";
