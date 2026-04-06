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

    const notification = new Notification(title, {
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      ...options,
    })

    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  }, [])

  return { requestPermission, sendNotification }
}
