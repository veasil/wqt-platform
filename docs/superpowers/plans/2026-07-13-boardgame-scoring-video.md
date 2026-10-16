# Boardgame Scoring Intro Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone 30-second expo-loop intro video for the boardgame scoring system that reuses the existing `video` pipeline without breaking the current 3-minute rules video.

**Architecture:** Keep the current `video` toolchain intact and add a second variant named `score-intro`. The new variant gets its own script manifest, audio timing JSON, Remotion composition, and render command, while sharing the same `assets`, `tts`, and `out` workflow as the existing project.

**Tech Stack:** Node.js ESM, `node:test`, Remotion 4, React 18, `edge-tts`, FFmpeg

## Global Constraints

- Video length target is `30 seconds` and must loop cleanly for expo playback.
- Core message is exactly `这是桌游的智能计分中枢`.
- Visual tone is `deep blue`, `tech/HUD`, and `structured around a center panel`.
- `伍仟天 logo` and `数智免疫力计划` must remain visible from the first second to the last.
- Narration stays in the video, but subtitles must be independently readable in a noisy expo environment.
- Reuse the existing `script.json -> TTS -> Remotion -> out` workflow pattern without overwriting the current long-form video.

---

### Task 1: Add Variant Plumbing And The 30s Script Manifest

**Files:**
- Create: `video/lib/video-variant.mjs`
- Create: `video/score-script.json`
- Create: `video/tests/video-variant.test.mjs`
- Modify: `video/tts/synth.mjs`

**Interfaces:**
- Produces: `resolveVideoVariant(name: string): { name: string; scriptPath: string; audioPath: string; compositionId: string; renderOut: string; publicDir: string }`
- Produces: `parseVariantArgs(argv: string[]): { variant: string; ids: string[]; dryRun: boolean }`
- Produces: `video/score-script.json` with `meta`, `brand`, and `scenes` entries for the `score-intro` variant
- Consumed by subsequent tasks: `resolveVideoVariant("score-intro")` from Remotion and render scripts

- [ ] **Step 1: Write the failing test**

```js
// video/tests/video-variant.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveVideoVariant, parseVariantArgs } from "../lib/video-variant.mjs";

test("score-intro resolves to dedicated manifest and composition", () => {
  const variant = resolveVideoVariant("score-intro");

  assert.equal(variant.name, "score-intro");
  assert.match(variant.scriptPath, /video[\\/]+score-script\.json$/);
  assert.match(variant.audioPath, /video[\\/]remotion[\\/]src[\\/]score-audio\.json$/);
  assert.equal(variant.compositionId, "ScoreIntro");
  assert.match(variant.renderOut, /video[\\/]out[\\/]score-intro\.mp4$/);
});

test("cli parser keeps scene ids and dry-run flag", () => {
  const parsed = parseVariantArgs(["--variant", "score-intro", "--dry-run", "score-1", "score-3"]);

  assert.equal(parsed.variant, "score-intro");
  assert.equal(parsed.dryRun, true);
  assert.deepEqual(parsed.ids, ["score-1", "score-3"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test video/tests/video-variant.test.mjs`

Expected: FAIL with `Cannot find module '../lib/video-variant.mjs'` or missing export errors.

- [ ] **Step 3: Write the minimal implementation**

```js
// video/lib/video-variant.mjs
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const VARIANTS = {
  default: {
    name: "default",
    scriptPath: resolve(ROOT, "script.json"),
    audioPath: resolve(ROOT, "remotion/src/audio.json"),
    compositionId: "Main",
    renderOut: resolve(ROOT, "out/final.mp4"),
    publicDir: resolve(ROOT, "assets"),
  },
  "score-intro": {
    name: "score-intro",
    scriptPath: resolve(ROOT, "score-script.json"),
    audioPath: resolve(ROOT, "remotion/src/score-audio.json"),
    compositionId: "ScoreIntro",
    renderOut: resolve(ROOT, "out/score-intro.mp4"),
    publicDir: resolve(ROOT, "assets"),
  },
};

export function resolveVideoVariant(name = "default") {
  return VARIANTS[name] || VARIANTS.default;
}

export function parseVariantArgs(argv) {
  const ids = [];
  let variant = "default";
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--variant") {
      variant = argv[i + 1] || "default";
      i += 1;
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    ids.push(token);
  }

  return { variant, ids, dryRun };
}
```

