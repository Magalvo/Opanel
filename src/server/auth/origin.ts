import { forbidden } from "@/server/http/errors";

/**
 * Cross-site request protection (canonical doc 0004 section 7). A state-changing request
 * that relies on the session cookie, which means one without an `Authorization` header,
 * must come from the app's own origin. A missing `Origin` is rejected too: browsers always
 * send it on such requests. Throws `forbidden` (`403`).
 */
export function assertSameOrigin(request: Request, appUrl: string): void {
  if (request.method === "GET" || request.method === "HEAD") {
    return;
  }
  if (request.headers.has("Authorization")) {
    return;
  }
  if (request.headers.get("Origin") !== new URL(appUrl).origin) {
    throw forbidden();
  }
}
