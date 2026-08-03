// UI 겹침 점검 · 화면에 보이는 "글씨가 든" 요소들의 사각형을 전부 모아 서로 겹치는지, 그리고 화면
// 밖으로 나갔는지를 **좌표로 계산**한다. 눈으로 훑는 것보다 확실하고, 폰과 데스크톱을 같은 기준으로 잰다.
//
// 왜 있나: 이 프로젝트는 "코드는 맞는데 화면에서 겹치는" 사고를 반복해서 겪었다(개체 카드 이름 ↔ ★,
// 좌하단 3중 겹침, 드래프트 팝업이 카드를 덮은 회귀, 닫기 버튼이 화면 밖으로 밀린 사고).
// **UI 를 넣거나 옮길 때마다 돌린다.** (2026-08-02 사용자 지시: "글씨가 다른 UI 에 겹치지 않게 하는 걸
// 항상 점검하도록 해" / 2026-08-03 재지시: "특히 폰 환경 기준으로")
//
// 사용: npm run overlap
// 사전: npx playwright install chromium (최초 1회). 저장: screenshots/overlap/*.png (git 미추적)
//
// 무엇을 잡나 (세 가지):
//   ① 겹침    글씨 요소끼리 사각형이 겹친다(부모·자식 관계는 정상이라 제외).
//   ② 이탈    글씨 요소가 화면 밖으로 나갔다(왼쪽이 잘리거나 아래로 밀려남).
//   ③ 가로 스크롤  문서 폭이 화면보다 넓다(폰에서 좌우로 밀리는 증상).
//
// 한계(알아 두고 쓸 것):
// - DOM 만 잰다. Pixi(canvas) 로 그리는 것 중 자리가 고정된 미니맵만 배치 공식으로 넣어 함께 검사한다.
//   배너·보스 바·판정 플래시 같은 다른 Pixi UI 는 안 잡히므로, 그쪽을 옮겼다면 스크린샷을 눈으로도 봐야 한다.
// - 결과·보고서 화면은 런을 끝까지 굴려야 나와서 여기서 안 잰다(수동 확인 대상으로 남긴다).

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 5178;
const BASE = `http://localhost:${PORT}/`;
const OUT = "screenshots/overlap";

// minimap.ts 와 같은 값 · 거기서 바꾸면 여기도 바꿔야 한다(캔버스라 DOM 으로 못 잰다).
const MM_W = 84;
const MM_TOP = 64;
const MM_MARGIN = 10;

// 폰 두 폭을 다 본다: 360 은 흔한 좁은 폰(여기서만 터지는 사고가 실제로 있었다), 390 은 기준 폰.
const PHONE_NARROW = { width: 360, height: 780 };
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1920, height: 1010 };

/** 로비에서 관전 화면까지 · 모든 흐름의 공통 앞부분. */
async function toWatch(page) {
  await page.getByRole("button", { name: "게임 시작" }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /사냥꾼/ }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /이 종으로 시작/ }).first().click();
  await page.waitForTimeout(4200);
}

/**
 * 화면 목록 · 각 항목은 "새로 연 페이지를 그 화면까지 데려가는 법"을 안다.
 * 새 화면(패널·오버레이)을 만들면 **여기에 한 줄 더한다.** 안 더하면 그 화면은 영영 안 재진다.
 */
