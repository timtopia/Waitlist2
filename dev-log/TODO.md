# Waitlyst TODO List

## Pending Features

### 1. Delete Line Functionality
**Priority:** High
**Status:** Not Started

Allow line creators to delete their lines entirely.

**Considerations to address:**
- [ ] What happens to people currently in the line?
- [ ] What happens to pending transactions?
- [ ] What happens to completed transactions (payout vs refund)?
- [ ] Should there be a confirmation dialog?
- [ ] Should there be a "soft delete" (deactivate) vs "hard delete"?
- [ ] Should deletion be blocked if there are pending transactions?
- [ ] Notification to users in the line?

**Files likely to be created/modified:**
- `src/app/api/lines/[lineId]/route.ts` - DELETE endpoint
- `src/app/dashboard/DashboardClient.tsx` - Delete button UI
- `src/components/DeleteLineModal.tsx` - Confirmation modal (optional)

---

## Completed Features (Jan 25, 2026)
- [x] Position locking system (prevents conflicting swaps)
- [x] Owner priority over purchases
- [x] Payment tracking with payout/refund options
- [x] Transaction settlement system (stats count after both parties leave)

---

## Technical Debt
- [ ] Add comprehensive unit tests
- [ ] Add integration tests for API routes
- [ ] Add E2E tests with Playwright or Cypress

---

## Future Ideas
- [ ] Email notifications when position changes
- [ ] Webhook support for line events
- [ ] Line analytics dashboard
- [ ] Bulk operations for line management
- [ ] Export transaction history
