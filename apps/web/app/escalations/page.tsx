import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function EscalationsRedirectPage() {
  await redirectToWorkspace("/escalations");
  return null;
}
