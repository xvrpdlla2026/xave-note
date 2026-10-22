
import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { PITCH_SCENES, type PitchScene } from "./pitch-scenes";

const BG = "#ffffff";
const INK = "#0d1117";
const MUTE = "#5b6472";
const DIM = "#98a2b3";
const LINE = "#e3e6eb";
const BLUE = "#1a56db";
const GREEN = "#0f7b5a";
const RED = "#b42318";
const SANS = '"Segoe UI", Inter, system-ui, sans-serif';
const cell = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ramp = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], cell);

const rise = (f: number, at: number): React.CSSProperties => {
  const e = ramp(f, at, at + 9);
  return { opacity: e, transform: "translateY(" + interpolate(e, [0, 1], [12, 0]) + "px)" };
};

const small: React.CSSProperties = { fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: DIM, fontWeight: 600 };
const head: React.CSSProperties = { fontSize: 64, lineHeight: 1.1, letterSpacing: "-0.02em", fontWeight: 600, color: INK, margin: 0 };
const sub: React.CSSProperties = { fontSize: 23, lineHeight: 1.45, color: MUTE, marginTop: 20, maxWidth: 1200 };

type Group = { title: string; note: string; bullets: string[] };

const GROUPS: Group[] = [
  {
    title: "Platform and branding",
    note: "Her name on the product. No logo of ours anywhere.",
    bullets: [
      "100% white-label platform matching Dr. Tillman's premium authority",
      "Zero per-member fees and no platform ceilings",
    ],
  },
  {
    title: "Curriculum and student experience",
    note: "Every parent follows the same path, in the right order.",
    bullets: [
      "Custom learning paths and step-by-step sequencing",
      "Parent dashboards with personalized next steps",
    ],
  },
  {
    title: "Tracking and retention",
    note: "You see who is working the method, and who has gone quiet.",
    bullets: [
      "Action-based implementation tracking (worksheets, not just videos)",
      "Automated early-warning triggers for stalled students",
    ],
  },
  {
    title: "Native tools, replacing third-party subscriptions",
    note: "One platform instead of a stack of monthly subscriptions.",
    bullets: [
      "Built-in chat and community messaging (replaces ManyChat)",
      "Integrated email marketing and notifications",
      "Native checkout and subscription management",
    ],
  },
  {
    title: "Operations and data",
    note: "Your team runs it, and your data stays yours.",
    bullets: [
      "Built-in review and approval workflows before publishing",
      "AI-assisted content production to speed up lesson creation",
      "100% data ownership with native CRM integration",
    ],
  },
];

const Mark: React.FC<{ yes?: boolean }> = ({ yes }) => (
  <span style={{ width: 22, height: 22, borderRadius: 99, border: "1px solid " + (yes ? "#bfe3d5" : "#f0cfcb"), background: yes ? "#eef8f4" : "#fdf3f2", color: yes ? GREEN : RED, fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 3 }}>{yes ? "✓" : "✕"}</span>
);

const Item: React.FC<{ f: number; at: number; yes?: boolean; text: string }> = ({ f, at, yes, text }) => (
  <div style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "20px 0", borderBottom: "1px solid " + LINE, ...rise(f, at) }}>
    <Mark yes={yes} />
    <span style={{ fontSize: 26, lineHeight: 1.4, color: yes ? "#1c2530" : MUTE }}>{text}</span>
  </div>
);

const Head: React.FC<{ f: number; title: string; line: string }> = ({ f, title, line }) => (
  <div style={rise(f, 4)}>
    <h1 style={head}>{title}</h1>
    <p style={sub}>{line}</p>
  </div>
);

const Column: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ position: "absolute", left: 120, top: 250, width: 1580, ...style }}>{children}</div>
);

const Rent: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Column>
      <Head f={f} title="Right now, you rent your community." line="Skool gives you a place to gather. It does not give you the platform." />
      <div style={{ marginTop: 30 }}>
        <Item f={f} at={16} text="Per member fees that grow every time someone joins" />
        <Item f={f} at={24} text="Parent progress stored in someone else's dashboard" />
        <Item f={f} at={32} text="Their brand wrapped around Dr. Tillman's method" />
      </div>
    </Column>
  );
};

const Own: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Column>
      <Head f={f} title="So this is the proposal." line="Five groups, replacing what you rent today with what you own." />
      <div style={{ marginTop: 36, width: 1320 }}>
        {GROUPS.map((g, i) => (
          <div key={g.title} style={{ display: "flex", alignItems: "baseline", gap: 24, padding: "16px 0", borderBottom: "1px solid " + LINE, ...rise(f, 14 + i * 8) }}>
            <span style={{ ...small, color: BLUE, width: 34 }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{ fontSize: 27, color: "#1c2530" }}>{g.title}</span>
            <span style={{ marginLeft: "auto", fontSize: 18, color: DIM }}>{g.note}</span>
          </div>
        ))}
      </div>
    </Column>
  );
};

const GroupSlide: React.FC<{ index: number }> = ({ index }) => {
  const f = useCurrentFrame();
  const group = GROUPS[index];
  return (
    <Column>
      <div style={{ ...rise(f, 4) }}>
        <div style={{ ...small, color: BLUE }}>{"Group " + String(index + 1).padStart(2, "0") + " of 05"}</div>
        <h1 style={{ ...head, marginTop: 16 }}>{group.title}</h1>
      </div>
      <div style={{ marginTop: 34 }}>
        {group.bullets.map((b, i) => (
          <Item key={b} f={f} at={20 + i * 11} yes text={b} />
        ))}
      </div>
      <div style={{ marginTop: 44, paddingTop: 22, borderTop: "1px solid " + LINE, ...rise(f, 52 + group.bullets.length * 11) }}>
        <div style={{ ...small }}>{"Why it matters"}</div>
        <div style={{ fontSize: 26, color: "#1c2530", marginTop: 10 }}>{group.note}</div>
      </div>
    </Column>
  );
};

