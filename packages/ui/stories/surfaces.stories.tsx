import type { Meta, StoryObj } from "@storybook/react";
import {
  EvidenceSurfaceFrame,
  ReviewSurfaceFrame,
  ComplianceSurfaceFrame
} from "../src/surfaces";

const meta = {
  title: "Surfaces/Core"
} satisfies Meta;

export default meta;

type Story = StoryObj;

export const Evidence: Story = {
  render: () => <EvidenceSurfaceFrame />
};

export const Review: Story = {
  render: () => <ReviewSurfaceFrame />
};

export const Compliance: Story = {
  render: () => <ComplianceSurfaceFrame />
};
