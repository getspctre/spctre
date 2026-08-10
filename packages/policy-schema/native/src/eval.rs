use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::types::*;

pub fn evaluate_gateway_decision(input: GatewayDecisionInput) -> GatewayDecisionResult {
    let consequence = input
        .consequence
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_uppercase();
    let sensitivity = input
        .data_sensitivity
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_uppercase();
    let trust_score = input.trust_score;
    let confidence = input.confidence;
    let amount_usd = input.amount_usd;

    if consequence == "PROHIBITED"
        || consequence == "IRREVERSIBLE"
        || (trust_score.is_some_and(|v| v < 0.2) && amount_usd.is_some_and(|v| v >= 50_000.0))
        || (trust_score.is_some_and(|v| v < 0.2) && sensitivity == "RESTRICTED")
    {
        return GatewayDecisionResult {
            outcome: GatewayOutcome::Abort,
            reason: input.reason.unwrap_or_else(|| {
                "Gateway aborted action due to prohibited/irreversible consequence or critically low trust under high-impact conditions.".to_string()
            }),
            risk_level: RiskLevel::Critical,
            should_queue: false,
            sla_hours: None,
        };
    }

    if consequence == "HIGH"
        || consequence == "CRITICAL"
        || sensitivity == "HIGH"
        || sensitivity == "RESTRICTED"
        || amount_usd.is_some_and(|v| v >= 10_000.0)
        || trust_score.is_some_and(|v| v < 0.45)
        || confidence.is_some_and(|v| v < 0.6)
    {
        return GatewayDecisionResult {
            outcome: GatewayOutcome::Escalate,
            reason: input.reason.unwrap_or_else(|| {
                "Gateway escalated action due to elevated consequence, sensitivity, confidence, trust, or monetary impact.".to_string()
            }),
            risk_level: RiskLevel::High,
            should_queue: true,
            sla_hours: Some(4),
        };
    }

    GatewayDecisionResult {
        outcome: GatewayOutcome::Proceed,
        reason: input.reason.unwrap_or_else(|| {
            "Gateway approved action under current risk and trust thresholds.".to_string()
        }),
        risk_level: RiskLevel::Low,
        should_queue: false,
        sla_hours: None,
    }
}

pub fn evaluate_policy_decision(input: PolicyEvaluationInput) -> EvaluationResult {
    let composed = (!input.layers.is_empty()).then(|| compose_policy_layers(&input.layers));
    let rules = composed
        .as_ref()
        .map(|result| &result.effective_rules)
        .unwrap_or(&input.rules);
    let mut trace = Vec::with_capacity(rules.len());
    let mut matched_refs = Vec::new();
    let mut matched_rules = Vec::new();

    for rule in rules {
        let mut matched = rule_matches(rule, &input.evidence);
        let mut semantic_prompt = None;
        let mut semantic_override = None;
        let mut parameter_override = None;

        if matched && !rule.semantic_checks.is_empty() {
            if let Some(check) = rule.semantic_checks.iter().find(|check| {
                classify_semantic_intent(
                    &check.prompt,
                    &input.tool_intent,
                    &input.plan_summary,
                    &input.tool_parameters,
                )
            }) {
                semantic_prompt = Some(check.prompt.clone());
                semantic_override = check.effect.clone();
            } else {
                matched = false;
            }
        }

        if matched && !rule.parameter_constraints.is_empty() {
            if let Some(effect) =
                evaluate_parameter_constraints(&rule.parameter_constraints, &input.tool_parameters)
            {
                parameter_override = effect;
            } else {
                matched = false;
            }
        }
        let match_reason = if matched {
            let mut reason = build_match_reason(rule, &input.evidence);
            if semantic_prompt.is_some() || !rule.parameter_constraints.is_empty() {
                let mut parts = if reason == "wildcard match" {
                    Vec::new()
                } else {
                    vec![reason]
                };
                if let Some(prompt) = &semantic_prompt {
                    parts.push(format!("semantic_check=\"{prompt}\""));
                }
                if !rule.parameter_constraints.is_empty() {
                    parts.push("parameter_constraints=matched".to_string());
                }
                reason = if parts.is_empty() {
                    "wildcard match".to_string()
                } else {
                    parts.join("; ")
                };
            }
            reason
        } else {
            "no match".to_string()
        };

        trace.push(EvaluationTraceStep {
            stable_rule_id: rule.stable_rule_id.clone(),
            title: rule.title.clone(),
            effect: rule.effect.clone(),
            matched,
            match_reason,
        });

        if matched {
            matched_refs.push(rule.stable_rule_id.clone());
            matched_rules.push(MatchedPolicyRule {
                rule,
                effect: parameter_override
                    .or(semantic_override)
                    .unwrap_or_else(|| rule.effect.clone()),
                semantic_prompt,
            });
        }
    }

    let (status, reason) = decision_outcome(&matched_rules);

    EvaluationResult {
        status,
        matched_refs,
        reason,
        trace,
        rule_count: rules.len(),
        evaluated_at: input
            .evaluated_at
            .unwrap_or_else(|| "native-evaluator".to_string()),
        evaluator_version: "1.0".to_string(),
        request_schema_version: "1.0".to_string(),
        result_schema_version: "1.0".to_string(),
        policy_artifact_hash: input.policy_artifact_hash,
    }
}

