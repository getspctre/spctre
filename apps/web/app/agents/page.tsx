import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function AgentsRedirectPage() {
  await redirectToWorkspace("/agents");
  return null;
}
