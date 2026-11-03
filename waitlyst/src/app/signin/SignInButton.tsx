"use client"

import { useEffect, useState } from "react"
import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/Button"
import { useInAppBrowser } from "@/hooks/useInAppBrowser"

export function SignInButton({ callbackUrl }: { callbackUrl: string }) {
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const inAppBrowser = useInAppBrowser()

  // Back from Google restores this page from the back/forward cache with the
  // spinner still going; reset it so they can try again
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setLoading(false) }
    window.addEventListener("pageshow", onShow)
    return () => window.removeEventListener("pageshow", onShow)
  }, [])

  if (inAppBrowser) {
    return (
      <div className="w-full border border-amber-300 bg-amber-50 p-3 text-sm text-ink" role="note">
        <p>
          Google sign-in doesn&apos;t work inside this app&apos;s browser. Open this page in Safari or Chrome (tap
          the ••• menu, then &quot;Open in browser&quot;).
        </p>
        <button
          onClick={async () => {
            try {
              // The whole URL, so the line they were joining comes along
              await navigator.clipboard.writeText(window.location.href)
              setCopied(true)
            } catch {
              // Clipboard is often blocked in these webviews: show the link to
              // copy by hand instead of a button that silently does nothing
              setCopyFailed(true)
            }
          }}
          className="mt-2 font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4 min-h-11 pointer-fine:min-h-0"
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
        {copyFailed && (
          <>
            <p className="mt-2 text-xs text-ink/70" role="status">Couldn&apos;t copy. Press and hold the link to copy it:</p>
            <input
              readOnly
              aria-label="Link to open in your browser"
              value={window.location.href}
              onFocus={(e) => e.target.select()}
              className="mt-1 w-full font-mono text-base sm:text-xs px-2 py-2 bg-white border border-rule text-ink/70"
            />
          </>
        )}
      </div>
    )
  }

  return (
    <Button
      className="w-full"
      size="lg"
      isLoading={loading}
      onClick={() => {
        setLoading(true)
        signIn("google", { callbackUrl })
      }}
    >
      Continue with Google
    </Button>
  )
}
