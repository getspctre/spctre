import { sync } from "./sync";
import { ingest } from "./ingest";
import { readConfig } from "./config";
import { refreshIfNeeded } from "./refresh";
import { setShadowMode, readShadowLogFrom, formatShadowEntry } from "./shadow";

export interface WatchOptions {
  workspace?: string;
  key?: string;
  output?: string;
  url?: string;
  interval: string;
  heartbeat: boolean;
  heartbeatInterval: string;
  quiet: boolean;
  shadow: boolean;
  framework?: string;
}

interface WatchStrategy {
  start(): Promise<void> | void;
  stop(): void;
}

class RecurringTaskStrategy implements WatchStrategy {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly intervalMs: number,
    private readonly task: () => Promise<void>,
  ) {}

  async start() {
    await this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      await this.task();
    } finally {
      this.running = false;
    }
  }
}

class ShadowTailStrategy implements WatchStrategy {
  private offset = 0;
  private timer: NodeJS.Timeout | null = null;

  start() {
    setShadowMode(true);
    console.log("Shadow mode active — decisions are evaluated and logged but never enforced.");
    this.timer = setInterval(() => {
      const { entries, nextOffset } = readShadowLogFrom(this.offset);
      for (const entry of entries) {
        console.log(formatShadowEntry(entry));
      }
      this.offset = nextOffset;
    }, 2000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    setShadowMode(false);
  }
}

export function createWatchStrategies(
  options: WatchOptions,
  intervalSeconds: number,
  heartbeatIntervalSeconds: number,
) {
  const strategies: WatchStrategy[] = [];
  if (options.shadow) strategies.push(new ShadowTailStrategy());
  strategies.push(createSyncStrategy(options, intervalSeconds));
  if (options.heartbeat)
    strategies.push(createHeartbeatStrategy(options, heartbeatIntervalSeconds));
  return strategies;
}

function createSyncStrategy(options: WatchOptions, intervalSeconds: number) {
  // A workspace with nothing published is a normal starting state, so the
  // watcher keeps polling. Report it only when it changes, or every poll would
  // repeat the same line.
  let reportedUnpublished = false;

  return new RecurringTaskStrategy(intervalSeconds * 1000, async () => {
    const result = await sync({
      workspace: options.workspace,
      key: options.key,
      output: options.output,
      url: options.url,
      quiet: options.quiet,
    });
    if (!result) return;

    if (!result.published) {
      if (!reportedUnpublished && !options.quiet) {
        console.log(
          "No policy bundle has been published for this workspace yet. Watching — the bundle will sync automatically once one is published.",
        );
      }
      reportedUnpublished = true;
      return;
    }

    if (reportedUnpublished && !options.quiet) {
      console.log("Policy bundle published — now syncing.");
    }
    reportedUnpublished = false;
  });
}

function createHeartbeatStrategy(options: WatchOptions, intervalSeconds: number) {
  let reportedMissingHash = false;

  return new RecurringTaskStrategy(intervalSeconds * 1000, async () => {
    try {
      let config = readConfig();
      if (config) config = await refreshIfNeeded(config);

      // A heartbeat anchors itself to the artifact hash of the bundle the agent
      // is running. Until something is published there is no hash to report,
      // and ingest exits the process rather than throwing — so skip the beat
      // instead of letting it take the watcher down.
      const hash = config?.artifactHash;
      if (!hash) {
        if (!reportedMissingHash && !options.quiet) {
          console.log(
            "Skipping heartbeat until a policy bundle is published — a heartbeat records the bundle the agent is running.",
          );
        }
        reportedMissingHash = true;
        return;
      }
      reportedMissingHash = false;

      await ingest({
        agent: options.workspace ? undefined : config?.agentId,
        workspace: options.workspace ?? config?.workspaceId,
        key: options.key ?? config?.token,
        hash,
        heartbeat: true,
        url: options.url ?? config?.controlPlaneUrl,
        environment: config?.environment,
        policyContext: config?.policyContext,
        quiet: true,
      });
    } catch {
      // Heartbeat failures are non-fatal in watch mode.
    }
  });
}
