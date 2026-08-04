import { source } from "@/lib/source";
import type { InferPageType } from "fumadocs-core/source";
import { findSiblings } from "fumadocs-core/page-tree";
import type { Item } from "fumadocs-core/page-tree";
import { DocsPage, DocsBody, DocsTitle, DocsDescription } from "fumadocs-ui/page";
import { Card, Cards } from "fumadocs-ui/components/card";
import { notFound } from "next/navigation";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { Callout } from "fumadocs-ui/components/callout";
import { Step, Steps } from "fumadocs-ui/components/steps";
import type { Metadata } from "next";

type Page = InferPageType<typeof source>;

const mdxComponents = { ...defaultMdxComponents, Callout, Step, Steps };

function DocsSectionIndex({ url }: { url: string }) {
  return (
    <Cards>
      {findSiblings(source.pageTree, url).flatMap((item) => {
        if (item.type === "separator") return [];

        if (item.type === "folder") {
          const landing = item.index ?? item.children.find((c): c is Item => c.type === "page");
          if (!landing) return [];
          return [
            <Card key={landing.url} title={item.name} href={landing.url} icon={item.icon}>
              {item.description ?? landing.description}
            </Card>,
          ];
        }

        return [
          <Card key={item.url} title={item.name} href={item.url} icon={item.icon}>
            {item.description}
          </Card>,
        ];
      })}
    </Cards>
  );
}

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = source.getPage(slug) as Page | undefined;
  if (!page) notFound();

  const { body: MDX, toc, lastModified } = page.data;
  const isIndex = page.slugs.length === 1;

  return (
    <DocsPage toc={toc} lastUpdate={lastModified}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <div data-docs-sep="" />
      {isIndex && <DocsSectionIndex url={page.url} />}
      <DocsBody>
        <MDX components={mdxComponents} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug) as Page | undefined;
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: { title: page.data.title, description: page.data.description, type: "article" },
  };
}
