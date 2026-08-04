import { Button } from "./button";
import { PageHeader } from "./page-header";
import { StatusPill } from "./status-pill";
import { TableShell, DataTable, TableHeaderCell, TableCell } from "./table";

export function EvidenceSurfaceFrame() {
  return (
    <div>
      <PageHeader
        eyebrow="tenant-demo / workspace-demo / Evidence"
        title="Evidence"
        actions={<Button>Export JSON</Button>}
      />
      <section className="panel" style={{ marginTop: 16 }}>
        <TableShell>
          <DataTable>
            <thead>
              <tr>
                <TableHeaderCell>Action</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Agent</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              <tr>
                <TableCell>
                  <code>stripe.refund.create</code>
                </TableCell>
                <TableCell>
                  <StatusPill tone="block">DENY</StatusPill>
                </TableCell>
                <TableCell>
                  <code>agent-demo</code>
                </TableCell>
              </tr>
            </tbody>
          </DataTable>
        </TableShell>
      </section>
    </div>
  );
}

export function ReviewSurfaceFrame() {
  return (
    <div>
      <PageHeader
        eyebrow="tenant-demo / workspace-demo"
        title="Review & publish"
        actions={<Button tone="primary">Publish</Button>}
      />
      <div className="diffBar" style={{ marginTop: 16 }}>
        <div className="diffBarChips">
          <StatusPill tone="allow">+3 added</StatusPill>
          <StatusPill tone="warn">2 modified</StatusPill>
          <StatusPill tone="block">-1 removed</StatusPill>
        </div>
      </div>
    </div>
  );
}

export function ComplianceSurfaceFrame() {
  return (
    <div>
      <PageHeader
        eyebrow="tenant-demo / workspace-demo"
        title="Compliance"
        actions={<Button>Seal audit</Button>}
      />
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="split">
          <div className="metric">
            <span className="meta">Evidence</span>
            <strong>126</strong>
          </div>
          <div className="metric">
            <span className="meta">Approvals</span>
            <strong>9</strong>
          </div>
          <div className="metric">
            <span className="meta">Policy refs</span>
            <strong>41</strong>
          </div>
          <div className="metric">
            <span className="meta">Timeline</span>
            <strong>22</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
