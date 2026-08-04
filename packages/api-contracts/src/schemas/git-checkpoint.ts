import { z } from "zod";

const GitCommitSchema = z.string().trim().min(1).max(256);

const GitChangedFileSchema = z.object({
  path: z.string().trim().min(1).max(4096),
  status: z.enum(["added", "modified", "deleted", "renamed", "copied", "unmerged"]).optional(),
  previousPath: z.string().trim().min(1).max(4096).optional(),
});

/**
 * Framework-agnostic checkpoint and diff envelope.
 *
 * Clients read their own repository and submit immutable Git facts. The API
 * never receives a repository path or executes Git on behalf of a caller.
 */
export const GitCheckpointIngestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(512),
  environment: z.string().trim().min(1),
  status: z.enum(["ALLOW", "DENY", "WARN", "ESCALATE"]),
  reason: z.string().trim().min(1).max(4000),
  checkpoint: z.object({
    id: z.string().trim().min(1).max(512),
    createdAt: z.string().datetime({ offset: true }),
    repository: z.object({
      id: z.string().trim().min(1).max(512),
      remoteUrl: z.string().trim().max(4096).optional(),
    }),
    ref: z.string().trim().min(1).max(1024).optional(),
    baseCommit: GitCommitSchema.optional(),
    headCommit: GitCommitSchema,
    diff: z
      .object({
        format: z.enum(["unified", "name-status", "none"]),
        content: z.string().max(1_000_000).optional(),
        sha256: z.string().trim().min(1).max(256).optional(),
        files: z.array(GitChangedFileSchema).max(10_000).optional(),
      })
      .superRefine((diff, ctx) => {
        if (diff.format !== "none" && !diff.content && !diff.sha256 && !diff.files?.length) {
          ctx.addIssue({
            code: "custom",
            message: "A diff must include content, sha256, or files.",
          });
        }
        if (diff.format === "none" && (diff.content || diff.files?.length)) {
          ctx.addIssue({
            code: "custom",
            message: "A diff with format 'none' cannot include content or files.",
          });
        }
      }),
  }),
  agent: z
    .object({
      id: z.string().trim().min(1).max(512),
      adapter: z.string().trim().min(1).max(512).optional(),
    })
    .optional(),
  connector: z.string().trim().min(1).max(512).optional(),
  action: z.string().trim().min(1).max(512).optional(),
  policyRefs: z.array(z.string().trim().min(1).max(512)).max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type GitCheckpointIngestInput = z.infer<typeof GitCheckpointIngestSchema>;
