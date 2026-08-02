// UI 겹침 점검 — 화면에 보이는 "글씨가 든" 요소들의 사각형을 전부 모아 서로 겹치는지 **좌표로 계산**한다.
// 눈으로 스크린샷을 훑는 것보다 확실하고, 폰과 데스크톱을 같은 기준으로 잰다.
//
// 왜 있나: 이 프로젝트는 "코드는 맞는데 화면에서 겹치는" 사고를 반복해서 겪었다(개체 카드 이름 ↔ ★,
// 좌하단 3중 겹침, 드래프트 팝업이 카드를 덮은 회귀). 폰은 좁아서 데스크톱에서 안 겹치던 게 겹치고,
// 데스크톱은 확대 배율(CSS zoom)이 걸려 또 다르게 겹친다. **UI 를 넣거나 옮길 때마다 돌린다.**
// (2026-08-02 사용자 지시: "글씨가 다른 UI 에 겹치지 않게 하는 걸 항상 점검하도록 해")
//
// 사용: npm run overlap
// 사전: npx playwright install chromium (최초 1회). 저장: screenshots/overlap/*.png (git 미추적)
//
// 화면 네 개: 조종(탭 명령)이 기본이고, `?watch` 는 조작 없는 관전 폴백이다(밸런스 비교용).
//
// 한계(알아 두고 쓸 것):
// - DOM 만 잰다. Pixi(canvas) 로 그리는 것 중 자리가 고정된 미니맵만 배치 공식으로 넣어 함께 검사한다.
//   배너·보스 바 같은 다른 Pixi UI 는 안 잡히므로, 그쪽을 옮겼다면 스크린샷을 눈으로도 봐야 한다.
// - 지금 열려 있는 화면만 잰다. 패널을 펼쳤을 때·긴 문구가 들어갔을 때는
//   SCENES 에 단계를 더해서 따로 재라.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 5178;
const BASE = `http://localhost:${PORT}/`;
const OUT = "screenshots/overlap";

// minimap.ts 와 같은 값 — 거기서 바꾸면 여기도 바꿔야 한다(캔버스라 DOM 으로 못 잰다).
const MM_W = 100;
const MM_TOP = 150;
const MM_MARGIN = 10;

const SCENES = [
  { label: "phone-tap", viewport: { width: 390, height: 844 }, query: "?seed=ov-1" },
  { label: "desktop-tap", viewport: { width: 1920, height: 1010 }, query: "?seed=ov-1" },
  { label: "phone-watch", viewport: { width: 390, height: 844 }, query: "?watch&seed=ov-1" },
  { label: "desktop-watch", viewport: { width: 1920, height: 1010 }, query: "?watch&seed=ov-1" },
];

mkdirSync(OUT, { recursive: true });

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

// 브라우저 안에서 실행 — 보이는 요소 중 **자기 글씨를 직접 가진** 것만 모은다.
// (자식을 감싸기만 하는 컨테이너는 서로 겹치는 게 정상이라 제외한다.)
const COLLECT = () => {
  const out = [];
  const seen = new Set();
  let uid = 0;
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!ownText) continue;
    const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    el.dataset.ovId = String(++uid);
    // 조상 사슬 — 부모·자식끼리 겹치는 것은 정상 배치다(버튼 안의 키 칩 등). 오탐 제거용.
    const chain = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) if (n.dataset.ovId) chain.push(n.dataset.ovId);
    out.push({
      id: el.dataset.ovId,
      chain,
      cls: typeof el.className === "string" ? el.className.slice(0, 34) : "",
      text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 26),
      x: r.x, y: r.y, w: r.width, h: r.height,
    });
  }
  return out;
};

function intersect(a, b) {
  const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ix > 1.5 && iy > 1.5 ? Math.round(ix * iy) : 0; // 1.5px 미만 스침은 안티에일리어싱 수준이라 무시
}

async function checkScene(browser, scene) {
  const ctx = await browser.newContext({ viewport: scene.viewport });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(BASE + scene.query, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1500);
  // 로비 → 갈래 → 세부 종 → 게임 화면(로비는 이번 개편에서 안 바뀌어 문구 그대로 쓴다)
  await page.getByRole("button", { name: "게임 시작" }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /사냥꾼/ }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /이 종으로 시작/ }).first().click();
  await page.waitForTimeout(4200);

  const rects = await page.evaluate(COLLECT);
  const ui = await page.evaluate(
    () => Number(getComputedStyle(document.body).getPropertyValue("--ui-zoom")) || 1,
  );
  const mmH = Math.round((MM_W * scene.viewport.height) / scene.viewport.width);
  const minimap = {
    cls: "MINIMAP(canvas)", text: "(미니맵)",
    x: scene.viewport.width - (MM_W + MM_MARGIN) * ui, y: MM_TOP * ui, w: MM_W * ui, h: mmH * ui,
  };
  const all = [...rects, minimap];

  const hits = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const A = all[i];
      const B = all[j];
      if ((A.chain && B.id && A.chain.includes(B.id)) || (B.chain && A.id && B.chain.includes(A.id))) continue;
      const area = intersect(A, B);
      if (area > 0) hits.push({ a: A, b: B, area });
    }
  }
  hits.sort((p, q) => q.area - p.area);
  await page.screenshot({ path: `${OUT}/${scene.label}.png` });

  console.log(`\n=== ${scene.label} (${scene.viewport.width}x${scene.viewport.height}, ui=${ui}) ===`);
  console.log(`  글씨 요소 ${rects.length}개 + 미니맵 · JS 오류 ${errs.length}건`);
  if (!hits.length) console.log("  ✓ 겹침 없음");
  for (const h of hits.slice(0, 10)) {
    console.log(`  ✗ ${h.area}px²  [${h.a.cls}|${h.a.text}]  ×  [${h.b.cls}|${h.b.text}]`);
  }
  for (const e of errs) console.log("  JS:", e);
  await ctx.close();
  return hits.length + errs.length;
}

const dev = spawn("npx", ["vite", "--port", String(PORT)], { stdio: "ignore", shell: true });
let bad = 0;
try {
  await waitFor(BASE, 25000);
  const browser = await chromium.launch();
  for (const scene of SCENES) bad += await checkScene(browser, scene);
  await browser.close();
} finally {
  dev.kill();
}
console.log(bad === 0 ? "\n✓ 전부 겹침 없음" : `\n✗ ${bad}건 — 위 목록 확인 (screenshots/overlap/*.png)`);
process.exit(bad === 0 ? 0 : 1);
