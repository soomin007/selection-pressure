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
// 무엇을 잡나 (다섯 가지):
//   ① 겹침    글씨 요소끼리 사각형이 겹친다(부모·자식 관계는 정상이라 제외).
//   ② 가림    **그림이 글씨를 덮는다**(생물 스프라이트·오라·메달리온 같은 그림 요소가 위에 얹힘).
//   ③ 이탈    글씨 요소가 화면 밖으로 나갔다(왼쪽이 잘리거나 아래로 밀려남).
//   ④ 가로 스크롤  문서 폭이 화면보다 넓다(폰에서 좌우로 밀리는 증상).
//   ⑤ 캔버스 가림  **DOM 패널이 캔버스(Pixi) 글씨를 덮는다**(위협 예고 전광판·판정/보스 플래시).
//
// ②가 왜 뒤늦게 들어왔나(2026-08-05 사용자 지적: "드래프트에서 캐릭터 그림이 위 글씨를 가린다"):
// 이 검사기는 **글씨끼리만** 쟀다. 게다가 가려진 글씨는 오탐을 줄이려고 후보에서 조용히 빼 왔는데,
// 그 "빼기"가 곧 **그림에 덮인 글씨를 통과시키는 구멍**이었다. 13개 화면 전부 "이상 없음"이 뜨는
// 동안에도 폰 화면에서는 생물이 헤더를 덮고 있었다. 가린 것이 글씨/패널이면 정상 오버레이지만,
// 가린 것이 **그림**이면 그건 버그다. 그 둘을 가른다.
//
// ⑤는 왜 들어왔나(2026-08-05, **같은 부류를 세 번째로 놓친 뒤**): 이 검사기는 DOM 만 쟀다.
// 그래서 왼쪽 위 목표 줄(DOM)이 두 줄로 늘거나 상세를 펼치면 그 뒤의 **빨간 보스 플래시·초록
// 통과 문구·위협 예고 전광판**(전부 캔버스)이 통째로 가려지는데도 늘 초록불이었다. 사용자가 세 번
// 지적하고서야 잡혔다. 이제 그리는 쪽이 자기 글씨의 화면 좌표를 `body.dataset.pixiText` 로 내보내고
// (src/render/pixiTextRects.ts), 여기서 그 사각형이 실제로 캔버스 위에 노출돼 있는지 히트 테스트한다.
//
// 한계(알아 두고 쓸 것):
// - 캔버스 UI 중 검사되는 것은 ⑤로 좌표를 내보내는 위젯(하이라이트·위협 예고)과 배치 공식을 여기
//   베껴 둔 미니맵뿐이다. 보스 격퇴 체력 바(worldView 가 보스 몸 위에 그린다)는 월드 좌표라 안 잡히므로,
//   그쪽을 옮겼다면 스크린샷을 눈으로도 봐야 한다.
// - 런 보고서(이 혈통의 기록)는 이제 잰다 · `?ovhook` 의 report 문으로 연다(2026-08-08 · 판 분석 코드
//   상자를 거기 넣으면서 열었다. 열자마자 형질 그래프의 「50」 눈금이 선에 덮여 있던 것이 잡혔다 —
//   "수동 확인 대상"은 실제로는 확인 안 되는 대상이었다). 결과 화면 자체는 아직 안 잰다.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// 포트는 **환경변수/인자로 바꿀 수 있다** · 동시 세션이 5178 을 이미 쓰고 있을 때를 위해서다:
//   OVERLAP_PORT=5180 node scripts/overlap-check.mjs   (또는 node scripts/overlap-check.mjs 5180)
// ⚠ 아래 spawn 에 `--strictPort` 가 붙어 있는 것이 이 옵션의 절반이다. 없으면 포트가 물렸을 때
//   vite 가 조용히 다음 포트로 비켜 서고, 검사기는 **다른 세션의 서버**를 재게 된다(빈 초록불).
const PORT = Number(process.env.OVERLAP_PORT ?? process.argv[2] ?? 5178);
const BASE = `http://localhost:${PORT}/`;
const OUT = "screenshots/overlap";

// minimap.ts 와 같은 값 · 거기서 바꾸면 여기도 바꿔야 한다(캔버스라 DOM 으로 못 잰다).
const MM_W = 84;
const MM_TOP = 64;
const MM_MARGIN = 10;

