import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent } from "@/components/ui/Card"
import { SignInButton } from "./SignInButton"

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
}

interface Props {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}

/** Only same-site paths, so a crafted link can't bounce people elsewhere */
function safeCallback(raw: string | undefined): string {
  if (!raw) return "/dashboard"
  try {
    // NextAuth may hand us an absolute URL (from the referer); keeping only
    // its path means we always land back on this site
    const url = new URL(raw, "http://local")
    const path = `${url.pathname}${url.search}${url.hash}`
    return path.startsWith("/") && !path.startsWith("//") ? path : "/dashboard"
  } catch {
    return "/dashboard"
  }
}

/** Where the person was headed, in words, so the prompt makes sense */
function destinationLabel(path: string): string | null {
  if (path.startsWith("/dashboard")) return "your dashboard"
  if (path.startsWith("/profile")) return "your profile"
  if (path.startsWith("/lines/new")) return "create your line"
  if (/^\/lines\/[^/]+\/(edit|analytics|settlement)/.test(path)) return "manage this line"
  if (path.startsWith("/lines/")) return "this line"
  return null
}

export default async function SignInPage({ searchParams }: Props) {
  const { callbackUrl, error } = await searchParams
  // Cancelling at Google's account picker comes back as ?error=... with no
  // callbackUrl; Auth.js still has the destination in its cookie, so the
  // line (and ?join=1, party size) they were joining isn't lost
  const jar = await cookies()
  const fromCookie = jar.get("__Secure-authjs.callback-url")?.value ?? jar.get("authjs.callback-url")?.value
  const destination = safeCallback(callbackUrl ?? fromCookie)

  const session = await auth()
  if (session?.user) redirect(destination)

  let label = destinationLabel(destination)
  // Name the line: "this line" means nothing to someone who just scanned a QR code
  const lineMatch = destination.match(/^\/lines\/([^/?#]+)(?:[?#]|$)/)
  if (lineMatch && lineMatch[1] !== "new") {
    const line = await prisma.line
      .findUnique({ where: { id: lineMatch[1] }, select: { name: true } })
      .catch(() => null)
    if (line) label = line.name
  }
  const toLine = !!lineMatch && lineMatch[1] !== "new"

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <Card className="max-w-md w-full">
        <CardContent className="py-10">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent mb-4">
            Sign in
          </p>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">
            {label ? `Sign in to continue to ${label}` : "Sign in to Waitlyst"}
          </h1>
          <p className="text-ink/60 mb-6">
            An account lets you hold a spot in line, get a heads-up when it&apos;s
            your turn, and run lines of your own. There&apos;s no password: we use
            your Google account.
            {toLine && " You'll come straight back to the line."}
          </p>
          {error && (
            <p className="text-sm text-accent mb-4" role="alert">
              {error === "OAuthAccountNotLinked"
                ? "That email is already linked to a different sign-in. Try the account you used before."
                : error === "Configuration"
                  ? "Sign-in is having trouble on our end. Please try again in a minute."
                  : "Sign-in didn't go through. Please try again."}
            </p>
          )}
          <SignInButton callbackUrl={destination} />
          <p className="text-xs text-ink/60 mt-6">
            By signing in you agree to our{" "}
            <Link href="/terms" className="underline underline-offset-4 hover:text-ink">Terms</Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline underline-offset-4 hover:text-ink">Privacy Policy</Link>.
          </p>
          <p className="text-sm text-ink/60 mt-4">
            Just looking?{" "}
            {/* A shared (maybe private) line isn't in Browse, but its page works signed out */}
            {toLine ? (
              <>
                <Link href={destination} className="text-accent hover:underline underline-offset-4">
                  View {label || "the line"}
                </Link>{" "}
                without signing in.
              </>
            ) : (
              <>
                <Link href="/browse" className="text-accent hover:underline underline-offset-4">
                  Browse open lines
                </Link>{" "}
                without an account.
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
