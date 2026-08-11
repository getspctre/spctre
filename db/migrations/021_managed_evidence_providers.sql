ALTER TABLE public.evidence_ingest_integration
  DROP CONSTRAINT IF EXISTS evidence_ingest_integration_provider_type_check;
ALTER TABLE public.evidence_ingest_integration
  ADD CONSTRAINT evidence_ingest_integration_provider_type_check CHECK (
    provider_type IN (
      'generic_json', 'generic_ndjson', 'cloudevents', 'otlp_logs',
      'bedrock_agentcore', 'docker_ai_governance', 'langsmith'
    )
  );
