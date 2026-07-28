# @spctre/policy-schema

Shared types and logic for governed agent systems — the schema layer that
[Spctre](https://spctre.dev) and AGT-compatible enforcement runtimes use to
author, compose, evaluate, and prove policies.

This package is stack-neutral TypeScript. A small, performance-critical subset
(gateway/policy evaluation and operations-log integrity hashing) is backed by a
native Rust addon that loads lazily on first use.

## Install

```sh
npm install @spctre/policy-schema
```

## Usage

Types, policy packs, and the import/export and composition helpers are pure
TypeScript and work on any platform:

```ts
import { POLICY_PACKS, getPackVersion } from "@spctre/policy-schema/packs";
import type { PolicyPack } from "@spctre/policy-schema/types";

for (const pack of POLICY_PACKS) {
  console.log(pack.id, getPackVersion(pack));
}
```

```ts
import { evaluatePublishReadiness, buildPolicyBundleExport } from "@spctre/policy-schema";
```

### Native-backed functions

`evaluateGatewayDecision`, `evaluateRuntimePolicyDecision`,
`buildOperationsContentHash`, and `validateOperationsLogChain` call into the
native addon. They resolve the prebuilt binary the first time they are invoked;
importing the package never requires the addon.

```ts
import { evaluateGatewayDecision } from "@spctre/policy-schema";

const result = evaluateGatewayDecision(input); // loads the native addon on first call
```

## Platform support

Prebuilt binaries are published for:

- `darwin-arm64`, `darwin-x64`
- `linux-x64-gnu`, `linux-arm64-gnu`

On other platforms the pure-TypeScript surface still works; the native-backed
functions throw a clear error explaining how to build the addon from source:

```sh
pnpm --filter @spctre/policy-schema build:native
```

Building from source requires a Rust toolchain (see `native/rust-toolchain.toml`).

## License

Apache-2.0.
