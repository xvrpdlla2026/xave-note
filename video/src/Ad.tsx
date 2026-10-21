import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { AD_SCENES, type AdScene } from "./ad-scenes";
import { Backdrop, Mark } from "./parts";
import { accent, font, hairline, ink, mute } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ramp = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], clamp);

const Scene: React.FC<{ scene: AdScene; children: React.ReactNode }> = ({ scene, children }) => {
  const f = useCurrentFrame();
  const o = Math.min(ramp(f, 0, 7), interpolate(f, [scene.length - 7, scene.length], [1, 0], clamp));
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

const Kicker: React.FC<{ text: string }> = ({ text }) => {
  const f = useCurrentFrame();
  if (!text) return null;
  return (
    <div
      style={{
        position: "absolute",
        right: 96,
        top: 74,
        fontFamily: font,
        fontSize: 18,
        fontWeight: 700,
        letterSpacing: 4.2,
        textTransform: "uppercase",
        color: accent,
        opacity: ramp(f, 4, 12),
      }}
    >
      {text}
    </div>
  );
};

const Card: React.FC<{ x: number; y: number; w: number; h: number; delay: number; radius?: number; dashed?: boolean; children?: React.ReactNode }> = ({ x, y, w, h, delay, radius = 20, dashed, children }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - delay, fps, config: { damping: 20, stiffness: 110, mass: 0.8 } });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: radius,
        background: dashed ? "rgba(255,255,255,0.72)" : "#ffffff",
        border: dashed ? "1.5px dashed rgba(77,90,232,0.45)" : "1px solid " + "#dbdef0",
        boxShadow: "0 46px 94px rgba(22,24,52,0.2), 0 12px 26px rgba(22,24,52,0.08)",
        transform: "translateY(" + (1 - s) * 26 + "px) scale(" + (0.97 + s * 0.03) + ")",
        opacity: Math.min(1, s * 1.4),
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
};

const Pill: React.FC<{ x: number; y: number; text: string; delay: number; solid?: boolean }> = ({ x, y, text, delay, solid }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - delay, fps, config: { damping: 16, stiffness: 140, mass: 0.6 } });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        padding: "14px 26px",
        borderRadius: 99,
        background: solid ? accent : "#ffffff",
        border: solid ? "none" : "1px solid " + "#dbdef0",
        boxShadow: solid ? "0 20px 38px rgba(77,90,232,0.32)" : "0 18px 34px rgba(20,20,45,0.12)",
        fontFamily: font,
        fontSize: 24,
        fontWeight: 600,
        color: solid ? "#ffffff" : "#23252f",
        opacity: Math.min(1, s * 1.5),
        transform: "translateY(" + (1 - s) * 20 + "px) scale(" + (0.94 + s * 0.06) + ")",
      }}
    >
      {text}
    </div>
  );
};

const Bar: React.FC<{ x: number; y: number; w: number; h: number; delay: number; color?: string }> = ({ x, y, w, h, delay, color = "#dde1f2" }) => {
  const f = useCurrentFrame();
  const grow = ramp(f, delay, delay + 12);
  return <div style={{ position: "absolute", left: x, top: y, width: w * grow, height: h, borderRadius: 6, background: color }} />;
};