// 폰 두 폭을 다 본다: 360 은 흔한 좁은 폰(여기서만 터지는 사고가 실제로 있었다), 390 은 기준 폰.
const PHONE_NARROW = { width: 360, height: 780 };
const PHONE = { width: 390, height: 844 };
// 세로가 짧은 폰(주소창을 펼친 상태·작은 기기). 여기서만 터지는 사고가 있다. 헤더 문구가 길면
// 히어로 칸(1fr)이 0 으로 접히는데, transform 배율은 레이아웃을 안 밀어내서 그림이 헤더 위로 올라탔다.
const PHONE_SHORT = { width: 390, height: 640 };
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
 * **HUD(목표 줄)가 실제로 눌리는 상태까지** 데려간다 · `toWatch` 뒤 HUD 를 클릭하는 장면의 앞부분.
 *
 * 왜 필요한가(2026-08-08 에 실제로 터진 것): `toWatch` 는 4.2초를 고정으로 기다릴 뿐이라, 그 사이에
 * **레벨업 드래프트가 열려 있으면** 목표 줄이 통째로 숨는다(`goalBar.update({ visible: phase === "watch" })`).
 * 그러면 `.goal-gene` 클릭이 30초를 기다리다 죽고 "화면까지 못 갔다"로 실패한다. 런 시드가 무작위라
 * (`Math.random` 기반 randomSeed) **어느 장면이 걸리는지가 실행마다 바뀐다** — 한 번 초록불이 떠도
 * 다음 실행에서 다른 장면이 빨간불이 된다. 고정 대기로는 못 막는 종류의 실패다.
 *
 * 열려 있는 드래프트는 골라서 닫는다(게임이 실제로 진행되는 길 그대로). 카드를 고르면 다음 단계가
 * 시작되며 목표 줄이 돌아온다.
 */
async function toHud(page) {
  await toWatch(page);
  for (let i = 0; i < 6; i += 1) {
    if (await page.locator(".goal-root").first().isVisible()) return;
    const draft = page.locator(".draft-root");
    if (await draft.isVisible()) {
      await page.locator(".draft-card").first().click();
      await page.waitForTimeout(1200);
      continue;
    }
    await page.waitForTimeout(600);
  }
  if (!(await page.locator(".goal-root").first().isVisible())) {
    throw new Error("목표 줄(HUD)이 안 떴다 — 드래프트가 안 닫혔거나 런이 끝났다");
  }
}

/**
 * 캔버스 글씨가 실제로 떠오를 때까지 기다린다. 상단 플래시는 **단일 슬롯 + 우선순위 대기열**이라
 * (highlights.ts) 첫 안내가 끝나야 다음 문구가 나온다 → 고정 대기로는 "안 떠 있는 순간"을 재게 된다.
 * 여기서 헛되이 통과시키면 검사기가 또 초록불 거짓말을 한다.
 */
