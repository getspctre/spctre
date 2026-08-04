import { getWorkspaceContext } from "@/lib/workspace";
import { formatWorkspaceEyebrow } from "@/lib/workspace";
import { buildWorkspacePath } from "@/lib/workspace/path";
import { POLICY_PACKS } from "@spctre/policy-schema";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { BlueprintCreateForm } from "../../../blueprints/new/blueprint-create-form";

export default async function NewWorkspaceBlueprintPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: workspaceSlug } = await params;
  const workspace = await getWorkspaceContext({ workspaceSlug });
  const blueprintsPath = buildWorkspacePath(workspace.workspaceSlug, "/blueprints");
  const connectorSuggestions = Array.from(
    new Set(POLICY_PACKS.map((pack) => pack.connector)),
  ).sort();
  const toolSuggestions = Array.from(
    new Set(
      POLICY_PACKS.flatMap((pack) =>
        pack.rules.flatMap((rule) => rule.actions.map((action) => `${pack.connector}.${action}`)),
      ),
    ),
  ).sort();
  return (
    <>
      <section className="topbar">
        <div>
          <p className="eyebrow">{formatWorkspaceEyebrow(workspace)}</p>
          <h1>New Blueprint</h1>
        </div>
        <Link className="button" href={blueprintsPath}>
          <ArrowLeft size={16} />
          Back to Blueprints
        </Link>
      </section>
      <BlueprintCreateForm
        blueprintsPath={blueprintsPath}
        connectorSuggestions={connectorSuggestions}
        toolSuggestions={toolSuggestions}
        workspaceName={workspace.workspaceName}
      />
    </>
  );
}
