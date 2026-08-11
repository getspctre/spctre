"use client";
import { useActionState, useState, useTransition } from "react";
import type {
  EvidenceIntegrationSummary,
  GenericEvidenceCoverage,
  GenericEvidenceProvenance,
} from "@/lib/repositories/evidence";
import { createEvidenceIntegrationAction, previewEvidenceMappingAction } from "./actions";
const SAMPLE = JSON.stringify(
  {
    timestamp: "2026-08-11T12:00:00Z",
    event_id: "evt_001",
    decision: "allow",
    tool: { name: "filesystem.write" },
  },
  null,
  2,
);
const MAPPING = JSON.stringify(
  {
    occurred_at: "$.timestamp",
    action: "$.tool.name",
    source_event_id: "$.event_id",
    enforcement_decision: "$.decision",
  },
  null,
  2,
);
const MANAGED_MAPPINGS: Record<string, string> = {
  bedrock_agentcore: JSON.stringify(
    {
      occurred_at: "$.occurred_at",
      action: "$.action",
      source_event_id: "$.source_event_id",
      agent_external_id: "$.agent.id",
      target_resource: "$.target_resource",
    },
    null,
    2,
  ),
  docker_ai_governance: JSON.stringify(
    { occurred_at: "$.occurred_at", action: "$.action", source_event_id: "$.source_event_id" },
    null,
    2,
  ),
  langsmith: JSON.stringify(
    {
      occurred_at: "$.occurred_at",
      action: "$.action",
      source_event_id: "$.source_event_id",
      agent_external_id: "$.agent.id",
    },
    null,
    2,
  ),
};
export function EvidenceIntegrationWizard({
  integrations,
  provenance,
  coverage,
}: {
  integrations: EvidenceIntegrationSummary[];
  provenance: GenericEvidenceProvenance[];
  coverage: GenericEvidenceCoverage[];
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [providerType, setProviderType] = useState("generic_json");
  const [mapping, setMapping] = useState(MAPPING);
  const [sample, setSample] = useState(SAMPLE);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();
  const [state, action, pending] = useActionState(createEvidenceIntegrationAction, null);
  if (state?.ok)
    return (
      <section className="adminAuthPanel">
        <p className="eyebrow">Integration activated</p>
        <h2>Copy this dedicated token now</h2>
        <p className="meta">It is shown once and is bound only to this integration.</p>
        <pre className="serviceKeyCodeSample">{state.rawToken}</pre>
        <a className="button" href="/admin/evidence-integrations">
          Done
        </a>
      </section>
    );
  return (
    <div className="adminAuthLayout">
      <section className="adminAuthStack">
        <section className="adminAuthPanel">
          <p className="eyebrow">Active integrations</p>
          <h2>Evidence sources</h2>
          {integrations.length ? (
            <div className="auditTableWrapper">
              <table className="auditTable">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Source</th>
                    <th>Revision</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {integrations.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <strong>{i.name}</strong>
                      </td>
                      <td>{i.providerType}</td>
                      <td>v{i.mappingVersion ?? "—"}</td>
                      <td>
                        <span className="pill pillNeutral">{i.active ? "Active" : "Inactive"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="adminAuthEmpty">
              <div>
                <h3>No evidence sources yet</h3>
                <p className="meta">
                  Create a source, validate its mapping, then activate a dedicated ingest token.
                </p>
              </div>
            </div>
          )}
        </section>
        <section className="adminAuthPanel" aria-labelledby="coverage-heading">
          <p className="eyebrow">Correlation</p>
          <h2 id="coverage-heading">Provider coverage</h2>
          {coverage.length ? (
            <div className="auditTableWrapper">
              <table className="auditTable">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Resolved</th>
                    <th>Unresolved</th>
                    <th>Drift</th>
                    <th>Last receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((item) => (
                    <tr key={item.providerType}>
                      <td>
                        <strong>{item.providerType}</strong>
                      </td>
                      <td>
                        {item.stale ? (
                          <span className="pill pillWarn">No receipt in 24h</span>
                        ) : (
                          <span className="pill pillNeutral">Current</span>
                        )}
                      </td>
                      <td>
                        {item.resolved} / {item.total}
                      </td>
                      <td>
                        {item.unresolved ? (
                          <span className="pill pillWarn">{item.unresolved} need review</span>
                        ) : (
                          <span className="pill pillNeutral">None</span>
                        )}
                      </td>
                      <td>
                        {item.lastReceivedAt ? new Date(item.lastReceivedAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="meta">Coverage appears after the first evidence receipt.</p>
          )}
        </section>
        <section className="adminAuthPanel" aria-labelledby="provenance-heading">
          <p className="eyebrow">Recent receipts</p>
          <h2 id="provenance-heading">Evidence provenance</h2>
          {provenance.length ? (
            <div className="auditTableWrapper">
              <table className="auditTable">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Mapping</th>
                    <th>Result</th>
                    <th>Correlation</th>
                    <th>Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {provenance.map((item) => (
                    <tr key={item.sourceRecordId}>
                      <td>
                        <strong>{item.integrationName}</strong>
                        <br />
                        <code>{item.contentHash.slice(0, 18)}…</code>
                      </td>
                      <td>v{item.mappingVersion ?? "—"}</td>
                      <td>
                        {item.rejectedReason ? (
                          <span className="pill pillWarn">Rejected: {item.rejectedReason}</span>
                        ) : (
                          <span className="pill pillNeutral">{item.decision ?? "unresolved"}</span>
                        )}
                      </td>
                      <td>
                        {item.canonicalAgentId ? (
                          <span className="pill pillNeutral">
                            Resolved: {item.canonicalAgentId}
                          </span>
                        ) : item.unresolved ? (
                          <span className="pill pillWarn">Needs binding</span>
                        ) : (
                          <span className="pill pillNeutral">Not supplied</span>
                        )}
                      </td>
                      <td>{new Date(item.receivedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="meta">Incoming records and mapping rejections will appear here.</p>
          )}
        </section>
      </section>
      <aside className="adminAuthSidebar">
        <form action={action} className="adminAuthForm">
          <input name="name" type="hidden" value={name} />
          <input name="providerType" type="hidden" value={providerType} />
          <textarea name="mapping" value={mapping} hidden readOnly />
          <p className="eyebrow">Step {step} of 3</p>
          <h2>{step === 1 ? "Source" : step === 2 ? "Mapping" : "Review and activate"}</h2>
          {state?.error && <p className="serviceKeyTokenRevealWarn">{state.error}</p>}
          {step === 1 && (
            <>
              <label className="eyebrow">
                Name
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
              <label className="eyebrow">
                Source type
                <select
                  className="input"
                  value={providerType}
                  onChange={(event) => {
                    const next = event.target.value;
                    setProviderType(next);
                    setMapping(MANAGED_MAPPINGS[next] ?? MAPPING);
                  }}
                >
                  <option value="generic_json">Generic JSON</option>
                  <option value="generic_ndjson">Generic NDJSON</option>
                  <option value="cloudevents">CloudEvents</option>
                  <option value="otlp_logs">OTLP logs</option>
                  <option value="bedrock_agentcore">Amazon Bedrock AgentCore</option>
                  <option value="docker_ai_governance">Docker AI Governance</option>
                  <option value="langsmith">LangSmith</option>
                </select>
              </label>
            </>
          )}
          {step === 2 && (
            <>
              <label className="eyebrow">
                Mapping JSON
                <textarea
                  className="input"
                  value={mapping}
                  onChange={(event) => setMapping(event.target.value)}
                  rows={12}
                  required
                />
              </label>
              <pre className="serviceKeyCodeSample">{SAMPLE}</pre>
              <label className="eyebrow">
                Sample JSON
                <textarea
                  className="input"
                  value={sample}
                  onChange={(event) => setSample(event.target.value)}
                  rows={8}
                />
              </label>
              <button
                type="button"
                className="button"
                disabled={previewing}
                onClick={() =>
                  startPreview(async () => {
                    const result = await previewEvidenceMappingAction(mapping, sample);
                    setPreview(result.ok ? JSON.stringify(result.preview, null, 2) : null);
                    setPreviewError(result.ok ? null : result.error);
                  })
                }
              >
                {previewing ? "Validating…" : "Preview mapping"}
              </button>
              {previewError && <p className="serviceKeyTokenRevealWarn">{previewError}</p>}
              {preview && <pre className="serviceKeyCodeSample">{preview}</pre>}
            </>
          )}
          {step === 3 && (
            <>
              <p className="meta">
                Activation creates immutable revision 1 and a token scoped to this integration.
              </p>
            </>
          )}
          {step < 3 ? (
            <button
              type="button"
              className="button buttonPrimary"
              onClick={() => {
                if (step === 1 && !name.trim()) return;
                setStep(step + 1);
              }}
            >
              Continue
            </button>
          ) : (
            <button className="button buttonPrimary" disabled={pending}>
              {pending ? "Activating…" : "Activate integration"}
            </button>
          )}
        </form>
      </aside>
    </div>
  );
}
