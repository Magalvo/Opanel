"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Sprint } from "@/lib/schemas/sprints";
import { cn } from "@/lib/utils";

import { listCompletedSprints } from "./api";
import { SprintDates } from "./sprint-header";
import { SprintProgress } from "./sprint-progress";

type State = "closed" | "loading" | "error" | "ready";

/**
 * The completed sprints (WS-144 section 4): a disclosure, closed at first, that reads every
 * page of them when it opens. Each shows its dates and frozen progress, and links to the
 * list view filtered by it (WT-10 question 9).
 */
export function CompletedSprints({ projectKey }: Readonly<{ projectKey: string }>) {
  const id = useId();
  const [state, setState] = useState<State>("closed");
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const open = state !== "closed";

  async function load() {
    setState("loading");
    try {
      setSprints(await listCompletedSprints(projectKey));
      setState("ready");
    } catch {
      setState("error");
    }
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="grid w-full max-w-3xl gap-2 rounded-xl border p-2"
    >
      <h2 id={`${id}-heading`} className="font-medium">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => {
            if (open) setState("closed");
            else void load();
          }}
          className="inline-flex items-center gap-1 rounded-md px-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn("size-4 transition-transform", open && "rotate-90")}
          />
          Completed sprints
        </button>
      </h2>
      <div id={`${id}-panel`} hidden={!open} className="px-1">
        {state === "loading" && (
          <p className="text-sm text-muted-foreground">Loading the completed sprints…</p>
        )}
        {state === "error" && (
          <div className="flex items-center gap-2">
            <p role="alert" className="text-sm text-destructive">
              Could not load the completed sprints.
            </p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}
        {state === "ready" &&
          (sprints.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sprint is completed yet.</p>
          ) : (
            <ul className="grid gap-3">
              {sprints.map((sprint) => (
                <li key={sprint.id} className="grid gap-1">
                  <Link
                    href={`/tasks?projectId=${projectKey}&sprintId=${sprint.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {sprint.name}
                  </Link>
                  <SprintDates sprint={sprint} />
                  <SprintProgress progress={sprint.progress} />
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}
