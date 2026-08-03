import type { RdCrmClient } from "../client/http.js";
import {
  resourceId,
  type ApiPipeline,
  type ApiUser,
  type ListLostReasonsResponse,
  type ListPipelinesResponse,
  type ListUsersResponse,
} from "../client/types.js";
import { ToolInputError } from "./errors.js";

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export async function fetchPipelines(client: RdCrmClient): Promise<ApiPipeline[]> {
  const res = await client.get<ListPipelinesResponse>("/deal_pipelines", { limit: 200 });
  return Array.isArray(res) ? res : [];
}

export interface ResolvedStage {
  pipeline: ApiPipeline;
  stageId: string;
  stageName: string;
}

/**
 * Resolve a stage from `stage_id`, or from `stage_name` (+ optional `pipeline_name`).
 * Errors list the valid options so the model can self-correct.
 */
export async function resolveStage(
  client: RdCrmClient,
  opts: { stageId?: string; stageName?: string; pipelineName?: string },
): Promise<ResolvedStage> {
  const pipelines = await fetchPipelines(client);
  if (pipelines.length === 0) {
    throw new ToolInputError("No sales pipelines found in this RD Station CRM account.");
  }

  if (opts.stageId) {
    for (const pipeline of pipelines) {
      const stage = pipeline.deal_stages?.find((s) => resourceId(s) === opts.stageId);
      if (stage) {
        return { pipeline, stageId: opts.stageId, stageName: stage.name };
      }
    }
    throw new ToolInputError(
      `Stage id '${opts.stageId}' not found. ${describePipelines(pipelines)}`,
    );
  }

  if (!opts.stageName) {
    throw new ToolInputError(
      `Provide either stage_id or stage_name. ${describePipelines(pipelines)}`,
    );
  }

  const candidatePipelines = opts.pipelineName
    ? pipelines.filter((p) => norm(p.name) === norm(opts.pipelineName as string))
    : pipelines;
  if (opts.pipelineName && candidatePipelines.length === 0) {
    throw new ToolInputError(
      `Pipeline '${opts.pipelineName}' not found. Available pipelines: ${pipelines
        .map((p) => p.name)
        .join(", ")}.`,
    );
  }

  const matches: ResolvedStage[] = [];
  for (const pipeline of candidatePipelines) {
    for (const stage of pipeline.deal_stages ?? []) {
      if (norm(stage.name) === norm(opts.stageName)) {
        matches.push({ pipeline, stageId: resourceId(stage), stageName: stage.name });
      }
    }
  }

  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new ToolInputError(
      `Stage '${opts.stageName}' exists in more than one pipeline (${matches
        .map((m) => m.pipeline.name)
        .join(", ")}). Pass pipeline_name to disambiguate.`,
    );
  }
  throw new ToolInputError(
    `Stage '${opts.stageName}' not found. ${describePipelines(candidatePipelines)}`,
  );
}

export function describePipelines(pipelines: ApiPipeline[]): string {
  const lines = pipelines.map(
    (p) =>
      `${p.name}: ${(p.deal_stages ?? [])
        .map((s) => `${s.name} (id: ${resourceId(s)})`)
        .join(" -> ")}`,
  );
  return `Available stages by pipeline:\n${lines.join("\n")}`;
}

/**
 * Resolve a CRM user by id, email or name. With no hint: only succeeds when the
 * account has a single user; otherwise lists users so the model can pick one.
 */
export async function resolveUser(
  client: RdCrmClient,
  opts: { userId?: string; userEmailOrName?: string },
): Promise<ApiUser> {
  if (opts.userId) return { _id: opts.userId };

  const res = await client.get<ListUsersResponse>("/users", { limit: 200 });
  const users = res.users ?? [];
  if (users.length === 0) {
    throw new ToolInputError("No users found in this RD Station CRM account.");
  }

  if (!opts.userEmailOrName) {
    if (users.length === 1) return users[0]!;
    throw new ToolInputError(
      `Multiple users exist — specify user with user_id or user (email/name). ${listUsers(users)}`,
    );
  }

  const needle = norm(opts.userEmailOrName);
  const matches = users.filter(
    (u) =>
      norm(u.email ?? "") === needle ||
      norm(u.name ?? "") === needle ||
      norm(u.name ?? "").includes(needle),
  );
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new ToolInputError(
      `More than one user matches '${opts.userEmailOrName}'. ${listUsers(matches)} Use user_id or the full email.`,
    );
  }
  throw new ToolInputError(`No user matches '${opts.userEmailOrName}'. ${listUsers(users)}`);
}

function listUsers(users: ApiUser[]): string {
  return `Users: ${users
    .map((u) => `${u.name ?? "?"} <${u.email ?? "?"}> (id: ${resourceId(u)})`)
    .join("; ")}.`;
}

/** Resolve a lost reason by id or (partial) name, listing options on miss. */
export async function resolveLostReason(
  client: RdCrmClient,
  opts: { reasonId?: string; reasonName?: string },
): Promise<string | undefined> {
  if (opts.reasonId) return opts.reasonId;
  if (!opts.reasonName) return undefined;

  const res = await client.get<ListLostReasonsResponse>("/deal_lost_reasons", {
    limit: 200,
  });
  const reasons = res.deal_lost_reasons ?? [];
  const needle = norm(opts.reasonName);
  const matches = reasons.filter((r) => norm(r.name).includes(needle));
  if (matches.length === 1) return resourceId(matches[0]!);
  const options = reasons.map((r) => `${r.name} (id: ${resourceId(r)})`).join("; ");
  if (matches.length > 1) {
    throw new ToolInputError(
      `More than one lost reason matches '${opts.reasonName}'. Options: ${options}.`,
    );
  }
  throw new ToolInputError(`Lost reason '${opts.reasonName}' not found. Options: ${options}.`);
}
