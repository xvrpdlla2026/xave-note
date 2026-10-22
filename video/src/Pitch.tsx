
import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { PITCH_SCENES, type PitchScene } from "./pitch-scenes";

const BG = "#ffffff";
const INK = "#0d1117";
const MUTE = "#5b6472";
const DIM = "#98a2b3";
const LINE = "#e3e6eb";
const WASH = "#f6f7f9";
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

const head: React.CSSProperties = { fontSize: 68, lineHeight: 1.1, letterSpacing: "-0.015em", fontWeight: 600, color: INK, margin: 0 };

const sub: React.CSSProperties = { fontSize: 23, lineHeight: 1.45, color: MUTE, marginTop: 20, maxWidth: 980 };

const Head: React.FC<{ f: number; title: string; line: string }> = ({ f, title, line }) => (
  <div style={rise(f, 4)}>
    <h1 style={head}>{title}</h1>
    <p style={sub}>{line}</p>
  </div>
);

const Mark: React.FC<{ yes: boolean }> = ({ yes }) => (
  <span style={{ width: 22, height: 22, borderRadius: 99, border: "1px solid " + (yes ? "#bfe3d5" : "#f0cfcb"), background: yes ? "#eef8f4" : "#fdf3f2", color: yes ? GREEN : RED, fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{yes ? "✓" : "✕"}</span>
);

const Item: React.FC<{ f: number; at: number; yes: boolean; text: string }> = ({ f, at, yes, text }) => (
  <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "20px 0", borderBottom: "1px solid " + LINE, ...rise(f, at) }}>
    <Mark yes={yes} />
    <span style={{ fontSize: 24, lineHeight: 1.45, color: yes ? "#1c2530" : MUTE }}>{text}</span>
  </div>
);

const Card: React.FC<{ f: number; at: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ f, at, children, style }) => (
  <div style={{ border: "1px solid " + LINE, borderRadius: 10, background: BG, boxShadow: "0 1px 2px rgba(16,24,40,0.05)", padding: 26, ...rise(f, at), ...style }}>{children}</div>
);

const Column: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ position: "absolute", left: 120, top: 296, width: 1560, ...style }}>{children}</div>
);

const Rent: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Column>
      <Head f={f} title="Right now, you rent your community." line="Skool gives you a place to gather. It does not give you the platform." />
      <div style={{ marginTop: 34 }}>
        <Item f={f} at={16} yes={false} text="Per member fees that grow every time someone joins" />
        <Item f={f} at={24} yes={false} text="Parent progress stored in someone else's dashboard" />
        <Item f={f} at={32} yes={false} text="Their brand wrapped around Dr. Tillman's method" />
        <Item f={f} at={40} yes={false} text="A ceiling you do not set, and cannot raise" />
      </div>
    </Column>
  );
};

const Own: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Column>
      <Head f={f} title="Own it instead." line="One build, on your domain, in your brand. Yours after that." />
      <div style={{ marginTop: 34 }}>
        <Item f={f} at={16} yes text="No per member fees, no pricing jumps" />
        <Item f={f} at={24} yes text="Parent data lands in your CRM, not a rented tool" />
        <Item f={f} at={32} yes text="Curriculum, tracking and automation in one place" />
        <Item f={f} at={40} yes text="Built around Dr. Tillman's methodology, not a template" />
      </div>
    </Column>
  );
};

const Paths: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Column>
      <Head f={f} title="Curriculum that sequences itself." line="Her method, turned into modules with rules." />
      <div style={{ marginTop: 34 }}>
        <Item f={f} at={16} yes text="Modules unlock in order, with prerequisites" />
        <Item f={f} at={24} yes text="Worksheets, scripts and assignments inside each one" />
        <Item f={f} at={32} yes text="Review and approval before anything publishes" />
        <Item f={f} at={40} yes text="Progress logic that follows the method exactly" />
      </div>
    </Column>
  );
};

