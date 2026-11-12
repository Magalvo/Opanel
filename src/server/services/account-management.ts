import { and, count, eq, isNull, ne, sql } from "drizzle-orm";

import type {
  AccountLink,
  AccountPage,
  InviteRequest,
  ManagedAccount,
  UpdateAccountRequest,
} from "@/lib/schemas/accounts";
import { type Actor, requirePermission } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { accounts, accountTokens, sessions } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { conflict, lastAdmin, notFound } from "@/server/http/errors";
import { decodeCursor, encodeCursor } from "@/server/http/pagination";

import { issueLink, type LinkKind } from "./account-tokens";
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
    const target = await loadManaged(tx, accountId);
    if (target.status === "deactivated") {
      throw conflict("This account is deactivated. Reactivate it first.");
    }
    const kind: LinkKind = target.status === "invited" ? "invitation" : "reset";
    const link = await issueLink(tx, { accountId, kind, createdBy: actor.accountId });
    await recordAudit(tx, {
      actor,
      action: "account.reset_link_created",
      entity: "account",
      entityId: accountId,
      data: { kind },
    });
    return link;
  });

  return { link: toLink(issued) };
}
