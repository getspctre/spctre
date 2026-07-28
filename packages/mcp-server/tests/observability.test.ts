import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../src/observability.js";

afterEach(() => {
  delete process.env.SPCTRE_LOG_STDERR;
  vi.restoreAllMocks();
});

describe("logger stdout/stderr routing", () => {
  it("keeps stdout clean when SPCTRE_LOG_STDERR is set (stdio MCP wire)", () => {
    process.env.SPCTRE_LOG_STDERR = "true";
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logger.info("MCP server running in modern STDIO mode", { transport: "stdio" });
    logger.warn("something noisy");

    // Nothing may reach stdout — it carries JSON-RPC frames.
    expect(stdout).not.toHaveBeenCalled();
    // Every level is diverted to stderr instead.
    expect(stderr).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.parse(stderr.mock.calls[0]![0] as string)).toMatchObject({
      level: "info",
      message: "MCP server running in modern STDIO mode",
      transport: "stdio",
    });
  });

  it("routes info to stdout and warn/error to stderr by default (http mode)", () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logger.info("listening");
    logger.warn("degraded");
    logger.error("boom");

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(stderr).toHaveBeenCalledTimes(1);
  });
});
