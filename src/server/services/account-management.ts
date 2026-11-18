import { and, count, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";

import type {
  AccountLink,
  AccountPage,
  InviteRequest,
  ManagedAccount,
  UpdateAccountRequest,
} from "@/lib/schemas/accounts";
import { type Actor, requirePermission } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { accounts, accountTokens, credentials, sessions } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { conflict, lastAdmin, notFound } from "@/server/http/errors";
import { decodeCursor, encodeCursor } from "@/server/http/pagination";

import { issueLink, type LinkKind, lockAccount } from "./account-tokens";
import { findAccountByEmail } from "./accounts";
import { recordAudit } from "./audit";

// Serialises every change that can reduce the number of active Admins. Rare actions by
// Admins, so one coarse lock is the simplest thing that is provably right (WS-018).
const ADMIN_CHANGE_LOCK_KEY = 7_201_018;

interface ManagedRow extends Record<string, unknown> {
  id: string;
  name: string;
  email: string;
  role: string;
  disabled: boolean;
  has_password: boolean;
  created_at: string;
  last_seen_at: string | null;
  cursor_time: string;
}

const ISO_MS = sql`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const ISO_US = sql`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

/** The columns of the people list. Timestamps are formatted here, so no `Date` is involved. */
const MANAGED_COLUMNS = sql`
  a.id, a.name, a.email, a.role,
  a.disabled_at is not null as disabled,
  exists (select 1 from credentials c
          where c.account_id = a.id and c.password_hash is not null) as has_password,
  to_char(a.created_at at time zone 'utc', ${ISO_MS}) as created_at,
  to_char(a.last_seen_at at time zone 'utc', ${ISO_MS}) as last_seen_at,
  to_char(a.created_at at time zone 'utc', ${ISO_US}) as cursor_time`;

function toManaged(row: ManagedRow): ManagedAccount {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as ManagedAccount["role"],
    status: row.disabled ? "deactivated" : row.has_password ? "active" : "invited",
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

async function loadManaged(
  executor: Pick<Database, "execute">,
  id: string,
): Promise<ManagedAccount> {
  const rows = await executor.execute<ManagedRow>(
    sql`select ${MANAGED_COLUMNS} from accounts a where a.kind = 'human' and a.id = ${id}`,
  );
  const row = rows[0];
  if (!row) {
    throw notFound();
  }
  return toManaged(row);
}

function linkUrl(token: string): string {
  return `${new URL(getEnv().APP_URL).origin}/accept#${token}`;
}

function toLink(link: { token: string; expiresAt: Date }): AccountLink {
  return { url: linkUrl(link.token), expiresAt: link.expiresAt.toISOString() };
}

/** Human accounts, oldest first, with a keyset cursor (canonical doc 0004 section 5). */
export async function listAccounts(
  actor: Actor,
  query: { limit: number; cursor?: string | undefined },
  db: Database = getDb(),
): Promise<AccountPage> {
  requirePermission(actor, "accounts:manage");
  const after =
    query.cursor === undefined
      ? sql``
      : (() => {
          const cursor = decodeCursor(query.cursor);
          return sql`and (a.created_at, a.id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`;
        })();

  const rows = await db.execute<ManagedRow>(sql`
    select ${MANAGED_COLUMNS} from accounts a
    where a.kind = 'human' ${after}
    order by a.created_at, a.id
    limit ${query.limit + 1}`);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toManaged),
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ createdAt: last.cursor_time, id: last.id })
        : null,
  };
}

/**
 * Creates an account with no password and a one-time invitation link. The account, the link
 * and the audit entry commit together.
 */
export async function inviteAccount(
  actor: Actor,
  input: InviteRequest,
  db: Database = getDb(),
): Promise<{ account: ManagedAccount; link: AccountLink }> {
  requirePermission(actor, "accounts:manage");

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(accounts)
      .values({
        kind: "human",
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role: input.role,
        createdBy: actor.accountId,
      })
      .onConflictDoNothing({ target: accounts.email })
      .returning({ id: accounts.id });
    if (!row) {
      throw conflict("An account with this email already exists.");
    }
    const link = await issueLink(tx, {
      accountId: row.id,
      kind: "invitation",
      createdBy: actor.accountId,
    });
    await recordAudit(tx, {
      actor,
      action: "account.invited",
      entity: "account",
      entityId: row.id,
      data: { role: input.role },
    });
    return { id: row.id, link };
  });

  return { account: await loadManaged(db, created.id), link: toLink(created.link) };
}

