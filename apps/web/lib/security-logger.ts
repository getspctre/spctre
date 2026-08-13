type SecurityEventType =
  | "recovery_code_used"
  | "recovery_code_failed"
  | "mfa_verified"
  | "mfa_failed"
  | "magic_link_requested"
  | "self_serve_signup_provisioned"
  | "rate_limited";

interface SecurityEventContext {
  tenantId?: string;
  principalId?: string;
  sessionId?: string;
  ipAddress?: string;
  endpoint?: string;
  detail?: string;
}

// Emits structured JSON compatible with GCP Cloud Logging.
export function logSecurityEvent(event: SecurityEventType, ctx: SecurityEventContext): void {
  console.log(
    JSON.stringify({
      severity: "INFO",
      eventType: event,
      timestamp: new Date().toISOString(),
      ...ctx,
    }),
  );
}
