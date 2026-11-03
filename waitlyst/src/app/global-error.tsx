"use client"

/**
 * Last resort when the root layout itself fails: without this, Next shows
 * its own unstyled page with nothing to try or quote to support. It replaces
 * the whole document, so it can't rely on the layout's fonts or styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f7f5f0", color: "#1a1a1a" }}>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <h1 style={{ fontSize: 24, marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ color: "#555", marginBottom: 24 }}>
              Waitlyst couldn&apos;t load. Please try again in a moment.
            </p>
            <button
              onClick={() => reset()}
              style={{ padding: "12px 20px", minHeight: 44, background: "#1a1a1a", color: "#fff", border: 0, cursor: "pointer" }}
            >
              Try again
            </button>
            {error.digest && (
              <p style={{ color: "#555", fontSize: 14, marginTop: 24 }}>
                Still stuck? Email support@waitlyst.app with reference{" "}
                <span style={{ fontFamily: "monospace" }}>{error.digest}</span>.
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  )
}
