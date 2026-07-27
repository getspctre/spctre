import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function BlueprintsRedirectPage() {
  await redirectToWorkspace("/blueprints");
  return null;
}
