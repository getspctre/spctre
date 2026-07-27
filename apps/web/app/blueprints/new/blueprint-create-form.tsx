"use client";

import { ArrowLeft, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

const RUNTIME_STACKS = ["OPENAI_AGENTS", "AWS_BEDROCK", "GOOGLE_ADK", "AZURE_AI", "LANGCHAIN", "LANGGRAPH", "CREWAI", "AUTOGEN", "CUSTOM", "LOCAL"];
const ENVIRONMENTS = ["production", "staging", "development", "incident-mode"];

const list = (value: string) => value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);

function ChipInput({ label, name, placeholder, suggestions = [] }: { label: string; name: string; placeholder: string; suggestions?: string[] }) {
  const [values, setValues] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const listId = `${name}-suggestions`;
  const add = (value: string) => {
    const next = value.trim();
    if (next && !values.some((item) => item.toLowerCase() === next.toLowerCase())) setValues((current) => [...current, next]);
    setInput("");
  };
  const custom = (value: string) => !suggestions.some((suggestion) => suggestion.toLowerCase() === value.toLowerCase());

  return <div className="field blueprintChipField">
    <span>{label}</span>
    <div className="blueprintChipControl">
      {values.length ? <div className="blueprintChipList">{values.map((value) => <span className={`blueprintChip${custom(value) ? " blueprintChipCustom" : ""}`} key={value}>{value}<button aria-label={`Remove ${value}`} onClick={() => setValues((current) => current.filter((item) => item !== value))} type="button"><X size={13} /></button></span>)}</div> : null}
      <input
        aria-label={`Add ${label.toLowerCase()}`}
        className="blueprintChipInput"
        list={suggestions.length ? listId : undefined}
        onBlur={() => input.trim() && add(input)}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(input); }
          if (event.key === "Backspace" && !input && values.length) setValues((current) => current.slice(0, -1));
        }}
        placeholder={values.length ? "Add another value" : placeholder}
        value={input}
      />
    </div>
    {suggestions.length ? <datalist id={listId}>{suggestions.filter((suggestion) => !values.includes(suggestion)).map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist> : null}
    {values.map((value) => <input key={value} name={name} type="hidden" value={value} />)}
  </div>;
}

