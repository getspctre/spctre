--
-- PostgreSQL database dump
--


-- Dumped from database version 18.4 (Debian 18.4-1.pgdg13+1)
-- Dumped by pg_dump version 18.4 (Debian 18.4-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: spctre_ensure_runtime_evidence_partitions(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.spctre_ensure_runtime_evidence_partitions(months_back integer DEFAULT 1, months_forward integer DEFAULT 3) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  month_start timestamptz;
  partition_start timestamptz;
  partition_end timestamptz;
  partition_name text;
begin
  month_start := date_trunc('month', now());
  for offset_months in -months_back..months_forward loop
    partition_start := month_start + make_interval(months => offset_months);
    partition_end := partition_start + interval '1 month';
    partition_name := format('runtime_evidence_event_%s', to_char(partition_start, 'YYYY_MM'));
    execute format(
      'create table if not exists %I partition of runtime_evidence_event for values from (%L) to (%L)',
      partition_name,
      partition_start,
      partition_end
    );
  end loop;
end;
$$;


--
-- Name: spctre_rule_fts(text, text[], text[], text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.spctre_rule_fts(p_title text, p_domains text[], p_connectors text[], p_actions text[]) RETURNS tsvector
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  select to_tsvector('english'::regconfig,
    coalesce(p_title, '') || ' ' ||
    coalesce(array_to_string(p_domains, ' '), '') || ' ' ||
    coalesce(array_to_string(p_connectors, ' '), '') || ' ' ||
    coalesce(array_to_string(p_actions, ' '), '')
  )
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: action_receipt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_receipt (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    gateway_decision_id uuid NOT NULL,
    receipt_id text NOT NULL,
    decision_id text NOT NULL,
    revision_id text,
    branch_id text,
    artifact_hash text NOT NULL,
    outcome text NOT NULL,
    actor_id text NOT NULL,
    reviewer_id text,
    runtime_target text NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    key_id text NOT NULL,
    public_key text NOT NULL,
    payload_hash text NOT NULL,
    signature text NOT NULL,
    receipt jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    receipt_stage text DEFAULT 'DECISION'::text NOT NULL,
    CONSTRAINT action_receipt_outcome_check CHECK ((outcome = ANY (ARRAY['PROCEED'::text, 'ESCALATE'::text, 'ABORT'::text]))),
    CONSTRAINT action_receipt_receipt_stage_check CHECK ((receipt_stage = ANY (ARRAY['DECISION'::text, 'RESOLUTION'::text])))
);


--
-- Name: admin_audit_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    principal_id uuid,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text,
    outcome text NOT NULL,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_audit_event_outcome_check CHECK ((outcome = ANY (ARRAY['ALLOWED'::text, 'DENIED'::text])))
);


--
-- Name: agent_blueprint; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_blueprint (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    agent_id text NOT NULL,
    active_revision_id uuid,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_blueprint_approval; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_blueprint_approval (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    blueprint_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    reviewer_id text NOT NULL,
    reviewer_role text NOT NULL,
    status text NOT NULL,
    note text,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_blueprint_approval_status_check CHECK ((status = ANY (ARRAY['APPROVED'::text, 'CHANGES_REQUESTED'::text, 'PENDING'::text])))
);


--
-- Name: agent_blueprint_revision; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_blueprint_revision (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    blueprint_id uuid NOT NULL,
    parent_revision_id uuid,
    definition jsonb NOT NULL,
    definition_hash text NOT NULL,
    message text NOT NULL,
    author_id text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    CONSTRAINT agent_blueprint_revision_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'IN_REVIEW'::text, 'PUBLISHED'::text])))
);


--
-- Name: agt_agent_surface_binding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agt_agent_surface_binding (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    canonical_agent_id text NOT NULL,
    surface_type text NOT NULL,
    surface_agent_id text NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agt_identity_lifecycle_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agt_identity_lifecycle_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    principal_id text NOT NULL,
    event_type text NOT NULL,
    actor_id text NOT NULL,
    source text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    agent_did text,
    signature_algorithm text,
    signature_key_id text,
    payload_hash text,
    signature text,
    signature_verification_outcome text,
    signature_failure_reason text,
    signature_verified_at timestamp with time zone,
    CONSTRAINT agt_identity_lifecycle_event_event_type_check CHECK ((event_type = ANY (ARRAY['CREATED'::text, 'UPDATED'::text, 'DELETED'::text, 'CREDENTIAL_ADDED'::text, 'CREDENTIAL_REMOVED'::text, 'MFA_ENROLLED'::text, 'MFA_REVOKED'::text, 'SSO_LINKED'::text, 'SSO_UNLINKED'::text, 'ROLE_GRANTED'::text, 'ROLE_REVOKED'::text, 'SESSION_REVOKED'::text, 'TOKEN_ISSUED'::text, 'TOKEN_REVOKED'::text, 'SURFACE_LINKED'::text, 'SURFACE_UNLINKED'::text]))),
    CONSTRAINT agt_identity_lifecycle_event_signature_verification_outco_check CHECK (((signature_verification_outcome IS NULL) OR (signature_verification_outcome = ANY (ARRAY['PASS'::text, 'FAIL'::text, 'WARN'::text])))),
    CONSTRAINT agt_identity_lifecycle_event_source_check CHECK ((source = ANY (ARRAY['OIDC'::text, 'SAML'::text, 'LOCAL'::text, 'API'::text, 'ADMIN'::text, 'SYSTEM'::text])))
);


--
-- Name: agt_operations_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agt_operations_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    event_type text NOT NULL,
    source_id text,
    source_table text,
    actor_id text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    content_hash text NOT NULL,
    prev_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agt_operations_log_event_type_check CHECK ((event_type = ANY (ARRAY['POLICY_IMPORT'::text, 'POLICY_PUBLISH'::text, 'POLICY_APPROVE'::text, 'BLUEPRINT_APPROVE'::text, 'BLUEPRINT_PUBLISH'::text, 'BLUEPRINT_ROLLBACK'::text, 'EVIDENCE_INGEST'::text, 'EVIDENCE_EXPORT'::text, 'BUNDLE_EXPORT'::text, 'EVIDENCE_PRUNE'::text, 'EVIDENCE_ERASURE'::text, 'SIMULATION_RUN'::text, 'TRUST_SCORE_CHANGE'::text, 'TRUST_POLICY_BREACH'::text, 'CONTEXT_BUDGET_BREACH'::text, 'ECONOMIC_BUDGET_BREACH'::text, 'ECONOMIC_USAGE_INGEST'::text, 'IDENTITY_CHANGE'::text, 'TOKEN_ISSUED'::text, 'TOKEN_REVOKED'::text, 'TOKEN_REFRESHED'::text, 'ESCALATION_OPENED'::text, 'ESCALATION_RESOLVED'::text, 'AGENT_TRIAGE'::text, 'AGENT_RECOMMENDATION'::text, 'NOTIFICATION_SENT'::text, 'NOTIFICATION_FAILED'::text, 'VERIFICATION_RUN'::text, 'ACTION_RECEIPT_ISSUED'::text, 'COMPLIANCE_EXPORT'::text])))
);


--
-- Name: agt_operations_log_chain_head; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agt_operations_log_chain_head (
    tenant_id uuid NOT NULL,
    last_hash text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agt_trust_score_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agt_trust_score_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    agent_id text NOT NULL,
    environment text NOT NULL,
    runtime_stack text NOT NULL,
    trust_score numeric(6,5) NOT NULL,
    previous_score numeric(6,5),
    delta numeric(7,5),
    source text NOT NULL,
    source_ref text,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agt_trust_score_event_source_check CHECK ((source = ANY (ARRAY['EVIDENCE_INGEST'::text, 'POLICY_EVALUATION'::text, 'MANUAL'::text, 'IDENTITY_EVENT'::text, 'SYSTEM'::text])))
);


--
-- Name: agt_verification_result; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agt_verification_result (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    revision_id uuid,
    artifact_hash text NOT NULL,
    verification_type text NOT NULL,
    outcome text NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    run_by text NOT NULL,
    runtime_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    arguments_hash text,
    approver_did text,
    policy_version text,
    issued_at timestamp with time zone,
    completed_at timestamp with time zone,
    agt_version text,
    agt_policies_version text,
    cedar_policy_version text,
    policy_engine_version text,
    compatibility_checked_at timestamp with time zone,
    compatibility_check_outcome text,
    escrow_signer_id text,
    escrow_key_id text,
    outcome_hash text,
    escrow_signature text,
    escrow_verification_outcome text,
    escrow_verified_at timestamp with time zone,
    CONSTRAINT agt_verification_result_compatibility_check_outcome_check CHECK (((compatibility_check_outcome IS NULL) OR (compatibility_check_outcome = ANY (ARRAY['PASS'::text, 'FAIL'::text, 'WARN'::text])))),
    CONSTRAINT agt_verification_result_escrow_verification_outcome_check CHECK (((escrow_verification_outcome IS NULL) OR (escrow_verification_outcome = ANY (ARRAY['PASS'::text, 'FAIL'::text, 'WARN'::text])))),
    CONSTRAINT agt_verification_result_outcome_check CHECK ((outcome = ANY (ARRAY['PASS'::text, 'FAIL'::text, 'WARN'::text]))),
    CONSTRAINT agt_verification_result_verification_type_check CHECK ((verification_type = ANY (ARRAY['AGT_VERIFY'::text, 'AGT_VERIFY_EVIDENCE'::text, 'AGT_LINT_POLICY'::text, 'AGT_REDTEAM'::text, 'AGT_REPLAY'::text, 'CUSTOM'::text])))
);


--
-- Name: alerting_integration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerting_integration (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    url text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    config_encrypted bytea NOT NULL,
    CONSTRAINT alerting_integration_type_check CHECK ((type = ANY (ARRAY['SLACK'::text, 'PAGERDUTY'::text, 'TEAMS'::text, 'EMAIL'::text, 'WEBHOOK'::text, 'SPLUNK_HEC'::text, 'SENTINEL'::text])))
);


--
-- Name: alerting_rule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerting_rule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    connector text,
    min_risk_level text,
    min_frequency integer DEFAULT 1 NOT NULL,
    frequency_window_minutes integer,
    integration_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT alerting_rule_min_risk_level_check CHECK ((min_risk_level = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'CRITICAL'::text])))
);


--
-- Name: app_principal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_principal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    subject text NOT NULL,
    display_name text NOT NULL,
    email text,
    principal_type text DEFAULT 'USER'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    auth_method text DEFAULT 'SESSION'::text,
    last_idp_sync_at timestamp with time zone,
    idp_deprovisioned_at timestamp with time zone,
    org_role text DEFAULT 'VIEWER'::text NOT NULL,
    invite_status text DEFAULT 'ACCEPTED'::text NOT NULL,
    invited_by uuid,
    invited_at timestamp with time zone,
    invite_accepted_at timestamp with time zone,
    invite_revoked_at timestamp with time zone,
    disabled_at timestamp with time zone,
    last_active_at timestamp with time zone,
    preferred_locale text,
    CONSTRAINT app_principal_auth_method_check CHECK ((auth_method = ANY (ARRAY['SESSION'::text, 'OIDC'::text, 'SAML'::text, 'API_KEY'::text, 'INVITED'::text, 'LOCAL_DEV'::text, 'MAGIC_LINK'::text, 'GOOGLE'::text, 'GITHUB'::text]))),
    CONSTRAINT app_principal_invite_status_check CHECK ((invite_status = ANY (ARRAY['PENDING'::text, 'ACCEPTED'::text, 'REVOKED'::text]))),
    CONSTRAINT app_principal_org_role_check CHECK ((org_role = ANY (ARRAY['OWNER'::text, 'ADMIN'::text, 'REVIEWER'::text, 'CONTRIBUTOR'::text, 'VIEWER'::text]))),
    CONSTRAINT app_principal_principal_type_check CHECK ((principal_type = ANY (ARRAY['USER'::text, 'SERVICE'::text])))
);


--
-- Name: app_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    user_agent text,
    ip_address text,
    auth_method text DEFAULT 'SESSION'::text,
    idp_session_id text,
    mfa_verified_at timestamp with time zone
);


--
-- Name: approval_workflow_audit_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_workflow_audit_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    workflow_id uuid,
    actor_id uuid,
    action text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT approval_workflow_audit_event_action_check CHECK ((action = ANY (ARRAY['WORKFLOW_CREATED'::text, 'WORKFLOW_UPDATED'::text, 'WORKFLOW_DISABLED'::text, 'RULE_ADDED'::text, 'RULE_UPDATED'::text, 'RULE_REMOVED'::text])))
);


--
-- Name: approval_workflow_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_workflow_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    environment text,
    name text DEFAULT 'Default approval workflow'::text NOT NULL,
    review_mode text DEFAULT 'PARALLEL'::text NOT NULL,
    risk_tags text[] DEFAULT '{}'::text[] NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT approval_workflow_config_review_mode_check CHECK ((review_mode = ANY (ARRAY['PARALLEL'::text, 'SEQUENTIAL'::text])))
);


--
-- Name: approval_workflow_rule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_workflow_rule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workflow_id uuid NOT NULL,
    sequence integer DEFAULT 1 NOT NULL,
    role text NOT NULL,
    required_count integer DEFAULT 1 NOT NULL,
    eligible_roles text[] DEFAULT '{}'::text[] NOT NULL,
    named_reviewers uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT approval_workflow_rule_required_count_check CHECK (((required_count > 0) AND (required_count <= 10)))
);


--
-- Name: auth_rate_limit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_rate_limit (
    key text NOT NULL,
    count integer DEFAULT 1 NOT NULL,
    window_start timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: authz_denial_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.authz_denial_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    principal_id uuid,
    action text NOT NULL,
    reason text NOT NULL,
    resource_type text NOT NULL,
    resource_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bundle_export_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bundle_export_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text NOT NULL,
    workspace_id text NOT NULL,
    branch_id text NOT NULL,
    revision_id text NOT NULL,
    artifact_hash text NOT NULL,
    format text NOT NULL,
    outcome text NOT NULL,
    compiled_artifact_hash text,
    blocking_count integer DEFAULT 0 NOT NULL,
    verified boolean,
    actor_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bundle_export_log_outcome_check CHECK ((outcome = ANY (ARRAY['PREVIEW'::text, 'EXPORTED'::text, 'BLOCKED'::text, 'VERIFICATION_FAILED'::text])))
);


--
-- Name: cli_onboarding_request; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cli_onboarding_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    requested_workspace_slug text,
    requested_agent_id text NOT NULL,
    requested_environment text DEFAULT 'production'::text NOT NULL,
    requested_bundle_path text DEFAULT 'spctre-policy.json'::text NOT NULL,
    control_plane_url text NOT NULL,
    approved_by uuid,
    approved_tenant_id uuid,
    approved_workspace_id uuid,
    service_principal_id uuid,
    service_token_id uuid,
    exchanged_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    flow_type text DEFAULT 'BROWSER'::text NOT NULL,
    user_code text,
    device_code text,
    polling_interval_seconds integer DEFAULT 5 NOT NULL,
    last_polled_at timestamp with time zone,
    trial boolean DEFAULT false NOT NULL,
    CONSTRAINT cli_onboarding_request_flow_type_check CHECK ((flow_type = ANY (ARRAY['BROWSER'::text, 'DEVICE'::text])))
);


--
-- Name: commercial_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commercial_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    principal_id uuid,
    event_type text NOT NULL,
    target_plan text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commercial_event_event_type_check CHECK ((event_type = ANY (ARRAY['COMMERCIAL_REVIEW_REQUESTED'::text, 'PLAN_CHANGED'::text, 'USAGE_LIMIT_EXCEEDED'::text, 'COMMERCIAL_NOTE'::text]))),
    CONSTRAINT commercial_event_target_plan_check CHECK ((target_plan = ANY (ARRAY['HOSTED_TRIAL'::text, 'TEAM'::text, 'BUSINESS'::text, 'ENTERPRISE'::text])))
);


--
-- Name: consumed_magic_link; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumed_magic_link (
    jti text NOT NULL,
    principal_id uuid,
    consumed_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: content_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_items (
    id bigint NOT NULL,
    type character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    title character varying(255) NOT NULL,
    description text NOT NULL,
    body text NOT NULL,
    published_at timestamp(0) without time zone NOT NULL,
    json_ld jsonb,
    inserted_at timestamp(0) without time zone NOT NULL,
    updated_at timestamp(0) without time zone NOT NULL,
    author_name character varying(255),
    author_url character varying(255),
    social_image_url character varying(255)
);


--
-- Name: content_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.content_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: content_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.content_items_id_seq OWNED BY public.content_items.id;


--
-- Name: context_budget_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.context_budget_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    session_id text NOT NULL,
    agent_id text NOT NULL,
    environment text NOT NULL,
    runtime_stack text NOT NULL,
    event_type text NOT NULL,
    token_count integer NOT NULL,
    token_delta integer,
    context_source_mix jsonb DEFAULT '{}'::jsonb NOT NULL,
    budget_limit integer,
    budget_utilization numeric(6,5),
    governance_action text,
    policy_ref uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT context_budget_event_event_type_check CHECK ((event_type = ANY (ARRAY['TOKEN_GROWTH'::text, 'SUMMARIZATION_EVENT'::text, 'CONTEXT_SOURCE_MIX'::text, 'BUDGET_BREACH'::text]))),
    CONSTRAINT context_budget_event_governance_action_check CHECK ((governance_action = ANY (ARRAY['ALLOW'::text, 'WARN'::text, 'ESCALATE'::text, 'REVIEW'::text])))
);


--
-- Name: conversion_telemetry_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversion_telemetry_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    event_type text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversion_telemetry_event_event_type_check CHECK ((event_type = ANY (ARRAY['SIGNUP_COMPLETED'::text, 'TRIAL_START'::text, 'FIRST_EVIDENCE_INGEST'::text, 'FIRST_COMPLIANCE_EXPORT'::text, 'FIRST_HITL_ESCALATION'::text, 'TRIAL_CONVERTED'::text, 'TRIAL_EXPIRED'::text, 'TRIAL_CANCELLED'::text, 'SUBSCRIPTION_CANCELLED'::text, 'PAYMENT_FAILED'::text, 'PLAN_CHANGED'::text])))
);


--
-- Name: gateway_credential_broker; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gateway_credential_broker (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    connector text NOT NULL,
    action text DEFAULT '*'::text NOT NULL,
    credential_type text NOT NULL,
    injected_parameter text NOT NULL,
    broker_config jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gateway_credential_broker_credential_type_check CHECK ((credential_type = ANY (ARRAY['STRIPE_RESTRICTED'::text, 'MOCK'::text])))
);


--
-- Name: gateway_credential_grant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gateway_credential_grant (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    gateway_decision_id uuid NOT NULL,
    broker_id uuid NOT NULL,
    injected_parameter text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gateway_decision; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gateway_decision (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    decision_id text NOT NULL,
    revision_id uuid,
    branch_id uuid,
    artifact_hash text NOT NULL,
    outcome text NOT NULL,
    reason text NOT NULL,
    consequence text,
    customer_tier text,
    confidence numeric(6,5),
    amount_usd numeric(18,2),
    data_sensitivity text,
    trust_score numeric(6,5),
    context_budget integer,
    risk_level text,
    evaluated_by text NOT NULL,
    evaluated_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tool_intent text,
    plan_summary text,
    tool_parameters jsonb,
    agent_id text,
    session_id text,
    safeguard_telemetry jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT gateway_decision_outcome_check CHECK ((outcome = ANY (ARRAY['PROCEED'::text, 'ESCALATE'::text, 'ABORT'::text]))),
    CONSTRAINT gateway_decision_risk_level_check CHECK ((risk_level = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'CRITICAL'::text])))
);


--
-- Name: gateway_escalation_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gateway_escalation_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    gateway_decision_id uuid NOT NULL,
    decision_id text NOT NULL,
    revision_id uuid,
    artifact_hash text NOT NULL,
    status text NOT NULL,
    assigned_to text,
    sla_due_at timestamp with time zone NOT NULL,
    handoff_notes text,
    resolved_at timestamp with time zone,
    resolution_outcome text,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    agent_guidance text,
    CONSTRAINT gateway_escalation_queue_resolution_outcome_check CHECK ((resolution_outcome = ANY (ARRAY['PROCEED'::text, 'ESCALATE'::text, 'ABORT'::text]))),
    CONSTRAINT gateway_escalation_queue_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'IN_REVIEW'::text, 'RESOLVED'::text, 'EXPIRED'::text])))
);


--
-- Name: gateway_webhook_registration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gateway_webhook_registration (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    provider text NOT NULL,
    secret_hash text NOT NULL,
    label text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT gateway_webhook_registration_provider_check CHECK ((provider = ANY (ARRAY['portkey'::text, 'helicone'::text, 'litellm'::text, 'notion'::text])))
);


--
-- Name: gateway_webhook_replay_check; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gateway_webhook_replay_check (
    event_id text NOT NULL,
    tenant_id uuid NOT NULL,
    provider text NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gateway_webhook_replay_check_provider_check CHECK ((provider = ANY (ARRAY['portkey'::text, 'helicone'::text, 'litellm'::text, 'notion'::text])))
);


--
-- Name: grc_delivery_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grc_delivery_attempt (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    destination_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    artifact_hash text NOT NULL,
    status text NOT NULL,
    http_status integer,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grc_delivery_attempt_status_check CHECK ((status = ANY (ARRAY['DELIVERED'::text, 'RETRYABLE_FAILURE'::text, 'TERMINAL_FAILURE'::text])))
);


