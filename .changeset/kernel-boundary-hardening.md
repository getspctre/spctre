---
"@spctre/policy-schema": minor
---

Harden and widen the policy kernel boundary.

- A panic inside the kernel is contained and reported as
  `SPCTRE_POLICY_INTERNAL_ERROR` rather than unwinding into the host, where it
  would abort the host process. Callers already fail closed on any nonzero
  status.
- Layer composition is exposed on the N-API and C ABI transports, and
  `composePolicyLayers` delegates to it. Composition returns the winning layer
  and rule positions rather than composed rules, so rule fields the kernel does
  not model survive composition unchanged.
- New `validatePolicyRules` and `validatePolicyBundleLayers` report whether a
  bundle can be enforced at all: unsupported or mistyped constraint operators,
  unsupported action wildcards, missing or unknown effects, empty semantic
  prompts, duplicate rule IDs within a layer, unknown layer scopes, and layers
  ordered so that precedence would invert. Each of those otherwise produces a
  rule that silently never matches.
- New `policyKernelLimits` and `measurePolicyRequestBudget` report the kernel's
  own request bounds and how much of them a composed policy consumes, so hosts
  can check a policy against the real limits instead of restating them.
