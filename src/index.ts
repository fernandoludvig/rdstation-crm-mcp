/**
 * rdstation-crm-mcp — MCP server for RD Station CRM.
 *
 * Runs over stdio. Requires the RDSTATION_CRM_TOKEN environment variable
 * (instance token from RD Station CRM: Profile > Products and integrations).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RdCrmClient } from "./client/http.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const token = process.env.RDSTATION_CRM_TOKEN;
  if (!token) {
    console.error(
      "ERROR: RDSTATION_CRM_TOKEN environment variable is required.\n" +
        "Find your instance token in RD Station CRM under Profile > Products and integrations > Instance token.",
    );
    process.exit(1);
  }

  const client = new RdCrmClient(token);
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("rdstation-crm-mcp running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
