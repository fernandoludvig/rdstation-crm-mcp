import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RdCrmClient } from "../client/http.js";
import { resourceId, type ApiTask, type ListTasksResponse } from "../client/types.js";
import { runTool } from "../lib/errors.js";
import { clampResponse, paginationFooter, taskLine } from "../lib/format.js";
import { resolveUser } from "../lib/resolve.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";

const TASK_TYPES = ["call", "email", "meeting", "task", "lunch", "visit", "whatsapp"] as const;

const ListTasksSchema = z
  .object({
    deal_id: z.string().optional().describe("Filter tasks of one deal"),
    user_id: z.string().optional().describe("Filter by assignee (user ID)"),
    status: z
      .enum(["pending", "done", "all"])
      .default("pending")
      .describe("Task status (default 'pending')"),
    type: z.enum(TASK_TYPES).optional().describe("Task type filter"),
    due_after: z.string().optional().describe("Tasks due after this date (YYYY-MM-DD)"),
    due_before: z.string().optional().describe("Tasks due before this date (YYYY-MM-DD)"),
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

const CreateTaskSchema = z
  .object({
    deal_id: z.string().min(1).describe("Deal the task belongs to"),
    subject: z.string().min(1).describe("Task subject (e.g. 'Follow-up call')"),
    type: z.enum(TASK_TYPES).default("task").describe("Task type (default 'task')"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format")
      .describe("Due date (YYYY-MM-DD)"),
    hour: z
      .string()
      .regex(/^\d{2}:\d{2}$/, "Use HH:MM format")
      .default("09:00")
      .describe("Due time (HH:MM, default 09:00)"),
    user_id: z.string().optional().describe("Assignee user ID"),
    user: z
      .string()
      .optional()
      .describe(
        "Assignee by email or name (resolved automatically; omit if the account has a single user)",
      ),
    notes: z.string().optional().describe("Extra notes for the task"),
  })
  .strict();

const AddNoteSchema = z
  .object({
    deal_id: z.string().min(1).describe("Deal to annotate"),
    text: z.string().min(1).describe("The note content (plain text)"),
    user_id: z.string().optional().describe("Author user ID"),
    user: z
      .string()
      .optional()
      .describe(
        "Author by email or name (resolved automatically; omit if the account has a single user)",
      ),
  })
  .strict();

export async function listTasks(
  client: RdCrmClient,
  params: z.infer<typeof ListTasksSchema>,
): Promise<string> {
  const res = await client.get<ListTasksResponse>("/tasks", {
    deal_id: params.deal_id,
    user_id: params.user_id,
    done: params.status === "all" ? undefined : params.status === "done" ? "true" : "false",
    type: params.type,
    date_start: params.due_after,
    date_end: params.due_before,
    page: params.page,
    limit: params.limit,
  });
  const tasks = res.tasks ?? [];
  if (tasks.length === 0) {
    return `No ${params.status === "all" ? "" : params.status + " "}tasks found with these filters.`;
  }
  const lines = tasks.map(taskLine);
  const footer = paginationFooter({
    total: res.total ?? tasks.length,
    shown: tasks.length,
    page: params.page,
    hasMore: res.has_more ?? false,
  });
  return clampResponse(`${lines.join("\n")}\n\n${footer}`);
}

export async function createTask(
  client: RdCrmClient,
  params: z.infer<typeof CreateTaskSchema>,
): Promise<string> {
  const user = await resolveUser(client, {
    userId: params.user_id,
    userEmailOrName: params.user,
  });
  const created = await client.post<ApiTask>("/tasks", {
    task: {
      deal_id: params.deal_id,
      subject: params.subject,
      type: params.type,
      date: params.date,
      hour: params.hour,
      user_ids: [resourceId(user)],
      ...(params.notes ? { notes: params.notes } : {}),
    },
  });
  return `Created ${params.type} task '${created.subject ?? params.subject}' (id: ${resourceId(created)}) due ${params.date} ${params.hour}.`;
}

export async function addNote(
  client: RdCrmClient,
  params: z.infer<typeof AddNoteSchema>,
): Promise<string> {
  const user = await resolveUser(client, {
    userId: params.user_id,
    userEmailOrName: params.user,
  });
  await client.post("/activities", {
    activity: {
      deal_id: params.deal_id,
      text: params.text,
      user_id: resourceId(user),
    },
  });
  return `Note added to deal ${params.deal_id}.`;
}

export function registerTaskTools(server: McpServer, client: RdCrmClient): void {
  server.registerTool(
    "rdcrm_list_tasks",
    {
      title: "List RD Station CRM Tasks",
      description: `List tasks with filters: deal, assignee, status (pending/done/all, default pending), type (call, email, meeting, task, lunch, visit, whatsapp) and due-date range.

Returns one line per task: status, subject, id, type, due date, assignee, deal.

Use when: "what are my pending tasks?", "overdue follow-ups this week".`,
      inputSchema: ListTasksSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (params) => runTool(() => listTasks(client, ListTasksSchema.parse(params))),
  );

  server.registerTool(
    "rdcrm_create_task",
    {
      title: "Create RD Station CRM Task",
      description: `Create a task on a deal: subject, type (call, email, meeting, task, lunch, visit, whatsapp), due date and time, assignee.

The assignee can be given by user_id, by email/name in 'user' (resolved automatically), or omitted when the account has a single user.

Use when: "schedule a follow-up call on the Acme deal for Friday 10am".`,
      inputSchema: CreateTaskSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (params) => runTool(() => createTask(client, CreateTaskSchema.parse(params))),
  );

  server.registerTool(
    "rdcrm_add_note",
    {
      title: "Add Note to RD Station CRM Deal",
      description: `Add a text note (annotation) to a deal's timeline.

The author can be given by user_id, by email/name in 'user', or omitted when the account has a single user.

Use when: "note on the Acme deal: client asked for a discount".`,
      inputSchema: AddNoteSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (params) => runTool(() => addNote(client, AddNoteSchema.parse(params))),
  );
}
