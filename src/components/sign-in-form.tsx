"use client";

import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function waitMessage(retryAfter: string | null): string {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "Too many attempts. Try again later.";
  }
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Too many attempts. Try again in ${String(minutes)} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/** Sign-in form (WS-017). Uses the same public API as everyone else. */
export function SignInForm({ next }: Readonly<{ next: string }>) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setPending(true);

    try {
      const response = await fetch("/api/v1/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (response.status === 200) {
        // A full load, not a client navigation: the server must render with the new cookie.
        // `next` was checked by `safeNextPath` on the server: a path inside the app.
        window.location.assign(next);
        return;
      }
      if (response.status === 401) {
        setMessage("Invalid email or password.");
      } else if (response.status === 429) {
        setMessage(waitMessage(response.headers.get("Retry-After")));
      } else {
        setMessage("Something went wrong. Please try again.");
      }
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="grid gap-4" noValidate>
      <div className="grid gap-1.5">
        <label htmlFor="sign-in-email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="sign-in-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="sign-in-password" className="text-sm font-medium">
          Password
        </label>
        <Input
          id="sign-in-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </div>
      {message !== null && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Forgot your password? Ask an administrator for a reset link.
      </p>
    </form>
  );
}
