# Changesets

Add a changeset for every user-visible change to a release-managed package:
`@spctre/policy-schema`, `@spctre/cli`, or `@spctre/sdk`.

```sh
pnpm changeset
```

Select the affected package, choose the appropriate semantic-version bump, and
write a concise consumer-facing summary. Do not add changesets for packages
listed in `.changeset/config.json`'s `ignore` section.