async function waitForPixiText(page, re, timeoutMs = 9000) {
  const t0 = Date.now();
  for (;;) {
    const raw = await page.evaluate(() => document.body.dataset.pixiText ?? "");
    if (re.test(raw)) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await page.waitForTimeout(200);
  }
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
  // ── 캔버스 글씨가 떠 있는 순간들(⑤ 전용) ──────────────────────────────────────────
  // 여기 없던 것이 사고의 전부였다. 예전 13개 장면에는 "위협 예고가 떠 있는 순간"도 "판정 플래시가
  // 떠 있는 순간"도 없었고, 그래서 그 글씨가 왼쪽 위 패널 뒤로 들어가는 것을 세 번 놓쳤다.
  // 문구는 `?ovhook` 문(main.ts)이 **게임의 진짜 경로**로 만든다(가짜 문자열 금지).
  watchBossFlash: {
    label: "관전 + 보스 등장 플래시",
    async go(page) {
      await toWatch(page);
      // 진짜 보스를 소환한다 → 목표 줄이 "위협: 그림자 매복자" + 두 줄짜리 안내로 늘고(사용자가
      // 신고한 그 상태), 빨간 등장 플래시가 그 바로 아래에 뜬다. 이름이 가장 긴 보스를 고른다.
      await page.evaluate(() => window.__ov.summon("stalker"));
      if (!(await waitForPixiText(page, /보스/))) throw new Error("보스 등장 플래시가 안 떴다");
    },
  },
  watchBossFlashExpanded: {
    label: "관전 + 보스 플래시 + 목표 줄 펼침",
    async go(page) {
      await toWatch(page);
      await page.locator(".goal-pill").first().click();
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__ov.summon("stalker"));
      if (!(await waitForPixiText(page, /보스/))) throw new Error("보스 등장 플래시가 안 떴다");
    },
  },
  watchThreatBanner: {
    label: "관전 + 위협 예고 전광판 + HUD 최대",
    async go(page) {
      await toWatch(page);
      // HUD 를 실제로 커질 수 있는 최대치로 만든다: 목표 줄이 가장 긴 상태(보스 판 · 안내가 두 줄) +
      // 상세 펼침. 조각 하나하나는 게임이 만드는 진짜 상태이고, 여기서 일부러 겹쳐 최악을 잰다.
      // (예고가 뜨는 순간의 평균 HUD 만 재면 여유가 몇 px 인지 모른 채 지나간다.)
      await page.evaluate(() => window.__ov.summon("stalker"));
      await page.waitForTimeout(400);
      await page.locator(".goal-pill").first().click();
      await page.waitForTimeout(400); // 늘어난 높이가 goalBar 의 실측(ResizeObserver)에 반영될 틈
      // 실제로 나올 수 있는 가장 긴 예고(game.ts upcomingThreat 의 형식 · 보스 이름·카운터 힌트가
      // 가장 긴 조합). 전광판은 화면 한복판이지만 상세 패널이 펼쳐지면 그 위까지 내려온다.
      await page.evaluate(() =>
        window.__ov.banner(
          "곧 그림자 매복자!",
          "시야를 키우면 일찍 보고 달아납니다. 공격력이나 원거리가 높으면 어떤 보스든 맞서 잡습니다.",
        ),
      );
      if (!(await waitForPixiText(page, /매복자/))) throw new Error("위협 예고가 안 떴다");
    },
  },
  watchVerdictFlash: {
    label: "관전 + 시험 판정 플래시",
    async go(page) {
      await toWatch(page);
      // main.ts verdictLine 이 만드는 가장 긴 형태(불합격 + 진행/목표 + 불씨). 색도 게임과 같은 호박색.
      await page.evaluate(() =>
        window.__ov.flash("시험 불합격 · 무리 14/18 · 불씨 하나가 꺼졌습니다", 0xffba3a, true),
      );
      if (!(await waitForPixiText(page, /불합격/))) throw new Error("판정 플래시가 안 떴다");
    },
  },
  watchGateChip: {
    label: "관전 + 관문 생존 칩(후반 시대)",
    async go(page) {
      await toWatch(page);
      // 후반 시대(생존 기준 6마리)의 보스 판 = 알약 첫 줄이 "위협: 그림자 매복자" + 생존 칩으로
      // 가장 붐비는 상태다. 시대를 안 올리면 기준이 1이라 칩이 아예 안 떠서 이 최악을 못 잰다.
      await page.evaluate(() => {
        window.__ov.setEra(4);
        window.__ov.summon("stalker");
      });
      await page.waitForTimeout(900);
      // 칩이 실제로 붙었는지 확인 — 안 붙었으면 이 장면은 아무것도 안 재고 있는 것이다.
      const chip = await page.locator(".goal-follow").first().innerText();
      if (!/생존/.test(chip)) throw new Error(`생존 칩이 안 떴다: ${chip}`);
    },
  },
  watchEraMoment: {
    label: "시대 전환 연출(험해지는 세 줄)",
    async go(page) {
      await toWatch(page);
      await page.evaluate(() => window.__ov.eraMoment());
      await page.waitForTimeout(900); // 쓸려 내려오는 애니메이션이 끝난 뒤에 잰다
    },
  },
  draftMineLateEra: {
    label: "드래프트 + 내 종 팝업(후반 시대)",
    async go(page) {
      await toWatch(page);
      // 시대를 올려 **후반 드래프트**를 띄운다 — 레벨 보정이 붙어 윗 등급 카드가 자주 뜨고,
      // 특성 줄이 긴 카드(「곁에 동료가 많을 때 받는 피해 ×0.67」)가 그때 가장 잘 나온다.
      // ⚠ 옛 라벨은 「천장 194」였고 주석은 「형질 천장이 100 위로 열린다」였다. 그건 형질이 0~100
      //   자연수이던 시절의 이야기이고, 재려던 유령 막대는 v9 에서 걷어냈다(2026-08-10).
      //   장면 자체는 여전히 값이 있다 — **후반 카드의 긴 문구가 폰에서 겹치는지**를 재는 자리다.
      await page.evaluate(() => window.__ov.setEra(4));
      await page.locator(".draft-root").waitFor({ state: "visible", timeout: 150000 });
      await page.waitForTimeout(2400);
      await page.getByRole("button", { name: /내 종/ }).first().click();
      await page.waitForTimeout(700);
    },
  },
  // ── 티어 구입 화면(방울) ─────────────────────────────────────────────────────────
  // 문은 목표 줄 알약 옆의 방울 카운터(.goal-gene)다 · 새 제스처를 안 만들고 기존 HUD 손잡이를 쓴다.
  // **두 상태를 다 잰다.** 지갑이 0 이면 다섯 줄이 전부 「모자람」이라 켜진 테두리와 방울 색 값 칩을
  // 영영 안 재게 된다(화면의 절반만 검사하는 셈) → 채운 장면을 따로 둔다.
  genePanel: {
    label: "티어 올리기(방울 0개 · 전부 모자람)",
    async go(page) {
      await toHud(page); // 드래프트가 떠 있으면 목표 줄이 숨어 클릭이 죽는다(toHud 주석 참고)
      await page.locator(".goal-gene").first().click();
      await page.locator(".gene-root.open").waitFor({ state: "visible", timeout: 5000 });
      await page.waitForTimeout(400);
    },
  },
  genePanelRich: {
    label: "티어 올리기(방울 넉넉 · 살 수 있는 줄)",
    async go(page) {
      await toHud(page); // 드래프트가 떠 있으면 목표 줄이 숨어 클릭이 죽는다(toHud 주석 참고)
      await page.evaluate(() => window.__ov.genes(60)); // 다섯 줄이 전부 살 수 있는 상태
      await page.locator(".goal-gene").first().click();
      await page.locator(".gene-root.open").waitFor({ state: "visible", timeout: 5000 });
      await page.waitForTimeout(400);
      // 살 수 있는 줄이 실제로 켜졌는지 확인 · 안 켜졌으면 이 장면은 아무것도 안 재고 있는 것이다.
      const ok = await page.locator(".gene-price.ok").count();
      if (ok === 0) throw new Error("살 수 있는 줄이 하나도 없다(지갑 주입이 안 먹었다)");
    },
  },
  levelUp: {
    label: "런 종료 진척도(해금 여러 개 + 도전 과제)",
    async go(page) {
      await toWatch(page);
      // 진짜 해금표(경험치 400 = 여러 레벨 한 번에)와 진짜 도전 과제 둘. 사용자 스크린샷의 그 판이다.
      await page.evaluate(() => window.__ov.levelUp(400, 2));
      await page.waitForTimeout(3400); // 경험치 애니메이션(최대 2.6초) + 해금 등장이 끝난 뒤에 잰다
    },
  },
  // ── 런 보고서(이 혈통의 기록) + 판 분석 코드 ────────────────────────────────────
  // 이 화면은 오래 "런을 끝까지 굴려야 나와서 안 잰다"로 미뤄져 있었는데, 판 분석 코드 상자와
  // 복사 버튼이 여기 들어왔다. `?ovhook` 의 report 문이 **게임이 만든 진짜 기록·진짜 코드**로 연다.
  // 티어 승급 띠 — 2026-08-09 에 통째로 새로 짠 연출(옛 「정점」 재활용을 걷었다).
  // 승급은 방울을 모으거나 카드를 골라야 나오는 순간이라 검사기가 스스로 못 만든다 → `?ovhook` 의 문으로 연다.
  // **4단**을 재는 이유: 띠가 가장 크고(고리까지 뜬다) 효과 줄이 가장 길어 최악 길이가 여기서 나온다.
  tierUp: {
    label: "티어 승급 띠(가죽 IV단 · 가장 긴 줄)",
    async go(page) {
      await toWatch(page);
      await page.evaluate(() => window.__ov.tierUp("hide", 4));
      await page.waitForTimeout(450); // 띠가 다 내려온 뒤(애니메이션 16% 지점을 넘겨) 잰다
      const seen = await page.locator("text=/가죽 IV/").count(); // 표기는 드래프트 화면과 같은 로마자다
      if (seen === 0) throw new Error("승급 띠가 안 떴다");
    },
  },
  runReport: {
    label: "런 보고서 + 판 분석 코드(복사)",
    async go(page) {
      await toWatch(page); // 잠시 굴려 개체 수·형질 그래프와 연대기에 실제로 점이 찍히게 한다
      await page.evaluate(() => window.__ov.report());
      await page.waitForTimeout(500);
      // 코드 상자가 실제로 떴는지 확인 · 안 떴으면 이 장면은 아무것도 안 재고 있는 것이다.
      const code = await page.locator('textarea[aria-label="판 분석 코드"]').first().inputValue();
      if (!/^SP\d+-/.test(code)) throw new Error(`판 분석 코드가 안 떴다: ${code.slice(0, 24)}`);
    },
  },
  // 코드 상자는 화면 맨 아래에 있다 → 스크롤을 끝까지 내린 상태도 따로 잰다(버튼·안내 줄이 그때 보인다).
  runReportBottom: {
    label: "런 보고서 맨 아래(코드 상자 · 복사 버튼)",
    async go(page) {
      await toWatch(page);
      await page.evaluate(() => window.__ov.report());
      await page.waitForTimeout(500);
      // 오버레이 자체를 끝까지 내린다(코드 상자는 맨 아래다). scrollIntoView 는 상자만 맞춰 놓고
      // 그 아래 버튼을 화면 밖에 남길 수 있다.
      await page.evaluate(() => {
        const ov = document.querySelector(".run-report-root");
        if (ov) ov.scrollTop = ov.scrollHeight;
      });
      await page.waitForTimeout(400);
      // **화면 안에 있는가**를 좌표로 잰다 · isVisible() 은 스크롤 밖에 있어도 참이라 아무것도 안 잰다
      // (이 저장소의 "닫기 버튼이 화면 밖으로 밀린" 사고가 정확히 그 자리였다).
      const box = await page.getByRole("button", { name: "코드 복사" }).first().boundingBox();
      const vh = page.viewportSize()?.height ?? 0;
      if (!box || box.y < 0 || box.y + box.height > vh + 1) {
        throw new Error(`복사 버튼이 화면 밖이다: ${JSON.stringify(box)} · 화면 높이 ${vh}`);
      }
    },
  },
};

