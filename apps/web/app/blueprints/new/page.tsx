import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function NewBlueprintRedirectPage() {
  await redirectToWorkspace("/blueprints/new");
  return null;
}
