// 보스 실루엣 시각 검증 — boss-preview.html 을 vite dev 로 띄워 chromium 으로 스크린샷을 찍는다.
// 보스 아트(drawBossShape)를 바꾼 뒤 5종이 회전해도 안 뒤집히고 생물과 통일감 있는지 눈으로 확인용.
// (스모크가 "런타임 에러 없음"을 보는 것과 짝 — 이건 "모양이 맞는지"를 본다.)
//
// 사용: node scripts/boss-preview.mjs [출력경로.png]
// 사전: npx playwright install chromium (최초 1회).

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 5176;
const URL = `http://localhost:${PORT}/boss-preview.html`;
const OUT = process.argv[2] ?? "boss-preview.png";

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

let exitCode = 1;
try {
  await waitFor(URL, 20000);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 860, height: 720 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on("pageerror", (e) => errs.push("JS: " + e.message));

  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => window.__bossPreviewReady === true, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT });
  await browser.close();

  if (errs.length) {
    console.log("✗ 프리뷰 렌더 오류:");
    for (const e of errs) console.log("  " + e);
  } else {
    console.log("✓ 보스 프리뷰 저장:", OUT);
    exitCode = 0;
  }
} catch (e) {
  console.log("✗ 프리뷰 오류:", e.message);
} finally {
  dev.kill();
  process.exit(exitCode);
}