```json
// video/score-script.json
{
  "meta": {
    "title": "伍仟天 · 桌游智能计分中枢",
    "version": "v1",
    "fps": 30,
    "width": 1920,
    "height": 1080,
    "totalSeconds": 30,
    "voice": {
      "provider": "edge-tts",
      "name": "zh-CN-YunxiNeural",
      "style": "冷静、清晰、科技感"
    },
    "palette": {
      "bg": "#07162d",
      "cyan": "#2ad1ff",
      "line": "#66c7ff",
      "white": "#f5fbff",
      "accent": "#7ae7ff"
    }
  },
  "brand": {
    "logo": "assets/桌游logo.png",
    "programText": "数智免疫力计划"
  },
  "scenes": [
    {
      "id": "score-1",
      "start": 0,
      "duration": 6,
      "title": "桌上的每一次决策",
      "subtitle": "风险卡 / 玩家决策 / 五力变化 / 倒计时",
      "narration": "一场桌游，不只是完成一轮轮选择。",
      "tts": { "rate": "+4%", "pitch": "+0Hz" },
      "visualKey": "signalScatter"
    },
    {
      "id": "score-2",
      "start": 6,
      "duration": 8,
      "title": "这是桌游的智能计分中枢",
      "subtitle": "信息汇入同一个智能中枢",
      "narration": "它把桌上的每一次决策，实时汇入同一个智能中枢。",
      "tts": { "rate": "+5%", "pitch": "+0Hz" },
      "visualKey": "coreBoot"
    },
    {
      "id": "score-3",
      "start": 14,
      "duration": 10,
      "title": "计分 · 反馈 · 成长可视化",
      "subtitle": "实时计分 / 即时反馈 / 成长图谱",
      "narration": "实时计分，及时反馈，让每一次互动都转化为可见的成长轨迹。",
      "tts": { "rate": "+6%", "pitch": "+0Hz" },
      "visualKey": "capabilityStrip"
    },
    {
      "id": "score-4",
      "start": 24,
      "duration": 6,
      "title": "让桌游拥有可视化的智能中枢",
      "subtitle": "伍仟天 · 数智免疫力计划",
      "narration": "这就是伍仟天数智免疫力计划的桌游智能计分中枢。",
      "tts": { "rate": "+4%", "pitch": "+0Hz" },
      "visualKey": "finalLockup"
    }
  ]
}
```

```js
// video/tts/synth.mjs (key changes only)
import { resolveVideoVariant, parseVariantArgs } from "../lib/video-variant.mjs";

const { variant, ids, dryRun } = parseVariantArgs(process.argv.slice(2));
const selected = resolveVideoVariant(variant);
const script = JSON.parse(readFileSync(selected.scriptPath, "utf8"));
const audioFile = selected.audioPath;

if (dryRun) {
  console.log(JSON.stringify({
    variant: selected.name,
    scenes: script.scenes.map((scene) => scene.id),
    audioFile
  }, null, 2));
  process.exit(0);
}

const audio = existsSync(audioFile)
  ? JSON.parse(readFileSync(audioFile, "utf8"))
  : {};

writeFileSync(audioFile, JSON.stringify(audio, null, 2) + "\n");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test video/tests/video-variant.test.mjs`

Expected: PASS with `2 tests` passing.

Run: `node video/tts/synth.mjs --variant score-intro --dry-run`

Expected output contains:

```json
{
  "variant": "score-intro",
  "scenes": ["score-1", "score-2", "score-3", "score-4"]
}
```

- [ ] **Step 5: Commit**

```bash
git add video/lib/video-variant.mjs video/score-script.json video/tests/video-variant.test.mjs video/tts/synth.mjs
git commit -m "feat: add score intro video variant plumbing"
```

### Task 2: Register The ScoreIntro Composition And Timing Layout

**Files:**
- Create: `video/remotion/src/score/scoreLayout.js`
- Create: `video/remotion/src/score/ScoreIntroMain.jsx`
- Create: `video/remotion/src/score-audio.json`
- Create: `video/tests/score-layout.test.mjs`
- Modify: `video/remotion/src/Root.jsx`

