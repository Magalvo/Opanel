import { describe, expect, it } from "vitest";

import {
  assertAuditDataSafe,
  AUDIT_ACTIONS,
  AUDIT_DATA_MAX_BYTES,
  auditActionSchema,
} from "./audit";

describe("auditActionSchema", () => {
  it("accepts every listed action", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(auditActionSchema.parse(action)).toBe(action);
    }
  });

  it("includes the thirteen actions of WT-02, the last one from WS-024", () => {
    expect(AUDIT_ACTIONS).toHaveLength(13);
    expect(AUDIT_ACTIONS).toContain("account.invitation_revoked");
  });

  it("rejects unknown, empty and wrongly cased actions", () => {
    for (const value of ["account.exploded", "", "Account.Deactivated", 1, null]) {
      expect(auditActionSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("assertAuditDataSafe", () => {
  it("accepts plain data", () => {
    expect(() => {
      assertAuditDataSafe({ from: "member", to: "admin", count: 2, tags: ["a", { b: null }] });
    }).not.toThrow();
  });

  it.each(["password", "Secret", "apiToken", "passwordHash", "Authorization", "cookie"])(
    "rejects the key %s at any depth",
    (key) => {
      expect(() => {
        assertAuditDataSafe({ [key]: "x" });
      }).toThrow();
      expect(() => {
        assertAuditDataSafe({ outer: { [key]: "x" } });
      }).toThrow();
      expect(() => {
        assertAuditDataSafe({ list: [{ [key]: "x" }] });
      }).toThrow();
    },
  );

  it("names the key path and never contains the value", () => {
    try {
      assertAuditDataSafe({ change: { newPassword: "hunter2-hunter2" } });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("change.newPassword");
      expect(message).not.toContain("hunter2");
    }
  });

  it("accepts data up to 8 KiB and rejects one byte more", () => {
    const overhead = JSON.stringify({ v: "" }).length;
    const exact = { v: "a".repeat(AUDIT_DATA_MAX_BYTES - overhead) };
    expect(() => {
      assertAuditDataSafe(exact);
    }).not.toThrow();
    expect(() => {
      assertAuditDataSafe({ v: exact.v + "a" });
    }).toThrow();
  });

  it("rejects values that are not JSON", () => {
    expect(() => {
      assertAuditDataSafe({ f: () => 1 });
    }).toThrow();
    expect(() => {
      assertAuditDataSafe({ n: 10n });
    }).toThrow();
  });
});
