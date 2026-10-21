import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Backdrop, Headline, Kicker, Mark, Pill, Scene, Sub } from "./parts";

const SNAP = { damping: 200, stiffness: 190, mass: 0.7 };

const ramp = (frame: number, start: number, length = 12) =>
  interpolate(frame, [start, start + length], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
import { accent, accentDeep, font, hairline, ink, mute, soft } from "./theme";

const WX = 600;
const WY = 150;
const WW = 1240;
const IMG_H = 775;
const TEXT_X = 120;
const TEXT_W = 430;

const Window: React.FC<{ src: string; zoom?: number; label: string }> = ({
  src,
  zoom = 1,
}) => (
  <div
    style={{
      position: "absolute",
      left: WX,
      top: WY,
      width: WW,
      height: IMG_H,
      borderRadius: 18,
      background: "#ffffff",
      border: `1px solid ${hairline}`,
      boxShadow: "0 40px 90px rgba(27,27,51,0.16)",
      overflow: "hidden",
    }}
  >
    <Img
      src={staticFile(src)}
      style={{
        width: WW,
        height: IMG_H,
        objectFit: "cover",
        objectPosition: "top left",
        transform: `scale(${zoom})`,
        transformOrigin: "top left",
        display: "block",
      }}
    />
  </div>
);

const TextBlock: React.FC<{
  kicker: string;
  lines: React.ReactNode;
  sub?: string;
}> = ({ kicker, lines, sub }) => (
  <div style={{ position: "absolute", left: TEXT_X, top: 380, width: TEXT_W }}>
    <Kicker>{kicker}</Kicker>
    <Headline size={58}>{lines}</Headline>
    {sub ? <Sub size={24}>{sub}</Sub> : null}
  </div>
);

const SceneOne: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const markPop = spring({ frame: f, fps, config: SNAP, delay: 4 });
  const markIn = ramp(f, 4, 10);
  const wordIn = ramp(f, 16, 12);
  const tag = "Notes, a board and a planner.";
  const typed = Math.min(tag.length, Math.max(0, Math.round((f - 42) * 1.1)));
  const caretOn = f < 92 && Math.floor(f / 8) % 2 === 0;
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 400,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          <div
            style={{
              opacity: markIn,
              transform: `translateY(${(1 - markPop) * 24}px) scale(${0.9 + markPop * 0.1})`,
            }}
          >
            <Mark size={104} />
          </div>
          <div
            style={{
              fontFamily: font,
              fontSize: 96,
              fontWeight: 700,
              letterSpacing: -3,
              color: ink,
              opacity: wordIn,
              transform: `translateX(${(1 - wordIn) * -16}px)`,
            }}
          >
            Xave
          </div>
        </div>
        <div
          style={{
            marginTop: 30,
            fontFamily: font,
            fontSize: 40,
            fontWeight: 500,
            color: soft,
            letterSpacing: -0.6,
            height: 54,
            position: "relative",
          }}
        >
          <span style={{ visibility: "hidden" }}>{tag}</span>
          <span style={{ position: "absolute", left: 0, top: 0 }}>
            {tag.slice(0, typed)}
          </span>
          <span
            style={{
              display: "inline-block",
              width: 3,
              height: 36,
              marginLeft: 6,
              background: accent,
              opacity: caretOn ? 1 : 0,
              verticalAlign: "-4px",
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SceneNotes: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame();
  const chipPop = spring({ frame: f, fps: 30, config: SNAP, delay: 44 });
  const chip = ramp(f, 44, 12);
  return (
    <Scene duration={duration}>
      <TextBlock
        kicker="WRITE"
        lines={
          <>
            It saves
            <br />
            as you type.
          </>
        }
        sub="No save button, no drafts, nothing to remember."
      />
      <Window src="shots/notes.png" label="Week ahead" zoom={1 + f * 0.0006} />
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 760,
          opacity: chip,
          transform: `translateY(${(1 - chipPop) * 18}px)`,
        }}
      >
        <Pill tone="live">Saved</Pill>
      </div>
    </Scene>
  );
};

const SceneBoard: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame();
  return (
    <Scene duration={duration}>
      <TextBlock
        kicker="ARRANGE"
        lines={
          <>
            Cards on a
            <br />
            free canvas.
          </>
        }
        sub="Drag anything anywhere. The board remembers where it landed."
      />
      <Window src="shots/board.png" label="Board" zoom={1.06 - f * 0.0006} />
    </Scene>
  );
};

const ScenePlanner: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame();
  const cut = 58;
  const shots = [
    { src: "shots/planner.png", label: "Week", caption: ["Plan the", "week ahead."] },
    { src: "shots/planner-day.png", label: "Day", caption: ["One day,", "as a canvas."] },
    { src: "shots/planner-month.png", label: "Month", caption: ["Or zoom out", "to the month."] },
  ];
  return (
    <Scene duration={duration}>
      {shots.map((s, i) => {
        const start = i * cut;
        const local = f - start;
        if (local < 0 || local > cut + 14) return null;
        const o = interpolate(local, [0, 14], [0, 1], { extrapolateRight: "clamp" });
        const out = interpolate(local, [cut, cut + 14], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const op = i === shots.length - 1 ? o : Math.min(o, out);
        return (
          <AbsoluteFill key={s.src} style={{ opacity: op }}>
            <TextBlock
              kicker="PLAN"
              lines={
                <>
                  {s.caption[0]}
                  <br />
                  {s.caption[1]}
                </>
              }
              sub="Week, day, month and year, all on the same canvas."
            />
            <Window src={s.src} label={s.label} />
          </AbsoluteFill>
        );
      })}
    </Scene>
  );
};

