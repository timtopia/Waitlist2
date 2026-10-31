import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getPlatformFeePercent } from "@/lib/fees"
import { countCapacityUsed } from "@/lib/capacity-server"
import { EditLineClient } from "./EditLineClient"

export const dynamic = "force-dynamic"

interface Props {
  params: Promise<{ lineId: string }>
}

export default async function EditLinePage({ params }: Props) {
  const session = await auth()
  const { lineId } = await params

  if (!session?.user?.id) {
    redirect("/")
  }

  const line = await prisma.line.findUnique({
    where: { id: lineId },
    include: {
      _count: { select: { positions: true } },
    },
  })

  if (!line) {
    redirect("/dashboard")
  }

  if (line.createdById !== session.user.id) {
    redirect(`/lines/${lineId}`)
  }

  return (
    <EditLineClient
      line={{
        id: line.id,
        name: line.name,
        description: line.description,
        isPublic: line.isPublic,
        isActive: line.isActive,
        opensAt: line.opensAt?.toISOString() || null,
        closesAt: line.closesAt?.toISOString() || null,
        maxCapacity: line.maxCapacity,
        ownerFeePercent: line.ownerFeePercent,
        currentCount: line._count.positions,
        kind: line.kind,
        capacityUsed: await countCapacityUsed(line),
        productName: line.productName,
        productImage: line.productImage,
        productPrice: line.productPrice,
        productUrl: line.productUrl,
        allowResale: line.allowResale,
        maxAskingPrice: line.maxAskingPrice,
        hideCapacity: line.hideCapacity,
        purchaseLimit: line.purchaseLimit,
        responseWindowMinutes: line.responseWindowMinutes,
      }}
      platformFeePercent={getPlatformFeePercent()}
    />
  )
}
