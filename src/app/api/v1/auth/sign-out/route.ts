import { signOutContract } from "@/lib/schemas/auth";
import { noContent, route } from "@/server/http/route";
import { signOut } from "@/server/services/sign-in";

// Authentication only (WS-015): it acts on the caller's own session. Its response clears
// the session cookie, so route() adds no refreshed one.
export const dynamic = "force-dynamic";

export const POST = route(signOutContract, async (request, _context, { actor }) => {
  return noContent(await signOut({ actor, headers: request.headers }));
});