**Interfaces:**
- Consumes: `resolveVideoVariant("score-intro")`
- Consumes: `video/score-script.json`
- Produces: `getScoreIntroLayout(): { fps: number; totalFrames: number; scenes: Array<{ id: string; fromFrame: number; durFrames: number; title: string; subtitle: string; narration: string; visualKey: string; captions: Array<{ t0: number; t1: number; text: string }>; hasAudio: boolean }> }`
- Produces: `ScoreIntroMain` composition component used by `Root.jsx`

- [ ] **Step 1: Write the failing test**

```js
// video/tests/score-layout.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { getScoreIntroLayout } from "../remotion/src/score/scoreLayout.js";

test("score intro layout keeps four scenes inside a 30 second window", () => {
  const { fps, totalFrames, scenes } = getScoreIntroLayout();

  assert.equal(fps, 30);
  assert.deepEqual(
    scenes.map((scene) => scene.id),
    ["score-1", "score-2", "score-3", "score-4"]
  );
  assert.ok(totalFrames >= 870, `expected >= 870 frames, got ${totalFrames}`);
  assert.ok(totalFrames <= 930, `expected <= 930 frames, got ${totalFrames}`);
  assert.equal(scenes[0].fromFrame, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test video/tests/score-layout.test.mjs`

Expected: FAIL with `Cannot find module '../remotion/src/score/scoreLayout.js'`.

- [ ] **Step 3: Write the minimal implementation**

```js
// video/remotion/src/score/scoreLayout.js
import script from "../../../score-script.json";
import audio from "../score-audio.json";

const TAIL = 0.45;

export function getScoreIntroLayout() {
  const fps = script.meta.fps;
  let cursor = 0;

  const scenes = script.scenes.map((scene) => {
    const clip = audio[scene.id];
    const durSec = clip ? clip.dur + TAIL : scene.duration;
    const fromFrame = Math.round(cursor * fps);
    const durFrames = Math.max(1, Math.round(durSec * fps));
    cursor += durSec;

    return {
      ...scene,
      fromFrame,
      durFrames,
      captions: clip?.captions || [],
      hasAudio: Boolean(clip),
    };
  });

  return {
    fps,
    totalFrames: Math.round(cursor * fps),
    scenes,
  };
}
```

```json
// video/remotion/src/score-audio.json
{}
```

```jsx
// video/remotion/src/score/ScoreIntroMain.jsx
import { AbsoluteFill, Sequence, Audio, staticFile } from "remotion";
import script from "../../../score-script.json";
import { getScoreIntroLayout } from "./scoreLayout.js";

export const ScoreIntroMain = () => {
  const { scenes } = getScoreIntroLayout();

  return (
    <AbsoluteFill style={{ backgroundColor: script.meta.palette.bg }}>
      <Audio src={staticFile("bgm.mp3")} volume={0.12} loop />
      {scenes.map((scene) => (
        <Sequence
          key={scene.id}
          from={scene.fromFrame}
          durationInFrames={scene.durFrames}
          name={scene.id}
        >
          {scene.hasAudio ? <Audio src={staticFile(`vo/${scene.id}.mp3`)} /> : null}
          <AbsoluteFill
            style={{
              color: script.meta.palette.white,
              fontFamily: "\"Microsoft YaHei\", sans-serif",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 54,
            }}
          >
            {scene.title}
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
```

```jsx
// video/remotion/src/Root.jsx (key changes only)
import { Composition } from "remotion";
import { Main } from "./Main.jsx";
import { ScoreIntroMain } from "./score/ScoreIntroMain.jsx";
import script from "../../script.json";
import scoreScript from "../../score-script.json";
import { getLayout } from "./layout.js";
import { getScoreIntroLayout } from "./score/scoreLayout.js";

const { fps, width, height } = script.meta;
const { totalFrames } = getLayout();
const scoreLayout = getScoreIntroLayout();

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="Main"
        component={Main}
        durationInFrames={totalFrames}
        fps={fps}
        width={width}
        height={height}
      />
      <Composition
        id="ScoreIntro"
        component={ScoreIntroMain}
        durationInFrames={scoreLayout.totalFrames}
        fps={scoreScript.meta.fps}
        width={scoreScript.meta.width}
        height={scoreScript.meta.height}
      />
    </>
  );
};
```

- [ ] **Step 4: Run tests to verify it passes**

Run: `node --test video/tests/score-layout.test.mjs`

Expected: PASS with `1 test` passing.

