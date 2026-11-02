import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { AnalyticsClient } from "./AnalyticsClient"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Analytics" }

interface Props {
  params: Promise<{ lineId: string }>
}

export default async function AnalyticsPage({ params }: Props) {
  const session = await auth()
  const { lineId } = await params
  if (!session?.user?.id) redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/lines/${lineId}/analytics`)}`)

  const line = await prisma.line.findUnique({
    where: { id: lineId },
    select: { id: true, name: true, createdById: true, kind: true, allowResale: true },
  })
  if (!line) redirect("/dashboard")
  if (line.createdById !== session.user.id) redirect(`/lines/${lineId}`)

  return (
    <AnalyticsClient
      lineId={line.id}
      lineName={line.name}
      isRestaurant={line.kind === "RESTAURANT"}
      allowResale={line.allowResale}
    />
  )
}
