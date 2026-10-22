
import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { PITCH_SCENES, PITCH_TOTAL, type PitchScene } from "./pitch-scenes";

const BG = "#07080d";
const INK = "#eef1ff";
const MUTE = "#8b91ab";
const DIM = "#565d7c";
const ACCENT = "#6f7bff";
const CYAN = "#45e3d2";
const MAGENTA = "#ff5c8f";
const AMBER = "#ffb45c";
const MONO = "Consolas, ui-monospace, monospace";
const SANS = 'Inter, "Segoe UI", system-ui, sans-serif';
const cell = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ramp = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], cell);
const pulse = (f: number, hz: number, phase = 0) => 0.5 + 0.5 * Math.sin((f / 30) * Math.PI * 2 * hz + phase);

const Grid: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG,
        backgroundImage: "radial-gradient(rgba(140,155,255,0.15) 1px, transparent 1px)",
        backgroundSize: "32px 32px",
        backgroundPosition: "0px " + ((f * 0.3) % 32) + "px",
      }}
    />
  );
};

const Glows: React.FC = () => {
  const f = useCurrentFrame();
  const a = 0.2 + pulse(f, 0.16) * 0.1;
  return (
    <>
      <AbsoluteFill style={{ background: "radial-gradient(760px 540px at 20% 10%, rgba(111,123,255," + a + "), rgba(7,8,13,0))" }} />
      <AbsoluteFill style={{ background: "radial-gradient(720px 520px at 86% 90%, rgba(69,227,210," + a * 0.55 + "), rgba(7,8,13,0))" }} />
      <AbsoluteFill style={{ background: "radial-gradient(900px 700px at 50% 50%, rgba(255,92,143,0.05), rgba(7,8,13,0))" }} />
    </>
  );
};

const mono = (size = 11, color = "#79809f", spacing = 2.2): React.CSSProperties => ({
  fontFamily: MONO,
  fontSize: size,
  letterSpacing: spacing,
  color,
  textTransform: "uppercase",
});

const big = (size = 64): React.CSSProperties => ({
  fontFamily: SANS,
  fontSize: size,
  fontWeight: 700,
  letterSpacing: "-0.025em",
  color: INK,
  lineHeight: 1.02,
});

const Word: React.FC<{ text: string; color?: string; at?: number; f: number; size?: number; top?: number }> = ({ text, color = INK, at = 6, f, size = 64, top = 112 }) => {
  const s = spring({ frame: f - at, fps: 30, config: { damping: 22, stiffness: 130, mass: 0.8 } });
  return (
    <div style={{ position: "absolute", left: 84, top: top, opacity: Math.min(1, s * 1.4), transform: "translateY(" + interpolate(s, [0, 1], [18, 0]) + "px)", ...big(size), color }}>
      {text}
    </div>
  );
};

const Band: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ position: "absolute", borderRadius: 14, background: "rgba(13,16,30,0.92)", border: "1px solid rgba(140,155,255,0.22)", ...style }}>{children}</div>
);

