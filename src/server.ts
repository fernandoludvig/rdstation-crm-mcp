import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RdCrmClient } from "./client/http.js";
import { registerContactTools } from "./tools/contacts.js";
import { registerDealTools } from "./tools/deals.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerPipelineTools } from "./tools/pipeline.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";

export function createServer(client: RdCrmClient): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerContactTools(server, client);
  registerDealTools(server, client);
  registerTaskTools(server, client);
  registerPipelineTools(server, client);

  return server;
}
