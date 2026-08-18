# @spctre/cli

Command-line control plane for governed agent systems. `spctre` connects a local
project to a [Spctre](https://spctre.dev) workspace to author and lint policies,
watch agent frameworks, install governance skills and hooks into coding
harnesses, and stream evidence.

## Install

```sh
npm install -g @spctre/cli
# or run without installing:
npx @spctre/cli --help
```

Requires Node.js >= 22.5.0.

## Getting started

```sh
spctre init            # open a browser to approve and write .spctre/config.json
spctre status          # show connection and workspace status
spctre watch           # observe local agent frameworks and stream evidence
```

## Key commands

| Command                          | Purpose                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `spctre init`                    | Authorize the CLI and write `.spctre/config.json`                                                               |
| `spctre status`                  | Report connection, token, and workspace status                                                                  |
| `spctre lint [policy]`           | Lint a policy file                                                                                              |
| `spctre check [policy]`          | Evaluate a policy against local context                                                                         |
| `spctre policy import <file>`    | Import a local policy as a draft (needs a `policy:import` key; drafts only — never approves or publishes)       |
| `spctre blueprint import <file>` | Import a local Blueprint as a draft (needs a `blueprint:import` key; drafts only — never approves or publishes) |
| `spctre bundle` / `export`       | Build and export runtime policy artifacts                                                                       |
| `spctre watch`                   | Observe agent frameworks and stream evidence                                                                    |
| `spctre install-skill`           | Install the Spctre governance skill into a harness                                                              |
| `spctre install-hook`            | Install PreToolUse/BeforeTool hooks for a harness                                                               |
| `spctre revoke`                  | Revoke the local CLI credentials                                                                                |
| `spctre api request`             | Call any documented public REST v1 operation (authenticated, version-pinned)                                    |

Run `spctre --help` or `spctre <command> --help` for the full, current list.

## Public API operations

The CLI targets `/api/v1` for every public control-plane request. Public REST
operations are grouped into discoverable commands:

| Group                                                   | Covers                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `spctre api evaluate`                                   | Published-bundle simulation                                                             |
| `spctre api review`                                     | Approvals and gateway escalations                                                       |
| `spctre api compliance` / `verification` / `operations` | Compliance, CI attestations, workspace and audit reads                                  |
| `spctre api evidence`                                   | Provider ingest, checkpoints, artifacts, attestations, signing keys, and forensic reads |
| `spctre api trust` / `custody` / `scim`                 | Trust telemetry, bundle custody, and Cloud SCIM provisioning                            |

Read commands accept repeatable `--query key=value` for filters and pagination.
Write commands accept either `--data '<json>'` or `--file request.json`; use
`-H 'Content-Type: …'` when an endpoint needs a non-JSON media type. Artifact
and PDF responses can be saved with `--output-file`. Signing-key mutations and
all `DELETE` calls require explicit `--yes` confirmation.

`spctre api request` remains a version-pinned escape hatch for newly added
operations and webhook receiver endpoints. Its paths are relative to `/api/v1`;
credentials are never sent to another origin.

```sh
spctre api request GET /identity/events --output json
spctre api request POST /ingest/cloudevents --file event.json \
  -H 'Content-Type: application/cloudevents+json'
spctre api request POST /evidence/git-checkpoints --data '{"...":"..."}'
spctre api request GET '/compliance/export?format=pdf' --output-file packet.pdf
spctre api evidence generic-ndjson --file events.ndjson \
  -H 'Content-Type: application/x-ndjson' \
  -H 'x-spctre-integration-id: <integration-id>'
spctre api evidence signing-key-revoke <key-id> --yes
```

## License

Apache-2.0.
