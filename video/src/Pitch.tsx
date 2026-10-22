
import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { PITCH_SCENES, type PitchScene } from "./pitch-scenes";

const BG = "#faf9f7";
const WASH = "#f2efe9";
const INK = "#14181f";
const MUTE = "#6a7280";
const DIM = "#a8aeb8";
const LINE = "#e3e0da";
const BLUE = "#1a56db";
const TEAL = "#2f8f83";
const AMBER = "#df8b3a";
const RED = "#b42318";
const GREEN = "#0f7b5a";
const SANS = '"Segoe UI", Inter, system-ui, sans-serif';
const cell = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ramp = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], cell);
const label: React.CSSProperties = { fontSize: 13, letterSpacing: "0.16em", textTransform: "uppercase", color: DIM, fontWeight: 700 };

const rise = (f: number, at: number, dist = 18): React.CSSProperties => {
  const e = ramp(f, at, at + 12);
  return { opacity: e, transform: "translateY(" + interpolate(e, [0, 1], [dist, 0]) + "px)" };
};

const pop = (f: number, at: number, fps: number) => {
  const s = spring({ frame: f - at, fps, config: { damping: 12, stiffness: 160, mass: 0.7 } });
  return { opacity: ramp(f, at, at + 5), transform: "scale(" + interpolate(s, [0, 1], [0.7, 1]) + ")" };
};

type PersonProps = { shirt: string; hair: string; skin?: string; headTilt?: number; armL?: number; armR?: number; legs?: boolean; face?: "calm" | "flat" | "bright" };

const Person: React.FC<PersonProps> = ({ shirt, hair, skin = "#f0c8a6", headTilt = 0, armL = 0, armR = 0, legs = true, face = "calm" }) => (
  <svg width={120} height={240} viewBox="0 0 120 240">
    {legs ? (
      <>
        <rect x={46} y={168} width={14} height={62} rx={7} fill="#39414f" />
        <rect x={62} y={168} width={14} height={62} rx={7} fill="#323a47" />
      </>
    ) : null}
    <rect x={54} y={82} width={12} height={16} rx={5} fill={skin} />
    <g transform={"rotate(" + armL + " 34 108)"}>
      <rect x={24} y={100} width={13} height={60} rx={6.5} fill={shirt} />
      <circle cx={30.5} cy={163} r={8.5} fill={skin} />
    </g>
    <g transform={"rotate(" + armR + " 86 108)"}>
      <rect x={83} y={100} width={13} height={60} rx={6.5} fill={shirt} />
      <circle cx={89.5} cy={163} r={8.5} fill={skin} />
    </g>
    <rect x={32} y={92} width={56} height={84} rx={20} fill={shirt} />
    <g transform={"rotate(" + headTilt + " 60 62)"}>
      <circle cx={60} cy={58} r={23} fill={skin} />
      <path d="M 36 56 C 36 33 84 33 84 56 L 84 45 C 84 25 36 25 36 45 Z" fill={hair} />
      <circle cx={51} cy={60} r={2.5} fill="#2b2f3a" />
      <circle cx={69} cy={60} r={2.5} fill="#2b2f3a" />
      {face === "calm" ? <path d="M 54 70 Q 60 74 66 70" stroke="#2b2f3a" strokeWidth={1.9} fill="none" strokeLinecap="round" /> : null}
      {face === "flat" ? <path d="M 54 71 L 66 71" stroke="#2b2f3a" strokeWidth={1.9} fill="none" strokeLinecap="round" /> : null}
      {face === "bright" ? <path d="M 53 69 Q 60 77 67 69" stroke="#2b2f3a" strokeWidth={1.9} fill="none" strokeLinecap="round" /> : null}
    </g>
  </svg>
);

