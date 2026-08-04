import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../src/button";
import { Drawer } from "../src/drawer";
import { FormField, SelectInput, TextArea, TextInput } from "../src/form-controls";
import { PageHeader } from "../src/page-header";
import { StatusPill } from "../src/status-pill";
import { DataTable, TableCell, TableHeaderCell, TableShell } from "../src/table";
import { TabButton, TabsRow } from "../src/tabs";

const meta = { title: "Patterns/Workflow Inspector" } satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const ActiveRulesWithEditPanel: Story = {
  render: () => (
    <div style={{ padding: 24, display: "grid", gap: 16 }}>
      <PageHeader
        eyebrow="Admin / Workflows"
        title="Approval workflows"
        actions={<Button tone="primary">Create workflow</Button>}
      />

      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
      >
        <TabsRow>
          <TabButton active>Active workflow rules</TabButton>
          <TabButton>Audit history</TabButton>
        </TabsRow>
        <StatusPill tone="allow">WORKFLOW ENFORCEMENT ON</StatusPill>
      </div>

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "minmax(0, 1.35fr) minmax(360px, 0.9fr)",
          alignItems: "start",
        }}
      >
        <TableShell>
          <DataTable>
            <thead>
              <tr>
                <TableHeaderCell>Workflow</TableHeaderCell>
                <TableHeaderCell>Scope</TableHeaderCell>
                <TableHeaderCell>Approvals</TableHeaderCell>
                <TableHeaderCell>Verification</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              <tr>
                <TableCell>Payments high-risk</TableCell>
                <TableCell>Workspace</TableCell>
                <TableCell>2 reviewers</TableCell>
                <TableCell>Required</TableCell>
                <TableCell>
                  <StatusPill tone="allow">ACTIVE</StatusPill>
                </TableCell>
              </tr>
              <tr>
                <TableCell>Default publish guard</TableCell>
                <TableCell>Workspace</TableCell>
                <TableCell>Admin fallback</TableCell>
                <TableCell>Optional</TableCell>
                <TableCell>
                  <StatusPill tone="warn">NO RULES</StatusPill>
                </TableCell>
              </tr>
            </tbody>
          </DataTable>
        </TableShell>

        <Drawer
          open
          eyebrow="Workflow · Rule builder"
          title="Edit Payments high-risk"
          actions={<Button tone="primary">Save</Button>}
          body={
            <div style={{ display: "grid", gap: 12 }}>
              <FormField label="Workflow name" hint="Visible to reviewers during policy publish.">
                <TextInput defaultValue="Payments high-risk" />
              </FormField>
              <FormField label="Approver role">
                <SelectInput defaultValue="security">
                  <option value="security">Security</option>
                  <option value="platform">Platform</option>
                  <option value="finance">Finance</option>
                </SelectInput>
              </FormField>
              <FormField label="Minimum approvals">
                <SelectInput defaultValue="2">
                  <option value="1">1 reviewer</option>
                  <option value="2">2 reviewers</option>
                  <option value="3">3 reviewers</option>
                </SelectInput>
              </FormField>
              <FormField
                label="Change rationale"
                hint="Required for recommendation disposition and audit trace."
              >
                <TextArea
                  rows={3}
                  defaultValue="Require Security + Finance for payment policy changes."
                />
              </FormField>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Button tone="subtle">Cancel</Button>
                <Button tone="primary">Save changes</Button>
              </div>
            </div>
          }
        />
      </div>
    </div>
  ),
};
