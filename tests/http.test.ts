import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHttpRequestListener } from "../src/http-server.js";
import { mockApi } from "./setup.js";

// These tests exercise the Streamable HTTP transport end to end over a real
// loopback socket (POST + SSE), unlike the other test files which call tool
// functions directly against a mocked RD Station API. The global msw
// interceptor from tests/setup.ts (onUnhandledRequest: "error") would flag
// that loopback traffic as unhandled, so it's switched off for this file:
// tests/setup.ts's `beforeAll` (which calls `mockApi.listen()`) runs first
// because setupFiles execute before the test file's own top-level code, so
// closing it here reliably undoes it before any test runs. No RD Station API
// calls happen in this file (`tools/list` doesn't hit the CRM), so nothing
// needs mocking.
beforeAll(() => {
  mockApi.close();
});

function createTestServer(
  options: Parameters<typeof createHttpRequestListener>[0] = {},
): Server {
  const listener = createHttpRequestListener(options);
  return createHttpServer((req, res) => {
    listener(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
}

async function listen(server: Server): Promise<URL> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${port}/mcp`);
}

describe("Streamable HTTP transport", () => {
  let server: Server | undefined;

  beforeEach(() => {
    server = undefined;
  });

  afterAll(() => {
    server?.close();
  });

  it("rejects a session with no token and no default token configured", async () => {
    server = createTestServer();
    const url = await listen(server);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test-client", version: "0.0.0" },
        },
      }),
    });

    expect(res.status).toBe(401);
    server.close();
  });

  it("initializes a session with a Bearer token and lists the registered tools", async () => {
    server = createTestServer();
    const url = await listen(server);

    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { authorization: "Bearer test-token" } },
    });
    const client = new Client({ name: "test-client", version: "0.0.0" });

    await client.connect(transport);
    expect(transport.sessionId).toBeDefined();

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("rdcrm_pipeline_overview");
    expect(names).toContain("rdcrm_search_contacts");
    expect(tools.length).toBeGreaterThanOrEqual(12);

    await transport.terminateSession();
    await client.close();
    server.close();
  });

  it("falls back to a configured default token when no Authorization header is sent", async () => {
    server = createTestServer({ defaultToken: "server-default-token" });
    const url = await listen(server);

    const transport = new StreamableHTTPClientTransport(url);
    const client = new Client({ name: "test-client", version: "0.0.0" });

    await expect(client.connect(transport)).resolves.not.toThrow();

    await transport.terminateSession();
    await client.close();
    server.close();
  });

  it("rejects requests whose Host header isn't in the allow-list", async () => {
    server = createTestServer({ allowedHosts: ["allowed.example"] });
    const url = await listen(server);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        host: "not-allowed.example",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });

    expect(res.status).toBe(421);
    server.close();
  });

  it("responds to GET /health without requiring a session", async () => {
    server = createTestServer();
    const url = await listen(server);
    const healthUrl = new URL("/health", url);

    const res = await fetch(healthUrl);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
    server.close();
  });
});
