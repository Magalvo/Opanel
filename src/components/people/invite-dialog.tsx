"use client";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inviteRequestSchema } from "@/lib/schemas/accounts";

import { ApiFailure, inviteAccount } from "./api";
import { ROLE_LABELS, ROLE_OPTIONS } from "./roles";

type Invited = Awaited<ReturnType<typeof inviteAccount>>;
type Field = "name" | "email" | "role";

/** The "Invite person" button and the dialog it opens. */
export function InviteDialog({ onInvited }: Readonly<{ onInvited: (invited: Invited) => void }>) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setName("");
    setEmail("");
    setRole("member");
    setErrors({});
    setFormError(null);
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = inviteRequestSchema.safeParse({ name, email, role });
    if (!parsed.success) {
      setErrors({
        ...(name.trim() === "" ? { name: "Enter a name." } : {}),
        ...(parsed.error.issues.some((issue) => issue.path[0] === "email")
          ? { email: "Enter a valid email address." }
          : {}),
      });
      return;
    }
    setErrors({});
    setPending(true);

    try {
      const invited = await inviteAccount(parsed.data);
      setOpen(false);
      reset();
      onInvited(invited);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 409) {
        setFormError("An account with this email already exists.");
      } else if (error instanceof ApiFailure && error.status === 400) {
        const next: Partial<Record<Field, string>> = {};
        for (const fieldError of error.errors) {
          if (
            fieldError.path === "name" ||
            fieldError.path === "email" ||
            fieldError.path === "role"
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
        <Button>Invite person</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a person</DialogTitle>
          <DialogDescription>You will get a link to send them.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor="invite-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="invite-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              aria-invalid={errors.name === undefined ? undefined : true}
              autoComplete="off"
            />
            {errors.name !== undefined && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="invite-email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              aria-invalid={errors.email === undefined ? undefined : true}
              autoComplete="off"
            />
            {errors.email !== undefined && (
              <p className="text-sm text-destructive">{errors.email}</p>
            )}
          </div>
          <div className="grid gap-1.5">
            <span id="invite-role-label" className="text-sm font-medium">
              Role
            </span>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger aria-labelledby="invite-role-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.role !== undefined && <p className="text-sm text-destructive">{errors.role}</p>}
          </div>
          <p className="text-sm text-muted-foreground">
            Check the email: it cannot be changed later.
          </p>
          {formError !== null && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type { Invited };
