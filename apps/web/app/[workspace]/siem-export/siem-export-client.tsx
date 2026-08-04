"use client";

import { useState } from "react";
import type { SiemStream } from "@/lib/domains/siem-stream/service";
import type { SharedHandlerContext } from "../alerting/alerting-shared";
import { SiemStreamsSection, SiemStreamModal, useSiemHandlers } from "../alerting/alerting-siem";

export function SiemExportClient({
  workspaceId,
  workspaceSlug,
  streams,
}: {
  workspaceId: string;
  workspaceSlug: string;
  streams: SiemStream[];
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctx: SharedHandlerContext = { workspaceId, workspaceSlug, setError, setLoading };
  const siem = useSiemHandlers(ctx);
  return (
    <div className="alertingContainer">
      <SiemStreamsSection
        siemStreams={streams}
        status={siem.status}
        error={error && siem.modalOpen ? error : null}
        deletingId={siem.deletingId}
        togglingId={siem.togglingId}
        onAdd={() => {
          setError(null);
          siem.setModalOpen(true);
        }}
        onRemove={siem.handleRemove}
        onToggle={siem.handleToggle}
      />
      {siem.modalOpen ? (
        <SiemStreamModal
          form={siem.form}
          update={siem.updateForm}
          error={error}
          loading={loading}
          onSubmit={siem.handleAdd}
          onClose={() => siem.setModalOpen(false)}
        />
      ) : null}
    </div>
  );
}
