import { expect, request as playwrightRequest, test } from "@playwright/test";

import { accountPageSchema, inviteResponseSchema } from "@/lib/schemas/accounts";
import { problemSchema } from "@/lib/schemas/problem";

import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e password, long enough";
const origin = { Origin: E2E_BASE_URL };

test("an Admin invites, changes a role, is refused demoting the last Admin, and deactivates a signed-in person", async ({
  request,
}) => {
  const adminEmail = `admin-${crypto.randomUUID()}@example.com`;
  await seedAccount({ email: adminEmail, password, role: "admin" });
  const signIn = await request.post("/api/v1/auth/sign-in", {
    headers: origin,
    data: { email: adminEmail, password },
  });
  expect(signIn.status()).toBe(200);
  const self = (await signIn.json()) as { id: string };

  // Invite.
  const inviteeEmail = `grace-${crypto.randomUUID()}@example.com`;
  const invited = await request.post("/api/v1/accounts", {
    headers: origin,
    data: { name: "Grace", email: inviteeEmail, role: "member" },
  });
  expect(invited.status()).toBe(201);
  const created = inviteResponseSchema.parse(await invited.json());
  expect(created.link.url).toContain("/accept#");

  // List, with the invitee shown as invited.
  const list = await request.get("/api/v1/accounts?limit=100");
  const page = accountPageSchema.parse(await list.json());
  expect(page.items.find((item) => item.email === inviteeEmail)?.status).toBe("invited");

  // Change a role.
  const promoted = await request.patch(`/api/v1/accounts/${created.account.id}`, {
    headers: origin,
    data: { role: "manager" },
  });
  expect(promoted.status()).toBe(200);

  // Leave this Admin as the only active one, then try to demote them.
  for (const other of page.items.filter((item) => item.role === "admin" && item.id !== self.id)) {
    const off = await request.patch(`/api/v1/accounts/${other.id}`, {
      headers: origin,
      data: { active: false },
    });
    expect(off.status()).toBe(200);
  }
  const refused = await request.patch(`/api/v1/accounts/${self.id}`, {
    headers: origin,
    data: { role: "member" },
  });
  expect(refused.status()).toBe(409);
  expect(problemSchema.parse(await refused.json()).code).toBe("last_admin");

  // Deactivate a signed-in person: their next request is a 401.
  const memberEmail = `member-${crypto.randomUUID()}@example.com`;
  await seedAccount({ email: memberEmail, password, role: "member" });
  const memberContext = await playwrightRequest.newContext({ baseURL: E2E_BASE_URL });
  try {
    const memberSignIn = await memberContext.post("/api/v1/auth/sign-in", {
      headers: origin,
      data: { email: memberEmail, password },
    });
    expect(memberSignIn.status()).toBe(200);
    const memberId = ((await memberSignIn.json()) as { id: string }).id;
    expect((await memberContext.get("/api/v1/me")).status()).toBe(200);

    const deactivated = await request.patch(`/api/v1/accounts/${memberId}`, {
      headers: origin,
      data: { active: false },
    });
    expect(deactivated.status()).toBe(200);

    expect((await memberContext.get("/api/v1/me")).status()).toBe(401);
  } finally {
    await memberContext.dispose();
  }
});
