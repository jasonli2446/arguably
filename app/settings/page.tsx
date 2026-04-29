import { redirect } from "next/navigation"
import { getUserProfile } from "@/lib/actions/user"
import SettingsClient from "./SettingsClient"

/** Protected settings page that redirects unauthenticated users to auth. */
export default async function SettingsPage() {
  const profile = await getUserProfile()
  if (!profile) redirect("/auth")

  return <SettingsClient profile={profile} />
}
