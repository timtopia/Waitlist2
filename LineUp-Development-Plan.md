# LineUp: Queue Position Trading Platform

## Project Overview

A web application that allows users to create and join virtual "lines" (queues), with the ability to sell their position to the person directly behind them.

### Core Features
- Google OAuth authentication
- Create named lines/queues
- Join existing lines
- List your position for sale (set a price)
- Buy the position of the person directly in front of you
- Real-time updates when positions change

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | Next.js 14 (App Router) | React framework with SSR |
| Styling | Tailwind CSS | Utility-first CSS |
| Backend | Next.js API Routes | Server-side logic |
| Database | PostgreSQL + Prisma | Data persistence + ORM |
| Auth | NextAuth.js | Google OAuth integration |
| Real-time | Pusher or Socket.io | Live position updates |
| Payments | Stripe (optional) | Handle real money transactions |

---

## Phase 1: Project Setup & Authentication

### Goals
- Initialize Next.js project with TypeScript
- Set up PostgreSQL database
- Configure Prisma ORM
- Implement Google OAuth with NextAuth.js

### Tasks

#### 1.1 Initialize Project
```bash
npx create-next-app@latest lineup --typescript --tailwind --app --src-dir
cd lineup
```

#### 1.2 Install Dependencies
```bash
npm install prisma @prisma/client next-auth @auth/prisma-adapter
npm install -D prisma
```

#### 1.3 Set Up Prisma Schema
Create `prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// NextAuth required models
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model User {
  id            String         @id @default(cuid())
  name          String?
  email         String?        @unique
  emailVerified DateTime?
  image         String?
  accounts      Account[]
  sessions      Session[]
  createdLines  Line[]         @relation("LineCreator")
  positions     LinePosition[]
  createdAt     DateTime       @default(now())
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

#### 1.4 Configure NextAuth
Create `src/app/api/auth/[...nextauth]/route.ts`:
```typescript
import NextAuth from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"

const handler = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    session: async ({ session, user }) => {
      if (session.user) {
        session.user.id = user.id
      }
      return session
    },
  },
})

export { handler as GET, handler as POST }
```

#### 1.5 Environment Variables
Create `.env.local`:
```
DATABASE_URL="postgresql://user:password@localhost:5432/lineup"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-a-secret-here"
```

#### 1.6 Create Prisma Client Singleton
Create `src/lib/prisma.ts`:
```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma || new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

### Deliverables
- [ ] Working Next.js project
- [ ] PostgreSQL database connected
- [ ] Google OAuth login/logout working
- [ ] User sessions persisted

---

## Phase 2: Database Models for Lines

### Goals
- Add Line and LinePosition models
- Create database migrations
- Set up basic CRUD operations

### Tasks

#### 2.1 Extend Prisma Schema
Add to `prisma/schema.prisma`:
```prisma
model Line {
  id          String         @id @default(cuid())
  name        String
  description String?
  createdById String
  createdBy   User           @relation("LineCreator", fields: [createdById], references: [id])
  positions   LinePosition[]
  isActive    Boolean        @default(true)
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
}

model LinePosition {
  id          String    @id @default(cuid())
  lineId      String
  line        Line      @relation(fields: [lineId], references: [id], onDelete: Cascade)
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  position    Int       // 1 = first in line
  askingPrice Decimal?  @db.Decimal(10, 2) // null = not for sale
  joinedAt    DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@unique([lineId, userId])     // User can only be in a line once
  @@unique([lineId, position])   // Each position is unique per line
  @@index([lineId, position])    // Fast position lookups
}
```

#### 2.2 Run Migration
```bash
npx prisma migrate dev --name add_lines
npx prisma generate
```

### Deliverables
- [ ] Line and LinePosition models created
- [ ] Database migrated
- [ ] Prisma client regenerated

---

## Phase 3: Line Management API

### Goals
- Create API routes for line operations
- Implement position management logic
- Handle edge cases (leaving line, position swaps)

### Tasks

#### 3.1 Create Line API Routes

