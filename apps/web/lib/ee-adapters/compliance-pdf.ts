import { logger } from "@spctre/platform/logging";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { isFeatureEnabledForPlan } from "@/lib/feature-flags";
import { loadCommercialSlot } from "./slot-loader";

export async function handleCompliancePdfExport(
  request: Request,
  exportDoc: unknown,
): Promise<Response> {
  const plan = getSpctrePlan();
  if (!isFeatureEnabledForPlan("compliancePdfExport", plan)) {
    return Response.json(
      { error: "Compliance PDF export requires a Business or Enterprise plan." },
      { status: 402 },
    );
  }

  try {
    const module = await loadCommercialSlot<{ handlePdfExport: typeof handleCompliancePdfExport }>(
      "web/compliance/pdf-export.js",
    );
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
