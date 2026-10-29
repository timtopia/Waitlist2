/**
 * Once someone has been called up or served, their spot is no longer
 * something to trade: buying a served person's place buys nothing (served
 * people don't count toward anyone's wait), and swapping with the person at
 * the counter would push them back after the organizer called them.
 */
export function tradeBlocker(
  position: { userId: string; fulfilled: boolean },
  nowServingUserId: string | null,
  whose: "yours" | "theirs"
): string | null {
  if (position.fulfilled) {
    return whose === "yours"
      ? "You've already been served, so your spot can't be traded."
      : "That person has already been served, so their spot can't be traded."
  }
  if (nowServingUserId && position.userId === nowServingUserId) {
    return whose === "yours"
      ? "You've been called up, so your spot can't be traded now."
      : "That person has been called up, so their spot can't be traded now."
  }
  return null
}
