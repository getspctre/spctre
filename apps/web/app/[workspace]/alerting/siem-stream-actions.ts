"use server";

import { revalidatePath } from "next/cache";
import {
  addSiemStreamDecision,
  removeSiemStreamDecision,
  toggleSiemStreamDecision,
} from "@/lib/domains/siem-stream/service";

export async function addSiemStreamAction(
  workspaceId: string,
  workspaceSlug: string,
  name: string,
  type: "SPLUNK_HEC" | "SENTINEL",
  url: string,
  config: Record<string, unknown>,
  credentials: Record<string, unknown>,
) {
  const stream = await addSiemStreamDecision({ workspaceId, name, type, url, config, credentials });
  revalidatePath(`/${workspaceSlug}/siem-export`);
  return stream;
}

export async function removeSiemStreamAction(
  workspaceId: string,
  workspaceSlug: string,
  id: string,
) {
  const success = await removeSiemStreamDecision({ workspaceId, id });
  revalidatePath(`/${workspaceSlug}/siem-export`);
  return success;
}

export async function toggleSiemStreamAction(
  workspaceId: string,
  workspaceSlug: string,
  id: string,
  enabled: boolean,
) {
  const success = await toggleSiemStreamDecision({ workspaceId, id, enabled });
  revalidatePath(`/${workspaceSlug}/siem-export`);
  return success;
}
