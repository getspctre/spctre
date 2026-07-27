"use client";

export default function HelpDocsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: "2rem", fontFamily: "monospace" }}>
      <strong>Help-docs render error</strong>
      {process.env.NODE_ENV !== "production" ? (
        <pre style={{ whiteSpace: "pre-wrap", marginTop: "1rem" }}>
          {error.message}
          {"\n\n"}
          {error.stack}
        </pre>
      ) : (
        <p style={{ marginTop: "1rem" }}>
          {error.digest
            ? `Something went wrong. Error ID: ${error.digest}`
            : "Something went wrong."}
        </p>
      )}
      <button onClick={reset} style={{ marginTop: "1rem", cursor: "pointer" }}>
        Try again
      </button>
    </div>
  );
}
