"use client";

export function AdminMutationStatus({
  error,
  message,
}: {
  error?: string;
  message?: string;
}) {
  if (error) return <p className="meta workspaceError">{error}</p>;
  if (message) return <p className="meta adminMutationSuccess">{message}</p>;
  return null;
}
