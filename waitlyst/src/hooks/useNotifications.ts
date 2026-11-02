"use client"

import { useEffect, useCallback, useRef } from "react"

type NotificationPermission = "default" | "denied" | "granted"

export function useNotifications() {
  const permissionRef = useRef<NotificationPermission>("default")

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      permissionRef.current = Notification.permission
    }
  }, [])

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "denied" as NotificationPermission
    }
    if (Notification.permission === "granted") {
      permissionRef.current = "granted"
      return "granted" as NotificationPermission
    }
    if (Notification.permission === "denied") {
      return "denied" as NotificationPermission
    }
    const result = await Notification.requestPermission()
    permissionRef.current = result
    return result
  }, [])

  const sendNotification = useCallback((title: string, options?: NotificationOptions) => {
    if (typeof window === "undefined" || !("Notification" in window)) return
    if (Notification.permission !== "granted") return
    // Don't notify if page is focused
    if (document.visibilityState === "visible") return

    let notification: Notification
    try {
      notification = new Notification(title, {
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        // A notification replacing one with the same tag is silent unless asked
        ...(!!options?.tag && { renotify: true }),
        ...options,
      } as NotificationOptions)
    } catch {
      // Android Chrome only allows notifications from a service worker and
      // throws "Illegal constructor" here; don't break the caller's update loop
      return
    }

    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  }, [])

  return { requestPermission, sendNotification }
}
