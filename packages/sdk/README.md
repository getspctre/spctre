# @spctre/sdk

Official TypeScript SDK for the [Spctre](https://spctre.dev) API. A thin,
fully-typed [openapi-fetch](https://openapi-ts.dev/openapi-fetch/) client
generated from the Spctre OpenAPI 3.1 contract.

## Install

```sh
npm install @spctre/sdk
```

## Usage

```ts
import { createSpctreClient } from "@spctre/sdk";

const spctre = createSpctreClient({
  baseUrl: "https://app.spctre.dev/api/v1",
  token: process.env.SPCTRE_API_KEY!,
});

const { data, error } = await spctre.GET("/policies");
if (error) throw error;
console.log(data);
```

`createSpctreClient` returns an `openapi-fetch` client with `GET`/`POST`/`PUT`/
`PATCH`/`DELETE` methods that are fully typed against the API schema. Request
paths, params, bodies, and responses are all inferred.

### Options

| Option | Description |
|---|---|
| `token` | Service account API key (required). |
| `baseUrl` | Base URL of the Spctre instance. Defaults to the current origin's `/api/v1`. |
| `fetch` | Custom `fetch` implementation (optional). |

### Types

The generated `paths`, `components`, and `operations` types are re-exported for
building your own typed requests:

```ts
import type { paths, components } from "@spctre/sdk";
```

## License

Apache-2.0.
