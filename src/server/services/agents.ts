import { sql } from "drizzle-orm";

import { type AgentActor, agentActor } from "@/server/auth/actor";
import type { Database } from "@/server/db/client";

interface AgentRow extends Record<string, unknown> {
  id: string;
  role: string;
  all_projects: boolean;
  disabled_at: string | null;
  scopes: string[];
  project_ids: string[];
}

/**
 * An agent's actor, built from its stored role, scopes and projects in one query (WS-071),
 * with when it was disabled, or `null` for a human or an unknown id. Whether a disabled
 * agent may act is for `authenticate()` to decide, as for humans.
 */
export async function loadAgentActor(
  executor: Pick<Database, "execute">,
  accountId: string,
): Promise<{ actor: AgentActor; disabledAt: Date | null } | null> {
  const rows = await executor.execute<AgentRow>(sql`
    select a.id, a.role, a.all_projects, a.disabled_at,
      coalesce((select array_agg(s.scope order by s.scope)
        from agent_scopes s where s.account_id = a.id), '{}') as scopes,
      coalesce((select array_agg(p.project_id order by p.project_id)
        from agent_projects p where p.account_id = a.id), '{}') as project_ids
    from accounts a
    where a.id = ${accountId} and a.kind = 'agent'`);
  const row = rows[0];
  if (!row) return null;

  return {
    actor: agentActor({
      accountId: row.id,
      role: row.role,
      scopes: row.scopes,
      projectIds: row.all_projects ? null : row.project_ids,
    }),
    disabledAt: row.disabled_at === null ? null : new Date(row.disabled_at),
  };
}
