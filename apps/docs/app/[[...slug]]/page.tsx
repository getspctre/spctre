import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { InferPageType } from "fumadocs-core/source";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import { Callout } from "fumadocs-ui/components/callout";
import { Step, Steps } from "fumadocs-ui/components/steps";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { SpctreDocsLayout } from "@/app/docs-layout";
import { source } from "@/lib/source";

type Page = InferPageType<typeof source>;
const mdxComponents = { ...defaultMdxComponents, Callout, Step, Steps };

function Home() {
  return (
    <section className="docs-home" aria-labelledby="home-title">
      <p className="eyebrow">Spctre documentation</p>
      <h1 id="home-title">Policy operations for governed agents.</h1>
      <p className="home-lede">
        Define, review, publish, simulate, and prove the policies that govern production agent
        actions.
      </p>
      <div className="quick-start" aria-label="Quick start command">
        <code>npm install -g @spctre/cli</code>
        <Link href="/developer/getting-started/quick-start">
          Read the quick start <ArrowRight size={16} />
        </Link>
      </div>
    </section>
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
        <DocsPage toc={toc}>
          <Home />
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
