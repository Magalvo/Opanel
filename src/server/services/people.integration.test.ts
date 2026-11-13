import { describe, expect, it } from "vitest";

import { createTestAccount, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accounts } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { listPeople } from "./people";

async function viewer() {
  const account = await createTestAccount({
    name: "Viewer",
    email: "viewer@example.com",
    role: "viewer",
  });
  return testActor(account);
}

/** An invited account: human, no password yet. */
async function invited(name: string) {
  await getDb()
    .insert(accounts)
    .values({ kind: "human", name, email: `${name.toLowerCase()}@example.com`, role: "member" });
}

async function agent(name: string) {
  await getDb().insert(accounts).values({ kind: "agent", name, role: "qa_agent" });
}

describe("listPeople", () => {
  it("lists people only: no invited accounts and no agents, ordered by name, with active", async () => {
    const actor = await viewer();
    const zoe = await createTestAccount({ name: "Zoe", email: "zoe@example.com" });
    await createTestAccount({ name: "Bob", email: "bob@example.com", disabled: true });
    await invited("Ivy");
    await agent("Bot");

    const page = await listPeople(actor, { limit: 50 });

    expect(page.items.map((person) => person.name)).toEqual(["Bob", "Viewer", "Zoe"]);
    expect(page.items.find((person) => person.name === "Bob")?.active).toBe(false);
    expect(page.items.find((person) => person.name === "Zoe")).toEqual({
      id: zoe.id,
      name: "Zoe",
      active: true,
    });
    expect(page.nextCursor).toBeNull();
  });

  it("orders names ignoring case, the same on every install whatever its collation", async () => {
    const actor = await viewer();
    for (const name of ["bea", "Al", "Carl", "alma"]) {
      await createTestAccount({ name, email: `${name.toLowerCase()}@example.com` });
    }

    const names = (await listPeople(actor, { limit: 50 })).items.map((person) => person.name);

    expect(names).toEqual(["Al", "alma", "bea", "Carl", "Viewer"]);
  });

  it("returns only id, name and active", async () => {
    const actor = await viewer();

    const [person] = (await listPeople(actor, { limit: 50 })).items;

    expect(Object.keys(person ?? {}).sort()).toEqual(["active", "id", "name"]);
  });

  it("pages join up with no gap or repeat, also across equal names", async () => {
    const actor = await viewer();
    for (const [index, name] of ["Ann", "Ann", "Ann", "Cy", "Di"].entries()) {
      await createTestAccount({ name, email: `p${String(index)}@example.com` });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listPeople(actor, { limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((person) => person.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    const all = (await listPeople(actor, { limit: 50 })).items.map((person) => person.id);
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(6);
  });

  it("filters by a case-insensitive name prefix, matching % and _ literally", async () => {
    const actor = await viewer();
    await createTestAccount({ name: "Ada", email: "ada@example.com" });
    await createTestAccount({ name: "adam", email: "adam@example.com" });
    await createTestAccount({ name: "Brad", email: "brad@example.com" });
    await createTestAccount({ name: "100% Sure", email: "sure@example.com" });
    await createTestAccount({ name: "a_b", email: "ab@example.com" });
    await createTestAccount({ name: "axb", email: "axb@example.com" });

    const names = async (q: string) =>
      (await listPeople(actor, { limit: 50, q })).items.map((person) => person.name);

    expect(await names("AD")).toEqual(["Ada", "adam"]);
    expect(await names("100%")).toEqual(["100% Sure"]);
    expect(await names("10%")).toEqual([]);
    expect(await names("a_")).toEqual(["a_b"]);
  });

  it("needs projects:read", async () => {
    const actor = await viewer();
    const withoutRead = { ...actor, permissions: new Set<never>() };

    await expect(listPeople(withoutRead, { limit: 50 })).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a cursor of another kind", async () => {
    const actor = await viewer();

    await expect(listPeople(actor, { limit: 1, cursor: "e30" })).rejects.toMatchObject({
      status: 400,
    });
  });
});
