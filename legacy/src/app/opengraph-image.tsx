import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "0509 — Competitor Ad Research";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#0f1729",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "80px 96px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Subtle grid accent */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: "480px",
            height: "480px",
            background:
              "radial-gradient(circle at 80% 20%, rgba(99,102,241,0.15) 0%, transparent 60%)",
          }}
        />

        {/* Wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: "48px",
          }}
        >
          <span
            style={{
              fontSize: "28px",
              fontWeight: "700",
              letterSpacing: "-0.02em",
              color: "#ffffff",
              background: "rgba(99,102,241,0.2)",
              border: "1px solid rgba(99,102,241,0.4)",
              borderRadius: "8px",
              padding: "6px 14px",
            }}
          >
            0509
          </span>
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: "64px",
            fontWeight: "700",
            lineHeight: "1.1",
            letterSpacing: "-0.03em",
            color: "#ffffff",
            maxWidth: "820px",
            marginBottom: "28px",
          }}
        >
          Competitor ad research,{" "}
          <span style={{ color: "#818cf8" }}>without the noise.</span>
        </div>

        {/* Subtext */}
        <div
          style={{
            fontSize: "26px",
            color: "#94a3b8",
            lineHeight: "1.5",
            maxWidth: "700px",
          }}
        >
          Scan competitor ads, compare angles, and spot patterns faster with
          Meta Ad Library signal.
        </div>

        {/* Bottom accent */}
        <div
          style={{
            position: "absolute",
            bottom: "48px",
            right: "96px",
            fontSize: "20px",
            color: "#475569",
            letterSpacing: "0.05em",
          }}
        >
          0509.in
        </div>
      </div>
    ),
    { ...size }
  );
}
