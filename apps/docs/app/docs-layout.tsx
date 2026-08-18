import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { FullSearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import { GitFork } from "lucide-react";
import Link from "next/link";
import { source } from "@/lib/source";

const docsBasePath = process.env.GITHUB_ACTIONS === "true" ? "/spctre" : "";

export function SpctreDocsLayout({ children }: { children: ReactNode }) {
  return (
    <RootProvider search={{ options: { type: "static", api: `${docsBasePath}/api/search` } }}>
      <DocsLayout
        tree={source.pageTree}
        githubUrl="https://github.com/getspctre/spctre"
        nav={{
          title: "Spctre Docs",
          children: (
            <nav className="global-nav" aria-label="Primary">
              <div className="global-nav__links">
                <Link href="/ai-agents">AI Agents</Link>
                <Link href="/developer">Developer</Link>
                <Link href="/ui-guides">UI Guides</Link>
                <a href="https://app.spctre.dev/api-docs">API reference</a>
              </div>
              <div className="global-nav__utilities">
                <FullSearchTrigger className="global-search" />
                <ThemeSwitch mode="light-dark-system" />
                <a
                  className="global-github"
                  href="https://github.com/getspctre/spctre"
                  aria-label="Spctre on GitHub"
                >
                  <GitFork size={17} aria-hidden="true" />
                </a>
              </div>
            </nav>
          ),
        }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
