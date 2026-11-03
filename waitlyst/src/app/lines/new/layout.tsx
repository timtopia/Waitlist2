import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/auth"

export const metadata: Metadata = {
  title: "Create a Line",
}

export default async function CreateLineLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Straight to sign-in (which says "to continue to create your line")
  // instead of a skeleton, then a card with its own sign-in button
  const session = await auth()
  if (!session?.user) redirect("/signin?callbackUrl=%2Flines%2Fnew")
  return children
}
