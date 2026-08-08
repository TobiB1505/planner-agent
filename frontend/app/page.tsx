import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/auth/app-user";
import { homePathForRole, LOGIN_PATH } from "@/lib/auth/route-access";

// Auth-Sprint: die Startseite leitet jetzt rollenabhängig weiter, statt fest
// auf /dashboard. Ohne das würde ein Mitarbeiter beim Aufruf von "/" erst im
// Planungsbereich landen und von dort weitergeleitet - ein unnötiger Umweg
// mit sichtbarem Zwischenzustand.
export default async function Home() {
  const user = await getAppUser();
  redirect(user ? homePathForRole(user.role) : LOGIN_PATH);
}
