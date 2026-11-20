import { describe, expect, it } from "vitest";

import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { loadAgentActor } from "./agents";
import { archiveProject, createProject } from "./projects";
import { createTeam } from "./teams";
import { getTriage, updateTriage } from "./triage";

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a failure");
}

async function setup() {
  const manager = testActor(
    await createTestAccount({ name: "Manager", email: "manager@example.com", role: "manager" }),
  );
  const project = await createProject(manager, { key: "OPA", name: "Opanel" });
  const frontend = await createTeam(manager, { name: "Frontend" });
  const backend = await createTeam(manager, { name: "Backend" });
  const triage = await createTeam(manager, { name: "Triage" });
  return { manager, project, frontend, backend, triage };
}

async function agentActor(projectIds: string[] | null) {
  const account = await createTestAgent({
    role: "worker_agent",
    scopes: ["projects:read", "tasks:read", "reports:write", "comments:write", "tasks:write"],
    projectIds,
  });
  const loaded = await loadAgentActor(getDb(), account.id);
  if (!loaded) throw new Error("no agent");
  return loaded.actor;
}

describe("getTriage (WS-087)", () => {
  it("answers no team anywhere for a new project, with its version", async () => {
    const { manager, project } = await setup();

    expect(await getTriage(manager, "OPA")).toEqual({
      triageTeamId: null,
      rules: { frontend: null, api: null, backend: null },
      version: project.version,
    });
  });

  it("answers the teams the database holds", async () => {
    const { manager, project, backend, triage } = await setup();
    await getDb()
      .$client`update projects set triage_team_id = ${triage.id} where id = ${project.id}`;
    await getDb().$client`insert into routing_rules (project_id, origin_layer, team_id)
      values (${project.id}, 'backend', ${backend.id})`;

    expect(await getTriage(manager, project.id)).toMatchObject({
      triageTeamId: triage.id,
      rules: { frontend: null, api: null, backend: backend.id },
    });
  });

  it("answers 404 for an unknown project", async () => {
    const { manager } = await setup();

    expect((await failure(getTriage(manager, "ZZZ"))).status).toBe(404);
  });
});

describe("updateTriage (WS-087)", () => {
  it("sets, clears and leaves each field, and bumps the project's version", async () => {
    const { manager, project, frontend, backend, triage } = await setup();
    const first = await updateTriage(manager, "OPA", {
      triageTeamId: triage.id,
      rules: { frontend: frontend.id, backend: backend.id },
      version: project.version,
    });
    expect(first).toEqual({
      triageTeamId: triage.id,
      rules: { frontend: frontend.id, api: null, backend: backend.id },
      version: project.version + 1,
    });

    const second = await updateTriage(manager, "OPA", {
      rules: { backend: null },
      version: first.version,
    });

    expect(second).toEqual({
      triageTeamId: triage.id,
      rules: { frontend: frontend.id, api: null, backend: null },
      version: project.version + 2,
    });
    expect(await getTriage(manager, "OPA")).toEqual(second);
  });

  it("refuses a stale version with the current settings, and an archived project", async () => {
    const { manager, project, triage } = await setup();
    const current = await updateTriage(manager, "OPA", {
      triageTeamId: triage.id,
      version: project.version,
    });

    const stale = await failure(
      updateTriage(manager, "OPA", { triageTeamId: null, version: project.version }),
    );
    expect(stale).toMatchObject({ status: 409, code: "version_conflict" });
    expect(stale.current).toEqual(current);

    const archived = await archiveProject(manager, "OPA");
    const refused = await failure(
      updateTriage(manager, "OPA", { triageTeamId: null, version: archived.version }),
    );
    expect(refused).toMatchObject({ status: 409, code: "project_archived" });
  });

  it("refuses a team that does not exist, naming the field, and changes nothing", async () => {
    const { manager, project, triage } = await setup();

    const error = await failure(
      updateTriage(manager, "OPA", {
        triageTeamId: triage.id,
        rules: { api: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f" },
        version: project.version,
      }),
    );

    expect(error.status).toBe(400);
    expect(error.errors).toEqual([{ path: "rules.api", message: "There is no such team." }]);
    expect((await getTriage(manager, "OPA")).triageTeamId).toBeNull();
  });

  it("is for Managers and Admins: a Member, a Viewer and an agent get 403; a Viewer reads", async () => {
    const { project, triage } = await setup();
    const member = testActor(await createTestAccount({ email: "m@example.com", role: "member" }));
    const viewer = testActor(await createTestAccount({ email: "v@example.com", role: "viewer" }));
    const agent = await agentActor(null);
    const change = { triageTeamId: triage.id, version: project.version };

    for (const actor of [member, viewer, agent]) {
      expect(await failure(updateTriage(actor, "OPA", change))).toMatchObject({
        status: 403,
        code: "forbidden",
      });
    }
    expect((await getTriage(viewer, "OPA")).version).toBe(project.version);
    expect((await getTriage(agent, "OPA")).version).toBe(project.version);
  });

  it("refuses a restricted agent another project's settings", async () => {
    const { manager } = await setup();
    const other = await createProject(manager, { key: "WEB", name: "Website" });
    const agent = await agentActor([other.id]);

    expect(await failure(getTriage(agent, "OPA"))).toMatchObject({ status: 403 });
    expect((await getTriage(agent, "WEB")).version).toBe(other.version);
  });

  it("audits only the fields that changed, with their old and new team", async () => {
    const { manager, project, frontend, backend } = await setup();
    const first = await updateTriage(manager, "OPA", {
      rules: { frontend: frontend.id },
      version: project.version,
    });
    await updateTriage(manager, "OPA", {
      triageTeamId: null,
      rules: { frontend: backend.id, api: null },
      version: first.version,
    });

    const entries = (await getDb().select().from(auditLog).orderBy(auditLog.id)).filter(
      (entry) => entry.action === "project.triage_updated",
    );
    expect(entries.map((entry) => entry.data)).toEqual([
      { changed: { "rules.frontend": { from: null, to: frontend.id } } },
      { changed: { "rules.frontend": { from: frontend.id, to: backend.id } } },
    ]);
    expect(entries[0]).toMatchObject({ entity: "project", entityId: project.id });
  });
});
