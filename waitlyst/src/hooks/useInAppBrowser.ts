"use client"

import { useSyncExternalStore } from "react"

/**
 * Social apps' built-in browsers, where Google refuses to sign in
 * ("403 disallowed_useragent"). A link tapped on Instagram, TikTok,
 * LinkedIn, WeChat... was a dead end at "Continue with Google".
 */
export const IN_APP_BROWSER =
  /Instagram|FBAN|FBAV|TikTok|musical_ly|BytedanceWebview|Line\/|Snapchat|Twitter|LinkedInApp|MicroMessenger|Pinterest|KAKAOTALK/i

// The user agent never changes while the page is open
const subscribe = () => () => {}

/** False on the server and during hydration, so the markup matches */
export function useInAppBrowser(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => IN_APP_BROWSER.test(navigator.userAgent),
    () => false
  )
}
