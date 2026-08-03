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

| Command | Purpose |
|---|---|
| `spctre init` | Authorize the CLI and write `.spctre/config.json` |
| `spctre status` | Report connection, token, and workspace status |
| `spctre lint [policy]` | Lint a policy file |
| `spctre check [policy]` | Evaluate a policy against local context |
| `spctre policy import <file>` | Import a local policy as a draft (needs a `policy:import` key; drafts only — never approves or publishes) |
| `spctre blueprint import <file>` | Import a local Blueprint as a draft (needs a `blueprint:import` key; drafts only — never approves or publishes) |
| `spctre bundle` / `export` | Build and export runtime policy artifacts |
| `spctre watch` | Observe agent frameworks and stream evidence |
| `spctre install-skill` | Install the Spctre governance skill into a harness |
| `spctre install-hook` | Install PreToolUse/BeforeTool hooks for a harness |
| `spctre revoke` | Revoke the local CLI credentials |

Run `spctre --help` or `spctre <command> --help` for the full, current list.

## License

Apache-2.0.
