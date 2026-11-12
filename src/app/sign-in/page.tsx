import { redirect } from "next/navigation";

import { SignInForm } from "@/components/sign-in-form";
import { safeNextPath } from "@/lib/next-path";
import { getSession } from "@/server/auth/session";
import { isSetupNeeded } from "@/server/services/setup";

// Depends on the database and the session, so never prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

interface SignInPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Sign-in (WS-017). An empty install is led to the setup page instead. */
export default async function SignInPage({ searchParams }: Readonly<SignInPageProps>) {
  if (await isSetupNeeded()) {
    redirect("/setup");
  }
  if (await getSession()) {
    redirect("/");
  }
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Sign in to Opanel</h1>
      </div>
      <SignInForm next={safeNextPath(next)} />
    </main>
  );
}
