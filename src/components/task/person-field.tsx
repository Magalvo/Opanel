"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Person } from "@/lib/schemas/people";

import { searchPeople } from "./api";

/** How long typing must pause before the people directory is asked (as WS-035). */
const SEARCH_DELAY_MS = 250;

export function personLabel(person: Person): string {
  return person.active ? person.name : `${person.name} (inactive)`;
}

/**
 * The task's person (WT-03 decisions 8 and 17): the current one, "No one", and a search of
 * the people directory that offers active people only, as plain buttons.
 */
export function PersonField({
  value,
  onChange,
  disabled,
}: Readonly<{
  value: Person | null;
  onChange: (person: Person | null) => void;
  disabled: boolean;
}>) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only the answer to the latest search is shown.
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const search = ++latest.current;
    if (q === "") return;
    const timer = setTimeout(() => {
      searchPeople(q).then(
        (page) => {
          if (search !== latest.current) return;
          setResults(page.items);
          setError(null);
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

  const offered =
    query.trim() === ""
      ? []
      : (results ?? []).filter((person) => person.active && person.id !== value?.id);

  return (
    <fieldset className="grid min-w-0 gap-1.5" disabled={disabled}>
      <legend className="text-sm font-medium">Person</legend>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{value === null ? "No one" : personLabel(value)}</span>
        {value !== null && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onChange(null);
            }}
          >
            No one
          </Button>
        )}
      </div>
      <label htmlFor={`${id}-search`} className="text-sm text-muted-foreground">
        Find a person
      </label>
      <Input
        id={`${id}-search`}
        type="search"
        value={query}
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
      {offered.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {offered.map((person) => (
            <li key={person.id}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Choose ${person.name}`}
                onClick={() => {
                  onChange(person);
                  setQuery("");
                  setResults(null);
                }}
              >
                {person.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
