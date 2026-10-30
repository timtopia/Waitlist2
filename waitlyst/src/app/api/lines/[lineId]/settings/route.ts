import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { validateString, validateNumber, validateUrl } from "@/lib/validate"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const updates = await req.json()

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  try {
    // Only allow updating specific fields
    const allowedUpdates: Record<string, unknown> = {}
    if (typeof updates.isPublic === "boolean") {
      allowedUpdates.isPublic = updates.isPublic
    }
    if (typeof updates.isActive === "boolean") {
      allowedUpdates.isActive = updates.isActive
    }
    // Validate name (1-100 chars)
    if (updates.name !== undefined) {
      if (typeof updates.name !== "string" || !updates.name.trim()) {
        return NextResponse.json({ error: "Name is required" }, { status: 400 })
      }
      const nameErr = validateString(updates.name, "Name", { min: 1, max: 100 })
      if (nameErr) {
        return NextResponse.json({ error: nameErr }, { status: 400 })
      }
      allowedUpdates.name = updates.name.trim()
    }
    // Validate description (max 500 chars)
    if (updates.description !== undefined) {
      if (typeof updates.description === "string" && updates.description.trim().length > 500) {
        return NextResponse.json({ error: "Description must be 500 characters or fewer" }, { status: 400 })
      }
      allowedUpdates.description = typeof updates.description === "string"
        ? updates.description.trim() || null
        : null
    }
    // Schedule fields
    if (updates.opensAt !== undefined) {
      allowedUpdates.opensAt = updates.opensAt ? new Date(updates.opensAt) : null
    }
    if (updates.closesAt !== undefined) {
      allowedUpdates.closesAt = updates.closesAt ? new Date(updates.closesAt) : null
    }
    // Capacity field
    if (updates.maxCapacity !== undefined) {
      const cap = updates.maxCapacity === null ? null : parseInt(updates.maxCapacity)
      if (cap !== null) {
        if (isNaN(cap) || cap < 1) {
          return NextResponse.json({ error: "Capacity must be a positive whole number" }, { status: 400 })
        }
        // Verify capacity is not less than the guests already in line
        const { _sum } = await prisma.linePosition.aggregate({
          where: { lineId },
          _sum: { partySize: true },
        })
        const currentCount = _sum.partySize ?? 0
        if (cap < currentCount) {
          return NextResponse.json(
            { error: `Capacity cannot be less than the ${currentCount} people currently in line` },
            { status: 400 }
          )
        }
      }
      allowedUpdates.maxCapacity = cap
    }
    // Line type decides how party sizes and payments work, so it can only
    // change before anyone has joined.
    if (updates.kind !== undefined) {
      if (updates.kind !== "STANDARD" && updates.kind !== "RESTAURANT") {
        return NextResponse.json({ error: "Line type must be STANDARD or RESTAURANT" }, { status: 400 })
      }
      const inLine = await prisma.linePosition.count({ where: { lineId } })
      const current = await prisma.line.findUnique({ where: { id: lineId }, select: { kind: true } })
      if (inLine > 0 && current?.kind !== updates.kind) {
        return NextResponse.json(
          { error: "The line type can't be changed once people have joined" },
          { status: 400 }
        )
      }
      allowedUpdates.kind = updates.kind
    }
    // Owner fee percentage (clamped to 0-50)
    if (typeof updates.ownerFeePercent === "number") {
      allowedUpdates.ownerFeePercent = Math.max(0, Math.min(updates.ownerFeePercent, 50))
    }
    // Product fields
    if (updates.productName !== undefined) {
      allowedUpdates.productName = typeof updates.productName === "string" && updates.productName.trim()
        ? updates.productName.trim()
        : null
    }
    if (updates.productImage !== undefined) {
      allowedUpdates.productImage = typeof updates.productImage === "string" && updates.productImage.trim()
        ? updates.productImage.trim()
        : null
    }
    // Product price (positive number, max $10,000)
    if (updates.productPrice !== undefined) {
      if (updates.productPrice === null) {
        allowedUpdates.productPrice = null
      } else {
        const price = parseFloat(updates.productPrice)
        if (isNaN(price) || price <= 0) {
          return NextResponse.json({ error: "Product price must be a positive number" }, { status: 400 })
        }
        if (price > 10000) {
          return NextResponse.json({ error: "Product price must be no more than $10,000" }, { status: 400 })
        }
        allowedUpdates.productPrice = price
      }
    }
    // Product URL (must be valid)
    if (updates.productUrl !== undefined) {
      if (updates.productUrl === null || updates.productUrl === "") {
        allowedUpdates.productUrl = null
      } else {
        const urlErr = validateUrl(updates.productUrl, "Product URL")
        if (urlErr) {
          return NextResponse.json({ error: urlErr }, { status: 400 })
        }
        allowedUpdates.productUrl = updates.productUrl.trim()
      }
    }

    // Hide capacity
    if (typeof updates.hideCapacity === "boolean") {
      allowedUpdates.hideCapacity = updates.hideCapacity
    }

    // Resale controls
    if (typeof updates.allowResale === "boolean") {
      allowedUpdates.allowResale = updates.allowResale
    }
    if (updates.maxAskingPrice !== undefined) {
      if (updates.maxAskingPrice === null) {
        allowedUpdates.maxAskingPrice = null
      } else {
        const cap = parseFloat(updates.maxAskingPrice)
        if (isNaN(cap) || cap <= 0) {
          return NextResponse.json({ error: "Max asking price must be a positive number" }, { status: 400 })
        }
        if (cap > 10000) {
          return NextResponse.json({ error: "Max asking price must be no more than $10,000" }, { status: 400 })
        }
        allowedUpdates.maxAskingPrice = cap
      }
    }

    const updatedLine = await prisma.line.update({
      where: { id: lineId },
      data: allowedUpdates,
    })

    // Listings and offers made under the old rules would otherwise stay up
    // and only fail when someone tries to act on them.
    if (updatedLine.allowResale === false) {
      await prisma.$transaction([
        prisma.linePosition.updateMany({ where: { lineId, askingPrice: { not: null } }, data: { askingPrice: null } }),
        prisma.swapOffer.updateMany({ where: { lineId, status: "PENDING" }, data: { status: "EXPIRED" } }),
      ])
    } else if (typeof allowedUpdates.maxAskingPrice === "number") {
      const cap = allowedUpdates.maxAskingPrice
      await prisma.$transaction([
        prisma.linePosition.updateMany({ where: { lineId, askingPrice: { gt: cap } }, data: { askingPrice: null } }),
        prisma.swapOffer.updateMany({ where: { lineId, status: "PENDING", amount: { gt: cap } }, data: { status: "EXPIRED" } }),
      ])
    }

    return NextResponse.json(updatedLine)
  } catch (error) {
    console.error("Settings update error:", error)
    return NextResponse.json(
      { error: "Something went wrong while updating settings. Please try again." },
      { status: 500 }
    )
  }
}
