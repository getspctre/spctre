import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function PacksRedirectPage() {
  await redirectToWorkspace("/packs");
  return null;
}
