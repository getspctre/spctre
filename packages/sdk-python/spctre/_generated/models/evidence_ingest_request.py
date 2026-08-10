from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.evidence_ingest_request_ingest_mode import EvidenceIngestRequestIngestMode
from ..models.evidence_ingest_request_plugin_source import (
    EvidenceIngestRequestPluginSource,
)
from ..models.evidence_layer import EvidenceLayer
from ..models.runtime_decision_status import RuntimeDecisionStatus
from ..models.trigger_kind import TriggerKind
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.evidence_ingest_request_execution_context import (
        EvidenceIngestRequestExecutionContext,
    )
    from ..models.evidence_ingest_request_orchestrator_ref import (
        EvidenceIngestRequestOrchestratorRef,
    )
    from ..models.evidence_ingest_request_raw_evidence import (
        EvidenceIngestRequestRawEvidence,
    )
    from ..models.evidence_ingest_request_skill_context import (
        EvidenceIngestRequestSkillContext,
    )
    from ..models.evidence_ingest_request_tool_parameters import (
        EvidenceIngestRequestToolParameters,
    )
    from ..models.runtime_policy_context import RuntimePolicyContext
    from ..models.runtime_target import RuntimeTarget


T = TypeVar("T", bound="EvidenceIngestRequest")


@_attrs_define
class EvidenceIngestRequest:
    """
    Attributes:
        decision_id (str): Unique ID for this governance decision (idempotency key).
        environment (str):
        runtime_target (RuntimeTarget):
        agent_id (str):
        connector (str):
        action (str):
        status (RuntimeDecisionStatus):
        reason (str):
        tenant_id (str | Unset): Optional tenant boundary hint. Empty string is treated as omitted. The x-spctre-tenant-
            id header takes precedence when both are present; otherwise inferred from the bearer token when omitted.
        workspace_id (str | Unset): Optional workspace boundary hint. Empty string is treated as omitted. The x-spctre-
            workspace-id header takes precedence when both are present; otherwise inferred from the bearer token when
            omitted.
        policy_refs (list[str] | Unset): Required when ingestMode is omitted or 'standard'. Omit only when ingestMode is
            'gateway'.
        artifact_hash (str | Unset): SHA-256 hash of the policy bundle artifact. Required in standard mode.
        policy_context (list[RuntimePolicyContext] | Unset): Required in standard mode; server resolves it in gateway
            mode.
        latency_ms (int | Unset):
        created_at (datetime.datetime | Unset): Decision timestamp. Defaults to server time when omitted.
        raw_evidence (EvidenceIngestRequestRawEvidence | Unset): Arbitrary key-value metadata attached to the evidence
            record.
        consequence (str | Unset):
        customer_tier (str | Unset):
        confidence (float | Unset):
        amount_usd (float | Unset):
        data_sensitivity (str | Unset):
        trust_score (float | Unset):
        context_budget (int | Unset):
        source_type (str | Unset):
        execution_trace (Any | Unset): Execution trace for forensic replay.
        engine_version (str | Unset):
        ingest_mode (EvidenceIngestRequestIngestMode | Unset): Use 'gateway' when posting from a gateway adapter; the
            server resolves policyRefs, artifactHash, and policyContext automatically.
        tool_intent (str | Unset): The explicitly declared intent or purpose of the tool call.
        plan_summary (str | Unset): A high-level plan summary explicitly provided by the runtime.
        tool_parameters (EvidenceIngestRequestToolParameters | Unset): The structured arguments passed to the tool.
        trigger_kind (TriggerKind | Unset): The invocation origin of the agent tool call.
        layer (EvidenceLayer | Unset): Whether the evidence record originates from the agent layer (L7 tool calls) or
            sandbox layer (L3/L4 network policy).
        execution_context (EvidenceIngestRequestExecutionContext | Unset): Execution surface identity plus
            sandbox/inference-router evidence references.
        parent_agent_id (str | Unset): Agent ID of the parent when this evidence originates from a subagent.
        trace_id (str | Unset): Distributed trace identifier linking related agent decisions across subagents.
        orchestrator_ref (EvidenceIngestRequestOrchestratorRef | Unset): Orchestrator-platform reference (e.g. Paperclip
            companyId, issueId, goalId).
        plugin_source (EvidenceIngestRequestPluginSource | Unset): Plugin provenance dimension.
        skill_context (EvidenceIngestRequestSkillContext | Unset): Prompt-level governance surface: active skills,
            instruction files, and prompt policy refs present when the decision was made.
        webhook_source (str | Unset): Source identifier for inbound webhook triggers (present when triggerKind is
            inbound_webhook).
        trust_level (str | Unset): Trust level assigned by the orchestration platform (e.g. Paperclip trust preset).
        catalog_provider (str | Unset): Catalog or skill provenance provider (e.g. Paperclip catalog-provenance
            identifier).
    """

    decision_id: str
    environment: str
    runtime_target: RuntimeTarget
    agent_id: str
    connector: str
    action: str
    status: RuntimeDecisionStatus
    reason: str
    tenant_id: str | Unset = UNSET
    workspace_id: str | Unset = UNSET
    policy_refs: list[str] | Unset = UNSET
    artifact_hash: str | Unset = UNSET
    policy_context: list[RuntimePolicyContext] | Unset = UNSET
    latency_ms: int | Unset = UNSET
    created_at: datetime.datetime | Unset = UNSET
    raw_evidence: EvidenceIngestRequestRawEvidence | Unset = UNSET
    consequence: str | Unset = UNSET
    customer_tier: str | Unset = UNSET
    confidence: float | Unset = UNSET
    amount_usd: float | Unset = UNSET
    data_sensitivity: str | Unset = UNSET
    trust_score: float | Unset = UNSET
    context_budget: int | Unset = UNSET
    source_type: str | Unset = UNSET
    execution_trace: Any | Unset = UNSET
    engine_version: str | Unset = UNSET
    ingest_mode: EvidenceIngestRequestIngestMode | Unset = UNSET
    tool_intent: str | Unset = UNSET
    plan_summary: str | Unset = UNSET
    tool_parameters: EvidenceIngestRequestToolParameters | Unset = UNSET
    trigger_kind: TriggerKind | Unset = UNSET
    layer: EvidenceLayer | Unset = UNSET
    execution_context: EvidenceIngestRequestExecutionContext | Unset = UNSET
    parent_agent_id: str | Unset = UNSET
    trace_id: str | Unset = UNSET
    orchestrator_ref: EvidenceIngestRequestOrchestratorRef | Unset = UNSET
    plugin_source: EvidenceIngestRequestPluginSource | Unset = UNSET
    skill_context: EvidenceIngestRequestSkillContext | Unset = UNSET
    webhook_source: str | Unset = UNSET
    trust_level: str | Unset = UNSET
    catalog_provider: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        decision_id = self.decision_id

        environment = self.environment

        runtime_target = self.runtime_target.to_dict()

        agent_id = self.agent_id

        connector = self.connector

        action = self.action

        status = self.status.value

        reason = self.reason

        tenant_id = self.tenant_id

        workspace_id = self.workspace_id

        policy_refs: list[str] | Unset = UNSET
        if not isinstance(self.policy_refs, Unset):
            policy_refs = self.policy_refs

        artifact_hash = self.artifact_hash

        policy_context: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.policy_context, Unset):
            policy_context = []
            for policy_context_item_data in self.policy_context:
                policy_context_item = policy_context_item_data.to_dict()
                policy_context.append(policy_context_item)

        latency_ms = self.latency_ms

        created_at: str | Unset = UNSET
        if not isinstance(self.created_at, Unset):
            created_at = self.created_at.isoformat()

        raw_evidence: dict[str, Any] | Unset = UNSET
        if not isinstance(self.raw_evidence, Unset):
            raw_evidence = self.raw_evidence.to_dict()

        consequence = self.consequence

        customer_tier = self.customer_tier

        confidence = self.confidence

        amount_usd = self.amount_usd

        data_sensitivity = self.data_sensitivity

        trust_score = self.trust_score

        context_budget = self.context_budget

        source_type = self.source_type

        execution_trace = self.execution_trace

        engine_version = self.engine_version

        ingest_mode: str | Unset = UNSET
        if not isinstance(self.ingest_mode, Unset):
            ingest_mode = self.ingest_mode.value

        tool_intent = self.tool_intent

        plan_summary = self.plan_summary

        tool_parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tool_parameters, Unset):
            tool_parameters = self.tool_parameters.to_dict()

        trigger_kind: str | Unset = UNSET
        if not isinstance(self.trigger_kind, Unset):
            trigger_kind = self.trigger_kind.value

        layer: str | Unset = UNSET
        if not isinstance(self.layer, Unset):
            layer = self.layer.value

        execution_context: dict[str, Any] | Unset = UNSET
        if not isinstance(self.execution_context, Unset):
            execution_context = self.execution_context.to_dict()

        parent_agent_id = self.parent_agent_id

        trace_id = self.trace_id

        orchestrator_ref: dict[str, Any] | Unset = UNSET
        if not isinstance(self.orchestrator_ref, Unset):
            orchestrator_ref = self.orchestrator_ref.to_dict()

        plugin_source: str | Unset = UNSET
        if not isinstance(self.plugin_source, Unset):
            plugin_source = self.plugin_source.value

        skill_context: dict[str, Any] | Unset = UNSET
        if not isinstance(self.skill_context, Unset):
            skill_context = self.skill_context.to_dict()

        webhook_source = self.webhook_source

        trust_level = self.trust_level

        catalog_provider = self.catalog_provider

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "decisionId": decision_id,
                "environment": environment,
                "runtimeTarget": runtime_target,
                "agentId": agent_id,
                "connector": connector,
                "action": action,
                "status": status,
                "reason": reason,
            }
        )
        if tenant_id is not UNSET:
            field_dict["tenantId"] = tenant_id
        if workspace_id is not UNSET:
            field_dict["workspaceId"] = workspace_id
        if policy_refs is not UNSET:
            field_dict["policyRefs"] = policy_refs
        if artifact_hash is not UNSET:
            field_dict["artifactHash"] = artifact_hash
        if policy_context is not UNSET:
            field_dict["policyContext"] = policy_context
        if latency_ms is not UNSET:
            field_dict["latencyMs"] = latency_ms
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at
        if raw_evidence is not UNSET:
            field_dict["rawEvidence"] = raw_evidence
        if consequence is not UNSET:
            field_dict["consequence"] = consequence
        if customer_tier is not UNSET:
            field_dict["customerTier"] = customer_tier
        if confidence is not UNSET:
            field_dict["confidence"] = confidence
        if amount_usd is not UNSET:
            field_dict["amountUsd"] = amount_usd
        if data_sensitivity is not UNSET:
            field_dict["dataSensitivity"] = data_sensitivity
        if trust_score is not UNSET:
            field_dict["trustScore"] = trust_score
        if context_budget is not UNSET:
            field_dict["contextBudget"] = context_budget
        if source_type is not UNSET:
            field_dict["sourceType"] = source_type
        if execution_trace is not UNSET:
            field_dict["executionTrace"] = execution_trace
        if engine_version is not UNSET:
            field_dict["engineVersion"] = engine_version
        if ingest_mode is not UNSET:
            field_dict["ingestMode"] = ingest_mode
        if tool_intent is not UNSET:
            field_dict["toolIntent"] = tool_intent
        if plan_summary is not UNSET:
            field_dict["planSummary"] = plan_summary
        if tool_parameters is not UNSET:
            field_dict["toolParameters"] = tool_parameters
        if trigger_kind is not UNSET:
            field_dict["triggerKind"] = trigger_kind
        if layer is not UNSET:
            field_dict["layer"] = layer
        if execution_context is not UNSET:
            field_dict["executionContext"] = execution_context
        if parent_agent_id is not UNSET:
            field_dict["parentAgentId"] = parent_agent_id
        if trace_id is not UNSET:
            field_dict["traceId"] = trace_id
        if orchestrator_ref is not UNSET:
            field_dict["orchestratorRef"] = orchestrator_ref
        if plugin_source is not UNSET:
            field_dict["pluginSource"] = plugin_source
        if skill_context is not UNSET:
            field_dict["skillContext"] = skill_context
        if webhook_source is not UNSET:
            field_dict["webhookSource"] = webhook_source
        if trust_level is not UNSET:
            field_dict["trustLevel"] = trust_level
        if catalog_provider is not UNSET:
            field_dict["catalogProvider"] = catalog_provider

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.evidence_ingest_request_execution_context import (
            EvidenceIngestRequestExecutionContext,
        )
        from ..models.evidence_ingest_request_orchestrator_ref import (
            EvidenceIngestRequestOrchestratorRef,
        )
        from ..models.evidence_ingest_request_raw_evidence import (
            EvidenceIngestRequestRawEvidence,
        )
        from ..models.evidence_ingest_request_skill_context import (
            EvidenceIngestRequestSkillContext,
        )
        from ..models.evidence_ingest_request_tool_parameters import (
            EvidenceIngestRequestToolParameters,
        )
        from ..models.runtime_policy_context import RuntimePolicyContext
        from ..models.runtime_target import RuntimeTarget

        d = dict(src_dict)
        decision_id = d.pop("decisionId")

        environment = d.pop("environment")

        runtime_target = RuntimeTarget.from_dict(d.pop("runtimeTarget"))

        agent_id = d.pop("agentId")

        connector = d.pop("connector")

        action = d.pop("action")

        status = RuntimeDecisionStatus(d.pop("status"))

        reason = d.pop("reason")

        tenant_id = d.pop("tenantId", UNSET)

        workspace_id = d.pop("workspaceId", UNSET)

        policy_refs = cast(list[str], d.pop("policyRefs", UNSET))

        artifact_hash = d.pop("artifactHash", UNSET)

        _policy_context = d.pop("policyContext", UNSET)
        policy_context: list[RuntimePolicyContext] | Unset = UNSET
        if _policy_context is not UNSET:
            policy_context = []
            for policy_context_item_data in _policy_context:
                policy_context_item = RuntimePolicyContext.from_dict(
                    policy_context_item_data
                )

                policy_context.append(policy_context_item)

        latency_ms = d.pop("latencyMs", UNSET)

        _created_at = d.pop("createdAt", UNSET)
        created_at: datetime.datetime | Unset
        if isinstance(_created_at, Unset):
            created_at = UNSET
        else:
            created_at = datetime.datetime.fromisoformat(_created_at)

        _raw_evidence = d.pop("rawEvidence", UNSET)
        raw_evidence: EvidenceIngestRequestRawEvidence | Unset
        if isinstance(_raw_evidence, Unset):
            raw_evidence = UNSET
        else:
            raw_evidence = EvidenceIngestRequestRawEvidence.from_dict(_raw_evidence)

        consequence = d.pop("consequence", UNSET)

        customer_tier = d.pop("customerTier", UNSET)

        confidence = d.pop("confidence", UNSET)

        amount_usd = d.pop("amountUsd", UNSET)

        data_sensitivity = d.pop("dataSensitivity", UNSET)

        trust_score = d.pop("trustScore", UNSET)

        context_budget = d.pop("contextBudget", UNSET)

        source_type = d.pop("sourceType", UNSET)

        execution_trace = d.pop("executionTrace", UNSET)

        engine_version = d.pop("engineVersion", UNSET)

        _ingest_mode = d.pop("ingestMode", UNSET)
        ingest_mode: EvidenceIngestRequestIngestMode | Unset
        if isinstance(_ingest_mode, Unset):
            ingest_mode = UNSET
        else:
            ingest_mode = EvidenceIngestRequestIngestMode(_ingest_mode)

        tool_intent = d.pop("toolIntent", UNSET)

        plan_summary = d.pop("planSummary", UNSET)

        _tool_parameters = d.pop("toolParameters", UNSET)
        tool_parameters: EvidenceIngestRequestToolParameters | Unset
        if isinstance(_tool_parameters, Unset):
            tool_parameters = UNSET
        else:
            tool_parameters = EvidenceIngestRequestToolParameters.from_dict(
                _tool_parameters
            )

        _trigger_kind = d.pop("triggerKind", UNSET)
        trigger_kind: TriggerKind | Unset
        if isinstance(_trigger_kind, Unset):
            trigger_kind = UNSET
        else:
            trigger_kind = TriggerKind(_trigger_kind)

        _layer = d.pop("layer", UNSET)
        layer: EvidenceLayer | Unset
        if isinstance(_layer, Unset):
            layer = UNSET
        else:
            layer = EvidenceLayer(_layer)

        _execution_context = d.pop("executionContext", UNSET)
        execution_context: EvidenceIngestRequestExecutionContext | Unset
        if isinstance(_execution_context, Unset):
            execution_context = UNSET
        else:
            execution_context = EvidenceIngestRequestExecutionContext.from_dict(
                _execution_context
            )

        parent_agent_id = d.pop("parentAgentId", UNSET)

        trace_id = d.pop("traceId", UNSET)

        _orchestrator_ref = d.pop("orchestratorRef", UNSET)
        orchestrator_ref: EvidenceIngestRequestOrchestratorRef | Unset
        if isinstance(_orchestrator_ref, Unset):
            orchestrator_ref = UNSET
        else:
            orchestrator_ref = EvidenceIngestRequestOrchestratorRef.from_dict(
                _orchestrator_ref
            )

        _plugin_source = d.pop("pluginSource", UNSET)
        plugin_source: EvidenceIngestRequestPluginSource | Unset
        if isinstance(_plugin_source, Unset):
            plugin_source = UNSET
        else:
            plugin_source = EvidenceIngestRequestPluginSource(_plugin_source)

        _skill_context = d.pop("skillContext", UNSET)
        skill_context: EvidenceIngestRequestSkillContext | Unset
        if isinstance(_skill_context, Unset):
            skill_context = UNSET
        else:
            skill_context = EvidenceIngestRequestSkillContext.from_dict(_skill_context)

        webhook_source = d.pop("webhookSource", UNSET)

        trust_level = d.pop("trustLevel", UNSET)

        catalog_provider = d.pop("catalogProvider", UNSET)

        evidence_ingest_request = cls(
            decision_id=decision_id,
            environment=environment,
            runtime_target=runtime_target,
            agent_id=agent_id,
            connector=connector,
            action=action,
            status=status,
            reason=reason,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            policy_refs=policy_refs,
            artifact_hash=artifact_hash,
            policy_context=policy_context,
            latency_ms=latency_ms,
            created_at=created_at,
            raw_evidence=raw_evidence,
            consequence=consequence,
            customer_tier=customer_tier,
            confidence=confidence,
            amount_usd=amount_usd,
            data_sensitivity=data_sensitivity,
            trust_score=trust_score,
            context_budget=context_budget,
            source_type=source_type,
            execution_trace=execution_trace,
            engine_version=engine_version,
            ingest_mode=ingest_mode,
            tool_intent=tool_intent,
            plan_summary=plan_summary,
            tool_parameters=tool_parameters,
            trigger_kind=trigger_kind,
            layer=layer,
            execution_context=execution_context,
            parent_agent_id=parent_agent_id,
            trace_id=trace_id,
            orchestrator_ref=orchestrator_ref,
            plugin_source=plugin_source,
            skill_context=skill_context,
            webhook_source=webhook_source,
            trust_level=trust_level,
            catalog_provider=catalog_provider,
        )

        evidence_ingest_request.additional_properties = d
        return evidence_ingest_request

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