/// Composes ordered policy layers with the same immutable-rule and ordering
/// semantics as the published-policy contract.
///
/// Returns which layer and rule position won each slot rather than the rules
/// themselves. A host holds richer rule records than the kernel models — control
/// mappings, authoring metadata, fields added since this crate was built — so
/// returning rules would silently drop everything the kernel does not know
/// about. The host maps these positions back onto its own objects instead.
pub fn compose_layer_selection<L: ComposableLayer>(layers: &[L]) -> PolicyCompositionSelection {
    let mut effective: Vec<PolicyCompositionSlot> = Vec::new();
    let mut conflict_notes = Vec::new();

    for (layer_index, layer) in layers.iter().enumerate() {
        for (rule_index, rule) in layer.rules().iter().enumerate() {
            let existing = effective
                .iter()
                .position(|slot| slot.stable_rule_id == rule.stable_rule_id());
            match existing {
                Some(index) => {
                    if effective[index].immutable {
                        conflict_notes.push(format!(
                            "Conflict in {} layer: Rule \"{}\" is immutable in {} and cannot be overridden.",
                            layer.scope(), rule.stable_rule_id(), effective[index].scope
                        ));
                        continue;
                    }
                    if effective[index].scope != layer.scope() {
                        conflict_notes.push(format!(
                            "Override: {} layer has updated rule \"{}\" from {}.",
                            layer.scope(),
                            rule.stable_rule_id(),
                            effective[index].scope
                        ));
                    }
                    effective[index] = PolicyCompositionSlot {
                        layer_index,
                        rule_index,
                        stable_rule_id: rule.stable_rule_id().to_string(),
                        scope: layer.scope().to_string(),
                        immutable: rule.immutable(),
                    };
                }
                None => effective.push(PolicyCompositionSlot {
                    layer_index,
                    rule_index,
                    stable_rule_id: rule.stable_rule_id().to_string(),
                    scope: layer.scope().to_string(),
                    immutable: rule.immutable(),
                }),
            }
        }
    }

    PolicyCompositionSelection {
        effective,
        conflict_notes,
    }
}

/// Materializes a composition for in-kernel use, where the kernel's own rule
/// representation is all that is needed.
pub fn compose_policy_layers(layers: &[CompositionLayer]) -> PolicyCompositionResult {
    let selection = compose_layer_selection(layers);
    PolicyCompositionResult {
        effective_rules: selection
            .effective
            .iter()
            .map(|slot| layers[slot.layer_index].rules[slot.rule_index].clone())
            .collect(),
        conflict_notes: selection.conflict_notes,
    }
}

struct MatchedPolicyRule<'a> {
    rule: &'a PolicyRule,
    effect: RuntimeDecisionStatus,
    semantic_prompt: Option<String>,
}

