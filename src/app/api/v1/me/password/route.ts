import { changePasswordContract, changePasswordRequestSchema } from "@/lib/schemas/auth";
import { noContent, readJson, route } from "@/server/http/route";
import { changeOwnPassword } from "@/server/services/profile";

// Authentication only (WS-021): it changes the caller's own password.
export const dynamic = "force-dynamic";

export const POST = route(
  changePasswordContract,
  async (request, _context, { actor, sessionId }) => {
    const body = await readJson(request, changePasswordRequestSchema);

    await changeOwnPassword(actor, { sessionId, ...body });
    return noContent();
  },
);
