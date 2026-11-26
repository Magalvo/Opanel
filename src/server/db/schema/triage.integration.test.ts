// The data model of bug reports and triage (WS-086): what the database itself refuses,
// whatever code writes the rows. Raw SQL on purpose, as agents.integration.test.ts: these
// rules must hold without the services.
import { beforeEach, describe, expect, it } from "vitest";

import {
  BUG_REPORT_OUTCOMES,
  ORIGIN_LAYERS,
  ROUTED_LAYERS,
  SEVERITIES,
  TASK_LINK_TYPES,
} from "@/lib/schemas/bug-reports";

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

async function one(rows: Promise<{ id: string }[]>): Promise<string> {
  const [row] = await rows;
  if (!row) throw new Error("no row");
  return row.id;
}

const insertAgent = () =>
  one(client()<{ id: string }[]>`
    insert into accounts (kind, name, role, all_projects)
    values ('agent', ${`Agent ${crypto.randomUUID()}`}, 'qa_agent', true) returning id`);

const insertHuman = () =>
  one(client()<{ id: string }[]>`
    insert into accounts (kind, name, email, role)
    values ('human', 'Ada', ${`${crypto.randomUUID()}@example.com`}, 'member') returning id`);

const insertProject = () => {
  const key = `P${String(Math.floor(Math.random() * 1e6))}`;
  return one(client()<{ id: string }[]>`
    insert into projects (key, name) values (${key}, ${key}) returning id`);
};

const insertTeam = () =>
  one(client()<{ id: string }[]>`
    insert into teams (name) values (${`Team ${crypto.randomUUID()}`}) returning id`);

const insertColumn = (projectId: string) =>
  one(client()<{ id: string }[]>`
    insert into columns (project_id, name, category, position)
    values (${projectId}, 'To do', 'todo', 'a0') returning id`);

let taskNumber = 0;
async function insertTask(
  projectId: string,
  columnId: string,
  reporter: string,
  type = "bug",
): Promise<string> {
  taskNumber += 1;
  return one(client()<{ id: string }[]>`
    insert into tasks (project_id, number, type, title, column_id, position, reporter_account_id)
    values (${projectId}, ${taskNumber}, ${type}, 'A task', ${columnId},
      ${`a${String(taskNumber).padStart(6, "0")}`}, ${reporter})
    returning id`);
}

let project: string;
let column: string;
let human: string;
let agent: string;
beforeEach(async () => {
  project = await insertProject();
  column = await insertColumn(project);
  human = await insertHuman();
  agent = await insertAgent();
});

describe("the bug fields of tasks (WS-086 section 2)", () => {
  it("accepts each severity on a bug, and refuses one on a task or a story", async () => {
    const bug = await insertTask(project, column, human);
    for (const severity of ["low", "medium", "high", "critical"]) {
      await client()`update tasks set severity = ${severity} where id = ${bug}`;
    }
    expect(await refusal(client()`update tasks set severity = 'urgent' where id = ${bug}`)).toBe(
      "tasks_severity_check",
    );

    for (const type of ["task", "story"]) {
      const other = await insertTask(project, column, human, type);
      expect(await refusal(client()`update tasks set severity = 'low' where id = ${other}`)).toBe(
        "tasks_severity_check",
      );
    }
  });

  it("refuses an empty or too long fingerprint, and negative occurrences", async () => {
    const bug = await insertTask(project, column, human);
    await client()`update tasks set fingerprint = ${"f".repeat(128)}, occurrences = 3 where id = ${bug}`;

    for (const fingerprint of ["", "f".repeat(129)]) {
      expect(
        await refusal(client()`update tasks set fingerprint = ${fingerprint} where id = ${bug}`),
      ).toBe("tasks_fingerprint_check");
    }
    expect(await refusal(client()`update tasks set occurrences = -1 where id = ${bug}`)).toBe(
      "tasks_occurrences_check",
    );
  });

  it("gives a task created as before no severity, no fingerprint and no occurrences", async () => {
    const task = await insertTask(project, column, human, "task");

    const [row] = await client()<
      {
        severity: string | null;
        fingerprint: string | null;
        occurrences: number;
        lastReportedAt: Date | null;
      }[]
    >`select severity, fingerprint, occurrences, last_reported_at as "lastReportedAt"
      from tasks where id = ${task}`;

    expect(row).toEqual({
      severity: null,
      fingerprint: null,
      occurrences: 0,
      lastReportedAt: null,
    });
  });
});

