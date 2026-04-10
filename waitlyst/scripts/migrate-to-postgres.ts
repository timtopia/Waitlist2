/**
 * Migrate data from MongoDB Atlas to Vercel Postgres (Neon).
 *
 * Prerequisites:
 *   - Postgres tables already created via `npx prisma migrate dev --name init`
 *   - Both DATABASE_URL (MongoDB) and POSTGRES_PRISMA_URL (Postgres) in .env
 *
 * Usage:
 *   npx tsx scripts/migrate-to-postgres.ts
 */

import { MongoClient, ObjectId } from "mongodb"
import { PrismaClient } from "@prisma/client"
import { readFileSync } from "fs"
import { resolve } from "path"

// Load .env manually (no dotenv dependency)
const envPath = resolve(__dirname, "..", ".env")
const envContent = readFileSync(envPath, "utf-8")
for (const line of envContent.split("\n")) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("#")) continue
  const eqIdx = trimmed.indexOf("=")
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx).trim()
  let val = trimmed.slice(eqIdx + 1).trim()
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1)
  }
  if (!process.env[key]) process.env[key] = val
}

// Find the MongoDB URL from .env (there may be multiple DATABASE_URL entries;
// Vercel adds a Postgres one too, so we grab the one starting with "mongodb")
let MONGO_URL: string | undefined
for (const line of envContent.split("\n")) {
  const trimmed = line.trim()
  if (trimmed.startsWith("DATABASE_URL=")) {
    let val = trimmed.slice("DATABASE_URL=".length).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (val.startsWith("mongodb")) {
      MONGO_URL = val
      break
    }
  }
}

if (!MONGO_URL) {
  console.error("Missing MongoDB DATABASE_URL in .env (expected a line starting with mongodb://)")
  process.exit(1)
}

const prisma = new PrismaClient()

/** Convert MongoDB _id (ObjectId or string) to a plain string */
function idToString(val: unknown): string {
  if (val instanceof ObjectId) return val.toHexString()
  return String(val)
}

/** Strip _id and convert ObjectIds, returning a clean object with `id` */
function transformDoc(doc: Record<string, unknown>): Record<string, unknown> {
  const { _id, ...rest } = doc

  const out: Record<string, unknown> = { id: idToString(_id), ...rest }

  // Convert any remaining ObjectId values to strings
  for (const [key, val] of Object.entries(out)) {
    if (val instanceof ObjectId) {
      out[key] = val.toHexString()
    }
  }

  return out
}

