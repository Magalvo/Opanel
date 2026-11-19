import { notFound } from "next/navigation";

import { AgentsPage } from "@/components/agents/agents-page";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

export const metadata = { title: "Agents" };

/**
 * The Admin "Agents" page (WS-077). For anyone without `agents:manage` it is a plain
 * not-found page, so it does not confirm that it exists. The data is read by the browser
 * through `/api/v1/agents`, which enforces the same permission.
 */
export default async function AgentsRoute() {
  const { actor } = await requireAccount();
  if (!can(actor, "agents:manage")) {
    notFound();
  }

  return <AgentsPage />;
}
