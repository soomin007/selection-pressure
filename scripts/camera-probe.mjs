// 카메라 떨림 계측 · 「시대가 갈수록 카메라가 어정쩡하게 움찔거린다」(2026-08-10 폰 실기 제보)를
// 눈이 아니라 **좌표로** 잰다. 실제 게임을 playwright 로 띄우고 매 프레임 카메라 중심을 받아
// ① 떨림(연속 프레임 사이 이동 방향이 뒤집히는 횟수) ② 이동량 분포를 낸다.
//
// 사용: node scripts/camera-probe.mjs            (기본 네 장면)
//       node scripts/camera-probe.mjs step3-x3   (장면 하나만)
//       CAM_PORT=5183 CAM_MS=30000 CAM_DUMP=<디렉터리> node scripts/camera-probe.mjs
//
// 무엇을 견주나 — 사용자가 지목한 두 조건을 **따로** 떼어 본다(장면 정의는 아래 SCENES).
//
// 왜 클램프 뒤의 값을 재나: 눈이 보는 것은 월드 밖으로 안 나가게 **잘린** 카메라다. main 의
// camX/camY 를 재면 맵 가장자리에서 「값은 흔들리는데 화면은 멀쩡한」 가짜 떨림이 잡힌다.
// 그래서 표본은 `view.cameraCenter()`(worldView) 한 곳에서만 나온다(`?camprobe`).
//
// 단위: **화면 px**. 카메라 중심은 월드 좌표라 배율(zoom)을 곱해야 눈이 보는 이동량이 된다.
// 그리고 논리 화면(540 폭)이 실제 폰 화면(390 폭)으로 축소되므로 그 비율(fit)도 곱한다.
//
// ── 2026-08-10 실측 결과 (폰 390x844 · 60fps · 시드 camjitter · 같은 궤적 위 A/B) ─────────────
// 이 세 줄이 `src/main.ts` 의 카메라 상수 셋(LEAD_CAM_EASE·CAM_FOCUS_SMOOTH·CAM_DEADZONE)의 근거다.
//
//   장면            떨림/초(1프레임)   가속도 잡음 평균 · p95     잔떨림 RMS      카메라↔초점
//   step3-x1        0.22 → 0          0.048 → 0.008 · 0.13 → 0.03   0.27 → 0.09px   2 → 18px
//   step3-x3        0.94 → 0          0.129 → 0.030 · 0.27 → 0.08   0.48 → 0.22px   5 → 22px
//   step3-x3-jank   1.19 → 0          0.206 → 0.076 · 1.13 → 0.21   0.49 → 0.23px   5 → 22px
//
// 무엇이 원인이었나(후보 셋을 다 확인했다):
//   ① **목표점이 떤다** — 주범. 무리 초점(world.playerFocus)의 이동 방향이 초당 4.2회(1배속) ~
//      10.4회(3배속) 뒤집혔고, 카메라는 그 경로의 90~93%(경로비)를 그대로 베끼고 있었다 =
//      저역통과가 사실상 없었다. → 목표점 평활 + 데드존.
//   ② **프레임률 보정이 근사식** — 부차. `min(1, dt·ease)` 는 dt 가 길수록 과다 보정(33ms +16%,
//      50ms +24%)이라 프레임 시간이 흔들리는 폰에서 튐 크기가 프레임마다 달라졌다. → 지수식.
//   ③ **sim 스텝 양자화(계단 걸음)** — **주범이 아니었다.** 스텝이 넘어간 프레임과 그 사이 프레임의
//      평균 이동 비가 1.07~1.08배에 그쳤다(고친 뒤 1.01). 후보에서 뺀다.
//
// 그리고 **맵 크기가 문지기다**: 진도 0(맵 = 화면)에서는 카메라가 클램프에 붙어 이동량이 문자 그대로
// 0 이었다. 제보의 「맵도 넓어지니까」가 여기서 확인된다 — 넓어지는 순간부터 떨림이 시작된다.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PORT = Number(process.env.CAM_PORT ?? 5183);
const BASE = `http://localhost:${PORT}/`;
const PHONE = { width: 390, height: 844 };
// 같은 세계를 매번 재도록 시드를 고정한다 · 안 고정하면 장면끼리 견줄 수가 없다.
const SEED = process.env.CAM_SEED ?? "camjitter";
const META_KEY = "selpress_meta_v1";
// 3배속 장면은 드래프트가 자주 열려 「세계가 도는 프레임」이 절반 아래로 줄어든다 → 넉넉히 잡는다.
const RECORD_MS = Number(process.env.CAM_MS ?? 30000);

