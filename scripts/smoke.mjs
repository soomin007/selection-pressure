// 부팅 스모크 테스트 — 빌드된 앱을 실제 헤드리스 브라우저(chromium)로 띄워 "런타임 에러 없이 부팅되고
// 렌더되는지"를 확인한다. 타입체크·유닛테스트가 못 잡는 런타임 오류(TDZ·초기화 순서·Pixi 초기화 등)를
// 잡는다. (실제로 카메라 변수 TDZ 로 부팅이 통째로 죽은 사고를 이 검사로 잡았어야 했다 — known_issues.)
//
// 사용: node scripts/smoke.mjs   (vite preview 를 자동으로 띄우고 검사 후 정리)
// 사전: npm run build (dist 필요), npx playwright install chromium (최초 1회).

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 4199;
const URL = `http://localhost:${PORT}/`;

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
      if (Date.now() - t0 > timeoutMs) return reject(new Error("preview 서버 대기 시간 초과"));
      setTimeout(tick, 300);
    };
    tick();
  });
}

const preview = spawn("npx", ["vite", "preview", "--port", String(PORT)], {
  stdio: "ignore",
  shell: true,
});

let exitCode = 1;
try {
  await waitFor(URL, 15000);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("JS: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("CON: " + m.text());
  });

  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1500);

  const clickText = async (re) => {
    for (const b of await page.$$("button")) {
      const t = (await b.innerText().catch(() => "")).trim();
      if (re.test(t) && (await b.isVisible().catch(() => false))) {
        await b.click();
        return t;
      }
    }
    return null;
  };

  // 로비 → 갈래 → 세부 종 시작 → 관전(ticker: 카메라/렌더 매 프레임) → 드래그·휠(카메라 입력)
  await clickText(/시작|게임|플레이/);
  await page.waitForTimeout(900);
  await clickText(/순한|사냥꾼|특수/);
  await page.waitForTimeout(500);
  await clickText(/이 종으로|시작/);
  await page.waitForTimeout(3000);
  await page.mouse.move(200, 400);
  await page.mouse.down();
  await page.mouse.move(260, 460, { steps: 5 });
  await page.mouse.up();
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(700);

  const hasCanvas = await page.$("canvas").then((c) => !!c);
  await browser.close();

  if (!hasCanvas) errs.push("canvas 가 렌더되지 않음(부팅 실패 가능)");
  if (errs.length === 0) {
    console.log("✓ 스모크 통과 — 부팅·관전·카메라 입력에 런타임 에러 없음");
    exitCode = 0;
  } else {
    console.log("✗ 스모크 실패:");
    for (const e of errs) console.log("  " + e);
  }
} catch (e) {
  console.log("✗ 스모크 오류:", e.message);
} finally {
  preview.kill();
  process.exit(exitCode);
}
