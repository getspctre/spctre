import type { PolicyPack, PolicyRuleSummary } from "../types";
import { makePackMetadata } from "./pack-helpers";

// Database family packs replace generic 4-rule templated surfaces
// (postgresql-v1, mongodb-v1, snowflake-v1, aws-dynamodb-v1) with
// destructive-DDL/statement-shaped parameter constraints and bulk-operation
// row-count thresholds. Deterministic: matches the normalized statement
// shape/row-count already present in the governed tool call, not a live SQL
// parser or query plan inspector.

function destructiveStatementRule(connector: string, actions: string[]): Omit<PolicyRuleSummary, "sourceFormat" | "sourcePath"> {
  return {
    stableRuleId: `${connector}.statement.destructive_ddl.block`,
    title: `Block destructive schema statements (DROP/TRUNCATE) without approval`,
    effect: "DENY",
    domains: ["schema", "data"],
    connectors: [connector],
    actions,
    immutable: true,
    parameterConstraints: [
      { field: "statement_type", operator: "in", value: ["DROP", "TRUNCATE"] },
    ],
    controlMappings: [
      { framework: "SOC2", controlId: "CC8.1", rationale: "Blocks unreviewed destructive schema changes." },
    ],
  };
}

function bulkDeleteRule(connector: string, threshold: number, parameterKey: string): Omit<PolicyRuleSummary, "sourceFormat" | "sourcePath"> {
  return {
    stableRuleId: `${connector}.data.bulk_delete_review`,
    title: `Escalate bulk deletes affecting a large row/document count`,
    effect: "ESCALATE",
    domains: ["data"],
    connectors: [connector],
    actions: ["data.delete", "data.bulk_delete"],
    immutable: false,
    parameterConstraints: [
      { field: "affected_row_count", operator: "gte", value: threshold, parameterKey },
    ],
  };
}

export const POSTGRESQL_PACK: PolicyPack = {
  id: "postgresql-v1",
  name: "PostgreSQL Operations Pack",
  connector: "postgresql",
  description:
    "Governance rules for agents operating PostgreSQL. Blocks destructive DDL (DROP/TRUNCATE) and unapproved bulk deletes, and blocks schema exports containing regulated data classes without compliance approval.",
  riskLevel: "HIGH",
  tags: ["database", "postgresql", "sql", "schema", "data", "migrations"],
  domains: ["schema", "data", "migrations", "exports", "backups"],
  parameters: [
    { key: "postgresql.bulk_delete_review_rows", label: "Row count requiring review for bulk deletes", type: "number", default: 10000 },
  ],
  metadata: makePackMetadata({
    name: "PostgreSQL Operations Pack",
    connector: "postgresql",
    riskLevel: "HIGH",
    riskTags: ["database", "sql", "schema"],
    category: "database operations",
    changelog: [{ version: "1.0.0", date: "2026-07-20", summary: "Hand-authored replacement for the generated PostgreSQL pack." }],
  }),
  rules: [
    destructiveStatementRule("postgresql", ["schema.migrate", "schema.execute"]),
    bulkDeleteRule("postgresql", 10000, "postgresql.bulk_delete_review_rows"),
    {
      stableRuleId: "postgresql.export.regulated_data.block",
      title: "Block exports of regulated data classes without compliance approval",
      effect: "DENY",
      domains: ["exports", "data"],
      connectors: ["postgresql"],
      actions: ["data.export", "backup.download"],
      immutable: true,
      semanticChecks: [
        { id: "postgresql-export-sc-1", prompt: "check for pii or regulated data in export request", effect: "DENY" },
      ],
    },
  ],
};

export const MONGODB_PACK: PolicyPack = {
  id: "mongodb-v1",
  name: "MongoDB Governance Pack",
  connector: "mongodb",
  description:
    "Governance rules for agents operating MongoDB. Blocks destructive collection/database drops and unapproved bulk document deletes.",
  riskLevel: "HIGH",
  tags: ["database", "documents", "exports", "clusters"],
  domains: ["clusters", "databases", "collections", "indexes", "exports"],
  parameters: [
    { key: "mongodb.bulk_delete_review_rows", label: "Document count requiring review for bulk deletes", type: "number", default: 10000 },
  ],
  metadata: makePackMetadata({
    name: "MongoDB Governance Pack",
    connector: "mongodb",
    riskLevel: "HIGH",
    riskTags: ["database", "documents", "clusters"],
    category: "database",
    changelog: [{ version: "1.0.0", date: "2026-07-20", summary: "Hand-authored replacement for the generated MongoDB pack." }],
  }),
  rules: [
    {
      stableRuleId: "mongodb.collection.drop.block",
      title: "Block dropping collections or databases without approval",
      effect: "DENY",
      domains: ["databases", "collections"],
      connectors: ["mongodb"],
      actions: ["collection.drop", "database.drop"],
      immutable: true,
    },
    bulkDeleteRule("mongodb", 10000, "mongodb.bulk_delete_review_rows"),
    {
      stableRuleId: "mongodb.export.bulk_export.block",
      title: "Block bulk collection exports without compliance approval",
      effect: "DENY",
      domains: ["exports"],
      connectors: ["mongodb"],
      actions: ["collection.export", "data.bulk_export"],
      immutable: true,
    },
  ],
};

