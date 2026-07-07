// 게임 주요 화면 스크린샷 — vite dev 서버를 띄우고 chromium 으로 각 화면에 도달해 저장한다.
// "게임이 어떻게 생겼는지" 를 외부(디자인 협업 등)에 전달하는 용도. 모바일 세로가 기본, 관전은 데스크톱
// 가로도 한 장. boss-preview.mjs 와 같은 패턴(dev 자동 기동 → 캡처 → 정리).
//
// 사용: node scripts/screenshots.mjs
// 사전: npx playwright install chromium (최초 1회). 저장: screenshots/*.png (git 미추적)

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 5177;
const BASE = `http://localhost:${PORT}/`;
const SEED = "showcase-1"; // 재현용 고정 시드(?seed=)
const OUT = "screenshots";

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

const dev = spawn("npx", ["vite", "--port", String(PORT)], { stdio: "ignore", shell: true });
const saved = [];

// 로비 → 갈래 → 세부 종 → 관전 진입까지 공통 경로(모바일·데스크톱 둘 다 사용).
async function enterWatch(page) {
  await page.getByRole("button", { name: "게임 시작" }).first().click();
  await page.waitForTimeout(700);
}
async function pickHunter(page) {
  await page.getByRole("button", { name: /사냥꾼/ }).first().click();
  await page.waitForTimeout(600);
}
async function startSpecies(page) {
  await page.getByRole("button", { name: /이 종으로 시작/ }).first().click();
}

// 좌하단 조작 열(한 마리 관찰·줌)과 개체 정보 카드는 이제 게임이 상태(로비/관전/드래프트/개체 선택)에 따라
// 알아서 배타 표시한다(main.ts) — 그래서 여기서 따로 숨기지 않아도 각 화면이 깨끗하게 잡힌다.
async function run() {
  await waitFor(BASE, 20000);
  const browser = await chromium.launch();
  const errs = [];

  // ─────────── 모바일 세로 흐름 (한 페이지로 순차 진행) ───────────
  const ctx = await browser.newContext({ viewport: { width: 440, height: 940 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("JS: " + e.message));

  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}.png` });
    saved.push(name);
    console.log("  ✓", name);
  };

  await page.goto(`${BASE}?seed=${SEED}`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1600);
  await shot("01-lobby");

  // 대백과(용어 사전)
  await page.getByRole("button", { name: "대백과" }).first().click();
  await page.waitForTimeout(700);
  await shot("02-glossary");
  await page.getByRole("button", { name: "닫기" }).first().click();
  await page.waitForTimeout(400);

  // 캐릭터 선택 1단계 — 갈래
  await enterWatch(page);
  await shot("03-preset-category");

  // 캐릭터 선택 2단계 — 세부 종(외형 미리보기)
  await pickHunter(page);
  await shot("04-preset-detail");

  // 관전 화면 — zoomBar 는 실제 인게임 조작 UI 라 그대로 둔다
  await startSpecies(page);
  await page.waitForTimeout(3800);
  await shot("05-watch");

  // 개체 관찰(한 마리 클로즈업 + 정보 카드) — 관전 진입 직후 개체가 많고 정상 속도라 안정적으로 잡힌다.
  await page.getByRole("button", { name: /한 마리 관찰/ }).first().click();
  await page.waitForTimeout(1800);
  await shot("06-creature-focus");

  // 드래프트(레벨업 형질 선택) — 배속 3x 로 앞당긴다. 개체를 고른 채여도 드래프트 중엔 정보 카드·조작 열이
  // 숨어(main.ts) 카드 3장이 안 가린다.
  const speed = page.locator(".controls-bar .ctrl-btn").first();
  await speed.click();
  await page.waitForTimeout(150);
  await speed.click();
  console.log("  … 드래프트(레벨업) 대기 중 (최대 90s)");
  try {
    await page.locator(".ui-draft").waitFor({ state: "visible", timeout: 90000 });
    await page.waitForTimeout(600);
    await shot("07-draft");
  } catch {
    console.log("  ✗ 07-draft 미도달(시간 초과) — 수동 확인 필요");
  }

  // 런을 끝까지 진행 → 결과 화면의 "이 혈통의 기록"(런 보고서) 캡처. 드래프트가 뜨면 첫 카드로 넘기고,
  // 진척도 화면이 뜨면 "계속"을 눌러 결과 화면까지 간다.
  console.log("  … 런 종료(결과 화면)까지 진행 중 (최대 90s)");
  const reportBtn = page.getByRole("button", { name: "이 혈통의 기록 보기" });
  let reachedResult = false;
  for (let i = 0; i < 220; i++) {
    if (await reportBtn.isVisible().catch(() => false)) { reachedResult = true; break; }
    const card = page.locator(".ui-card").first();
    if (await card.isVisible().catch(() => false)) { await card.click(); await page.waitForTimeout(120); continue; }
    const cont = page.getByRole("button", { name: "계속" });
    if (await cont.isVisible().catch(() => false)) { await cont.click(); await page.waitForTimeout(300); continue; }
    await page.waitForTimeout(400);
  }
  if (reachedResult) {
    await reportBtn.click();
    await page.waitForTimeout(700);
    await shot("09-report");
  } else {
    console.log("  ✗ 09-report 미도달(결과 화면 시간 초과)");
  }

  await ctx.close();

  // ─────────── 데스크톱 가로 관전 (한 장, 순수 관전) ───────────
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const dpage = await dctx.newPage();
  dpage.on("pageerror", (e) => errs.push("JS(desktop): " + e.message));
  await dpage.goto(`${BASE}?seed=${SEED}`, { waitUntil: "load", timeout: 30000 });
  await dpage.waitForTimeout(1300);
  await enterWatch(dpage);
  await pickHunter(dpage);
  await startSpecies(dpage);
  // 데스크톱은 무리가 커 레벨업이 빠르다 — 가로 레이아웃(우측 형질 패널 + 하단 카드)이 한 장에 담긴다.
  await dpage.waitForTimeout(1600);
  await dpage.screenshot({ path: `${OUT}/08-desktop.png` });
  saved.push("08-desktop");
  console.log("  ✓ 08-desktop");
  await dctx.close();

  await browser.close();
  if (errs.length) {
    console.log("경고 — JS 오류 감지:");
    for (const e of errs) console.log("  " + e);
  }
}

let code = 1;
try {
  await run();
  code = 0;
  console.log(`\n완료 — ${saved.length}장 저장: ${OUT}/`);
} catch (e) {
  console.log("✗ 오류:", e.message);
} finally {
  dev.kill();
  process.exit(code);
}