describe("a project's triage team and its routing rules (WS-086 sections 3 and 4)", () => {
  it("names a team or nothing as the triage team", async () => {
    const team = await insertTeam();

    await client()`update projects set triage_team_id = ${team} where id = ${project}`;
    await client()`update projects set triage_team_id = null where id = ${project}`;

    expect(
      await refusal(
        client()`update projects set triage_team_id = ${crypto.randomUUID()} where id = ${project}`,
      ),
    ).toBe("projects_triage_team_id_teams_id_fk");
  });

  it("holds one team per project and routed layer, never unknown", async () => {
    const team = await insertTeam();
    for (const layer of ["frontend", "api", "backend"]) {
      await client()`insert into routing_rules (project_id, origin_layer, team_id)
        values (${project}, ${layer}, ${team})`;
    }

    expect(
      await refusal(
        client()`insert into routing_rules (project_id, origin_layer, team_id)
          values (${project}, 'api', ${team})`,
      ),
    ).toBe("routing_rules_project_id_origin_layer_pk");
    expect(
      await refusal(
        client()`insert into routing_rules (project_id, origin_layer, team_id)
          values (${project}, 'unknown', ${team})`,
      ),
    ).toBe("routing_rules_origin_layer_check");
  });

  it("keeps a team that triage uses from being deleted", async () => {
    const triage = await insertTeam();
    const routed = await insertTeam();
    await client()`update projects set triage_team_id = ${triage} where id = ${project}`;
    await client()`insert into routing_rules (project_id, origin_layer, team_id)
      values (${project}, 'frontend', ${routed})`;

    expect(await refusal(client()`delete from teams where id = ${triage}`)).toBe(
      "projects_triage_team_id_teams_id_fk",
    );
    expect(await refusal(client()`delete from teams where id = ${routed}`)).toBe(
      "routing_rules_team_id_teams_id_fk",
    );
  });
});

describe("bug_reports (WS-086 section 6)", () => {
  let task: string;
  beforeEach(async () => {
    task = await insertTask(project, column, agent);
  });

  interface ReportRow {
    agent: string;
    outcome: string;
    layer: string;
    confidence: number | null;
    severity: string;
    fingerprint: string;
    runId: string | null;
  }

  function report(overrides: Partial<ReportRow> = {}) {
    const row: ReportRow = {
      agent,
      outcome: "created",
      layer: "api",
      confidence: 0.8,
      severity: "high",
      fingerprint: "a3f1",
      runId: null,
      ...overrides,
    };
    const payload = JSON.stringify({ title: "Checkout fails" });
    return client()<{ id: string }[]>`
      insert into bug_reports (project_id, agent_account_id, task_id, outcome, origin_layer,
        confidence, severity, fingerprint, run_id, payload)
      values (${project}, ${row.agent}, ${task}, ${row.outcome}, ${row.layer},
        ${row.confidence}, ${row.severity}, ${row.fingerprint}, ${row.runId}, ${payload}::jsonb)
      returning id`;
  }

  it("stores an agent's report as sent", async () => {
    const id = await one(report({ runId: "run-1" }));

    const [row] = await client()<{ payload: unknown; confidence: number; runId: string }[]>`
      select payload, confidence, run_id as "runId" from bug_reports where id = ${id}`;
    expect(row).toMatchObject({ payload: { title: "Checkout fails" }, runId: "run-1" });
    expect(row?.confidence).toBeCloseTo(0.8);
    await one(report({ outcome: "deduplicated", layer: "unknown", confidence: null }));
  });

  it("refuses a human author and any value outside its vocabulary", async () => {
    expect(await refusal(report({ agent: human }))).toBe("bug_reports_agent_account_fk");
    expect(await refusal(report({ outcome: "merged" }))).toBe("bug_reports_outcome_check");
    expect(await refusal(report({ layer: "database" }))).toBe("bug_reports_origin_layer_check");
    expect(await refusal(report({ severity: "urgent" }))).toBe("bug_reports_severity_check");
    expect(await refusal(report({ confidence: 1.5 }))).toBe("bug_reports_confidence_check");
    expect(await refusal(report({ fingerprint: "f".repeat(129) }))).toBe(
      "bug_reports_fingerprint_check",
    );
    expect(await refusal(report({ runId: "" }))).toBe("bug_reports_run_id_check");
  });

  it("is append-only: an update or a delete is refused", async () => {
    const id = await one(report());

    for (const statement of [
      client()`update bug_reports set severity = 'low' where id = ${id}`,
      client()`delete from bug_reports where id = ${id}`,
    ]) {
      // P0001: raise_exception, from the append-only trigger.
      expect(await refusal(statement)).toBe("P0001");
    }
  });
});

