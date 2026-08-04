import type { Meta, StoryObj } from "@storybook/react";
import { StatusPill } from "../src/status-pill";
import { DataTable, TableCell, TableHeaderCell, TableShell } from "../src/table";

const meta = { title: "Primitives/Table", component: DataTable } satisfies Meta<typeof DataTable>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WorkflowInspectorRows: Story = {
  render: () => (
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
            <TableCell>Admin-only fallback</TableCell>
            <TableCell>Optional</TableCell>
            <TableCell>
              <StatusPill tone="warn">NO RULES</StatusPill>
            </TableCell>
          </tr>
        </tbody>
      </DataTable>
    </TableShell>
  ),
};