// 무엇을 어느 폭에서 볼 것인가. 폰이 기본이고, 데스크톱은 확대 배율(CSS zoom) 때문에 따로 본다.
const SCENES = [
  { screen: "lobby", viewport: PHONE_NARROW },
  { screen: "presetCategory", viewport: PHONE_NARROW },
  { screen: "presetDetail", viewport: PHONE_NARROW },
  { screen: "glossary", viewport: PHONE_NARROW },
  // 세로가 짧은 화면 전수 점검 · 세로로 자라는 전체화면 화면은 여기서만 위가 잘린다
  // (런 종료 진척도가 실제로 그랬다). 폭만 챙기고 높이를 안 챙기면 같은 사고를 또 놓친다.
  { screen: "lobby", viewport: PHONE_SHORT },
  { screen: "presetCategory", viewport: PHONE_SHORT },
  { screen: "presetDetail", viewport: PHONE_SHORT },
  { screen: "glossary", viewport: PHONE_SHORT },
  { screen: "watch", viewport: PHONE_NARROW },
  { screen: "watch", viewport: PHONE },
  { screen: "watch", viewport: DESKTOP },
  { screen: "watch", viewport: PHONE, query: "?watch" },
  { screen: "watchExpanded", viewport: PHONE_NARROW },
  { screen: "draft", viewport: PHONE_NARROW, query: "?watch" },
  { screen: "draftLongCopy", viewport: PHONE_NARROW, query: "?watch" },
  // 짧은 폰 + 최장 문구 = 히어로 칸이 가장 좁아지는 최악. 그림이 헤더를 덮던 자리다.
  { screen: "draftLongCopy", viewport: PHONE_SHORT, query: "?watch" },
  { screen: "draftLongCopy", viewport: DESKTOP, query: "?watch" },
  { screen: "draftMine", viewport: PHONE_NARROW, query: "?watch" },
  // 팝업이 열리면 뒤 헤더가 잘리는지 · 세로가 짧은 화면에서만 터진다(팝업이 화면 높이를 다 쓴다).
  { screen: "draftMine", viewport: PHONE_SHORT, query: "?watch" },
  // 캔버스 글씨가 떠 있는 순간 · 여기가 세 번 놓친 자리다(⑤).
  { screen: "watchBossFlash", viewport: PHONE_SHORT, query: "?ovhook" },
  { screen: "watchBossFlash", viewport: PHONE_NARROW, query: "?ovhook" },
  { screen: "watchBossFlashExpanded", viewport: PHONE_SHORT, query: "?ovhook" },
  { screen: "watchThreatBanner", viewport: PHONE_SHORT, query: "?ovhook" },
  { screen: "watchThreatBanner", viewport: DESKTOP, query: "?ovhook" },
  { screen: "watchVerdictFlash", viewport: PHONE_NARROW, query: "?ovhook" },
  // 관문 생존 칩 · 알약 첫 줄을 "긴 보스 이름 + 칩"이 나눠 쓴다. 좁은 폰이 최악.
  { screen: "watchGateChip", viewport: PHONE_NARROW, query: "?ovhook" },
  { screen: "watchGateChip", viewport: PHONE, query: "?ovhook" },
  // 시대 전환 연출 · 세 줄이 좁은 폰·짧은 폰에서 화면 밖으로 안 나가는지.
  { screen: "watchEraMoment", viewport: PHONE_NARROW, query: "?ovhook" },
  { screen: "watchEraMoment", viewport: PHONE_SHORT, query: "?ovhook" },
  // 후반 시대의 형질 막대(눈금·정점선) · 값 열이 길어져도 이름·막대와 안 겹치는지.
  { screen: "draftMineLateEra", viewport: PHONE_NARROW, query: "?ovhook" },
  // 런 종료 진척도 · 내용이 길면 위(제목)가 잘렸다. 짧은 화면이 최악.
  { screen: "levelUp", viewport: PHONE_SHORT, query: "?ovhook" },
  { screen: "levelUp", viewport: PHONE_NARROW, query: "?ovhook" },
  // 티어 구입 화면 · 다섯 줄이 세로로 자라는 전체화면 오버레이라 **짧은 폰이 최악**이다(패널이 화면보다
  // 길어지는 유일한 폭 · 위가 잘리는 사고가 여기서만 난다). 좁은 폰은 값 칩과 이름이 부딪히는 폭이다.
  { screen: "genePanel", viewport: PHONE_NARROW, query: "?ovhook" },
  { screen: "genePanel", viewport: PHONE_SHORT, query: "?ovhook" },
  { screen: "genePanelRich", viewport: PHONE_NARROW, query: "?ovhook" },
  { screen: "genePanelRich", viewport: PHONE_SHORT, query: "?ovhook" },
  { screen: "genePanelRich", viewport: DESKTOP, query: "?ovhook" },
  // 런 보고서 + 판 분석 코드 · 세로로 자라는 전체화면 오버레이라 짧은 폰이 최악이고,
  // 좁은 폰은 복사 버튼과 안내 줄이 한 줄에서 부딪히는 폭이다.
  { screen: "tierUp", viewport: PHONE_NARROW, query: "?ovhook" },
  { screen: "tierUp", viewport: PHONE_SHORT, query: "?ovhook" },
  { screen: "runReport", viewport: PHONE_NARROW, query: "?ovhook" },
  { screen: "runReport", viewport: PHONE_SHORT, query: "?ovhook" },
  { screen: "runReportBottom", viewport: PHONE_NARROW, query: "?ovhook" },
  { screen: "runReportBottom", viewport: DESKTOP, query: "?ovhook" },
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
//
// 그림 판정 규칙(②) · 오탐이 많으면 아무도 검사기를 안 보게 되므로 규칙과 예외를 여기 못 박는다:
//  · 그림으로 치는 것: <img> · <canvas> · <svg> · <video> · background-image 가 url(...) 인 요소 ·
//    그라디언트 배경인데 **글자를 하나도 안 담은** 순수 장식 요소(드래프트 오라·틴트가 여기 해당).
//  · 그림으로 안 치는 것: 글자를 담은 요소의 배경(그건 그 글씨의 배경이지 남의 글씨를 덮는 그림이 아니다),
//    배경색만 있는 패널·베일(색면은 오버레이의 정상 재료다).
//  · **같은 패널 안일 때만** 신고한다. 그림과 글씨의 최근접 공통 조상이 body/html 이면 서로 다른
//    전체화면 레이어라는 뜻이라 넘어간다(대백과가 뒤 HUD 를 덮는 것은 정상이다). 한 패널이 제 글씨를
//    제 그림으로 덮는 것만 버그로 센다.
//  · 3x3 표본 중 **2점 이상**을 덮었을 때만 신고한다(1점은 글자 사각형 가장자리를 스친 수준).
//  · 부모·자식은 애초에 "보이는 글씨"로 세므로 여기 안 온다(글씨 위에 제 배경이 있는 건 정상).
const COLLECT = () => {
  const out = [];
  let uid = 0;

  /** 이 요소가 "그림"인가. 아니면 null. */
  const artKind = (node) => {
    const tag = node.tagName;
    if (tag === "IMG" || tag === "CANVAS" || tag === "VIDEO" || tag === "svg" || tag === "SVG") {
      return tag.toLowerCase();
    }
    const bg = getComputedStyle(node).backgroundImage;
    if (!bg || bg === "none") return null;
    if (bg.includes("url(")) return "그림";
    // 그라디언트는 글씨 배경으로도 흔히 쓰인다 → 글자를 안 담은 순수 장식일 때만 그림으로 친다.
    if (bg.includes("gradient") && (node.textContent ?? "").trim() === "") return "장식";
    return null;
  };

  /** 히트된 픽셀의 주인에서 위로 올라가며 가장 가까운 그림 요소를 찾는다(빈 래퍼가 잡히는 경우 대비). */
  const nearestArt = (node) => {
    for (let p = node, i = 0; p && p !== document.body && i < 6; p = p.parentElement, i++) {
      if (artKind(p)) return p;
    }
    return null;
  };

  /** 그림과 글씨가 같은 패널 안인가(공통 조상이 body/html 이면 서로 다른 전체화면 레이어). */
  const samePanel = (art, textEl) => {
    const up = new Set();
    for (let p = art; p; p = p.parentElement) up.add(p);
    for (let p = textEl; p; p = p.parentElement) {
      if (up.has(p)) return p !== document.body && p !== document.documentElement;
    }
    return false;
  };
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
    const artHits = new Map(); // 이 글씨를 덮은 그림 요소 → 덮은 표본 점 수
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
          if (hit && (hit === el || el.contains(hit) || hit.contains(el))) {
            shown++;
            continue;
          }
          // 안 보이는 픽셀 · 무엇이 덮었나. 그림이면 버그, 남의 패널/글씨면 정상 오버레이다.
          if (!hit) continue;
          const art = nearestArt(hit);
          if (!art || !samePanel(art, el)) continue;
          const cls = typeof art.className === "string" && art.className ? art.className : art.tagName.toLowerCase();
          const key = `${cls.slice(0, 30)}|${artKind(art)}`;
          artHits.set(key, (artHits.get(key) ?? 0) + 1);
        }
      }
      if (tested > 0 && shown * 2 >= tested) vis.push({ x: r.x, y: r.y, w: r.width, h: r.height });
    }

    // 가장 크게 덮은 그림 하나만 보고한다(한 글씨에 여러 조각이 걸리면 목록이 폭발한다).
    let art = null;
    for (const [key, n] of artHits) if (n >= 2 && (!art || n > art.pts)) art = { key, pts: n };

    out.push({
      id,
      chain,
      scrolled,
      cls: typeof el.className === "string" ? el.className.slice(0, 34) : "",
      text: node.textContent.trim().replace(/\s+/g, " ").slice(0, 26),
      raw,
      vis,
      art,
    });
  }
  return out;
};

