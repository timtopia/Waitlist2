import Link from "next/link"

export function Footer() {
  return (
    <footer className="bg-paper border-t border-ink">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="font-mono text-xs uppercase tracking-widest text-ink/50">
            &copy; 2026 Waitlyst
          </p>
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link
              href="/browse"
              className="font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink transition-colors"
            >
              Browse
            </Link>
            <Link
              href="/lines/new"
              className="font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink transition-colors"
            >
              Create
            </Link>
            <Link
              href="/privacy"
              className="font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink transition-colors"
            >
              Terms
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  )
}
