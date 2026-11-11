// Timing for the Madarek promo (30 fps).
// These frames are placeholders until the ElevenLabs voice-over arrives;
// then they will be re-timed from the faster-whisper transcript.

export const FPS = 30;

export const SCENES = {
  hook: { from: 0, duration: 105 },
  first: { from: 105, duration: 150 },
  blended: { from: 255, duration: 180 },
  online: { from: 435, duration: 270 },
  features: { from: 705, duration: 180 },
  understand: { from: 885, duration: 105 },
  outro: { from: 990, duration: 120 },
} as const;

export const TOTAL_FRAMES = SCENES.outro.from + SCENES.outro.duration;

// Text between *stars* is highlighted.
export type Cue = { from: number; to: number; text: string };

export const CUES: Cue[] = [
  { from: 0, to: 55, text: "هلا والله!" },
  { from: 55, to: 105, text: "أنا طالب في *أكاديمية مدارك*" },
  { from: 105, to: 170, text: "تدرون إيش اللي يميّز مدارك؟" },
  { from: 170, to: 255, text: "هي *أول أكاديمية* طبّقت نظام *التعلّم المدمج*!" },
  { from: 255, to: 345, text: "يعني أدرس في الصف ويا الأستاذ والربع..." },
  { from: 345, to: 435, text: "وأكمّل دروسي من البيت عبر المنصّة" },
  { from: 435, to: 525, text: "وحتى لو صار عندي ظرف... أو رحت البلاد..." },
  { from: 525, to: 615, text: "ما عليه! أدخل الحصة *أونلاين*" },
  { from: 615, to: 705, text: "وأحضر *مباشرة* ويا زملائي" },
  { from: 705, to: 765, text: "دروس تفاعلية..." },
  { from: 765, to: 825, text: "ومتابعة أول بأول..." },
  { from: 825, to: 885, text: "وأساتذة يهتمّون بكل طالب" },
  { from: 885, to: 990, text: "في مدارك... ما بس أحفظ، أنا *أفهم*، وأبدع، وأتقدّم" },
  { from: 990, to: 1050, text: "*أكاديمية مدارك*... الأولى في التعلّم المدمج" },
  { from: 1050, to: 1110, text: "سجّل الحين، وخلّك ويانا!" },
];

export type View = "front" | "left" | "right";

// Where the student stands in each scene (x = centre, bottom = feet line).
export const CHARACTER_KEYS: {
  at: number;
  view: View;
  x: number;
  bottom: number;
  height: number;
}[] = [
  { at: 0, view: "front", x: 540, bottom: 1760, height: 1180 },
  { at: 105, view: "left", x: 800, bottom: 1840, height: 900 },
  { at: 255, view: "right", x: 280, bottom: 1840, height: 860 },
  { at: 435, view: "left", x: 850, bottom: 1860, height: 700 },
  { at: 705, view: "right", x: 250, bottom: 1840, height: 880 },
  { at: 885, view: "front", x: 540, bottom: 1880, height: 900 },
  { at: 990, view: "front", x: 540, bottom: 1860, height: 820 },
];
