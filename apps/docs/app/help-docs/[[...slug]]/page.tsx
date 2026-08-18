// Compatibility paths for links in the shared in-app documentation corpus.
// New Pages navigation uses the cleaner root-relative routes.
import type { Metadata } from "next";
import {
  default as DocsPage,
  generateMetadata as generateDocsMetadata,
  generateStaticParams,
} from "../../[[...slug]]/page";

export default DocsPage;
export { generateStaticParams };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const metadata = await generateDocsMetadata({ params });
  const { slug } = await params;

  return {
    ...metadata,
    alternates: { ...metadata.alternates, canonical: `/${slug?.join("/") ?? ""}` },
  };
}