// 「개체가 활발해진다」를 무엇으로 만드나:
//  · `?ovhook` 의 `setEra` 는 **쓸모가 없었다.** 상한·압력만 갈아 끼울 뿐 개체를 빠르게 만들지
//    못해서, 시대 1 과 시대 5 의 떨림·이동량이 소수점 셋째 자리까지 같게 나왔다(실측).
//  · 대신 **게임에 원래 있는 배속 버튼(1·2·3x)** 을 쓴다. 3x 면 벽시계 1초에 개체가 3배 움직인다 =
//    후반 시대에 속도 형질이 오르고 무리가 커진 상태와 화면에서 같은 뜻이다. 사람이 실제로 누르는
//    버튼이라 「존재하지 않는 세계」를 재는 것도 아니다.
const SCENES = [
  { name: "step0", runs: 0, speed: 1, cpu: 1, note: "진도 0 · 맵 1.0배 · 1배속 (기준선)" },
  { name: "step3-x1", runs: 3, speed: 1, cpu: 1, note: "진도 3 · 맵 2.0배 · 1배속 (맵만 넓어졌을 때)" },
  { name: "step3-x3", runs: 3, speed: 3, cpu: 1, note: "진도 3 · 맵 2.0배 · 3배속 (넓은 맵 + 활발한 개체 = 제보 상황)" },
  { name: "step3-x3-jank", runs: 3, speed: 3, cpu: 4, note: "위와 같음 + CPU 4배 감속(프레임이 흔들리는 폰)" },
];
// ⚠ 여기 있던 「3분 실제 진행」 장면을 지웠다. 자동으로 카드를 고르는 종은 판을 오래 못 버텨서,
//    3분 중 실제로 세계가 도는 시간이 실행마다 3분에서 0초까지 널뛰었다(한 번은 0프레임을 재고도
//    표를 멀쩡히 찍었다). **재는 시간이 실행마다 다른 자는 자가 아니다.** 시대별 비교가 필요하면
//    배속 장면(위)으로 대신하고, 진짜 후반 판은 사람이 굴린 화면으로 본다.

// 세계가 도는 프레임이 이보다 적으면 그 장면은 「못 잰 것」이다 · 조용히 0 을 찍는 표가 가장 위험하다.
const MIN_FRAMES = 120;

function waitFor(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve(true);
      } catch {
        // 아직 안 뜸
      }
      if (Date.now() - t0 > timeoutMs) return reject(new Error("vite dev 서버 대기 시간 초과"));
      setTimeout(tick, 300);
    };
    tick();
  });
}

/** 로비 → 관전 화면. 드래프트가 열려 있으면 첫 카드를 골라 닫는다(게임이 실제로 가는 길 그대로). */
async function toWatch(page) {
  // force 로 누르는 이유: 시작 화면은 애니메이션이 도는 캔버스 위에 얹혀 있어 「안정될 때까지」
  // 기다리는 기본 판정이 폰 폭에서 자주 타임아웃난다. 좌표는 맞으므로 곧장 누른다.
  await page.getByRole("button", { name: "게임 시작" }).first().click({ force: true });
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /사냥꾼/ }).first().click({ force: true });
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /이 종으로 시작/ }).first().click({ force: true });
  await page.waitForTimeout(2500);
}

