import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../src/button";
import { Drawer } from "../src/drawer";
import { PageHeader } from "../src/page-header";
import { StatusPill } from "../src/status-pill";
import { DataTable, TableCell, TableHeaderCell, TableShell } from "../src/table";
import { TabButton, TabsRow } from "../src/tabs";

const meta = { title: "Patterns/Packs Slideout" } satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

interface PacksScenarioProps {
  showUpgrade: boolean;
  installedVersion: string;
  latestVersion: string;
  statusTone: "allow" | "warn";
  statusLabel: string;
}

function PacksScenario(props: PacksScenarioProps) {
  return (
    <div style={{ padding: 24, display: "grid", gap: 16 }}>
      <PageHeader
        eyebrow="Policy / Packs"
        title="Connector governance packs"
        actions={<Button>Import pack</Button>}
      />

      <TabsRow>
        <TabButton active>Installed</TabButton>
        <TabButton>Catalog</TabButton>
      </TabsRow>

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "minmax(0, 1.3fr) minmax(360px, 0.9fr)",
          alignItems: "start",
        }}
      >
        <TableShell>
          <DataTable>
            <thead>
              <tr>
                <TableHeaderCell>Pack</TableHeaderCell>
                <TableHeaderCell>Connector</TableHeaderCell>
                <TableHeaderCell>Installed</TableHeaderCell>
                <TableHeaderCell>Latest</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              <tr>
                <TableCell>Stripe Governance Pack</TableCell>
                <TableCell>stripe</TableCell>
                <TableCell>v{props.installedVersion}</TableCell>
                <TableCell>v{props.latestVersion}</TableCell>
                <TableCell>
                  <StatusPill tone={props.statusTone}>{props.statusLabel}</StatusPill>
                </TableCell>
              </tr>
              <tr>
                <TableCell>GitHub Governance Pack</TableCell>
                <TableCell>github</TableCell>
                <TableCell>v1.3.0</TableCell>
                <TableCell>v1.3.0</TableCell>
                <TableCell>
                  <StatusPill tone="allow">UP TO DATE</StatusPill>
                </TableCell>
              </tr>
            </tbody>
          </DataTable>
        </TableShell>

        <Drawer
          open
          eyebrow="Pack details"
          title="Stripe Governance Pack"
          actions={
            props.showUpgrade ? (
              <Button tone="primary">Upgrade pack</Button>
            ) : (
              <Button tone="subtle">Installed</Button>
            )
          }
          body={
            <div style={{ display: "grid", gap: 10 }}>
              <p className="meta">Category</p>
              <p>Payments operations</p>
              <p className="meta">Description</p>
              <p>
                Controls high-risk payment actions with role-aware approval policy and action
                coverage for refund and payout operations.
              </p>
              <p className="meta">Version status</p>
              <p>
                Installed version: <strong>v{props.installedVersion}</strong>
                <br />
                Latest available: <strong>v{props.latestVersion}</strong>
              </p>
              {!props.showUpgrade ? (
                <p className="meta">
                  No upgrade action is shown when installed is current or unknown.
                </p>
              ) : null}
            </div>
          }
        />
      </div>
    </div>
  );
}

export const UpgradeAvailable: Story = {
  render: () => (
    <PacksScenario
      showUpgrade
      installedVersion="1.0.0"
      latestVersion="1.2.0"
      statusTone="warn"
      statusLabel="UPDATE AVAILABLE"
    />
  ),
};

export const UpToDateNoUpgradeCta: Story = {
  render: () => (
    <PacksScenario
      showUpgrade={false}
      installedVersion="1.2.0"
      latestVersion="1.2.0"
      statusTone="allow"
      statusLabel="UP TO DATE"
    />
  ),
};
