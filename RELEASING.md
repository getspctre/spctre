# Releasing Spctre OSS packages

The public repository is the only source for OSS artifacts. Hosted and
Enterprise deployment artifacts are released from private repositories and are
not part of this process.

## Release-managed packages

- `@spctre/policy-schema`
- `@spctre/cli`
- `@spctre/sdk`

Use [Changesets](https://github.com/changesets/changesets) for consumer-facing
changes to these packages. Run `pnpm changeset` and commit the generated file
with the implementation change.

## Dry-run verification

Pushing a `v*` tag, or manually dispatching **Release readiness**, performs no
publication. It generates API clients, builds the selected packages, packs
their tarballs, installs those tarballs in a clean smoke-test directory, runs
`npm publish --dry-run`, creates an SBOM, and attests the tarballs with GitHub
Artifact Attestations.

## First release criteria

Before creating the first public release tag:

1. Confirm CI and Release readiness pass from the exact public commit.
2. Review package tarball contents and generated changelog/version changes.
3. Confirm each package has final npm metadata and a supported install path.
4. Create the annotated `v0.1.0` tag from the public commit.
5. Review the generated GitHub Release notes and attestations.

Actual publication remains disabled until npm Trusted Publishing is configured.
