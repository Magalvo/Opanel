"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
import { createProjectRequestSchema } from "@/lib/schemas/projects";

import { ApiFailure, createProject } from "./api";

type Field = "key" | "name" | "description";

/** The "New project" button and the dialog it opens. On success it opens the new project. */
export function CreateProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setKey("");
    setName("");
    setDescription("");
    setErrors({});
    setFormError(null);
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = createProjectRequestSchema.safeParse({
      key,
      name,
      ...(description.trim() === "" ? {} : { description }),
    });
    if (!parsed.success) {
      const failing = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
      setErrors({
        ...(failing.has("key")
          ? { key: "Enter a key of 2 to 10 uppercase letters and digits." }
          : {}),
        ...(failing.has("name") ? { name: "Enter a name." } : {}),
        ...(failing.has("description") ? { description: "Use at most 10 000 characters." } : {}),
      });
      return;
    }
    setErrors({});
    setPending(true);

    try {
      const project = await createProject(parsed.data);
      setOpen(false);
      reset();
      router.push(`/projects/${project.key}`);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "project_key_taken") {
        setErrors({ key: "This key is already used." });
      } else if (failure instanceof ApiFailure && failure.status === 400) {
        const next: Partial<Record<Field, string>> = {};
        for (const fieldError of failure.errors) {
          if (
            fieldError.path === "key" ||
            fieldError.path === "name" ||
            fieldError.path === "description"
          ) {
            next[fieldError.path] = fieldError.message;
          }
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>New project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            The project starts with the columns To do, In progress and Done.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor="project-key" className="text-sm font-medium">
              Key
            </label>
            <Input
              id="project-key"
              value={key}
              onChange={(event) => {
                setKey(event.target.value.toUpperCase());
              }}
              aria-invalid={errors.key !== undefined}
              aria-describedby="project-key-help"
              autoComplete="off"
              maxLength={10}
            />
            <p id="project-key-help" className="text-xs text-muted-foreground">
              2 to 10 uppercase letters and digits. It cannot be changed later.
            </p>
            {errors.key !== undefined && <p className="text-sm text-destructive">{errors.key}</p>}
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="project-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              aria-invalid={errors.name !== undefined}
              autoComplete="off"
            />
            {errors.name !== undefined && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="project-description" className="text-sm font-medium">
              Description
            </label>
            <Textarea
              id="project-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              aria-invalid={errors.description !== undefined}
            />
            {errors.description !== undefined && (
              <p className="text-sm text-destructive">{errors.description}</p>
            )}
          </div>
          {formError !== null && <p className="text-sm text-destructive">{formError}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
