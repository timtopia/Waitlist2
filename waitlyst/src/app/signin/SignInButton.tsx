"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/Button"

export function SignInButton({ callbackUrl }: { callbackUrl: string }) {
  const [loading, setLoading] = useState(false)
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
