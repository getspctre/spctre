import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileSync = vi.fn();
vi.mock("node:child_process", () => ({ execFileSync }));

const { ingestEntireCheckpoints } = await import("../src/index.js");

describe("Entire checkpoint adapter", () => {
  beforeEach(() => {
    execFileSync.mockReset();
    execFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === "rev-parse") return "head-sha\n";
      if (args[0] === "ls-tree") return "ab/checkpoint/0/metadata.json\n";
      if (args[0] === "show") return JSON.stringify({
        checkpoint_id: "checkpoint-1",
        session_id: "session-1",
        created_at: "2026-07-20T14:30:00Z",
        agent: "Codex",
        files_touched: ["src/index.ts"],
      });
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    });
  });

  it("normalizes an Entire checkpoint and posts it to the generic endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    const result = await ingestEntireCheckpoints({
      apiKey: "key",
      baseUrl: "https://spctre.example/api/v1",
      repositoryId: "repo-1",
      environment: "production",
      fetch: fetchMock,
    });

    expect(result).toEqual([{ checkpointId: "checkpoint-1", sessionId: "session-1", status: "ALLOW" }]);
    expect(fetchMock).toHaveBeenCalledWith("https://spctre.example/api/v1/evidence/git-checkpoints", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer key" }),
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      idempotencyKey: "entire:repo-1:checkpoint-1",
      connector: "entire-session",
      checkpoint: { headCommit: "head-sha", diff: { files: [{ path: "src/index.ts", status: "modified" }] } },
    });
  });
});
