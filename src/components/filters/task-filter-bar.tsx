"use client";

import { ChevronDownIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { TYPE_LABELS } from "@/components/board/task-card";
import { listLabels } from "@/components/labels/api";
import { listOpenEpics } from "@/components/task/api";
import { SEVERITY_LABELS } from "@/components/task/bug-labels";
import { localDate } from "@/components/task/due-date";
import { PRIORITY_LABELS } from "@/components/task/task-meta";
import { listAllTeams } from "@/components/teams/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PRIORITIES } from "@/lib/schemas/tasks";

import {
  chipsOf,
  type FilterKey,
  type FilterNames,
  isEmpty,
  type TaskFilter,
  withoutValue,
  withValue,
  withValues,
} from "./task-filter";

/** How long the search box waits after the last key before it filters (WS-120 section 3). */
export const SEARCH_DELAY_MS = 300;

interface Option {
  value: string;
  label: string;
}

/** A project of the Project menu: its key is the value a link carries. */
interface ProjectOption extends Option {
  /** Its id, so a link that names it by id gets a chip with its key. */
  id?: string;
}

interface Person {
  id: string;
  name: string;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** One menu of checkbox items, each adding or removing one value of `key`. */
function FilterMenu({
  name,
  filterKey,
  options,
  filter,
  onChange,
  onOpen,
  unavailable,
}: Readonly<{
  name: string;
  filterKey: FilterKey;
  options: readonly Option[];
  filter: TaskFilter;
  onChange: (filter: TaskFilter) => void;
  onOpen?: () => void;
  /** Why the menu offers no more than `options` here (WS-130 section 3). */
  unavailable?: string | undefined;
}>) {
  const values = filter[filterKey] ?? [];
  return (
    <DropdownMenu
      // Not modal: a menu of checkboxes leaves the page readable, and Radix would hide it
      // from assistive technology while focusable (axe aria-hidden-focus, WS-120).
      modal={false}
      onOpenChange={(open) => {
        if (open) onOpen?.();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={name}>
          {name}
          {values.length > 0 && <span aria-hidden="true">({values.length})</span>}
          <ChevronDownIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.length === 0 && unavailable === undefined ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Nothing to choose yet.</p>
        ) : (
          options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={values.includes(option.value)}
              onSelect={(event) => {
                event.preventDefault();
              }}
              onCheckedChange={(checked) => {
                onChange(
                  checked
                    ? withValue(filter, filterKey, option.value)
                    : withoutValue(filter, filterKey, option.value),
                );
              }}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
        {unavailable !== undefined && <DropdownMenuItem disabled>{unavailable}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The filter bar of the board, the backlog (WS-120 section 3) and the list view (WS-130
 * section 3): a search box, a menu per field, the active filters as chips, and a status.
 */
export function TaskFilterBar({
  filter,
  onChange,
  projectKey,
  projects,
  people,
  status,
  ignored,
}: Readonly<{
  filter: TaskFilter;
  onChange: (filter: TaskFilter) => void;
  /** The project whose labels and epics the menus offer; `null` for several projects. */
  projectKey: string | null;
  /** The projects to choose from, by key: only the list across projects has this menu. */
  projects?: readonly ProjectOption[];
  /** The people assigned to a task on the page. */
  people: readonly Person[];
  /** Shown with the active filters, such as "12 of 140 tasks match.". */
  status?: string;
  ignored: readonly string[];
}>) {
  const id = useId();
  // Labels and epics belong to one project: read again when the project changes.
  const [labelsOf, setLabels] = useState<{ key: string; options: Option[] } | null>(null);
  const [epicsOf, setEpics] = useState<{ key: string; options: Option[] } | null>(null);
  const labels = labelsOf !== null && labelsOf.key === projectKey ? labelsOf.options : null;
  const epics = epicsOf !== null && epicsOf.key === projectKey ? epicsOf.options : null;
  const [teams, setTeams] = useState<Option[] | null>(null);

  const [text, setText] = useState(filter.q?.[0] ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ filter, onChange });
  useEffect(() => {
    latest.current = { filter, onChange };
  });
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  function typed(value: string) {
    setText(value);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const trimmed = value.trim();
      latest.current.onChange(
        withValues(latest.current.filter, "q", /[\p{L}\p{N}]/u.test(trimmed) ? [trimmed] : []),
      );
    }, SEARCH_DELAY_MS);
  }

  // The chips may remove `q` from outside the box; the box follows.
  const q = filter.q?.[0] ?? "";
  const [shownQ, setShownQ] = useState(q);
  if (shownQ !== q) {
    setShownQ(q);
    setText(q);
  }

  // What has been asked for already, so a menu opened twice, or a render while an answer is
  // on its way, asks once.
  const requested = useRef(new Set<string>());

  function once(what: string): boolean {
    if (requested.current.has(what)) return false;
    requested.current.add(what);
    return true;
  }

  function loadLabels() {
    if (labels !== null || projectKey === null || !once(`labels:${projectKey}`)) return;
    const key = projectKey;
    listLabels(key).then(
      (page) => {
        setLabels({
          key,
          options: page.items.map((label) => ({ value: label.id, label: label.name })),
        });
      },
      () => undefined,
    );
  }

  function loadEpics() {
    if (epics !== null || projectKey === null || !once(`epics:${projectKey}`)) return;
    const key = projectKey;
    listOpenEpics(key).then(
      (list) => {
        setEpics({ key, options: list.map((epic) => ({ value: epic.id, label: epic.title })) });
      },
      () => undefined,
    );
  }

  function loadTeams() {
    if (teams !== null || !once("teams")) return;
    listAllTeams().then(
      (list) => {
        setTeams(list.map((team) => ({ value: team.id, label: team.name })));
      },
      () => undefined,
    );
  }

  // A link's chips need the names of what it holds: read them without waiting for a menu
  // (WS-130 deviation 1). A filter that names none reads nothing, as before.
  const named = (key: FilterKey) => (filter[key] ?? []).some((value) => value !== "none");
  const needsLabels = named("labelId");
  const needsEpics = named("epicId");
  const needsTeams = named("assigneeTeamId");
  useEffect(() => {
    if (needsLabels) loadLabels();
    if (needsEpics) loadEpics();
    if (needsTeams) loadTeams();
  });

  const names: FilterNames = {
    projects: new Map(
      (projects ?? []).flatMap((option) =>
        option.id === undefined ? [] : [[option.id, option.value] as const],
      ),
    ),
    labels: new Map((labels ?? []).map((option) => [option.value, option.label])),
    epics: new Map((epics ?? []).map((option) => [option.value, option.label])),
    teams: new Map((teams ?? []).map((option) => [option.value, option.label])),
    people: new Map(people.map((person) => [person.id, person.name])),
  };
  const chips = chipsOf(filter, names);

  const today = new Date();
  const yesterday = localDate(addDays(today, -1));
  const overdue = filter.dueTo?.[0] === yesterday && filter.done?.[0] === "false";
  const weekFrom = localDate(today);
  const weekTo = localDate(addDays(today, 7));
  const thisWeek = filter.dueFrom?.[0] === weekFrom && filter.dueTo?.[0] === weekTo;

  function reporterOption(kind: "me" | "human" | "agent", checked: boolean): TaskFilter {
    if (kind === "me") {
      return checked
        ? withValue(filter, "reporterAccountId", "me")
        : withoutValue(filter, "reporterAccountId", "me");
    }
    return withValues(filter, "reporterKind", checked ? [kind] : []);
  }

  return (
    <div role="search" aria-label="Filter tasks" className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <label htmlFor={`${id}-q`} className="sr-only">
            Search tasks
          </label>
          <Input
            id={`${id}-q`}
            type="search"
            value={text}
            placeholder="Search tasks"
            className="pl-8"
            onChange={(event) => {
              typed(event.target.value);
            }}
          />
        </div>
        {projects !== undefined && (
          <FilterMenu
            name="Project"
            filterKey="projectId"
            filter={filter}
            onChange={onChange}
            options={projects}
          />
        )}
        <FilterMenu
          name="Type"
          filterKey="type"
          filter={filter}
          onChange={onChange}
          options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <FilterMenu
          name="Priority"
          filterKey="priority"
          filter={filter}
          onChange={onChange}
          options={PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }))}
        />
        <FilterMenu
          name="Severity"
          filterKey="severity"
          filter={filter}
          onChange={onChange}
          options={Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <FilterMenu
          name="Label"
          filterKey="labelId"
          filter={filter}
          onChange={onChange}
          onOpen={loadLabels}
          options={labels ?? []}
          unavailable={projectKey === null ? "Choose one project to filter by label" : undefined}
        />
        <FilterMenu
          name="Epic"
          filterKey="epicId"
          filter={filter}
          onChange={onChange}
          onOpen={loadEpics}
          options={[{ value: "none", label: "No epic" }, ...(epics ?? [])]}
          unavailable={projectKey === null ? "Choose one project to filter by epic" : undefined}
        />
        <FilterMenu
          name="Team"
          filterKey="assigneeTeamId"
          filter={filter}
          onChange={onChange}
          onOpen={loadTeams}
          options={[{ value: "none", label: "No team" }, ...(teams ?? [])]}
        />
        <FilterMenu
          name="Assignee"
          filterKey="assigneeAccountId"
          filter={filter}
          onChange={onChange}
          options={[
            { value: "me", label: "Me" },
            { value: "none", label: "Unassigned" },
            ...people.map((person) => ({ value: person.id, label: person.name })),
          ]}
        />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Reporter">
              Reporter
              <ChevronDownIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(
              [
                ["me", "Me", filter.reporterAccountId?.includes("me") ?? false],
                ["human", "People", filter.reporterKind?.[0] === "human"],
                ["agent", "Agents", filter.reporterKind?.[0] === "agent"],
              ] as const
            ).map(([kind, label, checked]) => (
              <DropdownMenuCheckboxItem
                key={kind}
                checked={checked}
                onSelect={(event) => {
                  event.preventDefault();
                }}
                onCheckedChange={(next) => {
                  onChange(reporterOption(kind, next));
                }}
              >
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Due">
              Due
              <ChevronDownIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuCheckboxItem
              checked={overdue}
              onSelect={(event) => {
                event.preventDefault();
              }}
              onCheckedChange={(next) => {
                const cleared = withValues(withValues(filter, "dueFrom", []), "dueTo", []);
                onChange(
                  next
                    ? withValues(withValues(cleared, "dueTo", [yesterday]), "done", ["false"])
                    : withValues(cleared, "done", []),
                );
              }}
            >
              Overdue
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={thisWeek}
              onSelect={(event) => {
                event.preventDefault();
              }}
              onCheckedChange={(next) => {
                const cleared = withValues(withValues(filter, "dueFrom", []), "dueTo", []);
                onChange(
                  next
                    ? withValues(withValues(cleared, "dueFrom", [weekFrom]), "dueTo", [weekTo])
                    : cleared,
                );
              }}
            >
              Due in the next 7 days
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {ignored.length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          Some filters in this link were not understood and are ignored.
        </p>
      )}

      {!isEmpty(filter) && (
        <div className="flex flex-wrap items-center gap-2">
          <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
            {chips.map((chip) => (
              <li key={`${chip.key}=${chip.value}`}>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Remove ${chip.label}`}
                  onClick={() => {
                    onChange(chip.without);
                  }}
                >
                  {chip.label}
                  <XIcon aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange({});
            }}
          >
            Clear filters
          </Button>
          {status !== undefined && (
            <p role="status" aria-label="Filter results" className="text-sm text-muted-foreground">
              {status}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
