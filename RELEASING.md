# Releasing Spctre OSS packages

The public repository is the only source for OSS artifacts. Hosted and
Enterprise deployment artifacts are released from private repositories and are
not part of this process.

## Release-managed packages

- `@spctre/policy-schema`
- `@spctre/cli`
- `@spctre/sdk`
- `@spctre/mcp-server`

Use [Changesets](https://github.com/changesets/changesets) for consumer-facing
changes to these packages. Run `pnpm changeset` and commit the generated file
with the implementation change.

## Python distributions

- `spctre-hermes` (`packages/adapters/hermes`)
- `spctre-odysseus` (`packages/adapters/odysseus`)
- `spctre-sdk` (`packages/sdk-python`)

These are outside Changesets. Each single-sources its version in a `_version.py`
exported as `__version__`. Bump that file, merge, then dispatch
**Release (Python)** with the distribution and target registry.

`spctre-sdk` ships two top-level packages: the hand-written, supported
`spctre_sdk` facade, which is checked in, and the `spctre` bindings generated
from the OpenAPI spec by `scripts/generate-python-sdk.sh`, which are not.
Packaging metadata comes from `packages/sdk-python/pyproject.toml` rather than
from the generator, so the distribution controls its own `requires-python`,
license and authors. Regenerating requires a JRE.

Authentication is PyPI Trusted Publishing (OIDC), with no API token at any
point — PyPI supports _pending_ publishers, so each project was registered
before it existed and is created by its first publish. This is why the Python
release path has no equivalent of the npm token bootstrap below.

PyPI requires a pending publisher to be unique on
(owner, repo, workflow, environment), so each distribution currently publishes
from its own GitHub Environment: `pypi`/`testpypi` for `spctre-sdk`, and
`pypi-<name>`/`testpypi-<name>` for the adapters. That constraint disappears
once a project exists, so after all three have published to a registry the
per-package environments can be collapsed into one and deleted.

Always dispatch against `testpypi` first. TestPyPI burns version numbers
permanently just like PyPI, so test runs publish a `.dev<run-number>` suffix
and leave the clean version available for the real release.

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

npm publication is live: `release.yml` publishes the four npm packages via
Changesets, tokenlessly through npm Trusted Publishing.
