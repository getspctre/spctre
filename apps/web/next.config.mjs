import path from "path";
import { fileURLToPath } from "url";
import { createMDX } from "fumadocs-mdx/next";
import createNextIntlPlugin from "next-intl/plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "192.168.0.216"],
  transpilePackages: ["@spctre/api-contracts", "@spctre/platform"],
  // js-yaml ships both CJS (index.js) and ESM (dist/js-yaml.mjs). Turbopack
  // sometimes resolves to the CJS version and calls require() in a context where
  // it isn't defined. Marking it as a server external lets Node's native module
  // loader handle it, where require() is always available.
  //
  // The OpenTelemetry SDK 3.0 line ships rolldown-built ESM that loads its own
  // dependencies through createRequire(import.meta.url). Inlined into a server
  // chunk, import.meta.url still names the package's build-time path, which
  // does not exist in the image, so every request 500s on MODULE_NOT_FOUND
  // (forwarded-parse first). As externals they load from node_modules, where
  // the tracer copies each package with its dependencies — except the ones
  // reached through createRequire, which outputFileTracingIncludes adds below.
  serverExternalPackages: [
    "js-yaml",
    "@opentelemetry/auto-instrumentations-node",
    "@opentelemetry/exporter-metrics-otlp-http",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/resources",
    "@opentelemetry/sdk-metrics",
    "@opentelemetry/sdk-node",
  ],
  // Next 16.3.1's standalone tracer copies @swc/helpers/cjs but not esm/, while
  // its own require-hook loads esm/_interop_require_default.js at startup. The
  // built image therefore dies with MODULE_NOT_FOUND before serving anything.
  //
  // Nothing in CI catches this: `next build` succeeds, the image builds, and the
  // failure only appears when the container runs. Force the directory into the
  // trace until the tracer resolves the package's exports map correctly.
  //
  // The tracer cannot follow createRequire either, so the OpenTelemetry
  // packages' runtime require() targets are listed by hand: each package, and
  // the link in the requiring package's own node_modules that pnpm resolves it
  // through. @grpc/grpc-js is the third such target and is already traced.
  outputFileTracingIncludes: {
    "**": [
      "../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/esm/**",
      "../../node_modules/.pnpm/forwarded-parse@*/node_modules/forwarded-parse/**",
      "../../node_modules/.pnpm/@opentelemetry+instrumentation-http@*/node_modules/forwarded-parse",
      "../../node_modules/.pnpm/@opentelemetry+winston-transport@*/node_modules/@opentelemetry/winston-transport/**",
      "../../node_modules/.pnpm/@opentelemetry+instrumentation-winston@*/node_modules/@opentelemetry/winston-transport",
    ],
  },
  env: {
    // Absolute path to the native Rust addon directory. next.config.mjs runs on
    // the real filesystem (not bundled), so __dirname is the true path. Turbopack
    // inlines this value into the bundle, letting require() use an absolute path
    // instead of a relative one that breaks from inside .next/dev/server/chunks/.
    SPCTRE_NATIVE_PATH: path.resolve(__dirname, "../../packages/policy-schema/native"),
  },
  async redirects() {
    return [{ source: "/favicon.ico", destination: "/icon.svg", permanent: true }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // CSP is set dynamically in proxy.ts middleware with a per-request nonce,
          // which eliminates 'unsafe-eval' in production and 'unsafe-inline' entirely.
        ],
      },
    ];
  },
};

const withMDX = createMDX();
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(withMDX(nextConfig));
