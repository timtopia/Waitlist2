import { after } from "next/server"

/**
 * Run work (emails, notifications) after the response is sent, without
 * holding the request open. A bare un-awaited promise can be cut off on
 * serverless hosts as soon as the response returns; after() keeps the
 * function alive until it finishes. Outside a request (scripts, tests)
 * after() isn't available, so the work just runs now.
 */
export function runAfterResponse(task: () => Promise<unknown>): void {
  const run = () => task().catch((error) => console.error("Background task failed:", error))
  try {
    after(run)
  } catch {
    void run()
  }
}