const Brand: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mark = spring({ frame: f - 3, fps, config: { damping: 15, stiffness: 105, mass: 0.9 } });
  const word = "Xave".split("");
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill style={{ opacity: ramp(f, 0, 30) * 0.9, background: "radial-gradient(820px 560px at 50% 44%, rgba(120,132,255,0.18), rgba(120,132,255,0))" }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: -30 }}>
        <Mark size={116} scale={0.86 + mark * 0.14} />
        <div style={{ height: 46 }} />
        <div style={{ display: "flex", gap: 3 }}>
          {word.map((c, i) => {
            const d = ramp(f, 12 + i * 3, 20 + i * 3);
            return (
              <span key={i} style={{ fontFamily: font, fontSize: 128, fontWeight: 700, letterSpacing: -5, color: ink, opacity: d, transform: "translateY(" + (1 - d) * 18 + "px)" }}>
                {c}
              </span>
            );
          })}
        </div>
        <div style={{ height: 34 }} />
        <div style={{ fontFamily: font, fontSize: 22, fontWeight: 600, letterSpacing: 6.4, textTransform: "uppercase", color: mute, opacity: ramp(f, 46, 60) }}>
          Notes &nbsp;&middot;&nbsp; Board &nbsp;&middot;&nbsp; Planner
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Classic: React.FC = () => {
  const f = useCurrentFrame();
  const tabs = ["Kickoff call", "Reading list", "Invoices"];
  const rows = [
    { d: 0, w: 210, bold: true },
    { d: 18, w: 176 },
    { d: 36, w: 196 },
    { d: 54, w: 150 },
    { d: 72, w: 186 },
    { d: 90, w: 166 },
  ];
  return (
    <AbsoluteFill>
      <Card x={330} y={210} w={1040} h={640} delay={2} radius={22}>
        <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: 62, borderBottom: "1px solid " + "#dbdef0", display: "flex", alignItems: "center", gap: 10, padding: "0 20px" }}>
          {tabs.map((t, i) => (
            <div key={t} style={{ padding: "8px 16px", borderRadius: 9, background: i === 0 ? "rgba(77,90,232,0.1)" : "transparent", fontFamily: font, fontSize: 16, fontWeight: 600, color: i === 0 ? accent : "#7c7e92", opacity: ramp(f, 14 + i * 8, 26 + i * 8) }}>
              {t}
            </div>
          ))}
          <div style={{ width: 26, height: 26, borderRadius: 8, border: "1px dashed " + accent, marginLeft: 4, display: "flex", alignItems: "center", justifyContent: "center", color: accent, fontSize: 16, fontFamily: font, opacity: ramp(f, 44, 56) }}>+</div>
        </div>
        <div style={{ position: "absolute", left: 0, top: 62, bottom: 0, width: 330, borderRight: "1px solid " + "#dbdef0", padding: "22px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, opacity: ramp(f, 8, 20) }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: "rgba(77,90,232,0.12)" }} />
            <span style={{ fontFamily: font, fontSize: 18, fontWeight: 700, color: "#23252f" }}>Personal</span>
            <span style={{ marginLeft: "auto", fontFamily: font, fontSize: 15, color: mute }}>+</span>
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: r.d, marginBottom: 13, opacity: ramp(f, 16 + i * 7, 28 + i * 7) }}>
              <div style={{ width: 13, height: 13, borderRadius: 4, border: "1.5px solid " + (i === 0 ? accent : "#c9cad8") }} />
              <div style={{ width: r.w, height: 9, borderRadius: 5, background: r.bold ? "#c7c9dd" : "#d9dcec" }} />
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", left: 366, top: 96, right: 44 }}>
          <Bar x={0} y={0} w={420} h={22} delay={20} color="#d3d7ea" />
          <Bar x={0} y={44} w={600} h={11} delay={26} />
          <Bar x={0} y={68} w={540} h={11} delay={31} />
          <Bar x={0} y={112} w={560} h={11} delay={38} />
          <Bar x={0} y={136} w={470} h={11} delay={44} />
          <Bar x={0} y={160} w={520} h={11} delay={50} />
          <div style={{ position: "absolute", left: 0, top: 206, width: 620, height: 130, borderRadius: 14, background: "rgba(77,90,232,0.06)", border: "1px solid rgba(77,90,232,0.18)", opacity: ramp(f, 58, 72) }} />
          <Bar x={22} y={230} w={380} h={11} delay={64} />
          <Bar x={22} y={254} w={300} h={11} delay={70} />
        </div>
      </Card>
      <Pill x={1400} y={300} text="Tabs" delay={26} />
      <Pill x={1430} y={390} text="Workspaces" delay={40} />
      <Pill x={1400} y={480} text="One tree" delay={54} solid />
    </AbsoluteFill>
  );
};

