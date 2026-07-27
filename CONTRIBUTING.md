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

## Community process

Please follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Use
[GitHub Discussions](https://github.com/getspctre/spctre/discussions) for
questions and early design conversations; use Issues for reproducible bugs and
scoped feature requests. The pull-request template lists the contribution
requirements enforced by CI.

Repository governance and maintainer responsibilities are described in
[GOVERNANCE.md](GOVERNANCE.md).

## Security

Do not open public issues for vulnerabilities. Follow `SECURITY.md`.
