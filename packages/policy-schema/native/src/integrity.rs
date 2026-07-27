use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::types::*;

pub fn canonical_json(value: &Value) -> String {
    serde_json::to_string(&canonicalize(value)).expect("canonical JSON serialization cannot fail")
}

pub fn build_operations_content_hash(input: &OperationsLogHashInput) -> String {
    let payload_hash = sha256_hex(canonical_json(&input.payload).as_bytes());
    let mut source = Map::new();
    source.insert("actorId".to_string(), Value::String(input.actor_id.clone()));
    source.insert(
        "eventType".to_string(),
        Value::String(input.event_type.clone()),
    );
    source.insert("payloadHash".to_string(), Value::String(payload_hash));
    source.insert(
        "prevHash".to_string(),
        input
            .prev_hash
            .clone()
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    source.insert(
        "sourceId".to_string(),
        input
            .source_id
            .clone()
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    source.insert(
        "sourceTable".to_string(),
        input
            .source_table
            .clone()
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    format!(
        "sha256:{}",
        sha256_hex(canonical_json(&Value::Object(source)).as_bytes())
    )
}

pub fn validate_operations_log_chain(entries: &[OperationsLogChainEntry]) -> Vec<ChainIssue> {
    let mut issues = Vec::new();

    for (index, entry) in entries.iter().enumerate() {
        let expected_content_hash = build_operations_content_hash(&OperationsLogHashInput {
            event_type: entry.event_type.clone(),
            source_id: entry.source_id.clone(),
            source_table: entry.source_table.clone(),
            actor_id: entry.actor_id.clone(),
            payload: entry.payload.clone(),
            prev_hash: entry.prev_hash.clone(),
        });
        if entry.content_hash != expected_content_hash {
            issues.push(ChainIssue {
                entry_id: entry.id.clone(),
                created_at: entry.created_at.clone(),
                kind: ChainIssueKind::ContentHashMismatch,
                expected: Some(expected_content_hash),
                actual: Some(entry.content_hash.clone()),
            });
        }

        if index > 0 {
            let expected_prev = entries[index - 1].content_hash.clone();
            if entry.prev_hash.as_deref() != Some(expected_prev.as_str()) {
                issues.push(ChainIssue {
                    entry_id: entry.id.clone(),
                    created_at: entry.created_at.clone(),
                    kind: ChainIssueKind::PrevHashMismatch,
                    expected: Some(expected_prev),
                    actual: entry.prev_hash.clone(),
                });
            }
        }
    }

    issues
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(canonicalize).collect()),
        Value::Object(object) => {
            let mut out = Map::new();
            let mut keys: Vec<_> = object.keys().collect();
            keys.sort();
            for key in keys {
                out.insert(key.clone(), canonicalize(&object[key]));
            }
            Value::Object(out)
        }
        _ => value.clone(),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn operations_hash_matches_typescript_fixture() {
        let hash = build_operations_content_hash(&OperationsLogHashInput {
            event_type: "EVIDENCE_INGEST".to_string(),
            source_id: Some("ev-42".to_string()),
            source_table: Some("runtime_evidence_event".to_string()),
            actor_id: "svc-1".to_string(),
            payload: json!({ "status": "ALLOW", "nested": { "b": 2, "a": 1 } }),
            prev_hash: Some("sha256:previous".to_string()),
        });
        assert_eq!(
            hash,
            "sha256:a19a83ee12d8df3f1fc7b5228b17278a63b03eade7a2a216ecdb7681f44bf9ad"
        );
    }

    #[test]
    fn validates_content_and_prev_hashes() {
        let first_input = OperationsLogHashInput {
            event_type: "POLICY_PUBLISH".to_string(),
            source_id: Some("rev-1".to_string()),
            source_table: Some("policy_revision".to_string()),
            actor_id: "user-1".to_string(),
            payload: json!({ "artifactHash": "sha256:artifact" }),
            prev_hash: None,
        };
        let first_hash = build_operations_content_hash(&first_input);
        let second_input = OperationsLogHashInput {
            event_type: "EVIDENCE_INGEST".to_string(),
            source_id: Some("dec-1".to_string()),
            source_table: Some("runtime_evidence_event".to_string()),
            actor_id: "svc-1".to_string(),
            payload: json!({ "status": "ALLOW" }),
            prev_hash: Some(first_hash.clone()),
        };
        let second_hash = build_operations_content_hash(&second_input);

        let entries = vec![
            OperationsLogChainEntry {
                id: "op-1".to_string(),
                content_hash: first_hash,
                created_at: "2026-05-13T18:00:00.000Z".to_string(),
                event_type: first_input.event_type,
                source_id: first_input.source_id,
                source_table: first_input.source_table,
                actor_id: first_input.actor_id,
                payload: first_input.payload,
                prev_hash: first_input.prev_hash,
            },
            OperationsLogChainEntry {
                id: "op-2".to_string(),
                content_hash: second_hash,
                created_at: "2026-05-13T18:01:00.000Z".to_string(),
                event_type: second_input.event_type,
                source_id: second_input.source_id,
                source_table: second_input.source_table,
                actor_id: second_input.actor_id,
                payload: second_input.payload,
                prev_hash: Some("sha256:wrong".to_string()),
            },
        ];

        let issues = validate_operations_log_chain(&entries);
        assert!(issues
            .iter()
            .any(|issue| issue.kind == ChainIssueKind::PrevHashMismatch));
        assert!(issues
            .iter()
            .any(|issue| issue.kind == ChainIssueKind::ContentHashMismatch));
    }
}
