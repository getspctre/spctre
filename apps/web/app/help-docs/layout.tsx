import "fumadocs-ui/style.css";
import "./docs.css";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { source } from "@/lib/source";

export default async function HelpDocsLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <RootProvider theme={{ nonce }}>
      <DocsLayout
        tree={source.pageTree}
        tabs={{}}
        githubUrl="https://github.com/spctre/spctre"
        containerProps={{ className: "spctre-docs-layout" }}
        nav={{ title: "Spctre Help Docs" }}
        links={[{ type: "main", text: "API Reference", url: "/api-docs", external: true }]}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