fn rule_matches(rule: &PolicyRule, evidence: &PolicyEvidenceInput) -> bool {
    let connector_match =
        rule.connectors.is_empty() || rule.connectors.contains(&evidence.connector);
    let action_match = rule.actions.is_empty()
        || rule.actions.iter().any(|rule_action| {
            rule_action == &evidence.action
                || match rule_action.strip_suffix(".*") {
                    Some(prefix) => evidence.action.starts_with(&format!("{prefix}.")),
                    None => evidence.action.starts_with(rule_action),
                }
        });
    let domain_match = rule.domains.is_empty()
        || evidence.domains.is_empty()
        || rule
            .domains
            .iter()
            .any(|rule_domain| evidence.domains.contains(rule_domain));

    if !(connector_match && action_match && domain_match) {
        return false;
    }

    if !matches_optional_string_slice(
        &rule.runtime_stacks,
        evidence
            .runtime_target
            .as_ref()
            .map(|target| target.stack.as_str()),
    ) {
        return false;
    }

    if !matches_any_optional_string(
        &rule.sandbox_names,
        &[
            evidence
                .runtime_target
                .as_ref()
                .and_then(|target| target.sandbox_name.as_deref()),
            evidence
                .execution_context
                .as_ref()
                .and_then(|context| context.sandbox_name.as_deref()),
        ],
    ) {
        return false;
    }

    if !matches_any_optional_string(
        &rule.inference_providers,
        &[
            evidence
                .runtime_target
                .as_ref()
                .and_then(|target| target.inference_provider.as_deref()),
            evidence
                .execution_context
                .as_ref()
                .and_then(|context| context.inference_provider.as_deref()),
        ],
    ) {
        return false;
    }

    if !matches_optional_string_slice(
        &rule.orchestrator_platforms,
        evidence
            .orchestrator_ref
            .as_ref()
            .map(|orchestrator| orchestrator.platform.as_str()),
    ) {
        return false;
    }

    if !matches_optional_string_slice(
        &rule.company_ids,
        evidence
            .orchestrator_ref
            .as_ref()
            .and_then(|orchestrator| orchestrator.company_id.as_deref()),
    ) {
        return false;
    }

    if !matches_optional_string_slice(
        &rule.issue_ids,
        evidence
            .orchestrator_ref
            .as_ref()
            .and_then(|orchestrator| orchestrator.issue_id.as_deref()),
    ) {
        return false;
    }

    if !matches_optional_string_slice(
        &rule.goal_ids,
        evidence
            .orchestrator_ref
            .as_ref()
            .and_then(|orchestrator| orchestrator.goal_id.as_deref()),
    ) {
        return false;
    }

    if let Some(rule_trigger) = &rule.trigger_kind {
        if evidence.trigger_kind.as_ref() != Some(rule_trigger) {
            return false;
        }
    }

    if let Some(rule_layer) = &rule.layer {
        if evidence.layer.as_ref() != Some(rule_layer) {
            return false;
        }
    }

    if !matches_optional_string_slice(&rule.trust_levels, evidence.trust_level.as_deref()) {
        return false;
    }

    if !matches_optional_string_slice(&rule.plugin_sources, evidence.plugin_source.as_deref()) {
        return false;
    }

    if !rule.skill_ids.is_empty()
        && !evidence
            .skill_context
            .as_ref()
            .is_some_and(|skill_context| {
                rule.skill_ids
                    .iter()
                    .any(|skill_id| skill_context.active_skills.contains(skill_id))
            })
    {
        return false;
    }

    if !matches_optional_string_slice(
        &rule.prompt_surfaces,
        evidence
            .skill_context
            .as_ref()
            .and_then(|skill_context| skill_context.prompt_surface.as_deref()),
    ) {
        return false;
    }

    if !matches_optional_string_slice(
        &rule.catalog_providers,
        evidence.catalog_provider.as_deref(),
    ) {
        return false;
    }

    true
}

fn matches_optional_string_slice(allowed: &[String], actual: Option<&str>) -> bool {
    allowed.is_empty() || actual.is_some_and(|value| allowed.iter().any(|item| item == value))
}

fn matches_any_optional_string(allowed: &[String], actual_values: &[Option<&str>]) -> bool {
    allowed.is_empty()
        || actual_values
            .iter()
            .any(|value| value.is_some_and(|value| allowed.iter().any(|item| item == value)))
}