// 브라우저 안에서 실행 · 캔버스(Pixi) 글씨가 **DOM 에 덮여 안 보이는지**를 잰다.
//
// 왜 히트 테스트인가: 사각형 교집합만 보면 "글자끼리"만 잡힌다. 실제로 안 보이게 만드는 것은 대부분
// 패널의 **배경**이다(목표 줄 알약은 반투명 갈색 + blur 라 그 뒤 글씨가 뭉개진다). 그래서 각 사각형에
// 점을 찍어 "그 픽셀의 맨 위가 무엇인가"를 묻고, 캔버스가 아니면 덮인 것으로 센다.
//
// 오탐을 만들지 않기 위한 규칙(오탐이 많으면 아무도 검사기를 안 본다 · known_issues):
//  · 검사 전에 주입한 `* { pointer-events: auto }` 때문에 **투명한 레이아웃 상자**까지 히트된다.
//    (예: `.goal-root` 는 화면 폭을 다 쓰지만 배경이 없어 아무것도 안 가린다.)
//    → 히트된 요소에서 위로 올라가며 **실제로 칠하는 것**(불투명한 배경색·배경 그림·backdrop-filter)
//      또는 **자기 글자**를 가진 조상이 있을 때만 "덮었다"로 센다. 없으면 그냥 통과.
//  · **전체 화면 오버레이**(드래프트·진척도·로비·멈춤 메뉴)가 덮는 것은 넘어간다. 그건 화면이 통째로
//    바뀐 것이지 "글씨가 가려진" 사고가 아니다(DOM 쪽 ②가 서로 다른 전체화면 레이어를 넘기는 것과
//    같은 규칙). 그 자리의 처방은 따로 있다 · 문구를 그 패널 안에도 실어라(known_issues).
//  · 3x5 표본 중 2점 이상일 때만 신고한다(모서리 한 점 스침 제외).
const PIXI_COVER = () => {
  const raw = document.body.dataset.pixiText;
  if (!raw) return [];
  const rects = JSON.parse(raw);
  const canvas = document.querySelector("#app canvas");

  /** 이 요소가 전체 화면을 덮는 레이어 안에 있는가(=화면이 통째로 바뀐 것). 그러면 사고가 아니다. */
  const inFullScreenLayer = (node) => {
    for (let p = node; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.position !== "fixed" && cs.position !== "absolute") continue;
      const rc = p.getBoundingClientRect();
      if (rc.width >= innerWidth * 0.95 && rc.height >= innerHeight * 0.95) return true;
    }
    return false;
  };

  /** 이 요소(또는 조상)가 그 자리에서 실제로 무언가를 칠하는가. 칠하는 요소를 돌려준다(없으면 null). */
  const painter = (node) => {
    // 자기 글자를 직접 가진 요소면 그 글씨가 캔버스 글씨 위에 얹힌 것 → 칠하는 것으로 친다.
    for (const c of node.childNodes) {
      if (c.nodeType === 3 && (c.textContent ?? "").trim()) return node;
    }
    for (let p = node; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return p;
      if (cs.backdropFilter && cs.backdropFilter !== "none") return p;
      if (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== "none") return p;
      const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor ?? "");
      if (m) {
        const parts = m[1].split(",").map((v) => Number(v.trim()));
        const alpha = parts.length > 3 ? parts[3] : 1;
        if (alpha >= 0.15) return p;
      }
    }
    return null;
  };

  const out = [];
  for (const r of rects) {
    const covers = new Map();
    let tested = 0;
    // 세로 표본에 **가장자리 바로 안쪽**(6% · 94%)을 넣는다. 이 사고는 대개 "윗줄만 잘리는" 모양으로
    // 온다(패널이 8px 만 겹쳐도 첫 줄 획이 뭉갠다) · 가운데 세 줄만 찍으면 그 얇은 띠를 통째로 놓친다.
    const ys = [0.06, 0.28, 0.5, 0.72, 0.94];
    for (let a = 1; a <= 3; a++) {
      for (const fy of ys) {
        const px = r.x + (r.w * a) / 4;
        const py = r.y + r.h * fy;
        if (px < 0 || py < 0 || px > innerWidth || py > innerHeight) continue;
        tested++;
        const hit = document.elementFromPoint(px, py);
        if (!hit || hit === canvas || hit.id === "app" || hit === document.body) continue;
        if (inFullScreenLayer(hit)) continue; // 화면이 통째로 바뀐 것 · 위 주석의 예외
        const paint = painter(hit);
        if (!paint) continue;
        const cls =
          typeof paint.className === "string" && paint.className
            ? paint.className
            : paint.tagName.toLowerCase();
        const key = cls.slice(0, 30);
        covers.set(key, (covers.get(key) ?? 0) + 1);
      }
    }
    let worst = null;
    for (const [key, n] of covers) if (n >= 2 && (!worst || n > worst.pts)) worst = { key, pts: n };
    out.push({ label: r.label, text: r.text, rect: r, tested, cover: worst });
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
  // 같은 화면을 여러 뷰포트에서 재므로 파일 이름에 높이까지 넣는다(안 넣으면 서로 덮어쓴다).
  const file = `${scene.screen}-${scene.viewport.width}x${scene.viewport.height}${scene.query === "?watch" ? "-watch" : ""}`;
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
  const pixi = await page.evaluate(PIXI_COVER);
  const doc = await page.evaluate(() => ({
    ui: Number(getComputedStyle(document.body).getPropertyValue("--ui-zoom")) || 1,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    // main.ts 가 남기는 표식 · 캔버스에 그리는 미니맵이 지금 떠 있는지를 DOM 으로 알 수 있는 유일한 길.
    minimap: document.body.dataset.minimap === "on",
  }));

  const all = rects.filter((r) => r.vis.length > 0);
  // 캔버스 글씨도 같은 좌표계의 사각형이다 → ①(겹침)·③(이탈)에 함께 태운다. DOM 글씨와의 관계는
  // ⑤가 배경까지 보고 더 정확히 판정하므로 ①에서는 그 쌍만 건너뛴다(중복 보고 방지).
  for (const p of pixi) {
    all.push({
      pixiText: true,
      cls: p.label,
      text: p.text.replace(/\s+/g, " ").slice(0, 26),
      chain: [],
      raw: [p.rect],
      vis: [p.rect],
    });
  }
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
      // 캔버스 글씨 × DOM 글씨는 ⑤가 잡는다(배경까지 본다) → 여기서 또 세면 같은 사고가 두 번 찍힌다.
      if ((A.pixiText && B.id) || (B.pixiText && A.id)) continue;
      let area = 0;
      for (const ra of A.vis) for (const rb of B.vis) area += intersect(ra, rb);
      if (area > 0) hits.push({ a: A, b: B, area });
    }
  }
  hits.sort((p, q) => q.area - p.area);
  for (const h of hits.slice(0, 8))
    problems.push(`겹침 ${h.area}px²  [${h.a.cls}|${h.a.text}]  ×  [${h.b.cls}|${h.b.text}]`);

  // ② 그림이 글씨를 덮음 · 같은 패널 안에서 그림 요소가 글씨 위에 얹힌 것만 센다(규칙은 COLLECT 주석).
  //    ⚠ 이 글씨들은 ①에서는 안 보인다. 덮였으니 vis 가 비어 후보에서 빠진다. 바로 그 구멍을 메우는 항목이다.
  for (const r of rects) {
    if (r.art) problems.push(`가림 [${r.cls}|${r.text}] ← 그림 [${r.art.key}] ${r.art.pts}/9점`);
  }

  // ③ 화면 밖 이탈 · 스크롤 상자 안은 정상이라 뺀다. 가려진 글자도 "밖으로 나간" 건 잡아야 하므로
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

  // ③-b 캔버스 글씨의 이탈 · 화면 밖으로 나간 예고·플래시(스크롤 상자가 없으니 곧장 안 보인다).
  for (const p of pixi) {
    const g = p.rect;
    const out = [];
    if (g.x < -1.5) out.push(`왼쪽 ${Math.round(-g.x)}px`);
    if (g.x + g.w > scene.viewport.width + 1.5) out.push(`오른쪽 ${Math.round(g.x + g.w - scene.viewport.width)}px`);
    if (g.y < -1.5) out.push(`위 ${Math.round(-g.y)}px`);
    if (g.y + g.h > scene.viewport.height + 1.5) out.push(`아래 ${Math.round(g.y + g.h - scene.viewport.height)}px`);
    if (out.length) problems.push(`이탈 [${p.label}|${p.text.slice(0, 26)}] ${out.join(" · ")}`);
  }

  // ④ 가로 스크롤
  if (doc.scrollW > doc.clientW + 1) problems.push(`가로 스크롤 ${doc.scrollW} > ${doc.clientW}`);

  // ⑤ DOM 이 캔버스 글씨를 덮음 · 위협 예고·판정/보스 플래시가 패널 뒤로 들어간 것(세 번 놓친 사고).
  for (const p of pixi) {
    if (p.cover) {
      problems.push(`캔버스 가림 [${p.label}|${p.text.slice(0, 26)}] ← DOM [${p.cover.key}] ${p.cover.pts}/${p.tested}점`);
    }
  }

  await page.screenshot({ path: `${OUT}/${file}.png` });

  console.log(`\n=== ${name} ===`);
  console.log(
    `  글씨 요소 ${rects.length}개 · 캔버스 글씨 ${pixi.length}개 · JS 오류 ${errs.length}건 · ${file}.png`,
  );
  if (!problems.length) console.log("  ✓ 이상 없음");
  for (const p of problems) console.log("  ✗ " + p);
  for (const e of errs) console.log("  JS:", e);
  await ctx.close();
  return problems.length + errs.length;
}

// ⚠ `npx vite` 로 띄우지 않는다 · 이 저장소는 `node_modules/.bin` 이 없는 체크아웃이 있고(npm 설치
//    방식에 따라), 거기서는 `npx vite` 가 "인식할 수 없는 명령"으로 죽는다. 그러면 검사기는 25초를
//    기다리다 "dev 서버 대기 시간 초과"로 끝나서, **UI 를 못 재고도 실패 이유가 UI 처럼 안 보인다.**
//    vite 의 진입 스크립트를 node 로 직접 부르면 PATH·심링크와 무관하게 늘 뜬다.
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const dev = spawn(process.execPath, [viteBin, "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
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
