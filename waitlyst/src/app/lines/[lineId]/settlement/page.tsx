import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { SettlementClient } from "./SettlementClient"

export const dynamic = "force-dynamic"

interface Props {
  params: Promise<{ lineId: string }>
}

export default async function SettlementPage({ params }: Props) {
  const session = await auth()
  const { lineId } = await params

  if (!session?.user?.id) {
    redirect("/")
  }

  const line = await prisma.line.findUnique({
    where: { id: lineId },
    select: { id: true, name: true, createdById: true },
  })

  if (!line) {
    redirect("/dashboard")
  }

  if (line.createdById !== session.user.id) {
    redirect(`/lines/${lineId}`)
  }

  return <SettlementClient lineId={line.id} lineName={line.name} />
}
