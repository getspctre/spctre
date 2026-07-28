# @spctre/ui

Shared UI component library for the Spctre control plane, built on the
`@spctre/design-tokens` design system.

Internal workspace package.

## Usage

```ts
import { /* components */ } from "@spctre/ui";
import "@spctre/ui/styles.css";
```

## Development

Components are documented and developed in Storybook:

```bash
pnpm --filter @spctre/ui storybook          # run Storybook
pnpm --filter @spctre/ui test:a11y          # accessibility checks
```

## License

Apache-2.0.
