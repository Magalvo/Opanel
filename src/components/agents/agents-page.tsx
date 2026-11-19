"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePagedList } from "@/hooks/use-paged-list";
import type { Agent } from "@/lib/schemas/agents";

import { AgentFormDialog } from "./agent-form";
import { listAgents } from "./api";
import { dateTime, ROLE_LABELS } from "./labels";

type Phase = "loading" | "error" | "ready";

/** The Admin "Agents" page (WS-077): a client of `/api/v1/agents`. */
export function AgentsPage() {
  const router = useRouter();
  const list = usePagedList<Agent>();
  const { items: agents, nextCursor, loadingMore, show } = list;
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");

  function showFirstPage(page: Awaited<ReturnType<typeof listAgents>>) {
    show(page);
    setPhase("ready");
  }

  useEffect(() => {
    let cancelled = false;
    listAgents().then(
      (page) => {
        if (cancelled) return;
        show(page);
        setPhase("ready");
      },
      () => {
        if (!cancelled) setPhase("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [show]);

  function retry() {
    setPhase("loading");
    listAgents().then(showFirstPage, () => {
      setPhase("error");
    });
  }

  async function loadMore() {
    try {
      await list.loadMore((cursor) => listAgents(cursor));
    } catch {
      setMessage("Could not load more agents. Try again.");
    }
  }

  // The next step after creating an agent is its first token, on its own page (question 1).
  function created(agent: Agent) {
    router.push(`/agents/${agent.id}`);
  }

  return (
    <div className="grid max-w-5xl gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        {phase === "ready" && agents.length > 0 && (
          <AgentFormDialog mode={{ kind: "create" }} onSaved={created} />
        )}
      </div>

      <div role="status" className="min-h-5 text-sm text-muted-foreground">
        {message}
      </div>

      {phase === "loading" && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Loading agents…</p>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {phase === "error" && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load agents.
          </p>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {phase === "ready" && agents.length === 0 && (
        <div className="grid justify-items-start gap-3 rounded-lg border border-dashed p-6">
          <p className="text-sm text-muted-foreground">
            No agents yet. Agents are programs that use Opanel&apos;s API with a token.
          </p>
          <AgentFormDialog mode={{ kind: "create" }} onSaved={created} />
        </div>
      )}

      {phase === "ready" && agents.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell>
                    <Link
                      href={`/agents/${agent.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {agent.name}
                    </Link>
                  </TableCell>
                  <TableCell>{ROLE_LABELS[agent.role]}</TableCell>
                  <TableCell>
                    {agent.status === "active" ? (
                      "Active"
                    ) : (
                      <Badge variant="secondary">Disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell>{dateTime(agent.lastSeenAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {nextCursor !== null && (
            <div>
              <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