const SceneSearch: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame();
  const keysPop = spring({ frame: f, fps: 30, config: SNAP, delay: 30 });
  const keys = ramp(f, 30, 12);
  return (
    <Scene duration={duration}>
      <TextBlock
        kicker="FIND"
        lines={
          <>
            Everything,
            <br />
            one keystroke.
          </>
        }
        sub="Search notes, folders, cards and templates at once."
      />
      <Window src="shots/search.png" label="Search" />
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 756,
          display: "flex",
          alignItems: "center",
          gap: 12,
          opacity: keys,
          transform: `scale(${0.92 + keysPop * 0.08})`,
          transformOrigin: "left center",
        }}
      >
        {["Ctrl", "K"].map((k) => (
          <div
            key={k}
            style={{
              minWidth: 56,
              padding: "12px 16px",
              borderRadius: 10,
              background: "#ffffff",
              border: "1px solid #dcdee9",
              boxShadow: "0 6px 16px rgba(27,27,51,0.08)",
              fontFamily: font,
              fontSize: 22,
              fontWeight: 600,
              color: "#454860",
              textAlign: "center",
            }}
          >
            {k}
          </div>
        ))}
      </div>
    </Scene>
  );
};

const SceneClaims: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pills = ["Offline", "Local only", "Open source"];
  return (
    <Scene duration={duration}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
        }}
      >
        <Headline size={78}>No account. No install.</Headline>
        <Sub size={30}>Every note stays in a file on your own computer.</Sub>
        <div style={{ display: "flex", gap: 18, marginTop: 54 }}>
          {pills.map((p, i) => {
            const pop = spring({
              frame: f,
              fps,
              config: SNAP,
              delay: 10 + i * 7,
            });
            return (
              <div
                key={p}
                style={{
                  opacity: ramp(f, 10 + i * 7, 10),
                  transform: `translateY(${(1 - pop) * 22}px)`,
                }}
              >
                <Pill>{p}</Pill>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Scene>
  );
};

const SceneClose: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const markPop = spring({ frame: f, fps, config: SNAP, delay: 2 });
  const mark = ramp(f, 2, 12);
  const urlPop = spring({ frame: f, fps, config: SNAP, delay: 18 });
  const url = ramp(f, 18, 12);
  return (
    <Scene duration={duration}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
        }}
      >
        <div style={{ opacity: mark, transform: `scale(${0.86 + markPop * 0.14})` }}>
          <Mark size={112} />
        </div>
        <div
          style={{
            fontFamily: font,
            fontSize: 84,
            fontWeight: 700,
            letterSpacing: -2.4,
            color: ink,
            marginTop: 26,
            opacity: mark,
          }}
        >
          Xave
        </div>
        <div
          style={{
            fontFamily: font,
            fontSize: 30,
            color: mute,
            marginTop: 18,
            opacity: mark,
          }}
        >
          Notes, a board and a planner.
        </div>
        <div
          style={{
            marginTop: 46,
            opacity: url,
            transform: `translateY(${(1 - urlPop) * 16}px)`,
            padding: "18px 34px",
            borderRadius: 99,
            background: "#ffffff",
            border: `1px solid ${hairline}`,
            boxShadow: "0 16px 40px rgba(27,27,51,0.10)",
            fontFamily: font,
            fontSize: 28,
            fontWeight: 600,
            color: accentDeep,
          }}
        >
          Free and open source
        </div>
        <div
          style={{
            marginTop: 22,
            fontFamily: font,
            fontSize: 22,
            color: "#9b9dae",
            opacity: url,
          }}
        >
          Yours to keep.
        </div>
      </AbsoluteFill>
    </Scene>
  );
};

const SHOTS: [number, number, React.ReactNode][] = [
  [0, 100, <SceneOne key="one" />],
  [96, 174, <SceneNotes key="notes" duration={174} />],
  [262, 178, <SceneBoard key="board" duration={178} />],
  [432, 180, <ScenePlanner key="planner" duration={180} />],
  [604, 156, <SceneSearch key="search" duration={156} />],
  [748, 80, <SceneClaims key="claims" duration={80} />],
  [828, 72, <SceneClose key="close" duration={72} />],
];

export const Xave: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#f7f8fd" }}>
    <Backdrop />
    {SHOTS.map(([from, duration, node]) => (
      <Sequence key={from} from={from} durationInFrames={duration} name={`scene-${from}`}>
        {node}
      </Sequence>
    ))}
  </AbsoluteFill>
);
