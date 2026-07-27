import { sql } from "@/lib/db";

export function isDatabaseConfigured(): boolean {
  return !!sql;
}
