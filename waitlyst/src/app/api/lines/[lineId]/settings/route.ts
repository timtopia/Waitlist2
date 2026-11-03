import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { countCapacityUsed } from "@/lib/capacity-server"
import { setLineActive } from "@/lib/line-pause"
import { abandonPendingTransaction } from "@/lib/stripe"
import { validateString, validateNumber, validateUrl, validateImageUrl, cleanText, MAX_CAPACITY } from "@/lib/validate"
import { callDeadline } from "@/lib/call-deadline"

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
      const name = cleanText(updates.name)
      if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 })
      allowedUpdates.name = name
    }
    // Validate description (max 500 chars)
    if (updates.description !== undefined) {
      if (typeof updates.description === "string" && updates.description.trim().length > 500) {
        return NextResponse.json({ error: "Description must be 500 characters or fewer" }, { status: 400 })
      }
      allowedUpdates.description = typeof updates.description === "string"
        ? cleanText(updates.description, { multiline: true }) || null
        : null
    }
    // Schedule fields. An unparseable date used to reach the database and
    // fail there as a 500.
    for (const field of ["opensAt", "closesAt"] as const) {
      if (updates[field] === undefined) continue
      if (!updates[field]) {
        // Clearing a future opening time opens the line now. Recording when
        // keeps "email me when it opens" working; a null opensAt looks like a
        // line that never had a schedule, so nobody was emailed.
        const stored = result.line[field]
        if (field === "opensAt" && stored && stored <= new Date()) {
          // Already past (say it was paused through its opening): keep the
          // date while "email me when it opens" reminders are still unsent,
          // or they'd never match and never go out
          const pending = await prisma.lineReminder.count({ where: { lineId, sentAt: null } })
          allowedUpdates[field] = pending > 0 ? stored : null
          continue
        }
        allowedUpdates[field] = field === "opensAt" && stored ? new Date() : null
        continue
      }
      const date = new Date(updates[field])
      if (isNaN(date.getTime())) {
        return NextResponse.json(
          { error: `${field === "opensAt" ? "Opening" : "Closing"} time isn't a valid date` },
          { status: 400 }
        )
      }
      // Moving the close time into the past closes the line on the spot,
      // which is what pausing is for. Leaving an old close time as it was
      // is fine (the edit form works to the minute, so compare to the minute).
      const sameMinute = (a: Date, b: Date | null) => !!b && Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000)
      if (field === "closesAt" && date <= new Date() && !sameMinute(date, result.line.closesAt)) {
        return NextResponse.json(
          { error: "The closing time has already passed. Pick a later time, or leave it empty for no end time." },
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
      // Number, not parseInt: "100abc" or 150.5 is a mistake, not 100 or 150
      const cap = updates.maxCapacity === null ? null : Number(updates.maxCapacity)
      if (cap !== null) {
        if (!Number.isInteger(cap) || cap < 1 || cap > MAX_CAPACITY) {
          return NextResponse.json({ error: "Capacity must be a whole number from 1 to 100,000 (leave it empty for no limit)" }, { status: 400 })
        }
        // Verify capacity is not less than the guests already in line
        const currentCount = await countCapacityUsed(result.line)
        if (cap < currentCount) {
          return NextResponse.json(
            {
              error: result.line.kind === "RESTAURANT"
                ? `Capacity cannot be less than the ${currentCount} guests currently in line`
                : `Capacity cannot be less than the ${currentCount} spots already taken (people in line plus people already served)`,
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
    // Owner fee percentage, 0-50. Rejected like on create rather than
    // quietly clamped, so "saved" never means a different fee than typed.
    if (updates.ownerFeePercent !== undefined) {
      const feeErr = validateNumber(updates.ownerFeePercent, "Owner fee percent", { min: 0, max: 50 })
      if (feeErr) return NextResponse.json({ error: feeErr }, { status: 400 })
      const fee: number = updates.ownerFeePercent
      // Offer fees are worked out when the offer is accepted, so raising the
      // fee would make buyers pay more than they agreed to. Wait until open
      // offers are settled. Accepted offers already have their fee fixed on
      // the transaction (and stay ACCEPTED after the swap), so only live
      // pending offers count -- counting ACCEPTED blocked raises forever.
      if (fee > result.line.ownerFeePercent) {
        const openOffers = await prisma.swapOffer.count({
          where: { lineId, status: "PENDING", expiresAt: { gt: new Date() } },
        })
        if (openOffers > 0) {
          return NextResponse.json(
            { error: `The fee can't be raised while ${openOffers} swap offer${openOffers === 1 ? " is" : "s are"} open. Try again once they're settled.` },
            { status: 400 }
          )
        }
      }
      allowedUpdates.ownerFeePercent = fee
    }
    // Product fields
    if (updates.productName !== undefined) {
      if (updates.productName !== null && typeof updates.productName !== "string") {
        return NextResponse.json({ error: "Product name must be text" }, { status: 400 })
      }
      const productErr = updates.productName ? validateString(updates.productName, "Product name", { min: 0, max: 100 }) : null
      if (productErr) return NextResponse.json({ error: productErr }, { status: 400 })
      allowedUpdates.productName = typeof updates.productName === "string" && updates.productName.trim()
        ? cleanText(updates.productName) || null
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
        // Listings and offers start at $1, so a lower cap would block them all
        if (isNaN(cap) || cap < 1) {
          return NextResponse.json({ error: "Max asking price must be at least $1.00" }, { status: 400 })
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
      ["purchaseLimit", "Limit per customer", 99],
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

    // A shorter (or newly turned on) show-up window must not instantly skip
    // parties called under the old one. Give each the difference as extra
    // time, so the new window only bites on calls made from now on.
    const newWindow = allowedUpdates.responseWindowMinutes
    const oldWindow = result.line.responseWindowMinutes
    if (typeof newWindow === "number" && (oldWindow == null || newWindow < oldWindow)) {
      const now = Date.now()
      const called = await prisma.linePosition.findMany({
        where: { lineId, fulfilled: false, calledAt: { not: null }, user: { isWalkIn: false } },
        select: { id: true, calledAt: true, respondedAt: true, graceMinutes: true },
      })
      for (const p of called) {
        const calledAt = p.calledAt!.toISOString()
        const respondedAt = p.respondedAt?.toISOString() ?? null
        const before = oldWindow
          ? callDeadline(calledAt, oldWindow, respondedAt, p.graceMinutes)!.getTime()
          : now + newWindow * 60_000
        const after = callDeadline(calledAt, newWindow, respondedAt, p.graceMinutes)!.getTime()
        if (after < before) {
          await prisma.linePosition.update({
            where: { id: p.id },
            data: { graceMinutes: (p.graceMinutes ?? 0) + Math.ceil((before - after) / 60_000) },
          })
        }
      }
    }

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

    // A buyer already on the payment page (or holding an accepted offer)
    // would otherwise complete a swap the owner just ruled out
    const offRules = updatedLine.allowResale === false
      ? {}
      : typeof allowedUpdates.maxAskingPrice === "number"
        ? { amount: { gt: allowedUpdates.maxAskingPrice } }
        : null
    if (offRules) {
      const inFlight = await prisma.transaction.findMany({
        where: { lineId, status: "PENDING", ...offRules },
        select: { id: true },
      })
      for (const { id } of inFlight) {
        if (await abandonPendingTransaction(id, { offerId: null })) {
          await prisma.swapOffer.updateMany({
            where: { transactionId: id, status: "ACCEPTED" },
            data: { status: "EXPIRED" },
          })
        }
      }
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
