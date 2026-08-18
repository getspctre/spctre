"use client";

import Link from "next/link";
import { ChevronDown, FilePlus2, FileText, UploadCloud } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPolicyBranch, importPolicy } from "./policy/actions";
import type { CreatePolicyBranchState, ImportState } from "./policy/actions";
import { ENVIRONMENT_DECLARATIONS } from "@/lib/policy-targets";
import { buildWorkspacePath } from "@/lib/workspace/path";

const RUNTIME_STACKS = [
  { value: "AWS_BEDROCK", label: "AWS Bedrock" },
  { value: "GOOGLE_ADK", label: "Google ADK" },
  { value: "AZURE_AI", label: "Azure AI" },
  { value: "LANGCHAIN", label: "LangChain" },
  { value: "LANGGRAPH", label: "LangGraph" },
  { value: "CREWAI", label: "CrewAI" },
  { value: "AUTOGEN", label: "AutoGen" },
  { value: "OPENAI_AGENTS", label: "OpenAI Agents" },
  { value: "OMNIGENT", label: "Omnigent" },
  { value: "OPENCODE", label: "OpenCode" },
  { value: "CLAUDE_CODE", label: "Claude Code" },
  { value: "LOCAL", label: "Local" },
  { value: "CUSTOM", label: "Custom" },
];

const PLACEHOLDER_YAML = `name: my-policy
owner: platform
rules:
  - stable_rule_id: example.rule.id
    title: Example rule title
    effect: DENY
    domains: [finance]
    connectors: [stripe]
    actions: [refund.create]
    immutable: true
`;

interface ImportFormProps {
  workspaceId: string;
  workspaceSlug: string;
  initialScope?: "WORKSPACE" | "ORGANIZATION" | "ENVIRONMENT" | "CONNECTOR";
  initialEnvironment?: string;
}

type CreationMode = "guided" | "import";
type PolicyScope = "WORKSPACE" | "ORGANIZATION" | "ENVIRONMENT" | "CONNECTOR";

function AdvancedScopeFields({
  scope,
  setScope,
  initialEnvironment,
}: {
  scope: PolicyScope;
  setScope: (value: PolicyScope) => void;
  initialEnvironment?: string;
}) {
  return (
    <>
      <label className="meta" htmlFor="scope">
        Scope
      </label>
      <select
        className="input"
        id="scope"
        name="scope"
        value={scope}
        onChange={(event) => setScope(event.target.value as PolicyScope)}
      >
        <option value="WORKSPACE">Workspace — applies to this workspace only</option>
        <option value="ORGANIZATION">Organization — applies across all workspaces</option>
        <option value="ENVIRONMENT">Environment — scoped to a specific deploy environment</option>
        <option value="CONNECTOR">Connector — scoped to a specific runtime connector</option>
      </select>

      {scope === "ENVIRONMENT" ? (
        <>
          <label className="meta" htmlFor="environment">
            Environment
          </label>
          <select
            className="input"
            id="environment"
            name="environment"
            defaultValue={initialEnvironment ?? "production"}
          >
            {ENVIRONMENT_DECLARATIONS.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.label}
              </option>
            ))}
          </select>
        </>
      ) : null}

      {scope === "CONNECTOR" ? (
        <>
          <label className="meta" htmlFor="connector">
            Connector
          </label>
          <input
            className="input"
            id="connector"
            name="connector"
            type="text"
            placeholder="stripe"
            required
          />
        </>
      ) : null}

      <span className="meta">Runtime targets</span>
      <div className="checkboxGroup">
        {RUNTIME_STACKS.map((stack) => (
          <label key={stack.value} className="checkboxLabel">
            <input type="checkbox" name="targetStack" value={stack.value} />
            {stack.label}
          </label>
        ))}
      </div>
    </>
  );
}