--
-- Name: grc_delivery_destination; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grc_delivery_destination (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    kind text NOT NULL,
    endpoint text NOT NULL,
    credential_hash text,
    label text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grc_delivery_destination_kind_check CHECK ((kind = 'webhook'::text))
);


--
-- Name: identity_provider; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.identity_provider (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    provider_type text NOT NULL,
    name text NOT NULL,
    issuer text NOT NULL,
    client_id text,
    client_secret_enc text,
    metadata_url text,
    scope text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    saml_entry_point text,
    saml_cert text,
    CONSTRAINT identity_provider_provider_type_check CHECK ((provider_type = ANY (ARRAY['OIDC'::text, 'SAML'::text])))
);


--
-- Name: mcp_tool_grant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_tool_grant (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    registry_id uuid NOT NULL,
    agent_id text,
    environment text DEFAULT '*'::text NOT NULL,
    allowed boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mcp_tool_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_tool_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    server_name text NOT NULL,
    server_url text,
    tool_name text NOT NULL,
    connector text NOT NULL,
    action text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    input_schema jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mcp_tool_registry_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DISABLED'::text])))
);


--
-- Name: mfa_enrollment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mfa_enrollment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    principal_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    mfa_type text NOT NULL,
    secret_enc text NOT NULL,
    phone_number text,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mfa_enrollment_mfa_type_check CHECK ((mfa_type = ANY (ARRAY['TOTP'::text, 'SMS'::text])))
);


--
-- Name: notification_delivery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_delivery (
    tenant_id uuid NOT NULL,
    event_id uuid NOT NULL,
    integration_id uuid NOT NULL,
    delivered boolean DEFAULT false NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: passkey; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passkey (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    principal_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    credential_id_b64 text NOT NULL,
    public_key_b64 text NOT NULL,
    counter bigint DEFAULT 0 NOT NULL,
    transports text[] DEFAULT '{}'::text[] NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    name text
);


--
-- Name: policy_approval; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.policy_approval (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    branch_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    reviewer_id text NOT NULL,
    reviewer_role text NOT NULL,
    status text NOT NULL,
    note text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT policy_approval_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'CHANGES_REQUESTED'::text])))
);


--
-- Name: policy_branch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.policy_branch (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    scope text NOT NULL,
    environment text,
    connector text,
    name text NOT NULL,
    active_revision_id uuid,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT policy_branch_check CHECK ((((scope = 'ORGANIZATION'::text) AND (workspace_id IS NULL)) OR ((scope <> 'ORGANIZATION'::text) AND (workspace_id IS NOT NULL)))),
    CONSTRAINT policy_branch_scope_check CHECK ((scope = ANY (ARRAY['ORGANIZATION'::text, 'WORKSPACE'::text, 'COMPANY'::text, 'ENVIRONMENT'::text, 'CONNECTOR'::text])))
);


--
-- Name: policy_publish; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.policy_publish (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    branch_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    environment text NOT NULL,
    runtime_stack text DEFAULT 'CUSTOM'::text NOT NULL,
    runtime_adapter text,
    artifact_hash text NOT NULL,
    published_by text NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT policy_publish_runtime_stack_check CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'LANGGRAPH'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'OPENCODE'::text, 'CLAUDE_CODE'::text, 'LOCAL'::text, 'CUSTOM'::text])))
);


--
-- Name: policy_revision; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.policy_revision (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    branch_id uuid NOT NULL,
    parent_revision_id uuid,
    source_format text NOT NULL,
    source_path text,
    source_document jsonb NOT NULL,
    source_hash text NOT NULL,
    artifact_hash text,
    target_stacks jsonb DEFAULT '[]'::jsonb NOT NULL,
    author_id text NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT policy_revision_source_format_check CHECK ((source_format = ANY (ARRAY['AGT_YAML'::text, 'OPA_REGO'::text, 'CEDAR'::text])))
);


--
-- Name: policy_rule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.policy_rule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    branch_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    stable_rule_id text NOT NULL,
    title text NOT NULL,
    effect text NOT NULL,
    source_path text,
    domains text[] DEFAULT '{}'::text[] NOT NULL,
    connectors text[] DEFAULT '{}'::text[] NOT NULL,
    actions text[] DEFAULT '{}'::text[] NOT NULL,
    immutable boolean DEFAULT false NOT NULL,
    search_text tsvector GENERATED ALWAYS AS (public.spctre_rule_fts(title, domains, connectors, actions)) STORED,
    CONSTRAINT policy_rule_effect_check CHECK ((effect = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text, 'ESCALATE'::text])))
);


--
-- Name: principal_external_identity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.principal_external_identity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    principal_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    provider_id uuid,
    external_subject text NOT NULL,
    external_email text,
    last_authenticated_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: principal_permission_grant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.principal_permission_grant (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    workspace_id uuid,
    reviewer_roles text[] DEFAULT '{}'::text[] NOT NULL,
    publish_scopes text[] DEFAULT '{}'::text[] NOT NULL,
    allowed_environments text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    grant_role text,
    CONSTRAINT principal_permission_grant_publish_scopes_check CHECK ((publish_scopes <@ ARRAY['ORGANIZATION'::text, 'WORKSPACE'::text, 'COMPANY'::text, 'ENVIRONMENT'::text, 'CONNECTOR'::text])),
    CONSTRAINT principal_permission_grant_reviewer_roles_check CHECK ((reviewer_roles <@ ARRAY['Security'::text, 'Platform'::text, 'Legal'::text, 'Ops'::text, 'Admin'::text])),
    CONSTRAINT principal_permission_grant_role_check CHECK (((grant_role IS NULL) OR (grant_role = ANY (ARRAY['OWNER'::text, 'ADMIN'::text, 'REVIEWER'::text, 'CONTRIBUTOR'::text, 'VIEWER'::text]))))
);


--
-- Name: rbac_audit_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_audit_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    actor_id uuid,
    target_principal_id uuid,
    action text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rbac_audit_event_action_check CHECK ((action = ANY (ARRAY['INVITE_CREATED'::text, 'INVITE_REVOKED'::text, 'MEMBER_ROLE_UPDATED'::text, 'WORKSPACE_OVERRIDE_UPDATED'::text, 'WORKSPACE_OVERRIDE_REMOVED'::text, 'MEMBER_REMOVED'::text, 'CUSTOM_ROLE_CREATED'::text, 'CUSTOM_ROLE_ARCHIVED'::text])))
);


--
-- Name: rbac_custom_role; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_custom_role (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    capability_set text[] DEFAULT '{}'::text[] NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone
);


--
-- Name: recovery_code; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recovery_code (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    principal_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    code_hash text NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    code_lookup text
);


--
-- Name: runtime_adapter_declaration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_adapter_declaration (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    environment text,
    stack text NOT NULL,
    adapter_id text NOT NULL,
    adapter_version text,
    supported_connectors text[] DEFAULT '{}'::text[] NOT NULL,
    capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    registered_by text NOT NULL,
    CONSTRAINT runtime_adapter_declaration_stack_check CHECK ((stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'LANGGRAPH'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'OPENCODE'::text, 'CLAUDE_CODE'::text, 'LOCAL'::text, 'CUSTOM'::text])))
);


--
-- Name: runtime_evidence_chain_head; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_evidence_chain_head (
    tenant_id uuid NOT NULL,
    last_hash text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: runtime_evidence_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_evidence_event (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT runtime_evidence_event_id_not_null1 NOT NULL,
    decision_id text CONSTRAINT runtime_evidence_event_decision_id_not_null1 NOT NULL,
    tenant_id uuid CONSTRAINT runtime_evidence_event_tenant_id_not_null1 NOT NULL,
    workspace_id uuid CONSTRAINT runtime_evidence_event_workspace_id_not_null1 NOT NULL,
    environment text CONSTRAINT runtime_evidence_event_environment_not_null1 NOT NULL,
    runtime_stack text DEFAULT 'CUSTOM'::text CONSTRAINT runtime_evidence_event_runtime_stack_not_null1 NOT NULL,
    runtime_adapter text,
    agent_id text CONSTRAINT runtime_evidence_event_agent_id_not_null1 NOT NULL,
    connector text CONSTRAINT runtime_evidence_event_connector_not_null1 NOT NULL,
    action text CONSTRAINT runtime_evidence_event_action_not_null1 NOT NULL,
    status text CONSTRAINT runtime_evidence_event_status_not_null1 NOT NULL,
    reason text CONSTRAINT runtime_evidence_event_reason_not_null1 NOT NULL,
    policy_refs text[] DEFAULT '{}'::text[] CONSTRAINT runtime_evidence_event_policy_refs_not_null1 NOT NULL,
    artifact_hash text CONSTRAINT runtime_evidence_event_artifact_hash_not_null1 NOT NULL,
    policy_context jsonb CONSTRAINT runtime_evidence_event_policy_context_not_null1 NOT NULL,
    raw_evidence jsonb CONSTRAINT runtime_evidence_event_raw_evidence_not_null1 NOT NULL,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT runtime_evidence_event_created_at_not_null1 NOT NULL,
    execution_trace jsonb,
    engine_version text,
    evidence_content_hash text NOT NULL,
    evidence_prev_hash text,
    erased_at timestamp with time zone,
    erased_by text,
    CONSTRAINT runtime_evidence_event_runtime_stack_check CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'LANGGRAPH'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'OPENCODE'::text, 'CLAUDE_CODE'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_runtime_stack_check1 CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_status_check CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text, 'ESCALATE'::text]))),
    CONSTRAINT runtime_evidence_event_status_check1 CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text])))
)
PARTITION BY RANGE (created_at);


--
-- Name: runtime_evidence_event_2026_05; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_evidence_event_2026_05 (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT runtime_evidence_event_id_not_null1 NOT NULL,
    decision_id text CONSTRAINT runtime_evidence_event_decision_id_not_null1 NOT NULL,
    tenant_id uuid CONSTRAINT runtime_evidence_event_tenant_id_not_null1 NOT NULL,
    workspace_id uuid CONSTRAINT runtime_evidence_event_workspace_id_not_null1 NOT NULL,
    environment text CONSTRAINT runtime_evidence_event_environment_not_null1 NOT NULL,
    runtime_stack text DEFAULT 'CUSTOM'::text CONSTRAINT runtime_evidence_event_runtime_stack_not_null1 NOT NULL,
    runtime_adapter text,
    agent_id text CONSTRAINT runtime_evidence_event_agent_id_not_null1 NOT NULL,
    connector text CONSTRAINT runtime_evidence_event_connector_not_null1 NOT NULL,
    action text CONSTRAINT runtime_evidence_event_action_not_null1 NOT NULL,
    status text CONSTRAINT runtime_evidence_event_status_not_null1 NOT NULL,
    reason text CONSTRAINT runtime_evidence_event_reason_not_null1 NOT NULL,
    policy_refs text[] DEFAULT '{}'::text[] CONSTRAINT runtime_evidence_event_policy_refs_not_null1 NOT NULL,
    artifact_hash text CONSTRAINT runtime_evidence_event_artifact_hash_not_null1 NOT NULL,
    policy_context jsonb CONSTRAINT runtime_evidence_event_policy_context_not_null1 NOT NULL,
    raw_evidence jsonb CONSTRAINT runtime_evidence_event_raw_evidence_not_null1 NOT NULL,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT runtime_evidence_event_created_at_not_null1 NOT NULL,
    execution_trace jsonb,
    engine_version text,
    evidence_content_hash text CONSTRAINT runtime_evidence_event_evidence_content_hash_not_null NOT NULL,
    evidence_prev_hash text,
    erased_at timestamp with time zone,
    erased_by text,
    CONSTRAINT runtime_evidence_event_runtime_stack_check CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'LANGGRAPH'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'OPENCODE'::text, 'CLAUDE_CODE'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_runtime_stack_check1 CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_status_check CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text, 'ESCALATE'::text]))),
    CONSTRAINT runtime_evidence_event_status_check1 CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text])))
);


--
-- Name: runtime_evidence_event_2026_06; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_evidence_event_2026_06 (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT runtime_evidence_event_id_not_null1 NOT NULL,
    decision_id text CONSTRAINT runtime_evidence_event_decision_id_not_null1 NOT NULL,
    tenant_id uuid CONSTRAINT runtime_evidence_event_tenant_id_not_null1 NOT NULL,
    workspace_id uuid CONSTRAINT runtime_evidence_event_workspace_id_not_null1 NOT NULL,
    environment text CONSTRAINT runtime_evidence_event_environment_not_null1 NOT NULL,
    runtime_stack text DEFAULT 'CUSTOM'::text CONSTRAINT runtime_evidence_event_runtime_stack_not_null1 NOT NULL,
    runtime_adapter text,
    agent_id text CONSTRAINT runtime_evidence_event_agent_id_not_null1 NOT NULL,
    connector text CONSTRAINT runtime_evidence_event_connector_not_null1 NOT NULL,
    action text CONSTRAINT runtime_evidence_event_action_not_null1 NOT NULL,
    status text CONSTRAINT runtime_evidence_event_status_not_null1 NOT NULL,
    reason text CONSTRAINT runtime_evidence_event_reason_not_null1 NOT NULL,
    policy_refs text[] DEFAULT '{}'::text[] CONSTRAINT runtime_evidence_event_policy_refs_not_null1 NOT NULL,
    artifact_hash text CONSTRAINT runtime_evidence_event_artifact_hash_not_null1 NOT NULL,
    policy_context jsonb CONSTRAINT runtime_evidence_event_policy_context_not_null1 NOT NULL,
    raw_evidence jsonb CONSTRAINT runtime_evidence_event_raw_evidence_not_null1 NOT NULL,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT runtime_evidence_event_created_at_not_null1 NOT NULL,
    execution_trace jsonb,
    engine_version text,
    evidence_content_hash text CONSTRAINT runtime_evidence_event_evidence_content_hash_not_null NOT NULL,
    evidence_prev_hash text,
    erased_at timestamp with time zone,
    erased_by text,
    CONSTRAINT runtime_evidence_event_runtime_stack_check CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'LANGGRAPH'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'OPENCODE'::text, 'CLAUDE_CODE'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_runtime_stack_check1 CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_status_check CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text, 'ESCALATE'::text]))),
    CONSTRAINT runtime_evidence_event_status_check1 CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text])))
);


--
-- Name: runtime_evidence_event_2026_07; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_evidence_event_2026_07 (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT runtime_evidence_event_id_not_null1 NOT NULL,
    decision_id text CONSTRAINT runtime_evidence_event_decision_id_not_null1 NOT NULL,
    tenant_id uuid CONSTRAINT runtime_evidence_event_tenant_id_not_null1 NOT NULL,
    workspace_id uuid CONSTRAINT runtime_evidence_event_workspace_id_not_null1 NOT NULL,
    environment text CONSTRAINT runtime_evidence_event_environment_not_null1 NOT NULL,
    runtime_stack text DEFAULT 'CUSTOM'::text CONSTRAINT runtime_evidence_event_runtime_stack_not_null1 NOT NULL,
    runtime_adapter text,
    agent_id text CONSTRAINT runtime_evidence_event_agent_id_not_null1 NOT NULL,
    connector text CONSTRAINT runtime_evidence_event_connector_not_null1 NOT NULL,
    action text CONSTRAINT runtime_evidence_event_action_not_null1 NOT NULL,
    status text CONSTRAINT runtime_evidence_event_status_not_null1 NOT NULL,
    reason text CONSTRAINT runtime_evidence_event_reason_not_null1 NOT NULL,
    policy_refs text[] DEFAULT '{}'::text[] CONSTRAINT runtime_evidence_event_policy_refs_not_null1 NOT NULL,
    artifact_hash text CONSTRAINT runtime_evidence_event_artifact_hash_not_null1 NOT NULL,
    policy_context jsonb CONSTRAINT runtime_evidence_event_policy_context_not_null1 NOT NULL,
    raw_evidence jsonb CONSTRAINT runtime_evidence_event_raw_evidence_not_null1 NOT NULL,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT runtime_evidence_event_created_at_not_null1 NOT NULL,
    execution_trace jsonb,
    engine_version text,
    evidence_content_hash text CONSTRAINT runtime_evidence_event_evidence_content_hash_not_null NOT NULL,
    evidence_prev_hash text,
    erased_at timestamp with time zone,
    erased_by text,
    CONSTRAINT runtime_evidence_event_runtime_stack_check CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'LANGGRAPH'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'OPENCODE'::text, 'CLAUDE_CODE'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_runtime_stack_check1 CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_status_check CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text, 'ESCALATE'::text]))),
    CONSTRAINT runtime_evidence_event_status_check1 CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text])))
);


--
-- Name: runtime_evidence_event_2026_08; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_evidence_event_2026_08 (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT runtime_evidence_event_id_not_null1 NOT NULL,
    decision_id text CONSTRAINT runtime_evidence_event_decision_id_not_null1 NOT NULL,
    tenant_id uuid CONSTRAINT runtime_evidence_event_tenant_id_not_null1 NOT NULL,
    workspace_id uuid CONSTRAINT runtime_evidence_event_workspace_id_not_null1 NOT NULL,
    environment text CONSTRAINT runtime_evidence_event_environment_not_null1 NOT NULL,
    runtime_stack text DEFAULT 'CUSTOM'::text CONSTRAINT runtime_evidence_event_runtime_stack_not_null1 NOT NULL,
    runtime_adapter text,
    agent_id text CONSTRAINT runtime_evidence_event_agent_id_not_null1 NOT NULL,
    connector text CONSTRAINT runtime_evidence_event_connector_not_null1 NOT NULL,
    action text CONSTRAINT runtime_evidence_event_action_not_null1 NOT NULL,
    status text CONSTRAINT runtime_evidence_event_status_not_null1 NOT NULL,
    reason text CONSTRAINT runtime_evidence_event_reason_not_null1 NOT NULL,
    policy_refs text[] DEFAULT '{}'::text[] CONSTRAINT runtime_evidence_event_policy_refs_not_null1 NOT NULL,
    artifact_hash text CONSTRAINT runtime_evidence_event_artifact_hash_not_null1 NOT NULL,
    policy_context jsonb CONSTRAINT runtime_evidence_event_policy_context_not_null1 NOT NULL,
    raw_evidence jsonb CONSTRAINT runtime_evidence_event_raw_evidence_not_null1 NOT NULL,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT runtime_evidence_event_created_at_not_null1 NOT NULL,
    execution_trace jsonb,
    engine_version text,
    evidence_content_hash text CONSTRAINT runtime_evidence_event_evidence_content_hash_not_null NOT NULL,
    evidence_prev_hash text,
    erased_at timestamp with time zone,
    erased_by text,
    CONSTRAINT runtime_evidence_event_runtime_stack_check CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'LANGGRAPH'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'OPENCODE'::text, 'CLAUDE_CODE'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_runtime_stack_check1 CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_status_check CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text, 'ESCALATE'::text]))),
    CONSTRAINT runtime_evidence_event_status_check1 CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text])))
);


--
-- Name: runtime_evidence_event_2026_09; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_evidence_event_2026_09 (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT runtime_evidence_event_id_not_null1 NOT NULL,
    decision_id text CONSTRAINT runtime_evidence_event_decision_id_not_null1 NOT NULL,
    tenant_id uuid CONSTRAINT runtime_evidence_event_tenant_id_not_null1 NOT NULL,
    workspace_id uuid CONSTRAINT runtime_evidence_event_workspace_id_not_null1 NOT NULL,
    environment text CONSTRAINT runtime_evidence_event_environment_not_null1 NOT NULL,
    runtime_stack text DEFAULT 'CUSTOM'::text CONSTRAINT runtime_evidence_event_runtime_stack_not_null1 NOT NULL,
    runtime_adapter text,
    agent_id text CONSTRAINT runtime_evidence_event_agent_id_not_null1 NOT NULL,
    connector text CONSTRAINT runtime_evidence_event_connector_not_null1 NOT NULL,
    action text CONSTRAINT runtime_evidence_event_action_not_null1 NOT NULL,
    status text CONSTRAINT runtime_evidence_event_status_not_null1 NOT NULL,
    reason text CONSTRAINT runtime_evidence_event_reason_not_null1 NOT NULL,
    policy_refs text[] DEFAULT '{}'::text[] CONSTRAINT runtime_evidence_event_policy_refs_not_null1 NOT NULL,
    artifact_hash text CONSTRAINT runtime_evidence_event_artifact_hash_not_null1 NOT NULL,
    policy_context jsonb CONSTRAINT runtime_evidence_event_policy_context_not_null1 NOT NULL,
    raw_evidence jsonb CONSTRAINT runtime_evidence_event_raw_evidence_not_null1 NOT NULL,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT runtime_evidence_event_created_at_not_null1 NOT NULL,
    execution_trace jsonb,
    engine_version text,
    evidence_content_hash text CONSTRAINT runtime_evidence_event_evidence_content_hash_not_null NOT NULL,
    evidence_prev_hash text,
    erased_at timestamp with time zone,
    erased_by text,
    CONSTRAINT runtime_evidence_event_runtime_stack_check CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'LANGGRAPH'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'OPENCODE'::text, 'CLAUDE_CODE'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_runtime_stack_check1 CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_status_check CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text, 'ESCALATE'::text]))),
    CONSTRAINT runtime_evidence_event_status_check1 CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text])))
);


