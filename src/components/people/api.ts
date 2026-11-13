import {
  accountPageSchema,
  type InviteRequest,
  inviteResponseSchema,
  managedAccountSchema,
  resetLinkResponseSchema,
  type UpdateAccountRequest,
} from "@/lib/schemas/accounts";
import { type FieldError, problemSchema } from "@/lib/schemas/problem";

/** A non-2xx answer of the API, reduced to what the screen needs. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly errors: readonly FieldError[],
  ) {
    super(`The API answered ${String(status)}.`);
    this.name = "ApiFailure";
  }
}

async function call<Schema extends { parse: (value: unknown) => unknown }>(
  url: string,
  init: RequestInit,
  schema: Schema,
): Promise<ReturnType<Schema["parse"]>> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = problemSchema.safeParse(body);
    throw new ApiFailure(
      response.status,
      problem.success ? problem.data.code : null,
      problem.success ? (problem.data.errors ?? []) : [],
    );
  }
  return schema.parse(body) as ReturnType<Schema["parse"]>;
}

function jsonBody(body: unknown): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const PAGE_SIZE = 50;

export function listAccounts(cursor?: string) {
  const query = `limit=${String(PAGE_SIZE)}${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
  return call(`/api/v1/accounts?${query}`, {}, accountPageSchema);
}

export function inviteAccount(body: InviteRequest) {
  return call("/api/v1/accounts", { method: "POST", ...jsonBody(body) }, inviteResponseSchema);
}

export function updateAccount(accountId: string, body: UpdateAccountRequest) {
  return call(
    `/api/v1/accounts/${accountId}`,
    { method: "PATCH", ...jsonBody(body) },
    managedAccountSchema,
  );
}

export function createLink(accountId: string) {
  return call(
    `/api/v1/accounts/${accountId}/reset-link`,
    { method: "POST" },
    resetLinkResponseSchema,
  );
}
