// Agent accounts in the data model (WS-071 section 2): what the database itself refuses,
// whatever code writes the rows. Raw SQL on purpose: these rules must hold without the
// services.
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "../client";

const client = () => getDb().$client;

/** The constraint or the error code a statement fails with; throws if it succeeds. */
async function refusal(statement: Promise<unknown>): Promise<string> {
  try {
    await statement;
  } catch (error) {
    const { constraint_name: constraint, code } = error as {
      constraint_name?: string;
      code?: string;
    };
    return constraint ?? code ?? "unknown";
  }
  throw new Error("the statement was accepted");
}

async function insertAgent(
  name = `Agent ${crypto.randomUUID()}`,
  overrides: { role?: string; email?: string | null; allProjects?: boolean | null } = {},
): Promise<string> {
  const [row] = await client()<{ id: string }[]>`
    insert into accounts (kind, name, email, role, all_projects)
    values ('agent', ${name}, ${overrides.email ?? null}, ${overrides.role ?? "qa_agent"},
      ${overrides.allProjects === undefined ? true : overrides.allProjects})
    returning id`;
  if (!row) throw new Error("no agent");
  return row.id;
}

async function insertHuman(name = "Ada"): Promise<string> {
  const [row] = await client()<{ id: string }[]>`
    insert into accounts (kind, name, email, role)
    values ('human', ${name}, ${`${crypto.randomUUID()}@example.com`}, 'member')
    returning id`;
  if (!row) throw new Error("no human");
  return row.id;
}

async function insertProject(): Promise<string> {
  const key = `P${String(Math.floor(Math.random() * 1e6))}`;
  const [row] = await client()<{ id: string }[]>`
    insert into projects (key, name) values (${key}, ${key}) returning id`;
  if (!row) throw new Error("no project");
  return row.id;
}

const HASH = "a".repeat(64);
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
/** A random public id of the right shape. */
function publicId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => BASE32[byte % 32]).join(
    "",
  );
}

describe("agent rows in accounts (WS-071)", () => {
  it("refuses a human role, an email, or no project scope on an agent", async () => {
    expect(await refusal(insertAgent(undefined, { role: "admin" }))).toBe(
      "accounts_agent_role_check",
    );
    expect(await refusal(insertAgent(undefined, { email: "bot@example.com" }))).toBe(
      "accounts_agent_no_email_check",
    );
    expect(await refusal(insertAgent(undefined, { allProjects: null }))).toBe(
      "accounts_agent_fields_check",
    );
  });

  it("refuses a description or a project scope on a human", async () => {
    const human = await insertHuman();
    expect(await refusal(client()`update accounts set description = 'x' where id = ${human}`)).toBe(
      "accounts_agent_fields_check",
    );
    expect(
      await refusal(client()`update accounts set all_projects = true where id = ${human}`),
    ).toBe("accounts_agent_fields_check");
  });

  it("refuses an empty or too long description", async () => {
    const agent = await insertAgent();
    for (const description of ["", "x".repeat(501)]) {
      expect(
        await refusal(
          client()`update accounts set description = ${description} where id = ${agent}`,
        ),
      ).toBe("accounts_description_length_check");
    }
    await client()`update accounts set description = ${"x".repeat(500)} where id = ${agent}`;
  });

  it("refuses two agents with the same name in any case, but not an agent and a human", async () => {
    await insertAgent("Bot");
    expect(await refusal(insertAgent("bot"))).toBe("accounts_agent_name_lower_idx");
    await insertHuman("Bot");
    await insertHuman("bot");
  });
});