Run: `npm --prefix video/remotion run still -- --composition=ScoreIntro --frame=0 --output ../out/score-layout-smoke.png`

Expected: PASS and writes `video/out/score-layout-smoke.png` with a simple title frame.

- [ ] **Step 5: Commit**

```bash
git add video/remotion/src/score/scoreLayout.js video/remotion/src/score/ScoreIntroMain.jsx video/remotion/src/score-audio.json video/tests/score-layout.test.mjs video/remotion/src/Root.jsx
git commit -m "feat: register score intro remotion composition"
```

### Task 3: Build Structured HUD Visuals And Persistent Brand Badge

**Files:**
- Create: `video/remotion/src/score/ScoreIntroScene.jsx`
- Create: `video/remotion/src/score/ScoreIntroVisuals.jsx`
- Modify: `video/remotion/src/score/ScoreIntroMain.jsx`

**Interfaces:**
- Consumes: `scene.visualKey` values `signalScatter | coreBoot | capabilityStrip | finalLockup`
- Produces: `BrandBadge({ logoSrc, programText })`
- Produces: `ScoreIntroScene({ scene, meta, brand })`
- Produces: visual mapping object `VISUALS: Record<string, React.ComponentType>`

- [ ] **Step 1: Write the failing smoke test**

Run: `npm --prefix video/remotion run still -- --composition=ScoreIntro --frame=210 --output ../out/score-visual-smoke.png`

Expected: FAIL or render a title-only frame that does not contain persistent branding and the structured visual modules.

- [ ] **Step 2: Write the minimal implementation**

```jsx
// video/remotion/src/score/ScoreIntroVisuals.jsx
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const FONT = "\"Microsoft YaHei\", \"PingFang SC\", system-ui, sans-serif";

export function BrandBadge({ logoSrc, programText }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 34,
        left: 34,
        padding: "14px 18px 12px",
        borderRadius: 14,
        border: "1px solid rgba(102,199,255,0.55)",
        background: "linear-gradient(180deg, rgba(6,20,42,0.88), rgba(7,26,54,0.74))",
        boxShadow: "0 0 24px rgba(42,209,255,0.18)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <Img src={logoSrc} style={{ width: 142, objectFit: "contain" }} />
      <div style={{ fontFamily: FONT, color: "#cdeeff", fontSize: 22, letterSpacing: 2 }}>
        {programText}
      </div>
    </div>
  );
}

export function SignalScatter() {
  const frame = useCurrentFrame();
  const cards = [
    { label: "风险卡", x: 190, y: 220 },
    { label: "玩家决策", x: 1380, y: 250 },
    { label: "五力变化", x: 220, y: 720 },
    { label: "倒计时", x: 1450, y: 720 },
  ];

  return (
    <AbsoluteFill>
      {cards.map((card, index) => {
        const enter = spring({ frame: frame - index * 8, fps: 30, config: { damping: 18 } });
        return (
          <div
            key={card.label}
            style={{
              position: "absolute",
              left: card.x,
              top: card.y,
              width: 290,
              height: 150,
              borderRadius: 16,
              border: "1px solid rgba(102,199,255,0.45)",
              background: "rgba(12,34,63,0.74)",
              color: "#f5fbff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FONT,
              fontSize: 34,
              transform: `translateY(${(1 - enter) * 24}px) scale(${0.92 + enter * 0.08})`,
              opacity: enter,
            }}
          >
            {card.label}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

export function CoreBoot() {
  const frame = useCurrentFrame();
  const glow = interpolate(frame, [0, 45], [0.35, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width: 980,
          height: 560,
          borderRadius: 26,
          border: "2px solid rgba(42,209,255,0.6)",
          boxShadow: `0 0 ${28 * glow}px rgba(42,209,255,0.35)`,
          background: "linear-gradient(180deg, rgba(11,34,68,0.92), rgba(6,18,36,0.94))",
        }}
      />
    </AbsoluteFill>
  );
}

export function CapabilityStrip() {
  const frame = useCurrentFrame();
  const items = ["实时计分", "即时反馈", "成长可视化"];

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 28 }}>
      <div style={{ display: "flex", gap: 28 }}>
        {items.map((item, index) => {
          const enter = spring({ frame: frame - index * 10, fps: 30, config: { damping: 16 } });
          return (
            <div
              key={item}
              style={{
                width: 340,
                height: 320,
                borderRadius: 20,
                border: "1px solid rgba(122,231,255,0.5)",
                background: "rgba(10,29,56,0.82)",
                color: "#f5fbff",
                fontFamily: FONT,
                fontSize: 38,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transform: `translateY(${(1 - enter) * 30}px)`,
                opacity: enter,
              }}
            >
              {item}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

export function FinalLockup() {
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width: 1120,
          height: 620,
          borderRadius: 30,
          border: "2px solid rgba(42,209,255,0.6)",
          background: "linear-gradient(180deg, rgba(12,34,67,0.9), rgba(6,17,34,0.96))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#f5fbff",
          fontFamily: FONT,
          fontSize: 52,
          fontWeight: 800,
          textAlign: "center",
          padding: "0 140px",
        }}
      >
        让桌游拥有可视化的智能中枢
      </div>
    </AbsoluteFill>
  );
}

export function CaptionBar({ captions, fallback }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const active = captions?.find((item) => t >= item.t0 - 0.05 && t <= item.t1 + 0.18);
  const text = active?.text || fallback;

  return (
    <div style={{ position: "absolute", bottom: 62, width: "100%", display: "flex", justifyContent: "center" }}>
      <div
        style={{
          maxWidth: "78%",
          padding: "12px 28px",
          borderRadius: 14,
          background: "rgba(7,24,46,0.72)",
          color: "#f5fbff",
          fontFamily: FONT,
          fontSize: 30,
          lineHeight: 1.35,
          textAlign: "center",
        }}
      >
        {text}
      </div>
    </div>
  );
}
```

