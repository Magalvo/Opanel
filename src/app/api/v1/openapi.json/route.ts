import { buildOpenApiDocument } from "@/lib/openapi/document";
import { openApiContract } from "@/lib/schemas/openapi";
import { json, route } from "@/server/http/route";

// Public endpoint (WS-006). Rendered per request so that it carries the headers of every
// API response (WS-025); the document only changes with the code, so it is built once per
// process.
export const dynamic = "force-dynamic";

let document: ReturnType<typeof buildOpenApiDocument> | undefined;

export const GET = route(openApiContract, () => {
  document ??= buildOpenApiDocument();
  return json(document);
});
