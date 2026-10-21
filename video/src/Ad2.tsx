import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { MESH_SCENES, type MeshScene } from "./ad2-scenes";
import { Mark } from "./parts";

const BG = "#07080d";
const INK = "#eef1ff";
const MUTE = "#8b91ab";
const ACCENT = "#6f7bff";
const CYAN = "#45e3d2";
const MAGENTA = "#ff5c8f";
const cell = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ramp = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], cell);
const pulse = (f: number, hz: number, phase = 0) => 0.5 + 0.5 * Math.sin((f / 30) * Math.PI * 2 * hz + phase);

const Grid: React.FC = () => {
  const f = useCurrentFrame();
  const drift = (f * 0.35) % 64;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG,
        backgroundImage:
          "linear-gradient(rgba(120,132,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(120,132,255,0.07) 1px, transparent 1px)",
        backgroundSize: "64px 64px",
        backgroundPosition: "0px " + drift + "px",
      }}
    />
  );
};

const Glows: React.FC = () => {
  const f = useCurrentFrame();
  const a = 0.22 + pulse(f, 0.18) * 0.12;
  return (
    <>
      <AbsoluteFill style={{ background: "radial-gradient(720px 520px at 18% 12%, rgba(111,123,255," + a + "), rgba(7,8,13,0))" }} />
      <AbsoluteFill style={{ background: "radial-gradient(760px 560px at 84% 88%, rgba(69,227,210," + a * 0.6 + "), rgba(7,8,13,0))" }} />
      <AbsoluteFill style={{ background: "radial-gradient(900px 700px at 50% 50%, rgba(255,92,143,0.06), rgba(7,8,13,0))" }} />
    </>
  );
};

const Lines: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 3px)",
      mixBlendMode: "overlay",
    }}
  />
);

const Flash: React.FC<{ at: number; strength?: number }> = ({ at, strength = 0.5 }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [at - 1, at, at + 4], [0, strength, 0], cell);
  return <AbsoluteFill style={{ background: "#dfe6ff", opacity: o, mixBlendMode: "screen" }} />;
};

const Corner: React.FC<{ label: string }> = ({ label }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: 66, bottom: 54, display: "flex", alignItems: "center", gap: 12, opacity: ramp(f, 2, 12) * 0.85 }}>
      <div style={{ width: 26, height: 1, background: CYAN }} />
      <span style={{ fontFamily: "Consolas, ui-monospace, monospace", fontSize: 15, letterSpacing: 3.4, color: "#9aa3c4" }}>{label}</span>
    </div>
  );
};

const Scene: React.FC<{ scene: MeshScene; label: string; children: React.ReactNode }> = ({ scene, label, children }) => {
  const f = useCurrentFrame();
  const o = Math.min(ramp(f, 0, 4), interpolate(f, [scene.length - 3, scene.length], [1, 0], cell));
  return (
    <AbsoluteFill style={{ opacity: o }}>
      {children}
      <Corner label={label} />
      <Flash at={0} strength={0.34} />
    </AbsoluteFill>
  );
};

