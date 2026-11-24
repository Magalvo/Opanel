// `pnpm tsx scripts/measure-task-search.ts`: measures the task filters and text search on a
// project of 50 000 tasks (WS-116 section 6). Not run by the quality gate. It creates a
// scratch database named after the test database, applies the migrations before `0022`,
// fills it, times `0022` on those tasks, then times each list with each filter and prints
// the median of 5 runs. The database is dropped at the end.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { allTasksQuerySchema, backlogQuerySchema, taskListQuerySchema } from "@/lib/schemas/tasks";
import { humanActor } from "@/server/auth/actor";
import { MIGRATIONS_FOLDER, runMigrations } from "@/server/db/migrate";
import * as schema from "@/server/db/schema";
import { applyWorktreeTestDatabase } from "@/server/db/worktree";
import { loadEnvFiles } from "@/server/env-files";
import { createEpic } from "@/server/services/epics";
import { createLabel } from "@/server/services/labels";
import { createProject } from "@/server/services/projects";
import { listAllTasks, listBacklog, listTasks } from "@/server/services/tasks";

const TASKS = 50_000;
const RUNS = 5;
const SEARCH_MIGRATION = 22;

Object.assign(process.env, { NODE_ENV: "test" });
loadEnvFiles();
applyWorktreeTestDatabase(process.env);

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function withName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** A copy of the migrations folder whose journal stops before `upTo`. */
function migrationsBefore(upTo: number): string {
  const folder = mkdtempSync(path.join(tmpdir(), "opanel-migrations-"));
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { idx: number }[] };
  journal.entries = journal.entries.filter((entry) => entry.idx < upTo);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function time(run: () => Promise<unknown>): Promise<number> {
  const times: number[] = [];
  for (let index = 0; index < RUNS; index += 1) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  return median(times);
}

