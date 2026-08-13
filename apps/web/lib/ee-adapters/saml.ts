// OSS slot adapter — resolved dynamically or replaced during commercial builds.
//
// SAML is an identity-federation integration a commercial deployment sells, and
// an OSS one has no IdP to federate with. The protocol work — AuthnRequest
// generation, assertion validation, InResponseTo replay defence — is all
// implementation, and none of it describes how the control plane behaves.
//
// This file previously worked by substitution: it declared that the commercial
// build would replace it wholesale, and until recently no build step ever did,
// so every image shipped the 404s below as if SAML were unconfigured. The slot
// loader is how every other commercial capability is reached, and it fails
// visibly rather than silently when the implementation is absent.
//
// The fallback answers 404 rather than 501: on a deployment with no SAML
// implementation these endpoints are not a capability being withheld, they are
// routes with nothing behind them.
import { logger } from "@spctre/platform/logging";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { loadCommercialSlot } from "./slot-loader";

export interface SamlSlot {
  authorizeGET(request: Request): Promise<Response>;
  callbackPOST(request: Request): Promise<Response>;
  metadataGET(): Promise<Response>;
}

function notConfigured(): Response {
  return Response.json({ error: "SAML is not configured." }, { status: 404 });
}

const fallbackSlot: SamlSlot = {
  async authorizeGET() {
    return notConfigured();
  },
  async callbackPOST() {
    return notConfigured();
  },
  async metadataGET() {
    return notConfigured();
  },
};

export async function loadSamlSlot(): Promise<SamlSlot> {
  if (getSpctrePlan() === "oss") return fallbackSlot;

  try {
    const module = await loadCommercialSlot<{ samlService: SamlSlot }>("web/saml/index.js");
    return module.samlService;
  } catch (err) {
    // Failing closed refuses the sign-in rather than completing one on terms no
    // implementation applied. An assertion this deployment cannot validate must
    // never become a session.
    logger.error("Failed to load the commercial SAML slot; SSO endpoints will answer 404.", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallbackSlot;
  }
}

export async function samlAuthorizeGET(request: Request): Promise<Response> {
  return (await loadSamlSlot()).authorizeGET(request);
}

export async function samlCallbackPOST(request: Request): Promise<Response> {
  return (await loadSamlSlot()).callbackPOST(request);
}

export async function samlMetadataGET(): Promise<Response> {
  return (await loadSamlSlot()).metadataGET();
}
