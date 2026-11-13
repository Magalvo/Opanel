"use client";

import { useRouter } from "next/navigation";
import { type SubmitEvent, useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { problemSchema } from "@/lib/schemas/problem";

type Field = "password" | "confirmation";

function waitMessage(retryAfter: string | null): string {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "Too many attempts. Try again later.";
  }
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Too many attempts. Try again in ${String(minutes)} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/**
 * The token in the address fragment, read once and remembered. The fragment is cleared from
 * the address bar right after, so a later read would find nothing. A store of its own per form
 * (rather than module state) keeps one visit from seeing another's token.
 */
function createFragmentStore() {
  let token: string | null | undefined;
  return {
    subscribe: () => () => undefined,
    getSnapshot: (): string | null => {
      if (token === undefined) {
        const fragment = window.location.hash.replace(/^#/, "");
        token = fragment === "" ? null : fragment;
      }
      return token;
    },
    // The fragment does not exist on the server: render nothing until the page is mounted.
    getServerSnapshot: (): undefined => undefined,
  };
}

/**
 * Sets the password for a one-time link (WS-019). The token is read from the address
 * fragment, which a browser never sends to a server, and is removed from the address bar at
 * once. It is sent once, in the body of the request, when the password is chosen.
 */
export function AcceptForm() {
  const router = useRouter();
  const [store] = useState(createFragmentStore);
  const token = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (token !== null && token !== undefined) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  }, [token]);

  if (token === undefined) {
    return null;
  }
  if (token === null) {
    return <p role="alert">This link is not valid.</p>;
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    // Checked here and never sent: the confirmation is a typing aid, not data.
    if (password !== confirmation) {
      setErrors({ confirmation: "The passwords do not match." });
      return;
    }
    setErrors({});
    setPending(true);

    try {
      const response = await fetch("/api/v1/account-links/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (response.status === 200) {
        router.push("/");
        router.refresh();
        return;
      }
      if (response.status === 404) {
        setFormError("This link is no longer valid. Ask an administrator for a new one.");
      } else if (response.status === 429) {
        setFormError(waitMessage(response.headers.get("Retry-After")));
      } else if (response.status === 400) {
        const problem = problemSchema.safeParse(await response.json().catch(() => null));
        const passwordError = problem.success
          ? problem.data.errors?.find((error) => error.path === "password")
          : undefined;
        if (passwordError) {
          setErrors({ password: passwordError.message });
        } else {
          setFormError("Please check the details and try again.");
        }
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="grid gap-4" noValidate>
      <div className="grid gap-1.5">
        <label htmlFor="accept-password" className="text-sm font-medium">
          Password
        </label>
        <Input
          id="accept-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          aria-invalid={errors.password === undefined ? undefined : true}
          aria-describedby={errors.password === undefined ? undefined : "accept-password-error"}
        />
        {errors.password !== undefined && (
          <p id="accept-password-error" className="text-sm text-destructive">
            {errors.password}
          </p>
        )}
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="accept-confirmation" className="text-sm font-medium">
          Confirm password
        </label>
        <Input
          id="accept-confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          required
          value={confirmation}
          onChange={(event) => {
            setConfirmation(event.target.value);
          }}
          aria-invalid={errors.confirmation === undefined ? undefined : true}
          aria-describedby={
            errors.confirmation === undefined ? undefined : "accept-confirmation-error"
          }
        />
        {errors.confirmation !== undefined && (
          <p id="accept-confirmation-error" className="text-sm text-destructive">
            {errors.confirmation}
          </p>
        )}
      </div>
      {formError !== null && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Setting password…" : "Set password"}
      </Button>
      <p className="text-sm text-muted-foreground">You will be signed out everywhere else.</p>
    </form>
  );
}
