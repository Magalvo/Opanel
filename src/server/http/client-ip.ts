import { isIP } from "node:net";

/**
 * The client address from the header the operator configured (`CLIENT_IP_HEADER`), or null
 * when none is configured or the header does not hold an IP address. Without a configured
 * header nothing is read, because any client can send `X-Forwarded-For` itself. Of a list
 * the last entry is used: the one the trusted proxy appended.
 */
export function clientIpFrom(request: Request, headerName: string | undefined): string | null {
  if (headerName === undefined) {
    return null;
  }
  const last = request.headers.get(headerName)?.split(",").at(-1)?.trim() ?? "";
  return isIP(last) === 0 ? null : last;
}
