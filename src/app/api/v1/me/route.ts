import {
  type AgentMe,
  type HumanMe,
  meContract,
  type MeResponse,
  updateMeContract,
  updateMeRequestSchema,
} from "@/lib/schemas/auth";
import { agentScopeSchema } from "@/lib/schemas/permissions";
import type { Actor, AgentActor, HumanActor } from "@/server/auth/actor";
import { json, readJson, route } from "@/server/http/route";
import type { AccountRow } from "@/server/services/accounts";
import { renameSelf } from "@/server/services/profile";

// Authentication only (WS-015, WS-021): both describe or change the caller.
export const dynamic = "force-dynamic";

function sorted<T extends string>(values: ReadonlySet<T>): T[] {
  return [...values].sort();
}

/** A person. The database requires an email of every human (`accounts_human_has_email_check`). */
function humanMe(actor: HumanActor, account: AccountRow): HumanMe {
  if (account.email === null) throw new Error("A human account has no email");
  return {
    id: account.id,
    kind: "human",
    name: account.name,
    email: account.email,
    role: actor.role,
    permissions: sorted(actor.permissions),
    projectIds: null,
  };
}

/** An agent: its role, scopes and projects, from the actor that already validated them. */
function agentMe(actor: AgentActor, account: AccountRow): AgentMe {
  return {
    id: account.id,
    kind: "agent",
    name: account.name,
    role: actor.role,
    permissions: agentScopeSchema.array().parse(sorted(actor.permissions)),
    projectIds: actor.projectIds === null ? null : sorted(actor.projectIds),
  };
}

/** The caller, as a person or an agent (WS-076). */
function me(actor: Actor, account: AccountRow): MeResponse {
  return actor.kind === "human" ? humanMe(actor, account) : agentMe(actor, account);
}

export const GET = route(meContract, (_request, _context, { actor, account }) =>
  json(me(actor, account)),
);

// `session` access admits only people (WS-072), so the actor is a `HumanActor`.
export const PATCH = route(updateMeContract, async (request, _context, { actor }) => {
  const { name } = await readJson(request, updateMeRequestSchema);

  return json(humanMe(actor, await renameSelf(actor, name)));
});
