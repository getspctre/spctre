import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { configPath, type SpctreCliConfig } from "./config.js";

type OutboxRow = { id: number; payload_type: string; payload_json: string };

function getLegacyBufferDir(): string {
  return path.join(path.dirname(configPath()), "telemetry-buffer");
}

function getOutboxPath(): string {
  return path.join(path.dirname(configPath()), "telemetry-outbox.sqlite");
}

function openOutbox(): DatabaseSync {
  fs.mkdirSync(path.dirname(getOutboxPath()), { recursive: true });
  const db = new DatabaseSync(getOutboxPath());
  db.exec(`
    PRAGMA busy_timeout = 250;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY,
      payload_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS legacy_buffer_migration (
      filename TEXT PRIMARY KEY
    ) STRICT;
  `);
  return db;
}

function migrateLegacyBuffer(): void {
  const dir = getLegacyBufferDir();
  if (!fs.existsSync(dir)) return;

  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .sort();
  } catch {
    return;
  }

  for (const filename of files) {
    const filePath = path.join(dir, filename);
    let payloadJson: string;
    try {
      const item = JSON.parse(fs.readFileSync(filePath, "utf8")) as { payload?: unknown };
      payloadJson = JSON.stringify(item.payload);
      if (payloadJson === undefined) throw new Error("Missing payload");
    } catch {
      // Preserve the current behavior: corrupted legacy entries cannot block FIFO delivery.
      try {
        fs.unlinkSync(filePath);
      } catch {}
      continue;
    }

    let migrated = false;
    try {
      const db = openOutbox();
      try {
        db.exec("BEGIN IMMEDIATE");
        const seen = db
          .prepare("SELECT 1 FROM legacy_buffer_migration WHERE filename = ?")
          .get(filename);
        if (!seen) {
          db.prepare(
            "INSERT INTO outbox (payload_type, payload_json, created_at) VALUES (?, ?, ?)",
          ).run("evidence", payloadJson, new Date().toISOString());
          db.prepare("INSERT INTO legacy_buffer_migration (filename) VALUES (?)").run(filename);
        }
        db.exec("COMMIT");
        migrated = true;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        db.close();
      }
    } catch (error) {
      console.error(`[Spctre Buffer] Failed to migrate legacy telemetry: ${String(error)}`);
      return;
    }

    if (migrated) {
      try {
        fs.unlinkSync(filePath);
      } catch {}
    }
  }
}

export function pushToBuffer(payload: unknown): void;
export function pushToBuffer(payloadType: string, payload: unknown): void;
export function pushToBuffer(payloadTypeOrPayload: string | unknown, maybePayload?: unknown): void {
  const payloadType = arguments.length === 1 ? "evidence" : String(payloadTypeOrPayload);
  const payload = arguments.length === 1 ? payloadTypeOrPayload : maybePayload;

  try {
    const payloadJson = JSON.stringify(payload);
    if (payloadJson === undefined) throw new Error("Telemetry payload cannot be serialized");
    migrateLegacyBuffer();
    const db = openOutbox();
    try {
      db.prepare(
        "INSERT INTO outbox (payload_type, payload_json, created_at) VALUES (?, ?, ?)",
      ).run(payloadType, payloadJson, new Date().toISOString());
    } finally {
      db.close();
    }
  } catch (error) {
    console.error(`[Spctre Buffer] Failed to write telemetry to offline buffer: ${String(error)}`);
  }
}

function deleteOutboxRow(id: number): void {
  const db = openOutbox();
  try {
    db.prepare("DELETE FROM outbox WHERE id = ?").run(id);
  } finally {
    db.close();
  }
}

function recordRetry(id: number, error: string): void {
  const db = openOutbox();
  try {
    db.prepare(
      "UPDATE outbox SET attempt_count = attempt_count + 1, last_error = ? WHERE id = ?",
    ).run(error, id);
  } finally {
    db.close();
  }
}

function readOldestOutboxRow(): OutboxRow | undefined {
  const db = openOutbox();
  try {
    return db
      .prepare("SELECT id, payload_type, payload_json FROM outbox ORDER BY id ASC LIMIT 1")
      .get() as OutboxRow | undefined;
  } finally {
    db.close();
  }
}

export async function flushBuffer(config: SpctreCliConfig): Promise<void> {
  migrateLegacyBuffer();
  const url = config.controlPlaneUrl.replace(/\/+$/, "");

  for (;;) {
    let row: OutboxRow | undefined;
    try {
      row = readOldestOutboxRow();
    } catch (error) {
      console.error(`[Spctre Buffer] Failed to read offline telemetry: ${String(error)}`);
      return;
    }
    if (!row) return;

    let payload: unknown;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      // This should be impossible for rows written above, but invalid data must not block FIFO delivery.
      deleteOutboxRow(row.id);
      continue;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(`${url}/api/v1/evidence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.token}`,
          "x-spctre-source": "hook",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.status < 400) {
        deleteOutboxRow(row.id);
      } else if (response.status < 500) {
        console.error(
          `[Spctre Buffer] Discarding invalid telemetry payload: HTTP ${response.status}`,
        );
        deleteOutboxRow(row.id);
      } else {
        recordRetry(row.id, `HTTP ${response.status}`);
        return;
      }
    } catch (error) {
      clearTimeout(timeoutId);
      try {
        recordRetry(row.id, String(error));
      } catch {}
      return;
    }
  }
}
