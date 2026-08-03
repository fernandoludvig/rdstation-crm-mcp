import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RdCrmClient } from "../client/http.js";
import { resourceId, type ApiContact, type ListContactsResponse } from "../client/types.js";
import { runTool, ToolInputError } from "../lib/errors.js";
import { clampResponse, contactLine, paginationFooter, shortDate } from "../lib/format.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";

const SearchContactsSchema = z
  .object({
    query: z.string().min(1).optional().describe("Partial name to search for (e.g. 'maria')"),
    email: z.string().optional().describe("Exact email address to filter by"),
    phone: z.string().optional().describe("Exact phone number to filter by"),
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

const GetContactSchema = z
  .object({
    contact_id: z.string().min(1).describe("Contact ID (from rdcrm_search_contacts)"),
  })
  .strict();

const UpsertContactSchema = z
  .object({
    email: z
      .string()
      .email()
      .describe("Contact email. Used to find an existing contact before creating a new one"),
    name: z.string().min(1).describe("Contact full name"),
    phone: z.string().optional().describe("Phone number (e.g. '+55 48 99999-0000')"),
    title: z.string().optional().describe("Job title (e.g. 'Head of Sales')"),
    notes: z.string().optional().describe("Free-form notes about the contact"),
  })
  .strict();

export async function searchContacts(
  client: RdCrmClient,
  params: z.infer<typeof SearchContactsSchema>,
): Promise<string> {
  const res = await client.get<ListContactsResponse>("/contacts", {
    q: params.query,
    email: params.email,
    phone: params.phone,
    page: params.page,
    limit: params.limit,
  });
  const contacts = res.contacts ?? [];
  if (contacts.length === 0) {
    const criteria = [params.query, params.email, params.phone].filter(Boolean).join(", ");
    return `No contacts found${criteria ? ` matching '${criteria}'` : ""}. Try a shorter partial name in 'query', or create the contact with rdcrm_upsert_contact.`;
  }
  const lines = contacts.map(contactLine);
  const footer = paginationFooter({
    total: res.total ?? contacts.length,
    shown: contacts.length,
    page: params.page,
    hasMore: res.has_more ?? false,
  });
  return clampResponse(`${lines.join("\n")}\n\n${footer}`);
}

export async function getContact(
  client: RdCrmClient,
  params: z.infer<typeof GetContactSchema>,
): Promise<string> {
  const contact = await client.get<ApiContact>(`/contacts/${params.contact_id}`);
  const lines = [
    `# ${contact.name} (id: ${resourceId(contact)})`,
    `Emails: ${contact.emails?.map((e) => e.email).join(", ") || "-"}`,
    `Phones: ${contact.phones?.map((p) => p.phone).join(", ") || "-"}`,
    `Title: ${contact.title ?? "-"}`,
    `Created: ${shortDate(contact.created_at)} | Updated: ${shortDate(contact.updated_at)}`,
  ];
  if (contact.notes) lines.push(`Notes: ${contact.notes}`);
  const deals = contact.deals ?? [];
  if (deals.length > 0) {
    lines.push("", `Deals (${deals.length}):`);
    for (const deal of deals) {
      const status = deal.win === true ? "won" : deal.win === false ? "lost" : "open";
      lines.push(`- ${deal.name} (id: ${resourceId(deal)}) | status: ${status}`);
    }
  } else {
    lines.push("", "No deals linked to this contact.");
  }
  return clampResponse(lines.join("\n"));
}

export async function upsertContact(
  client: RdCrmClient,
  params: z.infer<typeof UpsertContactSchema>,
): Promise<string> {
  const existing = await client.get<ListContactsResponse>("/contacts", {
    email: params.email,
    limit: 2,
  });
  const matches = existing.contacts ?? [];
  if (matches.length > 1) {
    throw new ToolInputError(
      `More than one contact already uses '${params.email}': ${matches
        .map((c) => `${c.name} (id: ${resourceId(c)})`)
        .join(
          "; ",
        )}. Update a specific one is not supported by upsert — check the duplicates in the CRM.`,
    );
  }

  const payload = {
    contact: {
      name: params.name,
      emails: [{ email: params.email }],
      ...(params.phone ? { phones: [{ phone: params.phone, type: "cellphone" }] } : {}),
      ...(params.title ? { title: params.title } : {}),
      ...(params.notes ? { notes: params.notes } : {}),
    },
  };

  if (matches.length === 1) {
    const id = resourceId(matches[0]!);
    const updated = await client.put<ApiContact>(`/contacts/${id}`, payload);
    return `Updated existing contact '${updated.name ?? params.name}' (id: ${resourceId(updated) || id}).`;
  }
  const created = await client.post<ApiContact>("/contacts", payload);
  return `Created contact '${created.name ?? params.name}' (id: ${resourceId(created)}).`;
}

export function registerContactTools(server: McpServer, client: RdCrmClient): void {
  server.registerTool(
    "rdcrm_search_contacts",
    {
      title: "Search RD Station CRM Contacts",
      description: `Search contacts in RD Station CRM by partial name, exact email or exact phone.

Returns one line per contact: name, id, primary email, primary phone, job title. Use the returned id with rdcrm_get_contact for full details (including linked deals).

Use when: "find Maria's contact", "do we have someone with email x@y.com?".
Don't use when: you want to create or edit a contact (use rdcrm_upsert_contact).`,
      inputSchema: SearchContactsSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (params) => runTool(() => searchContacts(client, SearchContactsSchema.parse(params))),
  );

  server.registerTool(
    "rdcrm_get_contact",
    {
      title: "Get RD Station CRM Contact",
      description: `Get full details of one contact by ID: all emails and phones, title, notes, and the deals linked to the contact with their status (open/won/lost).

Get the contact ID from rdcrm_search_contacts first.`,
      inputSchema: GetContactSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (params) => runTool(() => getContact(client, GetContactSchema.parse(params))),
  );

  server.registerTool(
    "rdcrm_upsert_contact",
    {
      title: "Create or Update RD Station CRM Contact",
      description: `Create a contact, or update it if one already exists with the given email (matched by exact email).

Provide at least email and name. Phone, job title and notes are optional. Returns the contact id.

Use when: "add João (joao@acme.com) to the CRM", "update Maria's phone".`,
      inputSchema: UpsertContactSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => runTool(() => upsertContact(client, UpsertContactSchema.parse(params))),
  );
}
