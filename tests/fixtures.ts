import type { ApiContact, ApiDeal, ApiPipeline, ApiUser } from "../src/client/types.js";

export const TOKEN = "test-token";

export const pipelines: ApiPipeline[] = [
  {
    _id: "pipe1",
    name: "Vendas",
    deal_stages: [
      { _id: "stage1", name: "Qualificação", order: 1 },
      { _id: "stage2", name: "Proposta", order: 2 },
      { _id: "stage3", name: "Negociação", order: 3 },
    ],
  },
];

export const users: ApiUser[] = [
  { _id: "user1", name: "Fernando Ludvig", email: "fernando@example.com" },
  { _id: "user2", name: "Maria Silva", email: "maria@example.com" },
];

export function makeDeal(overrides: Partial<ApiDeal> = {}): ApiDeal {
  return {
    _id: "deal1",
    name: "Acme Corp - Annual plan",
    amount_total: 5000,
    rating: 3,
    win: null,
    created_at: "2026-07-01T10:00:00.000Z",
    updated_at: "2026-07-20T10:00:00.000Z",
    deal_stage: { _id: "stage1", name: "Qualificação" },
    user: { _id: "user1", name: "Fernando Ludvig", email: "fernando@example.com" },
    ...overrides,
  };
}

export function makeContact(overrides: Partial<ApiContact> = {}): ApiContact {
  return {
    _id: "contact1",
    name: "João Souza",
    emails: [{ email: "joao@acme.com" }],
    phones: [{ phone: "+55 48 99999-0000", type: "cellphone" }],
    title: "CEO",
    created_at: "2026-06-01T10:00:00.000Z",
    updated_at: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}
