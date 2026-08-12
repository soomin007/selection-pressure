// 카드 전수 화면 넘침 실측 — 2026-08-12 [사용자] "화면 늘어남 재발 · 레벨업 드래프트 화면 ·
// 형질 하나가 멘트가 길어서 그런 게 아닐까". 52장+프리셋을 전부 강제로 띄워 문서 폭을 잰다.
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 5189;
const BASE = `http://localhost:${PORT}/`;

const vite = spawn("node", ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort"], {
  stdio: "pipe",
});
await new Promise((resolve, reject) => {
  vite.stdout.on("data", (d) => {
    if (String(d).includes("Local:")) resolve();
  });
  vite.stderr.on("data", () => {});
  setTimeout(() => reject(new Error("vite 시작 실패")), 20000);
});

const browser = await chromium.launch();
try {
  for (const vp of [
    { width: 360, height: 780 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto(BASE + "?ovhook");
    await page.waitForTimeout(1200);
    const ids = await page.evaluate(() => window.__ov.draftIds());
    console.log(`\n=== ${vp.width}x${vp.height} · 카드 ${ids.length}장 ===`);
    let bad = 0;
    for (const id of ids) {
      const ok = await page.evaluate((cid) => window.__ov.draftCard(cid), id);
      if (!ok) {
        console.log(`  ? ${id} — 못 띄움`);
        continue;
      }
      await page.waitForTimeout(60);
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const out = { sw: de.scrollWidth, cw: de.clientWidth, over: [] };
        if (de.scrollWidth > de.clientWidth + 1) {
          for (const el of document.querySelectorAll("body *")) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.right > de.clientWidth + 1 && el.children.length === 0) {
              out.over.push(
                `${el.tagName}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)} 「${(el.textContent ?? "").slice(0, 30)}」`,
              );
            }
          }
        }
        return out;
      });
      if (m.sw > m.cw + 1) {
        bad += 1;
        console.log(`  ✗ ${id} · scrollWidth ${m.sw} > ${m.cw}`);
        for (const o of m.over.slice(0, 4)) console.log(`      ${o}`);
      }
    }
    console.log(bad === 0 ? "  ✓ 전 카드 넘침 없음" : `  ✗ ${bad}장에서 넘침`);
    await page.close();
  }
} finally {
  await browser.close();
  vite.kill();
}