const Tick: React.FC<{ on: number; color?: string }> = ({ on, color = CYAN }) => (
  <svg width={18} height={18} viewBox="0 0 18 18" style={{ opacity: on }}>
    <path d="M3.5 9.5 L7.2 13 L14.5 4.8" fill="none" stroke={color} strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Rent: React.FC = () => {
  const f = useCurrentFrame();
  const s = spring({ frame: f - 2, fps: 30, config: { damping: 22, stiffness: 120, mass: 0.85 } });
  const meter = ramp(f, 16, 84);
  return (
    <>
      <Word f={f} text="Rented." color={MAGENTA} />
      <div style={{ position: "absolute", left: 84, top: 196, ...mono(13, MUTE, 2.6) }}>{"their platform, their rules"}</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 300, display: "flex", justifyContent: "center", opacity: Math.min(1, s * 1.5), transform: "translateY(" + interpolate(s, [0, 1], [40, 0]) + "px)" }}>
        <Band style={{ position: "relative", width: 1020, height: 560, borderColor: "rgba(255,92,143,0.34)", boxShadow: "0 -20px 90px rgba(255,92,143,0.12)" }}>
          <div style={{ ...mono(11, MAGENTA), position: "absolute", left: 26, top: 22 }}>{"SKOOL / COMMUNITY"}</div>
          <div style={{ position: "absolute", right: 26, top: 22, ...mono(11, DIM) }}>{"NOT YOURS"}</div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ position: "absolute", left: 26 + i * 238, top: 76, width: 216, height: 168, borderRadius: 12, border: "1px solid rgba(140,155,255,0.16)", background: "rgba(9,11,22,0.7)", opacity: ramp(f, 10 + i * 6, 26 + i * 6) }}>
              <div style={{ width: 26, height: 26, borderRadius: 99, margin: "18px 18px 0", background: "rgba(160,172,220,0.22)" }} />
              <div style={{ height: 7, width: 120, borderRadius: 4, background: "rgba(160,172,220,0.2)", margin: "16px 18px 0" }} />
              <div style={{ height: 7, width: 74, borderRadius: 4, background: "rgba(160,172,220,0.12)", margin: "9px 18px 0" }} />
              <div style={{ position: "absolute", left: 18, bottom: 16, ...mono(10, MAGENTA, 1.8) }}>{"MEMBER $" + (12 + i * 6)}</div>
            </div>
          ))}
          <div style={{ position: "absolute", left: 26, right: 26, top: 286, height: 1, background: "rgba(140,155,255,0.16)" }} />
          <div style={{ position: "absolute", left: 26, top: 314, ...mono(11, MUTE) }}>{"PER MEMBER, PER MONTH"}</div>
          <div style={{ position: "absolute", left: 26, right: 26, top: 348, height: 12, borderRadius: 6, background: "rgba(140,155,255,0.12)", overflow: "hidden" }}>
            <div style={{ width: meter * 100 + "%", height: "100%", background: "linear-gradient(90deg, rgba(255,92,143,0.5), " + MAGENTA + ")" }} />
          </div>
          <div style={{ position: "absolute", left: 26, right: 26, top: 392, display: "flex", justifyContent: "space-between" }}>
            <span style={{ ...mono(11, DIM) }}>{"GROWS WITH EVERY JOIN"}</span>
            <span style={{ ...mono(11, MAGENTA) }}>{"COST " + Math.round(meter * 100) + "%"}</span>
          </div>
          <div style={{ position: "absolute", left: 26, right: 26, top: 476, height: 0, borderTop: "2px dashed rgba(255,92,143,0.7)", opacity: ramp(f, 42, 62) }} />
          <div style={{ position: "absolute", left: 26, top: 452, ...mono(10, MAGENTA), opacity: ramp(f, 42, 62) }}>{"PRICE CEILING"}</div>
          <div style={{ position: "absolute", right: 26, top: 452, ...mono(10, DIM), opacity: ramp(f, 48, 66) }}>{"SET BY THEM"}</div>
          <div style={{ position: "absolute", left: 26, right: 26, bottom: 22, ...mono(11, DIM) }}>{"THEIR DATA, THEIR DASHBOARD, THEIR BRAND AROUND YOUR METHOD"}</div>
        </Band>
      </div>
    </>
  );
};

