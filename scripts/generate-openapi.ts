// Writes the committed copy of the API description: `pnpm openapi:generate`.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildOpenApiDocument } from "@/lib/openapi/document";

const file = path.join(process.cwd(), "docs/api/openapi.json");

mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
console.warn(`Wrote ${path.relative(process.cwd(), file)}`);
