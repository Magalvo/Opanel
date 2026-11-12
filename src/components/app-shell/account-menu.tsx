"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AccountSummary } from "@/lib/schemas/auth";

function roleLabel(role: string): string {
  return `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

/** Who is signed in, and how to sign out. Lives in the app shell's top bar. */
export function AccountMenu({ account }: Readonly<{ account: AccountSummary }>) {
  const router = useRouter();

  // A page render cannot set cookies, so Better Auth's cookie refresh is lost when only
  // server components read the session. One request to the API per full page load lets it
  // extend the session (WS-017). The response is not used.
  useEffect(() => {
    void fetch("/api/v1/me").catch(() => undefined);
  }, []);

  async function signOut() {
    await fetch("/api/v1/auth/sign-out", { method: "POST" }).catch(() => undefined);
    // `replace`, so that the back button does not return to a page of the app.
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account menu">
          <span aria-hidden="true" className="text-sm font-semibold">
            {account.name.charAt(0).toUpperCase()}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="grid gap-0.5 font-normal">
          <span className="text-sm font-medium text-foreground">{account.name}</span>
          {account.email !== null && (
            <span className="text-xs text-muted-foreground">{account.email}</span>
          )}
          <span className="text-xs text-muted-foreground">{roleLabel(account.role)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void signOut();
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
