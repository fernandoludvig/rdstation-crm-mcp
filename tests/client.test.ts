import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { RdCrmApiError, RdCrmClient } from "../src/client/http.js";
import { toToolError } from "../src/lib/errors.js";
import { API_BASE_URL } from "../src/constants.js";
import { mockApi } from "./setup.js";
import { TOKEN } from "./fixtures.js";

const client = new RdCrmClient(TOKEN);

describe("RdCrmClient", () => {
  it("sends the token as a query parameter", async () => {
    let seenToken: string | null = null;
    mockApi.use(
      http.get(`${API_BASE_URL}/deals`, ({ request }) => {
        seenToken = new URL(request.url).searchParams.get("token");
        return HttpResponse.json({ deals: [], total: 0, has_more: false });
      }),
    );
    await client.get("/deals");
    expect(seenToken).toBe(TOKEN);
  });

  it("omits undefined query params", async () => {
    let url: URL | null = null;
    mockApi.use(
      http.get(`${API_BASE_URL}/deals`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ deals: [], total: 0, has_more: false });
      }),
    );
    await client.get("/deals", { page: 1, name: undefined });
    expect(url!.searchParams.get("page")).toBe("1");
    expect(url!.searchParams.has("name")).toBe(false);
  });

  it("retries on 429 and succeeds", async () => {
    let calls = 0;
    mockApi.use(
      http.get(`${API_BASE_URL}/contacts`, () => {
        calls += 1;
        if (calls === 1) return new HttpResponse(null, { status: 429 });
        return HttpResponse.json({ contacts: [], total: 0, has_more: false });
      }),
    );
    const res = await client.get<{ total: number }>("/contacts");
    expect(calls).toBe(2);
    expect(res.total).toBe(0);
  });

  it("throws RdCrmApiError with status on non-retryable failure", async () => {
    mockApi.use(
      http.get(`${API_BASE_URL}/deals/nope`, () =>
        HttpResponse.json({ error: "not found" }, { status: 404 }),
      ),
    );
    await expect(client.get("/deals/nope")).rejects.toMatchObject({
      name: "RdCrmApiError",
      status: 404,
    });
  });
});

describe("toToolError", () => {
  it("maps 401 to a token hint", () => {
    const msg = toToolError(new RdCrmApiError("auth", 401));
    expect(msg).toContain("RDSTATION_CRM_TOKEN");
  });

  it("maps 404 to a next-step hint", () => {
    const msg = toToolError(new RdCrmApiError("nope", 404));
    expect(msg).toContain("list/search");
  });

  it("includes API detail on 422", () => {
    const msg = toToolError(new RdCrmApiError("bad", 422, '{"error":"name is required"}'));
    expect(msg).toContain("name is required");
  });

  it("surfaces the API message from the errors envelope on 403", () => {
    // Real free-plan response for extended task types
    const body =
      '{"errors":[{"error_type":"ACCESS_DENIED","error_message":"This account is not allowed to create tasks of the type: call","feature":"extended_task_types","access":false}]}';
    const msg = toToolError(new RdCrmApiError("denied", 403, body));
    expect(msg).toContain("not allowed to create tasks of the type: call");
    expect(msg).toContain("plan");
  });
});