async function main(): Promise<void> {
  const base = process.env.DATABASE_URL;
  if (base === undefined) throw new Error("DATABASE_URL is not set");
  const name = `${new URL(base).pathname.slice(1).replace(/_test$/, "")}_measure_test`;
  const admin = postgres(withName(base, "postgres"), { onnotice: () => undefined, max: 1 });
  await admin.unsafe(`drop database if exists "${name}"`);
  await admin.unsafe(`create database "${name}"`);
  const client = postgres(withName(base, name), { onnotice: () => undefined });
  const db = drizzle({ client, schema });
  const before = migrationsBefore(SEARCH_MIGRATION);
  try {
    await runMigrations(db, before);

    const [account] = await db.execute<{ id: string }>(sql`
      insert into accounts (kind, name, email, role)
      values ('human', 'Measurer', 'measure@example.com', 'manager') returning id`);
    if (!account) throw new Error("no account");
    const actor = humanActor({ accountId: account.id, role: "manager" });
    const project = await createProject(actor, { key: "OPA", name: "Measure" }, db);
    const labels = [];
    for (let index = 0; index < 20; index += 1) {
      labels.push(
        await createLabel(actor, "OPA", { name: `label ${String(index)}`, colour: "gray" }, db),
      );
    }
    const epics = [];
    for (let index = 0; index < 5; index += 1) {
      epics.push(await createEpic(actor, "OPA", { title: `Epic ${String(index)}` }, db));
    }

    say(`Filling ${String(TASKS)} tasks…`);
    await db.execute(sql`select setseed(0.116)`);
    await db.execute(sql`
      with words(w) as (
        select unnest(array['login', 'checkout', 'safari', 'payment', 'dashboard', 'export',
          'timeout', 'crash', 'button', 'release', 'notes', 'search', 'filter', 'board',
          'invoice', 'report', 'mobile', 'profile', 'upload', 'session'])
      ),
      cols as (
        select id, row_number() over (order by position) as n from columns
        where project_id = ${project.id}
      )
      insert into tasks (project_id, number, title, description, type, priority, due_date,
        column_id, position, reporter_account_id, epic_id)
      select ${project.id}, i,
        (select string_agg(w, ' ') from (select w from words order by random() limit 4) x),
        (select string_agg(w, ' ') from (select w from words order by random() limit 12) x),
        (array['task', 'bug', 'story'])[1 + i % 3],
        (array['none', 'low', 'medium', 'high', 'urgent'])[1 + i % 5],
        case when i % 4 = 0 then null else date '2030-01-01' + (i % 365) end,
        case when i % 10 = 0 then null else (select id from cols where n = 1 + i % 3) end,
        lpad(i::text, 8, '0'),
        ${account.id},
        case when i % 7 = 0 then ${epics[0]?.id ?? null}::uuid else null end
      from generate_series(1, ${TASKS}) as i`);
    await db.execute(
      sql`update projects set next_task_number = ${TASKS + 1} where id = ${project.id}`,
    );
    await db.execute(sql`
      insert into task_labels (task_id, label_id)
      select t.id, ${labels[0]?.id ?? null}::uuid from tasks t where t.number % 5 = 0`);
    await db.execute(sql`analyze`);

    const start = performance.now();
    await runMigrations(db);
    say(`Migration 0022 on ${String(TASKS)} tasks: ${(performance.now() - start).toFixed(0)} ms`);
    await db.execute(sql`analyze`);
    const [size] = await db.execute<{ size: string }>(
      sql`select pg_size_pretty(pg_total_relation_size('tasks')) as size`,
    );
    say(`Table tasks with its indexes: ${size?.size ?? "?"}`);

    const cases: [string, Record<string, string | string[]>][] = [
      ["no filter", {}],
      ["type", { type: "bug" }],
      ["priority, repeated", { priority: ["high", "urgent"] }],
      ["category", { category: "in_progress" }],
      ["done=false", { done: "false" }],
      ["assignee none", { assigneeAccountId: "none" }],
      ["reporter me", { reporterAccountId: "me" }],
      ["reporterKind", { reporterKind: "agent" }],
      ["label", { labelId: labels[0]?.id ?? "" }],
      ["epic", { epicId: epics[0]?.id ?? "" }],
      ["due range", { dueFrom: "2030-03-01", dueTo: "2030-03-31" }],
      ["q, a common word", { q: "login" }],
      ["q, two words", { q: "safari checkout" }],
      ["q, a two-letter prefix", { q: "da" }],
      ["q, no match", { q: "zebra" }],
      ["q and filters", { q: "crash pay", type: "bug", priority: "urgent" }],
      ["a key", { q: "OPA-25000" }],
    ];
    say("\nList                         board ms  backlog ms");
    for (const [label, query] of cases) {
      const boardMs = await time(() =>
        listTasks(actor, "OPA", taskListQuerySchema.parse(query), db),
      );
      const backlogMs = await time(() =>
        listBacklog(actor, "OPA", backlogQuerySchema.parse(query), db),
      );
      say(
        `${label.padEnd(28)} ${boardMs.toFixed(1).padStart(8)}  ${backlogMs.toFixed(1).padStart(10)}`,
      );
    }

    // The list across projects (WS-118 section 7): the tasks spread over 5 projects.
    for (const key of ["WEB", "API", "OPS", "DOC"]) {
      await createProject(actor, { key, name: key }, db);
    }
    await db.execute(sql`
      with targets as (
        select p.id as project_id, row_number() over (order by p.key) as n,
          (select c.id from columns c where c.project_id = p.id order by c.position limit 1)
            as column_id
        from projects p where p.key <> 'OPA'
      )
      update tasks t set project_id = targets.project_id,
        column_id = case when t.column_id is null then null else targets.column_id end
      from targets where targets.n = t.number % 5 and t.number % 5 <> 0`);
    await db.execute(sql`analyze`);

    say("\nAcross projects               first ms  11th page ms");
    const sorts = ["key", "title", "priority", "dueDate", "created", "updated"].flatMap((field) => [
      field,
      `-${field}`,
    ]);
    const filters: [string, Record<string, string>][] = [
      ["", {}],
      [" priority", { priority: "urgent" }],
      [" q", { q: "login" }],
    ];
    for (const sort of sorts) {
      for (const [suffix, filter] of filters) {
        const query = (cursor?: string) =>
          allTasksQuerySchema.parse({ sort, ...filter, ...(cursor ? { cursor } : {}) });
        const firstMs = await time(() => listAllTasks(actor, query(), db));
        let cursor: string | undefined;
        for (let page = 0; page < 10; page += 1) {
          cursor = (await listAllTasks(actor, query(cursor), db)).nextCursor ?? undefined;
          if (cursor === undefined) break;
        }
        const middleMs =
          cursor === undefined
            ? Number.NaN
            : await time(() => listAllTasks(actor, query(cursor), db));
        say(
          `${(sort + suffix).padEnd(28)} ${firstMs.toFixed(1).padStart(8)}  ${middleMs.toFixed(1).padStart(12)}`,
        );
      }
    }
  } finally {
    rmSync(before, { recursive: true, force: true });
    await client.end();
    await admin.unsafe(`drop database if exists "${name}"`);
    await admin.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
