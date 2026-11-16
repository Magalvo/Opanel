"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiFailure } from "@/lib/api-client";
import type { Person } from "@/lib/schemas/people";
import type { Team } from "@/lib/schemas/teams";

import { addMember, searchPeople } from "./api";

/** How long typing must pause before the people directory is asked. */
const SEARCH_DELAY_MS = 250;

/**
 * "Add member": a search of the people directory that offers active people who are not
 * members yet, as plain buttons (WS-035).
 */
export function AddMemberDialog({
  team,
  onAdded,
}: Readonly<{ team: Team; onAdded: (team: Team, person: Person) => void }>) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Only the answer to the latest search is shown.
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const search = ++latest.current;
    if (q === "") return;
    const timer = setTimeout(() => {
      searchPeople(q).then(
        (page) => {
          if (search === latest.current) setResults(page.items);
        },
        () => {
          if (search === latest.current) setError("Could not search people. Try again.");
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  // An empty search field shows nothing, whatever an earlier search found.
  const shown = query.trim() === "" ? null : results;
  const memberIds = new Set(team.members.map((member) => member.id));
  const offered = (shown ?? []).filter((person) => person.active && !memberIds.has(person.id));

  async function add(person: Person) {
    setError(null);
    setPending(true);
    try {
      const updated = await addMember(team.id, person.id);
      setOpen(false);
      onAdded(updated, person);
    } catch (failure) {
      setError(
        failure instanceof ApiFailure && failure.code === "account_inactive"
          ? `${person.name} is deactivated and cannot be added.`
          : `Could not add ${person.name}. Try again.`,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setResults(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Add member</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a member</DialogTitle>
          <DialogDescription>Find an active person by the start of their name.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <label htmlFor={fieldId} className="text-sm font-medium">
            Search people
          </label>
          <Input
            id={fieldId}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            autoComplete="off"
          />
        </div>
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {shown !== null && offered.length === 0 && (
          <p className="text-sm text-muted-foreground">Nobody to add matches “{query.trim()}”.</p>
        )}
        {offered.length > 0 && (
          <ul aria-label="People to add" className="grid max-h-64 gap-1 overflow-y-auto">
            {offered.map((person) => (
              <li key={person.id}>
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  disabled={pending}
                  aria-label={`Add ${person.name}`}
                  onClick={() => void add(person)}
                >
                  <span className="truncate">{person.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
