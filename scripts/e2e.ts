/**
 * End-to-end smoke test against a real RD Station CRM account.
 * Usage: RDSTATION_CRM_TOKEN=xxx npx tsx scripts/e2e.ts
 * Creates test data (contacts, deals, tasks, notes) — use only on a test account.
 */
import { RdCrmClient } from "../src/client/http.js";
import { searchContacts, getContact, upsertContact } from "../src/tools/contacts.js";
import { listDeals, getDeal, createDeal, updateDeal, closeDeal } from "../src/tools/deals.js";
import { listTasks, createTask, addNote } from "../src/tools/tasks.js";
import { pipelineOverview } from "../src/tools/pipeline.js";

const token = process.env.RDSTATION_CRM_TOKEN;
if (!token) {
  console.error("RDSTATION_CRM_TOKEN required");
  process.exit(1);
}
const client = new RdCrmClient(token);

function idFrom(text: string): string {
  const m = text.match(/id: ([a-f0-9]{24})/);
  if (!m) throw new Error(`No id found in: ${text}`);
  return m[1]!;
}

async function step(name: string, fn: () => Promise<string>): Promise<string> {
  try {
    const out = await fn();
    console.log(`\n=== ${name} ===\n${out}`);
    return out;
  } catch (error) {
    console.log(`\n=== ${name} FAILED ===\n${error instanceof Error ? error.message : error}`);
    throw error;
  }
}

const deals: Array<{
  name: string;
  stage: string;
  value: number;
  email: string;
  contact: string;
}> = [
  {
    name: "Acme Corp - Plano anual",
    stage: "Sem contato",
    value: 8500,
    email: "ana@acmecorp.test",
    contact: "Ana Martins",
  },
  {
    name: "Beta Ltda - Consultoria",
    stage: "Contato feito",
    value: 3200,
    email: "bruno@betaltda.test",
    contact: "Bruno Costa",
  },
  {
    name: "Gamma SA - Licenças",
    stage: "Identificação do interesse",
    value: 6100,
    email: "carla@gammasa.test",
    contact: "Carla Dias",
  },
  {
    name: "Delta ME - Onboarding",
    stage: "Apresentação",
    value: 1500,
    email: "diego@deltame.test",
    contact: "Diego Rocha",
  },
  {
    name: "Epsilon Inc - Expansão",
    stage: "Proposta enviada",
    value: 9900,
    email: "elisa@epsilon.test",
    contact: "Elisa Nunes",
  },
];

const createdDealIds: string[] = [];

// 1. Create 5 deals with contacts across stages
for (const d of deals) {
  const out = await step(`create_deal: ${d.name}`, () =>
    createDeal(client, {
      name: d.name,
      stage_name: d.stage,
      value: d.value,
      rating: 3,
      contact_email: d.email,
      contact_name: d.contact,
    }),
  );
  createdDealIds.push(idFrom(out));
}

// 2. Contacts
await step("upsert_contact (update path)", () =>
  upsertContact(client, {
    email: "ana@acmecorp.test",
    name: "Ana Martins",
    phone: "+55 48 99999-1111",
    title: "Head of Ops",
  }),
);
const search = await step("search_contacts", () =>
  searchContacts(client, { query: "ana", page: 1, limit: 20 }),
);
await step("get_contact", () => getContact(client, { contact_id: idFrom(search) }));

// 3. Deals read + update
await step("list_deals (open)", () =>
  listDeals(client, { status: "open", page: 1, limit: 20 }),
);
await step("get_deal", () => getDeal(client, { deal_id: createdDealIds[0]! }));
await step("update_deal (move stage)", () =>
  updateDeal(client, { deal_id: createdDealIds[0]!, stage_name: "Contato feito" }),
);

// 4. Tasks + notes
await step("create_task", () =>
  createTask(client, {
    deal_id: createdDealIds[1]!,
    subject: "Follow-up call",
    type: "task", // free-plan accounts only allow the basic 'task' type

    date: "2026-08-07",
    hour: "10:00",
  }),
);
await step("list_tasks", () => listTasks(client, { status: "pending", page: 1, limit: 20 }));
await step("add_note", () =>
  addNote(client, {
    deal_id: createdDealIds[1]!,
    text: "Cliente pediu proposta revisada com desconto de 10%.",
  }),
);

// 5. Close deals
await step("close_deal (won)", () =>
  closeDeal(client, { deal_id: createdDealIds[3]!, outcome: "won" }),
);
await step("close_deal (lost)", () =>
  closeDeal(client, {
    deal_id: createdDealIds[4]!,
    outcome: "lost",
    note: "Escolheu concorrente",
  }),
);

// 6. Overview
await step("pipeline_overview", () =>
  pipelineOverview(client, { stalled_days: 14, closed_period_days: 30 }),
);

console.log("\nALL STEPS PASSED");