fn build_match_reason(rule: &PolicyRule, evidence: &PolicyEvidenceInput) -> String {
    let mut parts = Vec::new();

    if !rule.connectors.is_empty() {
        parts.push(format!("connector={}", evidence.connector));
    }
    if !rule.actions.is_empty() {
        parts.push(format!("action={}", evidence.action));
    }
    if !rule.domains.is_empty() && !evidence.domains.is_empty() {
        parts.push(format!("domain={}", evidence.domains.join(",")));
    }
    if !rule.runtime_stacks.is_empty() {
        if let Some(target) = &evidence.runtime_target {
            parts.push(format!("runtimeStack={}", target.stack));
        }
    }
    if !rule.sandbox_names.is_empty() {
        if let Some(sandbox_name) = evidence
            .runtime_target
            .as_ref()
            .and_then(|target| target.sandbox_name.as_deref())
            .or_else(|| {
                evidence
                    .execution_context
                    .as_ref()
                    .and_then(|context| context.sandbox_name.as_deref())
            })
        {
            parts.push(format!("sandboxName={}", sandbox_name));
        }
    }
    if !rule.inference_providers.is_empty() {
        if let Some(inference_provider) = evidence
            .runtime_target
            .as_ref()
            .and_then(|target| target.inference_provider.as_deref())
            .or_else(|| {
                evidence
                    .execution_context
                    .as_ref()
                    .and_then(|context| context.inference_provider.as_deref())
            })
        {
            parts.push(format!("inferenceProvider={}", inference_provider));
        }
    }
    if !rule.company_ids.is_empty() {
        if let Some(company_id) = evidence
            .orchestrator_ref
            .as_ref()
            .and_then(|orchestrator| orchestrator.company_id.as_deref())
        {
            parts.push(format!("companyId={}", company_id));
        }
    }
    if rule.trigger_kind.is_some() {
        if let Some(trigger_kind) = &evidence.trigger_kind {
            parts.push(format!("triggerKind={}", to_json_string(trigger_kind)));
        }
    }
    if rule.layer.is_some() {
        if let Some(layer) = &evidence.layer {
            parts.push(format!("layer={}", to_json_string(layer)));
        }
    }
    if !rule.trust_levels.is_empty() {
        if let Some(trust_level) = &evidence.trust_level {
            parts.push(format!("trustLevel={}", trust_level));
        }
    }
    if !rule.plugin_sources.is_empty() {
        if let Some(plugin_source) = &evidence.plugin_source {
            parts.push(format!("pluginSource={}", plugin_source));
        }
    }
    if !rule.skill_ids.is_empty() {
        if let Some(skill_context) = &evidence.skill_context {
            parts.push(format!("skill={}", skill_context.active_skills.join(",")));
        }
    }

    if parts.is_empty() {
        "wildcard match".to_string()
    } else {
        parts.join("; ")
    }
}

