// The sprints table's own rules (WS-140 test 1): one active sprint per project, ordered
// dates, frozen points exactly when completed, a start time exactly when not planned.
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
    points?: boolean;
  } = {},
) {
  const state = values.state ?? "planned";
  return getDb().execute(sql`
    insert into sprints (project_id, name, start_date, end_date, state, started_at,
      completed_at, total_points, completed_points)
    values (${projectId}, 'Sprint', ${values.startDate ?? "2026-12-01"},
      ${values.endDate ?? "2026-12-14"}, ${state},
      ${values.startedAt ? sql`now()` : sql`null`},
      ${values.completedAt ? sql`now()` : sql`null`},
      ${values.points ? sql`10` : sql`null`}, ${values.points ? sql`4.5` : sql`null`})`);
}

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
    await expect(insertSprint(project.id, { points: true })).rejects.toMatchObject({
      cause: { constraint_name: "sprints_completed_check" },
    });
    await insertSprint(project.id, {
      state: "completed",
      startedAt: true,
      completedAt: true,
      points: true,
    });
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