/**
 * 기록 중에도 관전 화면을 유지한다 — **카메라가 멈추면 표본이 죽는다.**
 *
 * ⚠ 드래프트만 넘기면 모자란다(실제로 겪었다): 자동으로 첫 카드만 고르는 종은 3분을 못 버티고,
 * 30초쯤에 멸종해 결과 화면이 뜬다. 그때부터 `game.update` 가 첫 줄에서 빠져 카메라가 통째로
 * 얼어붙고, 표본 여섯 창 중 다섯이 「이동 0」으로 채워졌다 = 3분을 재고도 30초만 잰 것.
 * 그래서 런이 끝나면 새 혈통으로 다시 시작해 계속 굴린다.
 */
async function keepWatching(page, untilMs) {
  const t0 = Date.now();
  const tryClick = async (loc) => {
    try {
      const el = page.locator(loc).first();
      if (await el.isVisible({ timeout: 150 })) {
        await el.click({ timeout: 1200, force: true });
        return true;
      }
    } catch {
      // 그 화면이 아니다 — 정상
    }
    return false;
  };
  while (Date.now() - t0 < untilMs) {
    if (!(await tryClick(".draft-card"))) {
      // 런 종료(결과·진척도) → 새 혈통으로 다시 시작해 관전으로 돌아간다.
      if (await tryClick("button:has-text('새 혈통으로 시작')")) {
        await page.waitForTimeout(500);
        await tryClick("button:has-text('사냥꾼')");
        await page.waitForTimeout(400);
        await tryClick("button:has-text('이 종으로 시작')");
        await page.waitForTimeout(1200);
      } else if (await tryClick("button:has-text('다음 시대로')")) {
        await page.waitForTimeout(700);
      }
    }
    await page.waitForTimeout(400);
  }
}

const quantile = (sorted, q) => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
};

/**
 * 표본 → 숫자. 모든 길이는 **화면 px**(월드 이동량 × zoom × fit).
 *
 * 떨림(reversal)의 정의: 축마다 따로 본다. 연속한 두 프레임의 이동 부호가 서로 반대이고
 * 둘 다 아주 작지 않은(> 0.02px) 경우를 한 번으로 센다. 초당 횟수로 환산해 프레임률과 무관하게 견준다.
 * 부호가 계속 뒤집히는 것이 곧 「제자리에서 떤다」이고, 한 방향으로 꾸준히 미는 추종은 0 에 가깝다.
 */
