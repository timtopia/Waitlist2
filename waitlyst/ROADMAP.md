# Waitlyst — Product Roadmap

## Elevator Pitch

**Waitlyst is a digital queue platform that lets creators run fair, transparent lines for drops, events, and limited releases — with optional paid position swapping and built-in payouts.**

An artist drops 50 prints. A restaurant opens for walk-ins. A brand launches limited merch. Instead of a chaotic first-come-first-served rush or an unfair Google Form, Waitlyst gives them a real-time queue where people can see their position, get notified when they're up, and optionally swap spots with the person next to them for a small fee. The creator earns on every swap, controls whether swapping is even allowed, and only releases payments when someone actually gets their item. No scalpers. No bots. Just a fair line.

---

## What's Built (v1)

### Core Queue System
- Create lines with name, description, capacity, scheduling (open/close times)
- Join/leave with real-time position tracking
- "Now Serving" display and "Call Next" for live events
- QR codes for in-person lines, embeddable widget for websites
- Batch remove for clearing no-shows
- Estimated wait time per position

### Drop-Specific Features
- Product info (name, image, retail price, link) attached to lines
- Hidden capacity (users see "Limited spots" not "42 of 50")
- Countdown timers with urgency animations (pulsing < 1hr, red < 5min)
- Line creation templates (Product Drop, Live Queue, Event Waitlist)
- Fulfillment system — creator marks who actually got the item

### Position Swapping
- Offer-based system: person behind offers a price to person in front
- 1 offer limit per pair (no spamming)
- Accept/decline flow
- Creator controls: allow/disable swapping, max price cap
- Swap payments held (authorized, not charged) until fulfillment
- Unfulfilled swaps cancel the hold — $0 cost vs refunds

### Payments & Payouts
- Stripe Checkout with authorize-then-capture model
- Stripe Connect Express for seller/owner payouts
- Platform fee (10%) + optional owner fee (0-50%)
- Payment splits: seller → Connect account, owner fee → Connect account, platform fee → retained
- Financial clarity: available vs pending settlement vs pending payment

### Creator Tools
- Dashboard with search, filter (active/paused), sort
- Line pause/resume, duplicate, CSV export
- Owner announcements (280 char banner)
- Stats modal (settled, refunded, pending, net revenue)
- Downstream buyer visibility on removal

### User Experience
- Google OAuth sign-in
- Member Status Card ("You're #8 · Spot secured · ~15 min wait")
- Profile with editable name, financial breakdown, transaction history
- Browser notifications for line updates
- Mobile hamburger menu, responsive queue cards
- Custom 404/error pages, OG meta tags, dynamic favicon

### Infrastructure
- PostgreSQL on Vercel Postgres (Neon), migrated from MongoDB
- 236 tests across 11 test files covering all API routes
- Reusable utilities (auth helpers, formatting, DropdownMenu component)
- Optimized polling (30s line, 60s dashboard, paused when tab hidden)
- Browse API cached with stale-while-revalidate

---

## Roadmap: What's Next

### Phase 1: Launch Readiness (1-2 weeks)

**Email notifications**
- Send email when your position changes, when you're called, when a line opens
- Use Resend or SendGrid (simple transactional emails)
- Notification preferences in profile (per-event toggles)
- Critical for drops: "Your line opens in 30 minutes"

**Settlement summary view**
- When creator closes a line, show all swap transactions
- Per-transaction choice: honor or cancel the swap payment
- Show who was fulfilled, who wasn't, who moved too far down
- Bulk actions: "Cancel all swaps for unfulfilled positions"

**Terms of service + privacy policy pages**
- Required for Stripe Connect compliance
- Simple static pages at /terms and /privacy
- Footer links already point to them

**Production environment separation**
- Neon database branching (prod vs dev)
- Stripe live vs test keys per Vercel environment
- Git branch strategy (main → prod, dev → preview)

### Phase 2: Growth Features (2-4 weeks)

**Discord bot**
- Post to a channel when a line goes live, when countdown hits 1hr, when positions swap
- Deep link back to Waitlyst
- This is the #1 distribution channel for drop communities

**Push notifications (PWA)**
- Web push notifications that work even when the browser is closed
- "Add to Home Screen" install prompt
- Service worker for offline caching of line details

**Creator analytics dashboard**
- Charts: positions over time, swap volume, revenue per line
- Aggregate stats across all lines
- Export analytics as PDF/CSV

**Social sharing improvements**
- OG image generation with product image + line stats (dynamic)
- "I'm #8 in line for [Product]" shareable card
- Referral tracking (who shared the link)

### Phase 3: Platform Expansion (1-3 months)

**Multi-provider auth**
- Email/password sign-up alongside Google
- Apple Sign-In, Discord OAuth
- Account linking (multiple auth methods per user)

**Categories and discovery**
- Category tags on lines (Music, Streetwear, Food, Events, etc.)
- Category browsing page with trending lines per category
- Search by creator name

**Creator profiles**
- Public creator pages: `/creators/[username]`
- Show all their lines, stats, rating
- Follow creators for notifications on new lines

**Recurring lines**
- "This line repeats weekly" — auto-create new line instances
- Good for restaurants, weekly drops, recurring events

**API for integrations**
- Public API for creators to manage lines programmatically
- Shopify app: create a Waitlyst line from Shopify product page
- Webhook notifications for line events (join, swap, fulfill)

### Phase 4: Scale & Monetization (3-6 months)

**Creator subscription tiers**
- Free: 3 active lines, basic features
- Pro ($29/mo): unlimited lines, analytics, priority support, lower platform fee (5%)
- Enterprise: custom branding, API access, dedicated support

**White-label option**
- Creators embed Waitlyst with their own branding
- Custom colors, logo, domain (waitlist.theirbrand.com)

**Fraud detection**
- Bot detection on joins (rate limiting, captcha for suspicious activity)
- Duplicate account detection
- Swap pattern analysis (detect coordinated scalping)

**International expansion**
- Multi-currency support
- Localization (i18n)
- Region-specific Stripe Connect onboarding

---

## Technical Debt to Address

- [ ] Replace `Float` with `Decimal` for monetary fields (precision)
- [ ] Add database indexes on SwapOffer queries
- [ ] Rate limiting on API routes (especially join, offer)
- [ ] Request validation middleware (zod schemas)
- [ ] Structured logging (replace console.log/error)
- [ ] Error tracking (Sentry integration)
- [ ] CI/CD pipeline with test gates
- [ ] Database connection pooling optimization
- [ ] Image upload for products (vs URL-only)
- [ ] Soft deletes for lines (archive instead of permanent delete)

---

## Key Metrics to Track

| Metric | Why it matters |
|--------|---------------|
| Lines created per week | Supply-side growth |
| Joins per line (avg) | Demand density |
| Swap rate (swaps / joins) | Feature engagement |
| Swap value (avg $ per swap) | Revenue per transaction |
| Creator retention (% creating 2nd line) | Product-market fit |
| Time to first join (after line creation) | Activation speed |
| Fulfillment rate (% positions fulfilled) | Drop completion quality |
| Platform revenue (monthly) | Business health |

---

*Last updated: April 15, 2026*
