import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import { source } from "@/lib/source";

export function SpctreDocsLayout({ children }: { children: ReactNode }) {
  return (
    <RootProvider>
      <DocsLayout
        tree={source.pageTree}
        githubUrl="https://github.com/getspctre/spctre"
        nav={{ title: "Spctre Docs" }}
        links={[
          {
            type: "main",
            text: "API reference",
            url: "https://app.spctre.dev/api-docs",
            external: true,
          },
          { type: "main", text: "Spctre site ↗", url: "https://spctre.dev", external: true },
        ]}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
