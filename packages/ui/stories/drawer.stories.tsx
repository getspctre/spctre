import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../src/button";
import { Drawer } from "../src/drawer";
import { FormField, SelectInput, TextArea, TextInput } from "../src/form-controls";

const meta = {
  title: "Primitives/Drawer",
  component: Drawer,
  args: {
    open: true,
    onClose: () => undefined,
    eyebrow: "Workflow · Rule builder",
    title: "Edit approval workflow",
    headerActions: <Button tone="primary">Save changes</Button>,
    children: (
      <div style={{ display: "grid", gap: 12 }}>
        <FormField label="Workflow name" hint="Shown in review and policy pages.">
          <TextInput value="Payments high-risk" readOnly />
        </FormField>
        <FormField label="Minimum approvals" hint="How many reviewers must approve.">
          <SelectInput value="2" disabled>
            <option value="1">1 reviewer</option>
            <option value="2">2 reviewers</option>
            <option value="3">3 reviewers</option>
          </SelectInput>
        </FormField>
        <FormField label="Rationale" hint="Captured for audit when this workflow changes.">
          <TextArea value="Tightened controls for financial operations." readOnly rows={3} />
        </FormField>
      </div>
    ),
  },
} satisfies Meta<typeof Drawer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Closed: Story = { args: { open: false } };
