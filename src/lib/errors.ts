import { RdCrmApiError } from "../client/http.js";

/**
 * Convert any error into a message that helps the LLM take the next step,
 * instead of a raw stack trace or status code.
 */
export function toToolError(error: unknown): string {
  if (error instanceof RdCrmApiError) {
    switch (error.status) {
      case 401:
        return "Error: Authentication failed (401). Check that RDSTATION_CRM_TOKEN is set to a valid instance token. Find it in RD Station CRM under Profile > Products and integrations > Instance token.";
      case 403: {
        const apiMessage = extractApiMessage(error.responseBody);
        return `Error: The account's plan does not allow this operation (403).${apiMessage ? ` API says: ${apiMessage}.` : ""} This usually means a paid-plan feature (e.g. task types other than 'task' on the free plan). Try a simpler variant of the request.`;
      }
      case 404:
        return "Error: Resource not found (404). The ID may be wrong or the record was deleted. Use the corresponding list/search tool to find valid IDs.";
      case 422: {
        const detail = error.responseBody
          ? ` API detail: ${error.responseBody.slice(0, 500)}`
          : "";
        return `Error: The API rejected the request (422 unprocessable entity). A required field may be missing or invalid.${detail}`;
      }
      case 429:
        return "Error: Rate limit exceeded (429) even after retries. Wait a minute before trying again, or reduce the amount of parallel requests.";
      default: {
        const detail = error.responseBody ? ` Detail: ${error.responseBody.slice(0, 300)}` : "";
        return `Error: RD Station CRM API request failed with status ${error.status}.${detail}`;
      }
    }
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return "Error: Request to RD Station CRM timed out after 30s. Try again or narrow the query.";
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

/** Pull error_message strings out of the API's JSON error envelope. */
function extractApiMessage(body: string | undefined): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as {
      errors?: Array<{ error_message?: string }>;
      error?: string;
    };
    if (Array.isArray(parsed.errors)) {
      const messages = parsed.errors
        .map((e) => e.error_message)
        .filter((m): m is string => Boolean(m));
      if (messages.length > 0) return messages.join("; ");
    }
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // not JSON — fall through
  }
  return body.slice(0, 200);
}

/** Wrap a tool handler body: returns the result or an actionable error string. */
export async function runTool(fn: () => Promise<string>): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  try {
    const text = await fn();
    return { content: [{ type: "text", text }] };
  } catch (error) {
    return { content: [{ type: "text", text: toToolError(error) }], isError: true };
  }
}

/** Error thrown by tools with a message already written for the LLM. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}