**POST /api/lines** - Create a new line
```typescript
// src/app/api/lines/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: Request) {
  const session = await getServerSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { name, description } = await req.json()
  
  const line = await prisma.line.create({
    data: {
      name,
      description,
      createdById: session.user.id,
    },
  })

  return NextResponse.json(line)
}

export async function GET() {
  const lines = await prisma.line.findMany({
    where: { isActive: true },
    include: {
      createdBy: { select: { name: true, image: true } },
      _count: { select: { positions: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(lines)
}
```

#### 3.2 Join Line API

**POST /api/lines/[lineId]/join** - Join a line
```typescript
// src/app/api/lines/[lineId]/join/route.ts
export async function POST(
  req: Request,
  { params }: { params: { lineId: string } }
) {
  const session = await getServerSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { lineId } = params

  // Use transaction for atomic operation
  const position = await prisma.$transaction(async (tx) => {
    // Check if already in line
    const existing = await tx.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: session.user.id } },
    })
    if (existing) {
      throw new Error("Already in this line")
    }

    // Get next position number
    const lastPosition = await tx.linePosition.findFirst({
      where: { lineId },
      orderBy: { position: "desc" },
    })
    const nextPosition = (lastPosition?.position ?? 0) + 1

    // Create position
    return tx.linePosition.create({
      data: {
        lineId,
        userId: session.user.id,
        position: nextPosition,
      },
    })
  })

  return NextResponse.json(position)
}
```

#### 3.3 Set Price API

**PATCH /api/lines/[lineId]/price** - Set asking price
```typescript
// src/app/api/lines/[lineId]/price/route.ts
export async function PATCH(
  req: Request,
  { params }: { params: { lineId: string } }
) {
  const session = await getServerSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { price } = await req.json() // null to remove from sale

  const position = await prisma.linePosition.update({
    where: {
      lineId_userId: {
        lineId: params.lineId,
        userId: session.user.id,
      },
    },
    data: { askingPrice: price },
  })

  return NextResponse.json(position)
}
```

#### 3.4 Buy Position API

**POST /api/lines/[lineId]/buy** - Buy the position in front
```typescript
// src/app/api/lines/[lineId]/buy/route.ts
export async function POST(
  req: Request,
  { params }: { params: { lineId: string } }
) {
  const session = await getServerSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { lineId } = params

  const result = await prisma.$transaction(async (tx) => {
    // Get buyer's current position
    const buyerPosition = await tx.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: session.user.id } },
    })
    if (!buyerPosition) {
      throw new Error("You must be in the line to buy a position")
    }

    // Get position directly in front
    const targetPosition = await tx.linePosition.findFirst({
      where: {
        lineId,
        position: buyerPosition.position - 1,
      },
      include: { user: true },
    })
    if (!targetPosition) {
      throw new Error("No one in front of you")
    }
    if (!targetPosition.askingPrice) {
      throw new Error("This position is not for sale")
    }

    // Swap positions (use temporary position to avoid unique constraint)
    const tempPosition = -1

    await tx.linePosition.update({
      where: { id: buyerPosition.id },
      data: { position: tempPosition },
    })

    await tx.linePosition.update({
      where: { id: targetPosition.id },
      data: { 
        position: buyerPosition.position,
        askingPrice: null, // Remove from sale after swap
      },
    })

    await tx.linePosition.update({
      where: { id: buyerPosition.id },
      data: { position: targetPosition.position },
    })

    // TODO: Handle payment transfer here

    return { 
      success: true, 
      newPosition: targetPosition.position,
      price: targetPosition.askingPrice,
    }
  })

  return NextResponse.json(result)
}
```

#### 3.5 Leave Line API

**DELETE /api/lines/[lineId]/leave** - Leave a line
```typescript
// src/app/api/lines/[lineId]/leave/route.ts
export async function DELETE(
  req: Request,
  { params }: { params: { lineId: string } }
) {
  const session = await getServerSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { lineId } = params

  await prisma.$transaction(async (tx) => {
    // Get user's position
    const position = await tx.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: session.user.id } },
    })
    if (!position) {
      throw new Error("Not in this line")
    }

    // Delete position
    await tx.linePosition.delete({
      where: { id: position.id },
    })

    // Shift everyone behind up by one
    await tx.linePosition.updateMany({
      where: {
        lineId,
        position: { gt: position.position },
      },
      data: {
        position: { decrement: 1 },
      },
    })
  })

  return NextResponse.json({ success: true })
}
```