```jsx
// video/remotion/src/score/ScoreIntroScene.jsx
import { AbsoluteFill, staticFile } from "remotion";
import script from "../../../score-script.json";
import {
  BrandBadge,
  CaptionBar,
  SignalScatter,
  CoreBoot,
  CapabilityStrip,
  FinalLockup,
} from "./ScoreIntroVisuals.jsx";

const FONT = "\"Microsoft YaHei\", \"PingFang SC\", system-ui, sans-serif";

const VISUALS = {
  signalScatter: SignalScatter,
  coreBoot: CoreBoot,
  capabilityStrip: CapabilityStrip,
  finalLockup: FinalLockup,
};

export function ScoreIntroScene({ scene }) {
  const Visual = VISUALS[scene.visualKey];

  return (
    <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 40%, rgba(20,63,104,0.35), #07162d 72%)" }}>
      <BrandBadge
        logoSrc={staticFile(script.brand.logo.replace(/^assets\//, ""))}
        programText={script.brand.programText}
      />
      <Visual />
      <div style={{ position: "absolute", top: 126, width: "100%", textAlign: "center", color: "#2ad1ff", fontFamily: FONT, fontSize: 42, fontWeight: 800 }}>
        {scene.title}
      </div>
      <CaptionBar captions={scene.captions} fallback={scene.subtitle} />
    </AbsoluteFill>
  );
}
```

