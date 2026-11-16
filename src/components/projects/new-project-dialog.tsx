"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

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
import { ApiFailure } from "@/lib/api-client";
import { createProjectRequestSchema } from "@/lib/schemas/projects";

import { createProject } from "./api";

type Field = "key" | "name" | "description";

const KEY_RULE = "Use 2 to 10 letters and digits, starting with a letter.";

/** "New project" and its dialog (WS-036). On success the browser goes to the project. */
export function NewProjectDialog() {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = createProjectRequestSchema.safeParse({
      key,
      name,
      ...(description === "" ? {} : { description }),
    });
    if (!parsed.success) {
      const failed = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      setErrors({
        ...(failed.has("key") ? { key: KEY_RULE } : {}),
        ...(failed.has("name")
          ? { name: name.trim() === "" ? "Enter a name." : "Use at most 100 characters." }
          : {}),
        ...(failed.has("description") ? { description: "Use at most 10 000 characters." } : {}),
      });
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const project = await createProject(parsed.data);
      setOpen(false);
      router.push(`/projects/${project.key}`);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "project_key_taken") {
        setErrors({ key: "Another project has this key." });
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  function field(name: Field) {
    const error = errors[name];
    return {
      id: `${id}-${name}`,
      "aria-invalid": error === undefined ? undefined : true,
      "aria-describedby": error === undefined ? undefined : `${id}-${name}-error`,
    } as const;
  }

  function errorOf(name: Field) {
    const error = errors[name];
    return error === undefined ? null : (
      <p id={`${id}-${name}-error`} className="text-sm text-destructive">
        {error}
      </p>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setKey("");
          setName("");
          setDescription("");
          setErrors({});
          setFormError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>New project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            It starts with the columns To do, In progress and Done.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-key`} className="text-sm font-medium">
              Key
            </label>
            <Input
              {...field("key")}
              value={key}
              onChange={(event) => {
                setKey(event.target.value.toUpperCase());
              }}
              autoComplete="off"
              className="uppercase"
            />
            <p className="text-xs text-muted-foreground">
              2 to 10 letters and digits, starting with a letter. It never changes.
            </p>
            {errorOf("key")}
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-name`} className="text-sm font-medium">
              Name
            </label>
            <Input
              {...field("name")}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              autoComplete="off"
            />
            {errorOf("name")}
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-description`} className="text-sm font-medium">
              Description
            </label>
            <Textarea
              {...field("description")}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
            {errorOf("description")}
          </div>
          {formError !== null && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
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
