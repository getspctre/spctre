use serde::Serialize;

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
    let mut trace = Vec::with_capacity(input.rules.len());
    let mut matched_refs = Vec::new();
    let mut matched_rules = Vec::new();

    for rule in &input.rules {
        let matched = rule_matches(rule, &input.evidence);
        let match_reason = if matched {
            build_match_reason(rule, &input.evidence)
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
            matched_rules.push(rule);
        }
    }

    let (status, reason) = decision_outcome(&matched_rules);

    EvaluationResult {
        status,
        matched_refs,
        reason,
        trace,
        rule_count: input.rules.len(),
        evaluated_at: input
            .evaluated_at
            .unwrap_or_else(|| "native-evaluator".to_string()),
    }
}

fn rule_matches(rule: &PolicyRule, evidence: &PolicyEvidenceInput) -> bool {
    let connector_match =
        rule.connectors.is_empty() || rule.connectors.contains(&evidence.connector);
    let action_match = rule.actions.is_empty()
        || rule.actions.iter().any(|rule_action| {
            rule_action == &evidence.action
                || rule_action
                    .strip_suffix(".*")
                    .is_some_and(|prefix| evidence.action.starts_with(&format!("{prefix}.")))
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

fn decision_outcome(matched_rules: &[&PolicyRule]) -> (RuntimeDecisionStatus, String) {
    if let Some(rule) = matched_rules
        .iter()
        .find(|rule| rule.effect == RuntimeDecisionStatus::Deny)
    {
        return (
            RuntimeDecisionStatus::Deny,
            format!("Denied by rule \"{}\": {}", rule.stable_rule_id, rule.title),
        );
    }

    if let Some(rule) = matched_rules
        .iter()
        .find(|rule| rule.effect == RuntimeDecisionStatus::Escalate)
    {
        return (
            RuntimeDecisionStatus::Escalate,
            format!(
                "Escalated by rule \"{}\": {}",
                rule.stable_rule_id, rule.title
            ),
        );
    }

    if let Some(rule) = matched_rules
        .iter()
        .find(|rule| rule.effect == RuntimeDecisionStatus::Warn)
    {
        return (
            RuntimeDecisionStatus::Warn,
            format!(
                "Warning from rule \"{}\": {}",
                rule.stable_rule_id, rule.title
            ),
        );
    }

    if let Some(rule) = matched_rules.first() {
        return (
            RuntimeDecisionStatus::Allow,
            format!(
                "Allowed by rule \"{}\": {}",
                rule.stable_rule_id, rule.title
            ),
        );
    }

    (
        RuntimeDecisionStatus::Allow,
        "No rules matched — request is allowed by default.".to_string(),
    )
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

    fn baseline_rule() -> PolicyRule {
        PolicyRule {
            stable_rule_id: "runtime.test".to_string(),
            title: "Test runtime condition".to_string(),
            effect: RuntimeDecisionStatus::Deny,
            domains: vec![],
            connectors: vec!["runtime".to_string()],
            actions: vec!["tool.call".to_string()],
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
