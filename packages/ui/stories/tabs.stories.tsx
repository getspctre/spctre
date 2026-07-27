import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TabsRow, TabButton } from "../src/tabs";

const meta = {
  title: "Primitives/Tabs",
  component: TabsRow
} satisfies Meta<typeof TabsRow>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ReviewModes: Story = {
  render: () => (
    <TabsRow>
      <TabButton active>Policy Diff</TabButton>
      <TabButton>Evidence</TabButton>
      <TabButton>Rule Authoring</TabButton>
    </TabsRow>
  )
};

const cardStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: 12,
  display: "grid",
  gap: 6,
  background: "#fafafa",
};

const countStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  opacity: 0.5,
  marginLeft: 4,
};

function RetentionPlanDemo() {
  const [tab, setTab] = useState<"rules" | "decisions">("rules");

  const rules = [
    { id: "r1", label: "Production evidence", days: 90, scope: "env:production" },
    { id: "r2", label: "Staging evidence", days: 30, scope: "env:staging" },
    { id: "r3", label: "Expired decisions", days: 7, scope: "status:EXPIRED" },
  ];

  const decisions = [
    { id: "dec_a1b2c3d4", connector: "openai", env: "production", disposition: "ACTIVE", until: "2025-09-12", days: 112 },
    { id: "dec_e5f6a7b8", connector: "anthropic", env: "production", disposition: "EXPIRING", until: "2025-06-01", days: 9 },
    { id: "dec_c9d0e1f2", connector: "openai", env: "staging", disposition: "EXPIRED", until: "2025-05-10", days: 0 },
  ];

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 640 }}>
      <TabsRow>
        <TabButton active={tab === "rules"} onClick={() => setTab("rules")}>
          Rules <span style={countStyle}>{rules.length}</span>
        </TabButton>
        <TabButton active={tab === "decisions"} onClick={() => setTab("decisions")}>
          Decisions <span style={countStyle}>{decisions.length}</span>
        </TabButton>
      </TabsRow>

      {tab === "rules" ? (
        <div style={{ display: "grid", gap: 8 }}>
          {rules.map((r) => (
            <div key={r.id} style={cardStyle}>
              <strong style={{ fontSize: 14 }}>{r.label}</strong>
              <span style={{ fontSize: 12, color: "#64748b" }}>{r.days} days · {r.scope}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {decisions.map((d) => (
            <div key={d.id} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <code style={{ fontSize: 12 }}>{d.id}</code>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: d.disposition === "EXPIRED" ? "#fee2e2" : d.disposition === "EXPIRING" ? "#fef9c3" : "#dcfce7",
                  color: d.disposition === "EXPIRED" ? "#dc2626" : d.disposition === "EXPIRING" ? "#ca8a04" : "#16a34a",
                }}>
                  {d.disposition}
                </span>
              </div>
              <span style={{ fontSize: 12, color: "#64748b" }}>{d.connector} / {d.env} · until {d.until}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const WithContent: Story = {
  render: () => <RetentionPlanDemo />
};
