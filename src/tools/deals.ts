import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RdCrmClient } from "../client/http.js";
import { resourceId, type ApiDeal, type ListDealsResponse } from "../client/types.js";
import { runTool, ToolInputError } from "../lib/errors.js";
import {
  clampResponse,
  dealLine,
  dealStatus,
  money,
  paginationFooter,
  shortDate,
} from "../lib/format.js";
import { resolveLostReason, resolveStage, resolveUser } from "../lib/resolve.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";

const ListDealsSchema = z
  .object({
    status: z
      .enum(["open", "won", "lost", "all"])
      .default("open")
      .describe("Deal status filter (default 'open')"),
    pipeline_id: z.string().optional().describe("Filter by pipeline ID"),
    stage_id: z.string().optional().describe("Filter by stage ID"),
    user_id: z.string().optional().describe("Filter by owner (user ID)"),
    name: z.string().optional().describe("Filter by deal name"),
    created_after: z
      .string()
      .optional()
      .describe("Only deals created after this date (YYYY-MM-DD)"),
    created_before: z
      .string()
      .optional()
      .describe("Only deals created before this date (YYYY-MM-DD)"),
    page: z.number().int().min(1).default(1).describe("Page number (default 1)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .default(DEFAULT_LIMIT)
      .describe("Results per page (default 20, max 200)"),
  })
  .strict();

const GetDealSchema = z
  .object({
    deal_id: z.string().min(1).describe("Deal ID (from rdcrm_list_deals or rdcrm_get_contact)"),
  })
  .strict();

const CreateDealSchema = z
  .object({
    name: z.string().min(1).describe("Deal name (e.g. 'Acme Corp - Annual plan')"),
    stage_id: z.string().optional().describe("Target stage ID. Alternative: stage_name"),
    stage_name: z
      .string()
      .optional()
      .describe("Target stage name (e.g. 'Qualification'). Used when stage_id is not known"),
    pipeline_name: z
      .string()
      .optional()
      .describe("Pipeline name, to disambiguate stage_name when there are multiple pipelines"),
    value: z.number().min(0).optional().describe("One-time deal value in BRL"),
    rating: z.number().int().min(1).max(5).optional().describe("Deal rating, 1 to 5 stars"),
    user_id: z.string().optional().describe("Owner user ID"),
    user: z.string().optional().describe("Owner by email or name (resolved automatically)"),
    contact_email: z.string().email().optional().describe("Email of a contact to link"),
    contact_name: z
      .string()
      .optional()
      .describe("Name of the contact to link (required if contact_email is new)"),
    prediction_date: z.string().optional().describe("Expected close date (YYYY-MM-DD)"),
  })
  .strict();

const UpdateDealSchema = z
  .object({
    deal_id: z.string().min(1).describe("Deal ID to update"),
    name: z.string().optional().describe("New deal name"),
    stage_id: z.string().optional().describe("Move the deal to this stage ID"),
    stage_name: z
      .string()
      .optional()
      .describe("Move the deal to this stage name (alternative to stage_id)"),
    pipeline_name: z.string().optional().describe("Pipeline name, to disambiguate stage_name"),
    user_id: z.string().optional().describe("New owner user ID"),
    user: z.string().optional().describe("New owner by email or name"),
    rating: z.number().int().min(1).max(5).optional().describe("New rating, 1 to 5"),
    prediction_date: z.string().optional().describe("New expected close date (YYYY-MM-DD)"),
    hold: z.boolean().optional().describe("true pauses the deal, false resumes it"),
  })
  .strict();

const CloseDealSchema = z
  .object({
    deal_id: z.string().min(1).describe("Deal ID to close"),
    outcome: z.enum(["won", "lost"]).describe("Whether the deal was won or lost"),
    lost_reason_id: z.string().optional().describe("Lost reason ID (only for outcome 'lost')"),
    lost_reason: z
      .string()
      .optional()
      .describe("Lost reason by name, resolved against the account's configured reasons"),
    note: z.string().optional().describe("Optional note about why the deal was lost"),
  })
  .strict();

function statusQuery(status: "open" | "won" | "lost" | "all"): Record<string, string> {
  switch (status) {
    case "open":
      return { closed_at: "false" };
    case "won":
      return { win: "true" };
    case "lost":
      return { win: "false" };
    case "all":
      return {};
  }
}

export async function listDeals(
  client: RdCrmClient,
  params: z.infer<typeof ListDealsSchema>,
): Promise<string> {
  const query: Record<string, string | number | undefined> = {
    ...statusQuery(params.status),
    deal_pipeline_id: params.pipeline_id,
    deal_stage_id: params.stage_id,
    user_id: params.user_id,
    name: params.name,
    page: params.page,
    limit: params.limit,
  };
  if (params.created_after || params.created_before) {
    query.created_at_period = "true";
    query.start_date = params.created_after;
    query.end_date = params.created_before;
  }
  const res = await client.get<ListDealsResponse>("/deals", query);
  const deals = res.deals ?? [];
  if (deals.length === 0) {
    return `No ${params.status === "all" ? "" : params.status + " "}deals found with these filters. Try status='all', remove filters, or check pipeline/stage IDs with rdcrm_pipeline_overview.`;
  }
  const lines = deals.map(dealLine);
  const footer = paginationFooter({
    total: res.total ?? deals.length,
    shown: deals.length,
    page: params.page,
    hasMore: res.has_more ?? false,
  });
  return clampResponse(`${lines.join("\n")}\n\n${footer}`);
}

export async function getDeal(
  client: RdCrmClient,
  params: z.infer<typeof GetDealSchema>,
): Promise<string> {
  const deal = await client.get<ApiDeal>(`/deals/${params.deal_id}`);
  const lines = [
    `# ${deal.name} (id: ${resourceId(deal)})`,
    `Status: ${dealStatus(deal)}${deal.closed_at ? ` (closed ${shortDate(deal.closed_at)})` : ""}`,
    `Stage: ${deal.deal_stage?.name ?? "-"}`,
    `Value: ${money(deal.amount_total)}`,
    `Owner: ${deal.user?.name ?? "-"} <${deal.user?.email ?? "-"}>`,
    `Rating: ${deal.rating ?? "-"}/5`,
    `Created: ${shortDate(deal.created_at)} | Updated: ${shortDate(deal.updated_at)} | Last activity: ${shortDate(deal.last_activity_at)}`,
  ];
  if (deal.prediction_date) lines.push(`Expected close: ${shortDate(deal.prediction_date)}`);

  const contacts = deal.contacts ?? [];
  if (contacts.length > 0) {
    lines.push("", `Contacts (${contacts.length}):`);
    for (const c of contacts) {
      lines.push(
        `- ${c.name} | ${c.emails?.[0]?.email ?? "-"} | ${c.phones?.[0]?.phone ?? "-"}`,
      );
    }
  }
  const products = deal.deal_products ?? [];
  if (products.length > 0) {
    lines.push("", `Products (${products.length}):`);
    for (const p of products) {
      lines.push(`- ${p.name} | qty: ${p.amount ?? 1} | total: ${money(p.total)}`);
    }
  }
  return clampResponse(lines.join("\n"));
}

export async function createDeal(
  client: RdCrmClient,
  params: z.infer<typeof CreateDealSchema>,
): Promise<string> {
  const stage = await resolveStage(client, {
    stageId: params.stage_id,
    stageName: params.stage_name,
    pipelineName: params.pipeline_name,
  });

  let userId: string | undefined;
  if (params.user_id || params.user) {
    const user = await resolveUser(client, {
      userId: params.user_id,
      userEmailOrName: params.user,
    });
    userId = resourceId(user);
  }

  if (params.contact_email && !params.contact_name) {
    throw new ToolInputError(
      "contact_name is required when contact_email is provided, so the contact can be created if it doesn't exist yet.",
    );
  }

  const payload: Record<string, unknown> = {
    deal: {
      name: params.name,
      deal_stage_id: stage.stageId,
      ...(userId ? { user_id: userId } : {}),
      ...(params.rating ? { rating: params.rating } : {}),
      ...(params.prediction_date ? { prediction_date: params.prediction_date } : {}),
    },
    ...(params.value !== undefined
      ? {
          deal_products: [
            {
              name: "Deal value",
              price: params.value,
              amount: 1,
              total: params.value,
            },
          ],
        }
      : {}),
    ...(params.contact_email
      ? {
          contacts: [
            {
              name: params.contact_name,
              emails: [{ email: params.contact_email }],
            },
          ],
        }
      : {}),
  };

  const created = await client.post<ApiDeal>("/deals", payload);
  return `Created deal '${created.name ?? params.name}' (id: ${resourceId(created)}) in stage '${stage.stageName}' of pipeline '${stage.pipeline.name}'.`;
}

export async function updateDeal(
  client: RdCrmClient,
  params: z.infer<typeof UpdateDealSchema>,
): Promise<string> {
  const changes: string[] = [];
  const dealBody: Record<string, unknown> = {};
  const payload: Record<string, unknown> = { deal: dealBody };

  if (params.stage_id || params.stage_name) {
    const stage = await resolveStage(client, {
      stageId: params.stage_id,
      stageName: params.stage_name,
      pipelineName: params.pipeline_name,
    });
    payload.deal_stage_id = stage.stageId;
    changes.push(`stage -> '${stage.stageName}' (${stage.pipeline.name})`);
  }
  if (params.user_id || params.user) {
    const user = await resolveUser(client, {
      userId: params.user_id,
      userEmailOrName: params.user,
    });
    dealBody.user_id = resourceId(user);
    changes.push(`owner -> ${user.name ?? user.email ?? dealBody.user_id}`);
  }
  if (params.name !== undefined) {
    dealBody.name = params.name;
    changes.push(`name -> '${params.name}'`);
  }
  if (params.rating !== undefined) {
    dealBody.rating = params.rating;
    changes.push(`rating -> ${params.rating}`);
  }
  if (params.prediction_date !== undefined) {
    dealBody.prediction_date = params.prediction_date;
    changes.push(`expected close -> ${params.prediction_date}`);
  }
  if (params.hold !== undefined) {
    dealBody.hold = params.hold;
    changes.push(params.hold ? "paused" : "resumed");
  }

  if (changes.length === 0) {
    throw new ToolInputError(
      "Nothing to update. Provide at least one of: name, stage_id/stage_name, user_id/user, rating, prediction_date, hold.",
    );
  }

  const updated = await client.put<ApiDeal>(`/deals/${params.deal_id}`, payload);
  return `Updated deal '${updated.name ?? params.deal_id}': ${changes.join(", ")}.`;
}

export async function closeDeal(
  client: RdCrmClient,
  params: z.infer<typeof CloseDealSchema>,
): Promise<string> {
  if (params.outcome === "won") {
    const updated = await client.put<ApiDeal>(`/deals/${params.deal_id}`, {
      deal: { win: true },
    });
    return `Deal '${updated.name ?? params.deal_id}' marked as WON. 🎉`;
  }

  const reasonId = await resolveLostReason(client, {
    reasonId: params.lost_reason_id,
    reasonName: params.lost_reason,
  });
  const updated = await client.put<ApiDeal>(`/deals/${params.deal_id}`, {
    deal: {
      win: false,
      ...(reasonId ? { deal_lost_reason_id: reasonId } : {}),
      ...(params.note ? { deal_lost_note: params.note } : {}),
    },
  });
  return `Deal '${updated.name ?? params.deal_id}' marked as LOST${reasonId ? " with the given reason" : ""}.`;
}

export function registerDealTools(server: McpServer, client: RdCrmClient): void {
  server.registerTool(
    "rdcrm_list_deals",
    {
      title: "List RD Station CRM Deals",
      description: `List deals with filters: status (open/won/lost/all, default open), pipeline, stage, owner, name, creation date range. Sorted by most recent first.

Returns one line per deal: name, id, stage, value, status, owner, last update. Use rdcrm_get_deal for full details.

Use when: "what deals are open?", "deals lost this month", "show João's pipeline".`,
      inputSchema: ListDealsSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (params) => runTool(() => listDeals(client, ListDealsSchema.parse(params))),
  );

  server.registerTool(
    "rdcrm_get_deal",
    {
      title: "Get RD Station CRM Deal",
      description: `Get full details of one deal by ID: status, stage, value, owner, rating, dates, linked contacts (with email/phone) and products.`,
      inputSchema: GetDealSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (params) => runTool(() => getDeal(client, GetDealSchema.parse(params))),
  );

  server.registerTool(
    "rdcrm_create_deal",
    {
      title: "Create RD Station CRM Deal",
      description: `Create a deal in a pipeline stage. Accepts the stage by ID or by name (stage_name, optionally with pipeline_name to disambiguate) — names are resolved automatically.

Optional: value (BRL), rating (1-5), owner (user_id or user by email/name), a contact to link (contact_email + contact_name), expected close date.

Use when: "create a deal for Acme in the Qualification stage worth R$5000".`,
      inputSchema: CreateDealSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (params) => runTool(() => createDeal(client, CreateDealSchema.parse(params))),
  );

  server.registerTool(
    "rdcrm_update_deal",
    {
      title: "Update RD Station CRM Deal",
      description: `Update a deal: move it to another stage (by ID or name), change owner, rename, set rating, expected close date, or pause/resume (hold).

Use when: "move the Acme deal to Negotiation", "assign this deal to Maria".
Don't use when: marking a deal won or lost (use rdcrm_close_deal).`,
      inputSchema: UpdateDealSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (params) => runTool(() => updateDeal(client, UpdateDealSchema.parse(params))),
  );

  server.registerTool(
    "rdcrm_close_deal",
    {
      title: "Close RD Station CRM Deal (Won/Lost)",
      description: `Mark a deal as won or lost. For lost deals, pass the reason by name (lost_reason) or ID (lost_reason_id) — names are resolved against the reasons configured in the account — plus an optional note.

Use when: "mark the Acme deal as won", "we lost the Beta deal because of price".`,
      inputSchema: CloseDealSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (params) => runTool(() => closeDeal(client, CloseDealSchema.parse(params))),
  );
}