const Track: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Column>
      <Head f={f} title="Track behaviour, not video views." line="Completion is not implementation. The platform records both." />
      <div style={{ marginTop: 34 }}>
        <Item f={f} at={16} yes={false} text="A finished video proves nothing on its own" />
        <Item f={f} at={24} yes text="Worksheets printed, scripts practised, behaviour logged" />
        <Item f={f} at={32} yes text="Each parent shows progress you can actually read" />
      </div>
      <Card f={f} at={48} style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 22 }}>
        <span style={{ ...small, color: MUTE }}>{"This week"}</span>
        <span style={{ fontSize: 19, color: "#1c2530" }}>{"8 parents ran the bedtime script"}</span>
        <span style={{ marginLeft: "auto", fontSize: 19, color: GREEN, fontWeight: 600 }}>{"+3 vs last week"}</span>
      </Card>
    </Column>
  );
};

const Flag: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Column>
      <Head f={f} title="Catch the stall before the churn." line="Quiet parents get flagged, and your team is told the same day." />
      <Card f={f} at={20} style={{ marginTop: 40, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "22px 26px", borderBottom: "1px solid " + LINE }}>
          <span style={{ fontSize: 20, fontWeight: 600, color: INK }}>{"Andrea Carter"}</span>
          <span style={{ ...small, marginLeft: 16 }}>{"Module 03"}</span>
          <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: RED, background: "#fdf3f2", border: "1px solid #f0cfcb", borderRadius: 99, padding: "5px 12px", letterSpacing: "0.08em" }}>{"FLAGGED"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", padding: "22px 26px", gap: 30 }}>
          <div>
            <div style={{ ...small }}>{"Last activity"}</div>
            <div style={{ fontSize: 20, color: "#1c2530", marginTop: 6 }}>{"6 days ago"}</div>
          </div>
          <div style={{ width: 1, height: 46, background: LINE }} />
          <div>
            <div style={{ ...small }}>{"Trigger"}</div>
            <div style={{ fontSize: 20, color: "#1c2530", marginTop: 6 }}>{"No action in 5 days"}</div>
          </div>
          <div style={{ width: 1, height: 46, background: LINE }} />
          <div>
            <div style={{ ...small }}>{"Your team"}</div>
            <div style={{ fontSize: 20, color: GREEN, marginTop: 6, fontWeight: 600 }}>{"Notified"}</div>
          </div>
        </div>
      </Card>
    </Column>
  );
};

const Dash: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Column>
      <Head f={f} title="Every parent knows the next step." line="New members never wonder where to begin." />
      <Card f={f} at={20} style={{ marginTop: 40, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "22px 26px", borderBottom: "1px solid " + LINE, display: "flex", alignItems: "center" }}>
          <span style={{ ...small }}>{"Next step"}</span>
          <span style={{ marginLeft: "auto", fontSize: 15, color: MUTE }}>{"Module 03 of 05"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", padding: "26px 26px" }}>
          <div>
            <div style={{ fontSize: 30, fontWeight: 600, color: INK }}>{"Run the bedtime script"}</div>
            <div style={{ fontSize: 18, color: MUTE, marginTop: 10 }}>{"12 minutes · due tonight"}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ width: 220, height: 8, borderRadius: 99, background: LINE }}>
              <div style={{ width: 34 + 26 * ramp(f, 40, 76) + "%", height: "100%", borderRadius: 99, background: BLUE }} />
            </div>
            <span style={{ fontSize: 17, color: MUTE, width: 96 }}>{"34% done"}</span>
          </div>
        </div>
      </Card>
    </Column>
  );
};

