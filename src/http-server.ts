/**
 * Streamable HTTP request handling for rdstation-crm-mcp.
 *
 * Kept separate from the CLI bootstrap (src/http.ts) so the request listener
 * can be created and tested in isolation, the same way src/server.ts keeps
 * `createServer` separate from the stdio bootstrap in src/index.ts.
 *
 * Auth model: this transport is meant for remote/shared deployments (e.g. a
 * team's own hosted instance, or a listing on a registry like Smithery), so
 * unlike the stdio server there is no single implicit user. Each session
 * supplies its own RD Station CRM token via `Authorization: Bearer <token>`.
 * A `defaultToken` can be configured for a single-tenant self-hosted setup
 * where every caller is trusted to share one CRM account.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { RdCrmClient } from "./client/http.js";
import { createServer } from "./server.js";

export interface HttpServerOptions {
  /** Token used when a request doesn't send its own Authorization header. */
  defaultToken?: string;
  /**
   * Hostnames allowed in the Host header (basic DNS-rebinding guard).
   * Leave undefined to skip the check (fine when bound to 0.0.0.0 behind a
   * reverse proxy that already validates the host).
   */
  allowedHosts?: string[];
}

interface JsonRpcErrorBody {
  jsonrpc: "2.0";
  error: { code: number; message: string };
  id: null;
}

function errorBody(code: number, message: string): JsonRpcErrorBody {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function extractToken(req: IncomingMessage, defaultToken?: string): string | undefined {
  const auth = firstHeader(req.headers["authorization"]);
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  return defaultToken;
}

/**
 * Creates the Node HTTP request listener for the MCP Streamable HTTP
 * endpoint (`POST` / `GET` / `DELETE /mcp`) plus a `GET /health` check.
 *
 * Each call returns a listener with its own in-memory session map, so
 * tests (and separate server processes) don't share state.
 */
export function createHttpRequestListener(
  options: HttpServerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { defaultToken, allowedHosts } = options;
  const transports = new Map<string, StreamableHTTPServerTransport>();

  function isHostAllowed(req: IncomingMessage): boolean {
    if (!allowedHosts || allowedHosts.length === 0) return true;
    const host = firstHeader(req.headers.host)?.split(":")[0];
    return !!host && allowedHosts.includes(host);
  }

  async function handleInitializeOrContinue(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const sessionId = firstHeader(req.headers["mcp-session-id"]);
    let transport = sessionId ? transports.get(sessionId) : undefined;

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, errorBody(-32700, "Parse error"));
      return;
    }

    if (!transport) {
      if (sessionId) {
        sendJson(res, 404, errorBody(-32001, "Session not found"));
        return;
      }

      if (!isInitializeRequest(body)) {
        sendJson(
          res,
          400,
          errorBody(-32000, "Bad Request: no session ID and not an initialize request"),
        );
        return;
      }

      const token = extractToken(req, defaultToken);
      if (!token) {
        sendJson(
          res,
          401,
          errorBody(
            -32001,
            "Missing RD Station CRM token. Send it as 'Authorization: Bearer <token>' or configure a default token on the server.",
          ),
        );
        return;
      }

      const client = new RdCrmClient(token);
      const mcpServer = createServer(client);

      const newTransport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, newTransport);
        },
      });
      newTransport.onclose = () => {
        if (newTransport.sessionId) transports.delete(newTransport.sessionId);
      };

      await mcpServer.connect(newTransport);
      transport = newTransport;
    }

    await transport.handleRequest(req, res, body);
  }

  async function handleSessionOnly(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = firstHeader(req.headers["mcp-session-id"]);
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Session not found");
      return;
    }
    await transport.handleRequest(req, res);
  }

  return async function listener(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isHostAllowed(req)) {
      res.writeHead(421, { "content-type": "text/plain" }).end("Misdirected Request");
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, {
        status: "ok",
        server: "rdstation-crm-mcp",
        sessions: transports.size,
      });
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }

    try {
      if (req.method === "POST") {
        await handleInitializeOrContinue(req, res);
        return;
      }
      if (req.method === "GET" || req.method === "DELETE") {
        await handleSessionOnly(req, res);
        return;
      }
      res.writeHead(405, { "content-type": "text/plain" }).end("Method not allowed");
    } catch (error) {
      console.error("Error handling /mcp request:", error);
      if (!res.headersSent) {
        sendJson(res, 500, errorBody(-32603, "Internal server error"));
      }
    }
  };
}