export const SNOWFLAKE_PACK: PolicyPack = {
  id: "snowflake-v1",
  name: "Snowflake Governance Pack",
  connector: "snowflake",
  description:
    "Governance rules for agents operating Snowflake. Escalates high-cost warehouse queries above a credit threshold, blocks unreviewed data shares, and blocks destructive table/schema drops.",
  riskLevel: "HIGH",
  tags: ["data", "warehouse", "exports", "sql"],
  domains: ["warehouses", "schemas", "tables", "shares", "queries"],
  parameters: [
    { key: "snowflake.query_cost_review_credits", label: "Estimated query cost (credits) requiring review", type: "number", default: 50 },
  ],
  metadata: makePackMetadata({
    name: "Snowflake Governance Pack",
    connector: "snowflake",
    riskLevel: "HIGH",
    riskTags: ["data", "warehouse", "sql"],
    category: "data warehouse",
    changelog: [{ version: "1.0.0", date: "2026-07-20", summary: "Hand-authored replacement for the generated Snowflake pack." }],
  }),
  rules: [
    destructiveStatementRule("snowflake", ["table.execute", "schema.execute"]),
    {
      stableRuleId: "snowflake.query.high_cost_review",
      title: "Escalate high-estimated-cost warehouse queries",
      effect: "ESCALATE",
      domains: ["queries", "warehouses"],
      connectors: ["snowflake"],
      actions: ["query.execute"],
      immutable: false,
      parameterConstraints: [
        { field: "estimated_credits", operator: "gte", value: 50, parameterKey: "snowflake.query_cost_review_credits" },
      ],
    },
    {
      stableRuleId: "snowflake.share.create.block",
      title: "Block creating new data shares without approval",
      effect: "DENY",
      domains: ["shares"],
      connectors: ["snowflake"],
      actions: ["share.create", "share.update_grants"],
      immutable: true,
      controlMappings: [
        { framework: "SOC2", controlId: "CC6.3", rationale: "Prevents unreviewed cross-account data sharing." },
      ],
    },
  ],
};

export const AWS_DYNAMODB_PACK: PolicyPack = {
  id: "aws-dynamodb-v1",
  name: "DynamoDB (AWS) Governance Pack",
  connector: "aws-dynamodb",
  description:
    "Governance rules for agents operating AWS DynamoDB. Blocks unreviewed table deletion and capacity changes above a scaling threshold, blocks disabling point-in-time recovery.",
  riskLevel: "HIGH",
  tags: ["cloud", "database", "nosql", "backups"],
  domains: ["tables", "backups", "capacity"],
  parameters: [
    { key: "aws-dynamodb.capacity_increase_review_units", label: "Capacity unit increase requiring review", type: "number", default: 40000 },
  ],
  metadata: makePackMetadata({
    name: "DynamoDB (AWS) Governance Pack",
    connector: "aws-dynamodb",
    riskLevel: "HIGH",
    riskTags: ["cloud", "database", "nosql"],
    category: "database operations",
    changelog: [{ version: "1.0.0", date: "2026-07-20", summary: "Hand-authored replacement for the generated DynamoDB pack." }],
  }),
  rules: [
    {
      stableRuleId: "aws-dynamodb.table.delete.block",
      title: "Block deleting tables without approval",
      effect: "DENY",
      domains: ["tables"],
      connectors: ["aws-dynamodb"],
      actions: ["table.delete"],
      immutable: true,
    },
    {
      stableRuleId: "aws-dynamodb.backup.disable_pitr.block",
      title: "Block disabling point-in-time recovery",
      effect: "DENY",
      domains: ["backups"],
      connectors: ["aws-dynamodb"],
      actions: ["backup.update_continuous"],
      immutable: true,
      parameterConstraints: [{ field: "point_in_time_recovery_enabled", operator: "eq", value: false }],
    },
    {
      stableRuleId: "aws-dynamodb.capacity.large_increase_review",
      title: "Escalate large provisioned-capacity increases",
      effect: "ESCALATE",
      domains: ["capacity"],
      connectors: ["aws-dynamodb"],
      actions: ["capacity.update"],
      immutable: false,
      parameterConstraints: [
        { field: "new_write_capacity_units", operator: "gte", value: 40000, parameterKey: "aws-dynamodb.capacity_increase_review_units" },
      ],
    },
  ],
};