const Own: React.FC = () => {
  const f = useCurrentFrame();
  const s = spring({ frame: f - 2, fps: 30, config: { damping: 24, stiffness: 110, mass: 0.9 } });
  const tags = ["YOUR BRAND", "YOUR DATA", "NO CEILING"];
  return (
    <>
      <Word f={f} text="Owned." color={CYAN} />
      <div style={{ position: "absolute", left: 84, top: 196, ...mono(13, MUTE, 2.6) }}>{"your platform, your method"}</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 300, display: "flex", justifyContent: "center", opacity: Math.min(1, s * 1.5), transform: "translateY(" + interpolate(s, [0, 1], [-26, 0]) + "px)" }}>
        <Band style={{ position: "relative", width: 1020, height: 560, borderColor: "rgba(69,227,210,0.4)", boxShadow: "0 0 " + (30 + pulse(f, 0.5) * 26) + "px rgba(69,227,210,0.24)" }}>
          <div style={{ ...mono(11, CYAN), position: "absolute", left: 26, top: 22 }}>{"PURPOSEFUL PARENTING / PLATFORM"}</div>
          <div style={{ position: "absolute", right: 26, top: 22, ...mono(11, DIM) }}>{"YOURS"}</div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ position: "absolute", left: 26 + i * 238, top: 76, width: 216, height: 168, borderRadius: 12, border: "1px solid rgba(69,227,210,0.22)", background: "rgba(9,20,22,0.6)", opacity: ramp(f, 8 + i * 5, 24 + i * 5) }}>
              <div style={{ width: 26, height: 26, borderRadius: 99, margin: "18px 18px 0", background: "linear-gradient(150deg, #ffffff, " + CYAN + ")" }} />
              <div style={{ height: 7, width: 120, borderRadius: 4, background: "rgba(160,220,215,0.28)", margin: "16px 18px 0" }} />
              <div style={{ height: 7, width: 74, borderRadius: 4, background: "rgba(160,220,215,0.16)", margin: "9px 18px 0" }} />
              <div style={{ position: "absolute", left: 18, bottom: 16, ...mono(10, CYAN, 1.8) }}>{"MEMBER / OWNED"}</div>
            </div>
          ))}
          <div style={{ position: "absolute", left: 26, right: 26, top: 286, height: 1, background: "rgba(69,227,210,0.2)" }} />
          {tags.map((t, i) => (
            <div key={t} style={{ position: "absolute", left: 26 + i * 268, top: 320, width: 240, height: 54, borderRadius: 10, border: "1px solid rgba(69,227,210,0.3)", background: "rgba(69,227,210,0.07)", display: "flex", alignItems: "center", justifyContent: "center", opacity: ramp(f, 30 + i * 10, 46 + i * 10) }}>
              <span style={{ ...mono(11, INK, 2.4) }}>{t}</span>
            </div>
          ))}
          <div style={{ position: "absolute", left: 26, top: 402, ...mono(11, MUTE) }}>{"ONE BUILD. NO PER MEMBER FEE. NO PRICING JUMP."}</div>
          <div style={{ position: "absolute", left: 26, right: 26, top: 444, height: 12, borderRadius: 6, background: "rgba(69,227,210,0.12)" }}>
            <div style={{ width: ramp(f, 46, 96) * 100 + "%", height: "100%", borderRadius: 6, background: "linear-gradient(90deg, rgba(69,227,210,0.4), " + CYAN + ")" }} />
          </div>
          <div style={{ position: "absolute", left: 26, right: 26, bottom: 22, ...mono(11, DIM) }}>{"PROGRESS DATA FLOWS TO YOU, NOT TO A LANDLORD"}</div>
        </Band>
      </div>
    </>
  );
};

const Paths: React.FC = () => {
  const f = useCurrentFrame();
  const mods = ["ORIENTATION", "FOUNDATIONS", "THE SCRIPTS", "REAL WEEK", "REVIEW"];
  return (
    <>
      <Word f={f} text="Sequenced." />
      <div style={{ position: "absolute", left: 84, top: 196, ...mono(13, MUTE, 2.6) }}>{"curriculum paths with prerequisites"}</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 290, display: "flex", justifyContent: "center" }}>
        <div style={{ position: "relative", width: 1020 }}>
          {mods.map((m, i) => {
            const s = spring({ frame: f - 6 - i * 8, fps: 30, config: { damping: 22, stiffness: 130, mass: 0.8 } });
            const done = ramp(f, 30 + i * 10, 44 + i * 10);
            return (
              <div key={m} style={{ position: "relative", height: 92, marginBottom: 14, opacity: Math.min(1, s * 1.5), transform: "translateX(" + interpolate(s, [0, 1], [-40, 0]) + "px)" }}>
                <div style={{ position: "absolute", left: 0, top: 0, width: 1020, height: 92, borderRadius: 12, background: "rgba(13,16,30,0.9)", border: "1px solid rgba(140,155,255," + (0.14 + done * 0.4) + ")", display: "flex", alignItems: "center", padding: "0 24px", boxShadow: "0 0 " + done * 30 + "px rgba(111,123,255," + done * 0.24 + ")" }}>
                  <span style={{ ...mono(11, DIM), width: 120 }}>{"MODULE 0" + (i + 1)}</span>
                  <span style={{ ...big(26), letterSpacing: "-0.01em" }}>{m}</span>
                  <span style={{ marginLeft: "auto", ...mono(10, i === 0 ? CYAN : DIM, 1.8) }}>{i === 0 ? "UNLOCKED" : "AFTER MODULE 0" + i}</span>
                  <div style={{ marginLeft: 22 }}><Tick on={done} /></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

const Track: React.FC = () => {
  const f = useCurrentFrame();
  const rows = [
    { label: "WATCHED THE VIDEO", tag: "NOT ENOUGH", weak: true },
    { label: "PRINTED THE WORKSHEET", tag: "", weak: false },
    { label: "RAN THE SCRIPT", tag: "", weak: false },
    { label: "LOGGED THE BEHAVIOUR", tag: "", weak: false },
  ];
  return (
    <>
      <Word f={f} text="Tracked." />
      <div style={{ position: "absolute", left: 84, top: 196, ...mono(13, MUTE, 2.6) }}>{"behaviour, not just completion"}</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 396, display: "flex", justifyContent: "center" }}>
        <Band style={{ position: "relative", width: 1020, padding: "26px 26px 20px" }}>
          {rows.map((r, i) => {
            const on = ramp(f, 24 + i * 12, 40 + i * 12);
            return (
              <div key={r.label} style={{ display: "flex", alignItems: "center", height: 84, borderBottom: i === rows.length - 1 ? "none" : "1px solid rgba(140,155,255,0.12)" }}>
                <span style={{ ...mono(11, r.weak ? DIM : MUTE), width: 120 }}>{"0" + (i + 1)}</span>
                <span style={{ ...big(24), color: r.weak ? DIM : INK, letterSpacing: "-0.01em", textDecoration: r.weak ? "line-through" : "none" }}>{r.label}</span>
                {r.tag ? <span style={{ marginLeft: 18, ...mono(10, MAGENTA, 2) }}>{r.tag}</span> : null}
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ width: 180, height: 8, borderRadius: 4, background: "rgba(140,155,255,0.14)" }}>
                    <div style={{ width: (r.weak ? 100 : on * 100) + "%", height: "100%", borderRadius: 4, background: r.weak ? "rgba(160,172,220,0.35)" : "linear-gradient(90deg, rgba(69,227,210,0.5), " + CYAN + ")" }} />
                  </div>
                  {r.weak ? <span style={{ ...mono(10, DIM), width: 18 }}>{"-"}</span> : <Tick on={on} />}
                </div>
              </div>
            );
          })}
        </Band>
      </div>
    </>
  );
};

