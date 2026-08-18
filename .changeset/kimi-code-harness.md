---
"@spctre/cli": minor
---

Support the Kimi Code CLI harness in `install-hook`, `install-skill`, and `pretooluse`.

`spctre install-hook --kimi` declares the Spctre `PreToolUse` hook as a `[[hooks]]`
entry in Kimi's user-level `~/.kimi-code/config.toml` (or `$KIMI_CODE_HOME`). That
file is TOML rather than JSON and holds hand-written provider credentials, so the
entry is spliced in between comment markers instead of being parsed and
re-serialized, leaving every other key, comment, and formatting choice untouched.
Kimi has no project-scoped `config.toml`, so this install is always user-level.

`spctre install-skill --kimi` installs the skill into `.kimi-code/skills/spctre/`
(or the data root with `--global`) and activates it through `AGENTS.md`.

Kimi's `PreToolUse` payload already uses the `tool_name` / `tool_input` shape and
the exit-code block contract that Claude Code, Codex, and Gemini CLI use, so
`pretooluse` reuses that path. Three Kimi-specific behaviours are handled:

- `FetchURL`, Kimi's URL-fetch tool, is now classified as a governed web action —
  previously it fell through as ungoverned.
- Kimi ignores hook stdout as a source of rewritten tool input, so just-in-time
  credential grants fail closed there rather than executing without the
  ephemeral credential, matching the Antigravity behaviour.
- Kimi kills a hook at its declared timeout and treats the kill as ALLOW, so the
  gateway wait is clamped below the hook timeout. A decision that needs a human
  escalation now returns a real answer instead of silently failing open.
