import { notFound } from "next/navigation";

import { SetupForm } from "@/components/setup-form";
import { isSetupNeeded } from "@/server/services/setup";

// Depends on the database, so never prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata = { title: "Set up Opanel" };

/** First-run setup (WS-016). A 404 as soon as any account exists. */
export default async function SetupPage() {
  if (!(await isSetupNeeded())) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Set up Opanel</h1>
        <p className="text-sm text-muted-foreground">
          Create the administrator account. You will be signed in right away.
        </p>
      </div>
      <SetupForm />
    </main>
  );
}
