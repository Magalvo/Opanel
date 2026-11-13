"use client";

import { useRouter } from "next/navigation";
import { type SubmitEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { problemSchema } from "@/lib/schemas/problem";

const GENERIC_ERROR = "Something went wrong. Please try again.";

function waitMessage(retryAfter: string | null): string {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "Too many attempts. Try again later.";
  }
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Too many attempts. Try again in ${String(minutes)} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/** The field errors of a `400` problem body, by path; empty if there are none. */
async function fieldErrors(response: Response): Promise<Record<string, string>> {
  const problem = problemSchema.safeParse(await response.json().catch(() => null));
  const errors = problem.success ? (problem.data.errors ?? []) : [];
  return Object.fromEntries(errors.map((error) => [error.path, error.message]));
}

function Field({
  label,
  error,
  ...input
}: Readonly<{
  label: string;
  error: string | undefined;
  name: string;
  type: "text" | "password";
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
}>) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        name={input.name}
        type={input.type}
        autoComplete={input.autoComplete}
        required
        value={input.value}
        onChange={(event) => {
          input.onChange(event.target.value);
        }}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
      />
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="grid gap-4 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function NameForm({ name: initialName, email }: Readonly<{ name: string; email: string }>) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setStatus(null);
    setPending(true);
    try {
      const response = await fetch("/api/v1/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (response.ok) {
        setStatus("Saved.");
        // The shell reads the account on the server: re-render it with the new name.
        router.refresh();
      } else if (response.status === 400) {
        const errors = await fieldErrors(response);
        if (errors.name === undefined) {
          setStatus("Please check the name and try again.");
        } else {
          setError(errors.name);
        }
      } else {
        setStatus(GENERIC_ERROR);
      }
    } catch {
      setStatus(GENERIC_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="grid gap-4" noValidate>
      <Field
        label="Name"
        name="name"
        type="text"
        autoComplete="name"
        value={name}
        onChange={setName}
        error={error}
      />
      <div className="grid gap-0.5 text-sm">
        <span className="font-medium">Email</span>
        <span>{email}</span>
        <span className="text-muted-foreground">Your email cannot be changed.</span>
      </div>
      {status !== null && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      <Button type="submit" disabled={pending} className="justify-self-start">
        Save name
      </Button>
    </form>
  );
}

type PasswordField = "currentPassword" | "newPassword" | "confirmation";

function PasswordForm() {
  const [values, setValues] = useState<Record<PasswordField, string>>({
    currentPassword: "",
    newPassword: "",
    confirmation: "",
  });
  const [errors, setErrors] = useState<Partial<Record<PasswordField, string>>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const field = (key: PasswordField) => ({
    value: values[key],
    onChange: (value: string) => {
      setValues((current) => ({ ...current, [key]: value }));
    },
    error: errors[key],
  });

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    // Checked here and never sent: the confirmation is a typing aid, not data.
    if (values.newPassword !== values.confirmation) {
      setErrors({ confirmation: "The new passwords do not match." });
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const response = await fetch("/api/v1/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      });
      if (response.ok) {
        setValues({ currentPassword: "", newPassword: "", confirmation: "" });
        setStatus("Password changed. You were signed out on your other devices.");
      } else if (response.status === 429) {
        setStatus(waitMessage(response.headers.get("Retry-After")));
      } else if (response.status === 400) {
        const found = await fieldErrors(response);
        const known = {
          ...(found.currentPassword === undefined
            ? {}
            : { currentPassword: found.currentPassword }),
          ...(found.newPassword === undefined ? {} : { newPassword: found.newPassword }),
        };
        setErrors(known);
        if (Object.keys(known).length === 0) {
          setStatus("Please check the details and try again.");
        }
      } else {
        setStatus(GENERIC_ERROR);
      }
    } catch {
      setStatus(GENERIC_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="grid gap-4" noValidate>
      <Field
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        {...field("currentPassword")}
      />
      <Field
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        {...field("newPassword")}
      />
      <Field
        label="Confirm new password"
        name="confirmation"
        type="password"
        autoComplete="new-password"
        {...field("confirmation")}
      />
      {status !== null && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      <Button type="submit" disabled={pending} className="justify-self-start">
        Change password
      </Button>
    </form>
  );
}

/** The signed-in person's own name and password (WS-021). Any role. */
export function ProfilePage({ name, email }: Readonly<{ name: string; email: string }>) {
  return (
    <div className="grid max-w-xl gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
      <Section title="Name">
        <NameForm name={name} email={email} />
      </Section>
      <Section title="Password">
        <PasswordForm />
      </Section>
    </div>
  );
}
