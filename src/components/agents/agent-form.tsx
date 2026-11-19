"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type Agent,
  type CreateAgentRequest,
  scopesOfRole,
  type UpdateAgentRequest,
} from "@/lib/schemas/agents";
import { AGENT_ROLES, type AgentRole, type AgentScope } from "@/lib/schemas/permissions";

import { ApiFailure, createAgent, listAllProjects, type ProjectChoice, updateAgent } from "./api";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, SCOPE_LABELS } from "./labels";

type Field = "name" | "description" | "role" | "scopes" | "projectIds";
const FIELDS: readonly string[] = ["name", "description", "role", "scopes", "projectIds"];

type Mode = { kind: "create" } | { kind: "edit"; agent: Agent };

interface Draft {
  name: string;
  description: string;
  role: AgentRole;
  scopes: AgentScope[];
  allProjects: boolean;
  projectIds: string[];
}

function draftOf(mode: Mode): Draft {
  if (mode.kind === "create") {
    return {
      name: "",
      description: "",
      role: "qa_agent",
      scopes: [...scopesOfRole("qa_agent")],
      allProjects: true,
      projectIds: [],
    };
  }
  const { agent } = mode;
  return {
    name: agent.name,
    description: agent.description ?? "",
    role: agent.role,
    scopes: [...agent.scopes],
    allProjects: agent.projectIds === null,
    projectIds: [...(agent.projectIds ?? [])],
  };
}

function sorted<Item extends string>(items: readonly Item[]): Item[] {
  return [...items].sort();
}

/** The fields of a request as the draft says them. */
function requestOf(draft: Draft): CreateAgentRequest {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() === "" ? null : draft.description.trim(),
    role: draft.role,
    scopes: sorted(draft.scopes),
    projectIds: draft.allProjects ? null : sorted(draft.projectIds),
  };
}

/** Only what changed, for a `PATCH` (WS-077 section 4). */
function changesOf(agent: Agent, draft: Draft): UpdateAgentRequest | null {
  const next = requestOf(draft);
  const changes: Record<string, unknown> = {};
  if (next.name !== agent.name) changes.name = next.name;
  if (next.description !== agent.description) changes.description = next.description;
  if (next.role !== agent.role) changes.role = next.role;
  if (JSON.stringify(next.scopes) !== JSON.stringify(sorted(agent.scopes))) {
    changes.scopes = next.scopes;
  }
  const before = agent.projectIds === null ? null : sorted(agent.projectIds);
  if (JSON.stringify(next.projectIds) !== JSON.stringify(before)) {
    changes.projectIds = next.projectIds;
  }
  return Object.keys(changes).length === 0 ? null : changes;
}

/**
 * "New agent" or "Edit", and the dialog they open (WS-077 section 4). Only the role's own
 * scopes are offered; changing the role drops the scopes the new one lacks and checks
 * nothing new (WS-075 question 3).
 */
