import { redirect } from "next/navigation";

import { SignInForm } from "@/components/sign-in-form";
import { safeNextPath } from "@/lib/next-path";
import { signInNotice } from "@/lib/sign-in-notice";
import { getSession } from "@/server/auth/session";
import { isSetupNeeded } from "@/server/services/setup";

// Depends on the database and the session, so never prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

interface SignInPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Sign-in (WS-017). An empty install is led to the setup page instead. A `notice` from the
 * allowlist of WS-057 says why the person is here, for example after a password was set.
 */
export default async function SignInPage({ searchParams }: Readonly<SignInPageProps>) {
  if (await isSetupNeeded()) {
    redirect("/setup");
  }
  if (await getSession()) {
    redirect("/");
  }
  const { next, notice } = await searchParams;
  const message = signInNotice(notice);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Sign in to Opanel</h1>
        {message !== null && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </div>
      <SignInForm next={safeNextPath(next)} />
    </main>
  );
}
