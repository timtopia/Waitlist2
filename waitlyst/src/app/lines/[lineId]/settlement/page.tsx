import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getStripe } from "@/lib/stripe"
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
    select: { id: true, name: true, createdById: true, kind: true },
  })

  if (!line) {
    redirect("/dashboard")
  }

  if (line.createdById !== session.user.id) {
    redirect(`/lines/${lineId}`)
  }

  const owner = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { stripeConnectOnboarded: true },
  })

  return (
    <SettlementClient
      lineId={line.id}
      lineName={line.name}
      kind={line.kind}
      stripeConnectOnboarded={owner?.stripeConnectOnboarded ?? false}
      stripeEnabled={!!getStripe()}
    />
  )
}
