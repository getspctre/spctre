import { defineDocs, defineConfig } from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const lastModifiedCache = new Map<string, Promise<Date | null>>();

function getLastModified(filePath: string): Promise<Date | null> {
  const cached = lastModifiedCache.get(filePath);
  if (cached) return cached;

  const timestamp = (async () => {
    try {
      const { stdout } = await execFileAsync("git", ["log", "-1", "--pretty=%ai", "--", filePath]);
      const date = new Date(stdout.trim());
      if (!Number.isNaN(date.getTime())) return date;
    } catch {
      // Docker builds do not include .git metadata or a git binary.
    }

    try {
      return (await stat(filePath)).mtime;
    } catch {
      return null;
    }
  })();

  lastModifiedCache.set(filePath, timestamp);
  return timestamp;
}

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export default defineConfig({
  plugins: [lastModified({ versionControl: getLastModified })],
});
