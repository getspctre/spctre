import { logger } from "@spctre/platform/logging";
import { isFeatureEntitled } from "@/lib/entitlements/features";
import { loadCommercialSlot } from "./slot-loader";

export async function handleCompliancePdfExport(
  request: Request,
  exportDoc: unknown,
  tenantId: string,
): Promise<Response> {
  if (!(await isFeatureEntitled("compliancePdfExport", tenantId))) {
    return Response.json(
      { error: "Compliance PDF export requires a Business or Enterprise plan." },
      { status: 402 },
    );
  }

  try {
    const module = await loadCommercialSlot<{
      handlePdfExport: (request: Request, exportDoc: unknown) => Promise<Response>;
    }>("web/compliance/pdf-export.js");
    return module.handlePdfExport(request, exportDoc);
  } catch (err) {
    logger.warn("Failed to load commercial Compliance PDF export slot implementation.", {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json(
      { error: "Compliance PDF export is not available in this build." },
      { status: 501 },
    );
  }
}
