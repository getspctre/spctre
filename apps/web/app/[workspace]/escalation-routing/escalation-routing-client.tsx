"use client";

import { useState } from "react";
import type { AlertingIntegration, AlertingRule } from "@/lib/domains/alerting/service";
import type { SharedHandlerContext } from "../alerting/alerting-shared";
import { IntegrationsPane, IntegrationModal, useIntegrationHandlers } from "../alerting/alerting-integrations";
import { RulesPane, RuleModal, useRuleHandlers } from "../alerting/alerting-rules";

export function EscalationRoutingClient({ workspaceId, workspaceSlug, integrations, rules }: {
  workspaceId: string;
  workspaceSlug: string;
  integrations: AlertingIntegration[];
  rules: AlertingRule[];
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctx: SharedHandlerContext = { workspaceId, workspaceSlug, setError, setLoading };
  const integration = useIntegrationHandlers(ctx);
  const rule = useRuleHandlers(ctx, integrations);

  return (
    <div className="alertingContainer">
      {error && !integration.modalOpen && !rule.modalOpen ? <p className="meta workspaceError">{error}</p> : null}
      <IntegrationsPane integrations={integrations} status={integration.status} deletingId={integration.deletingId} onAdd={() => { setError(null); integration.setModalOpen(true); }} onRemove={integration.handleRemove} />
      <RulesPane rules={rules} status={rule.status} deletingId={rule.deletingId} onAdd={rule.openModal} onRemove={rule.handleRemove} />
      {integration.modalOpen ? <IntegrationModal form={integration.form} update={integration.updateForm} error={error} loading={loading} onSubmit={integration.handleAdd} onClose={() => integration.setModalOpen(false)} /> : null}
      {rule.modalOpen ? <RuleModal form={rule.form} update={rule.updateForm} integrations={integrations} error={error} loading={loading} onSubmit={rule.handleAdd} onClose={() => rule.setModalOpen(false)} /> : null}
    </div>
  );
}
