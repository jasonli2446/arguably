import { redirect } from "next/navigation"
import { getUserProfile } from "@/lib/actions/user"
import SettingsClient from "./SettingsClient"

export default async function SettingsPage() {
  const profile = await getUserProfile()
  if (!profile) redirect("/auth")

  return <SettingsClient profile={profile} />
}