const SCREENS = {
  lobby: {
    label: "로비",
    async go() {
      /* 첫 화면이라 할 일 없음 */
    },
  },
  presetCategory: {
    label: "갈래 선택",
    async go(page) {
      await page.getByRole("button", { name: "게임 시작" }).first().click();
      await page.waitForTimeout(900);
    },
  },
  presetDetail: {
    label: "세부 종 선택",
    async go(page) {
      await page.getByRole("button", { name: "게임 시작" }).first().click();
      await page.waitForTimeout(700);
      await page.getByRole("button", { name: /사냥꾼/ }).first().click();
      await page.waitForTimeout(900);
    },
  },
  watch: {
    label: "관전(목표 한 줄 + 미니맵)",
    go: toWatch,
  },
  watchExpanded: {
    label: "관전 + 목표 줄 펼침",
    async go(page) {
      await toWatch(page);
      await page.locator(".goal-pill").first().click();
      await page.waitForTimeout(500);
    },
  },
  draft: {
    label: "드래프트(형질 고르기)",
    async go(page) {
      await toWatch(page);
      await page.locator(".draft-root").waitFor({ state: "visible", timeout: 150000 });
      await page.waitForTimeout(2600); // 카드 등장 애니메이션이 끝난 뒤에 재야 거짓 이탈이 안 난다
    },
  },
  draftLongCopy: {
    label: "드래프트 + 최장 예고·안내",
    async go(page) {
      await toWatch(page);
      await page.locator(".draft-root").waitFor({ state: "visible", timeout: 150000 });
      await page.waitForTimeout(2600);
      // 실제로 나올 수 있는 **가장 긴** 문구를 넣어 최악을 잰다(평균 길이만 보면 사고를 놓친다).
      await page.evaluate(() => {
        const t = document.querySelector(".draft-title");
        const f = document.querySelector(".draft-forecast");
        const n = document.querySelector(".draft-notice");
        // 제목 자리에는 판정이 들어온다. 가장 긴 형태(불합격 + 진행/목표 + 불씨)로 잰다.
        if (t) t.textContent = "시험 불합격 · 무리 14/18 · 불씨 하나가 꺼졌습니다";
        if (f) {
          f.textContent = "이번 시험: 먹이 45회 (12/45)";
          f.style.display = "";
        }
        if (n) {
          n.textContent =
            "지금 위협 「굶주린 상어」 · 물 밖으로 나가면 안전합니다. 시야가 넓어야 일찍 보고 뭍으로 달아납니다.";
          n.style.display = "";
        }
      });
      await page.waitForTimeout(400);
    },
  },
  draftMine: {
    label: "드래프트 + 내 종 팝업",
    async go(page) {
      await toWatch(page);
      await page.locator(".draft-root").waitFor({ state: "visible", timeout: 150000 });
      await page.waitForTimeout(2400);
      await page.getByRole("button", { name: /내 종/ }).first().click();
      await page.waitForTimeout(700);
    },
  },
  glossary: {
    label: "대백과",
    async go(page) {
      await page.getByRole("button", { name: "대백과" }).first().click();
      await page.waitForTimeout(900);
    },
  },
};