export function AgentFormDialog({
  mode,
  onSaved,
}: Readonly<{ mode: Mode; onSaved: (agent: Agent) => void }>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(mode));
  const [projects, setProjects] = useState<ProjectChoice[] | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const creating = mode.kind === "create";
  const prefix = creating ? "new-agent" : "edit-agent";

  function openChanged(next: boolean) {
    setOpen(next);
    if (next) {
      setDraft(draftOf(mode));
      setErrors({});
      setFormError(null);
      if (projects === null) {
        listAllProjects().then(setProjects, () => {
          setFormError("Could not load the projects. Close and try again.");
        });
      }
    }
  }

  function change(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function chooseRole(role: AgentRole) {
    const allowed = scopesOfRole(role);
    change({ role, scopes: draft.scopes.filter((scope) => allowed.includes(scope)) });
  }

  function toggle<Item extends string>(items: readonly Item[], item: Item, on: boolean): Item[] {
    return on
      ? [...items.filter((other) => other !== item), item]
      : items.filter((other) => other !== item);
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (draft.name.trim() === "") {
      setErrors({ name: "Enter a name." });
      return;
    }
    setErrors({});
    setPending(true);
    try {
      let saved: Agent;
      if (mode.kind === "create") {
        saved = await createAgent(requestOf(draft));
      } else {
        const changes = changesOf(mode.agent, draft);
        saved = changes === null ? mode.agent : await updateAgent(mode.agent.id, changes);
      }
      setOpen(false);
      onSaved(saved);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "agent_name_taken") {
        setErrors({ name: "Another agent already has this name." });
      } else if (error instanceof ApiFailure && error.status === 400) {
        const next: Partial<Record<Field, string>> = {};
        for (const fieldError of error.errors) {
          if (FIELDS.includes(fieldError.path)) next[fieldError.path as Field] = fieldError.message;
        }
        setErrors(next);
        if (Object.keys(next).length === 0) setFormError("Please check the details and try again.");
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  const offered = scopesOfRole(draft.role);

  return (
    <Dialog open={open} onOpenChange={openChanged}>
      <DialogTrigger asChild>
        <Button variant={creating ? "default" : "outline"}>
          {creating ? "New agent" : "Edit"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{creating ? "New agent" : "Edit agent"}</DialogTitle>
          <DialogDescription>
            An agent is a program that uses Opanel&apos;s API with a token. It can do only what its
            scopes and projects allow.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-5" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor={`${prefix}-name`} className="text-sm font-medium">
              Name
            </label>
            <Input
              id={`${prefix}-name`}
              value={draft.name}
              maxLength={80}
              onChange={(event) => {
                change({ name: event.target.value });
              }}
              aria-invalid={errors.name === undefined ? undefined : true}
              autoComplete="off"
            />
            {errors.name !== undefined && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={`${prefix}-description`} className="text-sm font-medium">
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              id={`${prefix}-description`}
              value={draft.description}
              maxLength={500}
              onChange={(event) => {
                change({ description: event.target.value });
              }}
            />
            {errors.description !== undefined && (
              <p className="text-sm text-destructive">{errors.description}</p>
            )}
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Role</legend>
            {AGENT_ROLES.map((role) => (
              <div key={role} className="flex items-start gap-2">
                <input
                  type="radio"
                  id={`${prefix}-role-${role}`}
                  name={`${prefix}-role`}
                  className="mt-1"
                  checked={draft.role === role}
                  onChange={() => {
                    chooseRole(role);
                  }}
                  aria-describedby={`${prefix}-role-${role}-hint`}
                />
                <div className="grid">
                  <label htmlFor={`${prefix}-role-${role}`} className="text-sm">
                    {ROLE_LABELS[role]}
                  </label>
                  <span
                    id={`${prefix}-role-${role}-hint`}
                    className="text-sm text-muted-foreground"
                  >
                    {ROLE_DESCRIPTIONS[role]}
                  </span>
                </div>
              </div>
            ))}
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Scopes</legend>
            {offered.map((scope) => {
              const id = `${prefix}-scope-${scope.replace(":", "-")}`;
              return (
                <div key={scope} className="flex items-start gap-2">
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    checked={draft.scopes.includes(scope)}
                    onCheckedChange={(checked) => {
                      change({ scopes: toggle(draft.scopes, scope, checked === true) });
                    }}
                    aria-describedby={`${id}-hint`}
                  />
                  <div className="grid">
                    <label htmlFor={id} className="text-sm">
                      {SCOPE_LABELS[scope]}
                    </label>
                    <code id={`${id}-hint`} className="text-xs text-muted-foreground">
                      {scope}
                    </code>
                  </div>
                </div>
              );
            })}
            {errors.scopes !== undefined && (
              <p className="text-sm text-destructive">{errors.scopes}</p>
            )}
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Projects</legend>
            {(
              [
                [true, "All projects"],
                [false, "Only these projects"],
              ] as const
            ).map(([all, label]) => (
              <div key={label} className="flex items-center gap-2">
                <input
                  type="radio"
                  id={`${prefix}-projects-${all ? "all" : "listed"}`}
                  name={`${prefix}-projects`}
                  checked={draft.allProjects === all}
                  onChange={() => {
                    change({ allProjects: all });
                  }}
                />
                <label htmlFor={`${prefix}-projects-${all ? "all" : "listed"}`} className="text-sm">
                  {label}
                </label>
              </div>
            ))}
            {!draft.allProjects && (
              <div className="ml-6 grid max-h-48 gap-2 overflow-y-auto">
                {projects === null && (
                  <p className="text-sm text-muted-foreground">Loading projects…</p>
                )}
                {projects?.length === 0 && (
                  <p className="text-sm text-muted-foreground">There are no projects yet.</p>
                )}
                {projects?.map((project) => {
                  const id = `${prefix}-project-${project.id}`;
                  return (
                    <div key={project.id} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={draft.projectIds.includes(project.id)}
                        onCheckedChange={(checked) => {
                          change({
                            projectIds: toggle(draft.projectIds, project.id, checked === true),
                          });
                        }}
                      />
                      <label htmlFor={id} className="text-sm">
                        {project.archived ? `${project.name} (archived)` : project.name}
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
            {errors.projectIds !== undefined && (
              <p className="text-sm text-destructive">{errors.projectIds}</p>
            )}
          </fieldset>

          {formError !== null && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {creating ? (pending ? "Creating…" : "Create agent") : pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
