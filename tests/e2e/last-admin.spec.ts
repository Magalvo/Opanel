import { accountPageSchema } from "@/lib/schemas/accounts";
import { problemSchema } from "@/lib/schemas/problem";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e password, long enough";
const origin = { Origin: E2E_BASE_URL };

// Runs alone, in the `exclusive` project (WS-052): it deactivates every other active Admin
// of the install, which would sign out the Admins that other tests are using.
test("the last active Admin cannot be demoted", async ({ request }) => {
  const adminEmail = `admin-${crypto.randomUUID()}@example.com`;
  await seedAccount({ email: adminEmail, password, role: "admin" });
  const signIn = await request.post("/api/v1/auth/sign-in", {
    headers: origin,
    data: { email: adminEmail, password },
  });
  expect(signIn.status()).toBe(200);
  const self = (await signIn.json()) as { id: string };

  const list = await request.get("/api/v1/accounts?limit=100");
  expect(list.status()).toBe(200);
  const page = accountPageSchema.parse(await list.json());

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
});
