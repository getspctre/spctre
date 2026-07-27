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
  enabled
}: WorkspaceCookieNormalizerProps) {
  const sentRef = useRef(false);

  useEffect(() => {
    if (!enabled || sentRef.current) return;
    sentRef.current = true;

    void fetch("/api/workspace/normalize", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ tenantId, workspaceId })
    }).catch(() => {
      // Ignore normalization failures and keep using the resolved fallback workspace.
    });
  }, [enabled, tenantId, workspaceId]);

  return null;
}