--
-- Name: runtime_evidence_event_2026_10; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_evidence_event_2026_10 (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT runtime_evidence_event_id_not_null1 NOT NULL,
    decision_id text CONSTRAINT runtime_evidence_event_decision_id_not_null1 NOT NULL,
    tenant_id uuid CONSTRAINT runtime_evidence_event_tenant_id_not_null1 NOT NULL,
    workspace_id uuid CONSTRAINT runtime_evidence_event_workspace_id_not_null1 NOT NULL,
    environment text CONSTRAINT runtime_evidence_event_environment_not_null1 NOT NULL,
    runtime_stack text DEFAULT 'CUSTOM'::text CONSTRAINT runtime_evidence_event_runtime_stack_not_null1 NOT NULL,
    runtime_adapter text,
    agent_id text CONSTRAINT runtime_evidence_event_agent_id_not_null1 NOT NULL,
    connector text CONSTRAINT runtime_evidence_event_connector_not_null1 NOT NULL,
    action text CONSTRAINT runtime_evidence_event_action_not_null1 NOT NULL,
    status text CONSTRAINT runtime_evidence_event_status_not_null1 NOT NULL,
    reason text CONSTRAINT runtime_evidence_event_reason_not_null1 NOT NULL,
    policy_refs text[] DEFAULT '{}'::text[] CONSTRAINT runtime_evidence_event_policy_refs_not_null1 NOT NULL,
    artifact_hash text CONSTRAINT runtime_evidence_event_artifact_hash_not_null1 NOT NULL,
    policy_context jsonb CONSTRAINT runtime_evidence_event_policy_context_not_null1 NOT NULL,
    raw_evidence jsonb CONSTRAINT runtime_evidence_event_raw_evidence_not_null1 NOT NULL,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT runtime_evidence_event_created_at_not_null1 NOT NULL,
    execution_trace jsonb,
    engine_version text,
    evidence_content_hash text CONSTRAINT runtime_evidence_event_evidence_content_hash_not_null NOT NULL,
    evidence_prev_hash text,
    erased_at timestamp with time zone,
    erased_by text,
    CONSTRAINT runtime_evidence_event_runtime_stack_check CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'LANGGRAPH'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'OPENCODE'::text, 'CLAUDE_CODE'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_runtime_stack_check1 CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_status_check CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text, 'ESCALATE'::text]))),
    CONSTRAINT runtime_evidence_event_status_check1 CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text])))
);


--
-- Name: runtime_evidence_event_2026_11; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_evidence_event_2026_11 (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT runtime_evidence_event_id_not_null1 NOT NULL,
    decision_id text CONSTRAINT runtime_evidence_event_decision_id_not_null1 NOT NULL,
    tenant_id uuid CONSTRAINT runtime_evidence_event_tenant_id_not_null1 NOT NULL,
    workspace_id uuid CONSTRAINT runtime_evidence_event_workspace_id_not_null1 NOT NULL,
    environment text CONSTRAINT runtime_evidence_event_environment_not_null1 NOT NULL,
    runtime_stack text DEFAULT 'CUSTOM'::text CONSTRAINT runtime_evidence_event_runtime_stack_not_null1 NOT NULL,
    runtime_adapter text,
    agent_id text CONSTRAINT runtime_evidence_event_agent_id_not_null1 NOT NULL,
    connector text CONSTRAINT runtime_evidence_event_connector_not_null1 NOT NULL,
    action text CONSTRAINT runtime_evidence_event_action_not_null1 NOT NULL,
    status text CONSTRAINT runtime_evidence_event_status_not_null1 NOT NULL,
    reason text CONSTRAINT runtime_evidence_event_reason_not_null1 NOT NULL,
    policy_refs text[] DEFAULT '{}'::text[] CONSTRAINT runtime_evidence_event_policy_refs_not_null1 NOT NULL,
    artifact_hash text CONSTRAINT runtime_evidence_event_artifact_hash_not_null1 NOT NULL,
    policy_context jsonb CONSTRAINT runtime_evidence_event_policy_context_not_null1 NOT NULL,
    raw_evidence jsonb CONSTRAINT runtime_evidence_event_raw_evidence_not_null1 NOT NULL,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT runtime_evidence_event_created_at_not_null1 NOT NULL,
    execution_trace jsonb,
    engine_version text,
    evidence_content_hash text CONSTRAINT runtime_evidence_event_evidence_content_hash_not_null NOT NULL,
    evidence_prev_hash text,
    erased_at timestamp with time zone,
    erased_by text,
    CONSTRAINT runtime_evidence_event_runtime_stack_check CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'LANGGRAPH'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'OPENCODE'::text, 'CLAUDE_CODE'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_runtime_stack_check1 CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_status_check CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text, 'ESCALATE'::text]))),
    CONSTRAINT runtime_evidence_event_status_check1 CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text])))
);


--
-- Name: runtime_evidence_event_2026_12; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_evidence_event_2026_12 (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT runtime_evidence_event_id_not_null1 NOT NULL,
    decision_id text CONSTRAINT runtime_evidence_event_decision_id_not_null1 NOT NULL,
    tenant_id uuid CONSTRAINT runtime_evidence_event_tenant_id_not_null1 NOT NULL,
    workspace_id uuid CONSTRAINT runtime_evidence_event_workspace_id_not_null1 NOT NULL,
    environment text CONSTRAINT runtime_evidence_event_environment_not_null1 NOT NULL,
    runtime_stack text DEFAULT 'CUSTOM'::text CONSTRAINT runtime_evidence_event_runtime_stack_not_null1 NOT NULL,
    runtime_adapter text,
    agent_id text CONSTRAINT runtime_evidence_event_agent_id_not_null1 NOT NULL,
    connector text CONSTRAINT runtime_evidence_event_connector_not_null1 NOT NULL,
    action text CONSTRAINT runtime_evidence_event_action_not_null1 NOT NULL,
    status text CONSTRAINT runtime_evidence_event_status_not_null1 NOT NULL,
    reason text CONSTRAINT runtime_evidence_event_reason_not_null1 NOT NULL,
    policy_refs text[] DEFAULT '{}'::text[] CONSTRAINT runtime_evidence_event_policy_refs_not_null1 NOT NULL,
    artifact_hash text CONSTRAINT runtime_evidence_event_artifact_hash_not_null1 NOT NULL,
    policy_context jsonb CONSTRAINT runtime_evidence_event_policy_context_not_null1 NOT NULL,
    raw_evidence jsonb CONSTRAINT runtime_evidence_event_raw_evidence_not_null1 NOT NULL,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT runtime_evidence_event_created_at_not_null1 NOT NULL,
    execution_trace jsonb,
    engine_version text,
    evidence_content_hash text CONSTRAINT runtime_evidence_event_evidence_content_hash_not_null NOT NULL,
    evidence_prev_hash text,
    erased_at timestamp with time zone,
    erased_by text,
    CONSTRAINT runtime_evidence_event_runtime_stack_check CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'LANGGRAPH'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'OPENCODE'::text, 'CLAUDE_CODE'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_runtime_stack_check1 CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_status_check CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text, 'ESCALATE'::text]))),
    CONSTRAINT runtime_evidence_event_status_check1 CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text])))
);


--
-- Name: runtime_evidence_event_2027_01; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_evidence_event_2027_01 (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT runtime_evidence_event_id_not_null1 NOT NULL,
    decision_id text CONSTRAINT runtime_evidence_event_decision_id_not_null1 NOT NULL,
    tenant_id uuid CONSTRAINT runtime_evidence_event_tenant_id_not_null1 NOT NULL,
    workspace_id uuid CONSTRAINT runtime_evidence_event_workspace_id_not_null1 NOT NULL,
    environment text CONSTRAINT runtime_evidence_event_environment_not_null1 NOT NULL,
    runtime_stack text DEFAULT 'CUSTOM'::text CONSTRAINT runtime_evidence_event_runtime_stack_not_null1 NOT NULL,
    runtime_adapter text,
    agent_id text CONSTRAINT runtime_evidence_event_agent_id_not_null1 NOT NULL,
    connector text CONSTRAINT runtime_evidence_event_connector_not_null1 NOT NULL,
    action text CONSTRAINT runtime_evidence_event_action_not_null1 NOT NULL,
    status text CONSTRAINT runtime_evidence_event_status_not_null1 NOT NULL,
    reason text CONSTRAINT runtime_evidence_event_reason_not_null1 NOT NULL,
    policy_refs text[] DEFAULT '{}'::text[] CONSTRAINT runtime_evidence_event_policy_refs_not_null1 NOT NULL,
    artifact_hash text CONSTRAINT runtime_evidence_event_artifact_hash_not_null1 NOT NULL,
    policy_context jsonb CONSTRAINT runtime_evidence_event_policy_context_not_null1 NOT NULL,
    raw_evidence jsonb CONSTRAINT runtime_evidence_event_raw_evidence_not_null1 NOT NULL,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT runtime_evidence_event_created_at_not_null1 NOT NULL,
    execution_trace jsonb,
    engine_version text,
    evidence_content_hash text CONSTRAINT runtime_evidence_event_evidence_content_hash_not_null NOT NULL,
    evidence_prev_hash text,
    erased_at timestamp with time zone,
    erased_by text,
    CONSTRAINT runtime_evidence_event_runtime_stack_check CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'LANGGRAPH'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'OPENCODE'::text, 'CLAUDE_CODE'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_runtime_stack_check1 CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_status_check CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text, 'ESCALATE'::text]))),
    CONSTRAINT runtime_evidence_event_status_check1 CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text])))
);


--
-- Name: runtime_evidence_event_default; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_evidence_event_default (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT runtime_evidence_event_id_not_null1 NOT NULL,
    decision_id text CONSTRAINT runtime_evidence_event_decision_id_not_null1 NOT NULL,
    tenant_id uuid CONSTRAINT runtime_evidence_event_tenant_id_not_null1 NOT NULL,
    workspace_id uuid CONSTRAINT runtime_evidence_event_workspace_id_not_null1 NOT NULL,
    environment text CONSTRAINT runtime_evidence_event_environment_not_null1 NOT NULL,
    runtime_stack text DEFAULT 'CUSTOM'::text CONSTRAINT runtime_evidence_event_runtime_stack_not_null1 NOT NULL,
    runtime_adapter text,
    agent_id text CONSTRAINT runtime_evidence_event_agent_id_not_null1 NOT NULL,
    connector text CONSTRAINT runtime_evidence_event_connector_not_null1 NOT NULL,
    action text CONSTRAINT runtime_evidence_event_action_not_null1 NOT NULL,
    status text CONSTRAINT runtime_evidence_event_status_not_null1 NOT NULL,
    reason text CONSTRAINT runtime_evidence_event_reason_not_null1 NOT NULL,
    policy_refs text[] DEFAULT '{}'::text[] CONSTRAINT runtime_evidence_event_policy_refs_not_null1 NOT NULL,
    artifact_hash text CONSTRAINT runtime_evidence_event_artifact_hash_not_null1 NOT NULL,
    policy_context jsonb CONSTRAINT runtime_evidence_event_policy_context_not_null1 NOT NULL,
    raw_evidence jsonb CONSTRAINT runtime_evidence_event_raw_evidence_not_null1 NOT NULL,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT runtime_evidence_event_created_at_not_null1 NOT NULL,
    execution_trace jsonb,
    engine_version text,
    evidence_content_hash text CONSTRAINT runtime_evidence_event_evidence_content_hash_not_null NOT NULL,
    evidence_prev_hash text,
    erased_at timestamp with time zone,
    erased_by text,
    CONSTRAINT runtime_evidence_event_runtime_stack_check CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'LANGGRAPH'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'OPENCODE'::text, 'CLAUDE_CODE'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_runtime_stack_check1 CHECK ((runtime_stack = ANY (ARRAY['AWS_BEDROCK'::text, 'GOOGLE_ADK'::text, 'AZURE_AI'::text, 'LANGCHAIN'::text, 'CREWAI'::text, 'AUTOGEN'::text, 'OPENAI_AGENTS'::text, 'LOCAL'::text, 'CUSTOM'::text]))),
    CONSTRAINT runtime_evidence_event_status_check CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text, 'ESCALATE'::text]))),
    CONSTRAINT runtime_evidence_event_status_check1 CHECK ((status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text])))
);


--
-- Name: runtime_evidence_event_key; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_evidence_event_key (
    tenant_id uuid NOT NULL,
    decision_id text NOT NULL,
    evidence_event_id uuid,
    evidence_created_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: saml_authn_request; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saml_authn_request (
    request_id text NOT NULL,
    tenant_id uuid NOT NULL,
    value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    validation_lease_id text,
    validation_lease_expires_at timestamp with time zone,
    consumed_at timestamp with time zone
);


--
-- Name: scim_group_mapping; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scim_group_mapping (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    scim_group_id text NOT NULL,
    scim_group_name text NOT NULL,
    workspace_id uuid,
    assigned_role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scim_group_mapping_assigned_role_check CHECK ((assigned_role = ANY (ARRAY['ADMIN'::text, 'MEMBER'::text, 'REVIEWER'::text, 'AUDITOR'::text])))
);


--
-- Name: scim_token_registration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scim_token_registration (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    token_hash text NOT NULL,
    label text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone
);


--
-- Name: service_refresh_token; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_refresh_token (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    access_token_id uuid NOT NULL,
    token_hash text NOT NULL,
    token_prefix text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    rotated_at timestamp with time zone,
    rotated_into uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_token; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_token (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    label text NOT NULL,
    token_hash text NOT NULL,
    token_prefix text NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    key_type text DEFAULT 'SESSION'::text NOT NULL,
    created_by uuid,
    CONSTRAINT service_token_key_type_check CHECK ((key_type = ANY (ARRAY['SESSION'::text, 'API_KEY'::text]))),
    CONSTRAINT service_token_scopes_check CHECK ((scopes <@ ARRAY['bundle:read'::text, 'decision:evaluate'::text, 'evidence:write'::text, 'heartbeat:write'::text, 'compliance:read'::text, 'simulation:run'::text, 'approvals:read'::text, 'operations:read'::text, 'workflow:read'::text, 'members:read'::text, 'workspaces:read'::text, 'e2e:write'::text]))
);


--
-- Name: session_revocation_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_revocation_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid,
    tenant_id uuid NOT NULL,
    principal_id uuid,
    revocation_reason text,
    revoked_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: simulation_replay_finding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.simulation_replay_finding (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    simulation_run_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    event_id text NOT NULL,
    connector text NOT NULL,
    action text NOT NULL,
    previous_status text NOT NULL,
    proposed_status text NOT NULL,
    delta text NOT NULL,
    matched_policy_refs text[] DEFAULT '{}'::text[] NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT simulation_replay_finding_delta_check CHECK ((delta = ANY (ARRAY['UNCHANGED'::text, 'NEW_DENY'::text, 'NEW_ALLOW'::text, 'MODIFIED'::text]))),
    CONSTRAINT simulation_replay_finding_previous_status_check CHECK ((previous_status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text, 'ESCALATE'::text]))),
    CONSTRAINT simulation_replay_finding_proposed_status_check CHECK ((proposed_status = ANY (ARRAY['ALLOW'::text, 'DENY'::text, 'WARN'::text, 'ESCALATE'::text])))
);


--
-- Name: simulation_run; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.simulation_run (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    branch_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    source_event_count integer NOT NULL,
    newly_denied_count integer DEFAULT 0 NOT NULL,
    newly_allowed_count integer DEFAULT 0 NOT NULL,
    unchanged_count integer DEFAULT 0 NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    regression_summary jsonb,
    replay_coverage text DEFAULT 'SAMPLED'::text NOT NULL,
    CONSTRAINT simulation_run_replay_coverage_check CHECK ((replay_coverage = ANY (ARRAY['SAMPLED'::text, 'RETAINED_LOG'::text])))
);


--
-- Name: telemetry_setting; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_setting (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    opt_in boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tenant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    oidc_enabled boolean DEFAULT false NOT NULL,
    saml_enabled boolean DEFAULT false NOT NULL,
    require_mfa boolean DEFAULT false NOT NULL,
    mfa_grace_days integer DEFAULT 7 NOT NULL,
    default_locale text
);


--
-- Name: tenant_commercial_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_commercial_profile (
    tenant_id uuid NOT NULL,
    plan_code text DEFAULT 'HOSTED_TRIAL'::text NOT NULL,
    lifecycle_status text DEFAULT 'EVALUATING'::text NOT NULL,
    sales_status text DEFAULT 'NONE'::text NOT NULL,
    billing_contact_email text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    billing_provider text DEFAULT 'PADDLE'::text NOT NULL,
    billing_customer_id text,
    downgraded_at timestamp with time zone,
    retention_window_days integer,
    CONSTRAINT tenant_commercial_profile_lifecycle_status_check CHECK ((lifecycle_status = ANY (ARRAY['EVALUATING'::text, 'ACTIVE'::text, 'EXPANDING'::text, 'PAUSED'::text]))),
    CONSTRAINT tenant_commercial_profile_plan_code_check CHECK ((plan_code = ANY (ARRAY['HOSTED_TRIAL'::text, 'TEAM'::text, 'BUSINESS'::text, 'ENTERPRISE'::text]))),
    CONSTRAINT tenant_commercial_profile_sales_status_check CHECK ((sales_status = ANY (ARRAY['NONE'::text, 'REQUESTED'::text, 'QUALIFIED'::text, 'CONTRACTING'::text, 'CUSTOMER'::text])))
);


--
-- Name: tenant_sla_calendar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_sla_calendar (
    tenant_id uuid NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    work_days integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
    start_hour integer DEFAULT 9 NOT NULL,
    end_hour integer DEFAULT 17 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tenant_terminology_override; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_terminology_override (
    tenant_id uuid NOT NULL,
    locale text NOT NULL,
    translation_key text NOT NULL,
    custom_value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trust_calibration_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trust_calibration_policy (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    name text NOT NULL,
    description text,
    enabled boolean DEFAULT true NOT NULL,
    agent_class text,
    environment text,
    connector text,
    consequence_tier text,
    decay_enabled boolean DEFAULT false NOT NULL,
    decay_rate numeric(6,5),
    decay_period_hours integer,
    decay_floor numeric(6,5) DEFAULT 0.0,
    warn_threshold numeric(6,5),
    escalate_threshold numeric(6,5),
    review_threshold numeric(6,5),
    context_warn_threshold integer,
    context_escalate_threshold integer,
    created_by text DEFAULT 'system'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trust_calibration_policy_consequence_tier_check CHECK ((consequence_tier = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'CRITICAL'::text])))
);