describe("agent_scopes (WS-071)", () => {
  let agent: string;
  beforeEach(async () => {
    agent = await insertAgent();
  });

  it("stores the five agent scopes and refuses any other permission", async () => {
    for (const scope of [
      "projects:read",
      "tasks:read",
      "reports:write",
      "comments:write",
      "tasks:write",
    ]) {
      await client()`insert into agent_scopes (account_id, scope) values (${agent}, ${scope})`;
    }
    for (const scope of ["agents:manage", "accounts:manage", "tasks:delete_any", "labels:write"]) {
      expect(
        await refusal(
          client()`insert into agent_scopes (account_id, scope) values (${agent}, ${scope})`,
        ),
      ).toBe("agent_scopes_scope_check");
    }
  });

  it("refuses a scope for a human account", async () => {
    const human = await insertHuman();
    expect(
      await refusal(
        client()`insert into agent_scopes (account_id, scope) values (${human}, 'tasks:read')`,
      ),
    ).toBe("agent_scopes_account_fk");
  });

  it("refuses an account_kind other than agent", async () => {
    expect(
      await refusal(
        client()`insert into agent_scopes (account_id, account_kind, scope)
          values (${agent}, 'human', 'tasks:read')`,
      ),
    ).toBe("agent_scopes_account_kind_check");
  });

  it("goes with the agent", async () => {
    await client()`insert into agent_scopes (account_id, scope) values (${agent}, 'tasks:read')`;
    await client()`delete from accounts where id = ${agent}`;
    const rows = await client()`select 1 from agent_scopes where account_id = ${agent}`;
    expect(rows).toHaveLength(0);
  });
});

describe("agent_projects (WS-071)", () => {
  it("restricts an agent to projects, and refuses a row for a human", async () => {
    const agent = await insertAgent(undefined, { allProjects: false });
    const human = await insertHuman();
    const project = await insertProject();
    await client()`insert into agent_projects (account_id, project_id) values (${agent}, ${project})`;
    expect(
      await refusal(
        client()`insert into agent_projects (account_id, project_id) values (${human}, ${project})`,
      ),
    ).toBe("agent_projects_account_fk");
  });
});

describe("api_tokens (WS-071)", () => {
  async function insertToken(
    accountId: string,
    overrides: { publicId?: string; secretHash?: string; name?: string } = {},
  ) {
    return client()`
      insert into api_tokens (account_id, public_id, secret_hash, name)
      values (${accountId}, ${overrides.publicId ?? publicId()},
        ${overrides.secretHash ?? HASH}, ${overrides.name ?? "CI runner"})`;
  }

  it("stores a token of an agent, with only the hash of its secret", async () => {
    const agent = await insertAgent();
    await insertToken(agent, { publicId: "abcdefghijk2" });
    const [row] = await client()<
      {
        secret_hash: string;
        expires_at: Date | null;
        revoked_at: Date | null;
        last_used_at: Date | null;
      }[]
    >`select * from api_tokens where public_id = 'abcdefghijk2'`;
    expect(row?.secret_hash).toBe(HASH);
    expect(row?.expires_at).toBeNull();
    expect(row?.revoked_at).toBeNull();
    expect(row?.last_used_at).toBeNull();
  });

  it("refuses a token for a human", async () => {
    expect(await refusal(insertToken(await insertHuman()))).toBe("api_tokens_account_fk");
  });

  it("refuses a malformed or duplicate public id, a malformed hash, a bad name", async () => {
    const agent = await insertAgent();
    for (const bad of ["ABCDEFGHIJK2", "abcdefghijk", "abcdefghijk1", "abcdefghijk2x"]) {
      expect(await refusal(insertToken(agent, { publicId: bad }))).toBe(
        "api_tokens_public_id_check",
      );
    }
    await insertToken(agent, { publicId: "zzzzzzzzzzz7" });
    expect(await refusal(insertToken(agent, { publicId: "zzzzzzzzzzz7" }))).toBe(
      "api_tokens_public_id_unique",
    );
    for (const bad of ["a".repeat(63), "A".repeat(64), "g".repeat(64)]) {
      expect(await refusal(insertToken(agent, { secretHash: bad }))).toBe(
        "api_tokens_secret_hash_check",
      );
    }
    for (const bad of ["", "x".repeat(81)]) {
      expect(await refusal(insertToken(agent, { name: bad }))).toBe("api_tokens_name_check");
    }
  });
});
