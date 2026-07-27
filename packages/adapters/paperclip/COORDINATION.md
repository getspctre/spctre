# Coordination Protocols: Spctre + Paperclip

Paperclip already has its own governance layer at the orchestration level:
budget management, approval workflows, and a trust model for agent runtimes.
Spctre adds per-call and per-session governance with a durable hash-chain
evidence trail. These two systems operate at different granularities and are
designed to complement each other — but three collision points require explicit
coordination before deploying both in the same workspace.

---

## 1. Budget Governance Collision

### The problem

Paperclip's `budgets.ts` and `quota-windows.ts` enforce cost limits at the
task level and company level. Spctre's `ECONOMIC_GOVERNANCE_PACK` enforces
`DAILY_SPEND_LIMIT`, `PER_CALL_COST_LIMIT`, and
`SESSION_CUMULATIVE_COST_LIMIT` at the individual tool-call and session level.

If both systems are active without coordination, the same spend event can
trigger two independent enforcement checks. A call that Paperclip's quota
system would allow might be blocked by Spctre's `PER_CALL_COST_LIMIT`, or
vice versa. In the worst case both systems block different calls and the
agent is unable to proceed even though neither system's intent was to stop
all work — they were each trying to govern a different scope.

### Protocol

**Paperclip is authoritative for task-level and company-level budgets.**
Paperclip knows the business goal, the assigned task, and the company's
overall spend posture. It is the right system to say "this task has consumed
its budget" or "this company is over its monthly quota."

**Spctre is authoritative for per-call and per-session cost limits.**
Spctre governs individual tool-call semantics. `PER_CALL_COST_LIMIT` catches
a single abnormally expensive call (e.g., a model call with a 500k-token
context) regardless of task context. `SESSION_CUMULATIVE_COST_LIMIT` caps
cumulative spend within one agent session, which is shorter than a Paperclip
task timeline.

**Operators MUST NOT activate Spctre's `DAILY_SPEND_LIMIT` policy on a
Paperclip-managed workspace** unless they explicitly opt in with full
understanding that both systems will enforce daily spend independently.
`DAILY_SPEND_LIMIT` at the Spctre level and `quota-windows.ts` at the
Paperclip level cover overlapping time windows with no shared state — the
agent can be double-blocked before either system's true limit is reached.

### How to configure this split

1. In the Spctre policy branch for the workspace, disable or omit
   `DAILY_SPEND_LIMIT` policy rules.
2. Keep `PER_CALL_COST_LIMIT` and `SESSION_CUMULATIVE_COST_LIMIT` enabled
   in Spctre — these cover the scope Paperclip does not.
3. Let Paperclip's `budgets.ts` and `quota-windows.ts` own daily and
   task-level spend enforcement.
4. Surface Spctre evidence records (including cost fields in `rawEvidence`)
   in Paperclip's spend dashboard if both systems are visible to operators.

---

## 2. Approval Workflow Collision

### The problem

Paperclip's `approvals.ts` and `issue-approvals.ts` gate whether an agent
should work on a task at all. A task enters an approval queue; a human
reviewer approves or rejects the entire work item. This is task-level
gating.

Spctre's `ESCALATE` verdict gates whether a specific tool call within a
running task proceeds. When an agent tries to call `bash` with a destructive
command, Spctre can escalate that specific call to a human reviewer queue
independently of the task's approval status.

If both systems fire on the same event without coordination, the operator
and the agent may receive two independent approval notifications for what
appears to be the same decision. The agent may wait for both to resolve, or
resolve them in the wrong order, depending on how notifications are surfaced.

### Protocol

**Paperclip approval gates whether an agent works on a task.**
**Spctre ESCALATE gates whether a specific tool call within that task proceeds.**

These operate at different granularities and should NOT be collapsed into
one. A Spctre ESCALATE is not a substitute for a Paperclip task approval,
and a Paperclip task approval does not implicitly allow all tool calls that
Spctre would escalate.

When Spctre issues an `ESCALATE` verdict on a tool call that is part of an
active Paperclip task:

1. Spctre posts an escalation notification to its human reviewer queue as
   normal.
2. The `beforeToolDispatch` hook returns a `deny` result, blocking the
   specific tool call.
3. The Spctre escalation notification SHOULD be surfaced alongside (not
   instead of) the Paperclip issue/task timeline. Operators should configure
   their notification routing so that a Spctre ESCALATE on a Paperclip-
   assigned task appears in the Paperclip issue thread as a linked event,
   not a separate unattributed alert.
4. The `orchestratorRef` fields on the Spctre evidence record (`companyId`,
   `issueId`, `goalId`) enable this attribution — route escalation
   notifications using these fields to target the correct Paperclip issue.

Implementing the escalation notification routing is a product integration
task that requires coordination between the Spctre notification dispatcher
and Paperclip's notification system. This is deferred pending product
decision. The adapter itself emits the correct `orchestratorRef` on every
evidence record so the routing can be implemented without adapter changes.

---

## 3. Trust Level as a Policy Input

### The problem

Paperclip's `low-trust-runtime-containment.ts` and `trust-preset-resolver.ts`
assign trust levels to agent runtimes before they execute. An agent running
in low-trust containment has restricted capabilities at the Paperclip
orchestration layer. However, Spctre's policy engine had no `trustLevel`
field on evidence records prior to the `polly/schema-ts-additions` PR. This
meant that "apply stricter per-call governance for agents in low-trust
containment" was unwritable as a Spctre policy rule — even though the
information was available at hook time.

### Protocol

The adapter reads `trustPreset` from the `DispatchContext` object provided
by Paperclip's `plugin-tool-dispatcher.ts` and writes it to `trustLevel` on
the emitted evidence record. The `polly/schema-ts-additions` PR adds
`trustLevel` as a typed field on `RuntimeDecisionEvidenceRecord`, which
allows the Rust policy evaluator to condition on it.

Operators can then write Spctre policy rules such as:

```yaml
- title: "Stricter bash governance for low-trust agents"
  connector: "paperclip"
  action: "bash"
  conditions:
    - field: trustLevel
      operator: eq
      value: "low"
  effect: ESCALATE
```

Trust level values mirror Paperclip's own presets: `"high"`, `"standard"`,
`"low"`, `"untrusted"`. If Paperclip does not provide a trust preset in the
dispatch context, the adapter defaults to `"standard"`.

This approach preserves the separation of concerns: Paperclip's
`low-trust-runtime-containment.ts` continues to enforce its own containment
rules. Spctre does not replicate those rules. Spctre adds a complementary
per-call governance layer that is informed by, but does not replace,
Paperclip's trust assignment.

### Schema dependency

This protocol depends on the `polly/schema-ts-additions` PR adding
`trustLevel` to `RuntimeDecisionEvidenceRecord`. Until that PR merges,
`trustLevel` is emitted into `rawEvidence` and is present in the audit
trail but is not policy-conditionable. The adapter code is forward-
compatible: it emits `trustLevel` at the top level of the evidence record
in anticipation of the schema addition.
