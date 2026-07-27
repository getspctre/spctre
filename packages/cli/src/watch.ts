import { runFrameworkAdapter } from "./watch-frameworks";
import { createWatchStrategies, type WatchOptions } from "./watch-strategies";

export async function watch(options: WatchOptions) {
  const intervalSeconds = parsePositiveSeconds(options.interval, "--interval");
  const heartbeatIntervalSeconds = options.heartbeat
    ? parsePositiveSeconds(options.heartbeatInterval, "--heartbeat-interval")
    : 0;

  if (options.framework) {
    runFrameworkAdapter(options.framework);
  }

  const strategies = createWatchStrategies(options, intervalSeconds, heartbeatIntervalSeconds);
  for (const strategy of strategies) {
    await strategy.start();
  }

  const shutdown = () => {
    for (const strategy of strategies) {
      strategy.stop();
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

function parsePositiveSeconds(value: string, optionName: string) {
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds) || seconds < 1) {
    console.error(`Error: ${optionName} must be a positive number of seconds.`);
    process.exit(1);
  }
  return seconds;
}
