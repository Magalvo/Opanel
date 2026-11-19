import { notFound } from "next/navigation";

import { AgentDetail } from "@/components/agents/agent-detail";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

export const metadata = { title: "Agent" };

/** One agent and its tokens (WS-077), for `agents:manage` only, like the list. */
export default async function AgentRoute({ params }: { params: Promise<{ agentId: string }> }) {
  const { actor } = await requireAccount();
  if (!can(actor, "agents:manage")) {
    notFound();
  }
  const { agentId } = await params;

  return <AgentDetail agentId={agentId} />;
}