function ImportResultView({
  result,
  workspaceSlug,
}: {
  result: NonNullable<NonNullable<ImportState>["result"]>;
  workspaceSlug: string;
}) {
  return (
    <>
      <div className="importLayout">
        <div className="importCard">
          <FileText size={18} />
          <div>
            <span className="meta">Revision</span>
            <strong>{result.revisionId}</strong>
          </div>
          <div>
            <span className="meta">Hash</span>
            <strong>{result.sourceHash}</strong>
          </div>
          <div>
            <span className="meta">Rules</span>
            <strong>{result.rules.length}</strong>
          </div>
        </div>

        <div className="importMeta">
          <p className="meta">
            {result.sourceFormat} / {result.author} /{" "}
            {(result.importedAt ?? "pending").slice(0, 10)}
          </p>
          {result.translation ? (
            <p className="meta">
              Native conversion: {result.translation.status.toLowerCase()} (translator v
              {result.translation.translatorVersion})
            </p>
          ) : null}
          <p className="meta">
            Branch <code>{result.branchId}</code> now points at <code>{result.revisionId}</code>
          </p>
          <p className="meta">
            <Link href={buildWorkspacePath(workspaceSlug, `/review?branch=${result.branchId}`)}>
              Review this branch
            </Link>
          </p>
          {result.warnings.map((w) => (
            <p className="meta" key={w}>
              {w}
            </p>
          ))}
        </div>
      </div>

      {result.rules.length > 0 ? (
        <div className="exportRules">
          {result.rules.map((rule, i) => (
            <span className="ruleRef" key={`${rule.stableRuleId}-${i}`}>
              {rule.stableRuleId}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function ImportSourceFields() {
  return (
    <div className="importFormSource">
      <label className="meta" htmlFor="sourceFile">
        Policy file
      </label>
      <input
        className="input"
        id="sourceFile"
        name="sourceFile"
        type="file"
        accept=".yaml,.yml,.json,.rego,.cedar,application/json,application/yaml,text/yaml,text/plain"
      />

      <label className="meta" htmlFor="sourceFormat">
        Source format
      </label>
      <select className="input" id="sourceFormat" name="sourceFormat" defaultValue="">
        <option value="">Auto-detect from file or content</option>
        <option value="AGT_YAML">AGT YAML / JSON</option>
        <option value="OPA_REGO">OPA Rego (supported subset)</option>
        <option value="CEDAR">Cedar (supported subset)</option>
      </select>

      <label className="checkboxLabel">
        <input type="checkbox" name="acceptLossy" />
        I accept any reported lossy conversion for this draft.
      </label>

      <label className="meta" htmlFor="source">
        Or paste policy source
      </label>
      <textarea
        className="input codearea"
        id="source"
        name="source"
        rows={10}
        placeholder={PLACEHOLDER_YAML}
      />
    </div>
  );
}

export function ImportForm({
  workspaceId,
  workspaceSlug,
  initialScope = "WORKSPACE",
  initialEnvironment,
}: ImportFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ImportState, FormData>(importPolicy, null);
  const [createState, createAction, creating] = useActionState<CreatePolicyBranchState, FormData>(
    createPolicyBranch,
    null,
  );
  const [scope, setScope] = useState(initialScope);
  const [creationMode, setCreationMode] = useState<CreationMode>("guided");
  const [showAdvanced, setShowAdvanced] = useState(initialScope !== "WORKSPACE");

  useEffect(() => {
    if (createState?.branchId) {
      router.push(buildWorkspacePath(workspaceSlug, `/author?branch=${createState.branchId}`));
    }
  }, [createState?.branchId, router, workspaceSlug]);

  return (
    <>
      <form action={creationMode === "guided" ? createAction : formAction}>
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <div className="importFormGrid">
          <div className="importFormFields">
            <label className="meta" htmlFor="branchName">
              Branch name
            </label>
            <input
              className="input"
              id="branchName"
              name="branchName"
              type="text"
              placeholder="e.g. stripe/refund-limits"
              required
            />

            {creationMode === "guided" ? (
              <>
                <label className="meta" htmlFor="purpose">
                  Policy purpose
                </label>
                <textarea
                  className="input"
                  id="purpose"
                  name="purpose"
                  rows={3}
                  placeholder="e.g. Require escalation before production refund actions."
                  required
                />
              </>
            ) : null}

            <span className="meta">How do you want to start?</span>
            <div className="policySourceChoice" role="radiogroup" aria-label="Policy source">
              <button
                className={`policySourceOption${creationMode === "guided" ? " policySourceOptionSelected" : ""}`}
                type="button"
                role="radio"
                aria-checked={creationMode === "guided"}
                onClick={() => setCreationMode("guided")}
              >
                <span>Start with rules</span>
                <small>Create an empty draft, then add rules in the guided authoring flow.</small>
              </button>
              <button
                className={`policySourceOption${creationMode === "import" ? " policySourceOptionSelected" : ""}`}
                type="button"
                role="radio"
                aria-checked={creationMode === "import"}
                onClick={() => setCreationMode("import")}
              >
                <span>Upload or paste existing</span>
                <small>Bring in an existing YAML or JSON policy.</small>
              </button>
            </div>

            <button
              className="advancedOptionsToggle"
              type="button"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((current) => !current)}
            >
              <ChevronDown
                size={14}
                aria-hidden
                className={showAdvanced ? "advancedOptionsChevronOpen" : undefined}
              />
              {showAdvanced ? "Hide advanced options" : "Advanced options"}
            </button>

            {showAdvanced ? (
              <AdvancedScopeFields
                scope={scope}
                setScope={setScope}
                initialEnvironment={initialEnvironment}
              />
            ) : (
              <input type="hidden" name="scope" value="WORKSPACE" />
            )}
          </div>

          {creationMode === "guided" ? (
            <div className="importFormSource policyDraftSummary">
              <span className="eyebrow">Draft policy</span>
              <h3>Set the policy context first</h3>
              <p className="meta">
                Record the purpose, then create an empty branch with the scope and targets above.
                You&apos;ll add and test the first rule next, before anything can affect agents.
              </p>
            </div>
          ) : (
            <ImportSourceFields />
          )}
        </div>

        <div className="importFormFooter">
          <button
            className="button buttonPrimary"
            type="submit"
            disabled={creationMode === "guided" ? creating : pending}
          >
            {creationMode === "guided" ? <FilePlus2 size={16} /> : <UploadCloud size={16} />}
            {creationMode === "guided"
              ? creating
                ? "Creating draft…"
                : "Create draft and add rules"
              : pending
                ? "Importing…"
                : "Import policy"}
          </button>
        </div>
      </form>

      {createState?.error && creationMode === "guided" ? (
        <div className="importError">
          <p className="meta">{createState.error}</p>
        </div>
      ) : null}

      {state?.error && creationMode === "import" ? (
        <div className="importError">
          <p className="meta">{state.error}</p>
        </div>
      ) : null}

      {state?.result && creationMode === "import" ? (
        <ImportResultView result={state.result} workspaceSlug={workspaceSlug} />
      ) : null}
    </>
  );
}
