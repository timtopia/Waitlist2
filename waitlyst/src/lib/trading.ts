/**
 * Starting a checkout locks both spots until it's paid or expires, so a buyer
 * who keeps starting and abandoning checkouts (directly, or by getting
 * offers accepted and never paying) holds up the person ahead. After this
 * many walk-aways in the window they can't start another.
 */
export const MAX_ABANDONED_CHECKOUTS = 3
export const ABANDON_WINDOW_MS = 6 * 60 * 60 * 1000

/**
 * Once someone has been called up or served, their spot is no longer
 * something to trade: buying a served person's place buys nothing (served
 * people don't count toward anyone's wait), and swapping with the person at
 * the counter would push them back after the organizer called them.
 */
export function tradeBlocker(
  position: { userId: string; fulfilled: boolean; calledAt: Date | string | null },
  nowServingUserId: string | null,
  whose: "yours" | "theirs"
): string | null {
  if (position.fulfilled) {
    return whose === "yours"
      ? "You've already been served, so your spot can't be traded."
      : "That person has already been served, so their spot can't be traded."
  }
  // Every called party is blocked, not just the one in "now serving":
  // restaurant hosts can have several parties called at once.
  if (position.calledAt || (nowServingUserId && position.userId === nowServingUserId)) {
    return whose === "yours"
      ? "You've been called up, so your spot can't be traded now."
      : "That person has been called up, so their spot can't be traded now."
  }
  return null
}
