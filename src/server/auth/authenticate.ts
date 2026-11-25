import { sql } from "drizzle-orm";

import { type Database, getDb } from "@/server/db/client";
import { unauthenticated } from "@/server/http/errors";
import { describeError } from "@/server/http/safe-error";
import { type AccountRow, findAccountById } from "@/server/services/accounts";
import { loadAgentActor } from "@/server/services/agents";

import { type AgentActor, type HumanActor, humanActor } from "./actor";
import { parseBearer, secretMatches } from "./api-token";
import { getAuth } from "./auth";

/** A person, by the session cookie. */
export interface SessionAuthenticated {
  via: "session";
  actor: HumanActor;
  account: AccountRow;
  /** The id of the session row the cookie belongs to (WS-021 keeps it on a password change). */
  sessionId: string;
  /** `Set-Cookie` headers Better Auth produced, for example when it extends the session. */
  headers: Headers;
}

/** An agent, by an API token (WS-072). */
export interface TokenAuthenticated {
  via: "token";
  actor: AgentActor;
  account: AccountRow;
  /** The `api_tokens` row: what the per-token rate limit counts. */
  tokenId: string;
  /** Always empty: a token request sets no cookie. */
  headers: Headers;
}

export type Authenticated = SessionAuthenticated | TokenAuthenticated;

export interface AuthenticateOptions {
  db?: Database;
  /** Records a token's use (section 5 of WS-072); replaced in tests. */
  recordTokenUse?: (db: Database, tokenId: string, accountId: string) => Promise<void>;
  logError?: (line: string) => void;
  /**
   * `false` checks a session without extending it, for the event stream's heartbeats
   * (WS-124): only requests a person makes keep a session alive. A token is never renewed.
   */
  refreshSession?: boolean;
}

/**
 * Turns a request into the `Actor` that made it, or throws `401`. The only place that reads
 * the session cookie or an API token. `401` never says why.
 *
 * An `Authorization` header means "token only" (canonical doc 0004 section 7): the cookie is
 * then never read.
 */
export async function authenticate(
  request: Request,
  options: AuthenticateOptions = {},
): Promise<Authenticated> {
  const authorization = request.headers.get("Authorization");
  if (authorization !== null) {
    return authenticateToken(authorization, options);
  }

  const { headers, response } = await getAuth().api.getSession({
    headers: request.headers,
    query: { disableRefresh: options.refreshSession === false },
    returnHeaders: true,
  });
  if (response === null) {
    throw unauthenticated();
  }

  const account = await findAccountById(options.db ?? getDb(), response.user.id);
  if (account?.disabledAt !== null) {
    throw unauthenticated();
  }

  // humanActor throws for a stored role that is not a human role: never a default.
  return {
    via: "session",
    actor: humanActor({ accountId: account.id, role: account.role as HumanActor["role"] }),
    account,
    sessionId: response.session.id,
    headers,
  };
}

interface TokenRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  secret_hash: string;
  usable: boolean;
}

async function authenticateToken(
  authorization: string,
  { db: given, recordTokenUse = recordUse, logError = console.error }: AuthenticateOptions,
): Promise<TokenAuthenticated> {
  // A malformed header costs nothing: no database access (WS-072 section 3).
  const parsed = parseBearer(authorization);
  if (parsed === null) throw unauthenticated();

  const db = given ?? getDb();
  const [row] = await db.execute<TokenRow>(sql`
    select id, account_id, secret_hash,
      revoked_at is null and (expires_at is null or expires_at > now()) as usable
    from api_tokens where public_id = ${parsed.publicId}`);
  if (!row || !secretMatches(parsed.secret, row.secret_hash) || !row.usable) {
    throw unauthenticated();
  }

  const agent = await loadAgentActor(db, row.account_id);
  const account = await findAccountById(db, row.account_id);
  if (agent?.disabledAt !== null || account === undefined) {
    throw unauthenticated();
  }

  try {
    await recordTokenUse(db, row.id, account.id);
  } catch (error) {
    // Bookkeeping only: the caller is authenticated (WS-072 question 2).
    logError(`Recording an API token's use failed: ${describeError(error)}`);
  }

  return { via: "token", actor: agent.actor, account, tokenId: row.id, headers: new Headers() };
}

/** `last_used_at` and `last_seen_at`, each at most once a minute (WT-05 decision 6). */
async function recordUse(db: Database, tokenId: string, accountId: string): Promise<void> {
  await db.execute(sql`
    update api_tokens set last_used_at = now()
    where id = ${tokenId}
      and (last_used_at is null or last_used_at < now() - interval '1 minute')`);
  await db.execute(sql`
    update accounts set last_seen_at = now()
    where id = ${accountId}
      and (last_seen_at is null or last_seen_at < now() - interval '1 minute')`);
}