fn decision_outcome(matched_rules: &[MatchedPolicyRule<'_>]) -> (RuntimeDecisionStatus, String) {
    if let Some(rule) = matched_rules
        .iter()
        .find(|rule| rule.effect == RuntimeDecisionStatus::Deny)
    {
        return (RuntimeDecisionStatus::Deny, decision_reason("Denied", rule));
    }

    if let Some(rule) = matched_rules
        .iter()
        .find(|rule| rule.effect == RuntimeDecisionStatus::Escalate)
    {
        return (
            RuntimeDecisionStatus::Escalate,
            decision_reason("Escalated", rule),
        );
    }

    if let Some(rule) = matched_rules
        .iter()
        .find(|rule| rule.effect == RuntimeDecisionStatus::Warn)
    {
        return (
            RuntimeDecisionStatus::Warn,
            decision_reason("Warning from", rule),
        );
    }

    if let Some(rule) = matched_rules.first() {
        return (
            RuntimeDecisionStatus::Allow,
            decision_reason("Allowed by", rule),
        );
    }

    (
        RuntimeDecisionStatus::Allow,
        "No rules matched — request is allowed by default.".to_string(),
    )
}

fn decision_reason(prefix: &str, matched: &MatchedPolicyRule<'_>) -> String {
    let suffix = matched
        .semantic_prompt
        .as_ref()
        .map(|prompt| format!(" (semantic check: \"{prompt}\")"))
        .unwrap_or_default();
    format!(
        "{prefix} rule \"{}\": {}{suffix}",
        matched.rule.stable_rule_id, matched.rule.title
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticTopicData {
    topics: Vec<SemanticTopic>,
    stop_words: Vec<String>,
    generic_words: Vec<String>,
    match_ratio: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticTopic {
    prompt_triggers: Vec<String>,
    keywords: Vec<String>,
}

fn semantic_topics() -> &'static SemanticTopicData {
    static TOPICS: OnceLock<SemanticTopicData> = OnceLock::new();
    TOPICS.get_or_init(|| {
        // Embedded from inside the crate: include_str! cannot reach outside the
        // crate root in any build that is not a full workspace checkout, and the
        // container images build this crate from its own directory. Generated
        // from the TypeScript topic tables by
        // scripts/generate-worker-policy-data.mjs.
        serde_json::from_str(include_str!("generated/semantic_topics.json"))
            .expect("generated semantic topics must be valid JSON")
    })
}

fn classify_semantic_intent(
    prompt: &str,
    tool_intent: &str,
    plan_summary: &str,
    parameters: &Value,
) -> bool {
    let clean_prompt = prompt.trim().to_lowercase();
    let search_space = format!(
        "{} {} {}",
        tool_intent,
        plan_summary,
        serde_json::to_string(parameters).unwrap_or_default()
    )
    .to_lowercase();
    let mut quote_parts = clean_prompt.split('"').skip(1).step_by(2);
    let mut has_quotes = false;
    for quoted in &mut quote_parts {
        has_quotes = true;
        let exact = quoted.trim();
        if !exact.is_empty() && search_space.contains(exact) {
            return true;
        }
    }
    if has_quotes {
        return false;
    }
    let data = semantic_topics();
    for topic in &data.topics {
        if topic
            .prompt_triggers
            .iter()
            .any(|trigger| clean_prompt.contains(trigger))
            && topic
                .keywords
                .iter()
                .any(|keyword| search_space.contains(keyword))
        {
            return true;
        }
    }
    let words: Vec<&str> = clean_prompt
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| word.len() > 1 && !data.stop_words.iter().any(|stop| stop == word))
        .collect();
    if words.is_empty() {
        return false;
    }
    let matched: Vec<&str> = words
        .iter()
        .copied()
        .filter(|word| search_space.contains(word))
        .collect();
    if (matched.len() as f64 / words.len() as f64) < data.match_ratio {
        return false;
    }
    let non_generic = words
        .iter()
        .filter(|word| !data.generic_words.iter().any(|generic| generic == **word))
        .count();
    non_generic == 0
        || matched
            .iter()
            .any(|word| !data.generic_words.iter().any(|generic| generic == *word))
}

fn evaluate_parameter_constraints(
    constraints: &[PolicyParameterConstraint],
    parameters: &Value,
) -> Option<Option<RuntimeDecisionStatus>> {
    let mut effect = None;
    for constraint in constraints {
        let actual = read_dot_path(parameters, &constraint.field);
        if !compare_constraint_value(&constraint.operator, actual, &constraint.value) {
            return None;
        }
        if constraint.effect.is_some() {
            effect = constraint.effect.clone();
        }
    }
    Some(effect)
}

fn read_dot_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.')
        .try_fold(value, |current, segment| current.as_object()?.get(segment))
}

fn compare_constraint_value(operator: &str, actual: Option<&Value>, expected: &Value) -> bool {
    match operator {
        "eq" => actual == Some(expected),
        "neq" => actual != Some(expected),
        "gt" | "gte" | "lt" | "lte" => match (actual.and_then(Value::as_f64), expected.as_f64()) {
            (Some(actual), Some(expected)) => match operator {
                "gt" => actual > expected,
                "gte" => actual >= expected,
                "lt" => actual < expected,
                _ => actual <= expected,
            },
            _ => false,
        },
        "in" | "not_in" => match expected.as_array() {
            Some(values) => {
                let found = actual.is_some_and(|actual| values.iter().any(|value| value == actual));
                if operator == "in" {
                    found
                } else {
                    !found
                }
            }
            None => false,
        },
        "contains" => match (actual.and_then(Value::as_str), expected.as_str()) {
            (Some(actual), Some(expected)) => actual.contains(expected),
            _ => false,
        },
        _ => false,
    }
}

fn to_json_string<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ConformanceExpected {
        status: RuntimeDecisionStatus,
        matched_refs: Vec<String>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ConformanceCase {
        description: String,
        #[serde(flatten)]
        input: PolicyEvaluationInput,
        expected: ConformanceExpected,
    }

    #[derive(Deserialize)]
    struct ConformanceCorpus {
        contract: ConformanceContract,
        cases: Vec<ConformanceCase>,
        #[serde(rename = "compositionCases")]
        composition_cases: Vec<CompositionCase>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ConformanceContract {
        evaluator_version: String,
        request_schema_version: String,
        result_schema_version: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CompositionCase {
        description: String,
        layers: Vec<CompositionLayer>,
        expected_rule_ids: Vec<String>,
        expected_effects: Vec<RuntimeDecisionStatus>,
        expected_conflict_notes: Vec<String>,
    }

    #[test]
    fn published_rule_corpus_matches_typescript_reference() {
        let corpus: ConformanceCorpus =
            serde_json::from_str(include_str!("../../../../conformance/policy-rules.json"))
                .expect("published evaluator corpus must be valid JSON");
        assert_eq!(corpus.contract.evaluator_version, "1.0");
        assert_eq!(corpus.contract.request_schema_version, "1.0");
        assert_eq!(corpus.contract.result_schema_version, "1.0");
        assert!(!corpus.cases.is_empty());

        for case in corpus.cases {
            let result = evaluate_policy_decision(case.input);
            assert_eq!(result.status, case.expected.status, "{}", case.description);
            assert_eq!(
                result.matched_refs, case.expected.matched_refs,
                "{}",
                case.description
            );
        }
        for case in corpus.composition_cases {
            let result = compose_policy_layers(&case.layers);
            assert_eq!(
                result
                    .effective_rules
                    .iter()
                    .map(|rule| &rule.stable_rule_id)
                    .collect::<Vec<_>>(),
                case.expected_rule_ids.iter().collect::<Vec<_>>(),
                "{}",
                case.description
            );
            assert_eq!(
                result
                    .effective_rules
                    .iter()
                    .map(|rule| &rule.effect)
                    .collect::<Vec<_>>(),
                case.expected_effects.iter().collect::<Vec<_>>(),
                "{}",
                case.description
            );
            assert_eq!(
                result.conflict_notes, case.expected_conflict_notes,
                "{}",
                case.description
            );
        }
    }

    fn baseline_rule() -> PolicyRule {
        PolicyRule {
            stable_rule_id: "runtime.test".to_string(),
            title: "Test runtime condition".to_string(),
            effect: RuntimeDecisionStatus::Deny,
            domains: vec![],
            connectors: vec!["runtime".to_string()],
            actions: vec!["tool.call".to_string()],
            immutable: false,
            semantic_checks: vec![],
            parameter_constraints: vec![],
            runtime_stacks: vec![],
            sandbox_names: vec![],
            inference_providers: vec![],
            orchestrator_platforms: vec![],
            company_ids: vec![],
            issue_ids: vec![],
            goal_ids: vec![],
            trigger_kind: None,
            layer: None,
            trust_levels: vec![],
            plugin_sources: vec![],
            skill_ids: vec![],
            prompt_surfaces: vec![],
            catalog_providers: vec![],
        }
    }

    fn baseline_evidence() -> PolicyEvidenceInput {
        PolicyEvidenceInput {
            connector: "runtime".to_string(),
            action: "tool.call".to_string(),
            domains: vec![],
            runtime_target: None,
            execution_context: None,
            orchestrator_ref: None,
            skill_context: None,
            trigger_kind: None,
            layer: None,
            trust_level: None,
            plugin_source: None,
            catalog_provider: None,
        }
    }

    #[test]
    fn trigger_kind_scheduled_matches_scheduled_record() {
        let rule = PolicyRule {
            trigger_kind: Some(TriggerKind::Scheduled),
            ..baseline_rule()
        };
        let evidence = PolicyEvidenceInput {
            trigger_kind: Some(TriggerKind::Scheduled),
            ..baseline_evidence()
        };

        assert!(rule_matches(&rule, &evidence));
    }

    #[test]
    fn trigger_kind_scheduled_does_not_match_interactive_record() {
        let rule = PolicyRule {
            trigger_kind: Some(TriggerKind::Scheduled),
            ..baseline_rule()
        };
        let evidence = PolicyEvidenceInput {
            trigger_kind: Some(TriggerKind::Interactive),
            ..baseline_evidence()
        };

        assert!(!rule_matches(&rule, &evidence));
    }

    #[test]
    fn layer_sandbox_matches_sandbox_record() {
        let rule = PolicyRule {
            layer: Some(EvidenceLayer::Sandbox),
            ..baseline_rule()
        };
        let evidence = PolicyEvidenceInput {
            layer: Some(EvidenceLayer::Sandbox),
            ..baseline_evidence()
        };

        assert!(rule_matches(&rule, &evidence));
    }

    #[test]
    fn layer_sandbox_does_not_match_agent_record() {
        let rule = PolicyRule {
            layer: Some(EvidenceLayer::Sandbox),
            ..baseline_rule()
        };
        let evidence = PolicyEvidenceInput {
            layer: Some(EvidenceLayer::Agent),
            ..baseline_evidence()
        };

        assert!(!rule_matches(&rule, &evidence));
    }

    #[test]
    fn no_trigger_kind_condition_matches_any_trigger() {
        let rule = PolicyRule {
            trigger_kind: None,
            ..baseline_rule()
        };
        let evidence = PolicyEvidenceInput {
            trigger_kind: Some(TriggerKind::GatewayMessage),
            ..baseline_evidence()
        };

        assert!(rule_matches(&rule, &evidence));
    }

    #[test]
    fn runtime_stack_condition_matches_runtime_target_stack() {
        let rule = PolicyRule {
            runtime_stacks: vec!["PAPERCLIP".to_string()],
            ..baseline_rule()
        };
        let evidence = PolicyEvidenceInput {
            runtime_target: Some(RuntimeTargetEvidence {
                stack: "PAPERCLIP".to_string(),
                ..RuntimeTargetEvidence::default()
            }),
            ..baseline_evidence()
        };

        assert!(rule_matches(&rule, &evidence));
    }

    #[test]
    fn deployment_metadata_conditions_match_runtime_target() {
        let rule = PolicyRule {
            sandbox_names: vec!["nemo-prod".to_string()],
            inference_providers: vec!["nim-local".to_string()],
            ..baseline_rule()
        };
        let evidence = PolicyEvidenceInput {
            runtime_target: Some(RuntimeTargetEvidence {
                stack: "NEMOCLAW".to_string(),
                sandbox_name: Some("nemo-prod".to_string()),
                inference_provider: Some("nim-local".to_string()),
                ..RuntimeTargetEvidence::default()
            }),
            ..baseline_evidence()
        };

        assert!(rule_matches(&rule, &evidence));
    }

    #[test]
    fn orchestrator_company_scope_matches_paperclip_company() {
        let rule = PolicyRule {
            orchestrator_platforms: vec!["paperclip".to_string()],
            company_ids: vec!["company-123".to_string()],
            ..baseline_rule()
        };
        let evidence = PolicyEvidenceInput {
            orchestrator_ref: Some(OrchestratorRefEvidence {
                platform: "paperclip".to_string(),
                company_id: Some("company-123".to_string()),
                ..OrchestratorRefEvidence::default()
            }),
            ..baseline_evidence()
        };

        assert!(rule_matches(&rule, &evidence));
    }

    #[test]
    fn prompt_skill_and_plugin_provenance_conditions_match() {
        let rule = PolicyRule {
            skill_ids: vec!["risk-review".to_string()],
            prompt_surfaces: vec!["before_prompt_build".to_string()],
            plugin_sources: vec!["corporate_private".to_string()],
            trust_levels: vec!["restricted".to_string()],
            catalog_providers: vec!["paperclip".to_string()],
            ..baseline_rule()
        };
        let evidence = PolicyEvidenceInput {
            skill_context: Some(SkillContextEvidence {
                active_skills: vec!["risk-review".to_string()],
                prompt_surface: Some("before_prompt_build".to_string()),
                ..SkillContextEvidence::default()
            }),
            plugin_source: Some("corporate_private".to_string()),
            trust_level: Some("restricted".to_string()),
            catalog_provider: Some("paperclip".to_string()),
            ..baseline_evidence()
        };

        assert!(rule_matches(&rule, &evidence));
    }

    #[test]
    fn gateway_decision_matches_typescript_thresholds() {
        assert_eq!(
            evaluate_gateway_decision(GatewayDecisionInput::default()).outcome,
            GatewayOutcome::Proceed
        );
        assert_eq!(
            evaluate_gateway_decision(GatewayDecisionInput {
                consequence: Some("high".to_string()),
                ..GatewayDecisionInput::default()
            })
            .outcome,
            GatewayOutcome::Escalate
        );
        assert_eq!(
            evaluate_gateway_decision(GatewayDecisionInput {
                consequence: Some("IRREVERSIBLE".to_string()),
                ..GatewayDecisionInput::default()
            })
            .outcome,
            GatewayOutcome::Abort
        );
    }
}
