/**
 * rdstation-crm-mcp — Streamable HTTP entry point.
 *
 * Runs the same tools as the stdio server (src/index.ts) over the MCP
 * Streamable HTTP transport, for remote/hosted deployments (e.g. a team's
 * own server, or a registry listing like Smithery).
 *
 * Env vars:
 *   PORT            Port to listen on (default 8080).
 *   HOST            Host to bind to (default 127.0.0.1). Use 0.0.0.0 for
 *                    container/cloud deployments.
 *   ALLOWED_HOSTS    Comma-separated Host header allow-list. Recommended
 *                    when binding to 0.0.0.0 without a reverse proxy in
 *                    front that already validates the Host header.
 *   RDSTATION_CRM_TOKEN  Optional default token, used when a request sends
 *                    no Authorization header. Without it, every session
 *                    must send its own `Authorization: Bearer <token>`.
 */
import { createServer as createHttpServer } from "node:http";
import { createHttpRequestListener } from "./http-server.js";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "127.0.0.1";
const ALLOWED_HOSTS = process.env.ALLOWED_HOSTS?.split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const listener = createHttpRequestListener({
  defaultToken: process.env.RDSTATION_CRM_TOKEN,
  allowedHosts: ALLOWED_HOSTS,
});

const server = createHttpServer((req, res) => {
  listener(req, res).catch((error: unknown) => {
    console.error("Unhandled error in request listener:", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Internal server error");
    }
  });
});

server.listen(PORT, HOST, () => {
  console.error(`rdstation-crm-mcp (Streamable HTTP) listening on http://${HOST}:${PORT}/mcp`);
  if (!process.env.RDSTATION_CRM_TOKEN) {
    console.error(
      "No RDSTATION_CRM_TOKEN set: every session must send its own 'Authorization: Bearer <token>' header.",
    );
  }
});
