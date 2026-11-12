import { buildOpenApiDocument } from "@/lib/openapi/document";

// Public endpoint (WS-006). The document only changes with the code, so it is built once.
export const dynamic = "force-static";

export function GET(): Response {
  return Response.json(buildOpenApiDocument());
}
