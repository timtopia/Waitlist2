import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { countCapacityUsed } from "@/lib/capacity-server"
import { setLineActive } from "@/lib/line-pause"
import { validateString, validateNumber, validateUrl, validateImageUrl } from "@/lib/validate"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  const updates = await req.json().catch(() => null)
  if (!updates || typeof updates !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  try {
    // Only allow updating specific fields
    const allowedUpdates: Record<string, unknown> = {}
    if (typeof updates.isPublic === "boolean") {
      allowedUpdates.isPublic = updates.isPublic
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
    // Schedule fields. An unparseable date used to reach the database and
    // fail there as a 500.
    for (const field of ["opensAt", "closesAt"] as const) {
      if (updates[field] === undefined) continue
      if (!updates[field]) {
        allowedUpdates[field] = null
        continue
      }
      const date = new Date(updates[field])
      if (isNaN(date.getTime())) {
        return NextResponse.json(
          { error: `${field === "opensAt" ? "Opening" : "Closing"} time isn't a valid date` },
          { status: 400 }
        )
      }
      allowedUpdates[field] = date
    }
    // Compare against what's stored for whichever end wasn't sent
    const opens = "opensAt" in allowedUpdates ? allowedUpdates.opensAt as Date | null : result.line.opensAt
    const closes = "closesAt" in allowedUpdates ? allowedUpdates.closesAt as Date | null : result.line.closesAt
    if (opens && closes && closes <= opens) {
      return NextResponse.json({ error: "The line must close after it opens" }, { status: 400 })
    }
    // Capacity field
    if (updates.maxCapacity !== undefined) {
      const cap = updates.maxCapacity === null ? null : parseInt(updates.maxCapacity)
      if (cap !== null) {
        if (isNaN(cap) || cap < 1) {
          return NextResponse.json({ error: "Capacity must be a positive whole number" }, { status: 400 })
        }
        // Verify capacity is not less than the guests already in line
        const currentCount = await countCapacityUsed(result.line)
        if (cap < currentCount) {
          return NextResponse.json(
            {
              error: result.line.kind === "RESTAURANT"
                ? `Capacity cannot be less than the ${currentCount} guests currently in line`
                : `Capacity cannot be less than the ${currentCount} people currently in line`,
            },
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
      if (typeof updates.productImage === "string" && updates.productImage.trim()) {
        const imageErr = validateImageUrl(updates.productImage.trim())
        if (imageErr) return NextResponse.json({ error: imageErr }, { status: 400 })
        allowedUpdates.productImage = updates.productImage.trim()
      } else {
        allowedUpdates.productImage = null
      }
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

    // Per-customer purchase limit (drops) and the time a called person has
    // to show up. null turns either off.
    for (const [field, label, max] of [
      ["purchaseLimit", "Purchase limit", 99],
      ["responseWindowMinutes", "Time to show up", 60],
    ] as const) {
      if (updates[field] === undefined) continue
      if (updates[field] === null) {
        allowedUpdates[field] = null
        continue
      }
      if (!Number.isInteger(updates[field]) || updates[field] < 1 || updates[field] > max) {
        return NextResponse.json({ error: `${label} must be a whole number from 1 to ${max}` }, { status: 400 })
      }
      allowedUpdates[field] = updates[field]
    }

    // Pausing goes through the helper so called people's clocks stop too
    if (typeof updates.isActive === "boolean") {
      await setLineActive(lineId, updates.isActive)
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