const Flag: React.FC = () => {
  const f = useCurrentFrame();
  const parents = ["MARIA", "JULES", "ANDREA", "KIM"];
  const stall = ramp(f, 26, 44);
  const alert = spring({ frame: f - 52, fps: 30, config: { damping: 20, stiffness: 140, mass: 0.8 } });
  return (
    <>
      <Word f={f} text="Caught early." color={AMBER} />
      <div style={{ position: "absolute", left: 84, top: 196, ...mono(13, MUTE, 2.6) }}>{"stalled parents get flagged before they leave"}</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 392, display: "flex", justifyContent: "center", gap: 22 }}>
        {parents.map((p, i) => {
          const stuck = i === 2;
          const heat = stuck ? stall : 0;
          const stroke = heat > 0.55 ? MAGENTA : heat > 0.15 ? AMBER : CYAN;
          return (
            <Band key={p} style={{ position: "relative", width: 224, height: 232, borderColor: "rgba(" + (heat > 0.55 ? "255,92,143" : heat > 0.15 ? "255,180,92" : "140,155,255") + "," + (0.2 + heat * 0.6) + ")", boxShadow: "0 0 " + heat * 40 + "px rgba(255,92,143," + heat * 0.3 + ")", opacity: Math.min(1, ramp(f, 8 + i * 6, 24 + i * 6)) }}>
              <div style={{ position: "absolute", left: 20, top: 18, ...mono(10, MUTE) }}>{p}</div>
              <svg width={120} height={120} viewBox="0 0 120 120" style={{ position: "absolute", left: 52, top: 48 }}>
                <circle cx={60} cy={60} r={44} fill="none" stroke="rgba(140,155,255,0.16)" strokeWidth={8} />
                <circle cx={60} cy={60} r={44} fill="none" stroke={stroke} strokeWidth={8} strokeLinecap="round" strokeDasharray={276} strokeDashoffset={276 - 276 * (stuck ? 0.42 : 0.5 + i * 0.12)} transform="rotate(-90 60 60)" />
              </svg>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 20, textAlign: "center", ...mono(10, heat > 0.55 ? MAGENTA : DIM, 1.8) }}>{stuck && heat > 0.3 ? "STALLED 6 DAYS" : "ON TRACK"}</div>
            </Band>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 692, display: "flex", justifyContent: "center", opacity: Math.min(1, alert * 1.4), transform: "translateY(" + interpolate(alert, [0, 1], [24, 0]) + "px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "16px 26px", borderRadius: 999, border: "1px solid rgba(69,227,210,0.4)", background: "rgba(69,227,210,0.08)" }}>
          <span style={{ ...mono(11, CYAN, 2.4) }}>{"TRIGGER FIRES AUTOMATICALLY"}</span>
          <span style={{ ...mono(11, INK, 2.4) }}>{"YOUR TEAM STEPS IN"}</span>
          <span style={{ ...mono(11, DIM, 2.4) }}>{"BEFORE CHURN"}</span>
        </div>
      </div>
    </>
  );
};

