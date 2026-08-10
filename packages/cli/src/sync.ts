import * as fs from "node:fs";
import * as path from "node:path";
import { readConfig, requireConfig, writeConfig, configPath } from "./config";
import { refreshIfNeeded } from "./refresh";

export interface SyncResult {
  outputPath: string;
  artifactHash: string;
  previousHash: string | null;
  changed: boolean;
  /**
   * False when the workspace has no published policy bundle yet. The local
   * bundle file is left untouched in that case, so a previously synced bundle
   * is never clobbered by an unpublish.
   */
  published: boolean;
}

interface SyncSettings {
  workspace: string;
  key: string;
  output: string;
  url: string;
  resolved: ReturnType<typeof readConfig>;
}

async function resolveSyncSettings(options: {
  workspace?: string;
  key?: string;
  output?: string;
  url?: string;
}): Promise<SyncSettings> {
  const config = readConfig();
  const needsConfig = !options.workspace || !options.key || !options.output || !options.url;
  let resolved = needsConfig ? requireConfig() : config;
  if (resolved) resolved = await refreshIfNeeded(resolved);
  const workspace = options.workspace ?? resolved?.workspaceId;
  const key = options.key ?? resolved?.token;
  const output = options.output ?? resolved?.bundlePath ?? "spctre-policy.json";
  const url = (options.url ?? resolved?.controlPlaneUrl ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );

  if (!workspace || !key) {
    console.error(
      "Error: workspace and key are required. Run spctre init first or pass --workspace and --key.",
    );
    process.exit(1);
  }

  return { workspace, key, output, url, resolved };
}

async function syncBlueprint(url: string, key: string, agentId: string, outputPath: string) {
  const response = await fetch(
    `${url}/api/agent-blueprints/runtime?agentId=${encodeURIComponent(agentId)}`,
    { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } },
  );
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Failed to fetch Blueprint artifact (${response.status}).`);
  const payload = (await response.json()) as {
    artifact: { blueprint: { revisionId: string; definitionHash: string } };
  };
  const blueprintPath = `${outputPath}.blueprint.json`;
  fs.writeFileSync(blueprintPath, JSON.stringify(payload.artifact, null, 2) + "\n");
  const config = readConfig();
  if (config)
    writeConfig({
      ...config,
      blueprintPath,
      blueprintRevisionId: payload.artifact.blueprint.revisionId,
      blueprintDefinitionHash: payload.artifact.blueprint.definitionHash,
    });
}

interface FetchedBundle {
  bundle: string;
  newHash: string;
  newBranchId: string;
  newRevisionId: string;
}

async function fetchBundle(targetUrl: string, key: string): Promise<FetchedBundle | null> {
  const response = await fetch(targetUrl, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });

  // A workspace that has never published is the normal state of a new install,
  // not a failure. Report it as absence so callers can keep running.
  if (response.status === 404) return null;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch policy bundle (${response.status}): ${errorText || response.statusText}`,
    );
  }

  return {
    bundle: await response.text(),
    newHash: response.headers.get("x-spctre-artifact-hash") ?? "",
    newBranchId: response.headers.get("x-spctre-branch-id") ?? "",
    newRevisionId: response.headers.get("x-spctre-revision-id") ?? "",
  };
}

// Update config.json so heartbeats report the current artifact hash.
function persistArtifactMetadata(newHash: string, newBranchId: string, newRevisionId: string) {
  const current = readConfig();
  if (!current) return;
  writeConfig({
    ...current,
    artifactHash: newHash,
    ...(newBranchId ? { branchId: newBranchId } : {}),
    ...(newRevisionId ? { revisionId: newRevisionId } : {}),
    policyContext: [
      {
        scope: "WORKSPACE",
        branchId: newBranchId || current.branchId,
        revisionId: newRevisionId || current.revisionId,
        artifactHash: newHash,
      },
    ],
  });
}

export async function sync(options: {
  workspace?: string;
  key?: string;
  output?: string;
  url?: string;
  quiet?: boolean;
}): Promise<SyncResult | undefined> {
  const { workspace, key, output, url, resolved } = await resolveSyncSettings(options);

  const targetUrl = `${url}/api/bundle/latest?workspace=${encodeURIComponent(workspace)}`;
  const previousHash = resolved?.artifactHash ?? null;

  try {
    const fetched = await fetchBundle(targetUrl, key);
    const outputPath = path.resolve(process.cwd(), output);

    // Nothing published yet: leave any previously synced bundle in place and
    // let the caller decide whether that is worth reporting.
    if (!fetched) {
      return {
        outputPath,
        artifactHash: previousHash ?? "",
        previousHash,
        changed: false,
        published: false,
      };
    }

    return await applyFetchedBundle({
      fetched,
      outputPath,
      previousHash,
      resolved,
      url,
      key,
      quiet: options.quiet,
    });
  } catch (error) {
    console.error(`Sync failed: ${String(error)}`);
    process.exit(1);
  }
}

async function applyFetchedBundle(params: {
  fetched: FetchedBundle;
  outputPath: string;
  previousHash: string | null;
  resolved: SyncSettings["resolved"];
  url: string;
  key: string;
  quiet?: boolean;
}): Promise<SyncResult> {
  const { fetched, outputPath, previousHash, resolved, url, key, quiet } = params;
  const { bundle, newHash, newBranchId, newRevisionId } = fetched;
  const changed = !!newHash && newHash !== previousHash;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, bundle);
  if (resolved?.agentId) await syncBlueprint(url, key, resolved.agentId, outputPath);

  if (changed && !quiet) {
    const prev = previousHash ? previousHash.slice(0, 19) : "none";
    const next = newHash.slice(0, 19);
    console.log(`Policy updated: ${prev} → ${next}`);
  }

  if (changed && newHash && resolved) {
    persistArtifactMetadata(newHash, newBranchId, newRevisionId);
  }

  // Write a sidecar file agents can poll to detect bundle changes cheaply.
  if (changed || !fs.existsSync(lastSyncPath())) {
    writeLastSync({
      artifactHash: newHash || previousHash || "",
      branchId: newBranchId,
      revisionId: newRevisionId,
    });
  }

  return {
    outputPath,
    artifactHash: newHash || previousHash || "",
    previousHash,
    changed,
    published: true,
  };
}

function lastSyncPath() {
  if (process.env.SPCTRE_SYNC_PATH) {
    return path.resolve(process.env.SPCTRE_SYNC_PATH);
  }
  const cfg = configPath();
  return path.join(path.dirname(cfg), "last-sync.json");
}

function writeLastSync(data: { artifactHash: string; branchId: string; revisionId: string }) {
  try {
    fs.mkdirSync(path.dirname(lastSyncPath()), { recursive: true });
    fs.writeFileSync(
      lastSyncPath(),
      JSON.stringify({ ...data, syncedAt: new Date().toISOString() }, null, 2) + "\n",
    );
  } catch {
    // non-fatal
  }
}
