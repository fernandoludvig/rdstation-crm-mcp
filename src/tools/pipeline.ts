import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RdCrmClient } from "../client/http.js";
import {
  resourceId,
  type ApiDeal,
  type ApiPipeline,
  type ListDealsResponse,
} from "../client/types.js";
import { runTool, ToolInputError } from "../lib/errors.js";
import { clampResponse, money, shortDate } from "../lib/format.js";
import { fetchPipelines } from "../lib/resolve.js";
import { MAX_AGGREGATION_PAGES, MAX_LIMIT } from "../constants.js";

const PipelineOverviewSchema = z
  .object({
    pipeline_name: z
      .string()
      .optional()
      .describe("Pipeline name. Optional when the account has a single pipeline"),
    stalled_days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(14)
      .describe("A deal counts as stalled after this many days without updates (default 14)"),
    closed_period_days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe("Window in days for won/lost stats (default 30)"),
  })
  .strict();

function pickPipeline(pipelines: ApiPipeline[], name?: string): ApiPipeline {
  if (pipelines.length === 0) {
    throw new ToolInputError("No sales pipelines found in this RD Station CRM account.");
  }
  if (!name) {
    if (pipelines.length === 1) return pipelines[0]!;
    throw new ToolInputError(
      `This account has ${pipelines.length} pipelines — pass pipeline_name. Options: ${pipelines
        .map((p) => p.name)
        .join(", ")}.`,
    );
  }
  const needle = name.trim().toLowerCase();
  const match = pipelines.find((p) => p.name.trim().toLowerCase() === needle);
  if (!match) {
    throw new ToolInputError(
      `Pipeline '${name}' not found. Options: ${pipelines.map((p) => p.name).join(", ")}.`,
    );
  }
  return match;
}

async function fetchOpenDeals(
  client: RdCrmClient,
  pipelineId: string,
): Promise<{ deals: ApiDeal[]; truncated: boolean; total: number }> {
  const deals: ApiDeal[] = [];
  let page = 1;
  let total = 0;
  for (; page <= MAX_AGGREGATION_PAGES; page++) {
    const res = await client.get<ListDealsResponse>("/deals", {
      deal_pipeline_id: pipelineId,
      closed_at: "false",
      limit: MAX_LIMIT,
      page,
    });
    deals.push(...(res.deals ?? []));
    total = res.total ?? deals.length;
    if (!res.has_more) return { deals, truncated: false, total };
  }
  return { deals, truncated: true, total };
}

async function countClosed(
  client: RdCrmClient,
  pipelineId: string,
  win: boolean,
  sinceIso: string,
  untilIso: string,
): Promise<number> {
  const res = await client.get<ListDealsResponse>("/deals", {
    deal_pipeline_id: pipelineId,
    win: String(win),
    closed_at_period: "true",
    start_date: sinceIso,
    end_date: untilIso,
    limit: 1,
    page: 1,
  });
  return res.total ?? 0;
}

export async function pipelineOverview(
  client: RdCrmClient,
  params: z.infer<typeof PipelineOverviewSchema>,
  now: Date = new Date(),
): Promise<string> {
  const pipelines = await fetchPipelines(client);
  const pipeline = pickPipeline(pipelines, params.pipeline_name);
  const pipelineId = resourceId(pipeline);

  const { deals, truncated, total } = await fetchOpenDeals(client, pipelineId);

  const since = new Date(now.getTime() - params.closed_period_days * 86_400_000);
  const sinceIso = since.toISOString().slice(0, 19);
  const untilIso = now.toISOString().slice(0, 19);
  const [wonCount, lostCount] = await Promise.all([
    countClosed(client, pipelineId, true, sinceIso, untilIso),
    countClosed(client, pipelineId, false, sinceIso, untilIso),
  ]);

  // Group open deals by stage, preserving the pipeline's stage order.
  const stages = [...(pipeline.deal_stages ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const byStage = new Map<string, { count: number; value: number }>();
  for (const stage of stages) byStage.set(resourceId(stage), { count: 0, value: 0 });
  let unknownStage = { count: 0, value: 0 };
  for (const deal of deals) {
    const stageId = deal.deal_stage ? resourceId(deal.deal_stage) : "";
    const bucket = byStage.get(stageId);
    if (bucket) {
      bucket.count += 1;
      bucket.value += deal.amount_total ?? 0;
    } else {
      unknownStage.count += 1;
      unknownStage.value += deal.amount_total ?? 0;
    }
  }

  const stalledCutoff = now.getTime() - params.stalled_days * 86_400_000;
  const stalled = deals
    .filter((d) => {
      const ts = Date.parse(d.updated_at ?? d.created_at ?? "");
      return Number.isFinite(ts) && ts < stalledCutoff;
    })
    .sort((a, b) => Date.parse(a.updated_at ?? "") - Date.parse(b.updated_at ?? ""));

  const openValue = deals.reduce((sum, d) => sum + (d.amount_total ?? 0), 0);
  const closedTotal = wonCount + lostCount;
  const winRate = closedTotal > 0 ? Math.round((wonCount / closedTotal) * 100) : null;

  const lines: string[] = [
    `# Pipeline overview: ${pipeline.name}`,
    "",
    `Open deals: ${total} | Open value: ${money(openValue)}`,
    `Last ${params.closed_period_days} days: ${wonCount} won, ${lostCount} lost${winRate !== null ? ` (win rate ${winRate}%)` : ""}`,
    "",
    "## Open deals by stage",
  ];
  for (const stage of stages) {
    const bucket = byStage.get(resourceId(stage))!;
    lines.push(`- ${stage.name}: ${bucket.count} deals | ${money(bucket.value)}`);
  }
  if (unknownStage.count > 0) {
    lines.push(`- (other stages): ${unknownStage.count} deals | ${money(unknownStage.value)}`);
  }

  lines.push(
    "",
    `## Stalled deals (no update in ${params.stalled_days}+ days): ${stalled.length}`,
  );
  for (const deal of stalled.slice(0, 10)) {
    lines.push(
      `- ${deal.name} (id: ${resourceId(deal)}) | stage: ${deal.deal_stage?.name ?? "-"} | ${money(deal.amount_total)} | last update: ${shortDate(deal.updated_at)}`,
    );
  }
  if (stalled.length > 10) {
    lines.push(
      `- ...and ${stalled.length - 10} more. Use rdcrm_list_deals with stage filters to see them.`,
    );
  }
  if (truncated) {
    lines.push(
      "",
      `Note: stats are based on the first ${deals.length} of ${total} open deals (API page cap). Stage counts may be partial.`,
    );
  }
  return clampResponse(lines.join("\n"));
}

export function registerPipelineTools(server: McpServer, client: RdCrmClient): void {
  server.registerTool(
    "rdcrm_pipeline_overview",
    {
      title: "RD Station CRM Pipeline Overview",
      description: `Aggregated health report of a sales pipeline: open deal count and value per stage (in funnel order), won/lost counts and win rate over a recent window (default 30 days), and stalled deals with no updates for N days (default 14).

Also the fastest way to discover the account's pipelines and stage names/IDs (errors list all options).

Use when: "how's my pipeline?", "where are deals stuck?", "sales summary for this month".`,
      inputSchema: PipelineOverviewSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (params) =>
      runTool(() => pipelineOverview(client, PipelineOverviewSchema.parse(params))),
  );
}
