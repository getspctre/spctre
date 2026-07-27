# spctre-hermes

Spctre governance plugin adapter for Hermes Agent. It uses Hermes `pre_tool_call`
and `pre_gateway_dispatch` hooks to evaluate actions against Spctre policy and
emit runtime decision evidence with `runtimeTarget.stack: "HERMES"`.

## Install

Requires Python 3.11 or newer.

```bash
pip install spctre-hermes
```

## Usage

```python
from spctre_hermes import SpctreHermesPlugin
plugin = SpctreHermesPlugin(api_key="...", base_url="https://api.spctre.dev/api", agent_id="agent-1", tenant_id="tenant-1", workspace_id="workspace-1")
agent.register_plugin(plugin)
```

The API key needs permission to call `/evaluate` and `/evidence`. Set
`dry_run=True` to verify Hermes registration without making HTTP calls; dry-run
mode always returns `{"allow": True}`.

This adapter emits the Hermes runtime stack value and depends on Spctre schema
support for `RuntimeStack = "HERMES"` before live evidence ingestion succeeds.