const Close: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 76, fontWeight: 600, letterSpacing: "-0.03em", color: INK, ...rise(f, 6) }}>{"Own the platform."}</div>
        <div style={{ fontSize: 22, color: MUTE, marginTop: 18, ...rise(f, 16) }}>{"Purposeful Parenting, built once, yours after that."}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginTop: 44, ...rise(f, 40) }}>
          <span style={{ fontSize: 34, fontWeight: 600, color: INK }}>{"$4,000 to $10,000"}</span>
          <span style={{ fontSize: 17, color: MUTE }}>{"scoped to your goals"}</span>
        </div>
        <div style={{ fontSize: 17, color: MUTE, marginTop: 22, ...rise(f, 60) }}>{"Book a short call: devxave.vercel.app  ·  xvrpdlla@gmail.com  ·  0995 026 6808"}</div>
      </div>
    </AbsoluteFill>
  );
};

const Steps: React.FC<{ active: number }> = ({ active }) => (
  <div style={{ position: "absolute", left: 120, bottom: 84, display: "flex", gap: 10 }}>
    {GROUPS.map((g, i) => (
      <div key={g.title} style={{ width: i === active ? 96 : 54, height: 6, borderRadius: 99, background: i <= active ? BLUE : LINE, opacity: i <= active ? 1 : 0.9 }} />
    ))}
  </div>
);

const Scene: React.FC<{ scene: PitchScene; label: string; step: number | null; children: React.ReactNode }> = ({ scene, label, step, children }) => {
  const f = useCurrentFrame();
  const edge = Math.min(1, ramp(f, 0, 7) * (1 - ramp(f, scene.length - 8, scene.length - 1)));
  return (
    <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS, color: INK, opacity: Math.min(1, edge * 1.2) }}>
      <div style={{ position: "absolute", left: 120, top: 88, ...small }}>{"Platform proposal"}</div>
      <div style={{ position: "absolute", right: 120, top: 88, ...small }}>{label}</div>
      {children}
      {step === null ? null : <Steps active={step} />}
    </AbsoluteFill>
  );
};

export const XavePitch: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS, color: INK }}>
    <Audio src={staticFile("pitch.wav")} />
    {PITCH_SCENES.map((scene) => {
      const group = /^g([1-5])$/.exec(scene.id);
      const index = group ? Number(group[1]) - 1 : null;
      return (
        <Sequence key={scene.id} from={scene.at} durationInFrames={scene.length}>
          <Scene scene={scene} label={index === null ? (scene.id === "rent" || scene.id === "own" ? "Intro" : "") : "Group " + String(index + 1).padStart(2, "0") + " of 05"} step={index}>
            {scene.id === "rent" ? <Rent /> : null}
            {scene.id === "own" ? <Own /> : null}
            {index !== null ? <GroupSlide index={index} /> : null}
            {scene.id === "close" ? <Close /> : null}
          </Scene>
        </Sequence>
      );
    })}
  </AbsoluteFill>
);

export const PitchBoardOne: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS, color: INK, padding: "72px 96px", display: "flex", flexDirection: "column" }}>
    <div style={small}>{"Proposal for Purposeful Parenting"}</div>
    <div style={{ fontSize: 64, fontWeight: 600, letterSpacing: "-0.025em", marginTop: 18 }}>{"Own the platform, do not rent one."}</div>
    <div style={{ fontSize: 21, color: MUTE, marginTop: 16, maxWidth: 1180, lineHeight: 1.45 }}>{"A premium, branded learning platform for Dr. Tillman's methodology. One build, no per member fees, no ceiling."}</div>
    <div style={{ display: "flex", gap: 72, marginTop: 44 }}>
      {[
        { label: "Today: rented", color: MUTE, yes: false, rows: ["Per member, per month, forever", "Parent progress in their dashboard", "Their brand around your method", "A ceiling you do not control", "Video completion as the only proof"] },
        { label: "With your own platform", color: BLUE, yes: true, rows: ["One build, no per member fee", "Parent data lands in your CRM", "Dr. Tillman's brand, front to back", "Grows with your audience, no limit", "Worksheets, scripts and behaviour tracked"] },
      ].map((col) => (
        <div key={col.label} style={{ flex: 1 }}>
          <div style={{ paddingBottom: 12, borderBottom: "1px solid " + LINE }}>
            <span style={{ ...small, color: col.color }}>{col.label}</span>
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

export const PitchBoardTwo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS, color: INK, padding: "72px 96px", display: "flex", flexDirection: "column" }}>
    <div style={small}>{"What the system covers"}</div>
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
      <div style={{ fontSize: 62, fontWeight: 600, letterSpacing: "-0.025em", marginTop: 18 }}>{"Five groups, one platform."}</div>
      <div style={{ textAlign: "right", paddingBottom: 6 }}>
        <div style={{ ...small }}>{"Investment"}</div>
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
                <span style={{ ...small, color: BLUE }}>{String(ci * 3 + i + 1).padStart(2, "0")}</span>
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