const Dash: React.FC = () => {
  const f = useCurrentFrame();
  const s = spring({ frame: f - 4, fps: 30, config: { damping: 22, stiffness: 120, mass: 0.85 } });
  const ring = ramp(f, 26, 74);
  return (
    <>
      <Word f={f} text="Never lost." />
      <div style={{ position: "absolute", left: 84, top: 196, ...mono(13, MUTE, 2.6) }}>{"every parent sees their next step"}</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 300, display: "flex", justifyContent: "center", opacity: Math.min(1, s * 1.4), transform: "translateY(" + interpolate(s, [0, 1], [30, 0]) + "px)" }}>
        <Band style={{ position: "relative", width: 1020, height: 520, padding: "30px 34px" }}>
          <div style={{ ...mono(11, DIM) }}>{"GOOD EVENING, MARIA"}</div>
          <div style={{ ...big(40), marginTop: 14, letterSpacing: "-0.02em" }}>{"Next step: run the bedtime script"}</div>
          <div style={{ ...mono(12, MUTE, 2), marginTop: 14 }}>{"MODULE 03 / THE SCRIPTS  ·  12 MINUTES  ·  DUE TONIGHT"}</div>
          <div style={{ position: "absolute", right: 40, top: 44 }}>
            <svg width={180} height={180} viewBox="0 0 180 180">
              <circle cx={90} cy={90} r={72} fill="none" stroke="rgba(140,155,255,0.14)" strokeWidth={10} />
              <circle cx={90} cy={90} r={72} fill="none" stroke={CYAN} strokeWidth={10} strokeLinecap="round" strokeDasharray={452} strokeDashoffset={452 - 452 * (0.34 + ring * 0.22)} transform="rotate(-90 90 90)" />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", ...big(34) }}>{Math.round(34 + ring * 22) + "%"}</div>
          </div>
          <div style={{ position: "absolute", left: 34, right: 300, top: 250, padding: "20px 22px", borderRadius: 12, background: "rgba(69,227,210,0.07)", border: "1px solid rgba(69,227,210,0.24)" }}>
            <div style={{ ...mono(10, CYAN, 2) }}>{"WHY THIS ONE"}</div>
            <div style={{ marginTop: 10, fontSize: 19, color: MUTE, lineHeight: 1.4 }}>{"You logged a hard bedtime twice this week. This script is your next block."}</div>
          </div>
          <div style={{ position: "absolute", left: 34, bottom: 30, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ padding: "12px 24px", borderRadius: 10, background: "linear-gradient(100deg, " + CYAN + ", " + ACCENT + ")", ...mono(11, "#07080d", 2.4) }}>{"CONTINUE"}</div>
            <span style={{ ...mono(11, DIM) }}>{"ONE THING AT A TIME"}</span>
          </div>
        </Band>
      </div>
    </>
  );
};