function analyze(all, fit) {
  // 세계가 도는 프레임만 남긴다 · 드래프트·결과 화면에서는 sim 이 멈춰 카메라도 정지하는데,
  // 그 프레임을 「안 떨렸다」로 세면 3배속에서 절반이 0 으로 채워져 떨림이 실제보다 낮게 나온다.
  const samples = all.filter((s) => s.w);
  const cam = { rev: 0, moves: [] };
  const tgt = { rev: 0, moves: [] };
  let prevCam = null;
  let prevTgt = null;
  const dts = [];
  // 프레임 단위 이동 벡터 — 아래에서 「가속도 잡음」과 시간창별 떨림을 다시 낸다.
  const dxs = [];
  const dys = [];
  // 보간 위상(alpha)별 카메라 이동량 — 목표가 sim 스텝마다만 갱신되면 스텝 직후에 몰린다.
  const byPhase = [0, 0, 0, 0].map(() => ({ n: 0, sum: 0 }));
  const EPS = 0.02;
  // sim 스텝이 방금 넘어간 프레임(보간 위상이 되감긴 프레임)과 그 밖의 프레임을 갈라 센다 —
  // 앞쪽만 크면 카메라가 「매끄럽게」가 아니라 **계단으로** 가고 있다는 뜻이다.
  const onStep = { n: 0, sum: 0 };
  const between = { n: 0, sum: 0 };
  for (let i = 1; i < samples.length; i++) {
    const p = samples[i - 1];
    const s = samples[i];
    // 표본이 끊긴 자리(드래프트를 지나 새 세계로 스냅한 구간)는 이동으로 세지 않는다.
    if (s.t - p.t > 100) continue;
    const k = s.z * fit;
    const dx = (s.x - p.x) * k;
    const dy = (s.y - p.y) * k;
    const tdx = (s.tx - p.tx) * k;
    const tdy = (s.ty - p.ty) * k;
    dts.push(s.dt);
    dxs.push(dx);
    dys.push(dy);
    cam.moves.push(Math.hypot(dx, dy));
    tgt.moves.push(Math.hypot(tdx, tdy));
    const ph = Math.min(3, Math.max(0, Math.floor(s.a * 4)));
    byPhase[ph].n += 1;
    byPhase[ph].sum += Math.hypot(dx, dy);
    const bucket = s.a < p.a ? onStep : between; // 위상이 되감겼다 = 이 프레임에 sim 이 한 스텝 이상 갔다
    bucket.n += 1;
    bucket.sum += Math.hypot(dx, dy);
    if (prevCam) {
      if (Math.abs(dx) > EPS && Math.abs(prevCam.dx) > EPS && Math.sign(dx) !== Math.sign(prevCam.dx)) cam.rev += 1;
      if (Math.abs(dy) > EPS && Math.abs(prevCam.dy) > EPS && Math.sign(dy) !== Math.sign(prevCam.dy)) cam.rev += 1;
    }
    if (prevTgt) {
      if (Math.abs(tdx) > EPS && Math.abs(prevTgt.dx) > EPS && Math.sign(tdx) !== Math.sign(prevTgt.dx)) tgt.rev += 1;
      if (Math.abs(tdy) > EPS && Math.abs(prevTgt.dy) > EPS && Math.sign(tdy) !== Math.sign(prevTgt.dy)) tgt.rev += 1;
    }
    prevCam = { dx, dy };
    prevTgt = { dx: tdx, dy: tdy };
  }
  const secs = samples.length > 1 ? (samples[samples.length - 1].t - samples[0].t) / 1000 : 0;
  // ── 눈이 보는 시간 규모로 다시 잰다 ────────────────────────────────────────────────
  // 프레임 하나(16ms)짜리 방향 뒤집힘은 지수 평활이 거의 다 먹어 0 에 가깝게 나온다. 그런데 눈은
  // 50~200ms 를 뭉쳐 본다 — 「움찔」은 그 규모에서 일어나는 **속도의 급변**이다. 그래서 둘을 더 잰다:
  //   · 창(window)별 떨림 · 프레임을 n개씩 묶어 합친 이동의 방향이 뒤집히는 횟수(초당)
  //   · 가속도 잡음 · 연속 프레임 이동 벡터의 차이 |Δᵢ − Δᵢ₋₁| 평균(px/프레임²) = 속도가 얼마나 튀는가
  const revInWindow = (n) => {
    let r = 0;
    let prevX = 0;
    let prevY = 0;
    for (let i = 0; i + n <= dxs.length; i += n) {
      let sx = 0;
      let sy = 0;
      for (let j = i; j < i + n; j++) {
        sx += dxs[j];
        sy += dys[j];
      }
      if (i > 0) {
        if (Math.abs(sx) > EPS && Math.abs(prevX) > EPS && Math.sign(sx) !== Math.sign(prevX)) r += 1;
        if (Math.abs(sy) > EPS && Math.abs(prevY) > EPS && Math.sign(sy) !== Math.sign(prevY)) r += 1;
      }
      prevX = sx;
      prevY = sy;
    }
    return +(r / Math.max(0.001, secs)).toFixed(2);
  };
  const jerks = [];
  for (let i = 1; i < dxs.length; i++) jerks.push(Math.hypot(dxs[i] - dxs[i - 1], dys[i] - dys[i - 1]));
  const jerkSorted = [...jerks].sort((a, b) => a - b);
  // **잔떨림의 크기** — 목표점(그리고 카메라)이 자기 자신의 150ms 이동평균에서 얼마나 벗어나는가(화면 px).
  // 무리가 실제로 이동하는 성분은 이동평균에 들어가므로 여기 남는 것은 순수한 잡음이다.
  // 데드존을 몇 px 로 잡을지는 이 숫자가 정한다 — 짐작으로 고르면 너무 크면 굼뜨고 작으면 안 듣는다.
  const noiseRms = (key) => {
    const half = Math.max(1, Math.round(((150 / 1000) * (samples.length / Math.max(0.001, secs))) / 2));
    let sum = 0;
    let n = 0;
    for (let i = half; i < samples.length - half; i++) {
      let ax = 0;
      let ay = 0;
      for (let j = i - half; j <= i + half; j++) {
        ax += samples[j][key === "cam" ? "x" : "tx"];
        ay += samples[j][key === "cam" ? "y" : "ty"];
      }
      const m = 2 * half + 1;
      const k = samples[i].z * fit;
      const ex = (samples[i][key === "cam" ? "x" : "tx"] - ax / m) * k;
      const ey = (samples[i][key === "cam" ? "y" : "ty"] - ay / m) * k;
      sum += ex * ex + ey * ey;
      n += 1;
    }
    return n ? Math.sqrt(sum / n) : 0;
  };
  const cs = [...cam.moves].sort((a, b) => a - b);
  const ts = [...tgt.moves].sort((a, b) => a - b);
  const dtSorted = [...dts].sort((a, b) => a - b);
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  return {
    frames: samples.length,
    secs: +secs.toFixed(1),
    fps: +(samples.length / Math.max(0.001, secs)).toFixed(1),
    dtP50: +quantile(dtSorted, 0.5).toFixed(1),
    dtP95: +quantile(dtSorted, 0.95).toFixed(1),
    // 떨림 — 초당 방향 뒤집힘 횟수(x·y 합)
    camRevPerSec: +(cam.rev / Math.max(0.001, secs)).toFixed(2),
    tgtRevPerSec: +(tgt.rev / Math.max(0.001, secs)).toFixed(2),
    // 눈이 뭉쳐 보는 시간 규모(약 100ms·200ms)의 떨림
    camRev100: revInWindow(Math.max(1, Math.round(6 * (60 / Math.max(1, samples.length / Math.max(0.001, secs)))))),
    camRev200: revInWindow(Math.max(1, Math.round(12 * (60 / Math.max(1, samples.length / Math.max(0.001, secs)))))),
    // 가속도 잡음 — 「움찔」의 실체. 카메라 속도가 프레임마다 얼마나 튀는가(px/프레임²).
    jerkMean: +mean(jerks).toFixed(3),
    jerkP95: +quantile(jerkSorted, 0.95).toFixed(3),
    // 잔떨림 크기(150ms 이동평균에서 벗어난 양의 RMS · 화면 px) — 데드존 반경의 근거.
    camNoise: +noiseRms("cam").toFixed(2),
    tgtNoise: +noiseRms("tgt").toFixed(2),
    // 이동량 분포(화면 px/프레임)
    camMean: +mean(cam.moves).toFixed(3),
    camP50: +quantile(cs, 0.5).toFixed(3),
    camP95: +quantile(cs, 0.95).toFixed(3),
    camMax: +quantile(cs, 1).toFixed(3),
    tgtMean: +mean(tgt.moves).toFixed(3),
    tgtP95: +quantile(ts, 0.95).toFixed(3),
    // 카메라가 실제로 간 거리 / 목표가 간 거리 — 1 을 크게 넘으면 목표의 잔떨림을 그대로 베끼고 있다.
    pathRatio: +(mean(cam.moves) / Math.max(1e-6, mean(tgt.moves))).toFixed(2),
    // 보간 위상 4등분별 평균 이동량 — 앞칸만 크면 「목표가 sim 스텝마다 계단으로 튄다」는 증거다.
    byPhase: byPhase.map((b) => +(b.sum / Math.max(1, b.n)).toFixed(3)),
    // 계단비 — (sim 스텝이 넘어간 프레임의 평균 이동) ÷ (그 사이 프레임의 평균 이동).
    // 1 이면 매끄럽게 흐르는 것이고, 크면 스텝마다 한 번씩 튀는 계단 걸음이다.
    stepRatio: +(onStep.sum / Math.max(1, onStep.n) / Math.max(1e-6, between.sum / Math.max(1, between.n))).toFixed(2),
    // 그때 세계는 어땠나 — 시대·무리 크기·무리 평균 속력(월드px/스텝). 「시대가 갈수록」의 재료다.
    era: Math.round(mean(samples.map((s) => s.era)) * 10) / 10 + 1, // 화면 표기와 같게 1부터
    pop: Math.round(mean(samples.map((s) => s.n))),
    speed: +mean(samples.map((s) => s.v)).toFixed(2),
  };
}

