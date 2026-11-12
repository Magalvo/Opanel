import { defineConfig } from "drizzle-kit";

import { parseEnv } from "./src/server/env";
import { loadEnvFiles } from "./src/server/env-files";

loadEnvFiles();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./src/server/db/migrations",
  dbCredentials: {
    url: parseEnv(process.env).DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
