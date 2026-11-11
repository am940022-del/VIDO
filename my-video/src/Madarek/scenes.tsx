import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, fontFamily, Title, usePop } from "./ui";
import {
  CarIcon,
  Check,
  ClassroomIcon,
  HouseIcon,
  LaptopIcon,
  PersonSilhouette,
  SchoolIcon,
} from "./icons";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const abs = (left: number, top: number, extra?: React.CSSProperties): React.CSSProperties => ({
  position: "absolute",
  left,
  top,
  ...extra,
});

// ------------------------------------------------------------------ 1. hook

export const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const bubble = usePop(10, 9);
  return (
    <AbsoluteFill>
      {frame < 58 && (
        <div style={abs(250, 200, { width: 580, opacity: interpolate(frame, [48, 58], [1, 0], clamp) })}>
          <div
            dir="rtl"
            style={{
              fontFamily,
              fontWeight: 900,
              fontSize: 110,
              color: C.navy,
              background: C.white,
              borderRadius: 60,
              padding: "20px 0 30px",
              textAlign: "center",
              scale: `${bubble}`,
              boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
            }}
          >
            هلا والله!
          </div>
          <div
            style={{
              width: 0,
              height: 0,
              margin: "0 auto",
              borderLeft: "34px solid transparent",
              borderRight: "34px solid transparent",
              borderTop: `44px solid ${C.white}`,
              scale: `${bubble}`,
            }}
          />
        </div>
      )}
      <div style={abs(0, 190, { width: 1080 })}>
        <Title delay={58} size={60}>
          أنا طالب في
        </Title>
        <Title delay={64} size={120} color={C.gold}>
          أكاديمية مدارك
        </Title>
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ 2. first academy

export const FirstScene: React.FC = () => {
  const frame = useCurrentFrame();
  const badge = usePop(62, 10);
  const pill = usePop(80, 13);
  return (
    <AbsoluteFill>
      <div style={abs(60, 230, { width: 960 })}>
        <Title size={68}>
          تدرون إيش اللي يميّز <span style={{ color: C.gold }}>مدارك</span>؟
        </Title>
      </div>
      <div style={abs(80, 520, { width: 560, height: 560, scale: `${badge}` })}>
        <svg width={560} height={560} style={{ position: "absolute", rotate: `${frame * 0.6}deg` }}>
          {Array.from({ length: 24 }).map((_, i) => (
            <rect
              key={i}
              x={276}
              y={0}
              width={8}
              height={70}
              rx={4}
              fill={C.gold}
              opacity={0.55}
              transform={`rotate(${i * 15} 280 280)`}
            />
          ))}
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 80,
            borderRadius: "50%",
            background: `radial-gradient(circle at 35% 30%, #FFD77A, ${C.gold} 60%, #C98A12)`,
            boxShadow: "0 25px 60px rgba(0,0,0,0.35)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontFamily,
            color: C.navy,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 44, marginBottom: -10 }}>الأكاديمية</div>
          <div style={{ fontWeight: 900, fontSize: 116, lineHeight: 1.15 }}>الأولى</div>
        </div>
      </div>
      <div
        dir="rtl"
        style={abs(90, 1110, {
          width: 540,
          textAlign: "center",
          fontFamily,
          fontWeight: 900,
          fontSize: 54,
          color: C.white,
          background: C.teal,
          borderRadius: 999,
          padding: "14px 0 20px",
          opacity: pill,
          translate: `0px ${(1 - pill) * 40}px`,
          boxShadow: "0 16px 40px rgba(0,0,0,0.3)",
        })}
      >
        في التعلّم المدمج
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ 3. blended learning

const Card: React.FC<{ delay: number; left: number; label: string; children: React.ReactNode }> = ({
  delay,
  left,
  label,
  children,
}) => {
  const pop = usePop(delay, 12);
  return (
    <div
      style={abs(left, 300, {
        width: 400,
        height: 440,
        borderRadius: 40,
        background: "rgba(255,255,255,0.1)",
        border: "3px solid rgba(255,255,255,0.22)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        opacity: pop,
        scale: `${0.6 + pop * 0.4}`,
        boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
      })}
    >
      {children}
      <div dir="rtl" style={{ fontFamily, fontWeight: 900, fontSize: 56, color: C.white }}>
        {label}
      </div>
    </div>
  );
};

export const BlendedScene: React.FC = () => {
  const plus = usePop(100, 10);
  const result = usePop(125, 12);
  return (
    <AbsoluteFill>
      <Card delay={8} left={600} label="في الصف">
        <ClassroomIcon size={220} />
      </Card>
      <Card delay={92} left={80} label="من البيت">
        <LaptopIcon size={220} />
      </Card>
      <div
        style={abs(480, 460, {
          width: 120,
          height: 120,
          borderRadius: "50%",
          background: C.gold,
          color: C.navy,
          fontFamily,
          fontWeight: 900,
          fontSize: 100,
          lineHeight: "112px",
          textAlign: "center",
          scale: `${plus}`,
          boxShadow: "0 12px 30px rgba(0,0,0,0.3)",
        })}
      >
        +
      </div>
      <div
        dir="rtl"
        style={abs(440, 830, {
          width: 580,
          textAlign: "center",
          fontFamily,
          fontWeight: 900,
          fontSize: 66,
          color: C.navy,
          background: C.gold,
          borderRadius: 999,
          padding: "14px 0 22px",
          opacity: result,
          translate: `0px ${(1 - result) * 50}px`,
          boxShadow: "0 16px 40px rgba(0,0,0,0.3)",
        })}
      >
        = تعلّم مدمج
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ 4. attend online

const Tile: React.FC<{ delay: number; label: string; highlight?: boolean; children: React.ReactNode }> = ({
  delay,
  label,
  highlight,
  children,
}) => {
  const pop = usePop(delay, 13);
  return (
    <div
      style={{
        position: "relative",
        width: 380,
        height: 250,
        borderRadius: 22,
        overflow: "hidden",
        background: highlight ? "#1C4F7A" : "#163556",
        border: highlight ? `5px solid ${C.gold}` : "3px solid rgba(255,255,255,0.15)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        opacity: pop,
        scale: `${0.7 + 0.3 * pop}`,
      }}
    >
      {children}
      <div
        dir="rtl"
        style={{
          position: "absolute",
          right: 12,
          bottom: 10,
          fontFamily,
          fontWeight: 700,
          fontSize: 28,
          color: C.white,
          background: "rgba(0,0,0,0.45)",
          borderRadius: 12,
          padding: "2px 14px 6px",
        }}
      >
        {label}
      </div>
    </div>
  );
};

const StudentFace: React.FC = () => (
  <Img
    src={staticFile("character/front.png")}
    style={{ position: "absolute", width: 330, left: 22, top: 12 }}
  />
);

export const OnlineScene: React.FC = () => {
  const frame = useCurrentFrame();
  const partA = interpolate(frame, [82, 96], [1, 0], clamp);
  const car = interpolate(frame, [22, 80], [0, 1], { ...clamp, easing: (t) => t * t * (3 - 2 * t) });
  const laptop = usePop(92, 13);
  const house = usePop(28, 12);
  const blink = Math.floor(frame / 12) % 2 === 0 ? 1 : 0.35;

  return (
    <AbsoluteFill>
      {partA > 0 && (
        <AbsoluteFill style={{ opacity: partA }}>
          <div style={abs(40, 230, { width: 1000 })}>
            <Title size={66}>لو صار عندي ظرف...</Title>
            <Title size={66} delay={30} color={C.gold}>
              أو رحت البلاد
            </Title>
          </div>
          <div style={abs(110, 720, { width: 860, height: 0, borderTop: "8px dashed rgba(255,255,255,0.45)" })} />
          <div style={abs(820, 560)}>
            <SchoolIcon size={180} />
          </div>
          <div style={abs(80, 560, { opacity: house })}>
            <HouseIcon size={180} />
          </div>
          <div style={abs(interpolate(car, [0, 1], [700, 260]), 660, { scale: "-1 1" })}>
            <CarIcon size={150} />
          </div>
        </AbsoluteFill>
      )}

      <div style={abs(40, 190, { width: 1000 })}>
        <Title size={62} delay={100}>
          أحضر الحصة <span style={{ color: C.gold }}>أونلاين</span>
        </Title>
        <Title size={62} delay={108}>
          ويا زملائي
        </Title>
      </div>

      <div
        style={abs(60, 430, {
          width: 960,
          opacity: laptop,
          scale: `${0.75 + 0.25 * laptop}`,
          translate: `0px ${(1 - laptop) * 80}px`,
        })}
      >
        <div
          style={{
            background: "#0A1A30",
            borderRadius: "34px 34px 0 0",
            border: "10px solid #24324A",
            padding: 24,
          }}
        >
          <div
            dir="rtl"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 20,
              fontFamily,
              color: C.white,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 34 }}>حصة الرياضيات - الصف العاشر</div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: C.red,
                borderRadius: 12,
                padding: "2px 16px 6px",
                fontWeight: 900,
                fontSize: 30,
              }}
            >
              <span
                style={{ width: 14, height: 14, borderRadius: "50%", background: C.white, opacity: blink }}
              />
              مباشر
            </div>
          </div>
          <div dir="rtl" style={{ display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "center" }}>
            <Tile delay={100} label="الأستاذ">
              <PersonSilhouette color={C.gold} size={190} />
            </Tile>
            <Tile delay={112} label="أنا" highlight>
              <StudentFace />
            </Tile>
            <Tile delay={106} label="سالم">
              <PersonSilhouette color={C.tealLight} size={190} />
            </Tile>
            <Tile delay={118} label="أحمد">
              <PersonSilhouette color="#8FB3E8" size={190} />
            </Tile>
          </div>
        </div>
        <div style={{ height: 34, background: "#C9D3E0", borderRadius: "0 0 40px 40px", margin: "0 -30px" }} />
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ 5. features

const Feature: React.FC<{ delay: number; top: number; text: string }> = ({ delay, top, text }) => {
  const pop = usePop(delay, 13);
  return (
    <div
      dir="rtl"
      style={abs(380, top, {
        width: 660,
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        gap: 24,
        padding: "22px 28px",
        borderRadius: 30,
        background: "rgba(255,255,255,0.1)",
        border: "2px solid rgba(255,255,255,0.18)",
        opacity: pop,
        translate: `${(1 - pop) * 120}px 0px`,
      })}
    >
      <div style={{ scale: `${pop}` }}>
        <Check size={78} />
      </div>
      <div style={{ fontFamily, fontWeight: 900, fontSize: 40, color: C.white, lineHeight: 1.3 }}>{text}</div>
    </div>
  );
};

export const FeaturesScene: React.FC = () => (
  <AbsoluteFill>
    <div style={abs(380, 250, { width: 670 })}>
      <Title size={84} style={{ textAlign: "right" }}>
        ليش <span style={{ color: C.gold }}>مدارك</span>؟
      </Title>
    </div>
    <Feature delay={6} top={480} text="دروس تفاعلية" />
    <Feature delay={64} top={660} text="متابعة أول بأول" />
    <Feature delay={124} top={840} text="أساتذة يهتمّون بكل طالب" />
  </AbsoluteFill>
);

// ------------------------------------------------------------------ 6. understand

export const UnderstandScene: React.FC = () => {
  const frame = useCurrentFrame();
  const strike = interpolate(frame, [14, 30], [0, 100], clamp);
  const words = [
    { w: "أفهم", d: 34, c: C.gold },
    { w: "أبدع", d: 52, c: C.tealLight },
    { w: "أتقدّم", d: 70, c: C.white },
  ];
  return (
    <AbsoluteFill>
      <div style={abs(0, 250, { width: 1080, display: "flex", justifyContent: "center" })}>
        <div style={{ position: "relative" }}>
          <Title size={70} color="rgba(255,255,255,0.75)">
            ما بس أحفظ
          </Title>
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "52%",
              height: 9,
              width: `${strike}%`,
              borderRadius: 6,
              background: C.red,
            }}
          />
        </div>
      </div>
      <div
        dir="rtl"
        style={abs(0, 470, { width: 1080, display: "flex", justifyContent: "center", gap: 34 })}
      >
        {words.map(({ w, d, c }) => (
          <Word key={w} word={w} delay={d} color={c} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Word: React.FC<{ word: string; delay: number; color: string }> = ({ word, delay, color }) => {
  const pop = usePop(delay, 8);
  return (
    <div
      style={{
        fontFamily,
        fontWeight: 900,
        fontSize: 104,
        color: C.navy,
        background: color,
        borderRadius: 34,
        padding: "6px 30px 22px",
        scale: `${pop}`,
        rotate: `${(1 - pop) * -12}deg`,
        boxShadow: "0 18px 40px rgba(0,0,0,0.3)",
      }}
    >
      {word}
    </div>
  );
};

// ------------------------------------------------------------------ 7. outro

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const logo = usePop(4, 10);
  const cta = usePop(60, 10);
  const pulse = 1 + Math.sin(frame / 5) * 0.035;
  return (
    <AbsoluteFill>
      <div style={abs(0, 150, { width: 1080, display: "flex", flexDirection: "column", alignItems: "center" })}>
        <div
          style={{
            width: 150,
            height: 150,
            borderRadius: 40,
            background: `linear-gradient(140deg, ${C.gold}, #E08E0B)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            scale: `${logo}`,
            rotate: `${(1 - logo) * 90}deg`,
            boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
            fontFamily,
            fontWeight: 900,
            fontSize: 100,
            color: C.navy,
          }}
        >
          م
        </div>
        <Title delay={10} size={50} style={{ marginTop: 18 }}>
          أكاديمية
        </Title>
        <Title delay={14} size={150} color={C.gold} style={{ lineHeight: 1.05 }}>
          مدارك
        </Title>
        <Title delay={24} size={50} style={{ marginTop: 16 }}>
          الأولى في التعلّم المدمج
        </Title>
        <div
          dir="rtl"
          style={{
            marginTop: 40,
            fontFamily,
            fontWeight: 900,
            fontSize: 64,
            color: C.white,
            background: C.teal,
            borderRadius: 999,
            padding: "14px 70px 24px",
            border: `4px solid ${C.tealLight}`,
            scale: `${cta * (frame > 75 ? pulse : 1)}`,
            boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
          }}
        >
          سجّل الحين
        </div>
      </div>
    </AbsoluteFill>
  );
};