const glyphs: Record<string, React.ReactNode> = {
  Note: <path d="M5 3.5h11l3.5 3.5v13.5h-14.5z" />,
  Todo: <path d="M4 12.5l5 5L20 5.5" />,
  Link: <path d="M9 15l6-6M7.5 13.5a5 5 0 0 1 0-7 5 5 0 0 1 7 0M16.5 10.5a5 5 0 0 1 0 7 5 5 0 0 1-7 0" />,
  File: <path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4" />,
  Comment: <path d="M4 5.5h16v10H12l-5 4v-4H4z" />,
  Table: <path d="M4 5.5h16v13H4zM4 10h16M10 10v8.5M15 10v8.5" />,
};

const Blocks: React.FC = () => {
  const f = useCurrentFrame();
  const names = ["Note", "To-do", "Link", "File", "Comment", "Table", "Group", "Landmark"];
  const W = 232;
  const H = 150;
  const gapX = 34;
  const gapY = 34;
  const startX = (1920 - (3 * W + 2 * gapX)) / 2;
  const startY = 300;
  return (
    <AbsoluteFill>
      {names.map((name, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const dashed = name === "Group" || name === "Landmark";
        const key = name === "To-do" ? "Todo" : name;
        return (
          <Card key={name} x={startX + col * (W + gapX)} y={startY + row * (H + gapY)} w={W} h={H} delay={8 + i * 7} radius={16} dashed={dashed}>
            <div style={{ position: "absolute", left: 20, top: 20, fontFamily: font, fontSize: 12, fontWeight: 700, letterSpacing: 1.6, textTransform: "uppercase", color: "#70758e" }}>{name}</div>
            <div style={{ position: "absolute", left: 20, top: 46 }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={dashed ? accent : "#5b5e73"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                {glyphs[key] || <path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z" />}
              </svg>
            </div>
            <div style={{ position: "absolute", left: 20, bottom: 22, right: 20 }}>
              <div style={{ height: 8, borderRadius: 4, background: "#e8e9f4", width: "72%" }} />
              <div style={{ height: 8, borderRadius: 4, background: "#eff0f8", width: "48%", marginTop: 8 }} />
            </div>
          </Card>
        );
      })}
      <svg width="232" height="150" viewBox="0 0 232 150" style={{ position: "absolute", left: startX + 2 * (W + gapX), top: startY + 2 * (H + gapY) }}>
        <rect x="0.75" y="0.75" width="230" height="148" rx="16" fill="#ffffff" stroke="#e9e9f3" strokeWidth="1.5" />
        <text x="20" y="36" fontFamily="Segoe UI" fontSize="12" fontWeight="700" letterSpacing="1.6" fill="#a3a5ba">Draw</text>
        <path d="M24 112c14-26 26 8 40-10s22 16 36-4 20 6 34-8" fill="none" stroke={accent} strokeWidth="3.4" strokeLinecap="round" strokeDasharray="240" strokeDashoffset={240 - ramp(f, 62, 96) * 240} />
      </svg>
    </AbsoluteFill>
  );
};

const CanvasScene: React.FC = () => {
  const f = useCurrentFrame();
  const left = 300;
  const top = 190;
  const w = 1320;
  const h = 700;
  const grow = ramp(f, 44, 74);
  const groupIn = ramp(f, 86, 104);
  const miniX = ramp(f, 110, 168);
  const cards = [
    { x: 100, y: 140, w: 250, h: 160, label: "Ship pricing" },
    { x: 380, y: 150, w: 230, h: 140, label: "Chase invoice" },
    { x: 120, y: 340, w: 220, h: 130, label: "Ask Priya" },
    { x: 700, y: 260, w: 280, h: 190, label: "Launch deck" },
  ];
  return (
    <AbsoluteFill>
      <Card x={left} y={top} w={w} h={h} delay={2} radius={22}>
        <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(120,124,160,0.26) 1.4px, transparent 1.4px)", backgroundSize: "26px 26px", backgroundPosition: "12px 12px" }} />
        {cards.map((c, i) => {
          const s = spring({ frame: f - 10 - i * 6, fps: 30, config: { damping: 18, stiffness: 120, mass: 0.7 } });
          return (
            <div key={c.label} style={{ position: "absolute", left: c.x, top: c.y, width: c.w, height: c.h, borderRadius: 14, background: "#ffffff", border: "1px solid " + "#dbdef0", boxShadow: "0 16px 30px rgba(20,20,45,0.1)", padding: "14px 16px", opacity: Math.min(1, s * 1.5), transform: "translateY(" + (1 - s) * 18 + "px)" }}>
              <div style={{ fontFamily: font, fontSize: 16, fontWeight: 700, color: "#23252f" }}>{c.label}</div>
              <div style={{ height: 8, borderRadius: 4, background: "#dde1f2", marginTop: 12, width: "84%" }} />
              <div style={{ height: 8, borderRadius: 4, background: "#e8ebf7", marginTop: 8, width: "60%" }} />
            </div>
          );
        })}
        <div style={{ position: "absolute", left: 80, top: 120, width: 560 * grow, height: 320 * grow, borderRadius: 10, border: "1.5px solid " + accent, background: "rgba(77,90,232,0.07)", opacity: grow > 0 ? 1 : 0 }} />
        <div style={{ position: "absolute", left: 70, top: 106, width: 600, height: 350, borderRadius: 18, border: "1.5px dashed rgba(77,90,232,0.5)", background: "rgba(77,90,232,0.045)", opacity: groupIn, transform: "scale(" + (0.96 + groupIn * 0.04) + ")" }}>
          <span style={{ position: "absolute", left: 18, top: -13, padding: "3px 10px", borderRadius: 99, background: "#ffffff", border: "1px solid " + "#dbdef0", fontFamily: font, fontSize: 12, fontWeight: 700, letterSpacing: 1.4, color: accent }}>GROUP</span>
        </div>
        <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0 }}>
          <path d="M780 560c26-34 52 12 78-16s44 22 70-6 40 10 62-14" fill="none" stroke={accent} strokeWidth="3.4" strokeLinecap="round" strokeDasharray="300" strokeDashoffset={300 - ramp(f, 154, 190) * 300} />
        </svg>
        <div style={{ position: "absolute", right: 26, bottom: 26, width: 214, height: 138, borderRadius: 12, background: "rgba(255,255,255,0.94)", border: "1px solid " + "#dbdef0", boxShadow: "0 12px 24px rgba(20,20,45,0.1)", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 30, top: 26, width: 74, height: 46, borderRadius: 6, background: "rgba(77,90,232,0.2)" }} />
          <div style={{ position: "absolute", left: 118, top: 54, width: 60, height: 40, borderRadius: 6, background: "rgba(77,90,232,0.14)" }} />
          <div style={{ position: "absolute", left: 16 + miniX * 96, top: 20 + miniX * 44, width: 92, height: 62, borderRadius: 6, border: "1.6px solid " + accent, background: "rgba(77,90,232,0.06)", opacity: ramp(f, 104, 116) }} />
        </div>
      </Card>
    </AbsoluteFill>
  );
};

