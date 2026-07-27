# Contributing to Spctre

Thanks for helping improve Spctre. The repository uses an open-core boundary:
this repository contains the Apache 2.0 open-source implementation.

## Developer Certificate of Origin

Spctre uses DCO sign-off instead of a CLA. Every commit must include:

```text
Signed-off-by: Your Name <you@example.com>
```

You can add this automatically with:

```bash
git commit -s
```

By signing off, you certify the contribution under the Developer Certificate of
Origin 1.1: https://developercertificate.org/

Run the repository checks before opening a PR:

```bash
pnpm oss:check
pnpm typecheck
```

## Security

Do not open public issues for vulnerabilities. Follow `SECURITY.md`.
