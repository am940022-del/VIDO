# VIDO

## المتطلبات
- **FFmpeg**: `ffmpeg -version`
- **faster-whisper** (Python): `pip install -r requirements.txt`
- **Node.js** ≥ 20.19

## مشروع Remotion (`my-video/`)
```bash
cd my-video
npm install
npm run dev                         # Remotion Studio
npx remotion render HelloWorld out/video.mp4
```

Remotion Agent Skills مثبّتة في `my-video/.agents/skills/` ومربوطة بـ `my-video/.claude/skills`.

إن لم يكن تنزيل Chrome متاحاً، عيّن متصفحاً محلياً:
```bash
export REMOTION_BROWSER_EXECUTABLE=/path/to/chrome-headless-shell
```
