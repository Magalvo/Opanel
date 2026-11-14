import { z } from "zod";

/**
 * Every action that can appear in the audit log, as `entity.verb`. A work-item that
 * records a new kind of action appends it here, in the same change.
 */
export const AUDIT_ACTIONS = [
  "setup.first_admin_created",
  "auth.sign_in",
  "auth.sign_in_failed",
  "auth.sign_out",
  "account.invited",
  "account.invitation_accepted",
  "account.reset_link_created",
  "account.password_changed",
  "account.role_changed",
  "account.deactivated",
  "account.reactivated",
  "account.name_changed",
  "account.invitation_revoked",
  "team.created",
  "team.renamed",
  "team.deleted",
  "team.member_added",
  "team.member_removed",
  "project.created",
  "project.updated",
  "project.archived",
  "project.unarchived",
  "column.created",
  "column.updated",
  "column.moved",
  "column.deleted",
  "epic.created",
  "epic.updated",
  "epic.closed",
  "epic.reopened",
] as const;

export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const AUDIT_DATA_MAX_BYTES = 8 * 1024;

// Keys that must never be written to the audit log (AGENTS.md hard rule 7).
const SECRET_KEY = /pass(word)?|secret|token|hash|authorization|cookie/i;

function findSecretKey(value: unknown, path: string): string | undefined {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findSecretKey(item, `${path}[${String(index)}]`);
      if (found) return found;
    }
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      const here = path ? `${path}.${key}` : key;
      if (SECRET_KEY.test(key)) return here;
      const found = findSecretKey(item, here);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Throws if audit data could leak a secret or is not small, plain JSON. Messages name the
 * key path or the size, never a value.
 */
export function assertAuditDataSafe(data: unknown): void {
  const secretPath = findSecretKey(data, "");
  if (secretPath) {
    throw new Error(`Audit data must not contain secret-looking keys: "${secretPath}".`);
  }

  let json: string | undefined;
  try {
    json = JSON.stringify(data, (_key, value: unknown) => {
      if (typeof value === "function" || typeof value === "bigint" || typeof value === "symbol") {
        throw new TypeError("not JSON");
      }
      return value;
    });
  } catch {
    throw new Error("Audit data must be plain JSON.");
  }

  const bytes = new TextEncoder().encode(json).length;
  if (bytes > AUDIT_DATA_MAX_BYTES) {
    throw new Error(
      `Audit data is ${String(bytes)} bytes; the limit is ${String(AUDIT_DATA_MAX_BYTES)}.`,
    );
  }
}