const Data: React.FC = () => {
  const f = useCurrentFrame();
  const hub = { x: 400, y: 300 };
  const tiles = [
    { label: "YOUR CRM", x: 1050, y: 160, color: CYAN },
    { label: "EMAIL", x: 1330, y: 300, color: ACCENT },
    { label: "CHECKOUT", x: 1050, y: 440, color: MAGENTA },
  ];
  return (
    <>
      <Word f={f} text="Yours." color={CYAN} />
      <div style={{ position: "absolute", left: 84, top: 196, ...mono(13, MUTE, 2.6) }}>{"progress data leaves the platform with you"}</div>
      <div style={{ position: "absolute", left: 0, top: 300, right: 0, height: 600 }}>
        <svg width={1920} height={600} style={{ position: "absolute", left: 0, top: 0 }}>
          {tiles.map((t, i) => {
            const d = ramp(f, 18 + i * 7, 44 + i * 7);
            const path = "M " + (hub.x + 150) + " " + hub.y + " C " + (hub.x + 330) + " " + hub.y + ", " + (t.x - 260) + " " + t.y + ", " + t.x + " " + t.y;
            return (
              <g key={t.label}>
                <path d={path} fill="none" stroke={t.color} strokeWidth={1.6} strokeDasharray="4 7" opacity={d * 0.7} strokeLinecap="round" />
                <circle r={5} fill={t.color} opacity={d * (0.4 + pulse(f, 1.2, i) * 0.6)}>
                  <animateMotion dur="2s" repeatCount="indefinite" path={path} />
                </circle>
              </g>
            );
          })}
        </svg>
        <div style={{ position: "absolute", left: hub.x - 160, top: hub.y - 62, width: 320, height: 124, borderRadius: 14, background: "rgba(11,26,26,0.98)", border: "1px solid rgba(69,227,210,0.45)", boxShadow: "0 0 60px rgba(69,227,210,0.25)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, opacity: ramp(f, 4, 24) }}>
          <span style={{ ...mono(12, INK, 2.6) }}>{"YOUR DATA"}</span>
          <span style={{ ...mono(9, DIM, 2) }}>{"NOT A RENTED DASHBOARD"}</span>
        </div>
        {tiles.map((t, i) => (
          <Band key={t.label} style={{ left: t.x, top: t.y - 52, width: 320, height: 104, display: "flex", alignItems: "center", paddingLeft: 26, borderColor: t.color + "55", opacity: ramp(f, 16 + i * 7, 38 + i * 7) }}>
            <span style={{ ...mono(12, INK, 2.4) }}>{t.label}</span>
            <span style={{ marginLeft: "auto", marginRight: 24, ...mono(10, DIM) }}>{"LIVE"}</span>
          </Band>
        ))}
      </div>
    </>
  );
};

const Close: React.FC = () => {
  const f = useCurrentFrame();
  const s = spring({ frame: f - 4, fps: 30, config: { damping: 24, stiffness: 110, mass: 0.9 } });
  return (
    <>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", opacity: Math.min(1, s * 1.4), transform: "translateY(" + interpolate(s, [0, 1], [26, 0]) + "px)" }}>
          <div style={{ ...mono(12, MUTE, 3.4) }}>{"PURPOSEFUL PARENTING / LEARNING PLATFORM"}</div>
          <div style={{ ...big(96), marginTop: 22, letterSpacing: "-0.035em" }}>{"Own the platform."}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 26, marginTop: 34, opacity: ramp(f, 40, 62) }}>
            <span style={{ ...mono(13, CYAN, 2.6) }}>{"$4,000"}</span>
            <div style={{ width: 180, height: 2, background: "linear-gradient(90deg, rgba(69,227,210,0.2), " + CYAN + ", rgba(69,227,210,0.2))" }} />
            <span style={{ ...mono(13, CYAN, 2.6) }}>{"$10,000"}</span>
          </div>
          <div style={{ ...mono(11, DIM, 3), marginTop: 20, opacity: ramp(f, 52, 74) }}>{"SCOPED TO YOUR GOALS  ·  BUILT ONCE  ·  YOURS AFTER THAT"}</div>
          <div style={{ ...mono(12, MUTE, 2.8), marginTop: 54, opacity: ramp(f, 66, 88) }}>{"devxave.vercel.app  ·  xvrpdlla@gmail.com  ·  0995 026 6808"}</div>
        </div>
      </AbsoluteFill>
    </>
  );
};

const Scene: React.FC<{ scene: PitchScene; index: number; children: React.ReactNode }> = ({ scene, index, children }) => {
  const f = useCurrentFrame();
  const edge = Math.min(1, ramp(f, 0, 8) * (1 - ramp(f, scene.length - 9, scene.length - 1)));
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, edge * 1.2) }}>
      <div style={{ position: "absolute", left: 84, top: 54, ...mono(11, "#6f7796", 4) }}>{"XAVE / PLATFORM PROPOSAL"}</div>
      <div style={{ position: "absolute", right: 84, top: 54, ...mono(11, "#4f5674", 3) }}>{String(index + 1).padStart(2, "0") + " / " + scene.id.toUpperCase()}</div>
      {children}
    </AbsoluteFill>
  );
};

