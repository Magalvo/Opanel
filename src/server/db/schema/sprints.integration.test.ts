// The sprints table's own rules (WS-140 test 1): one active sprint per project, ordered
// dates, frozen progress exactly when completed (WS-142 test 1), a start time exactly when not planned.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { createProject } from "@/server/services/projects";

async function setup() {
  const manager = testActor(
    await createTestAccount({ email: "manager@example.com", role: "manager" }),
  );
  const project = await createProject(manager, { key: "OPA", name: "Opanel" });
  const other = await createProject(manager, { key: "WEB", name: "Web" });
  return { project, other };
}

function insertSprint(
  projectId: string,
  values: {
    state?: string;
    startDate?: string;
    endDate?: string;
    startedAt?: boolean;
    completedAt?: boolean;
    /** The frozen values set (WS-142 section 2); `true` sets all five. */
    frozen?: boolean | readonly Frozen[];
  } = {},
) {
  const state = values.state ?? "planned";
  const frozen = new Set<Frozen>(
    values.frozen === true
      ? FROZEN
      : values.frozen === undefined || values.frozen === false
        ? []
        : values.frozen,
  );
  const value = (column: Frozen, given: number) => (frozen.has(column) ? sql`${given}` : sql`null`);
  return getDb().execute(sql`
    insert into sprints (project_id, name, start_date, end_date, state, started_at,
      completed_at, total_points, completed_points, total_tasks, completed_tasks, unestimated)
    values (${projectId}, 'Sprint', ${values.startDate ?? "2026-12-01"},
      ${values.endDate ?? "2026-12-14"}, ${state},
      ${values.startedAt ? sql`now()` : sql`null`},
      ${values.completedAt ? sql`now()` : sql`null`},
      ${value("total_points", 10)}, ${value("completed_points", 4.5)},
      ${value("total_tasks", 6)}, ${value("completed_tasks", 3)}, ${value("unestimated", 1)})`);
}

const FROZEN = [
  "total_points",
  "completed_points",
  "total_tasks",
  "completed_tasks",
  "unestimated",
] as const;

type Frozen = (typeof FROZEN)[number];

describe("the sprints table (WS-140 test 1)", () => {
  it("refuses a second active sprint in a project, not in another one", async () => {
    const { project, other } = await setup();
    await insertSprint(project.id, { state: "active", startedAt: true });

    await expect(
      insertSprint(project.id, { state: "active", startedAt: true }),
    ).rejects.toMatchObject({ cause: { constraint_name: "sprints_one_active_idx" } });
    await insertSprint(other.id, { state: "active", startedAt: true });
    await insertSprint(project.id);
    await insertSprint(project.id);
  });

  it("refuses an end date before the start date, and takes the same day", async () => {
    const { project } = await setup();

    await expect(
      insertSprint(project.id, { startDate: "2026-12-10", endDate: "2026-12-09" }),
    ).rejects.toMatchObject({ cause: { constraint_name: "sprints_dates_ordered" } });
    await insertSprint(project.id, { startDate: "2026-12-10", endDate: "2026-12-10" });
  });

  it("refuses a completed sprint without frozen points, and points on a planned one", async () => {
    const { project } = await setup();

    await expect(
      insertSprint(project.id, { state: "completed", startedAt: true, completedAt: true }),
    ).rejects.toMatchObject({ cause: { constraint_name: "sprints_completed_check" } });
    await expect(insertSprint(project.id, { frozen: true })).rejects.toMatchObject({
      cause: { constraint_name: "sprints_completed_check" },
    });
    await insertSprint(project.id, {
      state: "completed",
      startedAt: true,
      completedAt: true,
      frozen: true,
    });
  });

  it("refuses a completed sprint missing any of the five frozen values, and any on an active one (WS-142 test 1)", async () => {
    const { project } = await setup();

    for (const missing of FROZEN) {
      await expect(
        insertSprint(project.id, {
          state: "completed",
          startedAt: true,
          completedAt: true,
          frozen: FROZEN.filter((column) => column !== missing),
        }),
        missing,
      ).rejects.toMatchObject({ cause: { constraint_name: "sprints_completed_check" } });
    }
    for (const column of FROZEN) {
      await expect(
        insertSprint(project.id, { state: "active", startedAt: true, frozen: [column] }),
        column,
      ).rejects.toMatchObject({ cause: { constraint_name: "sprints_completed_check" } });
    }
    await insertSprint(project.id, { state: "active", startedAt: true });
  });

  it("refuses a start time on a planned sprint and none on an active one, and an unknown state", async () => {
    const { project } = await setup();

    await expect(insertSprint(project.id, { startedAt: true })).rejects.toMatchObject({
      cause: { constraint_name: "sprints_started_check" },
    });
    await expect(insertSprint(project.id, { state: "active" })).rejects.toMatchObject({
      cause: { constraint_name: "sprints_started_check" },
    });
    await expect(
      insertSprint(project.id, { state: "running", startedAt: true }),
    ).rejects.toMatchObject({
      cause: { constraint_name: "sprints_state_check" },
    });
  });

  it("gives every project sprints_enabled false by default", async () => {
    const { project } = await setup();

    const [row] = await getDb().execute<{ sprints_enabled: boolean }>(
      sql`select sprints_enabled from projects where id = ${project.id}`,
    );
    expect(row?.sprints_enabled).toBe(false);
  });
});
