# @spctre/api-contracts

The source of truth for the Spctre HTTP API: the OpenAPI 3.1 spec plus shared
envelope conventions and validation helpers used by clients.

Internal workspace package.

## Contents

- `src/openapi.ts` — the OpenAPI 3.1 specification, authored in TypeScript.
- `src/index.ts` — shared response-envelope and validation helpers.

## Regenerating downstream artifacts

The spec drives the generated `@spctre/sdk` types and the served
`/api/v1/openapi.json`. After editing `src/openapi.ts`, run from the repo root:

```bash
pnpm generate     # emits openapi.json and regenerates the SDK types
```

Do not hand-edit generated files — change the spec and regenerate.

## License

Apache-2.0.