const Avatar: React.FC<{ tone: string; on: boolean; at: number; f: number; fps: number }> = ({ tone, on, at, f, fps }) => {
  const sp = spring({ frame: f - at, fps, config: { damping: 13, stiffness: 150, mass: 0.6 } });
  return (
    <div style={{ transform: "translateY(" + interpolate(sp, [0, 1], [26, 0]) + "px) scale(" + interpolate(sp, [0, 1], [0.7, 1]) + ")", opacity: ramp(f, at, at + 8), display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ width: 74, height: 74, borderRadius: 99, background: on ? tone : WASH, border: "2px solid " + (on ? "transparent" : LINE), display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={54} height={54} viewBox="0 0 60 60">
          <circle cx={30} cy={24} r={12} fill={on ? "#f0c8a6" : "#c9ccd2"} />
          <path d="M 8 58 C 8 42 52 42 52 58 Z" fill={on ? tone : "#d9dbe0"} />
        </svg>
      </div>
      <div style={{ width: 8, height: 8, borderRadius: 99, background: on ? GREEN : LINE }} />
    </div>
  );
};

const Phone: React.FC<{ glow: number; children?: React.ReactNode; style?: React.CSSProperties }> = ({ glow, children, style }) => (
  <div style={{ width: 128, height: 220, borderRadius: 20, background: "#1c2230", padding: 7, boxShadow: "0 18px 40px rgba(20,24,31," + (0.12 + glow * 0.22) + "), 0 0 0 1px rgba(20,24,31,0.06)", ...style }}>
    <div style={{ width: "100%", height: "100%", borderRadius: 14, background: "#0f1420", overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>{children}</div>
  </div>
);

const Camera: React.FC<{ scale: number; x?: number; y?: number; children: React.ReactNode }> = ({ scale, x = 0, y = 0, children }) => (
  <div style={{ position: "absolute", inset: 0, transform: "translate(" + x + "px," + y + "px) scale(" + scale + ")", transformOrigin: "50% 60%" }}>{children}</div>
);

const Ground: React.FC<{ y?: number }> = ({ y = 830 }) => (
  <>
    <div style={{ position: "absolute", left: 0, right: 0, top: y, height: 320, background: "linear-gradient(180deg," + WASH + " 0%, #eae6df 100%)" }} />
    <div style={{ position: "absolute", left: 0, right: 0, top: y, height: 2, background: "#d9d4cb" }} />
  </>
);

const Shadow: React.FC<{ x: number; y: number; w: number }> = ({ x, y, w }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: 18, borderRadius: "50%", background: "rgba(20,24,31,0.09)", filter: "blur(3px)" }} />
);

const Bubble: React.FC<{ f: number; at: number; fps: number; text: string; style?: React.CSSProperties; tone?: string }> = ({ f, at, fps, text, style, tone = BLUE }) => (
  <div style={{ position: "absolute", ...style, ...pop(f, at, fps) }}>
    <div style={{ background: "#fff", border: "1px solid " + LINE, borderRadius: 16, padding: "14px 20px", fontSize: 21, lineHeight: 1.4, color: INK, boxShadow: "0 12px 28px rgba(20,24,31,0.10)", maxWidth: 430 }}>{text}</div>
    <div style={{ width: 18, height: 3, background: tone, borderRadius: 99, marginTop: 8, opacity: 0.55 }} />
  </div>
);

const Stamp: React.FC<{ f: number; at: number; text: string; color: string; style?: React.CSSProperties }> = ({ f, at, text, color, style }) => {
  const e = ramp(f, at, at + 7);
  return (
    <div style={{ position: "absolute", ...style, opacity: e, transform: "scale(" + interpolate(e, [0, 1], [1.5, 1]) + ") rotate(-4deg)" }}>
      <div style={{ border: "2px solid " + color, color, borderRadius: 10, padding: "10px 18px", fontSize: 16, letterSpacing: "0.14em", fontWeight: 800, background: "rgba(255,255,255,0.86)" }}>{text}</div>
    </div>
  );
};

const Panel: React.FC<{ style?: React.CSSProperties; children: React.ReactNode }> = ({ style, children }) => (
  <div style={{ background: "#fff", border: "1px solid " + LINE, borderRadius: 18, boxShadow: "0 22px 50px rgba(20,24,31,0.10)", ...style }}>{children}</div>
);

const Title: React.FC<{ kicker: string; line: string; width?: number; f: number; size?: number; at?: number }> = ({ kicker, line, width = 640, f, size = 54, at = 6 }) => (
  <div style={{ position: "absolute", left: 120, top: 120 }}>
    <div style={{ ...label, ...rise(f, at) }}>{kicker}</div>
    <div style={{ fontSize: size, fontWeight: 600, letterSpacing: "-0.02em", color: INK, marginTop: 14, maxWidth: width, lineHeight: 1.14, ...rise(f, at + 4) }}>{line}</div>
  </div>
);

const Watch: React.FC<{ f: number; fps: number }> = ({ f, fps }) => {
  const push = interpolate(ramp(f, 0, 260), [0, 1], [1, 1.05]);
  const tilt = interpolate(ramp(f, 20, 80), [0, 1], [0, 10]);
  const slump = interpolate(ramp(f, 170, 250), [0, 1], [0, 12]);
  const days = [0, 1, 2, 3, 4];
  return (
    <Camera scale={push}>
      <Ground />
      <div style={{ position: "absolute", left: 180, top: 592, width: 690, height: 140, borderRadius: 28, background: "#cfd8d6" }} />
      <div style={{ position: "absolute", left: 180, top: 706, width: 690, height: 104, borderRadius: 22, background: "#bcc7c5" }} />
      <Shadow x={210} y={812} w={640} />
      <div style={{ position: "absolute", left: 300, top: 440 + slump, transform: "scale(1.45)", transformOrigin: "60px 182px" }}>
        <Person shirt={TEAL} hair="#3a2b23" headTilt={tilt} armR={-40} armL={10} legs={false} face={f > 190 ? "flat" : "calm"} />
      </div>
      <div style={{ position: "absolute", left: 452, top: 506 + slump, transform: "scale(0.78) rotate(-5deg)", transformOrigin: "0 0" }}>
        <Phone glow={0.5 + 0.5 * Math.sin(f / 8)}>
          <div style={{ width: 92, height: 52, borderRadius: 8, background: "#1a56db" }} />
          <div style={{ width: 74, height: 6, borderRadius: 99, background: "#39445a" }} />
        </Phone>
      </div>
      <Panel style={{ position: "absolute", left: 940, top: 210 + Math.sin(f / 22) * 6, width: 540, padding: 30 }}>
        <div style={{ ...label, color: BLUE }}>{"The lesson"}</div>
        <div style={{ fontSize: 30, fontWeight: 600, color: INK, marginTop: 10 }}>{"Week one: staying calm"}</div>
        <div style={{ height: 10, borderRadius: 99, background: LINE, marginTop: 22 }}>
          <div style={{ width: interpolate(ramp(f, 10, 140), [0, 1], [4, 100]) + "%", height: "100%", borderRadius: 99, background: BLUE }} />
        </div>
        <div style={{ marginTop: 16, fontSize: 18, color: MUTE }}>{"Lesson complete. Home unchanged."}</div>
      </Panel>
      <div style={{ position: "absolute", left: 940, top: 640, display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ ...label }}>{"Days passing"}</span>
        {days.map((d) => (
          <div key={d} style={{ width: 34, height: 34, borderRadius: 8, border: "1px solid " + LINE, background: f > 30 + d * 24 ? "#eef1f6" : "#fff", color: DIM, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, opacity: ramp(f, 26 + d * 24, 32 + d * 24) }}>{"+"}</div>
        ))}
      </div>
      <Title kicker="Purposeful Parenting" line="She watched. Nothing changed." f={f} size={56} width={680} />
    </Camera>
  );
};

const StyleSofa: React.FC = () => (
  <>
    <div style={{ position: "absolute", left: 210, top: 640, width: 480, height: 140, borderRadius: 28, background: "#cfd8d6" }} />
    <div style={{ position: "absolute", left: 210, top: 716, width: 480, height: 118, borderRadius: 24, background: "#bcc7c5" }} />
    <div style={{ position: "absolute", left: 190, top: 666, width: 66, height: 168, borderRadius: 24, background: "#c6d0ce" }} />
    <div style={{ position: "absolute", left: 644, top: 666, width: 66, height: 168, borderRadius: 24, background: "#c6d0ce" }} />
  </>
);

const Ask: React.FC<{ f: number; fps: number }> = ({ f, fps }) => {
  const push = interpolate(ramp(f, 0, 230), [0, 1], [1, 1.06]);
  const pulse = 1 + 0.035 * Math.sin(f / 9);
  return (
    <Camera scale={push}>
      <Ground />
      <Shadow x={250} y={806} w={240} />
      <div style={{ position: "absolute", left: 300, top: 512, transform: "scale(1.38)", transformOrigin: "60px 230px" }}>
        <Person shirt={TEAL} hair="#3a2b23" headTilt={-12} armL={-22} face="bright" />
      </div>
      <div style={{ position: "absolute", left: 560, top: 300, ...pop(f, 100, fps) }}>
        <div style={{ background: "#fff", border: "1px solid " + LINE, borderRadius: 16, padding: "14px 20px", boxShadow: "0 12px 28px rgba(20,24,31,0.10)", fontSize: 20, color: INK, maxWidth: 260 }}>{"One page. Tonight. That is the whole ask."}</div>
      </div>
      <div style={{ position: "absolute", left: 900, top: 240, ...pop(f, 8, fps) }}>
        <Panel style={{ width: 620, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "22px 30px", borderBottom: "1px solid " + LINE, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ ...label, color: MUTE }}>{"Your next step"}</span>
            <span style={{ fontSize: 15, color: DIM }}>{"Module 03 of 05"}</span>
          </div>
          <div style={{ padding: "30px 30px 26px" }}>
            <div style={{ fontSize: 42, fontWeight: 600, letterSpacing: "-0.02em", color: INK }}>{"Run the bedtime script"}</div>
            <div style={{ fontSize: 20, color: MUTE, marginTop: 12 }}>{"12 minutes · one page · tonight"}</div>
            <div style={{ marginTop: 26, display: "inline-flex", alignItems: "center", gap: 12, background: BLUE, color: "#fff", borderRadius: 12, padding: "16px 26px", fontSize: 20, fontWeight: 600, transform: "scale(" + pulse + ")" }}>
              {"Open the script"}
              <span style={{ fontSize: 20 }}>{"→"}</span>
            </div>
          </div>
          <div style={{ background: WASH, padding: "18px 30px", fontSize: 17, color: MUTE }}>{"Not another video. One thing to do tonight."}</div>
        </Panel>
      </div>
      <Title kicker="The change" line="Then it asked her to act." f={f} width={560} />
    </Camera>
  );
};

const Script: React.FC<{ f: number; fps: number }> = ({ f, fps }) => {
  const push = interpolate(ramp(f, 0, 250), [0, 1], [1, 1.05]);
  const settle = interpolate(ramp(f, 130, 170), [0, 1], [44, 0]);
  const eyes = ramp(f, 150, 168);
  const arm = interpolate(ramp(f, 40, 100), [0, 1], [0, -30]);
  return (
    <Camera scale={push}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 860, background: "linear-gradient(180deg,#eef1f6 0%,#f7f5f1 100%)" }} />
      <Ground y={860} />
      <div style={{ position: "absolute", left: 1640, top: 500, width: 84, height: 300, borderRadius: 18, background: "#e6e1d8" }} />
      <div style={{ position: "absolute", left: 960, top: 780, width: 700, height: 16, borderRadius: 8, background: "#e6e1d8" }} />
      <div style={{ position: "absolute", left: 960, top: 586, width: 700, height: 206, borderRadius: 22, background: "#fff", border: "1px solid " + LINE }} />
      <div style={{ position: "absolute", left: 1012, top: 616, width: 164, height: 84, borderRadius: 16, background: "#e9eef7" }} />
      <div style={{ position: "absolute", left: 1040, top: 612 }}>
        <svg width={200} height={150} viewBox="0 0 200 150">
          <circle cx={90} cy={66} r={34} fill="#f0c8a6" />
          <path d="M 56 64 C 56 32 124 32 124 64 L 124 52 C 124 26 56 26 56 52 Z" fill="#4a3527" />
          <circle cx={78} cy={68} r={3.4} fill="#2b2f3a" opacity={1 - eyes} />
          <circle cx={102} cy={68} r={3.4} fill="#2b2f3a" opacity={1 - eyes} />
          <path d="M 80 78 Q 90 84 100 78" stroke="#2b2f3a" strokeWidth={2.6} fill="none" strokeLinecap="round" />
          <path d="M 74 68 Q 78 73 82 68" stroke="#2b2f3a" strokeWidth={2.6} fill="none" strokeLinecap="round" opacity={eyes} />
          <path d="M 98 68 Q 102 73 106 68" stroke="#2b2f3a" strokeWidth={2.6} fill="none" strokeLinecap="round" opacity={eyes} />
        </svg>
      </div>
      <div style={{ position: "absolute", left: 1196, top: 614, width: 450, height: 168 + settle, borderRadius: 18, background: "#c9d6ea" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 24, height: 3, background: "rgba(255,255,255,0.6)" }} />
      </div>
      <Shadow x={660} y={856} w={250} />
      <div style={{ position: "absolute", left: 640, top: 522, transform: "scale(1.34)", transformOrigin: "60px 230px" }}>
        <Person shirt={AMBER} hair="#4a3527" headTilt={12} armL={arm} face="calm" />
      </div>
      <Bubble f={f} at={24} fps={fps} text={"It is time to close your eyes. I will stay for one minute."} style={{ left: 300, top: 300 }} />
      <div style={{ position: "absolute", left: 1330, top: 440, opacity: ramp(f, 170, 190) }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ position: "absolute", left: i * 32 + Math.sin((f + i * 22) / 18) * 8, top: -i * 42 - interpolate(ramp(f, 170, 260), [0, 1], [0, 48]), fontSize: 26, color: DIM, fontWeight: 700 }}>{"z"}</div>
        ))}
      </div>
      <Stamp f={f} at={190} text={"SCRIPT USED"} color={GREEN} style={{ left: 1000, top: 806 }} />
      <Title kicker="Bedtime, week one" line="The house went quiet." f={f} width={620} />
    </Camera>
  );
};

