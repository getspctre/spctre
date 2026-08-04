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
  return new RecurringTaskStrategy(intervalSeconds * 1000, async () => {
    await sync({
      workspace: options.workspace,
      key: options.key,
      output: options.output,
      url: options.url,
      quiet: options.quiet,
    });
  });
}

function createHeartbeatStrategy(options: WatchOptions, intervalSeconds: number) {
  return new RecurringTaskStrategy(intervalSeconds * 1000, async () => {
    try {
      let config = readConfig();
      if (config) config = await refreshIfNeeded(config);
      await ingest({
        agent: options.workspace ? undefined : config?.agentId,
        workspace: options.workspace ?? config?.workspaceId,
        key: options.key ?? config?.token,
        hash: config?.artifactHash,
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
