import React from "react";
import { C } from "./ui";

type P = { size?: number };

export const ClassroomIcon: React.FC<P> = ({ size = 200 }) => (
  <svg width={size} height={size} viewBox="0 0 200 200">
    <rect x="25" y="25" width="150" height="95" rx="10" fill={C.navy} stroke={C.white} strokeWidth="6" />
    <path d="M45 60 h55 M45 80 h85 M45 100 h40" stroke={C.tealLight} strokeWidth="7" strokeLinecap="round" />
    <circle cx="145" cy="62" r="13" fill={C.gold} />
    <rect x="30" y="145" width="60" height="14" rx="5" fill={C.white} />
    <rect x="110" y="145" width="60" height="14" rx="5" fill={C.white} />
    <path d="M40 159 v22 M80 159 v22 M120 159 v22 M160 159 v22" stroke={C.white} strokeWidth="6" />
  </svg>
);

export const LaptopIcon: React.FC<P> = ({ size = 200 }) => (
  <svg width={size} height={size} viewBox="0 0 200 200">
    <rect x="35" y="40" width="130" height="90" rx="10" fill={C.navy} stroke={C.white} strokeWidth="6" />
    <polygon points="85,65 85,105 120,85" fill={C.gold} />
    <path d="M15 140 h170 l-14 22 h-142 z" fill={C.white} />
  </svg>
);

export const HouseIcon: React.FC<P> = ({ size = 160 }) => (
  <svg width={size} height={size} viewBox="0 0 160 160">
    <polygon points="80,18 148,74 12,74" fill={C.gold} />
    <rect x="28" y="72" width="104" height="72" rx="6" fill={C.white} />
    <rect x="66" y="98" width="28" height="46" rx="4" fill={C.blue} />
    <rect x="40" y="88" width="20" height="20" rx="3" fill={C.tealLight} />
    <rect x="100" y="88" width="20" height="20" rx="3" fill={C.tealLight} />
  </svg>
);

export const SchoolIcon: React.FC<P> = ({ size = 160 }) => (
  <svg width={size} height={size} viewBox="0 0 160 160">
    <path d="M80 12 v26" stroke={C.white} strokeWidth="5" />
    <polygon points="82,12 110,20 82,28" fill={C.red} />
    <polygon points="80,38 150,72 10,72" fill={C.teal} />
    <rect x="22" y="70" width="116" height="76" rx="6" fill={C.white} />
    <rect x="68" y="104" width="24" height="42" rx="4" fill={C.blue} />
    {[34, 104].map((x) => (
      <rect key={x} x={x} y="86" width="22" height="22" rx="3" fill={C.tealLight} />
    ))}
  </svg>
);

export const CarIcon: React.FC<P> = ({ size = 130 }) => (
  <svg width={size} height={size * 0.6} viewBox="0 0 130 78">
    <path d="M14 44 l14 -26 h62 l20 26 h8 a6 6 0 0 1 6 6 v10 h-118 v-10 a6 6 0 0 1 6 -6 z" fill={C.gold} />
    <path d="M34 22 h24 v20 h-34 z M64 22 h24 l14 20 h-38 z" fill={C.cream} opacity={0.9} />
    <circle cx="34" cy="62" r="13" fill={C.navy} stroke={C.white} strokeWidth="4" />
    <circle cx="98" cy="62" r="13" fill={C.navy} stroke={C.white} strokeWidth="4" />
  </svg>
);

export const PersonSilhouette: React.FC<{ color: string; size?: number }> = ({ color, size = 150 }) => (
  <svg width={size} height={size} viewBox="0 0 150 150">
    <circle cx="75" cy="58" r="30" fill={color} />
    <path d="M22 150 a53 48 0 0 1 106 0 z" fill={color} />
  </svg>
);

export const Check: React.FC<P> = ({ size = 70 }) => (
  <svg width={size} height={size} viewBox="0 0 70 70">
    <circle cx="35" cy="35" r="33" fill={C.teal} />
    <path d="M20 36 l10 10 l20 -22" stroke={C.white} strokeWidth="7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