export const XavePitch: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS, color: INK }}>
    <Grid />
    <Glows />
    <Audio src={staticFile("pitch.wav")} />
    {PITCH_SCENES.map((scene, i) => (
      <Sequence key={scene.id} from={scene.at} durationInFrames={scene.length}>
        <Scene scene={scene} index={i}>
          {scene.id === "rent" ? <Rent /> : null}
          {scene.id === "own" ? <Own /> : null}
          {scene.id === "paths" ? <Paths /> : null}
          {scene.id === "track" ? <Track /> : null}
          {scene.id === "flag" ? <Flag /> : null}
          {scene.id === "dash" ? <Dash /> : null}
          {scene.id === "data" ? <Data /> : null}
          {scene.id === "close" ? <Close /> : null}
        </Scene>
      </Sequence>
    ))}
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(7,8,13,0.55), rgba(7,8,13,0) 26%, rgba(7,8,13,0) 74%, rgba(7,8,13,0.6))", pointerEvents: "none" }} />
  </AbsoluteFill>
);

const Row: React.FC<{ text: string; on?: boolean; muted?: boolean }> = ({ text, on = true, muted = false }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "13px 0", borderBottom: "1px solid rgba(140,155,255,0.1)" }}>
    <div style={{ width: 22, height: 22, borderRadius: 99, border: "1px solid " + (on ? "rgba(69,227,210,0.55)" : "rgba(140,155,255,0.25)"), display: "flex", alignItems: "center", justifyContent: "center", background: on ? "rgba(69,227,210,0.12)" : "transparent" }}>
      {on ? <Tick on={1} /> : <span style={{ ...mono(11, DIM) }}>{"-"}</span>}
    </div>
    <span style={{ fontSize: 20, color: muted ? DIM : "#cfd5ee", lineHeight: 1.35 }}>{text}</span>
  </div>
);

