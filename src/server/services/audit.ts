import { assertAuditDataSafe, type AuditAction, auditActionSchema } from "@/lib/schemas/audit";
import type { Actor } from "@/server/auth/actor";
import type { Database } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";

/** The database or one of its transactions: all the writer needs is `insert`. */
export type AuditExecutor = Pick<Database, "insert">;

export interface AuditEvent {
  /** Who acted. `null` means "no authenticated actor" and must be written out. */
  actor: Actor | null;
  action: AuditAction;
  entity: string;
  entityId?: string;
  data?: Record<string, unknown>;
}

/**
 * Records one audit event and returns its id. Call it with the transaction that makes the
 * change, so the change and its audit row commit or roll back together (AGENTS.md rule 8).
 */
export async function recordAudit(executor: AuditExecutor, event: AuditEvent): Promise<number> {
  const action = auditActionSchema.parse(event.action);
  if (event.data !== undefined) {
    assertAuditDataSafe(event.data);
  }

  const [row] = await executor
    .insert(auditLog)
    .values({
      actorAccountId: event.actor?.accountId ?? null,
      action,
      entity: event.entity,
      entityId: event.entityId ?? null,
      data: event.data ?? null,
    })
    .returning({ id: auditLog.id });
  if (!row) {
    throw new Error("The audit row was not written.");
  }
  return row.id;
}