### Deliverables
- [ ] Create line endpoint
- [ ] List lines endpoint
- [ ] Join line endpoint
- [ ] Set price endpoint
- [ ] Buy position endpoint
- [ ] Leave line endpoint

---

## Phase 4: Frontend UI

### Goals
- Build responsive UI components
- Create pages for line browsing, viewing, and management
- Implement client-side state management

### Tasks

#### 4.1 Layout & Navigation
Create `src/app/layout.tsx` with:
- Header with logo, navigation, user menu
- Auth state display (login button or user avatar)
- Mobile-responsive navigation

#### 4.2 Home Page
Create `src/app/page.tsx`:
- Hero section explaining the app
- List of active lines (cards)
- "Create Line" button (if authenticated)
- Filter/search functionality

#### 4.3 Line Detail Page
Create `src/app/lines/[lineId]/page.tsx`:
- Line name, description, creator info
- Visual queue display showing all positions
- Current user's position highlighted
- "Join Line" button (if not in line)
- Price input for setting asking price
- "Buy" button for position in front (if for sale)
- "Leave Line" button

#### 4.4 Create Line Page
Create `src/app/lines/new/page.tsx`:
- Form with name and description
- Submit creates line and redirects

#### 4.5 User Dashboard
Create `src/app/dashboard/page.tsx`:
- Lines user has created
- Lines user is currently in
- Position and price status for each

### Component Structure
```
src/
├── components/
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   └── Modal.tsx
│   ├── LineCard.tsx
│   ├── QueueDisplay.tsx
│   ├── PositionCard.tsx
│   ├── PriceInput.tsx
│   ├── AuthButton.tsx
│   └── Header.tsx
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── dashboard/
│   │   └── page.tsx
│   └── lines/
│       ├── new/
│       │   └── page.tsx
│       └── [lineId]/
│           └── page.tsx
└── lib/
    ├── prisma.ts
    └── utils.ts
```

### Deliverables
- [ ] Responsive layout with navigation
- [ ] Home page with line listing
- [ ] Line detail page with queue visualization
- [ ] Create line form
- [ ] User dashboard
- [ ] All interactive features working

---

## Phase 5: Real-Time Updates

### Goals
- Add real-time position updates
- Notify users when positions change
- Update UI without page refresh

### Tasks

#### 5.1 Choose Real-Time Solution

**Option A: Pusher (Recommended for simplicity)**
```bash
npm install pusher pusher-js
```

**Option B: Socket.io (More control)**
```bash
npm install socket.io socket.io-client
```

#### 5.2 Set Up Pusher

Create `src/lib/pusher.ts`:
```typescript
import Pusher from "pusher"
import PusherClient from "pusher-js"

// Server-side
export const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.NEXT_PUBLIC_PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
  useTLS: true,
})

// Client-side
export const pusherClient = new PusherClient(
  process.env.NEXT_PUBLIC_PUSHER_KEY!,
  { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER! }
)
```

#### 5.3 Emit Events from API Routes

Add to buy, join, leave, and price update routes:
```typescript
await pusherServer.trigger(`line-${lineId}`, "position-update", {
  type: "swap" | "join" | "leave" | "price-change",
  positions: updatedPositions,
})
```

#### 5.4 Subscribe in Frontend

Create `src/hooks/useLineUpdates.ts`:
```typescript
import { useEffect } from "react"
import { pusherClient } from "@/lib/pusher"

export function useLineUpdates(lineId: string, onUpdate: (data: any) => void) {
  useEffect(() => {
    const channel = pusherClient.subscribe(`line-${lineId}`)
    channel.bind("position-update", onUpdate)

    return () => {
      channel.unbind("position-update", onUpdate)
      pusherClient.unsubscribe(`line-${lineId}`)
    }
  }, [lineId, onUpdate])
}
```

### Deliverables
- [ ] Pusher/Socket.io configured
- [ ] Events emitted on all position changes
- [ ] Frontend subscribes and updates in real-time
- [ ] Smooth UI transitions on updates

---

## Phase 6: Payments (Optional)

### Goals
- Integrate Stripe for real money transactions
- Handle payment flow for buying positions
- Manage user balances or direct transfers