--
-- Name: trusted_device; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trusted_device (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    principal_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    session_id uuid,
    name text DEFAULT ''::text NOT NULL,
    user_agent text,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: verified_pack_signature; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verified_pack_signature (
    pack_id text NOT NULL,
    pack_version text NOT NULL,
    signature text NOT NULL,
    public_key_fingerprint text NOT NULL,
    verified_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: web_onboarding_milestone; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.web_onboarding_milestone (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    milestone text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT web_onboarding_milestone_milestone_check CHECK ((milestone = ANY (ARRAY['starter_policy_published'::text, 'sample_decision_sent'::text, 'setup_token_generated'::text, 'gateway_test_sent'::text, 'first_real_evidence_received'::text, 'onboarding_completed'::text])))
);


--
-- Name: workspace; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_siem_stream; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_siem_stream (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    url text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_forwarded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_forwarded_id text,
    credentials_encrypted bytea,
    CONSTRAINT workspace_siem_stream_type_check CHECK ((type = ANY (ARRAY['SPLUNK_HEC'::text, 'SENTINEL'::text])))
);


--
-- Name: runtime_evidence_event_2026_05; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event ATTACH PARTITION public.runtime_evidence_event_2026_05 FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00');


--
-- Name: runtime_evidence_event_2026_06; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event ATTACH PARTITION public.runtime_evidence_event_2026_06 FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');


--
-- Name: runtime_evidence_event_2026_07; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event ATTACH PARTITION public.runtime_evidence_event_2026_07 FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');


--
-- Name: runtime_evidence_event_2026_08; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event ATTACH PARTITION public.runtime_evidence_event_2026_08 FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');


--
-- Name: runtime_evidence_event_2026_09; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event ATTACH PARTITION public.runtime_evidence_event_2026_09 FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');


--
-- Name: runtime_evidence_event_2026_10; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event ATTACH PARTITION public.runtime_evidence_event_2026_10 FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');


--
-- Name: runtime_evidence_event_2026_11; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event ATTACH PARTITION public.runtime_evidence_event_2026_11 FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');


--
-- Name: runtime_evidence_event_2026_12; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event ATTACH PARTITION public.runtime_evidence_event_2026_12 FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');


--
-- Name: runtime_evidence_event_2027_01; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event ATTACH PARTITION public.runtime_evidence_event_2027_01 FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');


--
-- Name: runtime_evidence_event_default; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event ATTACH PARTITION public.runtime_evidence_event_default DEFAULT;


--
-- Name: content_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_items ALTER COLUMN id SET DEFAULT nextval('public.content_items_id_seq'::regclass);


--
-- Name: action_receipt action_receipt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_receipt
    ADD CONSTRAINT action_receipt_pkey PRIMARY KEY (id);


--
-- Name: action_receipt action_receipt_tenant_gateway_stage_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_receipt
    ADD CONSTRAINT action_receipt_tenant_gateway_stage_key UNIQUE (tenant_id, gateway_decision_id, receipt_stage);


--
-- Name: action_receipt action_receipt_tenant_id_receipt_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_receipt
    ADD CONSTRAINT action_receipt_tenant_id_receipt_id_key UNIQUE (tenant_id, receipt_id);


--
-- Name: admin_audit_event admin_audit_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_event
    ADD CONSTRAINT admin_audit_event_pkey PRIMARY KEY (id);


--
-- Name: agent_blueprint_approval agent_blueprint_approval_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint_approval
    ADD CONSTRAINT agent_blueprint_approval_pkey PRIMARY KEY (id);


--
-- Name: agent_blueprint_approval agent_blueprint_approval_revision_id_reviewer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint_approval
    ADD CONSTRAINT agent_blueprint_approval_revision_id_reviewer_id_key UNIQUE (revision_id, reviewer_id);


--
-- Name: agent_blueprint agent_blueprint_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint
    ADD CONSTRAINT agent_blueprint_pkey PRIMARY KEY (id);


--
-- Name: agent_blueprint_revision agent_blueprint_revision_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint_revision
    ADD CONSTRAINT agent_blueprint_revision_pkey PRIMARY KEY (id);


--
-- Name: agent_blueprint_revision agent_blueprint_revision_tenant_id_blueprint_id_definition__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint_revision
    ADD CONSTRAINT agent_blueprint_revision_tenant_id_blueprint_id_definition__key UNIQUE (tenant_id, blueprint_id, definition_hash);


--
-- Name: agent_blueprint agent_blueprint_tenant_id_workspace_id_agent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint
    ADD CONSTRAINT agent_blueprint_tenant_id_workspace_id_agent_id_key UNIQUE (tenant_id, workspace_id, agent_id);


--
-- Name: agent_blueprint agent_blueprint_tenant_id_workspace_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint
    ADD CONSTRAINT agent_blueprint_tenant_id_workspace_id_name_key UNIQUE (tenant_id, workspace_id, name);


--
-- Name: agt_agent_surface_binding agt_agent_surface_binding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_agent_surface_binding
    ADD CONSTRAINT agt_agent_surface_binding_pkey PRIMARY KEY (id);


--
-- Name: agt_agent_surface_binding agt_agent_surface_binding_tenant_id_workspace_id_surface_ty_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_agent_surface_binding
    ADD CONSTRAINT agt_agent_surface_binding_tenant_id_workspace_id_surface_ty_key UNIQUE (tenant_id, workspace_id, surface_type, surface_agent_id);


--
-- Name: agt_identity_lifecycle_event agt_identity_lifecycle_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_identity_lifecycle_event
    ADD CONSTRAINT agt_identity_lifecycle_event_pkey PRIMARY KEY (id);


--
-- Name: agt_operations_log_chain_head agt_operations_log_chain_head_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_operations_log_chain_head
    ADD CONSTRAINT agt_operations_log_chain_head_pkey PRIMARY KEY (tenant_id);


--
-- Name: agt_operations_log agt_operations_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_operations_log
    ADD CONSTRAINT agt_operations_log_pkey PRIMARY KEY (id);


--
-- Name: agt_trust_score_event agt_trust_score_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_trust_score_event
    ADD CONSTRAINT agt_trust_score_event_pkey PRIMARY KEY (id);


--
-- Name: agt_verification_result agt_verification_result_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_verification_result
    ADD CONSTRAINT agt_verification_result_pkey PRIMARY KEY (id);


--
-- Name: alerting_integration alerting_integration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerting_integration
    ADD CONSTRAINT alerting_integration_pkey PRIMARY KEY (id);


--
-- Name: alerting_integration alerting_integration_tenant_id_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerting_integration
    ADD CONSTRAINT alerting_integration_tenant_id_workspace_id_id_key UNIQUE (tenant_id, workspace_id, id);


--
-- Name: alerting_integration alerting_integration_tenant_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerting_integration
    ADD CONSTRAINT alerting_integration_tenant_workspace_id_key UNIQUE (tenant_id, workspace_id, id);


--
-- Name: alerting_rule alerting_rule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerting_rule
    ADD CONSTRAINT alerting_rule_pkey PRIMARY KEY (id);


--
-- Name: app_principal app_principal_id_tenant_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_principal
    ADD CONSTRAINT app_principal_id_tenant_unique UNIQUE (id, tenant_id);


--
-- Name: app_principal app_principal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_principal
    ADD CONSTRAINT app_principal_pkey PRIMARY KEY (id);


--
-- Name: app_principal app_principal_tenant_id_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_principal
    ADD CONSTRAINT app_principal_tenant_id_subject_key UNIQUE (tenant_id, subject);


--
-- Name: app_session app_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_session
    ADD CONSTRAINT app_session_pkey PRIMARY KEY (id);


--
-- Name: approval_workflow_audit_event approval_workflow_audit_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_audit_event
    ADD CONSTRAINT approval_workflow_audit_event_pkey PRIMARY KEY (id);


--
-- Name: approval_workflow_config approval_workflow_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_config
    ADD CONSTRAINT approval_workflow_config_pkey PRIMARY KEY (id);


--
-- Name: approval_workflow_config approval_workflow_config_tenant_id_workspace_id_environment_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_config
    ADD CONSTRAINT approval_workflow_config_tenant_id_workspace_id_environment_key UNIQUE (tenant_id, workspace_id, environment);


--
-- Name: approval_workflow_rule approval_workflow_rule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_rule
    ADD CONSTRAINT approval_workflow_rule_pkey PRIMARY KEY (id);


--
-- Name: approval_workflow_rule approval_workflow_rule_workflow_id_sequence_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_rule
    ADD CONSTRAINT approval_workflow_rule_workflow_id_sequence_role_key UNIQUE (workflow_id, sequence, role);


--
-- Name: auth_rate_limit auth_rate_limit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_rate_limit
    ADD CONSTRAINT auth_rate_limit_pkey PRIMARY KEY (key);


--
-- Name: authz_denial_event authz_denial_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authz_denial_event
    ADD CONSTRAINT authz_denial_event_pkey PRIMARY KEY (id);


--
-- Name: bundle_export_log bundle_export_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bundle_export_log
    ADD CONSTRAINT bundle_export_log_pkey PRIMARY KEY (id);


--
-- Name: cli_onboarding_request cli_onboarding_request_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_onboarding_request
    ADD CONSTRAINT cli_onboarding_request_code_key UNIQUE (code);


--
-- Name: cli_onboarding_request cli_onboarding_request_device_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_onboarding_request
    ADD CONSTRAINT cli_onboarding_request_device_code_unique UNIQUE (device_code);


--
-- Name: cli_onboarding_request cli_onboarding_request_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_onboarding_request
    ADD CONSTRAINT cli_onboarding_request_pkey PRIMARY KEY (id);


--
-- Name: cli_onboarding_request cli_onboarding_request_user_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_onboarding_request
    ADD CONSTRAINT cli_onboarding_request_user_code_unique UNIQUE (user_code);


--
-- Name: commercial_event commercial_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_event
    ADD CONSTRAINT commercial_event_pkey PRIMARY KEY (id);


--
-- Name: consumed_magic_link consumed_magic_link_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumed_magic_link
    ADD CONSTRAINT consumed_magic_link_pkey PRIMARY KEY (jti);


--
-- Name: content_items content_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_items
    ADD CONSTRAINT content_items_pkey PRIMARY KEY (id);


--
-- Name: context_budget_event context_budget_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_budget_event
    ADD CONSTRAINT context_budget_event_pkey PRIMARY KEY (id);


--
-- Name: conversion_telemetry_event conversion_telemetry_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversion_telemetry_event
    ADD CONSTRAINT conversion_telemetry_event_pkey PRIMARY KEY (id);


--
-- Name: gateway_credential_broker gateway_credential_broker_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_credential_broker
    ADD CONSTRAINT gateway_credential_broker_pkey PRIMARY KEY (id);


--
-- Name: gateway_credential_broker gateway_credential_broker_tenant_id_workspace_id_connector__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_credential_broker
    ADD CONSTRAINT gateway_credential_broker_tenant_id_workspace_id_connector__key UNIQUE (tenant_id, workspace_id, connector, action);


--
-- Name: gateway_credential_grant gateway_credential_grant_decision_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_credential_grant
    ADD CONSTRAINT gateway_credential_grant_decision_unique UNIQUE (gateway_decision_id);


--
-- Name: gateway_credential_grant gateway_credential_grant_gateway_decision_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_credential_grant
    ADD CONSTRAINT gateway_credential_grant_gateway_decision_id_key UNIQUE (gateway_decision_id);


--
-- Name: gateway_credential_grant gateway_credential_grant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_credential_grant
    ADD CONSTRAINT gateway_credential_grant_pkey PRIMARY KEY (id);


--
-- Name: gateway_decision gateway_decision_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_decision
    ADD CONSTRAINT gateway_decision_pkey PRIMARY KEY (id);


--
-- Name: gateway_decision gateway_decision_tenant_id_decision_id_artifact_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_decision
    ADD CONSTRAINT gateway_decision_tenant_id_decision_id_artifact_hash_key UNIQUE (tenant_id, decision_id, artifact_hash);


--
-- Name: gateway_escalation_queue gateway_escalation_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_escalation_queue
    ADD CONSTRAINT gateway_escalation_queue_pkey PRIMARY KEY (id);


--
-- Name: gateway_escalation_queue gateway_escalation_queue_tenant_id_decision_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_escalation_queue
    ADD CONSTRAINT gateway_escalation_queue_tenant_id_decision_id_key UNIQUE (tenant_id, decision_id);


--
-- Name: gateway_webhook_registration gateway_webhook_registration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_webhook_registration
    ADD CONSTRAINT gateway_webhook_registration_pkey PRIMARY KEY (id);


--
-- Name: gateway_webhook_registration gateway_webhook_registration_secret_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_webhook_registration
    ADD CONSTRAINT gateway_webhook_registration_secret_hash_key UNIQUE (secret_hash);


--
-- Name: gateway_webhook_replay_check gateway_webhook_replay_check_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_webhook_replay_check
    ADD CONSTRAINT gateway_webhook_replay_check_pkey PRIMARY KEY (event_id, tenant_id, provider);


--
-- Name: grc_delivery_attempt grc_delivery_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grc_delivery_attempt
    ADD CONSTRAINT grc_delivery_attempt_pkey PRIMARY KEY (id);


--
-- Name: grc_delivery_destination grc_delivery_destination_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grc_delivery_destination
    ADD CONSTRAINT grc_delivery_destination_pkey PRIMARY KEY (id);


--
-- Name: grc_delivery_destination grc_delivery_destination_tenant_id_workspace_id_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grc_delivery_destination
    ADD CONSTRAINT grc_delivery_destination_tenant_id_workspace_id_endpoint_key UNIQUE (tenant_id, workspace_id, endpoint);


--
-- Name: identity_provider identity_provider_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_provider
    ADD CONSTRAINT identity_provider_pkey PRIMARY KEY (id);


--
-- Name: identity_provider identity_provider_tenant_id_provider_type_issuer_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_provider
    ADD CONSTRAINT identity_provider_tenant_id_provider_type_issuer_key UNIQUE (tenant_id, provider_type, issuer);


--
-- Name: mcp_tool_grant mcp_tool_grant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_tool_grant
    ADD CONSTRAINT mcp_tool_grant_pkey PRIMARY KEY (id);


--
-- Name: mcp_tool_registry mcp_tool_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_tool_registry
    ADD CONSTRAINT mcp_tool_registry_pkey PRIMARY KEY (id);


--
-- Name: mcp_tool_registry mcp_tool_registry_tenant_id_server_name_tool_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_tool_registry
    ADD CONSTRAINT mcp_tool_registry_tenant_id_server_name_tool_name_key UNIQUE (tenant_id, server_name, tool_name);


--
-- Name: mfa_enrollment mfa_enrollment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_enrollment
    ADD CONSTRAINT mfa_enrollment_pkey PRIMARY KEY (id);


--
-- Name: notification_delivery notification_delivery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery
    ADD CONSTRAINT notification_delivery_pkey PRIMARY KEY (event_id, integration_id);


--
-- Name: passkey passkey_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey
    ADD CONSTRAINT passkey_pkey PRIMARY KEY (id);


--
-- Name: passkey passkey_tenant_id_credential_id_b64_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey
    ADD CONSTRAINT passkey_tenant_id_credential_id_b64_key UNIQUE (tenant_id, credential_id_b64);


--
-- Name: policy_approval policy_approval_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_approval
    ADD CONSTRAINT policy_approval_pkey PRIMARY KEY (id);


--
-- Name: policy_approval policy_approval_revision_id_reviewer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_approval
    ADD CONSTRAINT policy_approval_revision_id_reviewer_id_key UNIQUE (revision_id, reviewer_id);


--
-- Name: policy_branch policy_branch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_branch
    ADD CONSTRAINT policy_branch_pkey PRIMARY KEY (id);


--
-- Name: policy_branch policy_branch_tenant_id_workspace_id_scope_environment_conn_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_branch
    ADD CONSTRAINT policy_branch_tenant_id_workspace_id_scope_environment_conn_key UNIQUE (tenant_id, workspace_id, scope, environment, connector, name);


--
-- Name: policy_publish policy_publish_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_publish
    ADD CONSTRAINT policy_publish_pkey PRIMARY KEY (id);


--
-- Name: policy_revision policy_revision_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_revision
    ADD CONSTRAINT policy_revision_pkey PRIMARY KEY (id);


--
-- Name: policy_rule policy_rule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_rule
    ADD CONSTRAINT policy_rule_pkey PRIMARY KEY (id);


--
-- Name: policy_rule policy_rule_tenant_id_revision_id_stable_rule_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_rule
    ADD CONSTRAINT policy_rule_tenant_id_revision_id_stable_rule_id_key UNIQUE (tenant_id, revision_id, stable_rule_id);


--
-- Name: principal_external_identity principal_external_identity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_external_identity
    ADD CONSTRAINT principal_external_identity_pkey PRIMARY KEY (id);


--
-- Name: principal_external_identity principal_external_identity_provider_id_external_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_external_identity
    ADD CONSTRAINT principal_external_identity_provider_id_external_subject_key UNIQUE (provider_id, external_subject);


--
-- Name: principal_external_identity principal_external_identity_tenant_id_principal_id_external_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_external_identity
    ADD CONSTRAINT principal_external_identity_tenant_id_principal_id_external_key UNIQUE (tenant_id, principal_id, external_subject);


--
-- Name: principal_permission_grant principal_permission_grant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_permission_grant
    ADD CONSTRAINT principal_permission_grant_pkey PRIMARY KEY (id);


--
-- Name: principal_permission_grant principal_permission_grant_principal_id_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_permission_grant
    ADD CONSTRAINT principal_permission_grant_principal_id_workspace_id_key UNIQUE (principal_id, workspace_id);


--
-- Name: rbac_audit_event rbac_audit_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_audit_event
    ADD CONSTRAINT rbac_audit_event_pkey PRIMARY KEY (id);


--
-- Name: rbac_custom_role rbac_custom_role_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_custom_role
    ADD CONSTRAINT rbac_custom_role_pkey PRIMARY KEY (id);


--
-- Name: rbac_custom_role rbac_custom_role_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_custom_role
    ADD CONSTRAINT rbac_custom_role_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: recovery_code recovery_code_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recovery_code
    ADD CONSTRAINT recovery_code_pkey PRIMARY KEY (id);


--
-- Name: runtime_adapter_declaration runtime_adapter_declaration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_adapter_declaration
    ADD CONSTRAINT runtime_adapter_declaration_pkey PRIMARY KEY (id);


--
-- Name: runtime_adapter_declaration runtime_adapter_declaration_tenant_id_workspace_id_environm_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_adapter_declaration
    ADD CONSTRAINT runtime_adapter_declaration_tenant_id_workspace_id_environm_key UNIQUE (tenant_id, workspace_id, environment, stack, adapter_id);


--
-- Name: runtime_evidence_chain_head runtime_evidence_chain_head_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_chain_head
    ADD CONSTRAINT runtime_evidence_chain_head_pkey PRIMARY KEY (tenant_id);


--
-- Name: runtime_evidence_event runtime_evidence_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event
    ADD CONSTRAINT runtime_evidence_event_pkey PRIMARY KEY (id, created_at);


--
-- Name: runtime_evidence_event_2026_05 runtime_evidence_event_2026_05_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_05
    ADD CONSTRAINT runtime_evidence_event_2026_05_pkey PRIMARY KEY (id, created_at);


--
-- Name: runtime_evidence_event_2026_06 runtime_evidence_event_2026_06_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_06
    ADD CONSTRAINT runtime_evidence_event_2026_06_pkey PRIMARY KEY (id, created_at);


--
-- Name: runtime_evidence_event_2026_07 runtime_evidence_event_2026_07_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_07
    ADD CONSTRAINT runtime_evidence_event_2026_07_pkey PRIMARY KEY (id, created_at);


--
-- Name: runtime_evidence_event_2026_08 runtime_evidence_event_2026_08_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_08
    ADD CONSTRAINT runtime_evidence_event_2026_08_pkey PRIMARY KEY (id, created_at);


--
-- Name: runtime_evidence_event_2026_09 runtime_evidence_event_2026_09_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_09
    ADD CONSTRAINT runtime_evidence_event_2026_09_pkey PRIMARY KEY (id, created_at);


--
-- Name: runtime_evidence_event runtime_evidence_event_tenant_id_decision_id_created_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event
    ADD CONSTRAINT runtime_evidence_event_tenant_id_decision_id_created_at_key UNIQUE (tenant_id, decision_id, created_at);


--
-- Name: runtime_evidence_event_2026_07 runtime_evidence_event_2026_0_tenant_id_decision_id_create_key1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_07
    ADD CONSTRAINT runtime_evidence_event_2026_0_tenant_id_decision_id_create_key1 UNIQUE (tenant_id, decision_id, created_at);


--
-- Name: runtime_evidence_event_2026_08 runtime_evidence_event_2026_0_tenant_id_decision_id_create_key2; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_08
    ADD CONSTRAINT runtime_evidence_event_2026_0_tenant_id_decision_id_create_key2 UNIQUE (tenant_id, decision_id, created_at);


--
-- Name: runtime_evidence_event_2026_09 runtime_evidence_event_2026_0_tenant_id_decision_id_create_key3; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_09
    ADD CONSTRAINT runtime_evidence_event_2026_0_tenant_id_decision_id_create_key3 UNIQUE (tenant_id, decision_id, created_at);


--
-- Name: runtime_evidence_event_2026_05 runtime_evidence_event_2026_0_tenant_id_decision_id_create_key4; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_05
    ADD CONSTRAINT runtime_evidence_event_2026_0_tenant_id_decision_id_create_key4 UNIQUE (tenant_id, decision_id, created_at);


--
-- Name: runtime_evidence_event_2026_06 runtime_evidence_event_2026_0_tenant_id_decision_id_created_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_06
    ADD CONSTRAINT runtime_evidence_event_2026_0_tenant_id_decision_id_created_key UNIQUE (tenant_id, decision_id, created_at);


--
-- Name: runtime_evidence_event_2026_10 runtime_evidence_event_2026_10_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_10
    ADD CONSTRAINT runtime_evidence_event_2026_10_pkey PRIMARY KEY (id, created_at);


--
-- Name: runtime_evidence_event_2026_11 runtime_evidence_event_2026_11_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_11
    ADD CONSTRAINT runtime_evidence_event_2026_11_pkey PRIMARY KEY (id, created_at);


--
-- Name: runtime_evidence_event_2026_12 runtime_evidence_event_2026_12_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_12
    ADD CONSTRAINT runtime_evidence_event_2026_12_pkey PRIMARY KEY (id, created_at);


--
-- Name: runtime_evidence_event_2026_11 runtime_evidence_event_2026_1_tenant_id_decision_id_create_key1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_11
    ADD CONSTRAINT runtime_evidence_event_2026_1_tenant_id_decision_id_create_key1 UNIQUE (tenant_id, decision_id, created_at);


--
-- Name: runtime_evidence_event_2026_12 runtime_evidence_event_2026_1_tenant_id_decision_id_create_key2; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_12
    ADD CONSTRAINT runtime_evidence_event_2026_1_tenant_id_decision_id_create_key2 UNIQUE (tenant_id, decision_id, created_at);


--
-- Name: runtime_evidence_event_2026_10 runtime_evidence_event_2026_1_tenant_id_decision_id_created_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2026_10
    ADD CONSTRAINT runtime_evidence_event_2026_1_tenant_id_decision_id_created_key UNIQUE (tenant_id, decision_id, created_at);


--
-- Name: runtime_evidence_event_2027_01 runtime_evidence_event_2027_01_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2027_01
    ADD CONSTRAINT runtime_evidence_event_2027_01_pkey PRIMARY KEY (id, created_at);


--
-- Name: runtime_evidence_event_2027_01 runtime_evidence_event_2027_0_tenant_id_decision_id_created_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_2027_01
    ADD CONSTRAINT runtime_evidence_event_2027_0_tenant_id_decision_id_created_key UNIQUE (tenant_id, decision_id, created_at);


--
-- Name: runtime_evidence_event_default runtime_evidence_event_defaul_tenant_id_decision_id_created_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_default
    ADD CONSTRAINT runtime_evidence_event_defaul_tenant_id_decision_id_created_key UNIQUE (tenant_id, decision_id, created_at);


--
-- Name: runtime_evidence_event_default runtime_evidence_event_default_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_default
    ADD CONSTRAINT runtime_evidence_event_default_pkey PRIMARY KEY (id, created_at);


--
-- Name: runtime_evidence_event_key runtime_evidence_event_key_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_key
    ADD CONSTRAINT runtime_evidence_event_key_pkey PRIMARY KEY (tenant_id, decision_id);


--
-- Name: saml_authn_request saml_authn_request_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saml_authn_request
    ADD CONSTRAINT saml_authn_request_pkey PRIMARY KEY (request_id);


--
-- Name: scim_group_mapping scim_group_mapping_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scim_group_mapping
    ADD CONSTRAINT scim_group_mapping_pkey PRIMARY KEY (id);


--
-- Name: scim_group_mapping scim_group_mapping_tenant_id_scim_group_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scim_group_mapping
    ADD CONSTRAINT scim_group_mapping_tenant_id_scim_group_id_key UNIQUE (tenant_id, scim_group_id);


--
-- Name: scim_token_registration scim_token_registration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scim_token_registration
    ADD CONSTRAINT scim_token_registration_pkey PRIMARY KEY (id);


--
-- Name: scim_token_registration scim_token_registration_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scim_token_registration
    ADD CONSTRAINT scim_token_registration_token_hash_key UNIQUE (token_hash);


--
-- Name: service_refresh_token service_refresh_token_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_refresh_token
    ADD CONSTRAINT service_refresh_token_pkey PRIMARY KEY (id);


--
-- Name: service_refresh_token service_refresh_token_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_refresh_token
    ADD CONSTRAINT service_refresh_token_token_hash_key UNIQUE (token_hash);


--
-- Name: service_token service_token_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_token
    ADD CONSTRAINT service_token_pkey PRIMARY KEY (id);


--
-- Name: service_token service_token_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_token
    ADD CONSTRAINT service_token_token_hash_key UNIQUE (token_hash);


--
-- Name: session_revocation_event session_revocation_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_revocation_event
    ADD CONSTRAINT session_revocation_event_pkey PRIMARY KEY (id);


--
-- Name: simulation_replay_finding simulation_replay_finding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulation_replay_finding
    ADD CONSTRAINT simulation_replay_finding_pkey PRIMARY KEY (id);


--
-- Name: simulation_replay_finding simulation_replay_finding_simulation_run_id_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulation_replay_finding
    ADD CONSTRAINT simulation_replay_finding_simulation_run_id_event_id_key UNIQUE (simulation_run_id, event_id);


--
-- Name: simulation_run simulation_run_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulation_run
    ADD CONSTRAINT simulation_run_pkey PRIMARY KEY (id);


--
-- Name: telemetry_setting telemetry_setting_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_setting
    ADD CONSTRAINT telemetry_setting_pkey PRIMARY KEY (id);


--
-- Name: telemetry_setting telemetry_setting_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_setting
    ADD CONSTRAINT telemetry_setting_tenant_id_key UNIQUE (tenant_id);


--
-- Name: tenant_commercial_profile tenant_commercial_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_commercial_profile
    ADD CONSTRAINT tenant_commercial_profile_pkey PRIMARY KEY (tenant_id);


--
-- Name: tenant tenant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_pkey PRIMARY KEY (id);


--
-- Name: tenant_sla_calendar tenant_sla_calendar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_sla_calendar
    ADD CONSTRAINT tenant_sla_calendar_pkey PRIMARY KEY (tenant_id);


--
-- Name: tenant tenant_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_slug_key UNIQUE (slug);


--
-- Name: tenant_terminology_override tenant_terminology_override_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_terminology_override
    ADD CONSTRAINT tenant_terminology_override_pkey PRIMARY KEY (tenant_id, locale, translation_key);


--
-- Name: trust_calibration_policy trust_calibration_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trust_calibration_policy
    ADD CONSTRAINT trust_calibration_policy_pkey PRIMARY KEY (id);


--
-- Name: trusted_device trusted_device_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trusted_device
    ADD CONSTRAINT trusted_device_pkey PRIMARY KEY (id);


--
-- Name: verified_pack_signature verified_pack_signature_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verified_pack_signature
    ADD CONSTRAINT verified_pack_signature_pkey PRIMARY KEY (pack_id);


--
-- Name: web_onboarding_milestone web_onboarding_milestone_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_onboarding_milestone
    ADD CONSTRAINT web_onboarding_milestone_pkey PRIMARY KEY (id);


--
-- Name: web_onboarding_milestone web_onboarding_milestone_tenant_id_workspace_id_milestone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_onboarding_milestone
    ADD CONSTRAINT web_onboarding_milestone_tenant_id_workspace_id_milestone_key UNIQUE (tenant_id, workspace_id, milestone);


--
-- Name: workspace workspace_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_pkey PRIMARY KEY (id);


--
-- Name: workspace_siem_stream workspace_siem_stream_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_siem_stream
    ADD CONSTRAINT workspace_siem_stream_pkey PRIMARY KEY (id);


--
-- Name: workspace_siem_stream workspace_siem_stream_tenant_id_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_siem_stream
    ADD CONSTRAINT workspace_siem_stream_tenant_id_workspace_id_id_key UNIQUE (tenant_id, workspace_id, id);


--
-- Name: workspace workspace_tenant_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_tenant_id_slug_key UNIQUE (tenant_id, slug);


--
-- Name: action_receipt_decision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX action_receipt_decision_idx ON public.action_receipt USING btree (tenant_id, decision_id);


--
-- Name: action_receipt_workspace_issued_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX action_receipt_workspace_issued_idx ON public.action_receipt USING btree (tenant_id, workspace_id, issued_at DESC);


--
-- Name: admin_audit_event_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_event_scope_idx ON public.admin_audit_event USING btree (tenant_id, workspace_id, action, created_at DESC);


--
-- Name: agt_identity_lifecycle_event_agent_did_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agt_identity_lifecycle_event_agent_did_idx ON public.agt_identity_lifecycle_event USING btree (tenant_id, agent_did, created_at DESC);


--
-- Name: agt_identity_lifecycle_event_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agt_identity_lifecycle_event_principal_idx ON public.agt_identity_lifecycle_event USING btree (tenant_id, principal_id, created_at DESC);


--
-- Name: agt_identity_lifecycle_event_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agt_identity_lifecycle_event_type_idx ON public.agt_identity_lifecycle_event USING btree (tenant_id, event_type, created_at DESC);


--
-- Name: agt_operations_log_event_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agt_operations_log_event_type_idx ON public.agt_operations_log USING btree (tenant_id, event_type, created_at DESC);


--
-- Name: agt_operations_log_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agt_operations_log_source_idx ON public.agt_operations_log USING btree (tenant_id, source_table, source_id);


--
-- Name: agt_operations_log_tenant_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agt_operations_log_tenant_time_idx ON public.agt_operations_log USING btree (tenant_id, created_at DESC);


--
-- Name: agt_trust_score_event_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agt_trust_score_event_agent_idx ON public.agt_trust_score_event USING btree (tenant_id, workspace_id, agent_id, created_at DESC);


--
-- Name: agt_trust_score_event_stack_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agt_trust_score_event_stack_idx ON public.agt_trust_score_event USING btree (tenant_id, runtime_stack, created_at DESC);


--
-- Name: agt_verification_result_artifact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agt_verification_result_artifact_idx ON public.agt_verification_result USING btree (tenant_id, artifact_hash, created_at DESC);


--
-- Name: agt_verification_result_engine_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agt_verification_result_engine_idx ON public.agt_verification_result USING btree (tenant_id, agt_version, agt_policies_version, created_at DESC);


--
-- Name: agt_verification_result_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agt_verification_result_outcome_idx ON public.agt_verification_result USING btree (tenant_id, outcome, created_at DESC);


--
-- Name: agt_verification_result_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agt_verification_result_revision_idx ON public.agt_verification_result USING btree (tenant_id, revision_id, created_at DESC);


--
-- Name: agt_verification_result_run_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agt_verification_result_run_type_idx ON public.agt_verification_result USING btree (run_by, verification_type, created_at DESC);


--
-- Name: alerting_integration_tenant_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX alerting_integration_tenant_workspace_idx ON public.alerting_integration USING btree (tenant_id, workspace_id);


--
-- Name: alerting_rule_tenant_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX alerting_rule_tenant_workspace_idx ON public.alerting_rule USING btree (tenant_id, workspace_id, enabled);


--
-- Name: app_principal_magic_link_owner_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX app_principal_magic_link_owner_email_idx ON public.app_principal USING btree (lower(email)) WHERE ((auth_method = 'MAGIC_LINK'::text) AND (org_role = 'OWNER'::text) AND (disabled_at IS NULL));


--
-- Name: app_principal_member_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_principal_member_status_idx ON public.app_principal USING btree (tenant_id, principal_type, invite_status, disabled_at, created_at);


--
-- Name: app_principal_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_principal_tenant_idx ON public.app_principal USING btree (tenant_id, subject);


--
-- Name: app_session_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_session_lookup_idx ON public.app_session USING btree (id, expires_at, revoked_at);


--
-- Name: app_session_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_session_principal_idx ON public.app_session USING btree (tenant_id, principal_id, created_at DESC);


--
-- Name: approval_workflow_audit_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_workflow_audit_scope_idx ON public.approval_workflow_audit_event USING btree (tenant_id, workspace_id, action, created_at DESC);


--
-- Name: approval_workflow_config_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_workflow_config_lookup_idx ON public.approval_workflow_config USING btree (tenant_id, workspace_id, environment, enabled);


--
-- Name: approval_workflow_config_scope_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX approval_workflow_config_scope_unique_idx ON public.approval_workflow_config USING btree (tenant_id, COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(environment, ''::text));


--
-- Name: approval_workflow_rule_workflow_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_workflow_rule_workflow_idx ON public.approval_workflow_rule USING btree (workflow_id, sequence);


--
-- Name: auth_rate_limit_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_rate_limit_window_start_idx ON public.auth_rate_limit USING btree (window_start);


--
-- Name: authz_denial_event_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX authz_denial_event_scope_idx ON public.authz_denial_event USING btree (tenant_id, workspace_id, action, created_at DESC);


--
-- Name: cli_onboarding_request_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cli_onboarding_request_code_idx ON public.cli_onboarding_request USING btree (code, expires_at);


--
-- Name: cli_onboarding_request_device_code_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cli_onboarding_request_device_code_active_idx ON public.cli_onboarding_request USING btree (device_code, expires_at) WHERE ((flow_type = 'DEVICE'::text) AND (device_code IS NOT NULL));


--
-- Name: commercial_event_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commercial_event_scope_idx ON public.commercial_event USING btree (tenant_id, workspace_id, created_at DESC);


--
-- Name: consumed_magic_link_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consumed_magic_link_expires_at_idx ON public.consumed_magic_link USING btree (expires_at);


--
-- Name: content_items_published_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_items_published_at_index ON public.content_items USING btree (published_at);


--
-- Name: content_items_type_slug_index; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX content_items_type_slug_index ON public.content_items USING btree (type, slug);


--
-- Name: context_budget_event_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX context_budget_event_agent_idx ON public.context_budget_event USING btree (tenant_id, workspace_id, agent_id, created_at DESC);


--
-- Name: context_budget_event_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX context_budget_event_session_idx ON public.context_budget_event USING btree (tenant_id, workspace_id, session_id, created_at DESC);


--
-- Name: context_budget_event_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX context_budget_event_type_idx ON public.context_budget_event USING btree (tenant_id, event_type, created_at DESC);


--
-- Name: conversion_telemetry_first_occurrence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX conversion_telemetry_first_occurrence_idx ON public.conversion_telemetry_event USING btree (tenant_id, event_type) WHERE (event_type = ANY (ARRAY['SIGNUP_COMPLETED'::text, 'TRIAL_START'::text, 'FIRST_EVIDENCE_INGEST'::text, 'FIRST_COMPLIANCE_EXPORT'::text, 'FIRST_HITL_ESCALATION'::text, 'TRIAL_CONVERTED'::text]));


--
-- Name: gateway_credential_broker_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gateway_credential_broker_lookup_idx ON public.gateway_credential_broker USING btree (tenant_id, workspace_id, connector);


--
-- Name: gateway_decision_agent_continuity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gateway_decision_agent_continuity_idx ON public.gateway_decision USING btree (tenant_id, workspace_id, agent_id, evaluated_at DESC) WHERE (agent_id IS NOT NULL);


--
-- Name: gateway_decision_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gateway_decision_lookup_idx ON public.gateway_decision USING btree (tenant_id, workspace_id, revision_id, outcome, evaluated_at DESC);


--
-- Name: gateway_decision_session_guardrail_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gateway_decision_session_guardrail_idx ON public.gateway_decision USING btree (tenant_id, workspace_id, agent_id, session_id, evaluated_at DESC) WHERE ((agent_id IS NOT NULL) AND (session_id IS NOT NULL));


--
-- Name: gateway_decision_workspace_decision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gateway_decision_workspace_decision_idx ON public.gateway_decision USING btree (tenant_id, workspace_id, decision_id);


--
-- Name: gateway_escalation_queue_active_sla_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gateway_escalation_queue_active_sla_idx ON public.gateway_escalation_queue USING btree (status, sla_due_at) WHERE (status = ANY (ARRAY['PENDING'::text, 'IN_REVIEW'::text]));


--
-- Name: gateway_escalation_queue_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gateway_escalation_queue_revision_idx ON public.gateway_escalation_queue USING btree (tenant_id, revision_id, status);


--
-- Name: gateway_escalation_queue_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gateway_escalation_queue_status_idx ON public.gateway_escalation_queue USING btree (tenant_id, workspace_id, status, sla_due_at);


--
-- Name: gateway_webhook_registration_secret_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX gateway_webhook_registration_secret_hash_idx ON public.gateway_webhook_registration USING btree (secret_hash) WHERE (revoked_at IS NULL);


--
-- Name: gateway_webhook_registration_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gateway_webhook_registration_workspace_idx ON public.gateway_webhook_registration USING btree (tenant_id, workspace_id);


--
-- Name: gateway_webhook_replay_check_first_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gateway_webhook_replay_check_first_seen_idx ON public.gateway_webhook_replay_check USING btree (first_seen);


--
-- Name: grc_delivery_attempt_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grc_delivery_attempt_history_idx ON public.grc_delivery_attempt USING btree (tenant_id, workspace_id, destination_id, created_at DESC);


--
-- Name: grc_delivery_destination_ready_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grc_delivery_destination_ready_idx ON public.grc_delivery_destination USING btree (tenant_id, workspace_id, enabled) WHERE enabled;


--
-- Name: identity_provider_issuer_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_provider_issuer_lookup_idx ON public.identity_provider USING btree (provider_type, issuer, created_at);


--
-- Name: idx_agent_blueprint_approval_revision; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_blueprint_approval_revision ON public.agent_blueprint_approval USING btree (tenant_id, revision_id, reviewed_at DESC);


--
-- Name: idx_agent_blueprint_revision_blueprint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_blueprint_revision_blueprint ON public.agent_blueprint_revision USING btree (tenant_id, blueprint_id, created_at DESC);


--
-- Name: idx_agent_blueprint_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_blueprint_workspace ON public.agent_blueprint USING btree (tenant_id, workspace_id, updated_at DESC);


--
-- Name: idx_agt_agent_surface_binding_canonical; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agt_agent_surface_binding_canonical ON public.agt_agent_surface_binding USING btree (tenant_id, workspace_id, canonical_agent_id);


--
-- Name: idx_agt_agent_surface_binding_surface; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agt_agent_surface_binding_surface ON public.agt_agent_surface_binding USING btree (tenant_id, workspace_id, surface_type, surface_agent_id);


--
-- Name: idx_bundle_export_log_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bundle_export_log_tenant_created ON public.bundle_export_log USING btree (tenant_id, created_at DESC);


--
-- Name: idx_bundle_export_log_workspace_revision; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bundle_export_log_workspace_revision ON public.bundle_export_log USING btree (workspace_id, revision_id, format);


--
-- Name: mcp_tool_grant_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_tool_grant_lookup_idx ON public.mcp_tool_grant USING btree (tenant_id, workspace_id, agent_id, environment) WHERE (allowed = true);


--
-- Name: mcp_tool_grant_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mcp_tool_grant_unique_idx ON public.mcp_tool_grant USING btree (tenant_id, workspace_id, registry_id, COALESCE(agent_id, '*'::text), environment);


--
-- Name: mcp_tool_registry_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_tool_registry_lookup_idx ON public.mcp_tool_registry USING btree (tenant_id, connector, action) WHERE (status = 'ACTIVE'::text);


--
-- Name: mfa_enrollment_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mfa_enrollment_principal_idx ON public.mfa_enrollment USING btree (tenant_id, principal_id, mfa_type);


--
-- Name: notification_delivery_undelivered_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_delivery_undelivered_idx ON public.notification_delivery USING btree (updated_at) WHERE (delivered = false);


--
-- Name: passkey_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX passkey_principal_idx ON public.passkey USING btree (tenant_id, principal_id);


--
-- Name: policy_branch_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX policy_branch_scope_idx ON public.policy_branch USING btree (tenant_id, workspace_id, scope);


--
-- Name: policy_revision_branch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX policy_revision_branch_idx ON public.policy_revision USING btree (branch_id, created_at DESC);


--
-- Name: policy_rule_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX policy_rule_revision_idx ON public.policy_rule USING btree (tenant_id, revision_id);


--
-- Name: policy_rule_search_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX policy_rule_search_idx ON public.policy_rule USING gin (search_text);


--
-- Name: policy_rule_tags_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX policy_rule_tags_idx ON public.policy_rule USING gin (domains, connectors, actions);


--
-- Name: principal_external_identity_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX principal_external_identity_lookup_idx ON public.principal_external_identity USING btree (tenant_id, external_subject);


--
-- Name: principal_permission_grant_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX principal_permission_grant_lookup_idx ON public.principal_permission_grant USING btree (tenant_id, principal_id, workspace_id);


--
-- Name: principal_permission_grant_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX principal_permission_grant_role_idx ON public.principal_permission_grant USING btree (tenant_id, workspace_id, grant_role);


--
-- Name: rbac_audit_event_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rbac_audit_event_scope_idx ON public.rbac_audit_event USING btree (tenant_id, workspace_id, action, created_at DESC);


--
-- Name: recovery_code_lookup_hmac_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recovery_code_lookup_hmac_idx ON public.recovery_code USING btree (tenant_id, principal_id, code_lookup) WHERE (code_lookup IS NOT NULL);


--
-- Name: recovery_code_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX recovery_code_lookup_idx ON public.recovery_code USING btree (tenant_id, principal_id, code_hash);


--
-- Name: runtime_adapter_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_adapter_workspace_idx ON public.runtime_adapter_declaration USING btree (tenant_id, workspace_id, environment);


--
-- Name: runtime_evidence_chain_head_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_chain_head_idx ON ONLY public.runtime_evidence_event USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: runtime_evidence_chain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_chain_idx ON ONLY public.runtime_evidence_event USING btree (tenant_id, evidence_content_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_05_tenant_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_05_tenant_id_created_at_id_idx ON public.runtime_evidence_event_2026_05 USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: runtime_evidence_event_2026_06_tenant_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_06_tenant_id_created_at_id_idx ON public.runtime_evidence_event_2026_06 USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: runtime_evidence_event_2026_07_tenant_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_07_tenant_id_created_at_id_idx ON public.runtime_evidence_event_2026_07 USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: runtime_evidence_event_2026_08_tenant_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_08_tenant_id_created_at_id_idx ON public.runtime_evidence_event_2026_08 USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: runtime_evidence_event_2026_09_tenant_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_09_tenant_id_created_at_id_idx ON public.runtime_evidence_event_2026_09 USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: runtime_evidence_partition_artifact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_partition_artifact_idx ON ONLY public.runtime_evidence_event USING btree (tenant_id, artifact_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx1 ON public.runtime_evidence_event_2026_07 USING btree (tenant_id, artifact_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx2 ON public.runtime_evidence_event_2026_08 USING btree (tenant_id, artifact_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx3; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx3 ON public.runtime_evidence_event_2026_09 USING btree (tenant_id, artifact_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx4; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx4 ON public.runtime_evidence_event_2026_05 USING btree (tenant_id, artifact_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_artifact_hash_creat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_artifact_hash_creat_idx ON public.runtime_evidence_event_2026_06 USING btree (tenant_id, artifact_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx1 ON public.runtime_evidence_event_2026_07 USING btree (tenant_id, evidence_content_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx2 ON public.runtime_evidence_event_2026_08 USING btree (tenant_id, evidence_content_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx3; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx3 ON public.runtime_evidence_event_2026_09 USING btree (tenant_id, evidence_content_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx4; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx4 ON public.runtime_evidence_event_2026_05 USING btree (tenant_id, evidence_content_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_evidence_content_ha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_evidence_content_ha_idx ON public.runtime_evidence_event_2026_06 USING btree (tenant_id, evidence_content_hash, created_at DESC);


--
-- Name: runtime_evidence_workspace_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_workspace_created_idx ON ONLY public.runtime_evidence_event USING btree (tenant_id, workspace_id, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx1 ON public.runtime_evidence_event_2026_07 USING btree (tenant_id, workspace_id, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx2 ON public.runtime_evidence_event_2026_08 USING btree (tenant_id, workspace_id, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx3; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx3 ON public.runtime_evidence_event_2026_09 USING btree (tenant_id, workspace_id, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx4; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx4 ON public.runtime_evidence_event_2026_05 USING btree (tenant_id, workspace_id, created_at DESC);


--
-- Name: runtime_evidence_prod_deny_notify_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_prod_deny_notify_idx ON ONLY public.runtime_evidence_event USING btree (tenant_id, workspace_id, created_at, id) WHERE ((environment = 'production'::text) AND (status = 'DENY'::text));


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx5; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx5 ON public.runtime_evidence_event_2026_05 USING btree (tenant_id, workspace_id, created_at, id) WHERE ((environment = 'production'::text) AND (status = 'DENY'::text));


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx6; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx6 ON public.runtime_evidence_event_2026_06 USING btree (tenant_id, workspace_id, created_at, id) WHERE ((environment = 'production'::text) AND (status = 'DENY'::text));


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx7; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx7 ON public.runtime_evidence_event_2026_07 USING btree (tenant_id, workspace_id, created_at, id) WHERE ((environment = 'production'::text) AND (status = 'DENY'::text));


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx8; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx8 ON public.runtime_evidence_event_2026_08 USING btree (tenant_id, workspace_id, created_at, id) WHERE ((environment = 'production'::text) AND (status = 'DENY'::text));


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx9; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx9 ON public.runtime_evidence_event_2026_09 USING btree (tenant_id, workspace_id, created_at, id) WHERE ((environment = 'production'::text) AND (status = 'DENY'::text));


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_create_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_create_idx ON public.runtime_evidence_event_2026_06 USING btree (tenant_id, workspace_id, created_at DESC);


--
-- Name: runtime_evidence_partition_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_partition_scope_idx ON ONLY public.runtime_evidence_event USING btree (tenant_id, workspace_id, environment, runtime_stack, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx1 ON public.runtime_evidence_event_2026_07 USING btree (tenant_id, workspace_id, environment, runtime_stack, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx2 ON public.runtime_evidence_event_2026_08 USING btree (tenant_id, workspace_id, environment, runtime_stack, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx3; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx3 ON public.runtime_evidence_event_2026_09 USING btree (tenant_id, workspace_id, environment, runtime_stack, created_at DESC);


--
-- Name: runtime_evidence_siem_cursor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_siem_cursor_idx ON ONLY public.runtime_evidence_event USING btree (tenant_id, workspace_id, environment, created_at, id);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx4; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx4 ON public.runtime_evidence_event_2026_06 USING btree (tenant_id, workspace_id, environment, created_at, id);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx5; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx5 ON public.runtime_evidence_event_2026_07 USING btree (tenant_id, workspace_id, environment, created_at, id);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx6; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx6 ON public.runtime_evidence_event_2026_08 USING btree (tenant_id, workspace_id, environment, created_at, id);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx7; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx7 ON public.runtime_evidence_event_2026_09 USING btree (tenant_id, workspace_id, environment, created_at, id);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx8; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx8 ON public.runtime_evidence_event_2026_05 USING btree (tenant_id, workspace_id, environment, runtime_stack, created_at DESC);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx9; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx9 ON public.runtime_evidence_event_2026_05 USING btree (tenant_id, workspace_id, environment, created_at, id);


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_enviro_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_0_tenant_id_workspace_id_enviro_idx ON public.runtime_evidence_event_2026_06 USING btree (tenant_id, workspace_id, environment, runtime_stack, created_at DESC);


--
-- Name: runtime_evidence_event_2026_10_tenant_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_10_tenant_id_created_at_id_idx ON public.runtime_evidence_event_2026_10 USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: runtime_evidence_event_2026_11_tenant_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_11_tenant_id_created_at_id_idx ON public.runtime_evidence_event_2026_11 USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: runtime_evidence_event_2026_12_tenant_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_12_tenant_id_created_at_id_idx ON public.runtime_evidence_event_2026_12 USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_artifact_hash_crea_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_artifact_hash_crea_idx1 ON public.runtime_evidence_event_2026_11 USING btree (tenant_id, artifact_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_artifact_hash_crea_idx2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_artifact_hash_crea_idx2 ON public.runtime_evidence_event_2026_12 USING btree (tenant_id, artifact_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_artifact_hash_creat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_artifact_hash_creat_idx ON public.runtime_evidence_event_2026_10 USING btree (tenant_id, artifact_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_evidence_content_h_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_evidence_content_h_idx1 ON public.runtime_evidence_event_2026_11 USING btree (tenant_id, evidence_content_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_evidence_content_h_idx2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_evidence_content_h_idx2 ON public.runtime_evidence_event_2026_12 USING btree (tenant_id, evidence_content_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_evidence_content_ha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_evidence_content_ha_idx ON public.runtime_evidence_event_2026_10 USING btree (tenant_id, evidence_content_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx1 ON public.runtime_evidence_event_2026_11 USING btree (tenant_id, workspace_id, created_at DESC);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx2 ON public.runtime_evidence_event_2026_12 USING btree (tenant_id, workspace_id, created_at DESC);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx3; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx3 ON public.runtime_evidence_event_2026_10 USING btree (tenant_id, workspace_id, created_at, id) WHERE ((environment = 'production'::text) AND (status = 'DENY'::text));


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx4; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx4 ON public.runtime_evidence_event_2026_11 USING btree (tenant_id, workspace_id, created_at, id) WHERE ((environment = 'production'::text) AND (status = 'DENY'::text));


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx5; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx5 ON public.runtime_evidence_event_2026_12 USING btree (tenant_id, workspace_id, created_at, id) WHERE ((environment = 'production'::text) AND (status = 'DENY'::text));


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_create_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_workspace_id_create_idx ON public.runtime_evidence_event_2026_10 USING btree (tenant_id, workspace_id, created_at DESC);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx1 ON public.runtime_evidence_event_2026_11 USING btree (tenant_id, workspace_id, environment, runtime_stack, created_at DESC);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx2 ON public.runtime_evidence_event_2026_12 USING btree (tenant_id, workspace_id, environment, runtime_stack, created_at DESC);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx3; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx3 ON public.runtime_evidence_event_2026_10 USING btree (tenant_id, workspace_id, environment, created_at, id);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx4; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx4 ON public.runtime_evidence_event_2026_11 USING btree (tenant_id, workspace_id, environment, created_at, id);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx5; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx5 ON public.runtime_evidence_event_2026_12 USING btree (tenant_id, workspace_id, environment, created_at, id);


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_enviro_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2026_1_tenant_id_workspace_id_enviro_idx ON public.runtime_evidence_event_2026_10 USING btree (tenant_id, workspace_id, environment, runtime_stack, created_at DESC);


--
-- Name: runtime_evidence_event_2027_01_tenant_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2027_01_tenant_id_created_at_id_idx ON public.runtime_evidence_event_2027_01 USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: runtime_evidence_event_2027_0_tenant_id_artifact_hash_creat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2027_0_tenant_id_artifact_hash_creat_idx ON public.runtime_evidence_event_2027_01 USING btree (tenant_id, artifact_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2027_0_tenant_id_evidence_content_ha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2027_0_tenant_id_evidence_content_ha_idx ON public.runtime_evidence_event_2027_01 USING btree (tenant_id, evidence_content_hash, created_at DESC);


--
-- Name: runtime_evidence_event_2027_0_tenant_id_workspace_id_creat_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2027_0_tenant_id_workspace_id_creat_idx1 ON public.runtime_evidence_event_2027_01 USING btree (tenant_id, workspace_id, created_at, id) WHERE ((environment = 'production'::text) AND (status = 'DENY'::text));


--
-- Name: runtime_evidence_event_2027_0_tenant_id_workspace_id_create_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2027_0_tenant_id_workspace_id_create_idx ON public.runtime_evidence_event_2027_01 USING btree (tenant_id, workspace_id, created_at DESC);


--
-- Name: runtime_evidence_event_2027_0_tenant_id_workspace_id_envir_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2027_0_tenant_id_workspace_id_envir_idx1 ON public.runtime_evidence_event_2027_01 USING btree (tenant_id, workspace_id, environment, created_at, id);


--
-- Name: runtime_evidence_event_2027_0_tenant_id_workspace_id_enviro_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_2027_0_tenant_id_workspace_id_enviro_idx ON public.runtime_evidence_event_2027_01 USING btree (tenant_id, workspace_id, environment, runtime_stack, created_at DESC);


--
-- Name: runtime_evidence_event_defaul_tenant_id_artifact_hash_creat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_defaul_tenant_id_artifact_hash_creat_idx ON public.runtime_evidence_event_default USING btree (tenant_id, artifact_hash, created_at DESC);


--
-- Name: runtime_evidence_event_defaul_tenant_id_evidence_content_ha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_defaul_tenant_id_evidence_content_ha_idx ON public.runtime_evidence_event_default USING btree (tenant_id, evidence_content_hash, created_at DESC);


--
-- Name: runtime_evidence_event_defaul_tenant_id_workspace_id_creat_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_defaul_tenant_id_workspace_id_creat_idx1 ON public.runtime_evidence_event_default USING btree (tenant_id, workspace_id, created_at, id) WHERE ((environment = 'production'::text) AND (status = 'DENY'::text));


--
-- Name: runtime_evidence_event_defaul_tenant_id_workspace_id_create_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_defaul_tenant_id_workspace_id_create_idx ON public.runtime_evidence_event_default USING btree (tenant_id, workspace_id, created_at DESC);


--
-- Name: runtime_evidence_event_defaul_tenant_id_workspace_id_envir_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_defaul_tenant_id_workspace_id_envir_idx1 ON public.runtime_evidence_event_default USING btree (tenant_id, workspace_id, environment, created_at, id);


--
-- Name: runtime_evidence_event_defaul_tenant_id_workspace_id_enviro_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_defaul_tenant_id_workspace_id_enviro_idx ON public.runtime_evidence_event_default USING btree (tenant_id, workspace_id, environment, runtime_stack, created_at DESC);


--
-- Name: runtime_evidence_event_default_tenant_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_evidence_event_default_tenant_id_created_at_id_idx ON public.runtime_evidence_event_default USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: saml_authn_request_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saml_authn_request_expires_at_idx ON public.saml_authn_request USING btree (expires_at);


--
-- Name: scim_token_registration_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scim_token_registration_tenant_idx ON public.scim_token_registration USING btree (tenant_id);


--
-- Name: scim_token_registration_token_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX scim_token_registration_token_hash_idx ON public.scim_token_registration USING btree (token_hash) WHERE (revoked_at IS NULL);


--
-- Name: service_refresh_token_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_refresh_token_lookup_idx ON public.service_refresh_token USING btree (token_hash) WHERE ((revoked_at IS NULL) AND (rotated_at IS NULL));


--
-- Name: service_refresh_token_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_refresh_token_principal_idx ON public.service_refresh_token USING btree (tenant_id, principal_id, workspace_id);


--
-- Name: service_token_api_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_token_api_key_idx ON public.service_token USING btree (tenant_id, workspace_id, key_type) WHERE ((key_type = 'API_KEY'::text) AND (revoked_at IS NULL));


--
-- Name: service_token_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_token_lookup_idx ON public.service_token USING btree (token_hash) WHERE (revoked_at IS NULL);


--
-- Name: service_token_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_token_scope_idx ON public.service_token USING btree (tenant_id, workspace_id, principal_id);


--
-- Name: session_revocation_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_revocation_scope_idx ON public.session_revocation_event USING btree (tenant_id, revoked_at DESC);


--
-- Name: simulation_replay_finding_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX simulation_replay_finding_run_idx ON public.simulation_replay_finding USING btree (tenant_id, simulation_run_id, created_at);


--
-- Name: simulation_run_revision_regression_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX simulation_run_revision_regression_idx ON public.simulation_run USING btree (tenant_id, revision_id, created_at DESC) WHERE (regression_summary IS NOT NULL);


--
-- Name: trust_calibration_policy_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trust_calibration_policy_tenant_idx ON public.trust_calibration_policy USING btree (tenant_id, enabled, created_at DESC);


--
-- Name: trust_calibration_policy_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trust_calibration_policy_workspace_idx ON public.trust_calibration_policy USING btree (tenant_id, workspace_id, enabled);


--
-- Name: trusted_device_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trusted_device_principal_idx ON public.trusted_device USING btree (tenant_id, principal_id);


--
-- Name: web_onboarding_milestone_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX web_onboarding_milestone_workspace_idx ON public.web_onboarding_milestone USING btree (tenant_id, workspace_id, completed_at DESC);


--
-- Name: workspace_siem_stream_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_siem_stream_enabled_idx ON public.workspace_siem_stream USING btree (enabled) WHERE (enabled = true);


--
-- Name: workspace_siem_stream_tenant_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_siem_stream_tenant_workspace_idx ON public.workspace_siem_stream USING btree (tenant_id, workspace_id);


--
-- Name: workspace_tenant_id_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_tenant_id_id_idx ON public.workspace USING btree (tenant_id, id);


--
-- Name: runtime_evidence_event_2026_05_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_pkey ATTACH PARTITION public.runtime_evidence_event_2026_05_pkey;


--
-- Name: runtime_evidence_event_2026_05_tenant_id_created_at_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_head_idx ATTACH PARTITION public.runtime_evidence_event_2026_05_tenant_id_created_at_id_idx;


--
-- Name: runtime_evidence_event_2026_06_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_pkey ATTACH PARTITION public.runtime_evidence_event_2026_06_pkey;


--
-- Name: runtime_evidence_event_2026_06_tenant_id_created_at_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_head_idx ATTACH PARTITION public.runtime_evidence_event_2026_06_tenant_id_created_at_id_idx;


--
-- Name: runtime_evidence_event_2026_07_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_pkey ATTACH PARTITION public.runtime_evidence_event_2026_07_pkey;


--
-- Name: runtime_evidence_event_2026_07_tenant_id_created_at_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_head_idx ATTACH PARTITION public.runtime_evidence_event_2026_07_tenant_id_created_at_id_idx;


--
-- Name: runtime_evidence_event_2026_08_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_pkey ATTACH PARTITION public.runtime_evidence_event_2026_08_pkey;


--
-- Name: runtime_evidence_event_2026_08_tenant_id_created_at_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_head_idx ATTACH PARTITION public.runtime_evidence_event_2026_08_tenant_id_created_at_id_idx;


--
-- Name: runtime_evidence_event_2026_09_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_pkey ATTACH PARTITION public.runtime_evidence_event_2026_09_pkey;


--
-- Name: runtime_evidence_event_2026_09_tenant_id_created_at_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_head_idx ATTACH PARTITION public.runtime_evidence_event_2026_09_tenant_id_created_at_id_idx;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_artifact_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx1;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx2; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_artifact_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx2;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx3; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_artifact_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx3;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx4; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_artifact_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_artifact_hash_crea_idx4;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_artifact_hash_creat_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_artifact_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_artifact_hash_creat_idx;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_decision_id_create_key1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_tenant_id_decision_id_created_at_key ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_decision_id_create_key1;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_decision_id_create_key2; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_tenant_id_decision_id_created_at_key ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_decision_id_create_key2;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_decision_id_create_key3; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_tenant_id_decision_id_created_at_key ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_decision_id_create_key3;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_decision_id_create_key4; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_tenant_id_decision_id_created_at_key ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_decision_id_create_key4;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_decision_id_created_key; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_tenant_id_decision_id_created_at_key ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_decision_id_created_key;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx1;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx2; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx2;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx3; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx3;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx4; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_evidence_content_h_idx4;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_evidence_content_ha_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_evidence_content_ha_idx;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_workspace_created_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx1;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx2; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_workspace_created_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx2;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx3; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_workspace_created_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx3;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx4; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_workspace_created_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx4;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx5; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_prod_deny_notify_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx5;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx6; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_prod_deny_notify_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx6;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx7; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_prod_deny_notify_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx7;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx8; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_prod_deny_notify_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx8;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx9; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_prod_deny_notify_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_creat_idx9;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_create_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_workspace_created_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_create_idx;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_scope_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx1;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx2; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_scope_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx2;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx3; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_scope_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx3;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx4; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_siem_cursor_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx4;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx5; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_siem_cursor_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx5;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx6; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_siem_cursor_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx6;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx7; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_siem_cursor_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx7;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx8; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_scope_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx8;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx9; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_siem_cursor_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_envir_idx9;


--
-- Name: runtime_evidence_event_2026_0_tenant_id_workspace_id_enviro_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_scope_idx ATTACH PARTITION public.runtime_evidence_event_2026_0_tenant_id_workspace_id_enviro_idx;


--
-- Name: runtime_evidence_event_2026_10_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_pkey ATTACH PARTITION public.runtime_evidence_event_2026_10_pkey;


--
-- Name: runtime_evidence_event_2026_10_tenant_id_created_at_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_head_idx ATTACH PARTITION public.runtime_evidence_event_2026_10_tenant_id_created_at_id_idx;


--
-- Name: runtime_evidence_event_2026_11_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_pkey ATTACH PARTITION public.runtime_evidence_event_2026_11_pkey;


--
-- Name: runtime_evidence_event_2026_11_tenant_id_created_at_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_head_idx ATTACH PARTITION public.runtime_evidence_event_2026_11_tenant_id_created_at_id_idx;


--
-- Name: runtime_evidence_event_2026_12_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_pkey ATTACH PARTITION public.runtime_evidence_event_2026_12_pkey;


--
-- Name: runtime_evidence_event_2026_12_tenant_id_created_at_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_head_idx ATTACH PARTITION public.runtime_evidence_event_2026_12_tenant_id_created_at_id_idx;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_artifact_hash_crea_idx1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_artifact_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_artifact_hash_crea_idx1;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_artifact_hash_crea_idx2; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_artifact_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_artifact_hash_crea_idx2;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_artifact_hash_creat_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_artifact_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_artifact_hash_creat_idx;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_decision_id_create_key1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_tenant_id_decision_id_created_at_key ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_decision_id_create_key1;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_decision_id_create_key2; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_tenant_id_decision_id_created_at_key ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_decision_id_create_key2;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_decision_id_created_key; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_tenant_id_decision_id_created_at_key ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_decision_id_created_key;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_evidence_content_h_idx1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_evidence_content_h_idx1;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_evidence_content_h_idx2; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_evidence_content_h_idx2;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_evidence_content_ha_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_evidence_content_ha_idx;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_workspace_created_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx1;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx2; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_workspace_created_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx2;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx3; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_prod_deny_notify_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx3;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx4; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_prod_deny_notify_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx4;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx5; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_prod_deny_notify_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_workspace_id_creat_idx5;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_create_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_workspace_created_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_workspace_id_create_idx;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_scope_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx1;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx2; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_scope_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx2;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx3; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_siem_cursor_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx3;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx4; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_siem_cursor_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx4;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx5; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_siem_cursor_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_workspace_id_envir_idx5;


--
-- Name: runtime_evidence_event_2026_1_tenant_id_workspace_id_enviro_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_scope_idx ATTACH PARTITION public.runtime_evidence_event_2026_1_tenant_id_workspace_id_enviro_idx;


--
-- Name: runtime_evidence_event_2027_01_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_pkey ATTACH PARTITION public.runtime_evidence_event_2027_01_pkey;


--
-- Name: runtime_evidence_event_2027_01_tenant_id_created_at_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_head_idx ATTACH PARTITION public.runtime_evidence_event_2027_01_tenant_id_created_at_id_idx;


--
-- Name: runtime_evidence_event_2027_0_tenant_id_artifact_hash_creat_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_artifact_idx ATTACH PARTITION public.runtime_evidence_event_2027_0_tenant_id_artifact_hash_creat_idx;


--
-- Name: runtime_evidence_event_2027_0_tenant_id_decision_id_created_key; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_tenant_id_decision_id_created_at_key ATTACH PARTITION public.runtime_evidence_event_2027_0_tenant_id_decision_id_created_key;


--
-- Name: runtime_evidence_event_2027_0_tenant_id_evidence_content_ha_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_idx ATTACH PARTITION public.runtime_evidence_event_2027_0_tenant_id_evidence_content_ha_idx;


--
-- Name: runtime_evidence_event_2027_0_tenant_id_workspace_id_creat_idx1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_prod_deny_notify_idx ATTACH PARTITION public.runtime_evidence_event_2027_0_tenant_id_workspace_id_creat_idx1;


--
-- Name: runtime_evidence_event_2027_0_tenant_id_workspace_id_create_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_workspace_created_idx ATTACH PARTITION public.runtime_evidence_event_2027_0_tenant_id_workspace_id_create_idx;


--
-- Name: runtime_evidence_event_2027_0_tenant_id_workspace_id_envir_idx1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_siem_cursor_idx ATTACH PARTITION public.runtime_evidence_event_2027_0_tenant_id_workspace_id_envir_idx1;


--
-- Name: runtime_evidence_event_2027_0_tenant_id_workspace_id_enviro_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_scope_idx ATTACH PARTITION public.runtime_evidence_event_2027_0_tenant_id_workspace_id_enviro_idx;


--
-- Name: runtime_evidence_event_defaul_tenant_id_artifact_hash_creat_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_artifact_idx ATTACH PARTITION public.runtime_evidence_event_defaul_tenant_id_artifact_hash_creat_idx;


--
-- Name: runtime_evidence_event_defaul_tenant_id_decision_id_created_key; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_tenant_id_decision_id_created_at_key ATTACH PARTITION public.runtime_evidence_event_defaul_tenant_id_decision_id_created_key;


--
-- Name: runtime_evidence_event_defaul_tenant_id_evidence_content_ha_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_idx ATTACH PARTITION public.runtime_evidence_event_defaul_tenant_id_evidence_content_ha_idx;


--
-- Name: runtime_evidence_event_defaul_tenant_id_workspace_id_creat_idx1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_prod_deny_notify_idx ATTACH PARTITION public.runtime_evidence_event_defaul_tenant_id_workspace_id_creat_idx1;


--
-- Name: runtime_evidence_event_defaul_tenant_id_workspace_id_create_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_workspace_created_idx ATTACH PARTITION public.runtime_evidence_event_defaul_tenant_id_workspace_id_create_idx;


--
-- Name: runtime_evidence_event_defaul_tenant_id_workspace_id_envir_idx1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_siem_cursor_idx ATTACH PARTITION public.runtime_evidence_event_defaul_tenant_id_workspace_id_envir_idx1;


--
-- Name: runtime_evidence_event_defaul_tenant_id_workspace_id_enviro_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_partition_scope_idx ATTACH PARTITION public.runtime_evidence_event_defaul_tenant_id_workspace_id_enviro_idx;


--
-- Name: runtime_evidence_event_default_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_event_pkey ATTACH PARTITION public.runtime_evidence_event_default_pkey;


--
-- Name: runtime_evidence_event_default_tenant_id_created_at_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.runtime_evidence_chain_head_idx ATTACH PARTITION public.runtime_evidence_event_default_tenant_id_created_at_id_idx;


--
-- Name: action_receipt action_receipt_gateway_decision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_receipt
    ADD CONSTRAINT action_receipt_gateway_decision_id_fkey FOREIGN KEY (gateway_decision_id) REFERENCES public.gateway_decision(id) ON DELETE RESTRICT;


--
-- Name: action_receipt action_receipt_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_receipt
    ADD CONSTRAINT action_receipt_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: action_receipt action_receipt_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_receipt
    ADD CONSTRAINT action_receipt_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: admin_audit_event admin_audit_event_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_event
    ADD CONSTRAINT admin_audit_event_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: admin_audit_event admin_audit_event_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_event
    ADD CONSTRAINT admin_audit_event_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: admin_audit_event admin_audit_event_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_event
    ADD CONSTRAINT admin_audit_event_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE SET NULL;


--
-- Name: agent_blueprint agent_blueprint_active_revision_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint
    ADD CONSTRAINT agent_blueprint_active_revision_fk FOREIGN KEY (active_revision_id) REFERENCES public.agent_blueprint_revision(id);


--
-- Name: agent_blueprint_approval agent_blueprint_approval_blueprint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint_approval
    ADD CONSTRAINT agent_blueprint_approval_blueprint_id_fkey FOREIGN KEY (blueprint_id) REFERENCES public.agent_blueprint(id) ON DELETE CASCADE;


--
-- Name: agent_blueprint_approval agent_blueprint_approval_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint_approval
    ADD CONSTRAINT agent_blueprint_approval_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.agent_blueprint_revision(id) ON DELETE CASCADE;


--
-- Name: agent_blueprint_approval agent_blueprint_approval_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint_approval
    ADD CONSTRAINT agent_blueprint_approval_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: agent_blueprint_approval agent_blueprint_approval_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint_approval
    ADD CONSTRAINT agent_blueprint_approval_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: agent_blueprint_revision agent_blueprint_revision_blueprint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint_revision
    ADD CONSTRAINT agent_blueprint_revision_blueprint_id_fkey FOREIGN KEY (blueprint_id) REFERENCES public.agent_blueprint(id) ON DELETE CASCADE;


--
-- Name: agent_blueprint_revision agent_blueprint_revision_parent_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint_revision
    ADD CONSTRAINT agent_blueprint_revision_parent_revision_id_fkey FOREIGN KEY (parent_revision_id) REFERENCES public.agent_blueprint_revision(id);


--
-- Name: agent_blueprint_revision agent_blueprint_revision_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint_revision
    ADD CONSTRAINT agent_blueprint_revision_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: agent_blueprint agent_blueprint_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint
    ADD CONSTRAINT agent_blueprint_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: agent_blueprint agent_blueprint_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blueprint
    ADD CONSTRAINT agent_blueprint_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: agt_agent_surface_binding agt_agent_surface_binding_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_agent_surface_binding
    ADD CONSTRAINT agt_agent_surface_binding_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: agt_agent_surface_binding agt_agent_surface_binding_workspace_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_agent_surface_binding
    ADD CONSTRAINT agt_agent_surface_binding_workspace_fk FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: agt_identity_lifecycle_event agt_identity_lifecycle_event_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_identity_lifecycle_event
    ADD CONSTRAINT agt_identity_lifecycle_event_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: agt_identity_lifecycle_event agt_identity_lifecycle_event_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_identity_lifecycle_event
    ADD CONSTRAINT agt_identity_lifecycle_event_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE SET NULL;


--
-- Name: agt_operations_log_chain_head agt_operations_log_chain_head_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_operations_log_chain_head
    ADD CONSTRAINT agt_operations_log_chain_head_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: agt_operations_log agt_operations_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_operations_log
    ADD CONSTRAINT agt_operations_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: agt_operations_log agt_operations_log_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_operations_log
    ADD CONSTRAINT agt_operations_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE SET NULL;


--
-- Name: agt_trust_score_event agt_trust_score_event_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_trust_score_event
    ADD CONSTRAINT agt_trust_score_event_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: agt_trust_score_event agt_trust_score_event_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_trust_score_event
    ADD CONSTRAINT agt_trust_score_event_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: agt_verification_result agt_verification_result_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_verification_result
    ADD CONSTRAINT agt_verification_result_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.policy_revision(id) ON DELETE SET NULL;


--
-- Name: agt_verification_result agt_verification_result_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_verification_result
    ADD CONSTRAINT agt_verification_result_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: agt_verification_result agt_verification_result_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agt_verification_result
    ADD CONSTRAINT agt_verification_result_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: alerting_integration alerting_integration_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerting_integration
    ADD CONSTRAINT alerting_integration_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: alerting_integration alerting_integration_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerting_integration
    ADD CONSTRAINT alerting_integration_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: alerting_rule alerting_rule_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerting_rule
    ADD CONSTRAINT alerting_rule_integration_id_fkey FOREIGN KEY (tenant_id, workspace_id, integration_id) REFERENCES public.alerting_integration(tenant_id, workspace_id, id) ON DELETE CASCADE;


--
-- Name: alerting_rule alerting_rule_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerting_rule
    ADD CONSTRAINT alerting_rule_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: alerting_rule alerting_rule_tenant_id_workspace_id_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerting_rule
    ADD CONSTRAINT alerting_rule_tenant_id_workspace_id_integration_id_fkey FOREIGN KEY (tenant_id, workspace_id, integration_id) REFERENCES public.alerting_integration(tenant_id, workspace_id, id) ON DELETE CASCADE;


--
-- Name: alerting_rule alerting_rule_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerting_rule
    ADD CONSTRAINT alerting_rule_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: app_principal app_principal_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_principal
    ADD CONSTRAINT app_principal_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: app_principal app_principal_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_principal
    ADD CONSTRAINT app_principal_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: app_session app_session_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_session
    ADD CONSTRAINT app_session_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.app_principal(id) ON DELETE CASCADE;


--
-- Name: app_session app_session_principal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_session
    ADD CONSTRAINT app_session_principal_tenant_fk FOREIGN KEY (principal_id, tenant_id) REFERENCES public.app_principal(id, tenant_id) ON DELETE CASCADE;


--
-- Name: app_session app_session_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_session
    ADD CONSTRAINT app_session_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: approval_workflow_audit_event approval_workflow_audit_event_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_audit_event
    ADD CONSTRAINT approval_workflow_audit_event_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: approval_workflow_audit_event approval_workflow_audit_event_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_audit_event
    ADD CONSTRAINT approval_workflow_audit_event_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: approval_workflow_audit_event approval_workflow_audit_event_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_audit_event
    ADD CONSTRAINT approval_workflow_audit_event_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.approval_workflow_config(id) ON DELETE SET NULL;


--
-- Name: approval_workflow_audit_event approval_workflow_audit_event_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_audit_event
    ADD CONSTRAINT approval_workflow_audit_event_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE SET NULL;


--
-- Name: approval_workflow_config approval_workflow_config_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_config
    ADD CONSTRAINT approval_workflow_config_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: approval_workflow_config approval_workflow_config_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_config
    ADD CONSTRAINT approval_workflow_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: approval_workflow_config approval_workflow_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_config
    ADD CONSTRAINT approval_workflow_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: approval_workflow_config approval_workflow_config_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_config
    ADD CONSTRAINT approval_workflow_config_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: approval_workflow_rule approval_workflow_rule_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_workflow_rule
    ADD CONSTRAINT approval_workflow_rule_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.approval_workflow_config(id) ON DELETE CASCADE;


--
-- Name: authz_denial_event authz_denial_event_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authz_denial_event
    ADD CONSTRAINT authz_denial_event_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: authz_denial_event authz_denial_event_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authz_denial_event
    ADD CONSTRAINT authz_denial_event_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: authz_denial_event authz_denial_event_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authz_denial_event
    ADD CONSTRAINT authz_denial_event_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE SET NULL;


--
-- Name: cli_onboarding_request cli_onboarding_request_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_onboarding_request
    ADD CONSTRAINT cli_onboarding_request_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: cli_onboarding_request cli_onboarding_request_approved_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_onboarding_request
    ADD CONSTRAINT cli_onboarding_request_approved_tenant_id_fkey FOREIGN KEY (approved_tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: cli_onboarding_request cli_onboarding_request_approved_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_onboarding_request
    ADD CONSTRAINT cli_onboarding_request_approved_workspace_id_fkey FOREIGN KEY (approved_workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: cli_onboarding_request cli_onboarding_request_service_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_onboarding_request
    ADD CONSTRAINT cli_onboarding_request_service_principal_id_fkey FOREIGN KEY (service_principal_id) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: cli_onboarding_request cli_onboarding_request_service_token_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_onboarding_request
    ADD CONSTRAINT cli_onboarding_request_service_token_fk FOREIGN KEY (service_token_id) REFERENCES public.service_token(id) ON DELETE SET NULL;


--
-- Name: commercial_event commercial_event_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_event
    ADD CONSTRAINT commercial_event_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: commercial_event commercial_event_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_event
    ADD CONSTRAINT commercial_event_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: commercial_event commercial_event_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_event
    ADD CONSTRAINT commercial_event_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE SET NULL;


--
-- Name: context_budget_event context_budget_event_policy_ref_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_budget_event
    ADD CONSTRAINT context_budget_event_policy_ref_fkey FOREIGN KEY (policy_ref) REFERENCES public.trust_calibration_policy(id) ON DELETE SET NULL;


--
-- Name: context_budget_event context_budget_event_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_budget_event
    ADD CONSTRAINT context_budget_event_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: context_budget_event context_budget_event_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_budget_event
    ADD CONSTRAINT context_budget_event_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: conversion_telemetry_event conversion_telemetry_event_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversion_telemetry_event
    ADD CONSTRAINT conversion_telemetry_event_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: gateway_credential_broker gateway_credential_broker_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_credential_broker
    ADD CONSTRAINT gateway_credential_broker_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: gateway_credential_broker gateway_credential_broker_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_credential_broker
    ADD CONSTRAINT gateway_credential_broker_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: gateway_credential_grant gateway_credential_grant_broker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_credential_grant
    ADD CONSTRAINT gateway_credential_grant_broker_id_fkey FOREIGN KEY (broker_id) REFERENCES public.gateway_credential_broker(id) ON DELETE CASCADE;


--
-- Name: gateway_credential_grant gateway_credential_grant_gateway_decision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_credential_grant
    ADD CONSTRAINT gateway_credential_grant_gateway_decision_id_fkey FOREIGN KEY (gateway_decision_id) REFERENCES public.gateway_decision(id) ON DELETE CASCADE;


--
-- Name: gateway_credential_grant gateway_credential_grant_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_credential_grant
    ADD CONSTRAINT gateway_credential_grant_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: gateway_credential_grant gateway_credential_grant_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_credential_grant
    ADD CONSTRAINT gateway_credential_grant_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: gateway_decision gateway_decision_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_decision
    ADD CONSTRAINT gateway_decision_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.policy_branch(id) ON DELETE SET NULL;


--
-- Name: gateway_decision gateway_decision_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_decision
    ADD CONSTRAINT gateway_decision_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.policy_revision(id) ON DELETE SET NULL;


--
-- Name: gateway_decision gateway_decision_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_decision
    ADD CONSTRAINT gateway_decision_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: gateway_decision gateway_decision_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_decision
    ADD CONSTRAINT gateway_decision_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: gateway_escalation_queue gateway_escalation_queue_gateway_decision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_escalation_queue
    ADD CONSTRAINT gateway_escalation_queue_gateway_decision_id_fkey FOREIGN KEY (gateway_decision_id) REFERENCES public.gateway_decision(id) ON DELETE CASCADE;


--
-- Name: gateway_escalation_queue gateway_escalation_queue_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_escalation_queue
    ADD CONSTRAINT gateway_escalation_queue_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.policy_revision(id) ON DELETE SET NULL;


--
-- Name: gateway_escalation_queue gateway_escalation_queue_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_escalation_queue
    ADD CONSTRAINT gateway_escalation_queue_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: gateway_escalation_queue gateway_escalation_queue_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_escalation_queue
    ADD CONSTRAINT gateway_escalation_queue_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: gateway_webhook_registration gateway_webhook_registration_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_webhook_registration
    ADD CONSTRAINT gateway_webhook_registration_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: gateway_webhook_registration gateway_webhook_registration_workspace_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_webhook_registration
    ADD CONSTRAINT gateway_webhook_registration_workspace_tenant_fk FOREIGN KEY (tenant_id, workspace_id) REFERENCES public.workspace(tenant_id, id) ON DELETE CASCADE;


--
-- Name: gateway_webhook_replay_check gateway_webhook_replay_check_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_webhook_replay_check
    ADD CONSTRAINT gateway_webhook_replay_check_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: grc_delivery_attempt grc_delivery_attempt_destination_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grc_delivery_attempt
    ADD CONSTRAINT grc_delivery_attempt_destination_id_fkey FOREIGN KEY (destination_id) REFERENCES public.grc_delivery_destination(id) ON DELETE CASCADE;


--
-- Name: grc_delivery_attempt grc_delivery_attempt_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grc_delivery_attempt
    ADD CONSTRAINT grc_delivery_attempt_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: grc_delivery_attempt grc_delivery_attempt_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grc_delivery_attempt
    ADD CONSTRAINT grc_delivery_attempt_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: grc_delivery_destination grc_delivery_destination_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grc_delivery_destination
    ADD CONSTRAINT grc_delivery_destination_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: grc_delivery_destination grc_delivery_destination_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grc_delivery_destination
    ADD CONSTRAINT grc_delivery_destination_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: identity_provider identity_provider_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_provider
    ADD CONSTRAINT identity_provider_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: mcp_tool_grant mcp_tool_grant_registry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_tool_grant
    ADD CONSTRAINT mcp_tool_grant_registry_id_fkey FOREIGN KEY (registry_id) REFERENCES public.mcp_tool_registry(id) ON DELETE CASCADE;


--
-- Name: mcp_tool_grant mcp_tool_grant_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_tool_grant
    ADD CONSTRAINT mcp_tool_grant_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: mcp_tool_grant mcp_tool_grant_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_tool_grant
    ADD CONSTRAINT mcp_tool_grant_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: mcp_tool_registry mcp_tool_registry_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_tool_registry
    ADD CONSTRAINT mcp_tool_registry_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: mfa_enrollment mfa_enrollment_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_enrollment
    ADD CONSTRAINT mfa_enrollment_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.app_principal(id) ON DELETE CASCADE;


--
-- Name: mfa_enrollment mfa_enrollment_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_enrollment
    ADD CONSTRAINT mfa_enrollment_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: passkey passkey_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey
    ADD CONSTRAINT passkey_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.app_principal(id) ON DELETE CASCADE;


--
-- Name: passkey passkey_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey
    ADD CONSTRAINT passkey_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: policy_approval policy_approval_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_approval
    ADD CONSTRAINT policy_approval_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.policy_branch(id) ON DELETE CASCADE;


--
-- Name: policy_approval policy_approval_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_approval
    ADD CONSTRAINT policy_approval_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.policy_revision(id) ON DELETE CASCADE;


--
-- Name: policy_approval policy_approval_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_approval
    ADD CONSTRAINT policy_approval_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: policy_approval policy_approval_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_approval
    ADD CONSTRAINT policy_approval_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: policy_branch policy_branch_active_revision_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_branch
    ADD CONSTRAINT policy_branch_active_revision_fk FOREIGN KEY (active_revision_id) REFERENCES public.policy_revision(id);


--
-- Name: policy_branch policy_branch_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_branch
    ADD CONSTRAINT policy_branch_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: policy_branch policy_branch_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_branch
    ADD CONSTRAINT policy_branch_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: policy_publish policy_publish_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_publish
    ADD CONSTRAINT policy_publish_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.policy_branch(id);


--
-- Name: policy_publish policy_publish_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_publish
    ADD CONSTRAINT policy_publish_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.policy_revision(id);


--
-- Name: policy_publish policy_publish_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_publish
    ADD CONSTRAINT policy_publish_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: policy_publish policy_publish_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_publish
    ADD CONSTRAINT policy_publish_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: policy_revision policy_revision_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_revision
    ADD CONSTRAINT policy_revision_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.policy_branch(id) ON DELETE CASCADE;


--
-- Name: policy_revision policy_revision_parent_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_revision
    ADD CONSTRAINT policy_revision_parent_revision_id_fkey FOREIGN KEY (parent_revision_id) REFERENCES public.policy_revision(id);


--
-- Name: policy_revision policy_revision_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_revision
    ADD CONSTRAINT policy_revision_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: policy_revision policy_revision_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_revision
    ADD CONSTRAINT policy_revision_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: policy_rule policy_rule_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_rule
    ADD CONSTRAINT policy_rule_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.policy_branch(id) ON DELETE CASCADE;


--
-- Name: policy_rule policy_rule_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_rule
    ADD CONSTRAINT policy_rule_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.policy_revision(id) ON DELETE CASCADE;


--
-- Name: policy_rule policy_rule_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_rule
    ADD CONSTRAINT policy_rule_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: policy_rule policy_rule_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_rule
    ADD CONSTRAINT policy_rule_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: principal_external_identity principal_external_identity_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_external_identity
    ADD CONSTRAINT principal_external_identity_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.app_principal(id) ON DELETE CASCADE;


--
-- Name: principal_external_identity principal_external_identity_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_external_identity
    ADD CONSTRAINT principal_external_identity_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.identity_provider(id) ON DELETE CASCADE;


--
-- Name: principal_external_identity principal_external_identity_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_external_identity
    ADD CONSTRAINT principal_external_identity_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: principal_permission_grant principal_permission_grant_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_permission_grant
    ADD CONSTRAINT principal_permission_grant_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.app_principal(id) ON DELETE CASCADE;


--
-- Name: principal_permission_grant principal_permission_grant_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_permission_grant
    ADD CONSTRAINT principal_permission_grant_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: principal_permission_grant principal_permission_grant_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_permission_grant
    ADD CONSTRAINT principal_permission_grant_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: rbac_audit_event rbac_audit_event_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_audit_event
    ADD CONSTRAINT rbac_audit_event_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: rbac_audit_event rbac_audit_event_target_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_audit_event
    ADD CONSTRAINT rbac_audit_event_target_principal_id_fkey FOREIGN KEY (target_principal_id) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: rbac_audit_event rbac_audit_event_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_audit_event
    ADD CONSTRAINT rbac_audit_event_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: rbac_audit_event rbac_audit_event_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_audit_event
    ADD CONSTRAINT rbac_audit_event_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE SET NULL;


--
-- Name: rbac_custom_role rbac_custom_role_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_custom_role
    ADD CONSTRAINT rbac_custom_role_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: rbac_custom_role rbac_custom_role_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_custom_role
    ADD CONSTRAINT rbac_custom_role_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: recovery_code recovery_code_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recovery_code
    ADD CONSTRAINT recovery_code_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.app_principal(id) ON DELETE CASCADE;


--
-- Name: recovery_code recovery_code_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recovery_code
    ADD CONSTRAINT recovery_code_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: runtime_adapter_declaration runtime_adapter_declaration_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_adapter_declaration
    ADD CONSTRAINT runtime_adapter_declaration_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: runtime_adapter_declaration runtime_adapter_declaration_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_adapter_declaration
    ADD CONSTRAINT runtime_adapter_declaration_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: runtime_evidence_chain_head runtime_evidence_chain_head_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_chain_head
    ADD CONSTRAINT runtime_evidence_chain_head_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: runtime_evidence_event_key runtime_evidence_event_key_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_evidence_event_key
    ADD CONSTRAINT runtime_evidence_event_key_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: runtime_evidence_event runtime_evidence_event_tenant_id_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.runtime_evidence_event
    ADD CONSTRAINT runtime_evidence_event_tenant_id_fkey1 FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: runtime_evidence_event runtime_evidence_event_workspace_id_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.runtime_evidence_event
    ADD CONSTRAINT runtime_evidence_event_workspace_id_fkey1 FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: scim_group_mapping scim_group_mapping_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scim_group_mapping
    ADD CONSTRAINT scim_group_mapping_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: scim_group_mapping scim_group_mapping_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scim_group_mapping
    ADD CONSTRAINT scim_group_mapping_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: scim_token_registration scim_token_registration_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scim_token_registration
    ADD CONSTRAINT scim_token_registration_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: service_refresh_token service_refresh_token_access_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_refresh_token
    ADD CONSTRAINT service_refresh_token_access_token_id_fkey FOREIGN KEY (access_token_id) REFERENCES public.service_token(id) ON DELETE CASCADE;


--
-- Name: service_refresh_token service_refresh_token_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_refresh_token
    ADD CONSTRAINT service_refresh_token_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.app_principal(id) ON DELETE CASCADE;


--
-- Name: service_refresh_token service_refresh_token_rotated_into_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_refresh_token
    ADD CONSTRAINT service_refresh_token_rotated_into_fkey FOREIGN KEY (rotated_into) REFERENCES public.service_refresh_token(id) ON DELETE SET NULL;


--
-- Name: service_refresh_token service_refresh_token_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_refresh_token
    ADD CONSTRAINT service_refresh_token_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: service_refresh_token service_refresh_token_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_refresh_token
    ADD CONSTRAINT service_refresh_token_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: service_token service_token_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_token
    ADD CONSTRAINT service_token_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: service_token service_token_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_token
    ADD CONSTRAINT service_token_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.app_principal(id) ON DELETE CASCADE;


--
-- Name: service_token service_token_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_token
    ADD CONSTRAINT service_token_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: service_token service_token_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_token
    ADD CONSTRAINT service_token_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: session_revocation_event session_revocation_event_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_revocation_event
    ADD CONSTRAINT session_revocation_event_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: session_revocation_event session_revocation_event_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_revocation_event
    ADD CONSTRAINT session_revocation_event_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.app_session(id) ON DELETE SET NULL;


--
-- Name: session_revocation_event session_revocation_event_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_revocation_event
    ADD CONSTRAINT session_revocation_event_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: simulation_replay_finding simulation_replay_finding_simulation_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulation_replay_finding
    ADD CONSTRAINT simulation_replay_finding_simulation_run_id_fkey FOREIGN KEY (simulation_run_id) REFERENCES public.simulation_run(id) ON DELETE CASCADE;


--
-- Name: simulation_replay_finding simulation_replay_finding_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulation_replay_finding
    ADD CONSTRAINT simulation_replay_finding_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: simulation_replay_finding simulation_replay_finding_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulation_replay_finding
    ADD CONSTRAINT simulation_replay_finding_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: simulation_run simulation_run_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulation_run
    ADD CONSTRAINT simulation_run_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.policy_branch(id);


--
-- Name: simulation_run simulation_run_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulation_run
    ADD CONSTRAINT simulation_run_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.policy_revision(id);


--
-- Name: simulation_run simulation_run_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulation_run
    ADD CONSTRAINT simulation_run_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: simulation_run simulation_run_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulation_run
    ADD CONSTRAINT simulation_run_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: telemetry_setting telemetry_setting_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_setting
    ADD CONSTRAINT telemetry_setting_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: tenant_commercial_profile tenant_commercial_profile_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_commercial_profile
    ADD CONSTRAINT tenant_commercial_profile_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: tenant_commercial_profile tenant_commercial_profile_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_commercial_profile
    ADD CONSTRAINT tenant_commercial_profile_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_principal(id) ON DELETE SET NULL;


--
-- Name: tenant_sla_calendar tenant_sla_calendar_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_sla_calendar
    ADD CONSTRAINT tenant_sla_calendar_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: tenant_terminology_override tenant_terminology_override_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_terminology_override
    ADD CONSTRAINT tenant_terminology_override_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: trust_calibration_policy trust_calibration_policy_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trust_calibration_policy
    ADD CONSTRAINT trust_calibration_policy_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: trust_calibration_policy trust_calibration_policy_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trust_calibration_policy
    ADD CONSTRAINT trust_calibration_policy_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: trusted_device trusted_device_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trusted_device
    ADD CONSTRAINT trusted_device_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.app_principal(id) ON DELETE CASCADE;


--
-- Name: trusted_device trusted_device_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trusted_device
    ADD CONSTRAINT trusted_device_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.app_session(id) ON DELETE SET NULL;


--
-- Name: trusted_device trusted_device_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trusted_device
    ADD CONSTRAINT trusted_device_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: web_onboarding_milestone web_onboarding_milestone_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_onboarding_milestone
    ADD CONSTRAINT web_onboarding_milestone_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: web_onboarding_milestone web_onboarding_milestone_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_onboarding_milestone
    ADD CONSTRAINT web_onboarding_milestone_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: workspace_siem_stream workspace_siem_stream_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_siem_stream
    ADD CONSTRAINT workspace_siem_stream_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: workspace_siem_stream workspace_siem_stream_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_siem_stream
    ADD CONSTRAINT workspace_siem_stream_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: workspace workspace_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: action_receipt; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.action_receipt ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_blueprint; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_blueprint ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_blueprint_approval; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_blueprint_approval ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_blueprint_revision; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_blueprint_revision ENABLE ROW LEVEL SECURITY;

--
-- Name: agt_agent_surface_binding; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agt_agent_surface_binding ENABLE ROW LEVEL SECURITY;

--
-- Name: agt_identity_lifecycle_event; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agt_identity_lifecycle_event ENABLE ROW LEVEL SECURITY;

--
-- Name: agt_operations_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agt_operations_log ENABLE ROW LEVEL SECURITY;

--
-- Name: agt_trust_score_event; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agt_trust_score_event ENABLE ROW LEVEL SECURITY;

--
-- Name: agt_verification_result; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agt_verification_result ENABLE ROW LEVEL SECURITY;

--
-- Name: alerting_integration; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.alerting_integration ENABLE ROW LEVEL SECURITY;

--
-- Name: alerting_rule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.alerting_rule ENABLE ROW LEVEL SECURITY;

--
-- Name: app_principal; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_principal ENABLE ROW LEVEL SECURITY;

--
-- Name: app_session; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_session ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_workflow_audit_event; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_workflow_audit_event ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_workflow_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_workflow_config ENABLE ROW LEVEL SECURITY;

--
-- Name: authz_denial_event; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.authz_denial_event ENABLE ROW LEVEL SECURITY;

--
-- Name: commercial_event; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commercial_event ENABLE ROW LEVEL SECURITY;

--
-- Name: context_budget_event; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.context_budget_event ENABLE ROW LEVEL SECURITY;

--
-- Name: conversion_telemetry_event; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversion_telemetry_event ENABLE ROW LEVEL SECURITY;

--
-- Name: gateway_credential_broker; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gateway_credential_broker ENABLE ROW LEVEL SECURITY;

--
-- Name: gateway_credential_grant; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gateway_credential_grant ENABLE ROW LEVEL SECURITY;

--
-- Name: gateway_decision; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gateway_decision ENABLE ROW LEVEL SECURITY;

--
-- Name: gateway_escalation_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gateway_escalation_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: gateway_webhook_registration; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gateway_webhook_registration ENABLE ROW LEVEL SECURITY;

--
-- Name: gateway_webhook_replay_check; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gateway_webhook_replay_check ENABLE ROW LEVEL SECURITY;

--
-- Name: grc_delivery_attempt; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grc_delivery_attempt ENABLE ROW LEVEL SECURITY;

--
-- Name: grc_delivery_destination; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grc_delivery_destination ENABLE ROW LEVEL SECURITY;

--
-- Name: identity_provider; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.identity_provider ENABLE ROW LEVEL SECURITY;

--
-- Name: mcp_tool_grant; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mcp_tool_grant ENABLE ROW LEVEL SECURITY;

--
-- Name: mcp_tool_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mcp_tool_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_enrollment; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mfa_enrollment ENABLE ROW LEVEL SECURITY;

--
-- Name: passkey; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.passkey ENABLE ROW LEVEL SECURITY;

--
-- Name: policy_approval; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.policy_approval ENABLE ROW LEVEL SECURITY;

--
-- Name: policy_branch; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.policy_branch ENABLE ROW LEVEL SECURITY;

--
-- Name: policy_publish; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.policy_publish ENABLE ROW LEVEL SECURITY;

--
-- Name: policy_revision; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.policy_revision ENABLE ROW LEVEL SECURITY;

--
-- Name: policy_rule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.policy_rule ENABLE ROW LEVEL SECURITY;

--
-- Name: principal_external_identity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.principal_external_identity ENABLE ROW LEVEL SECURITY;

--
-- Name: principal_permission_grant; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.principal_permission_grant ENABLE ROW LEVEL SECURITY;

--
-- Name: rbac_audit_event; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rbac_audit_event ENABLE ROW LEVEL SECURITY;

--
-- Name: rbac_custom_role; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rbac_custom_role ENABLE ROW LEVEL SECURITY;

--
-- Name: recovery_code; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recovery_code ENABLE ROW LEVEL SECURITY;

--
-- Name: runtime_adapter_declaration; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runtime_adapter_declaration ENABLE ROW LEVEL SECURITY;

--
-- Name: runtime_evidence_event; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runtime_evidence_event ENABLE ROW LEVEL SECURITY;

--
-- Name: runtime_evidence_event_key; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runtime_evidence_event_key ENABLE ROW LEVEL SECURITY;

--
-- Name: scim_token_registration; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scim_token_registration ENABLE ROW LEVEL SECURITY;

--
-- Name: service_refresh_token; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_refresh_token ENABLE ROW LEVEL SECURITY;

--
-- Name: service_token; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_token ENABLE ROW LEVEL SECURITY;

--
-- Name: session_revocation_event; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_revocation_event ENABLE ROW LEVEL SECURITY;

--
-- Name: simulation_replay_finding; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.simulation_replay_finding ENABLE ROW LEVEL SECURITY;

--
-- Name: simulation_run; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.simulation_run ENABLE ROW LEVEL SECURITY;

--
-- Name: telemetry_setting; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.telemetry_setting ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_commercial_profile; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_commercial_profile ENABLE ROW LEVEL SECURITY;

--
-- Name: action_receipt tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.action_receipt TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: agent_blueprint tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.agent_blueprint TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: agent_blueprint_approval tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.agent_blueprint_approval TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: agent_blueprint_revision tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.agent_blueprint_revision TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: agt_agent_surface_binding tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.agt_agent_surface_binding TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: agt_identity_lifecycle_event tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.agt_identity_lifecycle_event TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: agt_operations_log tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.agt_operations_log TO spctre_app USING ((tenant_id = ( SELECT (current_setting('app.current_tenant_id'::text, true))::uuid AS current_setting))) WITH CHECK ((tenant_id = ( SELECT (current_setting('app.current_tenant_id'::text, true))::uuid AS current_setting)));


--
-- Name: agt_trust_score_event tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.agt_trust_score_event TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: agt_verification_result tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.agt_verification_result TO spctre_app USING ((tenant_id = ( SELECT (current_setting('app.current_tenant_id'::text, true))::uuid AS current_setting))) WITH CHECK ((tenant_id = ( SELECT (current_setting('app.current_tenant_id'::text, true))::uuid AS current_setting)));


--
-- Name: alerting_integration tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.alerting_integration TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: alerting_rule tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.alerting_rule TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: app_principal tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.app_principal TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: app_session tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.app_session TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: approval_workflow_audit_event tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.approval_workflow_audit_event TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: approval_workflow_config tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.approval_workflow_config TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: authz_denial_event tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.authz_denial_event TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: commercial_event tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.commercial_event TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: context_budget_event tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.context_budget_event TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: conversion_telemetry_event tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.conversion_telemetry_event TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: gateway_credential_broker tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.gateway_credential_broker TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: gateway_credential_grant tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.gateway_credential_grant TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: gateway_decision tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.gateway_decision TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: gateway_escalation_queue tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.gateway_escalation_queue TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: gateway_webhook_registration tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.gateway_webhook_registration TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: gateway_webhook_replay_check tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.gateway_webhook_replay_check TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: grc_delivery_attempt tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.grc_delivery_attempt TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: grc_delivery_destination tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.grc_delivery_destination TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: identity_provider tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.identity_provider TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: mcp_tool_grant tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.mcp_tool_grant TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: mcp_tool_registry tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.mcp_tool_registry TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: mfa_enrollment tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.mfa_enrollment TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: passkey tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.passkey TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: policy_approval tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.policy_approval TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: policy_branch tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.policy_branch TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: policy_publish tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.policy_publish TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: policy_revision tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.policy_revision TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: policy_rule tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.policy_rule TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: principal_external_identity tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.principal_external_identity TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: principal_permission_grant tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.principal_permission_grant TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: rbac_audit_event tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.rbac_audit_event TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: rbac_custom_role tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.rbac_custom_role TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: recovery_code tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.recovery_code TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: runtime_adapter_declaration tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.runtime_adapter_declaration TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: runtime_evidence_event tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.runtime_evidence_event TO spctre_app USING ((tenant_id = ( SELECT (current_setting('app.current_tenant_id'::text, true))::uuid AS current_setting))) WITH CHECK ((tenant_id = ( SELECT (current_setting('app.current_tenant_id'::text, true))::uuid AS current_setting)));


--
-- Name: runtime_evidence_event_key tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.runtime_evidence_event_key TO spctre_app USING ((tenant_id = ( SELECT (current_setting('app.current_tenant_id'::text, true))::uuid AS current_setting))) WITH CHECK ((tenant_id = ( SELECT (current_setting('app.current_tenant_id'::text, true))::uuid AS current_setting)));


--
-- Name: scim_token_registration tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.scim_token_registration TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: service_refresh_token tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.service_refresh_token TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: service_token tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.service_token TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: session_revocation_event tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.session_revocation_event TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: simulation_replay_finding tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.simulation_replay_finding TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: simulation_run tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.simulation_run TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: telemetry_setting tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.telemetry_setting TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: tenant_commercial_profile tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.tenant_commercial_profile TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: tenant_terminology_override tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.tenant_terminology_override TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: trust_calibration_policy tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.trust_calibration_policy TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: trusted_device tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.trusted_device TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: workspace tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: workspace_siem_stream tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_siem_stream TO spctre_app USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: tenant_terminology_override; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_terminology_override ENABLE ROW LEVEL SECURITY;

--
-- Name: trust_calibration_policy; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trust_calibration_policy ENABLE ROW LEVEL SECURITY;

--
-- Name: trusted_device; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trusted_device ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_siem_stream; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_siem_stream ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO spctre_app;


--
-- Name: TABLE action_receipt; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.action_receipt TO spctre_app;


--
-- Name: TABLE admin_audit_event; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.admin_audit_event TO spctre_app;


--
-- Name: TABLE agent_blueprint; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_blueprint TO spctre_app;


--
-- Name: TABLE agent_blueprint_approval; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_blueprint_approval TO spctre_app;


--
-- Name: TABLE agent_blueprint_revision; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_blueprint_revision TO spctre_app;


--
-- Name: TABLE agt_agent_surface_binding; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agt_agent_surface_binding TO spctre_app;


--
-- Name: TABLE agt_identity_lifecycle_event; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agt_identity_lifecycle_event TO spctre_app;


--
-- Name: TABLE agt_operations_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agt_operations_log TO spctre_app;


--
-- Name: TABLE agt_operations_log_chain_head; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agt_operations_log_chain_head TO spctre_app;


--
-- Name: TABLE agt_trust_score_event; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agt_trust_score_event TO spctre_app;


--
-- Name: TABLE agt_verification_result; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agt_verification_result TO spctre_app;


--
-- Name: TABLE alerting_integration; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.alerting_integration TO spctre_app;


--
-- Name: TABLE alerting_rule; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.alerting_rule TO spctre_app;


--
-- Name: TABLE app_principal; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.app_principal TO spctre_app;


--
-- Name: TABLE app_session; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.app_session TO spctre_app;


--
-- Name: TABLE approval_workflow_audit_event; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.approval_workflow_audit_event TO spctre_app;


--
-- Name: TABLE approval_workflow_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.approval_workflow_config TO spctre_app;


--
-- Name: TABLE approval_workflow_rule; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.approval_workflow_rule TO spctre_app;


--
-- Name: TABLE auth_rate_limit; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.auth_rate_limit TO spctre_app;


--
-- Name: TABLE authz_denial_event; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.authz_denial_event TO spctre_app;


--
-- Name: TABLE bundle_export_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bundle_export_log TO spctre_app;


--
-- Name: TABLE cli_onboarding_request; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cli_onboarding_request TO spctre_app;


--
-- Name: TABLE commercial_event; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.commercial_event TO spctre_app;


--
-- Name: TABLE consumed_magic_link; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.consumed_magic_link TO spctre_app;


--
-- Name: TABLE content_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.content_items TO spctre_app;


--
-- Name: SEQUENCE content_items_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.content_items_id_seq TO spctre_app;


--
-- Name: TABLE context_budget_event; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.context_budget_event TO spctre_app;


--
-- Name: TABLE conversion_telemetry_event; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.conversion_telemetry_event TO spctre_app;


--
-- Name: TABLE gateway_credential_broker; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gateway_credential_broker TO spctre_app;


--
-- Name: TABLE gateway_credential_grant; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gateway_credential_grant TO spctre_app;


--
-- Name: TABLE gateway_decision; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gateway_decision TO spctre_app;


--
-- Name: TABLE gateway_escalation_queue; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gateway_escalation_queue TO spctre_app;


--
-- Name: TABLE gateway_webhook_registration; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gateway_webhook_registration TO spctre_app;


--
-- Name: TABLE gateway_webhook_replay_check; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gateway_webhook_replay_check TO spctre_app;


--
-- Name: TABLE grc_delivery_attempt; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.grc_delivery_attempt TO spctre_app;


--
-- Name: TABLE grc_delivery_destination; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.grc_delivery_destination TO spctre_app;


--
-- Name: TABLE identity_provider; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.identity_provider TO spctre_app;


--
-- Name: TABLE mcp_tool_grant; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mcp_tool_grant TO spctre_app;


--
-- Name: TABLE mcp_tool_registry; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mcp_tool_registry TO spctre_app;


--
-- Name: TABLE mfa_enrollment; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mfa_enrollment TO spctre_app;


--
-- Name: TABLE notification_delivery; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_delivery TO spctre_app;


--
-- Name: TABLE passkey; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.passkey TO spctre_app;


--
-- Name: TABLE policy_approval; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.policy_approval TO spctre_app;


--
-- Name: TABLE policy_branch; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.policy_branch TO spctre_app;


--
-- Name: TABLE policy_publish; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.policy_publish TO spctre_app;


--
-- Name: TABLE policy_revision; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.policy_revision TO spctre_app;


--
-- Name: TABLE policy_rule; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.policy_rule TO spctre_app;


--
-- Name: TABLE principal_external_identity; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.principal_external_identity TO spctre_app;


--
-- Name: TABLE principal_permission_grant; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.principal_permission_grant TO spctre_app;


--
-- Name: TABLE rbac_audit_event; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rbac_audit_event TO spctre_app;


--
-- Name: TABLE rbac_custom_role; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rbac_custom_role TO spctre_app;


--
-- Name: TABLE recovery_code; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.recovery_code TO spctre_app;


--
-- Name: TABLE runtime_adapter_declaration; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_adapter_declaration TO spctre_app;


--
-- Name: TABLE runtime_evidence_chain_head; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_evidence_chain_head TO spctre_app;


--
-- Name: TABLE runtime_evidence_event; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_evidence_event TO spctre_app;


--
-- Name: TABLE runtime_evidence_event_2026_05; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_evidence_event_2026_05 TO spctre_app;


--
-- Name: TABLE runtime_evidence_event_2026_06; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_evidence_event_2026_06 TO spctre_app;


--
-- Name: TABLE runtime_evidence_event_2026_07; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_evidence_event_2026_07 TO spctre_app;


--
-- Name: TABLE runtime_evidence_event_2026_08; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_evidence_event_2026_08 TO spctre_app;


--
-- Name: TABLE runtime_evidence_event_2026_09; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_evidence_event_2026_09 TO spctre_app;


--
-- Name: TABLE runtime_evidence_event_2026_10; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_evidence_event_2026_10 TO spctre_app;


--
-- Name: TABLE runtime_evidence_event_2026_11; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_evidence_event_2026_11 TO spctre_app;


--
-- Name: TABLE runtime_evidence_event_2026_12; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_evidence_event_2026_12 TO spctre_app;


--
-- Name: TABLE runtime_evidence_event_2027_01; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_evidence_event_2027_01 TO spctre_app;


--
-- Name: TABLE runtime_evidence_event_default; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_evidence_event_default TO spctre_app;


--
-- Name: TABLE runtime_evidence_event_key; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_evidence_event_key TO spctre_app;


--
-- Name: TABLE saml_authn_request; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.saml_authn_request TO spctre_app;


--
-- Name: TABLE scim_group_mapping; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.scim_group_mapping TO spctre_app;


--
-- Name: TABLE scim_token_registration; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.scim_token_registration TO spctre_app;


--
-- Name: TABLE service_refresh_token; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.service_refresh_token TO spctre_app;


--
-- Name: TABLE service_token; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.service_token TO spctre_app;


--
-- Name: TABLE session_revocation_event; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.session_revocation_event TO spctre_app;


--
-- Name: TABLE simulation_replay_finding; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.simulation_replay_finding TO spctre_app;


--
-- Name: TABLE simulation_run; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.simulation_run TO spctre_app;


--
-- Name: TABLE telemetry_setting; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.telemetry_setting TO spctre_app;


--
-- Name: TABLE tenant; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant TO spctre_app;


--
-- Name: TABLE tenant_commercial_profile; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_commercial_profile TO spctre_app;


--
-- Name: TABLE tenant_sla_calendar; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_sla_calendar TO spctre_app;


--
-- Name: TABLE tenant_terminology_override; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_terminology_override TO spctre_app;


--
-- Name: TABLE trust_calibration_policy; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.trust_calibration_policy TO spctre_app;


--
-- Name: TABLE trusted_device; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.trusted_device TO spctre_app;


--
-- Name: TABLE verified_pack_signature; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.verified_pack_signature TO spctre_app;


--
-- Name: TABLE web_onboarding_milestone; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.web_onboarding_milestone TO spctre_app;


--
-- Name: TABLE workspace; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace TO spctre_app;


--
-- Name: TABLE workspace_siem_stream; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_siem_stream TO spctre_app;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE spctre IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO spctre_app;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE spctre IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO spctre_app;


--
-- PostgreSQL database dump complete
--


