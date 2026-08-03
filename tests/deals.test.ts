import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { RdCrmClient } from "../src/client/http.js";
import { closeDeal, createDeal, listDeals, updateDeal } from "../src/tools/deals.js";
import { API_BASE_URL } from "../src/constants.js";
import { mockApi } from "./setup.js";
import { makeDeal, pipelines, TOKEN, users } from "./fixtures.js";

const client = new RdCrmClient(TOKEN);

function usePipelines(): void {
  mockApi.use(http.get(`${API_BASE_URL}/deal_pipelines`, () => HttpResponse.json(pipelines)));
}

describe("listDeals", () => {
  it("maps status 'open' to closed_at=false", async () => {
    let url: URL | null = null;
    mockApi.use(
      http.get(`${API_BASE_URL}/deals`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ deals: [makeDeal()], total: 1, has_more: false });
      }),
    );
    const text = await listDeals(client, { status: "open", page: 1, limit: 20 });
    expect(url!.searchParams.get("closed_at")).toBe("false");
    expect(text).toContain("Acme Corp - Annual plan (id: deal1)");
    expect(text).toContain("R$");
  });

  it("maps status 'lost' to win=false", async () => {
    let url: URL | null = null;
    mockApi.use(
      http.get(`${API_BASE_URL}/deals`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ deals: [], total: 0, has_more: false });
      }),
    );
    await listDeals(client, { status: "lost", page: 1, limit: 20 });
    expect(url!.searchParams.get("win")).toBe("false");
    expect(url!.searchParams.has("closed_at")).toBe(false);
  });
});

describe("createDeal", () => {
  it("resolves stage by name and posts the deal", async () => {
    usePipelines();
    let body: Record<string, unknown> = {};
    mockApi.use(
      http.post(`${API_BASE_URL}/deals`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeDeal({ _id: "created1", name: "New deal" }));
      }),
    );
    const text = await createDeal(client, {
      name: "New deal",
      stage_name: "proposta",
      value: 1000,
    });
    const deal = body.deal as Record<string, unknown>;
    expect(deal.deal_stage_id).toBe("stage2");
    expect(body.deal_products).toEqual([
      { name: "Deal value", price: 1000, amount: 1, total: 1000 },
    ]);
    expect(text).toContain("Proposta");
  });

  it("rejects an unknown stage name listing the valid ones", async () => {
    usePipelines();
    await expect(createDeal(client, { name: "X", stage_name: "Fechamento" })).rejects.toThrow(
      /Qualificação.*Proposta.*Negociação/s,
    );
  });
});

describe("updateDeal", () => {
  it("moves stage by name and resolves owner by email", async () => {
    usePipelines();
    mockApi.use(http.get(`${API_BASE_URL}/users`, () => HttpResponse.json({ users })));
    let body: Record<string, unknown> = {};
    mockApi.use(
      http.put(`${API_BASE_URL}/deals/deal1`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeDeal());
      }),
    );
    const text = await updateDeal(client, {
      deal_id: "deal1",
      stage_name: "Negociação",
      user: "maria@example.com",
    });
    expect(body.deal_stage_id).toBe("stage3");
    expect((body.deal as Record<string, unknown>).user_id).toBe("user2");
    expect(text).toContain("Negociação");
  });

  it("requires at least one change", async () => {
    await expect(updateDeal(client, { deal_id: "deal1" })).rejects.toThrow(/Nothing to update/);
  });
});

describe("closeDeal", () => {
  it("marks a deal as won", async () => {
    let body: Record<string, unknown> = {};
    mockApi.use(
      http.put(`${API_BASE_URL}/deals/deal1`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeDeal({ win: true }));
      }),
    );
    const text = await closeDeal(client, { deal_id: "deal1", outcome: "won" });
    expect((body.deal as Record<string, unknown>).win).toBe(true);
    expect(text).toContain("WON");
  });

  it("resolves a lost reason by name", async () => {
    mockApi.use(
      http.get(`${API_BASE_URL}/deal_lost_reasons`, () =>
        HttpResponse.json({
          deal_lost_reasons: [
            { _id: "lr1", name: "Preço" },
            { _id: "lr2", name: "Sem retorno" },
          ],
          total: 2,
          has_more: false,
        }),
      ),
    );
    let body: Record<string, unknown> = {};
    mockApi.use(
      http.put(`${API_BASE_URL}/deals/deal1`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeDeal({ win: false }));
      }),
    );
    const text = await closeDeal(client, {
      deal_id: "deal1",
      outcome: "lost",
      lost_reason: "preço",
      note: "budget cut",
    });
    const deal = body.deal as Record<string, unknown>;
    expect(deal.win).toBe(false);
    expect(deal.deal_lost_reason_id).toBe("lr1");
    expect(deal.deal_lost_note).toBe("budget cut");
    expect(text).toContain("LOST");
  });
});
