import { HUMAN_ROLES, type HumanRole } from "@/lib/schemas/permissions";

export const ROLE_LABELS: Record<HumanRole, string> = {
  admin: "Admin",
  manager: "Manager",
  member: "Member",
  viewer: "Viewer",
};

/** The roles in the order a person would expect: most to least powerful. */
export const ROLE_OPTIONS: readonly HumanRole[] = [...HUMAN_ROLES].reverse();
