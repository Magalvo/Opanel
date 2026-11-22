// Runs in every integration test worker, before its test file.
import { afterAll, beforeEach } from "vitest";

import { closeDb } from "@/server/db/client";
import { ensureWorkerDatabase, resetDatabase } from "@/server/db/testing";
import { applyWorktreeTestDatabase } from "@/server/db/worktree";
import { loadEnvFiles } from "@/server/env-files";

loadEnvFiles();
// The same worktree database as the global setup (WS-095), then this worker's copy of it
// (WS-097), before anything reads the environment. Files run in parallel, one database each.
applyWorktreeTestDatabase(process.env);
const template = process.env.DATABASE_URL;
if (template === undefined) {
  throw new Error("DATABASE_URL is not set: it comes from .env.test or the shell.");
}
process.env.DATABASE_URL = await ensureWorkerDatabase(template, process.env.VITEST_POOL_ID);

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});
