"use client";

import { ArrowRight } from "lucide-react";

function UpgradeCta() {
  return (
    <div style={{ borderLeft: "1px solid rgba(255, 255, 255, 0.15)", paddingLeft: "16px" }}>
      <a
        href="/signup"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 14px",
          background: "linear-gradient(135deg, #6366f1, #a855f7)",
          border: "none",
          borderRadius: "9999px",
          color: "#fff",
          fontSize: "12px",
          fontWeight: 600,
          textDecoration: "none",
          boxShadow: "0 4px 12px rgba(168, 85, 247, 0.3)",
          transition: "all 0.2s"
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.transform = "scale(1.03)";
          e.currentTarget.style.boxShadow = "0 6px 16px rgba(168, 85, 247, 0.5)";
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = "0 4px 12px rgba(168, 85, 247, 0.3)";
        }}
      >
        <span>Get Cloud</span>
        <ArrowRight size={13} />
      </a>
    </div>
  );
}

export function DemoToolbar() {
  return (
    <div style={{
      position: "fixed",
      bottom: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: 9999,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "8px",
      pointerEvents: "none"
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "16px",
        padding: "6px 20px",
        background: "rgba(15, 23, 42, 0.85)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        borderRadius: "9999px",
        color: "#fff",
        boxShadow: "0 10px 40px -10px rgba(0, 0, 0, 0.6), 0 1px 3px rgba(255, 255, 255, 0.05)",
        pointerEvents: "auto",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
      }}>
        {/* Live indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", borderRight: "1px solid rgba(255, 255, 255, 0.15)", paddingRight: "16px" }}>
          <span style={{
            display: "inline-block",
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "#a855f7", // Purple pulse for premium vibe
            boxShadow: "0 0 8px #a855f7"
          }} />
          <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255, 255, 255, 0.6)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Demo Cloud
          </span>
        </div>

        {/* Upgrade CTA */}
        <UpgradeCta />
      </div>
    </div>
  );
}
