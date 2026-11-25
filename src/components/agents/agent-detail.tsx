"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AccountName } from "@/components/account-name";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import type { Agent, ApiToken } from "@/lib/schemas/agents";

import { AgentFormDialog } from "./agent-form";
import {
  ApiFailure,
  getAgent,
  listAllProjects,
  listTokens,
  type ProjectChoice,
  revokeToken,
  updateAgent,
} from "./api";
import { dateTime, ROLE_LABELS, SCOPE_LABELS, TOKEN_STATUS_LABELS } from "./labels";
import { TokenDialog } from "./token-dialog";

type Confirmation =
  { kind: "disable" } | { kind: "reenable" } | { kind: "revoke"; token: ApiToken };

function confirmationText(asking: Confirmation, agent: Agent) {
  switch (asking.kind) {
    case "disable":
      return {
        title: `Disable ${agent.name}?`,
        description: "Its tokens stop working at once. Nothing is deleted; you can re-enable it.",
        action: "Disable",
        destructive: true,
      };
    case "reenable":
      return {
        title: `Re-enable ${agent.name}?`,
        description: "Its tokens that are neither revoked nor expired work again at once.",
        action: "Re-enable",
        destructive: false,
      };
    case "revoke":
      return {
        title: `Revoke the token "${asking.token.name}"?`,
        description: "It stops working at once. This cannot be undone.",
        action: "Revoke",
        destructive: true,
      };
  }
}