const Track: React.FC<{ f: number; fps: number }> = ({ f, fps }) => {
  const rows = ["Worksheet printed", "Bedtime script run", "Behaviour logged"];
  const ring = interpolate(ramp(f, 20, 150), [0, 1], [0, 34]);
  return (
    <Camera scale={1.02}>
      <Ground />
      <Shadow x={250} y={806} w={240} />
      <div style={{ position: "absolute", left: 290, top: 522, transform: "scale(1.34)", transformOrigin: "60px 230px" }}>
        <Person shirt={TEAL} hair="#3a2b23" headTilt={-6} face="bright" />
      </div>
      <div style={{ position: "absolute", left: 700, top: 250, ...pop(f, 6, fps) }}>
        <Panel style={{ width: 900, padding: 34 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ ...label, color: MUTE }}>{"Maria · module 03"}</div>
              <div style={{ fontSize: 32, fontWeight: 600, color: INK, marginTop: 8 }}>{"This week"}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <svg width={110} height={110} viewBox="0 0 110 110">
                <circle cx={55} cy={55} r={44} fill="none" stroke={LINE} strokeWidth={12} />
                <circle cx={55} cy={55} r={44} fill="none" stroke={BLUE} strokeWidth={12} strokeLinecap="round" strokeDasharray={2 * Math.PI * 44} strokeDashoffset={2 * Math.PI * 44 * (1 - ring / 100)} transform="rotate(-90 55 55)" />
              </svg>
              <div style={{ fontSize: 30, fontWeight: 600, color: INK }}>{Math.round(ring) + "%"}</div>
            </div>
          </div>
          {rows.map((r, i) => (
            <div key={r} style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 0", borderTop: "1px solid " + LINE, ...rise(f, 30 + i * 16) }}>
              <span style={{ width: 26, height: 26, borderRadius: 99, background: "#eef8f4", border: "1px solid #bfe3d5", color: GREEN, fontSize: 15, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{"✓"}</span>
              <span style={{ fontSize: 23, color: "#1c2530" }}>{r}</span>
              <span style={{ marginLeft: "auto", fontSize: 16, color: DIM }}>{"logged"}</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 16, paddingTop: 18, borderTop: "1px solid " + LINE, opacity: 0.8, ...rise(f, 90) }}>
            <span style={{ width: 26, height: 26, borderRadius: 99, background: "#fdf3f2", border: "1px solid #f0cfcb", color: RED, fontSize: 14, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{"✕"}</span>
            <span style={{ fontSize: 23, color: MUTE }}>{"Video watched"}</span>
            <span style={{ marginLeft: "auto", fontSize: 16, color: RED }}>{"not counted"}</span>
          </div>
        </Panel>
      </div>
      <Title kicker="What counts" line="The work she did at home." f={f} width={500} />
    </Camera>
  );
};

const Flag: React.FC<{ f: number; fps: number }> = ({ f, fps }) => {
  const pan = interpolate(ramp(f, 70, 160), [0, 1], [0, -180]);
  const dim = 1 - 0.55 * ramp(f, 30, 80);
  const gone = 1 - ramp(f, 96, 124);
  const days = [0, 1, 2, 3, 4];
  return (
    <>
      <Camera scale={1.03} x={pan}>
        <Ground />
        <div style={{ opacity: gone }}>
        <Shadow x={190} y={820} w={210} />
        <div style={{ position: "absolute", left: 200, top: 526, transform: "scale(1.32)", transformOrigin: "60px 230px", opacity: dim }}>
          <Person shirt={TEAL} hair="#3a2b23" headTilt={18} face="flat" />
        </div>
        <Panel style={{ position: "absolute", left: 170, top: 216, width: 470, padding: 28, ...rise(f, 8) }}>
          <div style={{ ...label, color: MUTE }}>{"Maria"}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            {days.map((d) => (
              <div key={d} style={{ width: 62, height: 62, borderRadius: 12, background: d < 2 ? "#eef1f6" : "#fdf3f2", border: "1px solid " + (d < 2 ? LINE : "#f0cfcb"), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: d < 2 ? GREEN : RED, fontWeight: 700, opacity: ramp(f, 40 + d * 12, 48 + d * 12) }}>
                {d < 2 ? "✓" : "·"}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 18, fontSize: 19, color: MUTE }}>{"No action for 5 days"}</div>
        </Panel>
        <Stamp f={f} at={80} text={"FLAGGED"} color={RED} style={{ left: 230, top: 600 }} />
        </div>

        <Shadow x={860} y={820} w={210} />
        <div style={{ position: "absolute", left: 880, top: 526, transform: "scale(1.32)", transformOrigin: "60px 230px" }}>
          <Person shirt={BLUE} hair="#2b2f3a" headTilt={10} armR={-34} armL={-12} legs face="calm" />
        </div>
        <div style={{ position: "absolute", left: 942, top: 666, width: 108, height: 146, borderRadius: 10, background: "#2c3442", padding: 5, transform: "rotate(-5deg)" }}>
          <div style={{ width: "100%", height: "100%", borderRadius: 7, background: ramp(f, 110, 130) > 0.1 ? "#e8f0ff" : "#39445a" }} />
        </div>
        <div style={{ position: "absolute", left: 1120, top: 250, ...pop(f, 116, fps) }}>
          <Panel style={{ width: 400, padding: 24, borderColor: "#d9e2f8" }}>
            <div style={{ ...label, color: RED }}>{"Needs a nudge"}</div>
            <div style={{ fontSize: 22, color: INK, marginTop: 10, lineHeight: 1.35 }}>{"Maria has not acted in 5 days."}</div>
            <div style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 10, background: BLUE, color: "#fff", borderRadius: 10, padding: "10px 18px", fontSize: 16, fontWeight: 600 }}>{"Send a message"}</div>
          </Panel>
        </div>
      </Camera>
      <Title kicker="Before she leaves" line="It noticed, and told her coach." f={f} width={520} size={52} at={112} />
    </>
  );
};

const Back: React.FC<{ f: number; fps: number }> = ({ f, fps }) => {
  const bright = ramp(f, 60, 96);
  const travel = interpolate(ramp(f, 24, 70), [0, 1], [480, 0]);
  return (
    <Camera scale={1.02}>
      <Ground />
      <Shadow x={300} y={806} w={230} />
      <div style={{ position: "absolute", left: 300, top: 536, transform: "translateY(" + interpolate(bright, [0, 1], [10, 0]) + "px) scale(1.28)", transformOrigin: "60px 230px" }}>
        <Person shirt={TEAL} hair="#3a2b23" headTilt={interpolate(bright, [0, 1], [16, -8])} face={bright > 0.5 ? "bright" : "flat"} />
      </div>
      <div style={{ position: "absolute", left: 300 + travel, top: 340, ...pop(f, 20, fps) }}>
        <div style={{ background: "#fff", border: "1px solid " + LINE, borderRadius: 16, padding: "14px 20px", boxShadow: "0 12px 28px rgba(20,24,31,0.12)", fontSize: 19, color: INK, maxWidth: 320 }}>{"Maria, are you stuck on the bedtime script? Want me to walk you through it?"}</div>
      </div>
      <Shadow x={770} y={806} w={230} />
      <div style={{ position: "absolute", left: 790, top: 536, transform: "scale(1.28)", transformOrigin: "60px 230px" }}>
        <Person shirt={BLUE} hair="#2b2f3a" armR={-28} face="bright" />
      </div>
      <div style={{ position: "absolute", left: 1120, top: 230, opacity: ramp(f, 116, 146) }}>
        <div style={{ ...label }}>{"Same five parents, different ending"}</div>
        <div style={{ display: "flex", gap: 24, marginTop: 26 }}>
          {[true, true, true, false, true].map((on, i) => (
            <Avatar key={i} tone={i === 0 ? (f > 120 ? TEAL : AMBER) : TEAL} on={on} at={126 + i * 8} f={f} fps={fps} />
          ))}
        </div>
        <div style={{ marginTop: 22, fontSize: 19, color: MUTE, maxWidth: 540 }}>{"Retention you can see, instead of guess."}</div>
        <Stamp f={f} at={126} text={"FLAGGED, NUDGED, BACK"} color={GREEN} style={{ left: 0, top: 250 }} />
      </div>
      <Title kicker="The save" line="One message, and she came back." f={f} width={520} size={52} />
    </Camera>
  );
};

const Own: React.FC<{ f: number; fps: number }> = ({ f, fps }) => {
  const merge = ramp(f, 80, 130);
  const pills = ["ManyChat", "Email tool", "Checkout", "Course host"];
  return (
    <Camera scale={1.02}>
      <Ground />
      <div style={{ position: "absolute", left: 140, top: 150 }}>
        <div style={{ ...label }}>{"What you own"}</div>
        <div style={{ fontSize: 54, fontWeight: 600, letterSpacing: "-0.02em", color: INK, marginTop: 14, maxWidth: 560, lineHeight: 1.12 }}>{"Your brand, your data, no ceiling."}</div>
        <div style={{ marginTop: 34, display: "flex", flexDirection: "column", gap: 16 }}>
          {pills.map((p, i) => (
            <div key={p} style={{ ...pop(f, 20 + i * 10, fps), display: "inline-flex", alignItems: "center", gap: 12, alignSelf: "flex-start", border: "1px solid " + LINE, background: "#fff", borderRadius: 999, padding: "12px 22px", fontSize: 19, color: MUTE }}>
              {p}
              <span style={{ fontSize: 12, letterSpacing: "0.14em", color: RED }}>{"CANCELLED"}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: "absolute", left: 900, top: 190, ...pop(f, 40, fps) }}>
        <Panel style={{ width: 820, padding: 0, overflow: "hidden" }}>
          <div style={{ background: INK, padding: "30px 34px" }}>
            <div style={{ fontSize: 13, letterSpacing: "0.3em", color: "#9aa3b2" }}>{"PURPOSEFUL PARENTING"}</div>
            <div style={{ fontSize: 34, fontWeight: 600, color: "#fff", marginTop: 10 }}>{"The Tillman Method"}</div>
          </div>
          <div style={{ padding: 34, display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", opacity: ramp(f, 90, 110) }}>
              <span style={{ fontSize: 19, color: MUTE }}>{"Per member fee"}</span>
              <span style={{ fontSize: 30, fontWeight: 700, color: INK }}>{"$0"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", opacity: ramp(f, 100, 120) }}>
              <span style={{ fontSize: 19, color: MUTE }}>{"Parent data"}</span>
              <span style={{ fontSize: 21, fontWeight: 600, color: GREEN }}>{"Your CRM"}</span>
            </div>
            <div style={{ height: 10, borderRadius: 99, background: LINE, overflow: "hidden" }}>
              <div style={{ width: interpolate(ramp(f, 110, 190), [0, 1], [12, 100]) + "%", height: "100%", background: GREEN }} />
            </div>
            <div style={{ fontSize: 17, color: MUTE }}>{"Members grow. The cost does not."}</div>
          </div>
        </Panel>
      </div>
      <div style={{ position: "absolute", left: 900, top: 720, display: "inline-flex", alignItems: "center", gap: 14, opacity: merge, transform: "scale(" + interpolate(merge, [0, 1], [0.9, 1]) + ")" }}>
        <div style={{ background: BLUE, color: "#fff", borderRadius: 999, padding: "14px 26px", fontSize: 20, fontWeight: 600 }}>{"One platform"}</div>
        <span style={{ fontSize: 18, color: MUTE }}>{"instead of four subscriptions"}</span>
      </div>
    </Camera>
  );
};

const Close: React.FC<{ f: number; fps: number }> = ({ f, fps }) => (
  <AbsoluteFill style={{ background: BG, alignItems: "center", justifyContent: "center" }}>
    <div style={{ textAlign: "center" }}>
      <div style={{ ...label, ...rise(f, 4) }}>{"The proposal"}</div>
      <div style={{ fontSize: 84, fontWeight: 600, letterSpacing: "-0.03em", color: INK, marginTop: 18, ...rise(f, 10) }}>{"Own the platform."}</div>
      <div style={{ fontSize: 24, color: MUTE, marginTop: 18, ...rise(f, 22) }}>{"Built once. Yours after that."}</div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 18, marginTop: 44, ...pop(f, 40, fps) }}>
        <span style={{ fontSize: 40, fontWeight: 600, color: INK }}>{"$4,000 to $10,000"}</span>
        <span style={{ fontSize: 18, color: MUTE }}>{"scoped to your goals"}</span>
      </div>
      <div style={{ fontSize: 18, color: MUTE, marginTop: 26, ...rise(f, 60) }}>{"devxave.vercel.app  ·  xvrpdlla@gmail.com  ·  0995 026 6808"}</div>
    </div>
    <div style={{ position: "absolute", left: 260, bottom: 34, transform: "scale(1.2)", transformOrigin: "60px 230px" }}>
      <Person shirt={TEAL} hair="#3a2b23" face="bright" headTilt={6} />
    </div>
    <div style={{ position: "absolute", right: 260, bottom: 34, transform: "scale(1.2)", transformOrigin: "60px 230px" }}>
      <Person shirt={BLUE} hair="#2b2f3a" face="bright" headTilt={-6} />
    </div>
  </AbsoluteFill>
);

const SceneFrame: React.FC<{ fade?: boolean; children: React.ReactNode }> = ({ fade, children }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: BG, overflow: "hidden", opacity: fade ? ramp(f, 0, 11) : 1 }}>{children}</AbsoluteFill>
  );
};

export const XavePitch: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: BG, fontFamily: SANS, color: INK }}>
      <Audio src={staticFile("pitch.wav")} />
      {PITCH_SCENES.map((scene: PitchScene, i: number) => (
        <Sequence key={scene.id} from={Math.max(0, scene.at - (i === 0 ? 0 : 12))} durationInFrames={scene.length + 12}>
          <SceneFrame fade>
            {scene.id === "watch" ? <Watch f={useCurrentFrame()} fps={fps} /> : null}
            {scene.id === "ask" ? <Ask f={useCurrentFrame()} fps={fps} /> : null}
            {scene.id === "script" ? <Script f={useCurrentFrame()} fps={fps} /> : null}
            {scene.id === "track" ? <Track f={useCurrentFrame()} fps={fps} /> : null}
            {scene.id === "flag" ? <Flag f={useCurrentFrame()} fps={fps} /> : null}
            {scene.id === "back" ? <Back f={useCurrentFrame()} fps={fps} /> : null}
            {scene.id === "own" ? <Own f={useCurrentFrame()} fps={fps} /> : null}
            {scene.id === "close" ? <Close f={useCurrentFrame()} fps={fps} /> : null}
          </SceneFrame>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const Mark: React.FC<{ yes?: boolean }> = ({ yes }) => (
  <span style={{ width: 22, height: 22, borderRadius: 99, border: "1px solid " + (yes ? "#bfe3d5" : "#f0cfcb"), background: yes ? "#eef8f4" : "#fdf3f2", color: yes ? GREEN : RED, fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 3 }}>{yes ? "✓" : "✕"}</span>
);

export const PitchBoardOne: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS, color: INK, padding: "72px 96px", display: "flex", flexDirection: "column" }}>
    <div style={{ ...label, fontSize: 12, color: DIM }}>{"Proposal for Purposeful Parenting"}</div>
    <div style={{ fontSize: 64, fontWeight: 600, letterSpacing: "-0.025em", marginTop: 18 }}>{"Own the platform, do not rent one."}</div>
    <div style={{ fontSize: 21, color: MUTE, marginTop: 16, maxWidth: 1180, lineHeight: 1.45 }}>{"A premium, branded learning platform for Dr. Tillman's methodology. One build, no per member fees, no ceiling."}</div>
    <div style={{ display: "flex", gap: 72, marginTop: 44 }}>
      {[
        { title: "Today: rented", color: MUTE, yes: false, rows: ["Per member, per month, forever", "Parent progress in their dashboard", "Their brand around your method", "A ceiling you do not control", "Video completion as the only proof"] },
        { title: "With your own platform", color: BLUE, yes: true, rows: ["One build, no per member fee", "Parent data lands in your CRM", "Dr. Tillman's brand, front to back", "Grows with your audience, no limit", "Worksheets, scripts and behaviour tracked"] },
      ].map((col) => (
        <div key={col.title} style={{ flex: 1 }}>
          <div style={{ paddingBottom: 12, borderBottom: "1px solid " + LINE }}>
            <span style={{ fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 700, color: col.color }}>{col.title}</span>
          </div>
          {col.rows.map((r) => (
            <div key={r} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 0", borderBottom: "1px solid " + LINE }}>
              <Mark yes={col.yes} />
              <span style={{ fontSize: 19, lineHeight: 1.4, color: col.yes ? "#1c2530" : MUTE }}>{r}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
    <div style={{ marginTop: "auto", paddingBottom: 34 }}>
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.01em" }}>{"Skool rents you a community. This gives you the platform you own."}</div>
      <div style={{ fontSize: 18, color: MUTE, marginTop: 10 }}>{"Same audience, same method, no landlord. One build, then it is yours."}</div>
    </div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 24, borderTop: "1px solid " + LINE }}>
      <span style={{ fontSize: 15, color: MUTE }}>{"John Xavier Padilla, Lead Developer and AI Specialist"}</span>
      <span style={{ fontSize: 15, color: MUTE }}>{"devxave.vercel.app  ·  xvrpdlla@gmail.com  ·  0995 026 6808"}</span>
    </div>
  </AbsoluteFill>
);

const GROUPS = [
  { title: "Platform and branding", note: "Her name on the product. No logo of ours anywhere.", bullets: ["100% white-label platform matching Dr. Tillman's premium authority", "Zero per-member fees and no platform ceilings"] },
  { title: "Curriculum and student experience", note: "Every parent follows the same path, in the right order.", bullets: ["Custom learning paths and step-by-step sequencing", "Parent dashboards with personalized next steps"] },
  { title: "Tracking and retention", note: "You see who is working the method, and who has gone quiet.", bullets: ["Action-based implementation tracking (worksheets, not just videos)", "Automated early-warning triggers for stalled students"] },
  { title: "Native tools, replacing third-party subscriptions", note: "One platform instead of a stack of monthly subscriptions.", bullets: ["Built-in chat and community messaging (replaces ManyChat)", "Integrated email marketing and notifications", "Native checkout and subscription management"] },
  { title: "Operations and data", note: "Your team runs it, and your data stays yours.", bullets: ["Built-in review and approval workflows before publishing", "AI-assisted content production to speed up lesson creation", "100% data ownership with native CRM integration"] },
];

export const PitchBoardTwo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS, color: INK, padding: "72px 96px", display: "flex", flexDirection: "column" }}>
    <div style={{ ...label, fontSize: 12, color: DIM }}>{"What the system covers"}</div>
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
      <div style={{ fontSize: 62, fontWeight: 600, letterSpacing: "-0.025em", marginTop: 18 }}>{"Five groups, one platform."}</div>
      <div style={{ textAlign: "right", paddingBottom: 6 }}>
        <div style={{ ...label, fontSize: 12, color: DIM }}>{"Investment"}</div>
        <div style={{ fontSize: 34, fontWeight: 600, marginTop: 6 }}>{"$4,000 to $10,000"}</div>
        <div style={{ fontSize: 14, color: MUTE, marginTop: 4 }}>{"scoped to your goals"}</div>
      </div>
    </div>
    <div style={{ display: "flex", gap: 80, marginTop: 48 }}>
      {[GROUPS.slice(0, 3), GROUPS.slice(3)].map((col, ci) => (
        <div key={ci} style={{ flex: 1 }}>
          {col.map((g, i) => (
            <div key={g.title} style={{ marginBottom: 30 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, paddingBottom: 10, borderBottom: "1px solid " + LINE }}>
                <span style={{ fontSize: 12, letterSpacing: "0.16em", fontWeight: 700, color: BLUE }}>{String(ci * 3 + i + 1).padStart(2, "0")}</span>
                <span style={{ fontSize: 21, fontWeight: 600 }}>{g.title}</span>
              </div>
              {g.bullets.map((b) => (
                <div key={b} style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingTop: 12 }}>
                  <span style={{ color: DIM, fontSize: 15, lineHeight: "1.5" }}>{"·"}</span>
                  <span style={{ fontSize: 17, lineHeight: 1.45, color: MUTE }}>{b}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 24, borderTop: "1px solid " + LINE }}>
      <span style={{ fontSize: 15, color: MUTE }}>{"Built from scratch. You own the code and the data."}</span>
      <span style={{ fontSize: 15, color: MUTE }}>{"Book a short call: devxave.vercel.app"}</span>
    </div>
  </AbsoluteFill>
);