```jsx
// video/remotion/src/score/ScoreIntroMain.jsx (replace title-only frame)
import { AbsoluteFill, Sequence, Audio, staticFile } from "remotion";
import script from "../../../score-script.json";
import { getScoreIntroLayout } from "./scoreLayout.js";
import { ScoreIntroScene } from "./ScoreIntroScene.jsx";

export const ScoreIntroMain = () => {
  const { scenes } = getScoreIntroLayout();

  return (
    <AbsoluteFill style={{ backgroundColor: script.meta.palette.bg }}>
      <Audio src={staticFile("bgm.mp3")} volume={0.12} loop />
      {scenes.map((scene) => (
        <Sequence key={scene.id} from={scene.fromFrame} durationInFrames={scene.durFrames} name={scene.id}>
          {scene.hasAudio ? <Audio src={staticFile(`vo/${scene.id}.mp3`)} /> : null}
          <ScoreIntroScene scene={scene} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 3: Run smoke renders to verify the visuals**

Run: `npm --prefix video/remotion run still -- --composition=ScoreIntro --frame=0 --output ../out/score-frame-01.png`

Expected: PASS with top-left `伍仟天 logo` and `数智免疫力计划` visible over the scattered signal cards.

Run: `npm --prefix video/remotion run still -- --composition=ScoreIntro --frame=210 --output ../out/score-frame-02.png`

Expected: PASS with the center-panel “智能计分中枢” scene visible.

Run: `npm --prefix video/remotion run still -- --composition=ScoreIntro --frame=720 --output ../out/score-frame-03.png`

Expected: PASS with the final lockup frame and persistent brand badge.

- [ ] **Step 4: Commit**

```bash
git add video/remotion/src/score/ScoreIntroScene.jsx video/remotion/src/score/ScoreIntroVisuals.jsx video/remotion/src/score/ScoreIntroMain.jsx
git commit -m "feat: add score intro hud visuals"
```

### Task 4: Generate Narration Timings And Produce The Final Expo Loop

**Files:**
- Modify: `video/remotion/src/score-audio.json`
- Modify: `video/remotion/package.json`
- Test: `video/out/score-intro.mp4`

**Interfaces:**
- Consumes: `node video/tts/synth.mjs --variant score-intro`
- Consumes: `ScoreIntro` composition id from `Root.jsx`
- Produces: `video/remotion/src/score-audio.json` with timings for `score-1` through `score-4`
- Produces: `video/out/score-intro.mp4`

- [ ] **Step 1: Write the failing smoke check**

Run: `node -e "const fs=require('fs'); const p='video/remotion/src/score-audio.json'; const data=JSON.parse(fs.readFileSync(p,'utf8')); ['score-1','score-2','score-3','score-4'].forEach((id)=>{ if(!data[id]) throw new Error('missing '+id); });"`

Expected: FAIL with `missing score-1`.

- [ ] **Step 2: Generate narration timings**

Run: `node video/tts/synth.mjs --variant score-intro`

Expected: PASS with output lines for `score-1`, `score-2`, `score-3`, and `score-4`, plus a final line like:

```text
audio.json 已更新 (4 镜)
```

- [ ] **Step 3: Add the dedicated render command**

```json
// video/remotion/package.json (scripts block)
{
  "scripts": {
    "studio": "remotion studio --public-dir=../assets",
    "render": "remotion render Main ../out/final.mp4 --public-dir=../assets",
    "render:score": "remotion render ScoreIntro ../out/score-intro.mp4 --public-dir=../assets",
    "still": "remotion still Main ../out/still.png --public-dir=../assets"
  }
}
```

- [ ] **Step 4: Run verification and final render**

Run: `node -e "const fs=require('fs'); const p='video/remotion/src/score-audio.json'; const data=JSON.parse(fs.readFileSync(p,'utf8')); ['score-1','score-2','score-3','score-4'].forEach((id)=>{ if(!data[id]) throw new Error('missing '+id); }); console.log('ok');"`

Expected: PASS with `ok`.

Run: `npm --prefix video/remotion run render:score`

Expected: PASS and writes `video/out/score-intro.mp4`.

Run: `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 video/out/score-intro.mp4`

Expected: duration between `29` and `31` seconds.

- [ ] **Step 5: Commit**

```bash
git add video/remotion/src/score-audio.json video/remotion/package.json video/score-script.json video/lib/video-variant.mjs video/tts/synth.mjs video/remotion/src/Root.jsx video/remotion/src/score
git commit -m "feat: render score intro expo video"
```

## Self-Review

### Spec coverage

- `30 second expo loop`: covered by `Task 2` layout checks and `Task 4` ffprobe verification.
- `这是桌游的智能计分中枢`: covered by `Task 1` script copy and `Task 3` center-panel scene.
- `Deep blue, tech/HUD, center panel`: covered by `Task 3` visual components.
- `Persistent 伍仟天 logo + 数智免疫力计划`: covered by `Task 3` `BrandBadge`.
- `Narration retained, subtitles readable`: covered by `Task 1` narration copy, `Task 4` TTS timing generation, and `Task 3` `CaptionBar`.
- `Reuse existing workflow without breaking current video`: covered by `Task 1` variant plumbing and `Task 2` second composition.

### Placeholder scan

- No `TODO` / `TBD` markers remain.
- Each task includes exact files, commands, and code snippets.
- Subtitle rendering is explicitly defined in `Task 3` via `CaptionBar`, so there are no unresolved execution details in the plan.

### Type consistency

- Variant id is consistently `score-intro`.
- Composition id is consistently `ScoreIntro`.
- Audio scene ids are consistently `score-1` through `score-4`.
- Render output is consistently `video/out/score-intro.mp4`.
