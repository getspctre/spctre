"use client";

import { useEffect, useRef } from "react";
import { swallow } from "@/lib/platform/swallow";

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
    }).catch(swallow("fetch", undefined));
  }, [enabled, tenantId, workspaceId]);

  return null;
}
