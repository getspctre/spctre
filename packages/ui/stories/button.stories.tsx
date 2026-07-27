import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../src/button";

const meta = {
  title: "Primitives/Button",
  component: Button,
  args: {
    children: "Run action"
  }
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Primary: Story = {
  args: {
    tone: "primary",
    children: "Publish"
  }
};

export const PillDanger: Story = {
  args: {
    tone: "pill-danger",
    children: "Revoke"
  }
};
