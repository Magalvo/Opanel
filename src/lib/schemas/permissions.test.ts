import { describe, expect, it } from "vitest";

import { humanRoleSchema, permissionSchema, PERMISSIONS } from "./permissions";

describe("permissionSchema", () => {
  it("accepts every listed permission", () => {
    for (const permission of PERMISSIONS) {
      expect(permissionSchema.parse(permission)).toBe(permission);
    }
  });

  it("rejects unknown, empty and wrongly cased values", () => {
    for (const value of ["tasks:fly", "", "Tasks:Read", "tasks", 1, null]) {
      expect(permissionSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("humanRoleSchema", () => {
  it("accepts exactly the four human roles", () => {
    for (const role of ["admin", "manager", "member", "viewer"]) {
      expect(humanRoleSchema.parse(role)).toBe(role);
    }
  });

  it("rejects agent, owner and empty", () => {
    for (const value of ["agent", "owner", ""]) {
      expect(humanRoleSchema.safeParse(value).success).toBe(false);
    }
  });
});
