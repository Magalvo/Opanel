// Every unit test, in Node or under jsdom (WS-097). The DOM-only setup is vitest.setup.dom.ts.
import { loadEnvFiles } from "@/server/env-files";

// The committed .env.test, as the integration tests load it: every API response reads
// APP_URL (WS-067), and nothing here connects to the database it names.
loadEnvFiles();
