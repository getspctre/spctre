"use client";

import { useRouter } from "next/navigation";
import type { PolicyBranch } from "@spctre/policy-schema";
import { buildWorkspacePath } from "@/lib/workspace/path";

const statusClass: Record<string, string> = {
  PUBLISHED: "pill pillAllow",
  IN_REVIEW: "pill pillWarn",
  DRAFT: "pill"
};

interface BranchSelectorProps {
  branches: PolicyBranch[];
  selectedId: string | undefined;
  workspaceSlug: string;
}

export function BranchSelector({ branches, selectedId, workspaceSlug }: BranchSelectorProps) {
  const router = useRouter();

  if (!branches.length) {
    return (
      <p className="meta selectorEmpty">
        No branches found.{" "}
        <a href={buildWorkspacePath(workspaceSlug, "/")} className="link">
          Import a policy
        </a>{" "}
        to start a review.
      </p>
    );
  }

  return (
    <div className="branchSelectorRow">
      <label className="srOnly" htmlFor="review-policy-branch">Policy branch</label>
      <select
        id="review-policy-branch"
        className="input branchSelect"
        value={selectedId ?? ""}
        onChange={(e) => router.push(buildWorkspacePath(workspaceSlug, `/review?branch=${e.target.value}`))}
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} — {b.scope}
          </option>
        ))}
      </select>
      {selectedId ? (
        <span className={statusClass[branches.find((b) => b.id === selectedId)?.status ?? "DRAFT"]}>
          {branches.find((b) => b.id === selectedId)?.status ?? "DRAFT"}
        </span>
      ) : null}
    </div>
  );
}
