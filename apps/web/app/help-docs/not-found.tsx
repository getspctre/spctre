import Link from "next/link";

export default function HelpDocsNotFound() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: "12px",
        textAlign: "center",
        padding: "40px 24px",
      }}
    >
      <p style={{ fontSize: "14px", color: "var(--color-fd-muted-foreground)" }}>
        404
      </p>
      <h1 style={{ fontSize: "24px", fontWeight: 600, margin: 0 }}>Page not found</h1>
      <p style={{ color: "var(--color-fd-muted-foreground)", margin: 0 }}>
        This page doesn&apos;t exist in the help docs.
      </p>
      <Link
        href="/help-docs"
        style={{
          marginTop: "8px",
          fontSize: "14px",
          color: "var(--color-fd-primary)",
          textDecoration: "underline",
        }}
      >
        Back to Help Docs
      </Link>
    </div>
  );
}
