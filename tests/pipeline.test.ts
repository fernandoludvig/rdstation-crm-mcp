import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { RdCrmClient } from "../src/client/http.js";
import { pipelineOverview } from "../src/tools/pipeline.js";
import { API_BASE_URL } from "../src/constants.js";
import { mockApi } from "./setup.js";
import { makeDeal, pipelines, TOKEN } from "./fixtures.js";

const client = new RdCrmClient(TOKEN);
const NOW = new Date("2026-08-03T12:00:00.000Z");

describe("pipelineOverview", () => {
  it("aggregates open deals by stage, computes win rate and flags stalled deals", async () => {
    const openDeals = [
      makeDeal({ _id: "d1", updated_at: "2026-08-01T10:00:00.000Z" }), // fresh, stage1
      makeDeal({
        _id: "d2",
        name: "Beta Ltda",
        amount_total: 2000,
        deal_stage: { _id: "stage2", name: "Proposta" },
        updated_at: "2026-07-01T10:00:00.000Z", // 33 days -> stalled
      }),
      makeDeal({
        _id: "d3",
        name: "Gamma SA",
        amount_total: 3000,
        deal_stage: { _id: "stage2", name: "Proposta" },
        updated_at: "2026-08-02T10:00:00.000Z",
      }),
    ];

    mockApi.use(
      http.get(`${API_BASE_URL}/deal_pipelines`, () => HttpResponse.json(pipelines)),
      http.get(`${API_BASE_URL}/deals`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get("closed_at") === "false") {
          return HttpResponse.json({ deals: openDeals, total: 3, has_more: false });
        }
        // closed counts: win=true -> 6, win=false -> 2
        const win = params.get("win");
        return HttpResponse.json({
          deals: [],
          total: win === "true" ? 6 : 2,
          has_more: false,
        });
      }),
    );

    const text = await pipelineOverview(
      client,
      { stalled_days: 14, closed_period_days: 30 },
      NOW,
    );

    expect(text).toContain("Pipeline overview: Vendas");
    expect(text).toContain("Open deals: 3");
    expect(text).toContain("6 won, 2 lost (win rate 75%)");
    expect(text).toContain("Qualificação: 1 deals");
    expect(text).toContain("Proposta: 2 deals");
    expect(text).toContain("Negociação: 0 deals");
    expect(text).toContain("Stalled deals (no update in 14+ days): 1");
    expect(text).toContain("Beta Ltda");
    expect(text).not.toContain("Gamma SA (id: d3) | stage");
  });

  it("asks for pipeline_name when the account has several pipelines", async () => {
    mockApi.use(
      http.get(`${API_BASE_URL}/deal_pipelines`, () =>
        HttpResponse.json([...pipelines, { _id: "pipe2", name: "Parcerias", deal_stages: [] }]),
      ),
    );
    await expect(
      pipelineOverview(client, { stalled_days: 14, closed_period_days: 30 }, NOW),
    ).rejects.toThrow(/Vendas, Parcerias/);
  });
});