describe("task_links (WS-086 section 7)", () => {
  it("stores a regression_of link once, between two different tasks", async () => {
    const closed = await insertTask(project, column, human);
    const again = await insertTask(project, column, agent);
    const link = () => client()`insert into task_links (from_task_id, to_task_id, type, created_by)
      values (${again}, ${closed}, 'regression_of', ${agent})`;
    await link();

    expect(await refusal(link())).toBe("task_links_from_task_id_to_task_id_type_pk");
    expect(
      await refusal(
        client()`insert into task_links (from_task_id, to_task_id, type)
          values (${again}, ${again}, 'regression_of')`,
      ),
    ).toBe("task_links_not_self_check");
    expect(
      await refusal(
        client()`insert into task_links (from_task_id, to_task_id, type)
          values (${closed}, ${again}, 'parent_of')`,
      ),
    ).toBe("task_links_type_check");
  });

  it("takes the four types of WT-09, and relates_to only from the lower id (WS-134)", async () => {
    const [low, high] = [
      await insertTask(project, column, human),
      await insertTask(project, column, human),
    ].sort();
    for (const type of TASK_LINK_TYPES) {
      await client()`insert into task_links (from_task_id, to_task_id, type)
        values (${low ?? ""}, ${high ?? ""}, ${type})`;
    }
    await client()`insert into task_links (from_task_id, to_task_id, type)
      values (${high ?? ""}, ${low ?? ""}, 'blocks')`;

    expect(
      await refusal(
        client()`insert into task_links (from_task_id, to_task_id, type)
          values (${high ?? ""}, ${low ?? ""}, 'relates_to')`,
      ),
    ).toBe("task_links_relates_to_order_check");
  });
});

describe("the task history (WS-086 section 2)", () => {
  it("accepts a reported_again entry", async () => {
    const bug = await insertTask(project, column, agent);

    await client()`insert into task_events (task_id, actor_account_id, type)
      values (${bug}, ${agent}, 'reported_again')`;
  });

  it("accepts linked and unlinked entries (WS-134)", async () => {
    const task = await insertTask(project, column, human);

    for (const type of ["linked", "unlinked"]) {
      await client()`insert into task_events (task_id, actor_account_id, type)
        values (${task}, ${human}, ${type})`;
    }
  });
});

describe("the checks and the shared vocabularies (WS-086 section 1)", () => {
  /** The quoted values a check constraint names, in order. */
  async function valuesOf(constraint: string): Promise<string[]> {
    const [row] = await client()<{ definition: string }[]>`
      select pg_get_constraintdef(oid) as definition from pg_constraint
      where conname = ${constraint}`;
    if (!row) throw new Error(`no constraint ${constraint}`);
    return [...row.definition.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1] ?? "");
  }

  it.each([
    ["tasks_severity_check", [...SEVERITIES, "bug"]],
    ["bug_reports_severity_check", SEVERITIES],
    ["bug_reports_origin_layer_check", ORIGIN_LAYERS],
    ["routing_rules_origin_layer_check", ROUTED_LAYERS],
    ["bug_reports_outcome_check", BUG_REPORT_OUTCOMES],
    ["task_links_type_check", TASK_LINK_TYPES],
  ] as const)("%s names exactly the shared values", async (constraint, values) => {
    expect(await valuesOf(constraint)).toEqual(values);
  });
});
