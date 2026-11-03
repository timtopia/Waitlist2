"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/Button"
import { useInAppBrowser } from "@/hooks/useInAppBrowser"

export function SignInButton({ callbackUrl }: { callbackUrl: string }) {
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const inAppBrowser = useInAppBrowser()

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
              setCopied(false)
            }
          }}
          className="mt-2 font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4 min-h-11 pointer-fine:min-h-0"
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
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