### Tasks

#### 6.1 Set Up Stripe
```bash
npm install stripe @stripe/stripe-js
```

#### 6.2 Payment Models
Add to Prisma schema:
```prisma
model Transaction {
  id            String   @id @default(cuid())
  buyerId       String
  sellerId      String
  lineId        String
  amount        Decimal  @db.Decimal(10, 2)
  stripePaymentId String?
  status        TransactionStatus
  createdAt     DateTime @default(now())
}

enum TransactionStatus {
  PENDING
  COMPLETED
  FAILED
  REFUNDED
}
```

#### 6.3 Payment Flow
1. Buyer clicks "Buy" → Create Stripe PaymentIntent
2. Buyer completes payment → Webhook confirms
3. On confirmation → Execute position swap
4. Transfer funds to seller (Stripe Connect)

### Deliverables
- [ ] Stripe integration
- [ ] Payment intent creation
- [ ] Webhook handling
- [ ] Transaction recording
- [ ] Seller payouts (Stripe Connect)

---

## Phase 7: Polish & Deploy

### Goals
- Add error handling and loading states
- Optimize performance
- Deploy to production

### Tasks

#### 7.1 Error Handling
- Add try/catch to all API routes
- Display user-friendly error messages
- Add toast notifications for actions

#### 7.2 Loading States
- Skeleton loaders for lists
- Button loading states
- Optimistic updates for better UX

#### 7.3 Testing
- Unit tests for position swap logic
- Integration tests for API routes
- E2E tests for critical flows

#### 7.4 Deployment
- Set up Vercel project
- Configure PostgreSQL (Supabase/Neon/Railway)
- Set environment variables
- Configure custom domain

### Deliverables
- [ ] Comprehensive error handling
- [ ] Loading states everywhere
- [ ] Test coverage
- [ ] Production deployment
- [ ] Custom domain configured

---

## Quick Reference: Claude Code Prompts

Use these prompts with Claude Code to build each phase:

### Phase 1
```
Set up a new Next.js 14 project with TypeScript, Tailwind CSS, Prisma, and NextAuth.js with Google OAuth. Include the User, Account, Session, and VerificationToken models for NextAuth.
```

### Phase 2
```
Add Line and LinePosition models to the Prisma schema. A Line has a name, description, and creator. LinePosition tracks a user's position in a line with an optional asking price.
```

### Phase 3
```
Create API routes for: creating lines, listing lines, joining a line, setting a price, buying the position in front, and leaving a line. Use transactions for atomic position swaps.
```

### Phase 4
```
Build the frontend with: a home page listing all lines, a line detail page showing the queue with buy/sell functionality, a create line form, and a user dashboard.
```

### Phase 5
```
Add Pusher for real-time updates. Emit events when positions change and subscribe on the frontend to update the UI without refreshing.
```

### Phase 6
```
Integrate Stripe for payments. Create payment intents when buying positions, handle webhooks, and use Stripe Connect for seller payouts.
```

---

## File Structure Reference

```
lineup/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   └── [...nextauth]/
│   │   │   │       └── route.ts
│   │   │   └── lines/
│   │   │       ├── route.ts
│   │   │       └── [lineId]/
│   │   │           ├── route.ts
│   │   │           ├── join/
│   │   │           │   └── route.ts
│   │   │           ├── leave/
│   │   │           │   └── route.ts
│   │   │           ├── price/
│   │   │           │   └── route.ts
│   │   │           └── buy/
│   │   │               └── route.ts
│   │   ├── dashboard/
│   │   │   └── page.tsx
│   │   ├── lines/
│   │   │   ├── new/
│   │   │   │   └── page.tsx
│   │   │   └── [lineId]/
│   │   │       └── page.tsx
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── ui/
│   │   ├── Header.tsx
│   │   ├── LineCard.tsx
│   │   ├── QueueDisplay.tsx
│   │   └── ...
│   ├── hooks/
│   │   └── useLineUpdates.ts
│   ├── lib/
│   │   ├── prisma.ts
│   │   ├── pusher.ts
│   │   └── utils.ts
│   └── types/
│       └── next-auth.d.ts
├── .env.local
├── package.json
└── tsconfig.json
```
