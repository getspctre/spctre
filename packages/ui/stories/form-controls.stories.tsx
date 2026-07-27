import type { Meta, StoryObj } from "@storybook/react";
import { FormField, SelectInput, TextArea, TextInput } from "../src/form-controls";

const meta = {
  title: "Primitives/FormControls",
  component: FormField
} satisfies Meta<typeof FormField>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WorkflowFields: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
      <FormField label="Workflow name" hint="Use a name that explains the policy intent.">
        <TextInput placeholder="Example: Finance export approvals" defaultValue="Finance export approvals" />
      </FormField>
      <FormField label="Approver role">
        <SelectInput defaultValue="security">
          <option value="security">Security</option>
          <option value="platform">Platform</option>
          <option value="finance">Finance</option>
        </SelectInput>
      </FormField>
      <FormField label="Why this change" hint="Included in the audit log for reviewer context.">
        <TextArea rows={4} defaultValue="Requiring Security + Finance approvals for payment export policy updates." />
      </FormField>
    </div>
  )
};
