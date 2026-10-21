import React from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { SCENES, TOTAL, WINDOW, type Scene } from "./scenes";
import { Backdrop, Mark } from "./parts";
import { accent, font, hairline, ink, mute } from "./theme";

const FPS = 30;
const VO_LENGTH: Record<string, number> = {
  brand: 5.616,
  classic: 7.152,
  editor: 9.336,
  tree: 6.408,
  blocks: 11.52,
  canvas: 8.832,
  boards: 5.28,
  plan: 6.12,
  themes: 3.312,
  close: 3.552,
};

const ramp = (frame: number, start: number, len = 10) =>
  interpolate(frame, [start, start + len], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const Screen: React.FC<{ scene: Scene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: f, fps, config: { damping: 22, stiffness: 120, mass: 0.8 } });
  const opacity = ramp(f, 0, 9);
  const leave = interpolate(f, [scene.length - 9, scene.length], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  let cursor = 0;
  return (
    <AbsoluteFill style={{ opacity: Math.min(opacity, leave) }}>
      <div
        style={{
          position: "absolute",
          left: WINDOW.x,
          top: WINDOW.y,
          width: WINDOW.w,
          height: WINDOW.h,
          borderRadius: 20,
          overflow: "hidden",
          background: "#ffffff",
          border: `1px solid ${hairline}`,
          boxShadow: "0 50px 90px rgba(20,20,50,0.18), 0 12px 26px rgba(20,20,50,0.08)",
          transform: `translateY(${(1 - enter) * 22}px) scale(${0.988 + enter * 0.012})`,
        }}
      >
        {scene.clips.map((clip, i) => {
          const len = Math.round(clip.seconds * fps);
          const from = cursor;
          cursor += len;
          return (
            <Sequence key={i} from={from} durationInFrames={len}>
              <Camera sceneLength={len} camera={scene.camera}>
                <OffthreadVideo
                  src={staticFile(clip.src)}
                  startFrom={Math.round(clip.from * fps)}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </Camera>
            </Sequence>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Camera: React.FC<{
  sceneLength: number;
  camera: { scale: number; ox: number; oy: number };
  children: React.ReactNode;
}> = ({ sceneLength, camera, children }) => {
  const f = useCurrentFrame();
  const scale = interpolate(f, [0, sceneLength], [1, camera.scale], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        transform: `scale(${scale})`,
        transformOrigin: `${camera.ox}% ${camera.oy}%`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

const Wordmark: React.FC<{ size: number; scale?: number }> = ({ size, scale }) => (
  <Mark size={size} scale={scale} />
);

const Reveal: React.FC<{
  children: string;
  delay: number;
  size: number;
  weight?: number;
  color?: string;
  align?: "flex-start" | "center";
}> = ({ children, delay, size, weight = 600, color = ink, align = "center" }) => {
  const f = useCurrentFrame();
  const words = children.split(" ");
  return (
    <div style={{ display: "flex", gap: size * 0.22, justifyContent: align, flexWrap: "wrap" }}>
      {words.map((w, i) => {
        const d = ramp(f, delay + i * 2.2, 9);
        return (
          <span
            key={i}
            style={{
              fontFamily: font,
              fontSize: size,
              fontWeight: weight,
              letterSpacing: -size * 0.026,
              color,
              opacity: d,
              transform: `translateY(${(1 - d) * size * 0.22}px)`,
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mark = spring({ frame: f - 4, fps, config: { damping: 16, stiffness: 110, mass: 0.9 } });
  const glow = ramp(f, 0, 40);
  const leave = interpolate(f, [168, 183], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: leave }}>
      <AbsoluteFill
        style={{
          opacity: glow * 0.85,
          background:
            "radial-gradient(760px 520px at 50% 46%, rgba(120,132,255,0.16), rgba(120,132,255,0))",
        }}
      />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: 40 }}>
        <Wordmark size={112} scale={0.9 + mark * 0.1} />
        <div style={{ height: 44 }} />
        <div
          style={{
            fontFamily: font,
            fontSize: 108,
            fontWeight: 700,
            letterSpacing: -4.4,
            color: ink,
            opacity: ramp(f, 22, 14),
            transform: `translateY(${(1 - ramp(f, 22, 14)) * 16}px)`,
          }}
        >
          Xave
        </div>
        <div style={{ height: 34 }} />
        <Reveal delay={46} size={38} weight={500} color="#4a4c60">
          A notebook, a board, and a week planner.
        </Reveal>
        <div style={{ height: 22 }} />
        <Reveal delay={92} size={38} weight={700} color={accent}>
          One place.
        </Reveal>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Close: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mark = spring({ frame: f - 2, fps, config: { damping: 20, stiffness: 130, mass: 0.8 } });
  const pill = spring({ frame: f - 46, fps, config: { damping: 18, stiffness: 140, mass: 0.7 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: 20 }}>
      <Wordmark size={96} scale={0.92 + mark * 0.08} />
      <div style={{ height: 40 }} />
      <div
        style={{
          fontFamily: font,
          fontSize: 92,
          fontWeight: 700,
          letterSpacing: -3.6,
          color: ink,
          opacity: ramp(f, 16, 14),
        }}
      >
        Xave
      </div>
      <div style={{ height: 30 }} />
      <div style={{ display: "flex", gap: 18, opacity: ramp(f, 40, 12) }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 28px",
            borderRadius: 99,
            background: "#ffffff",
            border: `1px solid ${hairline}`,
            boxShadow: "0 16px 30px rgba(20,20,45,0.08)",
            fontFamily: font,
            fontSize: 26,
            fontWeight: 600,
            color: "#3d3f50",
          }}
        >
          <span style={{ width: 12, height: 12, borderRadius: 99, background: "#2fa06a" }} />
          Free and open source
        </div>
        <div
          style={{
            padding: "16px 28px",
            borderRadius: 99,
            background: accent,
            boxShadow: "0 18px 34px rgba(77,90,232,0.3)",
            fontFamily: font,
            fontSize: 26,
            fontWeight: 600,
            color: "#ffffff",
            transform: `translateY(${(1 - pill) * 14}px) scale(${0.96 + pill * 0.04})`,
            opacity: pill,
          }}
        >
          Yours to keep
        </div>
      </div>
      <div style={{ height: 26 }} />
      <div
        style={{
          fontFamily: font,
          fontSize: 23,
          color: mute,
          opacity: ramp(f, 70, 14),
        }}
      >
        No account. No install. Nothing leaves your computer.
      </div>
    </AbsoluteFill>
  );
};

const Chrome: React.FC<{ scene: Scene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const label = scene.kicker;
  const o = ramp(f, 4, 10);
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <div
        style={{
          position: "absolute",
          left: WINDOW.x,
          top: 34,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <Mark size={30} />
        <span style={{ fontFamily: font, fontSize: 22, fontWeight: 700, letterSpacing: -0.3, color: ink }}>
          Xave
        </span>
      </div>
      {label ? (
        <div
          style={{
            position: "absolute",
            right: 1920 - WINDOW.x - WINDOW.w,
            top: 34,
            fontFamily: font,
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: 3.2,
            textTransform: "uppercase",
            color: accent,
          }}
        >
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const XaveLive: React.FC = () => {
  return (
    <AbsoluteFill>
      <Backdrop />
      <Audio src={staticFile("sound.wav")} />
      {SCENES.map((scene) => (
        <Sequence key={scene.id} from={scene.at} durationInFrames={scene.length}>
          {scene.id === "brand" ? (
            <Intro />
          ) : scene.id === "close" ? (
            <>
              <Chrome scene={scene} />
              <Close />
            </>
          ) : (
            <>
              <Chrome scene={scene} />
              <Screen scene={scene} />
            </>
          )}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export const LIVE_TOTAL = TOTAL;
export const LIVE_VO = VO_LENGTH;
