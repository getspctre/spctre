import type { Metadata } from "next";
import type { ReactNode } from "react";
import "fumadocs-ui/style.css";
import "./docs.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://getspctre.github.io/spctre/"),
  title: { default: "Spctre Docs", template: "%s | Spctre Docs" },
  description: "Documentation for the Spctre policy operations control plane.",
  openGraph: {
    type: "website",
    title: "Spctre Docs",
    description: "Policy operations for governed agents.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