export const PitchBoardOne: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS, color: INK, padding: 90, display: "flex", flexDirection: "column" }}>
    <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(140,155,255,0.13) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
    <AbsoluteFill style={{ background: "radial-gradient(900px 620px at 16% 4%, rgba(111,123,255,0.24), rgba(7,8,13,0))" }} />
    <AbsoluteFill style={{ background: "radial-gradient(820px 560px at 88% 96%, rgba(69,227,210,0.16), rgba(7,8,13,0))" }} />
    <div style={{ position: "relative", display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ ...mono(12, "#7d84a4", 4) }}>{"XAVE / PROPOSAL FOR PURPOSEFUL PARENTING"}</div>
      <div style={{ ...big(76), marginTop: 22, letterSpacing: "-0.03em" }}>{"Own it. Do not rent it."}</div>
      <div style={{ marginTop: 16, fontSize: 22, color: MUTE, maxWidth: 1180, lineHeight: 1.45 }}>{"Your community, methodology and parent data on a platform you own outright, with no per member fees and no ceiling on how far it goes."}</div>
      <div style={{ display: "flex", gap: 40, marginTop: 46 }}>
        {[
          {
            title: "RENTED",
            accent: MAGENTA,
            sub: "A community tool",
            rows: [
              ["Per member, per month, forever", false],
              ["Their dashboard holds your data", false],
              ["Their brand wraps your method", false],
              ["A ceiling you cannot raise", false],
              ["Video completion is the only proof", false],
            ],
          },
          {
            title: "YOURS",
            accent: CYAN,
            sub: "Your own learning platform",
            rows: [
              ["One build, no per member fee", true],
              ["Parent data lands in your CRM", true],
              ["Dr. Tillman's brand, front to back", true],
              ["Grows with your audience, no limit", true],
              ["Assignments, scripts and behaviour tracked", true],
            ],
          },
        ].map((col) => (
          <div key={col.title} style={{ flex: 1, borderRadius: 16, padding: "34px 34px 26px", background: "rgba(12,15,28,0.92)", border: "1px solid " + (col.accent === CYAN ? "rgba(69,227,210,0.42)" : "rgba(140,155,255,0.18)"), boxShadow: col.accent === CYAN ? "0 0 70px rgba(69,227,210,0.16)" : "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ ...mono(13, col.accent, 4) }}>{col.title}</span>
              <span style={{ ...mono(11, DIM, 2) }}>{col.sub}</span>
            </div>
            <div style={{ marginTop: 22 }}>
              {col.rows.map((r) => (
                <Row key={String(r[0])} text={String(r[0])} on={Boolean(r[1])} muted={!r[1]} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 26, marginTop: 34 }}>
        {[
          ["01", "SCOPE", "One call. Your methodology mapped module by module."],
          ["02", "BUILD", "Four to six weeks. Curriculum, dashboards, automation."],
          ["03", "LAUNCH", "Your domain, your brand, your data. Built once."],
        ].map((s) => (
          <div key={s[0]} style={{ flex: 1, borderRadius: 14, padding: "22px 24px", background: "rgba(13,16,30,0.86)", border: "1px solid rgba(140,155,255,0.16)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span style={{ ...mono(12, ACCENT, 2), }}>{s[0]}</span>
              <span style={{ ...mono(12, INK, 3) }}>{s[1]}</span>
            </div>
            <div style={{ marginTop: 10, fontSize: 17, color: MUTE, lineHeight: 1.4 }}>{s[2]}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 26, borderTop: "1px solid rgba(140,155,255,0.16)" }}>
        <span style={{ ...mono(12, MUTE, 2.4) }}>{"JOHN XAVIER PADILLA  ·  LEAD DEVELOPER AND AI SPECIALIST"}</span>
        <span style={{ ...mono(12, CYAN, 2.4) }}>{"devxave.vercel.app  ·  xvrpdlla@gmail.com  ·  0995 026 6808"}</span>
      </div>
    </div>
  </AbsoluteFill>
);

export const PitchBoardTwo: React.FC = () => {
  const items = [
    "Custom curriculum paths: modules, prerequisites, progress logic built around Dr. Tillman's method",
    "Implementation tracking: worksheets, scripts and real parent behaviour, not just video completion",
    "Smart intervention triggers: stalled students flagged so your team steps in before they churn",
    "Parent dashboards: a clear next step, so no new member wonders where to begin",
    "Full data ownership: progress and engagement flowing into your CRM",
    "AI assisted production: outlines, script drafts and lesson assembly, shorter turnaround",
    "White label branding: a premium experience matching America's Supernanny",
    "Review and approval workflow: nothing publishes unless it matches the approved method",
    "Scalable architecture: grows with the audience, no platform limits or pricing jumps",
    "Automation layer: ManyChat, email and checkout stitched into one pipeline",
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS, color: INK, padding: 90, display: "flex", flexDirection: "column" }}>
      <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(140,155,255,0.13) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
      <AbsoluteFill style={{ background: "radial-gradient(900px 620px at 14% 6%, rgba(111,123,255,0.22), rgba(7,8,13,0))" }} />
      <AbsoluteFill style={{ background: "radial-gradient(760px 560px at 92% 92%, rgba(69,227,210,0.14), rgba(7,8,13,0))" }} />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div>
            <div style={{ ...mono(12, "#7d84a4", 4) }}>{"XAVE / WHAT THE SYSTEM COVERS"}</div>
            <div style={{ ...big(68), marginTop: 20, letterSpacing: "-0.03em" }}>{"One platform, ten moving parts."}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ ...mono(11, DIM, 2.4) }}>{"INVESTMENT"}</div>
            <div style={{ ...big(40), color: CYAN, marginTop: 8 }}>{"$4,000 - $10,000"}</div>
            <div style={{ ...mono(11, DIM, 2.2), marginTop: 6 }}>{"SCOPED TO YOUR GOALS"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 26, marginTop: 46 }}>
          {[items.slice(0, 5), items.slice(5)].map((col, ci) => (
            <div key={ci} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
              {col.map((text, i) => (
                <div key={text} style={{ display: "flex", gap: 18, alignItems: "flex-start", padding: "18px 22px", borderRadius: 12, background: "rgba(12,15,28,0.9)", border: "1px solid rgba(140,155,255,0.16)" }}>
                  <span style={{ ...mono(12, (ci + i) % 2 ? ACCENT : CYAN, 2), marginTop: 4 }}>{String(ci * 5 + i + 1).padStart(2, "0")}</span>
                  <span style={{ fontSize: 19, color: "#cfd5ee", lineHeight: 1.4 }}>{text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 24, borderTop: "1px solid rgba(140,155,255,0.16)" }}>
          <span style={{ ...mono(12, MUTE, 2.4) }}>{"BUILT FROM SCRATCH BY A FULL STACK TEAM  ·  YOU OWN THE CODE AND THE DATA"}</span>
          <span style={{ ...mono(12, CYAN, 2.4) }}>{"BOOK A CALL  ·  devxave.vercel.app"}</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