async function runScene(browser, scene) {
  // ⚠ deviceScaleFactor 는 **1** 로 둔다. 3 으로 두면 소프트웨어 래스터라이저가 1170x2532 를 그리다
  //   10fps 로 주저앉고, 그러면 Pixi 티커의 dt 가 상한(minFPS 10 → 100ms)에 붙어 버려
  //   이징 계수 k 가 늘 0.9(사실상 즉시 추종)가 된다 = **재려던 떨림이 측정 도구 때문에 사라진다.**
  //   카메라 좌표 계산은 픽셀 밀도와 무관하므로 1 로 재도 같은 값이다.
  const ctx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  // 온보딩 진도(= 맵 크기)는 「끝낸 런 수」에서 나온다 · 저장본을 먼저 심어 첫 세계부터 넓게 만든다.
  await page.addInitScript(
    ({ key, runs }) => {
      try {
        localStorage.setItem(key, JSON.stringify({ metaXp: 0, conquered: false, runsCompleted: runs }));
      } catch {
        // 사생활 모드 등 — 그냥 첫 플레이로 돈다
      }
    },
    { key: META_KEY, runs: scene.runs },
  );
  if (scene.cpu > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: scene.cpu });
  }
  await page.goto(`${BASE}?camprobe&ovhook&seed=${SEED}`, { waitUntil: "load" });
  await toWatch(page);
  // 배속을 올린다 · 게임이 쓰는 그 경로 그대로(숫자키 1·2·3 = 목표 줄의 배속 버튼과 같은 자리).
  // 버튼을 안 누르는 이유: 그 버튼은 접힌 상세 패널 안에 살아 열기 전에는 클릭이 안 된다.
  if (scene.speed > 1) {
    await page.keyboard.press(`Digit${scene.speed}`);
    await page.waitForTimeout(200);
  }
  // 진입 직후의 스냅(새 세계로 카메라가 뛰는 한 프레임)을 표본에서 뺀다.
  await page.evaluate(() => {
    window.__camProbe.length = 0;
  });
  await keepWatching(page, scene.ms ?? RECORD_MS);
  const raw = await page.evaluate(() => window.__camProbe.slice());
  // 논리 화면 → 실제 화면 축소 배율(viewport.ts 의 scale-to-fit 과 같은 식).
  const fit = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return 1;
    return c.clientWidth / 540;
  });
  await ctx.close();
  // CAM_DUMP=<디렉터리> 를 주면 원표본을 그대로 남긴다 · 이징·데드존 상수를 **브라우저를 다시 띄우지 않고**
  // 같은 궤적 위에서 오프라인으로 견줘 고를 때 쓴다(고른 뒤엔 반드시 실제로 다시 재서 확인할 것).
  if (process.env.CAM_DUMP) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(process.env.CAM_DUMP, { recursive: true });
    writeFileSync(`${process.env.CAM_DUMP}/${scene.name}.json`, JSON.stringify({ fit, samples: raw }));
  }
  return { scene, stats: analyze(raw, fit), fit: +fit.toFixed(3) };
}

