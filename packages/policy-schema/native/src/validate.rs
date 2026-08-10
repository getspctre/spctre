//! Deterministic bundle acceptance.
//!
//! These are the checks enforcement depends on: whether every rule in a bundle
//! can be evaluated at all, and whether the layers are ordered as composition
//! expects. They live in the kernel because the failures they catch are silent
//! in the evaluator — an unknown constraint operator or a mistyped comparison
//! value makes `compare_constraint_value` return false forever, so the rule
//! never matches and the policy looks published and healthy while enforcing
//! nothing.
//!
//! Parsing an authored document into rules is deliberately *not* here. That is
//! an authoring concern with its own round-trip fidelity requirements (AGT-native
//! fields must survive import and export), and it does not change what a
//! decision means. Adapter coverage and control-mapping checks stay with the
//! host for the same reason.

use serde::{Deserialize, Serialize};

use serde_json::Value;

use crate::types::RuntimeDecisionStatus;

/// Scope precedence, least to most specific. Composition applies later layers
/// over earlier ones, so a host that submits them out of order silently inverts
/// which policy wins.
const SCOPE_PRECEDENCE: [&str; 4] = ["ORGANIZATION", "WORKSPACE", "ENVIRONMENT", "CONNECTOR"];

const SUPPORTED_OPERATORS: [&str; 9] = [
    "eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "contains",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ValidationSeverity {
    /// The bundle cannot be enforced as written.
    Error,
    /// Enforceable, but likely not what the author meant.
    Warning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyBundleValidationIssue {
    pub severity: ValidationSeverity,
    /// Stable, machine-readable reason. Hosts may group or suppress on this.
    pub code: String,
    pub message: String,
    pub stable_rule_id: Option<String>,
    pub layer_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyBundleValidation {
    /// False when any issue is an error. Warnings do not block.
    pub valid: bool,
    pub issues: Vec<PolicyBundleValidationIssue>,
}

/// Validation deliberately parses a *lenient* view of a rule rather than reusing
/// the evaluator's strict type.
///
/// A validator that refuses to deserialize its input can only throw, which turns
/// "this policy has a problem" into "the publish request failed" — the caller
/// learns nothing actionable. Every field here is optional so that a missing or
/// malformed one is reported as an issue with a rule ID attached, including the
/// ones the evaluator would reject outright.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationRule {
    #[serde(default)]
    pub stable_rule_id: String,
    #[serde(default)]
    pub effect: Option<Value>,
    #[serde(default, deserialize_with = "crate::types::null_to_default")]
    pub domains: Vec<String>,
    #[serde(default, deserialize_with = "crate::types::null_to_default")]
    pub connectors: Vec<String>,
    #[serde(default, deserialize_with = "crate::types::null_to_default")]
    pub actions: Vec<String>,
    #[serde(default, deserialize_with = "crate::types::null_to_default")]
    pub semantic_checks: Vec<ValidationSemanticCheck>,
    #[serde(default, deserialize_with = "crate::types::null_to_default")]
    pub parameter_constraints: Vec<ValidationConstraint>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationSemanticCheck {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub prompt: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationConstraint {
    #[serde(default)]
    pub field: String,
    #[serde(default)]
    pub operator: String,
    #[serde(default)]
    pub value: Value,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationLayer {
    #[serde(default)]
    pub scope: String,
    #[serde(default, deserialize_with = "crate::types::null_to_default")]
    pub rules: Vec<ValidationRule>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyBundleValidationRequest {
    #[serde(default, deserialize_with = "crate::types::null_to_default")]
    pub layers: Vec<ValidationLayer>,
    /// A single unlayered rule set, for hosts validating one revision.
    #[serde(default, deserialize_with = "crate::types::null_to_default")]
    pub rules: Vec<ValidationRule>,
}

pub fn validate_policy_bundle(request: &PolicyBundleValidationRequest) -> PolicyBundleValidation {
    let mut issues = Vec::new();

    if request.layers.is_empty() {
        validate_rules(&request.rules, None, &mut issues);
    } else {
        validate_layer_order(&request.layers, &mut issues);
        for (index, layer) in request.layers.iter().enumerate() {
            if !SCOPE_PRECEDENCE.contains(&layer.scope.as_str()) {
                issues.push(issue(
                    ValidationSeverity::Error,
                    "unknown_scope",
                    format!(
                        "Layer scope \"{}\" is not one of {}.",
                        layer.scope,
                        SCOPE_PRECEDENCE.join(", ")
                    ),
                    None,
                    Some(index),
                ));
            }
            validate_rules(&layer.rules, Some(index), &mut issues);
        }
    }

    let valid = !issues
        .iter()
        .any(|entry| entry.severity == ValidationSeverity::Error);
    PolicyBundleValidation { valid, issues }
}

fn validate_layer_order(layers: &[ValidationLayer], issues: &mut Vec<PolicyBundleValidationIssue>) {
    let rank = |scope: &str| SCOPE_PRECEDENCE.iter().position(|known| *known == scope);
    let mut highest = 0usize;
    for (index, layer) in layers.iter().enumerate() {
        let Some(current) = rank(&layer.scope) else {
            continue; // Reported separately as an unknown scope.
        };
        if current < highest {
            issues.push(issue(
                ValidationSeverity::Error,
                "layer_order",
                format!(
                    "Layer {} ({}) is less specific than a preceding layer, which inverts precedence.",
                    index, layer.scope
                ),
                None,
                Some(index),
            ));
        }
        highest = highest.max(current);
    }
}

fn validate_rules(
    rules: &[ValidationRule],
    layer_index: Option<usize>,
    issues: &mut Vec<PolicyBundleValidationIssue>,
) {
    let mut seen: Vec<&str> = Vec::with_capacity(rules.len());
    for rule in rules {
        if rule.stable_rule_id.trim().is_empty() {
            issues.push(issue(
                ValidationSeverity::Error,
                "missing_rule_id",
                "Rule has no stable rule ID, so it cannot be composed or traced.".to_string(),
                None,
                layer_index,
            ));
        } else if seen.contains(&rule.stable_rule_id.as_str()) {
            // Across layers a repeated ID is an intentional override. Within one
            // layer it is ambiguous: composition keeps one and drops the other.
            issues.push(issue(
                ValidationSeverity::Error,
                "duplicate_rule_id",
                format!(
                    "Rule ID \"{}\" appears more than once in the same layer; one of them would be silently dropped.",
                    rule.stable_rule_id
                ),
                Some(rule.stable_rule_id.clone()),
                layer_index,
            ));
        }
        seen.push(&rule.stable_rule_id);

        validate_effect(rule, layer_index, issues);
        validate_actions(rule, layer_index, issues);
        for check in &rule.semantic_checks {
            validate_semantic_check(rule, check, layer_index, issues);
        }
        for constraint in &rule.parameter_constraints {
            validate_parameter_constraint(rule, constraint, layer_index, issues);
        }

        if rule.connectors.is_empty() && rule.actions.is_empty() && rule.domains.is_empty() {
            issues.push(issue(
                ValidationSeverity::Warning,
                "matches_everything",
                format!(
                    "Rule \"{}\" constrains no connector, action or domain, so it matches every request.",
                    rule.stable_rule_id
                ),
                Some(rule.stable_rule_id.clone()),
                layer_index,
            ));
        }
    }
}

/// An unknown or absent effect is rejected by the evaluator when it loads the
/// bundle, which would surface as a failed decision rather than as a policy
/// problem. Naming it here means the author sees it at authoring time.
fn validate_effect(
    rule: &ValidationRule,
    layer_index: Option<usize>,
    issues: &mut Vec<PolicyBundleValidationIssue>,
) {
    let known: Vec<String> = supported_effects()
        .iter()
        .filter_map(|effect| serde_json::to_value(effect).ok())
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect();
    let effect = rule
        .effect
        .as_ref()
        .and_then(|value| value.as_str().map(str::to_string));
    match effect {
        Some(effect) if known.contains(&effect) => {}
        Some(effect) => issues.push(issue(
            ValidationSeverity::Error,
            "unknown_effect",
            format!(
                "Rule \"{}\" has effect \"{effect}\", which is not one of {}.",
                rule.stable_rule_id,
                known.join(", ")
            ),
            Some(rule.stable_rule_id.clone()),
            layer_index,
        )),
        None => issues.push(issue(
            ValidationSeverity::Error,
            "missing_effect",
            format!(
                "Rule \"{}\" has no effect, so there is nothing to enforce.",
                rule.stable_rule_id
            ),
            Some(rule.stable_rule_id.clone()),
            layer_index,
        )),
    }
}

/// The evaluator treats a non-`.*` pattern as a literal prefix. An author who
/// writes `charge.*.refund` therefore gets a rule that matches nothing, with no
/// error anywhere.
fn validate_actions(
    rule: &ValidationRule,
    layer_index: Option<usize>,
    issues: &mut Vec<PolicyBundleValidationIssue>,
) {
    for action in &rule.actions {
        if action.trim().is_empty() {
            issues.push(issue(
                ValidationSeverity::Error,
                "empty_action",
                format!(
                    "Rule \"{}\" has a blank action pattern.",
                    rule.stable_rule_id
                ),
                Some(rule.stable_rule_id.clone()),
                layer_index,
            ));
            continue;
        }
        let wildcards = action.matches('*').count();
        if wildcards > 0 && !action.ends_with(".*") {
            issues.push(issue(
                ValidationSeverity::Error,
                "unsupported_wildcard",
                format!(
                    "Action \"{action}\" in rule \"{}\" uses a wildcard other than a trailing \".*\"; it would be matched as a literal prefix.",
                    rule.stable_rule_id
                ),
                Some(rule.stable_rule_id.clone()),
                layer_index,
            ));
        } else if wildcards > 1 {
            issues.push(issue(
                ValidationSeverity::Error,
                "unsupported_wildcard",
                format!(
                    "Action \"{action}\" in rule \"{}\" has more than one wildcard.",
                    rule.stable_rule_id
                ),
                Some(rule.stable_rule_id.clone()),
                layer_index,
            ));
        }
    }
}

fn validate_semantic_check(
    rule: &ValidationRule,
    check: &ValidationSemanticCheck,
    layer_index: Option<usize>,
    issues: &mut Vec<PolicyBundleValidationIssue>,
) {
    if check.prompt.trim().is_empty() {
        issues.push(issue(
            ValidationSeverity::Error,
            "empty_semantic_prompt",
            format!(
                "Semantic check \"{}\" in rule \"{}\" has an empty prompt, so it can never confirm a match.",
                check.id, rule.stable_rule_id
            ),
            Some(rule.stable_rule_id.clone()),
            layer_index,
        ));
    }
}

fn validate_parameter_constraint(
    rule: &ValidationRule,
    constraint: &ValidationConstraint,
    layer_index: Option<usize>,
    issues: &mut Vec<PolicyBundleValidationIssue>,
) {
    let mut push = |code: &str, message: String| {
        issues.push(issue(
            ValidationSeverity::Error,
            code,
            message,
            Some(rule.stable_rule_id.clone()),
            layer_index,
        ));
    };

    if constraint.field.trim().is_empty() {
        push(
            "empty_constraint_field",
            format!(
                "A parameter constraint in rule \"{}\" names no field.",
                rule.stable_rule_id
            ),
        );
    }

    if !SUPPORTED_OPERATORS.contains(&constraint.operator.as_str()) {
        push(
            "unknown_operator",
            format!(
                "Operator \"{}\" in rule \"{}\" is not supported, so the constraint can never be satisfied. Supported: {}.",
                constraint.operator,
                rule.stable_rule_id,
                SUPPORTED_OPERATORS.join(", ")
            ),
        );
        return;
    }

    // A value of the wrong shape for the operator is compared as a mismatch
    // forever, which reads as "policy allows it" rather than "policy is broken".
    let mismatch = match constraint.operator.as_str() {
        "gt" | "gte" | "lt" | "lte" => (!constraint.value.is_number()).then_some("a number"),
        "in" | "not_in" => (!constraint.value.is_array()).then_some("an array"),
        "contains" => (!constraint.value.is_string()).then_some("a string"),
        _ => None,
    };
    if let Some(expected) = mismatch {
        push(
            "constraint_value_type",
            format!(
                "Operator \"{}\" in rule \"{}\" requires {expected} value, so this constraint can never be satisfied.",
                constraint.operator, rule.stable_rule_id
            ),
        );
    }
}

/// Every effect the kernel understands. A bundle carrying anything else fails to
/// deserialize before it reaches validation, so this exists to keep the status
/// list in one place for hosts that enumerate it.
pub fn supported_effects() -> [RuntimeDecisionStatus; 4] {
    [
        RuntimeDecisionStatus::Allow,
        RuntimeDecisionStatus::Warn,
        RuntimeDecisionStatus::Escalate,
        RuntimeDecisionStatus::Deny,
    ]
}

fn issue(
    severity: ValidationSeverity,
    code: &str,
    message: String,
    stable_rule_id: Option<String>,
    layer_index: Option<usize>,
) -> PolicyBundleValidationIssue {
    PolicyBundleValidationIssue {
        severity,
        code: code.to_string(),
        message,
        stable_rule_id,
        layer_index,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse(request: serde_json::Value) -> PolicyBundleValidation {
        let request: PolicyBundleValidationRequest = serde_json::from_value(request).unwrap();
        validate_policy_bundle(&request)
    }

    fn codes(validation: &PolicyBundleValidation) -> Vec<&str> {
        validation
            .issues
            .iter()
            .map(|issue| issue.code.as_str())
            .collect()
    }

    fn rule(extra: serde_json::Value) -> serde_json::Value {
        let mut base = json!({
            "stableRuleId": "r1",
            "title": "Rule",
            "effect": "DENY",
            "domains": [],
            "connectors": ["stripe"],
            "actions": ["charge"],
            "immutable": false,
        });
        let (object, extra) = (base.as_object_mut().unwrap(), extra);
        for (key, value) in extra.as_object().unwrap() {
            object.insert(key.clone(), value.clone());
        }
        base
    }

    #[test]
    fn accepts_an_enforceable_bundle() {
        let validation = parse(json!({ "rules": [rule(json!({}))] }));
        assert!(validation.valid);
        assert!(validation.issues.is_empty());
    }

    #[test]
    fn rejects_an_unknown_constraint_operator() {
        let validation = parse(json!({
            "rules": [rule(json!({
                "parameterConstraints": [{ "field": "amount", "operator": "approximately", "value": 5 }]
            }))]
        }));
        assert!(!validation.valid);
        assert_eq!(codes(&validation), vec!["unknown_operator"]);
    }

    #[test]
    fn rejects_a_comparison_against_a_non_numeric_value() {
        let validation = parse(json!({
            "rules": [rule(json!({
                "parameterConstraints": [{ "field": "amount", "operator": "gte", "value": "5000" }]
            }))]
        }));
        assert!(!validation.valid);
        assert_eq!(codes(&validation), vec!["constraint_value_type"]);
    }

    #[test]
    fn rejects_membership_against_a_non_array_value() {
        let validation = parse(json!({
            "rules": [rule(json!({
                "parameterConstraints": [{ "field": "tier", "operator": "in", "value": "gold" }]
            }))]
        }));
        assert!(!validation.valid);
        assert_eq!(codes(&validation), vec!["constraint_value_type"]);
    }

    #[test]
    fn rejects_a_wildcard_that_is_not_a_trailing_star() {
        let validation = parse(json!({
            "rules": [rule(json!({ "actions": ["charge.*.refund"] }))]
        }));
        assert!(!validation.valid);
        assert_eq!(codes(&validation), vec!["unsupported_wildcard"]);
    }

    #[test]
    fn accepts_a_trailing_wildcard() {
        let validation = parse(json!({
            "rules": [rule(json!({ "actions": ["charge.*"] }))]
        }));
        assert!(validation.valid);
    }

    #[test]
    fn rejects_a_duplicate_rule_id_within_one_layer() {
        let validation = parse(json!({
            "layers": [{
                "scope": "WORKSPACE",
                "rules": [rule(json!({})), rule(json!({ "title": "Other" }))]
            }]
        }));
        assert!(!validation.valid);
        assert_eq!(codes(&validation), vec!["duplicate_rule_id"]);
    }

    // The same ID across layers is the documented override path, not an error.
    #[test]
    fn accepts_the_same_rule_id_across_layers() {
        let validation = parse(json!({
            "layers": [
                { "scope": "ORGANIZATION", "rules": [rule(json!({}))] },
                { "scope": "WORKSPACE", "rules": [rule(json!({ "effect": "ALLOW" }))] }
            ]
        }));
        assert!(validation.valid, "{:?}", validation.issues);
    }

    #[test]
    fn rejects_layers_submitted_out_of_precedence_order() {
        let validation = parse(json!({
            "layers": [
                { "scope": "CONNECTOR", "rules": [rule(json!({}))] },
                { "scope": "ORGANIZATION", "rules": [rule(json!({ "stableRuleId": "r2" }))] }
            ]
        }));
        assert!(!validation.valid);
        assert_eq!(codes(&validation), vec!["layer_order"]);
    }

    #[test]
    fn rejects_an_unknown_scope() {
        let validation = parse(json!({
            "layers": [{ "scope": "TEAM", "rules": [rule(json!({}))] }]
        }));
        assert!(!validation.valid);
        assert_eq!(codes(&validation), vec!["unknown_scope"]);
    }

    #[test]
    fn rejects_an_empty_semantic_prompt() {
        let validation = parse(json!({
            "rules": [rule(json!({
                "semanticChecks": [{ "id": "s1", "prompt": "   " }]
            }))]
        }));
        assert!(!validation.valid);
        assert_eq!(codes(&validation), vec!["empty_semantic_prompt"]);
    }

    #[test]
    fn warns_without_blocking_on_a_rule_that_matches_everything() {
        let validation = parse(json!({
            "rules": [rule(json!({ "connectors": [], "actions": [], "domains": [] }))]
        }));
        assert!(validation.valid);
        assert_eq!(codes(&validation), vec!["matches_everything"]);
        assert_eq!(validation.issues[0].severity, ValidationSeverity::Warning);
    }

    // A validator must report, never throw: a rule missing fields the evaluator
    // requires has to come back as an issue naming the rule.
    #[test]
    fn reports_a_rule_with_no_effect_instead_of_failing_to_parse() {
        let validation =
            parse(json!({ "rules": [{ "stableRuleId": "r1", "actions": ["charge"] }] }));
        assert!(!validation.valid);
        assert_eq!(codes(&validation), vec!["missing_effect"]);
        assert_eq!(validation.issues[0].stable_rule_id.as_deref(), Some("r1"));
    }

    #[test]
    fn rejects_an_unknown_effect() {
        let validation = parse(json!({
            "rules": [rule(json!({ "effect": "PROBABLY" }))]
        }));
        assert!(!validation.valid);
        assert_eq!(codes(&validation), vec!["unknown_effect"]);
    }

    // Cosmetic fields the evaluator needs but validation does not judge must not
    // turn into a parse failure.
    #[test]
    fn ignores_a_missing_title() {
        let validation = parse(json!({
            "rules": [{ "stableRuleId": "r1", "effect": "DENY", "actions": ["charge"], "connectors": ["stripe"] }]
        }));
        assert!(validation.valid, "{:?}", validation.issues);
    }

    #[test]
    fn reports_the_layer_an_issue_came_from() {
        let validation = parse(json!({
            "layers": [
                { "scope": "ORGANIZATION", "rules": [rule(json!({}))] },
                { "scope": "WORKSPACE", "rules": [rule(json!({
                    "stableRuleId": "r2",
                    "parameterConstraints": [{ "field": "x", "operator": "nope", "value": 1 }]
                }))] }
            ]
        }));
        assert!(!validation.valid);
        assert_eq!(validation.issues[0].layer_index, Some(1));
        assert_eq!(validation.issues[0].stable_rule_id.as_deref(), Some("r2"));
    }
}
