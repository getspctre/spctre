/**
 * Example MCP Client for Spctre
 * 
 * This demonstrates how to connect to the Spctre MCP server
 * and use its tools and resources.
 */

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

/**
 * Initialize MCP client connected to Spctre server
 */
async function initializeMcpClient(): Promise<Client> {
  // StdioClientTransport owns the one MCP server child process.
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: {
      ...process.env,
      SPCTRE_API_URL: "http://localhost:3000",
      SPCTRE_API_TOKEN: process.env.SPCTRE_API_TOKEN || "test-token",
      SPCTRE_WORKSPACE_ID: "ws-example",
      SPCTRE_AGENT_ID: "example-agent",
    },
  });

  const client = new Client({
    name: "spctre-example-client",
    version: "0.1.0",
  });

  await client.connect(transport);
  return client;
}

/**
 * Example: Evaluate policy for a Stripe charge
 */
async function exampleEvaluatePolicy(client: Client): Promise<void> {
  console.log("\n=== Example 1: Evaluate Policy ===");
  console.log("Scenario: Check if $5000 Stripe charge is allowed");

  const result = await client.callTool({
    name: "evaluate_policy",
    arguments: {
      connector: "stripe",
      action: "charge",
      agent_context: {
        agent_id: "example-agent",
        workspace_id: "ws-example",
        environment: "prod",
      },
      tool_context: {
        amount: 5000,
        target: "customer-789",
      },
      risk_level: "HIGH",
    },
  });

  console.log("Result:", JSON.stringify(result, null, 2));
}

/**
 * Example: Create evidence record
 */
async function exampleCreateEvidence(client: Client): Promise<void> {
  console.log("\n=== Example 2: Create Evidence Record ===");
  console.log("Scenario: Log the outcome of a policy-governed action");

  const result = await client.callTool({
    name: "create_evidence_record",
    arguments: {
      decision_id: "hb-202605071430-stripe-charge-12345",
      connector: "stripe",
      action: "charge",
      agent_context: {
        agent_id: "example-agent",
        workspace_id: "ws-example",
      },
      outcome: "EXECUTED",
      result: {
        status: "success",
        transaction_id: "txn_abc123",
      },
      tags: ["billing", "high-value"],
    },
  });

  console.log("Result:", JSON.stringify(result, null, 2));
}

/**
 * Example: Get policy status
 */
async function exampleGetPolicyStatus(client: Client): Promise<void> {
  console.log("\n=== Example 3: Get Policy Status ===");
  console.log("Scenario: Check current policy state");

  const result = await client.callTool({
    name: "get_policy_status",
    arguments: {
      workspace_id: "ws-example",
      environment: "prod",
    },
  });

  console.log("Result:", JSON.stringify(result, null, 2));
}

/**
 * Example: Escalate to review
 */
async function exampleEscalateToReview(client: Client): Promise<void> {
  console.log("\n=== Example 4: Escalate to Review ===");
  console.log("Scenario: Manually escalate a high-risk decision");

  const result = await client.callTool({
    name: "escalate_to_review",
    arguments: {
      decision_id: "hb-202605071430-stripe-charge-12345",
      reason: "Manual escalation: High confidence decision needs human approval",
      priority: "HIGH",
    },
  });

  console.log("Result:", JSON.stringify(result, null, 2));
}

/**
 * Example: List available tools
 */
async function exampleListTools(client: Client): Promise<void> {
  console.log("\n=== Example 5: List Available Tools ===");

  const tools = await client.listTools();
  console.log("Available tools:");
  tools.tools.forEach((tool) => {
    console.log(`  - ${tool.name}: ${tool.description}`);
  });
}

/**
 * Example: List available resources
 */
async function exampleListResources(client: Client): Promise<void> {
  console.log("\n=== Example 6: List Available Resources ===");

  const resources = await client.listResources();
  console.log("Available resources:");
  resources.resources.forEach((resource) => {
    console.log(`  - ${resource.uri}: ${resource.description}`);
  });
}

/**
 * Example: Get policy resource
 */
async function exampleGetPoliciesResource(client: Client): Promise<void> {
  console.log("\n=== Example 7: Get Policies Resource ===");
  console.log("Scenario: Fetch active policy set");

  const resource = await client.readResource({
    uri: "spctre://policies/main/current",
  });

  const content = resource.contents[0];
  console.log("Resource content:", content && "text" in content ? content.text : content?.blob);
}

/**
 * Example: Get prompt
 */
async function exampleGetPrompt(client: Client): Promise<void> {
  console.log("\n=== Example 8: Get Governance Prompt ===");

  const prompt = await client.getPrompt({
    name: "policy-governance-101",
    arguments: {
      agent_id: "example-agent",
      workspace_id: "ws-example",
    },
  });

  console.log("Prompt:", prompt.messages[0]?.content);
}

/**
 * Run all examples
 */
async function runExamples(): Promise<void> {
  console.log("Starting Spctre MCP Client Examples...");

  let client: Client | null = null;
  try {
    client = await initializeMcpClient();
    console.log("✓ Connected to Spctre MCP Server");

    // Run examples
    await exampleListTools(client);
    await exampleListResources(client);
    await exampleEvaluatePolicy(client);
    await exampleCreateEvidence(client);
    await exampleGetPolicyStatus(client);
    await exampleEscalateToReview(client);
    await exampleGetPoliciesResource(client);
    await exampleGetPrompt(client);

    console.log("\n✓ All examples completed successfully");
  } catch (error) {
    console.error("Error running examples:", error);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

// Run if executed directly
if (typeof require !== "undefined" && require.main === module && `file://${process.argv[1]}`) {
  runExamples().catch(console.error);
}

export { initializeMcpClient };
