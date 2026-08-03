import { CHARACTER_LIMIT } from "../constants.js";
import { resourceId, type ApiContact, type ApiDeal, type ApiTask } from "../client/types.js";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function money(value: number | undefined): string {
  return BRL.format(value ?? 0);
}

/** "2026-08-03T14:22:00.000Z" -> "2026-08-03" */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return iso.slice(0, 10);
}

export function dealStatus(deal: ApiDeal): string {
  if (deal.win === true) return "won";
  if (deal.win === false) return "lost";
  if (deal.hold) return "on hold";
  return "open";
}

/** One-line summary of a deal for list views. */
export function dealLine(deal: ApiDeal): string {
  const parts = [
    `- ${deal.name} (id: ${resourceId(deal)})`,
    `stage: ${deal.deal_stage?.name ?? "-"}`,
    `value: ${money(deal.amount_total)}`,
    `status: ${dealStatus(deal)}`,
    `owner: ${deal.user?.name ?? "-"}`,
    `updated: ${shortDate(deal.updated_at)}`,
  ];
  return parts.join(" | ");
}

/** One-line summary of a contact for list views. */
export function contactLine(contact: ApiContact): string {
  const email = contact.emails?.[0]?.email ?? "-";
  const phone = contact.phones?.[0]?.phone ?? "-";
  const parts = [
    `- ${contact.name} (id: ${resourceId(contact)})`,
    `email: ${email}`,
    `phone: ${phone}`,
  ];
  if (contact.title) parts.push(`title: ${contact.title}`);
  return parts.join(" | ");
}

/** One-line summary of a task for list views. */
export function taskLine(task: ApiTask): string {
  const who =
    task.users
      ?.map((u) => u.name)
      .filter(Boolean)
      .join(", ") || "-";
  const parts = [
    `- [${task.done ? "done" : "pending"}] ${task.subject} (id: ${resourceId(task)})`,
    `type: ${task.type ?? "-"}`,
    `due: ${shortDate(task.date)}${task.hour ? ` ${task.hour}` : ""}`,
    `assignee: ${who}`,
  ];
  if (task.deal?.name) parts.push(`deal: ${task.deal.name}`);
  return parts.join(" | ");
}

export interface PageInfo {
  total: number;
  shown: number;
  page: number;
  hasMore: boolean;
}

export function paginationFooter({ total, shown, page, hasMore }: PageInfo): string {
  if (!hasMore) return `Showing ${shown} of ${total} results.`;
  return `Showing ${shown} of ${total} results (page ${page}). Pass page=${page + 1} to see more.`;
}

/** Enforce the global character limit with an explicit truncation notice. */
export function clampResponse(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    "\n\n[Response truncated. Use filters (pipeline, stage, dates) or a smaller limit to narrow the results.]"
  );
}
