import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../src/button";
import { PageHeader } from "../src/page-header";

const meta = {
  title: "Primitives/PageHeader",
  component: PageHeader,
  args: {
    eyebrow: "tenant-demo / workspace-demo",
    title: "Evidence",
    actions: <Button>Export CSV</Button>,
  },
} satisfies Meta<typeof PageHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
