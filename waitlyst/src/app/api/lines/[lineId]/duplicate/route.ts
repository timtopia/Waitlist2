import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { lineCreateLimiter } from "@/lib/rate-limit"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  // Same limit as creating a line, or duplicate-and-resume could flood Browse
  if (!lineCreateLimiter().check(result.userId).success) {
    return NextResponse.json(
      { error: "Too many new lines at once. Please try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

  try {
    const source = result.line
    // Copy every setting the owner chose, so a copy behaves like the original
    // (in particular, swaps stay off if they were off -- the schema default
    // is on). The schedule isn't copied, since the old dates have usually
    // passed. The copy starts paused so the owner can check it before it
    // shows up in Browse.
    const newLine = await prisma.line.create({
      data: {
        // Stay within the 100-character name limit, even for a copy of a copy
        name: `${source.name.slice(0, 93)} (Copy)`,
        description: source.description,
        createdById: result.userId,
        isPublic: source.isPublic,
        isActive: false,
        kind: source.kind,
        maxCapacity: source.maxCapacity,
        hideCapacity: source.hideCapacity,
        ownerFeePercent: source.ownerFeePercent,
        allowResale: source.allowResale,
        maxAskingPrice: source.maxAskingPrice,
        purchaseLimit: source.purchaseLimit,
        responseWindowMinutes: source.responseWindowMinutes,
        productName: source.productName,
        productImage: source.productImage,
        productPrice: source.productPrice,
        productUrl: source.productUrl,
      },
    })

    return NextResponse.json(newLine)
  } catch (error) {
    console.error("Duplicate line error:", error)
    return NextResponse.json(
      { error: "Something went wrong while duplicating the line. Please try again." },
      { status: 500 }
    )
  }
}
