import { createMDX } from "fumadocs-mdx/next";

const isPagesBuild = process.env.GITHUB_ACTIONS === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  // This repository owns its agent guidance at the checkout root. Avoid
  // Next.js creating a second, version-managed AGENTS.md in this app.
  agentRules: false,
  basePath: isPagesBuild ? "/spctre" : "",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default createMDX()(nextConfig);
