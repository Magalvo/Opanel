import { notFound } from "@/server/http/errors";
import { route } from "@/server/http/route";

// Public (WS-011): answers every path under /api/ that no endpoint matches with the 404
// problem body of canonical doc 0004 instead of an HTML page. It exposes no data, is not
// an endpoint, and is deliberately absent from the OpenAPI document.
const unknownPath = route(() => {
  throw notFound("There is no API endpoint at this path.");
});

export const GET = unknownPath;
export const HEAD = unknownPath;
export const POST = unknownPath;
export const PUT = unknownPath;
export const PATCH = unknownPath;
export const DELETE = unknownPath;