const Data: React.FC = () => {
  const f = useCurrentFrame();
  const tools = ["YOUR CRM", "EMAIL AND MANYCHAT", "CHECKOUT"];
  return (
    <Column>
      <Head f={f} title="Your data, in your tools." line="Everything the platform records flows where you already work." />
      <div style={{ marginTop: 40, display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ border: "1px solid " + LINE, borderRadius: 10, padding: "18px 22px", fontSize: 18, fontWeight: 600, color: INK, ...rise(f, 18) }}>{"Parent progress"}</div>
        <span style={{ fontSize: 22, color: DIM, ...rise(f, 24) }}>{"→"}</span>
        {tools.map((t, i) => (
          <React.Fragment key={t}>
            <div style={{ border: "1px solid " + LINE, borderRadius: 10, padding: "18px 22px", fontSize: 15, letterSpacing: "0.1em", fontWeight: 600, color: BLUE, ...rise(f, 30 + i * 8) }}>{t}</div>
            {i < tools.length - 1 ? <span style={{ fontSize: 18, color: DIM, ...rise(f, 34 + i * 8) }}>{"·"}</span> : null}
          </React.Fragment>
        ))}
      </div>
      <div style={{ marginTop: 34, display: "flex", gap: 40 }}>
        <div style={{ ...rise(f, 60) }}>
          <div style={{ ...small }}>{"Owned by"}</div>
          <div style={{ fontSize: 19, color: "#1c2530", marginTop: 8 }}>{"You, not a third party"}</div>
        </div>
        <div style={rise(f, 68)}>
          <div style={{ ...small }}>{"Export any time"}</div>
          <div style={{ fontSize: 19, color: "#1c2530", marginTop: 8 }}>{"CSV and API access"}</div>
        </div>
        <div style={rise(f, 76)}>
          <div style={{ ...small }}>{"No lock in"}</div>
          <div style={{ fontSize: 19, color: "#1c2530", marginTop: 8 }}>{"The code is yours"}</div>
        </div>
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

const Scene: React.FC<{ scene: PitchScene; index: number; children: React.ReactNode }> = ({ scene, index, children }) => {
  const f = useCurrentFrame();
  const edge = Math.min(1, ramp(f, 0, 7) * (1 - ramp(f, scene.length - 8, scene.length - 1)));
  return (
    <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS, color: INK, opacity: Math.min(1, edge * 1.2) }}>
      <div style={{ position: "absolute", left: 120, top: 92, ...small }}>{"Platform proposal"}</div>
      <div style={{ position: "absolute", right: 120, top: 92, ...small }}>{String(index + 1).padStart(2, "0") + " / " + String(PITCH_SCENES.length).padStart(2, "0")}</div>
      {children}
    </AbsoluteFill>
  );
};

export const XavePitch: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS, color: INK }}>
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
  </AbsoluteFill>
);

const BoardRow: React.FC<{ yes: boolean; left: string; right: string }> = ({ yes, left, right }) => (
  <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 0", borderBottom: "1px solid " + LINE }}>
    <Mark yes={yes} />
    <span style={{ fontSize: 19, lineHeight: 1.4, color: yes ? "#1c2530" : MUTE, flex: 1 }}>{left}</span>
  </div>
);

const ScopeRow: React.FC<{ n: number; title: string; text: string }> = ({ n, title, text }) => (
  <div style={{ display: "flex", gap: 16, padding: "17px 0", borderBottom: "1px solid " + LINE }}>
    <span style={{ ...small, width: 26, paddingTop: 4 }}>{String(n).padStart(2, "0")}</span>
    <div>
      <div style={{ fontSize: 19, fontWeight: 600, color: INK }}>{title}</div>
      <div style={{ fontSize: 16, color: MUTE, marginTop: 4, lineHeight: 1.4 }}>{text}</div>
    </div>
  </div>
);