const Plan: React.FC = () => {
  const f = useCurrentFrame();
  const full = ramp(f, 40, 62);
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 420, top: 250, width: 1080, height: 520, borderRadius: 22, background: "#ffffff", border: "1px solid " + "#dbdef0", boxShadow: "0 " + (44 + full * 30) + "px " + (90 + full * 40) + "px rgba(20,20,50,0.16)", transform: "scale(" + (1 + full * 0.34) + ")", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: 58, borderBottom: "1px solid " + "#dbdef0", display: "flex", alignItems: "center", padding: "0 22px", gap: 10 }}>
          <span style={{ fontFamily: font, fontSize: 18, fontWeight: 700, color: "#23252f" }}>October</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {["D", "W", "M", "Y"].map((d, i) => (
              <div key={d} style={{ width: 28, height: 24, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font, fontSize: 13, fontWeight: 700, color: i === 1 ? accent : "#9a9cb0", background: i === 1 ? "rgba(77,90,232,0.1)" : "transparent" }}>{d}</div>
            ))}
          </div>
        </div>
        <div style={{ position: "absolute", left: 22, top: 78, right: 22, bottom: 22, display: "flex", gap: 12 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((col) => (
            <div key={col} style={{ flex: 1, borderRadius: 12, background: col === 1 ? "rgba(77,90,232,0.05)" : "#f7f8fd", padding: 10 }}>
              <div style={{ height: 8, width: 34, borderRadius: 4, background: col === 1 ? accent : "#d3d7ea", marginBottom: 12 }} />
              {[0, 1, 2].map((row) => {
                const on = col * 3 + row < 11;
                const d = ramp(f, 12 + (col * 3 + row) * 3, 22 + (col * 3 + row) * 3);
                return (
                  <div key={row} style={{ height: 40, borderRadius: 8, marginBottom: 9, background: on ? "#ffffff" : "transparent", border: on ? "1px solid " + "#dbdef0" : "none", boxShadow: on ? "0 8px 16px rgba(20,20,45,0.06)" : "none", opacity: on ? d : 0, display: "flex", alignItems: "center", paddingLeft: 10 }}>
                    {on ? <div style={{ width: 46, height: 7, borderRadius: 4, background: "#d3d7ea" }} /> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: "absolute", left: 1450, top: 168, padding: "12px 24px", borderRadius: 99, background: accent, boxShadow: "0 18px 36px rgba(77,90,232,0.3)", fontFamily: font, fontSize: 22, fontWeight: 600, color: "#ffffff", opacity: ramp(f, 56, 70), transform: "translateY(" + (1 - ramp(f, 56, 70)) * 14 + "px)" }}>Fullscreen</div>
    </AbsoluteFill>
  );
};

const PALETTES = [
  { name: "Indigo", accent: "#4d5ae8", soft: "rgba(77,90,232,0.12)" },
  { name: "Teal", accent: "#0f766e", soft: "rgba(15,118,110,0.12)" },
  { name: "Amber", accent: "#a15c07", soft: "rgba(161,92,7,0.12)" },
  { name: "Rose", accent: "#b3325a", soft: "rgba(179,50,90,0.12)" },
  { name: "Violet", accent: "#6d34c4", soft: "rgba(109,52,196,0.12)" },
  { name: "Graphite", accent: "#4a5260", soft: "rgba(74,82,96,0.12)" },
];

const Themes: React.FC = () => {
  const f = useCurrentFrame();
  const step = 9;
  const index = Math.min(PALETTES.length - 1, Math.max(0, Math.floor((f - 6) / step)));
  const p = PALETTES[index];
  const dark = f > 6 + PALETTES.length * step + 4;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 480, top: 210, width: 960, height: 500, borderRadius: 24, background: dark ? "#17181f" : "#ffffff", border: "1px solid " + (dark ? "#26283a" : "#dbdef0"), boxShadow: "0 46px 90px rgba(20,20,50,0.18)", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: 64, background: dark ? "#1e2029" : "#fbfbfe", borderBottom: "1px solid " + (dark ? "#2b2d3d" : hairline), display: "flex", alignItems: "center", gap: 12, padding: "0 26px" }}>
          <Mark size={28} />
          <span style={{ fontFamily: font, fontSize: 18, fontWeight: 700, color: dark ? "#eceefb" : ink }}>Xave</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: 24, height: 24, borderRadius: 8, background: dark ? "#2b2d3d" : "#dde1f2" }} />
            ))}
          </div>
        </div>
        <div style={{ position: "absolute", left: 70, top: 110, right: 70 }}>
          <div style={{ height: 16, width: 380, borderRadius: 8, background: p.soft }} />
          <div style={{ height: 11, width: 620, borderRadius: 6, background: dark ? "#2b2d3d" : "#dde1f2", marginTop: 26 }} />
          <div style={{ height: 11, width: 540, borderRadius: 6, background: dark ? "#26283a" : "#e8ebf7", marginTop: 14 }} />
          <div style={{ display: "flex", gap: 14, marginTop: 36 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: 210, height: 120, borderRadius: 14, background: dark ? "#1e2029" : "#fbfbfe", border: "1px solid " + (dark ? "#2b2d3d" : hairline), padding: 16 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: p.soft, border: "1.5px solid " + p.accent }} />
                <div style={{ height: 8, width: 96, borderRadius: 4, background: dark ? "#33364a" : "#d9dcec", marginTop: 16 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 480, top: 760, display: "flex", gap: 22 }}>
        {PALETTES.map((s, i) => {
          const d = ramp(f, 4 + i * 3, 14 + i * 3);
          const on = i === index;
          return (
            <div key={s.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, opacity: d }}>
              <div style={{ width: 42, height: 42, borderRadius: 99, background: s.accent, outline: on ? "3px solid " + s.accent : "none", outlineOffset: 5, transform: "scale(" + (on ? 1.12 : 1) + ")", boxShadow: "0 10px 20px rgba(20,20,45,0.16)" }} />
              <span style={{ fontFamily: font, fontSize: 14, fontWeight: 600, color: on ? "#33354a" : mute }}>{s.name}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Close: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mark = spring({ frame: f - 2, fps, config: { damping: 19, stiffness: 125, mass: 0.8 } });
  const pill = spring({ frame: f - 26, fps, config: { damping: 17, stiffness: 140, mass: 0.7 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill style={{ opacity: 0.9, background: "radial-gradient(780px 520px at 50% 46%, rgba(120,132,255,0.16), rgba(120,132,255,0))" }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: -20 }}>
        <Mark size={96} scale={0.9 + mark * 0.1} />
        <div style={{ height: 36 }} />
        <div style={{ fontFamily: font, fontSize: 96, fontWeight: 700, letterSpacing: -3.8, color: ink, opacity: ramp(f, 12, 24) }}>Xave</div>
        <div style={{ height: 34 }} />
        <div style={{ display: "flex", gap: 16, opacity: ramp(f, 24, 36) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 26px", borderRadius: 99, background: "#ffffff", border: "1px solid " + "#dbdef0", boxShadow: "0 16px 30px rgba(20,20,45,0.08)", fontFamily: font, fontSize: 24, fontWeight: 600, color: "#3d3f50" }}>
            <span style={{ width: 11, height: 11, borderRadius: 99, background: "#2fa06a" }} />
            Free and open source
          </div>
          <div style={{ padding: "15px 26px", borderRadius: 99, background: accent, boxShadow: "0 18px 34px rgba(77,90,232,0.3)", fontFamily: font, fontSize: 24, fontWeight: 600, color: "#ffffff", transform: "translateY(" + (1 - pill) * 12 + "px) scale(" + (0.96 + pill * 0.04) + ")", opacity: pill }}>Yours to keep</div>
        </div>
        <div style={{ height: 26 }} />
        <div style={{ fontFamily: font, fontSize: 21, color: mute, opacity: ramp(f, 40, 54) }}>No account. Nothing leaves your computer.</div>
      </div>
    </AbsoluteFill>
  );
};

export const XaveAd: React.FC = () => {
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ background: "rgba(226,230,247,0.5)" }} />
      <Audio src={staticFile("ad.wav")} />
      {AD_SCENES.map((scene) => (
        <Sequence key={scene.id} from={scene.at} durationInFrames={scene.length}>
        <Scene scene={scene}>
          <Kicker text={scene.kicker} />
          {scene.id === "brand" ? <Brand /> : null}
          {scene.id === "classic" ? <Classic /> : null}
          {scene.id === "blocks" ? <Blocks /> : null}
          {scene.id === "canvas" ? <CanvasScene /> : null}
          {scene.id === "plan" ? <Plan /> : null}
          {scene.id === "themes" ? <Themes /> : null}
          {scene.id === "close" ? <Close /> : null}
        </Scene>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
