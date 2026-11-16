import { ApiFailure, call, callNoContent, jsonBody } from "@/lib/api-client";
import {
  accountPageSchema,
  type InviteRequest,
  inviteResponseSchema,
  managedAccountSchema,
  resetLinkResponseSchema,
  type UpdateAccountRequest,
} from "@/lib/schemas/accounts";

export { ApiFailure };

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

/** Takes back an invitation that was never accepted (WS-024). Answers 204, no body. */
export function revokeInvitation(accountId: string): Promise<void> {
  return callNoContent(`/api/v1/accounts/${accountId}/invitation`, { method: "DELETE" });
}
