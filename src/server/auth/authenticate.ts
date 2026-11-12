import { getDb } from "@/server/db/client";
import { unauthenticated } from "@/server/http/errors";
import { type AccountRow, findAccountById } from "@/server/services/accounts";

import { type Actor, humanActor } from "./actor";
import { getAuth } from "./auth";

export interface Authenticated {
  actor: Actor;
  account: AccountRow;
  /** `Set-Cookie` headers Better Auth produced, for example when it extends the session. */
  headers: Headers;
}

/**
 * Turns a request into the `Actor` that made it, or throws `401`. The only place that reads
 * the session cookie. `401` never says why.
 *
 * An `Authorization` header means "token only" (canonical doc 0004 section 7). Agent tokens
 * do not exist yet (WT-05), so such a request is rejected, and the cookie is not tried.
 */
export async function authenticate(request: Request): Promise<Authenticated> {
  if (request.headers.has("Authorization")) {
    throw unauthenticated();
  }

  const { headers, response } = await getAuth().api.getSession({
    headers: request.headers,
    returnHeaders: true,
  });
  if (response === null) {
    throw unauthenticated();
  }

  const account = await findAccountById(getDb(), response.user.id);
  if (account?.disabledAt !== null) {
    throw unauthenticated();
  }

  // humanActor throws for a stored role that is not a human role: never a default.
  return {
    actor: humanActor({ accountId: account.id, role: account.role as Actor["role"] }),
    account,
    headers,
  };
}