export const PitchBoardOne: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS, color: INK, padding: "72px 96px", display: "flex", flexDirection: "column" }}>
    <div style={small}>{"Proposal for Purposeful Parenting"}</div>
    <div style={{ fontSize: 64, fontWeight: 600, letterSpacing: "-0.025em", marginTop: 18 }}>{"Own the platform, do not rent one."}</div>
    <div style={{ fontSize: 21, color: MUTE, marginTop: 16, maxWidth: 1180, lineHeight: 1.45 }}>{"A premium, branded learning platform for Dr. Tillman's methodology. One build, no per member fees, no ceiling."}</div>
    <div style={{ display: "flex", gap: 72, marginTop: 44 }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 12, borderBottom: "1px solid " + LINE }}>
          <span style={{ ...small, color: MUTE }}>{"Today: rented"}</span>
        </div>
        <BoardRow yes={false} left="Per member, per month, forever" right="" />
        <BoardRow yes={false} left="Parent progress in their dashboard" right="" />
        <BoardRow yes={false} left="Their brand around your method" right="" />
        <BoardRow yes={false} left="A ceiling you do not control" right="" />
        <BoardRow yes={false} left="Video completion as the only proof" right="" />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 12, borderBottom: "1px solid " + LINE }}>
          <span style={{ ...small, color: BLUE }}>{"With your own platform"}</span>
        </div>
        <BoardRow yes left="One build, no per member fee" right="" />
        <BoardRow yes left="Parent data lands in your CRM" right="" />
        <BoardRow yes left="Dr. Tillman's brand, front to back" right="" />
        <BoardRow yes left="Grows with your audience, no limit" right="" />
        <BoardRow yes left="Worksheets, scripts and behaviour tracked" right="" />
      </div>
    </div>
    <div style={{ marginTop: "auto", paddingBottom: 34 }}>
      <div style={{ fontSize: 26, color: INK, fontWeight: 600, letterSpacing: "-0.01em" }}>{"Skool rents you a community. This gives you the platform you own."}</div>
      <div style={{ fontSize: 18, color: MUTE, marginTop: 10 }}>{"Same audience, same method, no landlord. One build, then it is yours."}</div>
    </div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 24, borderTop: "1px solid " + LINE }}>
      <span style={{ fontSize: 15, color: MUTE }}>{"John Xavier Padilla, Lead Developer and AI Specialist"}</span>
      <span style={{ fontSize: 15, color: MUTE }}>{"devxave.vercel.app  ·  xvrpdlla@gmail.com  ·  0995 026 6808"}</span>
    </div>
  </AbsoluteFill>
);

export const PitchBoardTwo: React.FC = () => {
  const items = [
    ["Curriculum paths", "Sequenced modules, prerequisites and progress logic built around the method."],
    ["Implementation tracking", "Worksheets, scripts and real parent behaviour, not video completion."],
    ["Intervention triggers", "Stalled parents flagged automatically so your team steps in early."],
    ["Parent dashboards", "A clear next step, so every new member knows where to begin."],
    ["Full data ownership", "Progress and engagement flow into your CRM, not a third party."],
    ["AI assisted production", "Outlines, script drafts and lesson assembly, shorter turnaround."],
    ["White label branding", "A premium experience matching America's Supernanny."],
    ["Review and approval", "Nothing publishes unless it matches the approved methodology."],
    ["Scalable architecture", "Grows with your audience, no platform limits or pricing jumps."],
    ["Automation layer", "ManyChat, email and checkout stitched into one pipeline."],
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS, color: INK, padding: "72px 96px", display: "flex", flexDirection: "column" }}>
      <div style={small}>{"What the system covers"}</div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ fontSize: 62, fontWeight: 600, letterSpacing: "-0.025em", marginTop: 18 }}>{"Ten parts, one platform."}</div>
        <div style={{ textAlign: "right", paddingBottom: 6 }}>
          <div style={{ ...small }}>{"Investment"}</div>
          <div style={{ fontSize: 34, fontWeight: 600, color: INK, marginTop: 6 }}>{"$4,000 to $10,000"}</div>
          <div style={{ fontSize: 14, color: MUTE, marginTop: 4 }}>{"scoped to your goals"}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 64, marginTop: 52 }}>
        {[items.slice(0, 5), items.slice(5)].map((col, ci) => (
          <div key={ci} style={{ flex: 1 }}>
            {col.map((it, i) => (
              <ScopeRow key={it[0]} n={ci * 5 + i + 1} title={it[0]} text={it[1]} />
            ))}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 30 }}>
        <div style={{ fontSize: 20, color: "#1c2530" }}>{"Start with curriculum and dashboards, add tracking and automation as you grow."}</div>
        <div style={{ fontSize: 16, color: MUTE, marginTop: 8 }}>{"Scope is fixed before we build, so the range above reflects what you actually need."}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 24, borderTop: "1px solid " + LINE }}>
        <span style={{ fontSize: 15, color: MUTE }}>{"Built from scratch. You own the code and the data."}</span>
        <span style={{ fontSize: 15, color: MUTE }}>{"Book a short call: devxave.vercel.app"}</span>
      </div>
    </AbsoluteFill>
  );
};