const Limit: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = ["EVERY", "BOARD", "HAS", "AN", "EDGE"];
  const burst = ramp(f, 46, 92);
  const rush = spring({ frame: f - 70, fps, config: { damping: 200, stiffness: 46 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", width: 1180, height: 430, border: "1px solid rgba(140,155,255," + (0.3 - burst * 0.3) + ")", borderRadius: 10 }}>
      </div>
      <div style={{ display: "flex", gap: 26, marginTop: -40 }}>
        {words.map((w, i) => {
          const d = ramp(f, 3 + i * 5, 12 + i * 5);
          return (
            <span
              key={w}
              style={{
                fontFamily: "Segoe UI, Inter, system-ui, sans-serif",
                fontSize: 92,
                fontWeight: 700,
                letterSpacing: -1.4,
                color: INK,
                opacity: d * (1 - burst * 0.9),
                transform: "translateY(" + (1 - d) * 26 + "px) translateX(" + burst * (i - 2) * 90 + "px) scale(" + (1 + burst * 0.5) + ")",
                filter: "blur(" + burst * 6 + "px)",
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
        const t = ramp(f, 52 + i * 2, 52 + i * 2 + 30);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              width: 2,
              height: 120 + i * 40,
              background: "linear-gradient(180deg, rgba(69,227,210,0.9), rgba(69,227,210,0))",
              left: 960 + (i - 4) * (40 + i * 14),
              top: "50%",
              opacity: t * (1 - rush),
              transform: "translateY(-50%) scaleY(" + (0.4 + t) + ")",
            }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          fontFamily: "Segoe UI, Inter, system-ui, sans-serif",
          fontSize: 34,
          fontWeight: 600,
          letterSpacing: 5.5,
          color: CYAN,
          opacity: ramp(f, 58, 72),
          transform: "translateY(150px) scale(" + (1 + rush * 0.16) + ")",
          textShadow: "0 0 32px rgba(69,227,210,0.55)",
        }}
      >
        THIS ONE DOES NOT
      </div>
    </AbsoluteFill>
  );
};

const orbPath = (i: number) => {
  const end = [{ x: 700, y: 470 }, { x: 960, y: 380 }, { x: 1220, y: 520 }][i];
  return "M " + (140 + i * 60) + " 900 C " + (300 + i * 80) + " 700, " + (end.x - 320) + " " + (end.y + 220) + ", " + end.x + " " + end.y;
};

const Agents: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const colors = [CYAN, ACCENT, MAGENTA];
  const cards = [
    { x: 700, y: 470, w: 240, h: 148, label: "RESEARCH" },
    { x: 960, y: 380, w: 220, h: 148, label: "LEDGER" },
    { x: 1220, y: 520, w: 240, h: 148, label: "ROADMAP" },
  ];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", width: 1240, height: 660, borderRadius: 20, background: "rgba(12,14,24,0.86)", border: "1px solid rgba(120,132,255,0.24)", boxShadow: "0 60px 140px rgba(0,0,0,0.65)", transform: "perspective(1400px) rotateX(9deg) rotateY(-5deg) scale(" + (1.02 + ramp(f, 0, 100) * 0.05) + ")", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(140,155,255,0.16) 1px, transparent 1px)", backgroundSize: "30px 30px" }} />
        {cards.map((c, i) => {
          const lit = ramp(f, 34 + i * 16, 48 + i * 16);
          return (
            <div key={c.label} style={{ position: "absolute", left: c.x - c.w / 2 - 340, top: c.y - c.h / 2 - 210, width: c.w, height: c.h, borderRadius: 12, background: "#0e1120", border: "1px solid rgba(150,165,255," + (0.24 + lit * 0.7) + ")", boxShadow: "0 0 " + (lit * 42) + "px rgba(" + (i === 0 ? "69,227,210" : i === 1 ? "111,123,255" : "255,92,143") + "," + lit * 0.34 + ")", padding: "14px 16px" }}>
              <div style={{ fontFamily: "Consolas, ui-monospace, monospace", fontSize: 11, letterSpacing: 2.4, color: "#7d84a4" }}>{c.label}</div>
              <div style={{ height: 7, width: "70%", borderRadius: 4, background: "rgba(160,172,220,0.34)", marginTop: 14 }} />
              <div style={{ height: 7, width: "48%", borderRadius: 4, background: "rgba(160,172,220,0.22)", marginTop: 9 }} />
            </div>
          );
        })}
        <div style={{ position: "absolute", left: 26, top: 24, fontFamily: "Consolas, ui-monospace, monospace", fontSize: 12, letterSpacing: 3, color: "#6f7796" }}>INFINITE BOARD / LIVE</div>
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {cards.map((c, i) => (
          <path key={i} d={orbPath(i)} fill="none" stroke={colors[i]} strokeWidth="1.6" strokeDasharray="4 7" strokeLinecap="round" opacity={ramp(f, 10 + i * 8, 30 + i * 8) * 0.6} />
        ))}
      </svg>
      {cards.map((c, i) => {
        const landed = ramp(f, 40 + i * 8, 54 + i * 8);
        return <div key={"dot" + i} style={{ position: "absolute", left: c.x - 5, top: c.y - 5, width: 10, height: 10, borderRadius: "50%", background: colors[i], boxShadow: "0 0 22px 6px " + colors[i], opacity: landed }} />;
      })}
      {cards.map((c, i) => {
        const t = spring({ frame: f - 20 - i * 8, fps, config: { damping: 26, stiffness: 62, mass: 1.1 } });
        const x = interpolate(t, [0, 1], [120 + i * 40, c.x]);
        const y = interpolate(t, [0, 1], [980, c.y]);
        return (
          <div
            key={c.label}
            style={{
              position: "absolute",
              left: x - 26,
              top: y - 26,
              width: 52,
              height: 52,
              borderRadius: 99,
              background: "radial-gradient(circle at 40% 38%, #ffffff, " + colors[i] + " 40%, rgba(0,0,0,0) 72%)",
              boxShadow: "0 0 60px 12px rgba(" + (i === 0 ? "69,227,210" : i === 1 ? "111,123,255" : "255,92,143") + ",0.45)",
              opacity: ramp(f, 14 + i * 8, 26 + i * 8),
              transform: "scale(" + (0.8 + pulse(f, 0.9, i) * 0.2) + ")",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const Move: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const order = [0, 1, 2, 3, 4, 5];
  const linkOn = ramp(f, 44, 62);
  const sweep = ramp(f, 88, 118);
  return (
    <AbsoluteFill>
      <Flash at={44} strength={0.3} />
      <Flash at={88} strength={0.22} />
      <div style={{ position: "absolute", inset: 0, transform: "scale(" + (1.03 - ramp(f, 0, 126) * 0.05) + ") rotate(" + (ramp(f, 0, 126) * -1.2) + "deg)" }}>
        <svg width={1920} height={1080} style={{ position: "absolute" }}>
          {[[0, 1], [1, 2], [2, 5], [3, 4], [4, 5], [0, 3]].map(([a, b], i) => {
            const ax = 380 + (a % 3) * 520;
            const ay = 300 + Math.floor(a / 3) * 330;
            const bx = 380 + (b % 3) * 520;
            const by = 300 + Math.floor(b / 3) * 330;
            const d = ramp(f, 46 + i * 4, 66 + i * 4);
            return <line key={i} x1={ax} y1={ay} x2={bx} y2={by} stroke={i % 2 ? CYAN : ACCENT} strokeWidth="1.4" opacity={d * (0.35 + pulse(f, 1.1, i) * 0.4)} />;
          })}
        </svg>
        {order.map((i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const target = { x: 300 + col * 520, y: 220 + row * 330 };
          const s = spring({ frame: f - 4 - i * 5, fps, config: { damping: 22, stiffness: 120, mass: 0.8 } });
          const x = interpolate(s, [0, 1], [target.x + (col - 1) * 520, target.x]);
          const y = interpolate(s, [0, 1], [target.y + (row === 0 ? -420 : 420), target.y]);
          const live = ramp(f, 46 + i * 4, 60 + i * 4);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: 300,
                height: 150,
                borderRadius: 14,
                background: "rgba(14,17,32,0.94)",
                border: "1px solid rgba(140,155,255," + (0.16 + live * 0.4) + ")",
                boxShadow: "0 0 " + (live * 34) + "px rgba(111,123,255," + live * 0.3 + "), 0 24px 60px rgba(0,0,0,0.5)",
                padding: "16px 18px",
                opacity: Math.min(1, s * 1.6),
                transform: "rotate(" + (i % 2 ? 1.2 : -0.8) * (1 - s) + "deg)",
              }}
            >
              <div style={{ fontFamily: "Consolas, ui-monospace, monospace", fontSize: 11, letterSpacing: 2.2, color: "#79809f" }}>{"BLOCK " + (i + 1)}</div>
              <div style={{ height: 8, width: "72%", borderRadius: 4, background: "rgba(160,172,220,0.4)", marginTop: 14 }} />
              <div style={{ height: 8, width: "46%", borderRadius: 4, background: "rgba(160,172,220,0.24)", marginTop: 10 }} />
              <div style={{ position: "absolute", right: 16, bottom: 14, width: 8, height: 8, borderRadius: 99, background: i < 3 ? CYAN : ACCENT, boxShadow: "0 0 14px currentColor", opacity: live }} />
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: interpolate(sweep, [0, 1], [-40, 1080]), height: 3, background: "linear-gradient(90deg, rgba(69,227,210,0), rgba(69,227,210,0.85), rgba(69,227,210,0))", opacity: sweep > 0 && sweep < 1 ? 0.9 : 0, boxShadow: "0 0 40px 8px rgba(69,227,210,0.4)" }} />
    </AbsoluteFill>
  );
};

const TREE = [
  { id: "root", x: 960, y: 288, w: 250, label: "ROOT BOARD", depth: 0 },
  { id: "n1", x: 520, y: 466, w: 210, label: "NOTES", depth: 1 },
  { id: "n2", x: 960, y: 466, w: 210, label: "BOARD", depth: 1 },
  { id: "n3", x: 1400, y: 466, w: 210, label: "PLANNER", depth: 1 },
  { id: "l1", x: 400, y: 664, w: 200, label: "RESEARCH", depth: 2 },
  { id: "l2", x: 640, y: 664, w: 200, label: "LEDGER", depth: 2 },
  { id: "l3", x: 840, y: 664, w: 200, label: "ROADMAP", depth: 2 },
  { id: "l4", x: 1080, y: 664, w: 200, label: "WEEK 42", depth: 2 },
  { id: "l5", x: 1280, y: 664, w: 200, label: "SKETCHES", depth: 2 },
  { id: "l6", x: 1520, y: 664, w: 200, label: "ARCHIVE", depth: 2 },
];

const TREE_EDGES: [string, string][] = [
  ["root", "n1"],
  ["root", "n2"],
  ["root", "n3"],
  ["n1", "l1"],
  ["n1", "l2"],
  ["n2", "l3"],
  ["n2", "l4"],
  ["n3", "l5"],
  ["n3", "l6"],
];

const H = 84;
const at = (id: string) => TREE.find((n) => n.id === id) as (typeof TREE)[number];

const elbow = (from: string, to: string) => {
  const a = at(from);
  const b = at(to);
  const drop = 34;
  return "M " + a.x + " " + (a.y + H / 2) + " L " + a.x + " " + (a.y + H / 2 + drop) + " L " + b.x + " " + (a.y + H / 2 + drop) + " L " + b.x + " " + (b.y - H / 2);
};

const Node: React.FC<{ node: (typeof TREE)[number]; start: number }> = ({ node, start }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - start, fps, config: { damping: 20, stiffness: 130, mass: 0.7 } });
  const live = ramp(f, start, start + 16);
  const w = node.w;
  return (
    <div
      style={{
        position: "absolute",
        left: node.x - w / 2,
        top: node.y - H / 2,
        width: w,
        height: H,
        borderRadius: 12,
        background: node.depth === 0 ? "rgba(24,28,52,0.96)" : "rgba(14,17,32,0.96)",
        border: "1px solid rgba(120,136,255," + (0.24 + live * 0.5) + ")",
        boxShadow: "0 0 " + (16 + live * 36) + "px rgba(111,123,255," + (0.18 + live * 0.26) + "), 0 18px 40px rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 16px",
        opacity: Math.min(1, s * 1.7),
        transform: "translateY(" + (1 - s) * 18 + "px) scale(" + (0.94 + s * 0.06) + ")",
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: node.depth === 0 ? CYAN : node.depth === 1 ? ACCENT : MAGENTA, boxShadow: "0 0 16px 3px currentColor", opacity: 0.9 }} />
      <span style={{ fontFamily: "Consolas, ui-monospace, monospace", fontSize: 13, letterSpacing: 2.6, color: "#c3c9e6" }}>{node.label}</span>
      <span style={{ marginLeft: "auto", fontFamily: "Consolas, ui-monospace, monospace", fontSize: 11, letterSpacing: 1.4, color: "#5d6486" }}>{"D" + node.depth}</span>
    </div>
  );
};

const Mesh: React.FC = () => {
  const f = useCurrentFrame();
  const route = ["root", "n2", "l3"];
  const routePath = elbow(route[0], route[1]) + " " + elbow(route[1], route[2]).replace(/^M \S+ \S+ /, "");
  return (
    <AbsoluteFill style={{ transform: "scale(" + (1 + ramp(f, 0, 123) * 0.055) + ") translateY(" + (-ramp(f, 0, 123) * 18) + "px)" }}>
      <AbsoluteFill style={{ background: "radial-gradient(680px 460px at 50% 30%, rgba(111,123,255,0.16), rgba(7,8,13,0))" }} />
      {[0, 1].map((i) => {
        const t = ((f - i * 18) % 46) / 46;
        const r = 120 + t * 520;
        return <div key={i} style={{ position: "absolute", left: 960 - r, top: 288 - r, width: r * 2, height: r * 2, borderRadius: "50%", border: "1px solid rgba(69,227,210," + (1 - t) * 0.32 + ")" }} />;
      })}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {TREE_EDGES.map(([from, to], i) => {
          const start = at(from).depth === 0 ? 6 + i * 6 : 30 + (i - 3) * 6;
          const d = ramp(f, start, start + 16);
          return (
            <path
              key={i}
              d={elbow(from, to)}
              fill="none"
              stroke={at(from).depth === 0 ? "rgba(111,123,255,0.8)" : "rgba(140,155,255,0.55)"}
              strokeWidth="1.6"
              strokeDasharray="900"
              strokeDashoffset={900 - d * 900}
            />
          );
        })}
        <path d={routePath} fill="none" stroke={CYAN} strokeWidth="3" strokeDasharray="14 16" strokeDashoffset={-f * 3.4} opacity={ramp(f, 74, 88)} style={{ filter: "drop-shadow(0 0 10px rgba(69,227,210,0.8))" }} />
      </svg>
      {TREE.map((node, i) => (
        <Node key={node.id} node={node} start={4 + node.depth * 14 + (i % 3) * 4} />
      ))}
      {TREE.map((node, i) =>
        [0, 1].map((k) => {
          const ang = (f / 30) * (0.7 + k * 0.2) + i + k * Math.PI;
          return (
            <div
              key={node.id + k}
              style={{
                position: "absolute",
                left: node.x + Math.cos(ang) * 34 - 3,
                top: node.y + Math.sin(ang) * 22 - 3,
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: k === 0 ? CYAN : ACCENT,
                boxShadow: "0 0 12px 3px currentColor",
                opacity: ramp(f, 24 + i * 2, 40 + i * 2) * 0.9,
              }}
            />
          );
        })
      )}
      <div style={{ position: "absolute", right: 84, top: 118, fontFamily: "Consolas, ui-monospace, monospace", fontSize: 15, letterSpacing: 4.5, color: "rgba(180,192,235,0.8)", opacity: ramp(f, 18, 36) }}>
        BOARD TREE / 9 NODES
      </div>
      <div style={{ position: "absolute", left: 960 - 240, top: 782, width: 480, textAlign: "center", fontFamily: "Consolas, ui-monospace, monospace", fontSize: 14, letterSpacing: 3.4, color: "rgba(69,227,210,0.8)", opacity: ramp(f, 82, 96) }}>
        AGENT ROUTE / BOARD TO ROADMAP
      </div>
    </AbsoluteFill>
  );
};

const Learn: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", width: 1180, height: 620 }}>
        {rows.map((i) => {
          const col = i % 4;
          const row = Math.floor(i / 4);
          const s = spring({ frame: f - 3 - i * 3, fps, config: { damping: 20, stiffness: 130, mass: 0.7 } });
          const tx = col * 300;
          const ty = row * 210;
          const x = interpolate(s, [0, 1], [tx + (col - 1.5) * 260, tx]);
          const y = interpolate(s, [0, 1], [ty + (row - 1) * 260, ty]);
          const scan = ramp(f, 54 + i * 2, 68 + i * 2);
          return (
            <div key={i} style={{ position: "absolute", left: x, top: y, width: 258, height: 168, borderRadius: 12, background: "rgba(13,16,30,0.92)", border: "1px solid rgba(111,123,255," + (0.2 + scan * 0.55) + ")", boxShadow: "0 0 " + (scan * 40) + "px rgba(111,123,255,0.28), inset 0 0 0 1px rgba(255,255,255,0.02)", opacity: Math.min(1, s * 1.6), padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "Consolas, ui-monospace, monospace", fontSize: 11, letterSpacing: 2, color: "#767d9c" }}>
                <span>{"NODE " + String(i + 1).padStart(2, "0")}</span>
                <span style={{ color: scan > 0.4 ? CYAN : "#4b5170" }}>{"MEM " + Math.round(scan * 100) + "%"}</span>
              </div>
              <div style={{ height: 8, width: "78%", borderRadius: 4, background: "rgba(160,172,220," + (0.26 + scan * 0.24) + ")", marginTop: 20 }} />
              <div style={{ height: 8, width: "52%", borderRadius: 4, background: "rgba(160,172,220,0.2)", marginTop: 10 }} />
              <div style={{ position: "absolute", left: 16, right: 16, bottom: 14, height: 3, borderRadius: 2, background: "linear-gradient(90deg, " + ACCENT + ", " + CYAN + ")", opacity: scan * 0.9 }} />
            </div>
          );
        })}
        <div style={{ position: "absolute", inset: 0, opacity: ramp(f, 40, 60) * (1 - ramp(f, 96, 116)), transform: "translateY(" + interpolate(ramp(f, 40, 96), [0, 1], [-80, 700]) + "px)", height: 2, background: "linear-gradient(90deg, rgba(69,227,210,0), rgba(69,227,210,0.9), rgba(69,227,210,0))", boxShadow: "0 0 30px 6px rgba(69,227,210,0.35)" }} />
      </div>
    </AbsoluteFill>
  );
};

const Close: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mark = spring({ frame: f - 2, fps, config: { damping: 18, stiffness: 120, mass: 0.9 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      {[0, 1, 2].map((i) => {
        const t = ((f - i * 12) % 36) / 36;
        const r = 90 + t * 460;
        return <div key={i} style={{ position: "absolute", left: 960 - r, top: 470 - r, width: r * 2, height: r * 2, borderRadius: "50%", border: "1px solid rgba(111,123,255," + (1 - t) * 0.3 + ")" }} />;
      })}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: -16 }}>
        <Mark size={104} scale={0.9 + mark * 0.1} />
        <div style={{ height: 26 }} />
        <div style={{ fontFamily: "Segoe UI, Inter, system-ui, sans-serif", fontSize: 96, fontWeight: 700, letterSpacing: -3.6, color: INK, opacity: ramp(f, 10, 22), textShadow: "0 0 60px rgba(111,123,255,0.4)" }}>Xave</div>
        <div style={{ height: 22 }} />
        <div style={{ fontFamily: "Segoe UI, Inter, system-ui, sans-serif", fontSize: 34, fontWeight: 600, color: "#a9b0d4", opacity: ramp(f, 22, 36), letterSpacing: -0.2 }}>The board that thinks with you.</div>
      </div>
    </AbsoluteFill>
  );
};

export const XaveMesh: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <Grid />
      <Glows />
      <Audio src={staticFile("mesh.wav")} />
      {MESH_SCENES.map((scene) => (
        <Sequence key={scene.id} from={scene.at} durationInFrames={scene.length}>
          <Scene scene={scene} label={scene.id.toUpperCase()}>
            {scene.id === "limit" ? <Limit /> : null}
            {scene.id === "agents" ? <Agents /> : null}
            {scene.id === "move" ? <Move /> : null}
            {scene.id === "mesh" ? <Mesh /> : null}
            {scene.id === "learn" ? <Learn /> : null}
            {scene.id === "close" ? <Close /> : null}
          </Scene>
        </Sequence>
      ))}
      <Lines />
    </AbsoluteFill>
  );
};