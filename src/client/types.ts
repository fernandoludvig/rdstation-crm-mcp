/**
 * Types for the RD Station CRM v1 API.
 * Docs: https://developers.rdstation.com/reference/crm-v1-introducao-e-requisitos
 *
 * Note: the API returns both `_id` and `id` on most resources (same value).
 * We read `_id` and fall back to `id`.
 */

export interface ApiEmail {
  email: string;
}

export interface ApiPhone {
  phone: string;
  type?: string;
  whatsapp?: boolean;
}

export interface ApiContact {
  _id?: string;
  id?: string;
  name: string;
  title?: string | null;
  emails?: ApiEmail[];
  phones?: ApiPhone[];
  organization_id?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  deals?: Array<{
    _id?: string;
    id?: string;
    name: string;
    win?: boolean | null;
    closed_at?: string | null;
  }>;
}

export interface ApiDealStage {
  _id?: string;
  id?: string;
  name: string;
  nickname?: string;
  order?: number;
}

export interface ApiUser {
  _id?: string;
  id?: string;
  name?: string;
  email?: string;
  nickname?: string;
  active?: boolean;
}

export interface ApiDealProduct {
  _id?: string;
  id?: string;
  name: string;
  price?: number;
  amount?: number;
  total?: number;
}

export interface ApiDeal {
  _id?: string;
  id?: string;
  name: string;
  amount_total?: number;
  amount_unique?: number;
  amount_montly?: number; // sic — API field is misspelled
  rating?: number;
  win?: boolean | null;
  hold?: boolean | null;
  closed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  last_activity_at?: string | null;
  prediction_date?: string | null;
  interactions?: number;
  deal_stage?: ApiDealStage;
  user?: ApiUser;
  contacts?: ApiContact[];
  deal_products?: ApiDealProduct[];
  deal_lost_reason?: { _id?: string; name?: string } | null;
}

export interface ApiPipeline {
  _id?: string;
  id?: string;
  name: string;
  order?: number;
  deal_stages?: ApiDealStage[];
}

export interface ApiTask {
  _id?: string;
  id?: string;
  subject: string;
  type?: string;
  date?: string;
  hour?: string;
  done?: boolean;
  done_date?: string | null;
  notes?: string | null;
  deal_id?: string;
  deal?: { _id?: string; id?: string; name?: string };
  users?: ApiUser[];
  created_at?: string;
}

export interface ApiLostReason {
  _id?: string;
  id?: string;
  name: string;
}

export interface ListDealsResponse {
  deals: ApiDeal[];
  total: number;
  has_more: boolean;
  next_page?: string;
}

export interface ListContactsResponse {
  contacts: ApiContact[];
  total: number;
  has_more: boolean;
}

export interface ListTasksResponse {
  tasks: ApiTask[];
  total: number;
  has_more: boolean;
}

export interface ListLostReasonsResponse {
  deal_lost_reasons: ApiLostReason[];
  total: number;
  has_more: boolean;
}

/** GET /deal_pipelines returns a bare array. */
export type ListPipelinesResponse = ApiPipeline[];

export interface ListUsersResponse {
  users: ApiUser[];
}

/** Resource id: the API duplicates `_id`/`id`; prefer `_id`. */
export function resourceId(r: { _id?: string; id?: string }): string {
  return r._id ?? r.id ?? "";
}
