import { prisma } from "./prisma"

/**
 * Who is looking at a line decides how much of its members they see:
 * - the owner sees everyone's full name (they run the line)
 * - people in the line see each other's first name and last initial
 * - everyone else sees positions and counts, but no names or photos
 */
export type LineViewer = "owner" | "member" | "public"

export async function lineViewer(
  lineId: string,
  createdById: string,
  viewerId: string | null
): Promise<LineViewer> {
  if (!viewerId) return "public"
  if (viewerId === createdById) return "owner"
  const position = await prisma.linePosition.findUnique({
    where: { lineId_userId: { lineId, userId: viewerId } },
    select: { id: true },
  })
  return position ? "member" : "public"
}

/** "Timothy Zhang" -> "Timothy Z." -- enough to recognise someone in line. */
export function shortName(name: string | null | undefined): string | null {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

/** The first word of a name, for messages shown to everyone ("Alice, you're up"). */
export function firstName(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] || null
}
