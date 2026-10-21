import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { accent, font, hairline, ink, mute } from "./theme";

export const Dots: React.FC<{ step?: number; color?: string }> = ({
  step = 44,
  color = "#e6e7f2",
}) => (
  <AbsoluteFill>
    <svg width="1920" height="1080">
      <defs>
        <pattern id="dots" width={step} height={step} patternUnits="userSpaceOnUse">
          <circle cx={1.5} cy={1.5} r={1.5} fill={color} />
        </pattern>
      </defs>
      <rect width="1920" height="1080" fill="url(#dots)" />
    </svg>
  </AbsoluteFill>
);

export const Backdrop: React.FC = () => {
  const f = useCurrentFrame();
  const inOpacity = interpolate(f, [0, 24], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: "#f7f8fd" }}>
      <AbsoluteFill style={{ opacity: inOpacity }}>
        <Dots />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(900px 700px at 78% 18%, rgba(201,210,255,0.55), rgba(201,210,255,0))",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(760px 620px at 12% 92%, rgba(255,255,255,0.9), rgba(255,255,255,0))",
        }}
      />
    </AbsoluteFill>
  );
};

export const Mark: React.FC<{ size: number; scale?: number }> = ({ size, scale = 1 }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.3,
      background: accent,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transform: `scale(${scale})`,
      boxShadow: "0 18px 40px rgba(77,90,232,0.28)",
    }}
  >
    <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none"
      stroke="#ffffff" strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round">
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
      <path d="m3 18 9 5 9-5" opacity={0.5} />
    </svg>
  </div>
);

export const Scene: React.FC<{
  duration: number;
  children: React.ReactNode;
}> = ({ duration, children }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = interpolate(f, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const leave = interpolate(f, [duration - 8, duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = interpolate(f, [0, 18], [26, 0], { extrapolateRight: "clamp" });
  const zoom = interpolate(f, [0, duration], [1.03, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill
      style={{
        opacity: Math.min(enter, leave),
        transform: `translateY(${rise}px) scale(${zoom})`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const Kicker: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = accent,
}) => (
  <div
    style={{
      fontFamily: font,
      fontSize: 17,
      fontWeight: 700,
      letterSpacing: 2.4,
      color,
      marginBottom: 22,
    }}
  >
    {children}
  </div>
);

export const Headline: React.FC<{ children: React.ReactNode; size?: number }> = ({
  children,
  size = 62,
}) => (
  <div
    style={{
      fontFamily: font,
      fontSize: size,
      fontWeight: 700,
      letterSpacing: -1.6,
      lineHeight: 1.12,
      color: ink,
    }}
  >
    {children}
  </div>
);

export const Sub: React.FC<{ children: React.ReactNode; size?: number }> = ({
  children,
  size = 26,
}) => (
  <div
    style={{
      fontFamily: font,
      fontSize: size,
      fontWeight: 400,
      lineHeight: 1.5,
      color: mute,
      marginTop: 24,
    }}
  >
    {children}
  </div>
);

export const Pill: React.FC<{
  children: React.ReactNode;
  tone?: "quiet" | "live";
}> = ({ children, tone = "quiet" }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      padding: "14px 26px",
      borderRadius: 99,
      background: "#ffffff",
      border: `1px solid ${hairline}`,
      fontFamily: font,
      fontSize: 22,
      fontWeight: 600,
      color: "#3d3f50",
      boxShadow: "0 10px 24px rgba(27,27,51,0.06)",
    }}
  >
    {tone === "live" ? (
      <span
        style={{ width: 12, height: 12, borderRadius: 99, background: "#2fa06a" }}
      />
    ) : null}
    {children}
  </div>
);
