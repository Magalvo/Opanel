import type { Metadata } from "next";

import { AcceptForm } from "@/components/accept-form";

// The link's token is in the address fragment, which browsers do not send to servers. This
// keeps it out of a Referer header too, should the page ever link elsewhere (WS-019).
export const metadata: Metadata = { title: "Choose a password", referrer: "no-referrer" };

/** Public page where a person sets a password from an invitation or reset link. */
export default function AcceptPage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Choose your password</h1>
        <p className="text-sm text-muted-foreground">
          Choose a password to finish setting up your account. You will be signed in right away.
        </p>
      </div>
      <AcceptForm />
    </main>
  );
}
