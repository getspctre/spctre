import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BookOpen, Bot, Braces, Terminal } from "lucide-react";
import type { InferPageType } from "fumadocs-core/source";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import { Callout } from "fumadocs-ui/components/callout";
import { Step, Steps } from "fumadocs-ui/components/steps";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { SpctreDocsLayout } from "@/app/docs-layout";
import { source } from "@/lib/source";

type Page = InferPageType<typeof source>;
const mdxComponents = { ...defaultMdxComponents, Callout, Step, Steps };

const routes = [
  {
    title: "CLI",
    detail: "Initialize agents and manage local policy state.",
    href: "/developer/integrations/cli",
    icon: Terminal,
  },
  {
    title: "TypeScript SDK",
    detail: "Integrate policy decisions and evidence in Node.js.",
    href: "/developer/integrations/typescript-sdk",
    icon: Braces,
  },
  {
    title: "Python SDK",
    detail: "Connect governed workflows from Python services.",
    href: "/developer/integrations/python-sdk",
    icon: BookOpen,
  },
  {
    title: "MCP server",
    detail: "Bring policy operations into compatible agent tools.",
    href: "/developer/integrations/mcp-server",
    icon: Bot,
  },
];

function Home() {
  return (
    <main className="docs-home">
      <section className="home-hero" aria-labelledby="home-title">
        <div>
          <p className="eyebrow">Open-source policy operations</p>
          <h1 id="home-title">Policy operations for governed agents.</h1>
          <p className="home-lede">
            Define, review, publish, simulate, and prove the policies that govern production agent
            actions.
          </p>
          <div className="quick-start" aria-label="Quick start command">
            <div>
              <span>Quick start</span>
              <code>npm install -g @spctre/cli</code>
            </div>
            <Link href="/developer/getting-started/quick-start">
              Read the quick start <ArrowRight size={16} />
            </Link>
          </div>
        </div>
        <div
          className="policy-map"
          aria-label="Policy lifecycle: author, review, publish, evaluate, retain evidence"
        >
          <p>Policy lifecycle</p>
          {[
            ["01", "Author"],
            ["02", "Review"],
            ["03", "Publish"],
            ["04", "Evaluate"],
            ["05", "Prove"],
          ].map(([id, label]) => (
            <div key={id} className="policy-step">
              <span>{id}</span>
              <strong>{label}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="home-section" aria-labelledby="routes-title">
        <div className="section-intro">
          <p className="eyebrow">Choose an interface</p>
          <h2 id="routes-title">Start from your stack.</h2>
        </div>
        <div className="route-grid">
          {routes.map(({ title, detail, href, icon: Icon }) => (
            <Link key={title} href={href} className="route-link">
              <Icon size={20} aria-hidden="true" />
              <div>
                <h3>{title}</h3>
                <p>{detail}</p>
              </div>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = source.getPage(slug) as Page | undefined;
  if (!page) notFound();
  const { body: MDX, toc } = page.data;

  if (!slug?.length)
    return (
      <SpctreDocsLayout>
        <Home />
        <DocsPage toc={toc}>
          <DocsBody>
            <MDX components={mdxComponents} />
          </DocsBody>
        </DocsPage>
      </SpctreDocsLayout>
    );

  return (
    <SpctreDocsLayout>
      <DocsPage toc={toc}>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <MDX components={mdxComponents} />
        </DocsBody>
      </DocsPage>
    </SpctreDocsLayout>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!slug?.length) return { alternates: { canonical: "/" } };
  const page = source.getPage(slug) as Page | undefined;
  if (!page) notFound();
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: `/${slug.join("/")}` },
  };
}