const only = process.argv[2];
const scenes = only ? SCENES.filter((s) => s.name === only) : SCENES;
if (!scenes.length) {
  console.error(`알 수 없는 장면: ${only} (가능: ${SCENES.map((s) => s.name).join(", ")})`);
  process.exit(1);
}

const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const dev = spawn(process.execPath, [viteBin, "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
try {
  await waitFor(BASE, 25000);
  // 프레임률을 실제 폰에 가깝게 유지하는 플래그들 · 안 붙이면 headless 가 rAF 를 늦춰
  // 10fps 로 떨어지고 그 순간 이 계측은 다른 게임을 재게 된다.
  const browser = await chromium.launch({
    args: [
      // ⚠ `--disable-frame-rate-limit`·`--disable-gpu-vsync` 는 **안 붙인다.** 붙이면 183fps 로 돌아
      //   폰(60fps)과 다른 dt 를 재게 된다. 우리가 재려는 것 절반이 프레임률 의존성이다.
      // 소프트웨어 래스터라이저(swiftshader)로 그리면 게임이 20fps 대로 주저앉는다 → 실제 GPU 를 쓴다.
      "--use-angle=d3d11",
      "--ignore-gpu-blocklist",
      "--enable-gpu-rasterization",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  });
  const rows = [];
  for (const scene of scenes) rows.push(await runScene(browser, scene));
  await browser.close();
  const dump = (s, indent) => {
    const p = " ".repeat(indent);
    console.log(`${p}프레임 ${s.frames}개 / ${s.secs}초 (${s.fps}fps · dt p50 ${s.dtP50}ms · p95 ${s.dtP95}ms)`);
    console.log(`${p}세계  시대 ${s.era} · 무리 ${s.pop}마리 · 평균 속력 ${s.speed} 월드px/스텝`);
    console.log(`${p}떨림  카메라 ${s.camRevPerSec}회/초(1프레임) · ${s.camRev100}(≈100ms) · ${s.camRev200}(≈200ms) · 목표 ${s.tgtRevPerSec}회/초`);
    console.log(`${p}움찔  가속도 잡음 평균 ${s.jerkMean} · p95 ${s.jerkP95} px/프레임²`);
    console.log(`${p}잔떨림 150ms 이동평균에서 벗어난 양(RMS) · 카메라 ${s.camNoise}px · 목표 ${s.tgtNoise}px`);
    console.log(`${p}이동  카메라 평균 ${s.camMean} · p50 ${s.camP50} · p95 ${s.camP95} · 최대 ${s.camMax} px/프레임`);
    console.log(`${p}      목표   평균 ${s.tgtMean} · p95 ${s.tgtP95} px/프레임 · 경로비 ${s.pathRatio}`);
    console.log(`${p}계단  스텝 넘어간 프레임 / 그 사이 프레임 = ${s.stepRatio}배 (1 이면 매끄럽다)`);
    console.log(`${p}보간 위상별 평균 이동(0→1 4등분): ${s.byPhase.join(" · ")}`);
  };
  console.log("\n=== 카메라 떨림 계측 (화면 px 기준 · 시드 " + SEED + ") ===");
  let thin = 0;
  for (const r of rows) {
    console.log(`\n[${r.scene.name}] ${r.scene.note}`);
    // 표본이 얇으면 **표를 찍기 전에** 말한다 · 조용히 0 을 찍는 표가 가장 위험하다
    // (실제로 3분을 굴리고 0프레임을 잰 표가 멀쩡해 보였다 — known_issues).
    if (r.stats.frames < MIN_FRAMES) {
      thin += 1;
      console.log(`  ✗ 못 쟀다 · 세계가 도는 프레임이 ${r.stats.frames}개뿐이다(${MIN_FRAMES}개 미만).`);
      console.log("    드래프트·결과 화면에 걸려 sim 이 멈춰 있었을 것 · 아래 숫자는 믿지 마라.");
    }
    dump(r.stats, 2);
  }
  console.log(thin === 0 ? "" : `\n✗ ${thin}개 장면을 못 쟀다 — 위 표에서 그 줄은 버려라.\n`);
} finally {
  dev.kill();
}
