import { ProfilePage } from "@/components/profile/profile-page";
import { requireAccount } from "@/server/auth/session";

export const metadata = { title: "Profile" };

/**
 * The signed-in person's profile (WS-021). Every role has one, so there is no permission
 * check beyond being signed in; the API it calls acts only on the caller's own account.
 */
export default async function ProfileRoute() {
  const { account } = await requireAccount();

  return <ProfilePage name={account.name} email={account.email ?? ""} />;
}
