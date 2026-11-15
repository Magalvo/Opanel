"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type Project, projectNameSchema, projectSchema } from "@/lib/schemas/projects";

import { ApiFailure, updateProject } from "./api";

export interface DetailsSectionProps {
  project: Project;
  archived: boolean;
  onProject: (project: Project) => void;
  onMessage: (message: string) => void;
}

/** The project's name and description, saved with the `version` the page holds (WS-036). */
export function DetailsSection({
  project,
  archived,
  onProject,
  onMessage,
}: Readonly<DetailsSectionProps>) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const changed = name !== project.name || description !== project.description;

  function take(next: Project) {
    onProject(next);
    setName(next.name);
    setDescription(next.description);
  }

  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedName = projectNameSchema.safeParse(name);
    if (!parsedName.success) {
      setNameError("A name is required, up to 100 characters.");
      return;
    }
    setNameError(null);
    setPending(true);

    try {
      const saved = await updateProject(project.id, {
        ...(parsedName.data === project.name ? {} : { name: parsedName.data }),
        ...(description === project.description ? {} : { description }),
        version: project.version,
      });
      take(saved);
      onMessage("Saved the details.");
    } catch (failure) {
      const current =
        failure instanceof ApiFailure && failure.code === "version_conflict"
          ? projectSchema.safeParse(failure.current)
          : null;
      if (current?.success) {
        take(current.data);
        onMessage(
          "Someone else changed this project. Your edit was not saved; the current values are shown.",
        );
      } else if (failure instanceof ApiFailure && failure.code === "project_archived") {
        onMessage("The project is archived, so it cannot be changed.");
      } else {
        onMessage("Could not save the details. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="details-heading" className="grid gap-3">
      <h2 id="details-heading" className="text-lg font-semibold">
        Details
      </h2>
      <p className="text-sm text-muted-foreground">
        Key: <span className="font-mono">{project.key}</span>. It never changes, because task keys
        are built from it.
      </p>
      <form onSubmit={(event) => void save(event)} className="grid max-w-xl gap-3" noValidate>
        <div className="grid gap-1.5">
          <label htmlFor="project-settings-name" className="text-sm font-medium">
            Name
          </label>
          <Input
            id="project-settings-name"
            value={name}
            disabled={archived}
            onChange={(event) => {
              setName(event.target.value);
            }}
            aria-invalid={nameError !== null}
            autoComplete="off"
          />
          {nameError !== null && <p className="text-sm text-destructive">{nameError}</p>}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="project-settings-description" className="text-sm font-medium">
            Description
          </label>
          <Textarea
            id="project-settings-description"
            value={description}
            disabled={archived}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </div>
        <div>
          <Button type="submit" disabled={archived || pending || !changed}>
            Save
          </Button>
        </div>
      </form>
    </section>
  );
}
