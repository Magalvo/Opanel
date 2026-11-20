import { describe, expect, it } from "vitest";

import { problemSchema } from "@/lib/schemas/problem";
import { projectSchema } from "@/lib/schemas/projects";
import { teamSchema } from "@/lib/schemas/teams";
import { triageSettingsSchema } from "@/lib/schemas/triage";
import {
  apiRequest,
  bearerRequest,
  createTestAccount,
  createTestAgent,
  createTestToken,
  signInCookie,
} from "@/server/auth/testing";

import { POST as createTeam } from "../../../teams/route";
import { POST as createProject } from "../../route";
import { GET, PATCH } from "./route";

const project = { params: Promise.resolve({ projectId: "OPA" }) };

async function cookieFor(role: "viewer" | "manager") {
  await createTestAccount({ name: role, email: `${role}@example.com`, role });
  return signInCookie(`${role}@example.com`);
}

describe("/api/v1/projects/{projectId}/triage (WS-087)", () => {
  it("reads and changes the settings through route(), with a cookie and with a token", async () => {
    const manager = await cookieFor("manager");
    const created = await createProject(
      apiRequest("POST", "/api/v1/projects", {
        cookie: manager,
        body: { key: "OPA", name: "Opanel" },
      }),
      undefined,
    );
    const opa = projectSchema.parse(await created.json());
    const team = teamSchema.parse(
      await (
        await createTeam(
          apiRequest("POST", "/api/v1/teams", { cookie: manager, body: { name: "Backend" } }),
          undefined,
        )
      ).json(),
    );

    const changed = await PATCH(
      apiRequest("PATCH", "/api/v1/projects/OPA/triage", {
        cookie: manager,
        body: { rules: { backend: team.id }, version: opa.version },
      }),
      project,
    );
    expect(changed.status).toBe(200);
    const settings = triageSettingsSchema.parse(await changed.json());
    expect(settings.rules.backend).toBe(team.id);

    const viewer = await cookieFor("viewer");
    const read = await GET(
      apiRequest("GET", "/api/v1/projects/OPA/triage", { cookie: viewer }),
      project,
    );
    expect(triageSettingsSchema.parse(await read.json())).toEqual(settings);

    const agent = await createTestAgent({ scopes: ["projects:read"] });
    const { token } = await createTestToken(agent.id);
    const byToken = await GET(bearerRequest("/api/v1/projects/OPA/triage", token), project);
    expect(byToken.status).toBe(200);

    const stale = await PATCH(
      apiRequest("PATCH", "/api/v1/projects/OPA/triage", {
        cookie: manager,
        body: { triageTeamId: team.id, version: opa.version },
      }),
      project,
    );
    expect(stale.status).toBe(409);
    expect(problemSchema.parse(await stale.json()).code).toBe("version_conflict");
  });

  it("refuses a change from another origin, and a query parameter it does not take", async () => {
    const manager = await cookieFor("manager");

    const noOrigin = await PATCH(
      new Request("http://localhost:3000/api/v1/projects/OPA/triage", {
        method: "PATCH",
        headers: { Cookie: manager, "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1 }),
      }),
      project,
    );
    expect(noOrigin.status).toBe(403);

    const withQuery = await GET(
      apiRequest("GET", "/api/v1/projects/OPA/triage?layer=api", { cookie: manager }),
      project,
    );
    expect(withQuery.status).toBe(400);
  });
});
