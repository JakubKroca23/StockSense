import { redirect } from "next/navigation";

/** Settings is a modal in AppShell — keep route as redirect for old links. */
export default function SettingsPage() {
  redirect("/");
}
