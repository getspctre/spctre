"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ConfirmSubmitButton } from "../confirm-submit-button";
import { AdminMutationStatus } from "../mutation-status";
import {
  grantGovernedMcpTool,
  registerGovernedMcpTool,
  revokeGovernedMcpGrant,
  type GovernedMcpActionState,
} from "./actions";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="button buttonPrimary" type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export function RegisterToolForm({ connectorSuggestions }: { connectorSuggestions: string[] }) {
  const [state, action] = useActionState<GovernedMcpActionState, FormData>(
    registerGovernedMcpTool,
    null,
  );

  return (
    <form action={action} className="adminAuthForm">
      <div className="formGrid">
        <label className="field">
          <span>MCP server</span>
          <input name="serverName" required placeholder="github" maxLength={128} />
        </label>
        <label className="field">
          <span>Tool</span>
          <input name="toolName" required placeholder="repo.read" maxLength={128} />
        </label>
        <label className="field">
          <span>Connector</span>
          <input
            name="connector"
            required
            list="governed-mcp-connectors"
            placeholder="github"
            maxLength={128}
          />
          <datalist id="governed-mcp-connectors">
            {connectorSuggestions.map((connector) => (
              <option key={connector} value={connector} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Action</span>
          <input name="action" required placeholder="repo.read" maxLength={128} />
        </label>
        <label className="field">
          <span>Server URL (optional)</span>
          <input name="serverUrl" type="url" placeholder="https://mcp.example.com" maxLength={512} />
        </label>
        <label className="field">
          <span>Description (optional)</span>
          <input name="description" maxLength={512} />
        </label>
      </div>
      <p className="meta">
        Registering describes a tool. It authorizes nothing on its own — a grant does that.
      </p>
      <div className="adminAuthPanelActions">
        <SubmitButton label="Register tool" pendingLabel="Registering…" />
      </div>
      <AdminMutationStatus error={state?.error} message={state?.message} />
    </form>
  );
}

export function GrantToolForm({ registryId, label }: { registryId: string; label: string }) {
  const [state, action] = useActionState<GovernedMcpActionState, FormData>(
    grantGovernedMcpTool,
    null,
  );

  return (
    <form action={action} className="adminMutationForm">
      <input type="hidden" name="registryId" value={registryId} />
      <label className="field">
        <span>Agent</span>
        <input name="agentId" placeholder="every agent" maxLength={128} />
      </label>
      <label className="field">
        <span>Environment</span>
        <input name="environment" placeholder="every environment" maxLength={64} />
      </label>
      <SubmitButton label={`Grant ${label}`} pendingLabel="Granting…" />
      <AdminMutationStatus error={state?.error} message={state?.message} />
    </form>
  );
}

export function RevokeGrantForm({ grantId, label }: { grantId: string; label: string }) {
  const [state, action] = useActionState<GovernedMcpActionState, FormData>(
    revokeGovernedMcpGrant,
    null,
  );

  return (
    <form action={action} className="adminMutationForm">
      <input type="hidden" name="grantId" value={grantId} />
      <ConfirmSubmitButton
        className="button buttonDanger"
        confirmMessage={`Revoke ${label}? The next call for it is denied.`}
      >
        Revoke
      </ConfirmSubmitButton>
      <AdminMutationStatus error={state?.error} message={state?.message} />
    </form>
  );
}
