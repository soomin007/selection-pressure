// 방울(유전자 점수) 시각 검증 · gene-preview.html 을 vite dev 로 띄워 chromium 으로 스크린샷을 찍는다.
// 방울이 먹이와 확실히 갈리는지 · 빛살 개수(=값)가 세어지는지 · 줍는 연출과 화면 밖 쐐기가 제대로
// 나오는지를 눈으로 본다. (boss-preview.mjs 와 같은 짝: 스모크가 "에러 없음", 이건 "모양이 맞는지".)
//
// 사용: node scripts/gene-preview.mjs [등장.png] [줍기.png]
// 사전: npx playwright install chromium (최초 1회).

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 5177;
const URL = `http://localhost:${PORT}/gene-preview.html`;
const OUT_A = process.argv[2] ?? "gene-preview-a.png"; // 나타나는 중 + 값 2~5 + 화면 밖 쐐기
const OUT_B = process.argv[3] ?? "gene-preview-b.png"; // 줍는 순간

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
  await waitFor(URL, 25000);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 860, height: 700 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on("pageerror", (e) => errs.push("JS: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CON: " + m.text());
  });

  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => window.__geneT > 450, { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: OUT_A });
  await page.waitForFunction(() => window.__geneT > 1420, { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: OUT_B });
  await browser.close();

  if (errs.length) {
    console.log("✗ 프리뷰 렌더 오류:");
    for (const e of errs) console.log("  " + e);
  } else {
    console.log("✓ 방울 프리뷰 저장:", OUT_A, OUT_B);
    exitCode = 0;
  }
} catch (e) {
  console.log("✗ 프리뷰 오류:", e.message);
} finally {
  dev.kill();
  process.exit(exitCode);
}
