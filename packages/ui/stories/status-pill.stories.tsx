import type { Meta, StoryObj } from "@storybook/react";
import { StatusPill } from "../src/status-pill";

const meta = {
  title: "Primitives/StatusPill",
  component: StatusPill,
  args: {
    children: "PENDING"
  }
} satisfies Meta<typeof StatusPill>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};

export const Allow: Story = {
  args: { tone: "allow", children: "ALLOW" }
};

export const Warn: Story = {
  args: { tone: "warn", children: "WARN" }
};

export const Block: Story = {
  args: { tone: "block", children: "DENY" }
};