async function main() {
  console.log("=== MongoDB → Postgres Migration ===\n")

  // ── Connect to MongoDB ───────────────────────────────────────────────
  const mongo = new MongoClient(MONGO_URL!)
  await mongo.connect()
  const db = mongo.db() // uses DB name from connection string
  console.log("✓ Connected to MongoDB\n")

  // ── Read all collections ─────────────────────────────────────────────
  const users = (await db.collection("User").find().toArray()).map(transformDoc)
  const accounts = (await db.collection("Account").find().toArray()).map(transformDoc)
  const sessions = (await db.collection("Session").find().toArray()).map(transformDoc)
  const verificationTokens = (await db.collection("VerificationToken").find().toArray()).map(transformDoc)
  const lines = (await db.collection("Line").find().toArray()).map(transformDoc)
  const linePositions = (await db.collection("LinePosition").find().toArray()).map(transformDoc)
  const transactions = (await db.collection("Transaction").find().toArray()).map(transformDoc)

  console.log("MongoDB counts:")
  console.log(`  Users:              ${users.length}`)
  console.log(`  Accounts:           ${accounts.length}`)
  console.log(`  Sessions:           ${sessions.length}`)
  console.log(`  VerificationTokens: ${verificationTokens.length}`)
  console.log(`  Lines:              ${lines.length}`)
  console.log(`  LinePositions:      ${linePositions.length}`)
  console.log(`  Transactions:       ${transactions.length}`)
  console.log()

  // ── Insert into Postgres (in dependency order) ───────────────────────

  // 1. Users
  if (users.length > 0) {
    for (const u of users) {
      await prisma.user.create({
        data: {
          id: u.id as string,
          name: (u.name as string) ?? null,
          email: (u.email as string) ?? null,
          emailVerified: u.emailVerified ? new Date(u.emailVerified as string) : null,
          image: (u.image as string) ?? null,
          createdAt: u.createdAt ? new Date(u.createdAt as string) : new Date(),
        },
      })
    }
    console.log(`✓ Migrated ${users.length} users`)
  }

  // 2. Accounts
  if (accounts.length > 0) {
    for (const a of accounts) {
      await prisma.account.create({
        data: {
          id: a.id as string,
          userId: a.userId as string,
          type: a.type as string,
          provider: a.provider as string,
          providerAccountId: a.providerAccountId as string,
          refresh_token: (a.refresh_token as string) ?? null,
          access_token: (a.access_token as string) ?? null,
          expires_at: (a.expires_at as number) ?? null,
          token_type: (a.token_type as string) ?? null,
          scope: (a.scope as string) ?? null,
          id_token: (a.id_token as string) ?? null,
          session_state: (a.session_state as string) ?? null,
        },
      })
    }
    console.log(`✓ Migrated ${accounts.length} accounts`)
  }

  // 3. Sessions
  if (sessions.length > 0) {
    for (const s of sessions) {
      await prisma.session.create({
        data: {
          id: s.id as string,
          sessionToken: s.sessionToken as string,
          userId: s.userId as string,
          expires: new Date(s.expires as string),
        },
      })
    }
    console.log(`✓ Migrated ${sessions.length} sessions`)
  }

  // 4. VerificationTokens
  if (verificationTokens.length > 0) {
    for (const v of verificationTokens) {
      await prisma.verificationToken.create({
        data: {
          id: v.id as string,
          identifier: v.identifier as string,
          token: v.token as string,
          expires: new Date(v.expires as string),
        },
      })
    }
    console.log(`✓ Migrated ${verificationTokens.length} verification tokens`)
  }

  // 5. Lines
  if (lines.length > 0) {
    for (const l of lines) {
      await prisma.line.create({
        data: {
          id: l.id as string,
          name: l.name as string,
          description: (l.description as string) ?? null,
          createdById: l.createdById as string,
          isActive: (l.isActive as boolean) ?? true,
          isPublic: (l.isPublic as boolean) ?? true,
          opensAt: l.opensAt ? new Date(l.opensAt as string) : null,
          closesAt: l.closesAt ? new Date(l.closesAt as string) : null,
          maxCapacity: (l.maxCapacity as number) ?? null,
          ownerFeePercent: (l.ownerFeePercent as number) ?? 0,
          createdAt: l.createdAt ? new Date(l.createdAt as string) : new Date(),
          updatedAt: l.updatedAt ? new Date(l.updatedAt as string) : new Date(),
        },
      })
    }
    console.log(`✓ Migrated ${lines.length} lines`)
  }

  // 6. LinePositions
  if (linePositions.length > 0) {
    for (const lp of linePositions) {
      await prisma.linePosition.create({
        data: {
          id: lp.id as string,
          lineId: lp.lineId as string,
          userId: lp.userId as string,
          position: lp.position as number,
          askingPrice: (lp.askingPrice as number) ?? null,
          lockedUntil: lp.lockedUntil ? new Date(lp.lockedUntil as string) : null,
          lockedBy: (lp.lockedBy as string) ?? null,
          joinedAt: lp.joinedAt ? new Date(lp.joinedAt as string) : new Date(),
          updatedAt: lp.updatedAt ? new Date(lp.updatedAt as string) : new Date(),
        },
      })
    }
    console.log(`✓ Migrated ${linePositions.length} line positions`)
  }

  // 7. Transactions
  if (transactions.length > 0) {
    for (const t of transactions) {
      await prisma.transaction.create({
        data: {
          id: t.id as string,
          buyerId: t.buyerId as string,
          sellerId: t.sellerId as string,
          lineId: t.lineId as string,
          amount: t.amount as number,
          ownerFee: (t.ownerFee as number) ?? 0,
          platformFee: (t.platformFee as number) ?? 0,
          stripePaymentId: (t.stripePaymentId as string) ?? null,
          status: t.status as "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED",
          settledAt: t.settledAt ? new Date(t.settledAt as string) : null,
          createdAt: t.createdAt ? new Date(t.createdAt as string) : new Date(),
        },
      })
    }
    console.log(`✓ Migrated ${transactions.length} transactions`)
  }

  // ── Verify counts ───────────────────────────────────────────────────
  console.log("\n--- Postgres verification ---")
  const pgUsers = await prisma.user.count()
  const pgAccounts = await prisma.account.count()
  const pgSessions = await prisma.session.count()
  const pgTokens = await prisma.verificationToken.count()
  const pgLines = await prisma.line.count()
  const pgPositions = await prisma.linePosition.count()
  const pgTransactions = await prisma.transaction.count()

  console.log(`  Users:              ${pgUsers} (expected ${users.length})`)
  console.log(`  Accounts:           ${pgAccounts} (expected ${accounts.length})`)
  console.log(`  Sessions:           ${pgSessions} (expected ${sessions.length})`)
  console.log(`  VerificationTokens: ${pgTokens} (expected ${verificationTokens.length})`)
  console.log(`  Lines:              ${pgLines} (expected ${lines.length})`)
  console.log(`  LinePositions:      ${pgPositions} (expected ${linePositions.length})`)
  console.log(`  Transactions:       ${pgTransactions} (expected ${transactions.length})`)

  const allMatch =
    pgUsers === users.length &&
    pgAccounts === accounts.length &&
    pgSessions === sessions.length &&
    pgTokens === verificationTokens.length &&
    pgLines === lines.length &&
    pgPositions === linePositions.length &&
    pgTransactions === transactions.length

  console.log(`\n${allMatch ? "✅ All counts match! Migration successful." : "⚠️  Count mismatch — check above for differences."}`)

  // ── Cleanup ──────────────────────────────────────────────────────────
  await mongo.close()
  await prisma.$disconnect()
  console.log("\n=== Migration Complete ===")
}

main().catch((err) => {
  console.error("\n❌ Migration failed:", err)
  process.exit(1)
})
