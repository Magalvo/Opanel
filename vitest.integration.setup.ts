// Runs in every integration test worker, before its test file.
import { afterAll, beforeEach } from "vitest";

import { closeDb } from "@/server/db/client";
import { resetDatabase } from "@/server/db/testing";
import { loadEnvFiles } from "@/server/env-files";

loadEnvFiles();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});
