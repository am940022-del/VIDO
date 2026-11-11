import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/fonts";
import { CHARACTER_KEYS, CUES, View } from "./timeline";

// Cairo (variable font, SIL OFL) is bundled locally so rendering works offline.
loadFont({ family: "Cairo", url: staticFile("fonts/Cairo-arabic.woff2"), weight: "200 1000" });
loadFont({ family: "CairoLatin", url: staticFile("fonts/Cairo-latin.woff2"), weight: "200 1000" });
export const fontFamily = "Cairo, CairoLatin, sans-serif";

export const C = {
  navy: "#0B2545",
  blue: "#134074",
  teal: "#1FA59A",
  tealLight: "#5CD6C6",
  gold: "#F2B33D",
  cream: "#FFF8E8",
  white: "#FFFFFF",
  red: "#E5484D",
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Spring from 0 to 1 starting at `delay` frames. */
export const usePop = (delay = 0, damping = 12) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping } });
};

// ---------------------------------------------------------------- background

const Star8: React.FC<{ x: number; y: number; r: number }> = ({ x, y, r }) => {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const rad = i % 2 === 0 ? r : r * 0.62;
    const a = (Math.PI / 8) * i;
    pts.push(`${x + rad * Math.cos(a)},${y + rad * Math.sin(a)}`);
  }
  return <polygon points={pts.join(" ")} fill="none" stroke={C.white} strokeWidth={3} />;
};

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const stars: React.ReactNode[] = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 6; col++) {
      stars.push(
        <Star8 key={`${row}-${col}`} x={col * 220 + (row % 2) * 110} y={row * 240} r={70} />,
      );
    }
  }
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(165deg, ${C.navy} 0%, ${C.blue} 55%, #17708A 100%)`,
      }}
    >
      <svg
        width={1080}
        height={1920}
        style={{
          position: "absolute",
          opacity: 0.06,
          translate: `0px ${-(frame * 0.6) % 240}px`,
        }}
      >
        {stars}
      </svg>
      {[
        { x: 120, y: 380, s: 520, c: C.teal },
        { x: 880, y: 1150, s: 620, c: C.gold },
        { x: 300, y: 1650, s: 480, c: C.tealLight },
      ].map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: b.x - b.s / 2 + Math.sin((frame + i * 40) / 45) * 40,
            top: b.y - b.s / 2 + Math.cos((frame + i * 30) / 55) * 40,
            width: b.s,
            height: b.s,
            borderRadius: "50%",
            background: b.c,
            opacity: 0.18,
            filter: "blur(90px)",
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- character

const RATIO: Record<View, number> = { front: 424 / 1333, right: 375 / 1333, left: 365 / 1332 };

export const Character: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  let i = 0;
  while (i + 1 < CHARACTER_KEYS.length && CHARACTER_KEYS[i + 1].at <= frame) i++;
  const cur = CHARACTER_KEYS[i];
  const prev = CHARACTER_KEYS[Math.max(0, i - 1)];
  const t = frame - cur.at;
  const p = i === 0 ? 1 : spring({ frame: t, fps, config: { damping: 16 } });

  const x = interpolate(p, [0, 1], [prev.x, cur.x]);
  const bottom = interpolate(p, [0, 1], [prev.bottom, cur.bottom]);
  const height = interpolate(p, [0, 1], [prev.height, cur.height]);

  // "Turn" between views: squash horizontally, swap image, expand.
  const turning = i > 0 && prev.view !== cur.view;
  const view = turning && t < 5 ? prev.view : cur.view;
  const squash = turning ? interpolate(t, [0, 5, 10], [1, 0.08, 1], clamp) : 1;

  const enter = spring({ frame, fps, config: { damping: 13 } });
  const bob = Math.sin(frame / 11) * 7;
  const width = height * RATIO[view];

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: x - width * 0.55,
          top: bottom - 30,
          width: width * 1.1,
          height: 60,
          borderRadius: "50%",
          background: "rgba(0,0,0,0.35)",
          filter: "blur(14px)",
          opacity: enter,
        }}
      />
      <Img
        src={staticFile(`character/${view}.png`)}
        style={{
          position: "absolute",
          left: x - width / 2,
          top: bottom - height,
          height,
          width,
          translate: `0px ${(1 - enter) * 1100 + bob}px`,
          scale: `${squash} 1`,
          rotate: `${Math.sin(frame / 19) * 0.8}deg`,
          transformOrigin: "50% 100%",
          filter: "drop-shadow(0 18px 30px rgba(0,0,0,0.35))",
        }}
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- captions

const Highlighted: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split("*").map((part, i) => (
      <span key={i} style={{ color: i % 2 === 1 ? C.gold : C.white }}>
        {part}
      </span>
    ))}
  </>
);

export const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const cue = CUES.find((c) => frame >= c.from && frame < c.to);
  if (!cue) return null;
  const local = frame - cue.from;
  const len = cue.to - cue.from;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 300 }}>
      <div
        dir="rtl"
        lang="ar"
        style={{
          fontFamily,
          fontWeight: 700,
          fontSize: 50,
          lineHeight: 1.45,
          textAlign: "center",
          maxWidth: 940,
          padding: "18px 36px",
          borderRadius: 28,
          background: "rgba(8, 24, 48, 0.78)",
          border: `2px solid rgba(255,255,255,0.12)`,
          opacity: interpolate(local, [0, 6, len - 5, len], [0, 1, 1, 0], clamp),
          translate: `0px ${interpolate(local, [0, 8], [24, 0], {
            ...clamp,
            easing: Easing.out(Easing.cubic),
          })}px`,
        }}
      >
        <Highlighted text={cue.text} />
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- brand chip

export const BrandChip: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 90 }}>
      <div
        dir="rtl"
        style={{
          fontFamily,
          fontWeight: 700,
          fontSize: 34,
          color: C.white,
          padding: "10px 30px",
          borderRadius: 999,
          background: "rgba(255,255,255,0.1)",
          border: "2px solid rgba(255,255,255,0.18)",
          opacity: interpolate(frame, [0, 10], [0, 1], clamp),
          display: "flex",
          gap: 12,
          alignItems: "center",
        }}
      >
        <span
          style={{ width: 16, height: 16, borderRadius: "50%", background: C.gold, display: "inline-block" }}
        />
        أكاديمية مدارك
      </div>
    </AbsoluteFill>
  );
};

/** Fades a scene in and out at its edges. */
export const SceneFade: React.FC<{ duration: number; children: React.ReactNode }> = ({
  duration,
  children,
}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(frame, [0, 8, duration - 8, duration], [0, 1, 1, 0], clamp),
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const Title: React.FC<{
  children: React.ReactNode;
  size?: number;
  delay?: number;
  color?: string;
  style?: React.CSSProperties;
}> = ({ children, size = 76, delay = 0, color = C.white, style }) => {
  const pop = usePop(delay, 14);
  return (
    <div
      dir="rtl"
      lang="ar"
      style={{
        fontFamily,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 1.3,
        color,
        textAlign: "center",
        opacity: pop,
        translate: `0px ${(1 - pop) * 50}px`,
        textShadow: "0 6px 24px rgba(0,0,0,0.3)",
        ...style,
      }}
    >
      {children}
    </div>
  );
};