// 무엇을 어느 폭에서 볼 것인가. 폰이 기본이고, 데스크톱은 확대 배율(CSS zoom) 때문에 따로 본다.
const SCENES = [
  { screen: "lobby", viewport: PHONE_NARROW },
  { screen: "presetCategory", viewport: PHONE_NARROW },
  { screen: "presetDetail", viewport: PHONE_NARROW },
  { screen: "glossary", viewport: PHONE_NARROW },
  { screen: "watch", viewport: PHONE_NARROW },
  { screen: "watch", viewport: PHONE },
  { screen: "watch", viewport: DESKTOP },
  { screen: "watch", viewport: PHONE, query: "?watch" },
  { screen: "watchExpanded", viewport: PHONE_NARROW },
  { screen: "draft", viewport: PHONE_NARROW, query: "?watch" },
  { screen: "draftLongCopy", viewport: PHONE_NARROW, query: "?watch" },
  { screen: "draftLongCopy", viewport: DESKTOP, query: "?watch" },
  { screen: "draftMine", viewport: PHONE_NARROW, query: "?watch" },
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

// 브라우저 안에서 실행 · **글자 자체의 사각형**(요소 상자가 아니라)을 모으고, 각 사각형이 그 자리에서
// 진짜로 보이는지까지 판정한다.
//
// 왜 이렇게까지 하나(둘 다 실제로 겪은 오탐이다):
//  · 가운데 정렬된 블록은 상자가 줄 전체를 차지해, 글자가 안 닿는데도 옆 버튼과 "겹쳤다"고 나온다.
//    → 텍스트 노드에 Range 를 걸어 **글자 줄 단위 사각형**을 쓴다.
//  · 대백과·내 종 팝업 같은 전체 화면 오버레이는 뒤 화면을 덮는 게 정상인데, 뒤 글씨까지 세면
//    "겹침"이 수십 건 쏟아진다. → 각 글자 사각형에서 점을 찍어 `elementFromPoint` 로 **맨 위에 있는지**
//    확인하고, 가려진 글씨는 아예 후보에서 뺀다. 남는 것은 "둘 다 실제로 보이는데 겹친 것"뿐이다.
const COLLECT = () => {
  const out = [];
  let uid = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.textContent && n.textContent.trim().length > 0) nodes.push(n);
  }
  for (const node of nodes) {
    const el = node.parentElement;
    if (!el) continue;
    // 조상 사슬을 훑어 숨김·투명·스크롤 상자를 한 번에 판정한다.
    let hidden = false;
    let scrolled = false;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const pc = getComputedStyle(p);
      if (pc.display === "none" || pc.visibility === "hidden" || Number(pc.opacity) < 0.05) {
        hidden = true;
        break;
      }
      if (p !== el && (pc.overflowY === "auto" || pc.overflowY === "scroll" || pc.overflowX === "auto")) {
        scrolled = true;
      }
    }
    if (hidden) continue;

    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width > 3 && r.height > 3);
    if (!rects.length) continue;

    const id = String(++uid);
    el.dataset.ovId = id;
    const chain = [];
    for (let p = el; p && p !== document.body; p = p.parentElement) if (p.dataset.ovId) chain.push(p.dataset.ovId);

    const raw = [];
    const vis = [];
    for (const r of rects) {
      raw.push({ x: r.x, y: r.y, w: r.width, h: r.height });
      // 3x3 격자로 찍어 "맨 위에 있는 픽셀"의 비율을 센다. 절반 넘게 보이면 보이는 글자로 친다.
      let shown = 0;
      let tested = 0;
      for (let a = 1; a <= 3; a++) {
        for (let b = 1; b <= 3; b++) {
          const px = r.x + (r.width * a) / 4;
          const py = r.y + (r.height * b) / 4;
          if (px < 0 || py < 0 || px > innerWidth || py > innerHeight) continue;
          tested++;
          const hit = document.elementFromPoint(px, py);
          if (hit && (hit === el || el.contains(hit) || hit.contains(el))) shown++;
        }
      }
      if (tested > 0 && shown * 2 >= tested) vis.push({ x: r.x, y: r.y, w: r.width, h: r.height });
    }

    out.push({
      id,
      chain,
      scrolled,
      cls: typeof el.className === "string" ? el.className.slice(0, 34) : "",
      text: node.textContent.trim().replace(/\s+/g, " ").slice(0, 26),
      raw,
      vis,
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
  const screen = SCREENS[scene.screen];
  const name = `${scene.viewport.width}x${scene.viewport.height} · ${screen.label}${scene.query ? " " + scene.query : ""}`;
  const file = `${scene.screen}-${scene.viewport.width}${scene.query === "?watch" ? "-watch" : ""}`;
  const ctx = await browser.newContext({ viewport: scene.viewport });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  let problems = [];
  try {
    await page.goto(BASE + (scene.query ?? "") + (scene.query ? "&" : "?") + "seed=ov-1", {
      waitUntil: "load",
      timeout: 30000,
    });
    await page.waitForTimeout(1500);
    await screen.go(page);
  } catch (e) {
    console.log(`\n=== ${name} ===`);
    console.log(`  ✗ 화면까지 못 갔다: ${String(e).split("\n")[0]}`);
    await ctx.close();
    return 1;
  }

  // 히트 테스트가 **칠해진 순서**를 그대로 따르게 한다. pointer-events:none 인 HUD 글씨가
  // 뒤 캔버스로 뚫려 "안 보인다"고 오판되는 것을 막는다.
  await page.addStyleTag({ content: "* { pointer-events: auto !important; }" });
  const rects = await page.evaluate(COLLECT);
  const doc = await page.evaluate(() => ({
    ui: Number(getComputedStyle(document.body).getPropertyValue("--ui-zoom")) || 1,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    // main.ts 가 남기는 표식 · 캔버스에 그리는 미니맵이 지금 떠 있는지를 DOM 으로 알 수 있는 유일한 길.
    minimap: document.body.dataset.minimap === "on",
  }));

  const all = rects.filter((r) => r.vis.length > 0);
  if (doc.minimap) {
    const mmH = Math.round((MM_W * scene.viewport.height) / scene.viewport.width);
    all.push({
      cls: "MINIMAP(canvas)",
      text: "(미니맵)",
      chain: [],
      vis: [
        {
          x: scene.viewport.width - (MM_W + MM_MARGIN) * doc.ui,
          y: MM_TOP * doc.ui,
          w: MM_W * doc.ui,
          h: mmH * doc.ui,
        },
      ],
    });
  }

  // ① 겹침 · 둘 다 그 자리에서 실제로 보이는 글자끼리만 센다.
  const hits = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const A = all[i];
      const B = all[j];
      if ((A.chain && B.id && A.chain.includes(B.id)) || (B.chain && A.id && B.chain.includes(A.id))) continue;
      let area = 0;
      for (const ra of A.vis) for (const rb of B.vis) area += intersect(ra, rb);
      if (area > 0) hits.push({ a: A, b: B, area });
    }
  }
  hits.sort((p, q) => q.area - p.area);
  for (const h of hits.slice(0, 8))
    problems.push(`겹침 ${h.area}px²  [${h.a.cls}|${h.a.text}]  ×  [${h.b.cls}|${h.b.text}]`);

  // ② 화면 밖 이탈 · 스크롤 상자 안은 정상이라 뺀다. 가려진 글자도 "밖으로 나간" 건 잡아야 하므로
  //    보이는 것(vis)이 아니라 글자 사각형 전체(raw)로 잰다.
  for (const r of rects) {
    if (r.scrolled) continue;
    for (const g of r.raw) {
      const out = [];
      if (g.x < -1.5) out.push(`왼쪽 ${Math.round(-g.x)}px`);
      if (g.x + g.w > scene.viewport.width + 1.5) out.push(`오른쪽 ${Math.round(g.x + g.w - scene.viewport.width)}px`);
      if (g.y < -1.5) out.push(`위 ${Math.round(-g.y)}px`);
      if (g.y + g.h > scene.viewport.height + 1.5)
        out.push(`아래 ${Math.round(g.y + g.h - scene.viewport.height)}px`);
      if (out.length) {
        problems.push(`이탈 [${r.cls}|${r.text}] ${out.join(" · ")}`);
        break;
      }
    }
  }

  // ③ 가로 스크롤
  if (doc.scrollW > doc.clientW + 1) problems.push(`가로 스크롤 ${doc.scrollW} > ${doc.clientW}`);

  await page.screenshot({ path: `${OUT}/${file}.png` });

  console.log(`\n=== ${name} ===`);
  console.log(`  글씨 요소 ${rects.length}개 · JS 오류 ${errs.length}건 · ${file}.png`);
  if (!problems.length) console.log("  ✓ 이상 없음");
  for (const p of problems) console.log("  ✗ " + p);
  for (const e of errs) console.log("  JS:", e);
  await ctx.close();
  return problems.length + errs.length;
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
console.log(
  bad === 0
    ? `\n✓ ${SCENES.length}개 화면 전부 이상 없음`
    : `\n✗ ${bad}건 · 위 목록과 screenshots/overlap/*.png 확인`,
);
process.exit(bad === 0 ? 0 : 1);