export function BlueprintCreateForm({ blueprintsPath, connectorSuggestions, toolSuggestions, workspaceName }: { blueprintsPath: string; connectorSuggestions: string[]; toolSuggestions: string[]; workspaceName: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const number = (key: string) => {
      const value = String(data.get(key) ?? "").trim();
      return value ? Number(value) : undefined;
    };
    const budgets = Object.fromEntries(Object.entries({
      maxTokensPerTurn: number("maxTokensPerTurn"),
      maxCostUsdPerSession: number("maxCostUsdPerSession"),
      maxToolCallsPerSession: number("maxToolCallsPerSession"),
    }).filter(([, value]) => value !== undefined));
    const payload = {
      name: String(data.get("name") ?? "").trim(),
      agentId: String(data.get("agentId") ?? "").trim(),
      message: String(data.get("message") ?? "").trim() || "Initial blueprint revision",
      definition: {
        purpose: String(data.get("purpose") ?? "").trim(),
        allowedTaskClasses: data.getAll("allowedTaskClasses").map(String),
        tools: data.getAll("tools").map(String),
        connectors: data.getAll("connectors").map(String),
        services: data.getAll("services").map(String),
        environments: data.getAll("environments").map(String),
        runtimeTargets: [{
          stack: String(data.get("runtimeStack") ?? ""),
          environment: String(data.get("runtimeEnvironment") ?? ""),
          ...(String(data.get("adapter") ?? "").trim() ? { adapter: String(data.get("adapter")).trim() } : {}),
        }],
        ...(Object.keys(budgets).length ? { budgets } : {}),
        ...(list(String(data.get("approvalPath") ?? "")).length ? { approvalPath: list(String(data.get("approvalPath") ?? "")) } : {}),
        ...(String(data.get("policyBranchId") ?? "").trim() ? { policyBranchId: String(data.get("policyBranchId")).trim() } : {}),
        ...(String(data.get("policyRevisionId") ?? "").trim() ? { policyRevisionId: String(data.get("policyRevisionId")).trim() } : {}),
      },
    };

    setPending(true);
    try {
      const response = await fetch("/api/agent-blueprints", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Blueprint could not be created.");
      router.push(blueprintsPath);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Blueprint could not be created.");
    } finally {
      setPending(false);
    }
  }

  return <form className="blueprintCreateForm" onSubmit={submit}>
    <section className="panel blueprintCreatePanel">
      <div className="rowHeader"><div><p className="eyebrow">Identity</p><h2>Describe the governed agent</h2><p className="meta">This draft defines the agent’s permitted operating envelope for {workspaceName}.</p></div></div>
      <div className="blueprintFormGrid">
        <label className="field"><span>Blueprint name</span><input className="input" name="name" placeholder="Refund support agent" required /></label>
        <label className="field"><span>Agent ID</span><input className="input" name="agentId" placeholder="support-refunds" required /></label>
        <label className="field blueprintFormWide"><span>Purpose</span><textarea className="input" name="purpose" rows={3} placeholder="Resolve customer refund requests within the approved support workflow." required /></label>
        <label className="field blueprintFormWide"><span>Revision note</span><input className="input" name="message" placeholder="Initial support operating envelope" /></label>
      </div>
    </section>

    <section className="panel blueprintCreatePanel">
      <div className="rowHeader"><div><p className="eyebrow">Operating envelope</p><h2>Declare permitted surfaces</h2><p className="meta">Select a catalog value or enter a deliberate custom declaration. Only declared connectors and tools may run after publication.</p></div></div>
      <div className="blueprintFormGrid">
        <ChipInput label="Task classes" name="allowedTaskClasses" placeholder="refund-review" />
        <ChipInput label="Tools" name="tools" placeholder="Search known actions" suggestions={toolSuggestions} />
        <ChipInput label="Connectors" name="connectors" placeholder="Search connector catalog" suggestions={connectorSuggestions} />
        <ChipInput label="Services" name="services" placeholder="support-api" />
        <fieldset className="blueprintEnvironmentField blueprintFormWide"><legend>Environments</legend><div className="checkboxGroup">{ENVIRONMENTS.map((environment) => <label className="checkboxLabel" key={environment}><input name="environments" type="checkbox" value={environment} defaultChecked={environment === "production"} />{environment}</label>)}</div></fieldset>
      </div>
    </section>

    <section className="panel blueprintCreatePanel">
      <div className="rowHeader"><div><p className="eyebrow">Runtime and review</p><h2>Bind execution and evidence</h2><p className="meta">The draft starts unapproved. A linked policy revision is enforced only once both policy and Blueprint are publishable.</p></div></div>
      <div className="blueprintFormGrid">
        <label className="field"><span>Runtime stack</span><select className="input" name="runtimeStack" defaultValue="OPENAI_AGENTS">{RUNTIME_STACKS.map((stack) => <option key={stack} value={stack}>{stack.replaceAll("_", " ")}</option>)}</select></label>
        <label className="field"><span>Runtime environment</span><select className="input" name="runtimeEnvironment" defaultValue="production">{ENVIRONMENTS.map((environment) => <option key={environment} value={environment}>{environment}</option>)}</select></label>
        <label className="field"><span>Adapter, optional</span><input className="input" name="adapter" placeholder="gateway-v2" /></label>
        <label className="field"><span>Approval path, optional</span><input className="input" name="approvalPath" placeholder="Support, Finance" /></label>
        <label className="field"><span>Policy branch ID, optional</span><input className="input" name="policyBranchId" placeholder="branch_…" /></label>
        <label className="field"><span>Policy revision ID, optional</span><input className="input" name="policyRevisionId" placeholder="revision_…" /></label>
      </div>
      <div className="blueprintBudgetGrid" aria-label="Optional session budgets">
        <label className="field"><span>Max tokens per turn</span><input className="input" min="0" name="maxTokensPerTurn" placeholder="4000" type="number" /></label>
        <label className="field"><span>Max session cost, USD</span><input className="input" min="0" name="maxCostUsdPerSession" placeholder="2" step="0.01" type="number" /></label>
        <label className="field"><span>Max tool calls per session</span><input className="input" min="0" name="maxToolCallsPerSession" placeholder="12" type="number" /></label>
      </div>
    </section>

    {error ? <p className="blueprintCreateError" role="alert">{error}</p> : null}
    <div className="blueprintCreateActions"><Link className="button" href={blueprintsPath}><ArrowLeft size={16} />Cancel</Link><button className="button buttonPrimary" disabled={pending} type="submit"><Plus size={16} />{pending ? "Creating draft…" : "Create draft"}</button></div>
  </form>;
}