/**
 * Changes an account's role and/or deactivates or reactivates it. Ending the sessions,
 * deleting unused links and writing the audit entries happen in the same transaction. The
 * only active Admin cannot be demoted or deactivated: the check runs under a lock, so two
 * Admins who demote each other at the same moment cannot both succeed.
 */
export async function updateAccount(
  actor: Actor,
  accountId: string,
  input: UpdateAccountRequest,
  db: Database = getDb(),
): Promise<ManagedAccount> {
  requirePermission(actor, "accounts:manage");

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_CHANGE_LOCK_KEY})`);
    // Serialises with issuing and accepting a link (WS-059): a link issued just before a
    // deactivation is deleted by it, one issued after it is refused.
    await lockAccount(tx, accountId);
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.kind, "human")))
      .limit(1);
    if (!account) {
      throw notFound();
    }

    const wasActive = account.disabledAt === null;
    const roleChanged = input.role !== undefined && input.role !== account.role;
    const deactivating = input.active === false && wasActive;
    const reactivating = input.active === true && !wasActive;

    const losesAdmin =
      account.role === "admin" &&
      wasActive &&
      ((roleChanged && input.role !== "admin") || deactivating);
    if (losesAdmin) {
      const [others] = await tx
        .select({ n: count() })
        .from(accounts)
        .where(
          and(
            eq(accounts.kind, "human"),
            eq(accounts.role, "admin"),
            isNull(accounts.disabledAt),
            ne(accounts.id, accountId),
            // Only an Admin who can sign in counts: an invited one may never accept (WS-024).
            sql`exists (select 1 from ${credentials} c
                        where c.account_id = ${accounts.id} and c.password_hash is not null)`,
          ),
        );
      if ((others?.n ?? 0) === 0) {
        throw lastAdmin();
      }
    }

    if (!roleChanged && !deactivating && !reactivating) {
      return;
    }

    await tx
      .update(accounts)
      .set({
        updatedAt: new Date(),
        ...(roleChanged ? { role: input.role } : {}),
        ...(deactivating ? { disabledAt: new Date() } : {}),
        ...(reactivating ? { disabledAt: null } : {}),
      })
      .where(eq(accounts.id, accountId));

    if (roleChanged || deactivating) {
      await tx.delete(sessions).where(eq(sessions.accountId, accountId));
    }
    if (deactivating) {
      await tx
        .delete(accountTokens)
        .where(and(eq(accountTokens.accountId, accountId), isNull(accountTokens.usedAt)));
    }

    const target = { actor, entity: "account", entityId: accountId } as const;
    if (roleChanged) {
      await recordAudit(tx, {
        ...target,
        action: "account.role_changed",
        data: { from: account.role, to: input.role },
      });
    }
    if (deactivating) {
      await recordAudit(tx, { ...target, action: "account.deactivated" });
    }
    if (reactivating) {
      await recordAudit(tx, { ...target, action: "account.reactivated" });
    }
  });

  return loadManaged(db, accountId);
}

/**
 * The core of issuing a link, shared by an Admin (`issueResetLink`) and the operator
 * (`issueOperatorResetLink`), so the two cannot drift: an invitation for an account that has
 * no password yet, a reset link for one that has. Runs in the caller's transaction, after
 * the account lock.
 */
async function issueAccountLink(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: {
    target: ManagedAccount;
    createdBy: string;
    actor: Actor | null;
    data?: Record<string, unknown>;
  },
): Promise<{ token: string; expiresAt: Date }> {
  const { target } = input;
  const kind: LinkKind = target.status === "invited" ? "invitation" : "reset";
  const link = await issueLink(tx, { accountId: target.id, kind, createdBy: input.createdBy });
  await recordAudit(tx, {
    actor: input.actor,
    action: "account.reset_link_created",
    entity: "account",
    entityId: target.id,
    data: { kind, ...input.data },
  });
  return link;
}

/**
 * A fresh one-time link: an invitation for an account that has no password yet, a reset link
 * for one that has. A deactivated account is refused.
 */
export async function issueResetLink(
  actor: Actor,
  accountId: string,
  db: Database = getDb(),
): Promise<{ link: AccountLink }> {
  requirePermission(actor, "accounts:manage");

  const issued = await db.transaction(async (tx) => {
    // Before any row lock, as in acceptLink and revokeInvitation, so issuing a new link while
    // the previous one is accepted cannot deadlock (WS-040).
    await lockAccount(tx, accountId);
    const target = await loadManaged(tx, accountId);
    if (target.status === "deactivated") {
      throw conflict("This account is deactivated. Reactivate it first.");
    }
    return issueAccountLink(tx, { target, createdBy: actor.accountId, actor });
  });

  return { link: toLink(issued) };
}

export type OperatorRefusalReason = "unknown_account" | "not_admin" | "deactivated";

const OPERATOR_REFUSALS: Record<OperatorRefusalReason, string> = {
  unknown_account: "No human account has this email.",
  not_admin: "This account is not an Admin. An Admin can reset it from the People page.",
  deactivated: "This Admin is deactivated. The command does not reactivate accounts.",
};

/** Why the operator command refused (WS-065): said plainly, the operator is trusted. */
export class OperatorRefusal extends Error {
  constructor(readonly reason: OperatorRefusalReason) {
    super(OPERATOR_REFUSALS[reason]);
    this.name = "OperatorRefusal";
  }
}

/**
 * The operator's way back in when no Admin can act (WS-065, doc 0006 section 7): a link for
 * a human Admin who is not deactivated, made like an Admin's "Create reset link". The audit
 * entry has no acting account and says `via: "operator"`; the link's `created_by` is the
 * Admin's own account. Only `scripts/recover-admin.ts` calls it, never an HTTP route.
 */
export async function issueOperatorResetLink(
  email: string,
  db: Database = getDb(),
): Promise<AccountLink> {
  const found = await findAccountByEmail(db, email);
  if (found?.kind !== "human") throw new OperatorRefusal("unknown_account");

  const issued = await db.transaction(async (tx) => {
    await lockAccount(tx, found.id);
    // Checked again under the lock: the account may have changed meanwhile.
    const target = await loadManaged(tx, found.id);
    if (target.role !== "admin") throw new OperatorRefusal("not_admin");
    if (target.status === "deactivated") throw new OperatorRefusal("deactivated");
    return issueAccountLink(tx, {
      target,
      createdBy: target.id,
      actor: null,
      data: { via: "operator" },
    });
  });

  return toLink(issued);
}

/**
 * Takes back an invitation that was never accepted (WS-024): the account, which has no
 * password and so never acted, is deleted with its links, and its email is free again. An
 * account with a password is refused: it can only be deactivated. A per-account lock, which
 * accepting a link also takes first, keeps a revocation and an acceptance of the same
 * invitation from both succeeding.
 */
export async function revokeInvitation(
  actor: Actor,
  accountId: string,
  db: Database = getDb(),
): Promise<void> {
  requirePermission(actor, "accounts:manage");

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_CHANGE_LOCK_KEY})`);
    await lockAccount(tx, accountId);

    const [account] = await tx
      .select({ id: accounts.id, role: accounts.role })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.kind, "human")))
      .limit(1);
    if (!account) {
      throw notFound();
    }
    const [password] = await tx
      .select({ id: credentials.id })
      .from(credentials)
      .where(and(eq(credentials.accountId, accountId), isNotNull(credentials.passwordHash)))
      .limit(1);
    if (password) {
      throw conflict(
        "This person has already accepted their invitation. Deactivate the account instead.",
      );
    }

    await recordAudit(tx, {
      actor,
      action: "account.invitation_revoked",
      entity: "account",
      entityId: accountId,
      data: { role: account.role },
    });
    await tx.delete(accounts).where(eq(accounts.id, accountId));
  });
}
