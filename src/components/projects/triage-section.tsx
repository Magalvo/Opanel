"use client";

import { useEffect, useId, useState } from "react";

import { listAllTeams } from "@/components/teams/api";
import { Button } from "@/components/ui/button";
import { ApiFailure } from "@/lib/api-client";
import type { TeamSummary } from "@/lib/schemas/teams";
import { type TriageSettings, triageSettingsSchema } from "@/lib/schemas/triage";

import { getProject, getTriage, updateTriage } from "./api";
import { useProjectEventListener } from "./project-events";
import { useProject } from "./project-frame";

const SELECT =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm dark:bg-input/30";

const CONFLICT =
  "The project changed since these settings were loaded. The current settings are shown; make your change again.";
const CHANGED_WHILE_EDITING =
  "The project changed since these settings were loaded. Saving will show the current settings first.";

/** The four choices, each a team id or "" for no team. */
type Draft = Readonly<{ triageTeamId: string; frontend: string; api: string; backend: string }>;

const FIELDS: readonly (readonly [keyof Draft, string])[] = [
  ["triageTeamId", "Triage team"],
  ["frontend", "Frontend"],
  ["api", "API"],
  ["backend", "Backend"],
];

function draftOf(settings: TriageSettings): Draft {
  return {
    triageTeamId: settings.triageTeamId ?? "",
    frontend: settings.rules.frontend ?? "",
    api: settings.rules.api ?? "",
    backend: settings.rules.backend ?? "",
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return FIELDS.every(([field]) => a[field] === b[field]);
}

function teamOrNull(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * The project's triage team and the team of each layer (WS-092): read from and saved to
 * `/api/v1/projects/{key}/triage`, which shares the project's version (WS-087).
 */
export function TriageSection({
  announce,
  readOnly,
}: Readonly<{ announce: (message: string) => void; readOnly: boolean }>) {
  const id = useId();
  const { project, setProject } = useProject();
  const projectKey = project.key;
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  // The settings last shown, the choices on screen, and the version saves are based on.
  const [shown, setShown] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [version, setVersion] = useState(0);
  const [failedToLoad, setFailedToLoad] = useState(false);
  const [pending, setPending] = useState(false);
  const [stale, setStale] = useState(false);
  const dirty = shown !== null && draft !== null && !sameDraft(shown, draft);

  function show(settings: TriageSettings) {
    const loaded = draftOf(settings);
    setShown(loaded);
    setDraft(loaded);
    setVersion(settings.version);
    setStale(false);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([getTriage(projectKey), listAllTeams()]).then(
      ([settings, loadedTeams]) => {
        if (cancelled) return;
        const loaded = draftOf(settings);
        setTeams(loadedTeams);
        setShown(loaded);
        setDraft(loaded);
        setVersion(settings.version);
      },
      () => {
        if (!cancelled) setFailedToLoad(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

  async function load() {
    try {
      const [settings, loadedTeams] = await Promise.all([getTriage(projectKey), listAllTeams()]);
      setTeams(loadedTeams);
      show(settings);
      setFailedToLoad(false);
    } catch {
      setFailedToLoad(true);
    }
  }

  async function readTeams() {
    try {
      setTeams(await listAllTeams());
    } catch {
      // The list shown stays; the next reconnect or save reads it again.
    }
  }

  /** Shows the current settings unless there are unsaved choices, which are kept. */
  async function readSettings(keepUnsaved: boolean) {
    try {
      const settings = await getTriage(projectKey);
      if (!keepUnsaved) show(settings);
    } catch {
      // The project's next change or a reconnect reads them again.
    }
  }

  // Live (WS-092 section 4): a newer project version means the settings may have changed.
  // With nothing unsaved they are read again; with unsaved choices those and the version
  // are kept, so the next save gets the conflict and shows the current settings.
  useProjectEventListener({
    onEvent: (event) => {
      if (event.type !== "project.changed" || shown === null || event.version <= version) return;
      if (!dirty) {
        void readSettings(false);
      } else if (!stale) {
        setStale(true);
        announce(CHANGED_WHILE_EDITING);
      }
    },
    onReconnect: () => {
      if (shown === null) return;
      void readTeams();
      void readSettings(dirty);
    },
  });

  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft === null) return;
    setPending(true);
    try {
      show(
        await updateTriage(projectKey, {
          triageTeamId: teamOrNull(draft.triageTeamId),
          rules: {
            frontend: teamOrNull(draft.frontend),
            api: teamOrNull(draft.api),
            backend: teamOrNull(draft.backend),
          },
          version,
        }),
      );
      announce("Saved.");
      // The save bumped the project's version: bring the frame's project to it, so the
      // Details form saves on it without waiting for the event (WS-092 section 3).
      getProject(projectKey).then(setProject, () => undefined);
    } catch (failure) {
      const current =
        failure instanceof ApiFailure && failure.code === "version_conflict"
          ? triageSettingsSchema.safeParse((failure.body as { current?: unknown } | null)?.current)
          : null;
      if (current?.success) {
        show(current.data);
        announce(CONFLICT);
      } else if (failure instanceof ApiFailure && failure.code === "project_archived") {
        announce("The project is archived.");
      } else if (
        failure instanceof ApiFailure &&
        failure.status === 400 &&
        failure.errors.length > 0
      ) {
        announce("A team you chose no longer exists. The list of teams was refreshed.");
        void readTeams();
      } else {
        announce("Could not save. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-4">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        Triage
      </h2>
      <p className="text-sm text-muted-foreground">
        Bugs that agents report go to the team of their layer. Bugs of an unknown layer, or of a
        layer with no team, go to the triage team.
      </p>

      {failedToLoad && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load the triage settings.
          </p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}
      {(teams === null || draft === null) && !failedToLoad && (
        <p className="text-sm text-muted-foreground">Loading triage…</p>
      )}

      {teams !== null && draft !== null && (
        <form onSubmit={(event) => void save(event)} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map(([field, label]) => {
              const value = draft[field];
              const known = value === "" || teams.some((team) => team.id === value);
              return (
                <div key={field} className="grid gap-1.5">
                  <label htmlFor={`${id}-${field}`} className="text-sm font-medium">
                    {label}
                  </label>
                  <select
                    id={`${id}-${field}`}
                    className={SELECT}
                    value={value}
                    disabled={readOnly}
                    onChange={(event) => {
                      setDraft({ ...draft, [field]: event.target.value });
                    }}
                  >
                    <option value="">No team</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                    {!known && <option value={value}>Unknown team</option>}
                  </select>
                </div>
              );
            })}
          </div>
          <div>
            <Button type="submit" disabled={readOnly || pending}>
              Save
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
