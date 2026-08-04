"use client";

import { useEffect, useRef } from "react";

interface WorkspaceCookieNormalizerProps {
  tenantId: string;
  workspaceId: string;
  enabled: boolean;
}

export function WorkspaceCookieNormalizer({
  tenantId,
  workspaceId,
  enabled,
}: WorkspaceCookieNormalizerProps) {
  const sentRef = useRef(false);

  useEffect(() => {
    if (!enabled || sentRef.current) return;
    sentRef.current = true;

    void fetch("/api/workspace/normalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, workspaceId }),
    }).catch(() => {
      // Keep using the resolved fallback workspace; this browser-only normalization is retried on navigation.
    });
  }, [enabled, tenantId, workspaceId]);

  return null;
}