/** One agent and its tokens (WS-077 section 5). */
export function AgentDetail({ agentId }: Readonly<{ agentId: string }>) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [projects, setProjects] = useState<ProjectChoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const reloadTokens = useCallback(() => {
    listTokens(agentId).then(
      (list) => {
        setTokens(list.items);
      },
      () => {
        setMessage("Could not load the tokens. Reload the page.");
      },
    );
  }, [agentId]);

  useEffect(() => {
    let cancelled = false;
    getAgent(agentId).then(
      (loaded) => {
        if (!cancelled) setAgent(loaded);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    reloadTokens();
    return () => {
      cancelled = true;
    };
  }, [agentId, reloadTokens]);

  // Names for a restricted agent's projects.
  const listed = agent?.projectIds ?? null;
  useEffect(() => {
    if (listed === null || listed.length === 0 || projects !== null) return;
    listAllProjects().then(setProjects, () => undefined);
  }, [listed, projects]);

  async function setActive(active: boolean) {
    if (agent === null) return;
    try {
      setAgent(await updateAgent(agent.id, { active }));
      setMessage(active ? `${agent.name} was re-enabled.` : `${agent.name} was disabled.`);
    } catch {
      setMessage(active ? "Could not re-enable. Try again." : "Could not disable. Try again.");
    }
  }

  async function revoke(token: ApiToken) {
    try {
      await revokeToken(agentId, token.id);
      setMessage(`The token "${token.name}" was revoked.`);
      reloadTokens();
    } catch (error) {
      setMessage(
        error instanceof ApiFailure && error.status === 404
          ? "That token no longer exists."
          : "Could not revoke the token. Try again.",
      );
    }
  }

  function confirmed() {
    const current = confirmation;
    setConfirmation(null);
    if (current?.kind === "disable") void setActive(false);
    if (current?.kind === "reenable") void setActive(true);
    if (current?.kind === "revoke") void revoke(current.token);
  }

  if (failed) {
    return (
      <div className="grid max-w-5xl gap-2">
        <p role="alert" className="text-sm text-destructive">
          Could not load this agent.
        </p>
        <Link href="/agents" className="text-sm underline underline-offset-4">
          Back to agents
        </Link>
      </div>
    );
  }

  if (agent === null) {
    return (
      <div className="grid max-w-5xl gap-2">
        <p className="text-sm text-muted-foreground">Loading the agent…</p>
        <Skeleton className="h-9 w-64" />
      </div>
    );
  }

  const active = agent.status === "active";
  const text = confirmation === null ? null : confirmationText(confirmation, agent);
  const projectNames =
    agent.projectIds === null
      ? "All projects"
      : agent.projectIds.length === 0
        ? "No project"
        : agent.projectIds
            .map((id) => projects?.find((project) => project.id === id)?.name ?? "…")
            .join(", ");

  return (
    <div className="grid max-w-5xl gap-6">
      <div className="grid gap-1">
        <Link
          href="/agents"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Agents
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <AccountName account={{ name: agent.name, kind: "agent" }} />
            {!active && <Badge variant="secondary">Disabled</Badge>}
          </h1>
          <div className="flex gap-2">
            <AgentFormDialog
              mode={{ kind: "edit", agent }}
              onSaved={(saved) => {
                setAgent(saved);
                setMessage("Saved.");
              }}
            />
            <Button
              variant={active ? "destructive" : "outline"}
              onClick={() => {
                setConfirmation({ kind: active ? "disable" : "reenable" });
              }}
            >
              {active ? "Disable agent" : "Re-enable agent"}
            </Button>
          </div>
        </div>
      </div>

      <div role="status" className="min-h-5 text-sm text-muted-foreground">
        {message}
      </div>

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="font-medium">Role</dt>
        <dd>{ROLE_LABELS[agent.role]}</dd>
        <dt className="font-medium">Description</dt>
        <dd>{agent.description ?? <span className="text-muted-foreground">None</span>}</dd>
        <dt className="font-medium">Scopes</dt>
        <dd>
          {agent.scopes.length === 0 ? (
            <span className="text-muted-foreground">None</span>
          ) : (
            <ul className="grid gap-0.5">
              {agent.scopes.map((scope) => (
                <li key={scope}>
                  {SCOPE_LABELS[scope]}{" "}
                  <code className="text-xs text-muted-foreground">{scope}</code>
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dt className="font-medium">Projects</dt>
        <dd>{projectNames}</dd>
        <dt className="font-medium">Created</dt>
        <dd>{dateTime(agent.createdAt)}</dd>
        <dt className="font-medium">Last seen</dt>
        <dd>{dateTime(agent.lastSeenAt)}</dd>
      </dl>

      <section className="grid gap-3" aria-labelledby="tokens-heading">
        <div className="flex items-center justify-between gap-2">
          <h2 id="tokens-heading" className="text-lg font-semibold">
            Tokens
          </h2>
          <TokenDialog agentId={agent.id} disabled={!active} onCreated={reloadTokens} />
        </div>
        {!active && (
          <p className="text-sm text-muted-foreground">
            A disabled agent gets no new token. Re-enable it first.
          </p>
        )}
        {tokens === null && <Skeleton className="h-9 w-full" />}
        {tokens?.length === 0 && <p className="text-sm text-muted-foreground">No tokens yet.</p>}
        {tokens !== null && tokens.length > 0 && (
          <Table aria-label="Tokens">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => (
                <TableRow key={token.id}>
                  <TableCell className="font-medium">{token.name}</TableCell>
                  <TableCell>{dateTime(token.createdAt)}</TableCell>
                  <TableCell>{dateTime(token.expiresAt)}</TableCell>
                  <TableCell>{dateTime(token.lastUsedAt)}</TableCell>
                  <TableCell>
                    {token.status === "active" ? (
                      TOKEN_STATUS_LABELS.active
                    ) : (
                      <Badge variant="secondary">{TOKEN_STATUS_LABELS[token.status]}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {token.status === "active" && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Revoke ${token.name}`}
                        onClick={() => {
                          setConfirmation({ kind: "revoke", token });
                        }}
                      >
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        {text !== null && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{text.title}</AlertDialogTitle>
              <AlertDialogDescription>{text.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant={text.destructive ? "destructive" : "default"}
                onClick={confirmed}
              >
                {text.action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}
