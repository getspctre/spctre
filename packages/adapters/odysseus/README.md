# Spctre Odysseus Adapter

`spctre-odysseus` provides a Spctre middleware adapter for Odysseus runtimes
that support the `ToolMiddleware` protocol:

```python
async def before_call(self, tool_name: str, args: dict, ctx: dict) -> dict | None: ...
```

## Install

```bash
pip install spctre-odysseus
```

For local development:

```bash
pip install -e ".[dev]"
python -m pytest tests/ -x
```

## Usage

```python
from spctre_odysseus import SpctreOdysseus

spctre = SpctreOdysseus(
    api_key="spctre_api_key",
    base_url="https://api.spctre.example",
    agent_id="agent_123",
    tenant_id="tenant_123",
    workspace_id="workspace_123",
    environment="production",
)

framework.add_middleware(spctre)
```

Before each tool call, the adapter posts to Spctre's `/evaluate` endpoint with
`Authorization: Bearer {api_key}`. `ALLOW`, `WARN`, and `ESCALATE` decisions
return `None` so Odysseus proceeds. `DENY` returns:

```python
{"blocked": True, "reason": "policy reason"}
```

Set `dry_run=True` to skip all network calls and allow every tool call.

## Evidence

After evaluation, the adapter emits evidence to `/ingest/evidence` in a
fire-and-forget task. Evidence ingest errors are swallowed and do not change the
tool-call decision.

Evidence records include:

- `runtimeTarget.stack = "ODYSSEUS"`
- `runtimeTarget.adapter = "spctre-odysseus"`
- `agentId`, `tenantId`, `workspaceId`, and `environment` from constructor config
- `connector` from `ctx["connector"]` or inferred from `tool_name`
- `action` from `ctx["action"]` or `tool_name`
- `triggerKind` from `ctx.get("trigger_kind", "interactive")`
- `parentAgentId` from `ctx.get("parent_agent_id")` when present
- `rawEvidence.source = "odysseus.before_call"`
- raw tool call context under `rawEvidence.toolName`, `rawEvidence.args`, and
  `rawEvidence.ctx`
