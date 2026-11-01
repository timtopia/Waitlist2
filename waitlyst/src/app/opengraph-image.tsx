import { ImageResponse } from "next/og"

export const alt = "Waitlyst -- Wait anywhere. Keep your place."
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = "image/png"

// Matches the site palette in globals.css (paper, ink, accent, rule)
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#f5f3ee",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          color: "#1a1815",
          fontFamily: "sans-serif",
          borderLeft: "16px solid #c8401a",
        }}
      >
        <div
          style={{
            fontSize: 132,
            fontWeight: 700,
            letterSpacing: "0.08em",
            lineHeight: 1,
          }}
        >
          WAITLYST
        </div>
        <div
          style={{
            marginTop: 40,
            paddingTop: 32,
            borderTop: "2px solid #d8d4ca",
            fontSize: 52,
            color: "#1a1815",
            opacity: 0.7,
          }}
        >
          Wait anywhere. Keep your place.
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
