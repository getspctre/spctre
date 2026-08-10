use serde::{Deserialize, Serialize};
use serde_json::Value;

fn null_to_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Option::<T>::deserialize(deserializer).map(Option::unwrap_or_default)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GatewayOutcome {
    Proceed,
    Escalate,
    Abort,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RiskLevel {
    Low,
    High,
    Critical,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RuntimeDecisionStatus {
    Allow,
    Warn,
    Escalate,
    Deny,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriggerKind {
    Interactive,
    Scheduled,
    MobileDispatch,
    InboundWebhook,
    Routine,
    GatewayMessage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceLayer {
    Agent,
    Sandbox,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayDecisionInput {
    pub reason: Option<String>,
    pub consequence: Option<String>,
    pub confidence: Option<f64>,
    pub amount_usd: Option<f64>,
    pub data_sensitivity: Option<String>,
    pub trust_score: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayDecisionResult {
    pub outcome: GatewayOutcome,
    pub reason: String,
    pub risk_level: RiskLevel,
    pub should_queue: bool,
    pub sla_hours: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationsLogHashInput {
    pub event_type: String,
    pub source_id: Option<String>,
    pub source_table: Option<String>,
    pub actor_id: String,
    pub payload: Value,
    pub prev_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationsLogChainEntry {
    pub id: String,
    pub event_type: String,
    pub source_id: Option<String>,
    pub source_table: Option<String>,
    pub actor_id: String,
    pub payload: Value,
    pub prev_hash: Option<String>,
    pub content_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ChainIssueKind {
    ContentHashMismatch,
    PrevHashMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainIssue {
    pub entry_id: String,
    pub created_at: String,
    pub kind: ChainIssueKind,
    pub expected: Option<String>,
    pub actual: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyEvidenceInput {
    pub connector: String,
    pub action: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub domains: Vec<String>,
    pub runtime_target: Option<RuntimeTargetEvidence>,
    pub execution_context: Option<ExecutionContextEvidence>,
    pub orchestrator_ref: Option<OrchestratorRefEvidence>,
    pub skill_context: Option<SkillContextEvidence>,
    pub trigger_kind: Option<TriggerKind>,
    pub layer: Option<EvidenceLayer>,
    pub trust_level: Option<String>,
    pub plugin_source: Option<String>,
    pub catalog_provider: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTargetEvidence {
    pub stack: String,
    pub adapter: Option<String>,
    pub environment: Option<String>,
    pub sandbox_name: Option<String>,
    pub inference_provider: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionContextEvidence {
    pub backend: Option<String>,
    pub session_id: Option<String>,
    pub sandbox_name: Option<String>,
    pub inference_provider: Option<String>,
    pub sandbox_policy_ref: Option<String>,
    pub inference_router_ref: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorRefEvidence {
    pub platform: String,
    pub company_id: Option<String>,
    pub issue_id: Option<String>,
    pub goal_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillContextEvidence {
    #[serde(default)]
    pub active_skills: Vec<String>,
    #[serde(default)]
    pub instruction_files: Vec<String>,
    #[serde(default)]
    pub prompt_policy_refs: Vec<String>,
    pub prompt_surface: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyRule {
    pub stable_rule_id: String,
    pub title: String,
    pub effect: RuntimeDecisionStatus,
    #[serde(default, deserialize_with = "null_to_default")]
    pub domains: Vec<String>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub connectors: Vec<String>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub actions: Vec<String>,
    #[serde(default)]
    pub immutable: bool,
    #[serde(default)]
    pub semantic_checks: Vec<SemanticCheck>,
    #[serde(default)]
    pub parameter_constraints: Vec<PolicyParameterConstraint>,
    #[serde(default)]
    pub runtime_stacks: Vec<String>,
    #[serde(default)]
    pub sandbox_names: Vec<String>,
    #[serde(default)]
    pub inference_providers: Vec<String>,
    #[serde(default)]
    pub orchestrator_platforms: Vec<String>,
    #[serde(default)]
    pub company_ids: Vec<String>,
    #[serde(default)]
    pub issue_ids: Vec<String>,
    #[serde(default)]
    pub goal_ids: Vec<String>,
    pub trigger_kind: Option<TriggerKind>,
    pub layer: Option<EvidenceLayer>,
    #[serde(default)]
    pub trust_levels: Vec<String>,
    #[serde(default)]
    pub plugin_sources: Vec<String>,
    #[serde(default)]
    pub skill_ids: Vec<String>,
    #[serde(default)]
    pub prompt_surfaces: Vec<String>,
    #[serde(default)]
    pub catalog_providers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticCheck {
    pub id: String,
    pub prompt: String,
    pub effect: Option<RuntimeDecisionStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyParameterConstraint {
    pub field: String,
    pub operator: String,
    pub value: Value,
    pub effect: Option<RuntimeDecisionStatus>,
}

/// One ordered published-policy layer. Layers proceed from least to most
/// specific; composition preserves first-seen rule order while allowing a
/// later layer to replace a non-immutable rule with the same stable id.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositionLayer {
    pub scope: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub rules: Vec<PolicyRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyCompositionResult {
    pub effective_rules: Vec<PolicyRule>,
    pub conflict_notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationTraceStep {
    pub stable_rule_id: String,
    pub title: String,
    pub effect: RuntimeDecisionStatus,
    pub matched: bool,
    pub match_reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationResult {
    pub status: RuntimeDecisionStatus,
    pub matched_refs: Vec<String>,
    pub reason: String,
    pub trace: Vec<EvaluationTraceStep>,
    pub rule_count: usize,
    pub evaluated_at: String,
    pub evaluator_version: String,
    pub request_schema_version: String,
    pub result_schema_version: String,
    pub policy_artifact_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyEvaluationInput {
    #[serde(flatten)]
    pub evidence: PolicyEvidenceInput,
    #[serde(default, deserialize_with = "null_to_default")]
    pub rules: Vec<PolicyRule>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub layers: Vec<CompositionLayer>,
    #[serde(default)]
    pub tool_intent: String,
    #[serde(default)]
    pub plan_summary: String,
    #[serde(default)]
    pub tool_parameters: Value,
    pub policy_artifact_hash: Option<String>,
    pub evaluated_at: Option<String>,
}

/// The kernel's resource limits, reported to hosts so they can validate a
/// policy against the real ABI bounds rather than a copy of them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyKernelLimits {
    pub max_request_bytes: usize,
    pub max_response_bytes: usize,
}

/// One winning position in a composition: which layer and which rule within it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyCompositionSlot {
    pub layer_index: usize,
    pub rule_index: usize,
    pub stable_rule_id: String,
    pub scope: String,
    pub immutable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyCompositionSelection {
    pub effective: Vec<PolicyCompositionSlot>,
    pub conflict_notes: Vec<String>,
}

/// Composition needs only a rule's identity and immutability. Hosts send this
/// reduced shape so a composition request stays small and independent of the
/// rule fields the kernel happens to model.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositionRequestRule {
    pub stable_rule_id: String,
    #[serde(default)]
    pub immutable: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositionRequestLayer {
    pub scope: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub rules: Vec<CompositionRequestRule>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositionRequest {
    #[serde(default, deserialize_with = "null_to_default")]
    pub layers: Vec<CompositionRequestLayer>,
}

/// Lets one composition implementation serve both the kernel's own rules and the
/// reduced shape hosts send, so the semantics cannot fork between them.
pub trait ComposableRule {
    fn stable_rule_id(&self) -> &str;
    fn immutable(&self) -> bool;
}

pub trait ComposableLayer {
    type Rule: ComposableRule;
    fn scope(&self) -> &str;
    fn rules(&self) -> &[Self::Rule];
}

impl ComposableRule for PolicyRule {
    fn stable_rule_id(&self) -> &str {
        &self.stable_rule_id
    }
    fn immutable(&self) -> bool {
        self.immutable
    }
}

impl ComposableLayer for CompositionLayer {
    type Rule = PolicyRule;
    fn scope(&self) -> &str {
        &self.scope
    }
    fn rules(&self) -> &[PolicyRule] {
        &self.rules
    }
}

impl ComposableRule for CompositionRequestRule {
    fn stable_rule_id(&self) -> &str {
        &self.stable_rule_id
    }
    fn immutable(&self) -> bool {
        self.immutable
    }
}

impl ComposableLayer for CompositionRequestLayer {
    type Rule = CompositionRequestRule;
    fn scope(&self) -> &str {
        &self.scope
    }
    fn rules(&self) -> &[CompositionRequestRule] {
        &self.rules
    }
}
