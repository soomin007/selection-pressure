// 밸런스 프로브 · "화면에서 사용자가 실제로 겪는 것"을 숫자로 재는 상설 스크립트.
//
// 왜 상설인가. 2026-08-04 세션 로그에 "보스 격퇴율 72%"라 적었는데, 사용자가 폰에서 균형 잡식으로
// 해 보니 격퇴 체력 바에 흠집조차 안 났다. 그 72% 는 (a) 게임과 다른 치수(960x540 · areaScale 1)에서
// (b) 프리셋 4종과 보스 8종을 한 분수로 합쳐 (c) "처치/버팀" 이진으로 잰 25건이었다. 사용자가 만난
// 조합(균형 잡식 x 약탈자)은 그 안에서 한 번도 따로 계산된 적이 없다. 게다가 프로브를 지워 버려
// 재현조차 불가능했다. 이 파일이 그 재발을 막는다.
//
// 세 가지 규칙(docs/design/known_issues.md 에 규칙으로 올라가 있다):
//   1. 반드시 **실제 플레이 세계 치수**로 만든다 · 단일 근원 src/config.ts 의 MOBILE(540x960) x
//      MAP_SCALE(2) = 1080x1920, areaScale = MAP_AREA_SCALE = 4. 이 파일은 복사본을 두지 않는다.
//   2. **합친 비율을 보고하지 않는다** · 프리셋 x 보스 x 시대 축을 쪼개고, 표본 5 미만이면 "표본 부족".
//   3. 지표는 **사용자가 화면에서 보는 양**으로 · 보스는 "라운드 중 최소 체력 비율"(바가 얼마나
//      움직였나)이지 처치/버팀 이진이 아니다.
//
// ⚠ 기준선 값을 이 파일에 박아 두지 않는다. sim 을 바꾸면 절대 수치가 이동해 박아 둔 값 자체가
//   또 거짓말이 된다. 수정 전후로 두 번 돌려 **차이**를 본다.
//
// 40~90초 걸린다 → CI·상시 검증에 넣지 않는다. **밸런스를 만졌을 때만 수동으로** 돌린다.
//
// 사용:
//   npm run probe                 (= order)
//   npm run probe -- order        지시 순종·도착·시험 계수 (지시를 안 준 대조군과 함께)
//   npm run probe -- raid         프리셋 8종 x 떼 보스 5종 격퇴 (최소 체력 비율)
//   npm run probe -- replay --code=SP1-…   **사람이 보낸 판을 그대로 되살린다.**
//                                 같은 시드·같은 선택으로 다시 굴려, 기록된 결과와 한 줄씩 대조한다.
//                                 어긋나는 첫 줄이 곧 「프로브(또는 시뮬)가 게임과 갈라진 자리」다.
//   npm run probe -- poison       독 안개(전역 흡수) · 기준선/안 몲/수풀로 몲 셋을 나란히
//   npm run probe -- extinction   **대멸종 넷을 같은 자로.** 재난이 「예고한 방식으로」 죽이는지 잰다.
//                                 ⚠ 재난을 추가·수정하면 반드시 이걸 먼저 돌린다(known_issues).
//   npm run probe -- sweep        공격력 스윕 x 약탈자
//   npm run probe -- era0         첫 시대 한 판 전체(실제 일정) · 단계별 개체 수 + 사망 원인 전 항목
//   npm run probe -- encounter    내 종과 가장 가까운 포식자의 초기 거리 · 첫 감지 시각
//   npm run probe -- steps        온보딩 진도 0~3 의 세계를 나란히(종 수·지형 비율·맵 치수·개체 수)
//   npm run probe -- growth       한 런 전체(시대 0~4 · 정복까지) · 카드 장 수 · 정점 도달 시점 · 시대별 위험
//   npm run probe -- econ         방울(유전자 점수) 출처 실측 — 티어 가격표의 재료(수입 쪽)
//                                 + 방울 회수율(표3). `--drive` 로 지시가 걸린 판을,
//                                 `--generadius=<값>` 으로 방울 우선 반경을 잰다.
//                                 ⚠ 반경을 여럿 비교할 땐 **반경마다 따로 실행**한다. 쉼표 스윕
//                                 (`--generadius=0,80,160`)은 앞 묶음의 업적 해금이 뒤 묶음에 새어
//                                 값을 오염시킨다(runEcon 의 경고 주석 참조).
//   옵션: --seeds=6 --presets=omni,herd --boss=raider --era=0 --step=2
//   growth·econ 전용: --policy=first|rarity|focus|random --veteran(끝낸 런 3 = 늘 진도 3)
//                     (v9 어법 · rarity=등급이 가장 높은 장 · focus=내가 판 범주를 돕는 장.
//                      옛 이름 best·apexrush 는 경고와 함께 rarity·focus 로 옮겨 준다.)
//
// ⚠ **멈춰 세운 모드 셋**(apex · scale · tiers). 부르면 「무엇을 재던 자였고 왜 죽었는지 · 지금은
//   무엇을 쓰면 되는지」만 찍는다. 없는 자를 있는 척 남기지 않는다 · 그게 이 저장소가 네 번 겪은
//   「잘못된 자로 잰 값」 사고의 입구다. 자세한 이유는 각 함수의 주석에 있다.
//
// ⚠ **「누구의 판을 재는가」 축 넷** (era0 · growth · econ 에 걸린다 · 머리글에 늘 찍힌다):
//   --assist          은근한 보정을 **켠다**. 기본은 **끔**이다.
//   --metaxp=<수>     저장본의 누적 메타 경험치(플레이어 레벨의 원천). 기본 0 = 첫 판.
//   --reroll          드래프트에서 「다시 뽑기」를 쓴다(메타 레벨이 낮으면 아직 안 열려 있다 ·
//                     못 열린 채로 주면 머리글과 경고가 그 사실을 찍고 필요한 --metaxp 를 알려 준다).
//                     기준은 「내가 파는 범주가 하나도 안 뜬 드래프트」 = 게임이 dryDrafts 로 세는 자리.
//   --veteran         끝낸 런 3 = 늘 진도 3(숙련자의 세계).
//
//   왜 보정이 기본 끔인가: CLAUDE.md 「은근한 보정」의 기술 제약이다 ▸ "프로브에서는 보정을 끌 수
//   있어야 한다. 보정을 켠 채 밸런스를 재면 **측정한 난이도가 실제 난이도가 아니다.**"
//   2026-08-08 감사에서 드러났듯, 스위치가 game.ts 에 있었는데도 **어떤 프로브도 끄지 않고 있었다**
//   (기본값 true) — 그래서 지금까지의 모든 성장 수치가 「도움을 받은 판」이었다.
//
//   왜 나머지 축인가: 상설 프로브가 전부 `runsCompleted 0 · metaXp 0 · 리롤 없음` 으로만 돌아
//   **첫 판 플레이어 한 명**만 재고 있었다. 제보자는 첫 판 플레이어가 아니다. 이 축 하나로
//   「시대 2 에 4단」이 23% → 76% 로 뛴다(2026-08-08 실측).
//
// ⚠ **온보딩 진도(step)를 반드시 의식하라.** 진도마다 세계가 다르다: 맵 크기(mapScale)·종 구성
//   (진도 0 은 셋)·세계 종류(진도 0~1 은 초원)·챔피언 유무. 척박도만 시대(era)를 따른다.
//   진도 = min(3, 끝낸 런 수 + 시대)이고, 프로브는 **처음 하는 사람**(끝낸 런 0)을 기준으로 하므로
//   `--era=N` 이 곧 진도 N 이다. 진도만 따로 보려면 `--step=N`(이때 척박도는 --era 를 따른다).
//   세계 생성은 game.ts 의 makeWorld 를 그대로 옮긴 buildWorld() 한 자리로 모아 뒀다.

import { createServer } from "vite";

const args = process.argv.slice(2);
const MODE = args.find((a) => !a.startsWith("--")) ?? "order";
const FULL = args.includes("--full"); // 격퇴 뒤에도 라운드를 끝까지 돌린다(사망 수 회귀 비교용)
const opt = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};

// --- 「누구의 판을 재는가」 축 ---------------------------------------------------------------
// 이 넷은 **머리글에 반드시 찍힌다**(`axisLine`). 숨은 가정이 곧 다음 사고다 — 이 저장소는 잘못된
// 자로 잰 값 때문에 이미 세 번 헛짚었다(시드 절단 · 시대 보상 모델 누락 · 위기 감시자 수명).
/** 은근한 보정(draftBias). **기본은 끔** — 켠 채로 재면 측정한 난이도가 실제 난이도가 아니다. */
const ASSIST = args.includes("--assist");
/** 저장본의 누적 메타 경험치 = 플레이어 레벨의 원천(열린 카드·갈래·리롤을 정한다). 기본 0 = 첫 판. */
const METAXP = Number(opt("metaxp", "0"));
/** 드래프트에서 「다시 뽑기」를 실제로 쓰는가(열려 있을 때만). 기본 안 씀. */
const USE_REROLL = args.includes("--reroll");
/** 저장본의 「끝낸 런 수」 — 온보딩 진도(min(3, 끝낸 런 + 시대))와 보정 감쇠의 재료.
 *  ⚠ 인자 이름이 `--runsdone=` 인 이유: tiers 모드가 `--runs=`(몬테카를로 횟수)를 이미 쓴다. */
const RUNS_DONE = args.includes("--veteran") ? 3 : Number(opt("runsdone", "0"));

// --- 저장본(localStorage) 흉내 ---------------------------------------------------------------
// **왜 필요한가.** 온보딩 진도 = min(3, 끝낸 런 수 + 시대)이고 "끝낸 런 수"는 저장본에서 온다.
// node 에는 localStorage 가 없어 프로브는 늘 "처음 하는 사람"(진도 = 시대)이었다 — 그래서 **숙련자의
// 세계**(늘 진도 3)를 한 번도 잰 적이 없다. 메모리 저장소를 심어 그 세계를 만들 수 있게 한다.
// meta.ts 는 `typeof localStorage !== "undefined"` 만 보므로 전역에 얹으면 그대로 읽는다.
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => void memStore.set(k, String(v)),
  removeItem: (k) => void memStore.delete(k),
  clear: () => memStore.clear(),
};
/** 이 판을 시작하기 전 저장본을 이 상태로 맞춘다(런마다 반드시 다시 부른다 · endRun 이 값을 늘린다). */
function setSavedProgress(runsCompleted, metaXp) {
  memStore.clear();
  memStore.set(
    "selpress_meta_v1",
    JSON.stringify({ metaXp, conquered: false, runsCompleted }),
  );
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

const { World } = await server.ssrLoadModule("/src/sim/world.ts");
const { SIM, ORDER } = await server.ssrLoadModule("/src/sim/params.ts");
// **방울 우선 반경**(ORDER.geneRadius)을 실측으로 정하기 위한 손잡이. 안 주면 게임 값 그대로다.
// 값 하나면 여기서 전역으로 덮어쓰고, 쉼표 목록이면 econ 모드가 값마다 한 번씩 돌린다.
// ⚠ 반경 비교는 **반경마다 별도 프로세스**로 하라 · 쉼표 목록이 내는 값은 오염된다(runEcon 의 경고).
// ⚠ `as const` 는 타입에만 걸리므로 런타임 객체는 그냥 바뀐다. 프로브에서만 쓰는 문이다.
const GENE_RADIUS_ARG = opt("generadius", "");
if (GENE_RADIUS_ARG !== "" && !GENE_RADIUS_ARG.includes(",")) ORDER.geneRadius = Number(GENE_RADIUS_ARG);
const {
  GAME, SCHEDULE, mapScale, eraScarcity, eraDifficulty, eraPredatorPressure,
  // ⚠ `eraRewardBoostAt`(시대 보상 강화 배수)은 v9 에서 **가져오지 않는다.** 곱할 도장이 없어져
  //   보상 카드는 이제 「그냥 한 장 더 고르는 기회」다. 머리글에 그 배수를 찍고 있으면 화면이
  //   일어나지 않는 일을 약속한다(config.ts 에는 함수가 남아 있지만 아무도 안 곱한다).
  bossPassNeeded, extinctionPassNeeded, onboardingStep, stepUsesDrawnMap, stepWorldOptions,
  EXTINCTION,
} = await server.ssrLoadModule("/src/game/config.ts");
const { createBoss, bossRaidable } = await server.ssrLoadModule("/src/sim/boss.ts");
// 몰기(무리 지시)를 흉내 내려면 게임과 **같은 함수**로 목소리 반경·지휘 공백을 넣어야 한다.
// 프로브가 임의의 숫자를 넣으면 "몰면 산다"를 게임과 다른 조건에서 재게 된다.
const { voiceRadius, vacuumTicks } = await server.ssrLoadModule("/src/sim/herdOrder.ts");
const { defaultGenome, refreshDerived, genomeFromPips, TRAIT_LABELS } = await server.ssrLoadModule("/src/sim/genome.ts");
// v8 — 성장은 형질 숫자가 아니라 **도장과 티어**로 잰다. 이 모듈이 그 단일 진실이다.
const {
  CATEGORIES, CATEGORY_LABELS, TIER_STEPS, MAX_TIER, tiersOf, tierSum,
  emptyPips, emptyKeys,
} = await server.ssrLoadModule("/src/sim/tiers.ts");
// 듀오는 「열림」(activeDuos=openDuos · 도장)과 「가짐」(ownedDuos · 고른 카드)이 다르다(2026-08-10).
// growth 표의 「듀오」는 가진 것을 세야 한다 · 열림을 세면 카드를 안 골라도 센다(과대집계 · 2026-08-11 수정).
const { ownedDuos } = await server.ssrLoadModule("/src/sim/perks.ts");
// v9 · 카드는 **도장을 안 준다**(특성과 열쇠만 준다 · `game/cards.ts` 파일 머리).
// ⚠ `ssrLoadModule` 은 **없는 export 를 조용히 `undefined` 로 준다.** 그래서 지워진 함수를 여기에
//   적어 두면 import 는 통과하고 **한참 뒤 실행 중에 TypeError 로 죽는다**(2026-08-10 에 세 모드가
//   그렇게 즉사했다: `cardCrossesThreshold`·`boostCard`). 여기 이름을 지울 때는 쓰던 자리도 함께 본다.
const {
  PRESET_CARDS, applyCard, CARD_POOL, RARITY_WEIGHT,
  // 「내가 판 방향의 카드인가」의 **단일 진실**. 게임의 뽑기 보정·dryDrafts 가 부르는 바로 그 함수다.
  // 여기에 조건을 다시 적으면 게임과 프로브가 갈라진다(이 저장소가 반복해서 데인 자리).
  cardFavorsCategory, cardRarity,
} = await server.ssrLoadModule("/src/game/cards.ts");
// 방울(유전자 점수)의 「위기 회복」 판정 · **게임과 같은 상태 기계를 그대로 부른다.** 프로브가 규칙을
// 다시 적으면 두 곳이 조용히 어긋나고, 그때 재는 난이도는 사람이 겪는 난이도가 아니게 된다.
const { CRISIS_BACK, CRISIS_LOW, createCrisisWatch, stepCrisisWatch } =
  await server.ssrLoadModule("/src/sim/gene.ts");
const { Rng } = await server.ssrLoadModule("/src/sim/rng.ts");
const { FIRST_ERA_MAP } = await server.ssrLoadModule("/src/sim/mapType.ts");
const { TILE } = await server.ssrLoadModule("/src/sim/terrain.ts");
const { Game } = await server.ssrLoadModule("/src/game/game.ts");
const { debugResetAchievements } = await server.ssrLoadModule("/src/game/achievements.ts");
// 판 분석 코드(런 코드) — `replay` 모드가 사람이 보낸 판을 그대로 되살리는 데 쓴다.
const {
  decodeRunCode, currentCodeStamp, baseCardId, DRAFT_SKIPPED, DRAFT_REROLLED, DRAFT_NONE,
} = await server.ssrLoadModule("/src/game/runCode.ts");
// 메타 레벨·리롤 해금은 **게임과 같은 함수**로 읽는다. 프로브가 "레벨 2 면 리롤" 같은 숫자를 손으로
// 적으면 해금 사다리(meta.ts UNLOCK_TIERS)를 바꿨을 때 프로브만 옛 사다리로 재게 된다.
const { metaLevel, isRerollUnlockedAtLevel, xpForLevelStart, UNLOCK_TIERS } =
  await server.ssrLoadModule("/src/game/meta.ts");
/** 리롤이 열리는 메타 경험치 — 해금 사다리에서 직접 읽는다(숫자를 손으로 적으면 사다리와 갈린다). */
const REROLL_XP = xpForLevelStart(UNLOCK_TIERS.find((t) => t.reroll)?.atLevel ?? 999);

// --- 실제 플레이 세계 치수 · 단일 근원 src/config.ts + mapScale(진도) 에서 읽는다(main.ts 와 같은 길) ---
const { MOBILE } = await server.ssrLoadModule("/src/config.ts");
const ERA = Number(opt("era", "0")); // 기본은 첫 시대(지금 튜닝 대상). 옛 대륙 세계는 --era=3.
// 프로브 기준은 **처음 하는 사람**(끝낸 런 0)이라 진도 = 시대다. --step 으로 따로 지정할 수 있다.
const STEP = Number(opt("step", String(onboardingStep(0, ERA))));
const SCALE = mapScale(STEP);
const W = Math.round(MOBILE.width * SCALE);
const H = Math.round(MOBILE.height * SCALE);
const AREA_SCALE = SCALE * SCALE;

/** 이 진도가 쓰는 세계 종류(진도 0~1 은 평평한 「초원」 · 그 뒤는 뽑힌 세계 · 기본 대륙). */
function mapTypeForStep(step) {
  return stepUsesDrawnMap(step) ? opt("map", "continent") : FIRST_ERA_MAP;
}

/**
 * 이 진도의 세계를 만든다 — **game.ts 의 makeWorld 와 같은 인자**로. 진도 0~1 은 좁힌 세계(종 셋·넷 ·
 * 평평한 초원 · 챔피언 없음)이고 그 뒤로는 뽑힌 맵 종류다. 프로브가 존재하지 않는 세계를 재던
 * 2026-08-04 사고의 재발 방지선이 여기다.
 */
function buildWorld(seed, genome, mapTypeOverride, step = STEP, scale = SCALE, era = ERA) {
  return new World(
    seed,
    Math.round(MOBILE.width * scale),
    Math.round(MOBILE.height * scale),
    genome,
    scale * scale,
    [], // 챔피언 — 마지막 진도 전에는 없음이 정상. 그 뒤는 저장본에 달려 프로브에선 재현 불가 → 늘 없음.
    mapTypeOverride ?? mapTypeForStep(step),
    eraScarcity(era),
    // game.makeWorld 와 같은 형태 — 시대별 포식 압력도 함께 넘긴다(안 넘기면 --era=3 세계가 실제보다 순하다).
    { ...stepWorldOptions(step), predatorPressure: eraPredatorPressure(era) },
  );
}

// --- 「누구의 판인가」를 게임에 실제로 심는 자리 -----------------------------------------------
//
// **프로브가 `new Game(...)` 을 직접 부르지 않는다.** 여기 하나를 거친다 — 그래야 새 축(보정 같은)이
// 생겼을 때 "여기서도 꺼야 하는데 안 껐다"가 원리적으로 안 생긴다. (2026-08-08 감사에서 드러난 것이
// 정확히 그것이다: `assistEnabled` 스위치는 있었는데 다섯 군데의 `new Game` 중 어디도 안 껐다.)
/** 프로브가 쓰는 Game — 은근한 보정은 기본 끔(`--assist` 로만 켠다). */
function newGame(fixedMapScale) {
  const g = new Game(MOBILE.width, MOBILE.height, fixedMapScale);
  g.assistEnabled = ASSIST;
  return g;
}

/** 리롤이 이 메타 경험치에서 실제로 열려 있는가 — 게임과 같은 함수(meta.ts)로 묻는다. */
function rerollUnlocked() {
  return isRerollUnlockedAtLevel(metaLevel(METAXP));
}

/**
 * **내가 파는 방향** = 도장이 가장 많은 한둘(도장이 하나도 없으면 방향이 없다).
 *
 * ⚠ **게임의 `Game.draftBias()` 가 고르는 것과 같은 한둘이어야 한다.** 「내 방향이 떴는가」를
 *   게임은 `dryDrafts` 로 세고 프로브는 리롤 판정에 쓰는데, 두 곳이 다른 범주를 보면 프로브의
 *   리롤 축이 게임에 없는 자리에서 걸린다(= 사람이 안 하는 짓을 재게 된다).
 */
function digCategories(pips) {
  return CATEGORIES.filter((c) => pips[c] > 0)
    .sort((a, b) => pips[b] - pips[a])
    .slice(0, 2);
}

/**
 * 리롤 정책 · `--reroll` 일 때만. **「내가 파는 범주를 돕는 장이 하나도 안 뜬 드래프트」일 때** 한 번
 * 다시 뽑는다. 사람이 실제로 리롤을 누르는 자리가 「내 길이 하나도 없을 때」이고, 그건 게임 자신이
 * `dryDrafts` 로 세는 자리와 같다.
 *
 * ⚠ **v9 에서 판정 근거가 바뀌었다.** v8 은 「그 범주에 도장을 주는 장이 있는가」로 봤는데, v9 의
 *   카드는 **도장을 안 준다** · 그대로 두면 그 조건이 늘 거짓이라 `--reroll` 이 **모든 드래프트를
 *   리롤한다**(era0 는 크래시가 안 나므로 틀린 값이 조용히 나왔다 · 2026-08-10 교차 점검).
 *   지금은 「내가 판 방향인가」의 단일 진실인 `cardFavorsCategory` 를 **게임과 같은 함수로** 부른다.
 *   여기에 조건을 다시 적으면 게임과 프로브가 갈라진다(이 저장소가 반복해서 데인 자리).
 *
 * 결정론: 뽑기는 game.draftRng 로만 도므로 같은 시드 + 같은 정책 = 같은 결과.
 */
function maybeReroll(game) {
  if (!USE_REROLL || !game.canReroll) return false;
  const dig = digCategories(game.pipsNow);
  if (dig.length === 0) return false; // 방향이 없으면 「내 길이 없다」는 말도 성립하지 않는다
  if (game.draftCards.some((c) => dig.some((cat) => cardFavorsCategory(c, cat)))) return false;
  game.reroll();
  return true;
}

/** Game 을 태우는 모드 — 아래 축이 실제로 결과를 바꾸는 모드들. */
const GAME_MODES = new Set(["era0", "growth", "econ"]);

/**
 * **무엇을 잰 것인가** 한 줄. 모든 모드의 맨 위에 찍는다.
 * 이 줄이 없으면 「첫 판 플레이어 · 보정 켬」으로 잰 값이 「이 게임의 난이도」로 보고된다.
 */
function axisLine() {
  const lvl = metaLevel(METAXP);
  const reroll = USE_REROLL
    ? rerollUnlocked()
      ? "씀(내가 파는 범주가 하나도 안 뜬 드래프트에서 한 번)"
      : `쓰려 했으나 **잠김**(레벨 ${lvl}) · --metaxp=${REROLL_XP} 이상 필요`
    : "안 씀";
  const tail = GAME_MODES.has(MODE) ? "" : " · (이 모드는 Game 을 안 태운다 · 위 축은 결과에 안 닿는다)";
  return (
    `# 축 · 은근한 보정 ${ASSIST ? "켬(--assist)" : "끔(기본)"} · ` +
    `메타 경험치 ${METAXP}(플레이어 레벨 ${lvl}) · 끝낸 런 ${RUNS_DONE} · 리롤 ${reroll}${tail}`
  );
}

// 시드 목록. **앞 16개의 순서를 절대 바꾸지 않는다** — 과거 측정과 비교하려면 --seeds=8·16 이
// 예전과 똑같은 시드를 뽑아야 한다. 뒤에 이어 붙이기만 한다.
// (예전엔 16개뿐이라 `--seeds=48` 을 줘도 조용히 16으로 잘렸다. 머리글의 「시드 N」만 그 사실을
//  말해 줘서, 48시드로 쟀다고 착각한 보고가 여러 번 나왔다. 표본이 16이면 도달 시대가 ±0.4 씩
//  흔들려 결론이 뒤집힌다 — 2026-08-07 밸런스 실험에서 실제로 뒤집혔다.)
const SEEDS_ALL = [
  "p-1", "p-2", "p-3", "p-4", "p-5", "p-6", "p-7", "p-8",
  "p-9", "p-10", "p-11", "p-12", "p-13", "p-14", "p-15", "p-16",
  "p-17", "p-18", "p-19", "p-20", "p-21", "p-22", "p-23", "p-24",
  "p-25", "p-26", "p-27", "p-28", "p-29", "p-30", "p-31", "p-32",
  "p-33", "p-34", "p-35", "p-36", "p-37", "p-38", "p-39", "p-40",
  "p-41", "p-42", "p-43", "p-44", "p-45", "p-46", "p-47", "p-48",
  "p-49", "p-50", "p-51", "p-52", "p-53", "p-54", "p-55", "p-56",
  "p-57", "p-58", "p-59", "p-60", "p-61", "p-62", "p-63", "p-64",
  "p-65", "p-66", "p-67", "p-68", "p-69", "p-70", "p-71", "p-72",
  "p-73", "p-74", "p-75", "p-76", "p-77", "p-78", "p-79", "p-80",
  "p-81", "p-82", "p-83", "p-84", "p-85", "p-86", "p-87", "p-88",
  "p-89", "p-90", "p-91", "p-92", "p-93", "p-94", "p-95", "p-96",
];
const SEEDS_WANT = Number(opt("seeds", "8"));
const SEEDS = SEEDS_ALL.slice(0, SEEDS_WANT);
// 조용히 자르지 않는다. 잘린 것을 모르면 「48시드로 쟀다」고 적어 놓고 실제로는 16시드인 보고가
// 나오고, 그 수치가 다음 세션의 목표가 된다(2026-08-07 에 실제로 그랬다).
if (SEEDS_WANT > SEEDS_ALL.length) {
  console.error(
    `\n⚠ --seeds=${SEEDS_WANT} 를 줬지만 시드 풀은 ${SEEDS_ALL.length}개뿐이라 ` +
      `${SEEDS_ALL.length}개로 잘렸다. 보고에 시드 수를 적을 때 이 값을 쓸 것.\n` +
      `  더 넓게 재려면 SEEDS_ALL 뒤에 이어 붙여라(앞 순서는 절대 건드리지 말 것).\n`,
  );
}
// --- 「위기 회복」의 정의 (econ 모드 · 방울 출처 하나) ---------------------------------------
// 개체 수가 최고 기록의 CRISIS_FRAC 아래로 떨어졌다가 RECOVER_FRAC 위로 돌아오면 한 번으로 센다.
//
// ⚠ **판정 자체는 여기 없다.** 게임과 같은 `sim/gene.ts` 의 `stepCrisisWatch` 를 그대로 부른다
//   (위 import). 예전엔 이 파일이 상태 기계를 따로 짰고, 그래서 「정확히 절반」에서 게임은 위기가
//   아니라 하고 프로브는 위기라고 세는 어긋남이 이미 나 있었다(프로브 `<=` · 게임 `<`).
//   아래 셋은 **그 판정에 넣을 선의 값**일 뿐이다 · 규칙이 아니라 눈금이다.
const CRISIS_FRAC = Number(opt("crisis", String(CRISIS_LOW))); // 최고의 이 비율 아래로 떨어지면 위기
const RECOVER_FRAC = Number(opt("recover", String(CRISIS_BACK))); // 최고의 이 비율 위로 돌아오면 회복
// 최고가 이만큼은 돼야 위기를 센다(판 시작 직후의 출렁임 제외). 기본값도 게임이 쓰는 값에서 읽는다 ·
// 여기에 20 을 손으로 적어 두면 게임 쪽 문턱을 바꿨을 때 프로브만 옛 문턱으로 재게 된다.
const CRISIS_MIN_PEAK = Number(opt("crisismin", String(GAME.geneCrisisMinPeak)));

const BOSS_HORDES = ["swarm", "raider", "isolation", "stalker", "hornet"];
// 틱. 무리가 자리를 잡고 흩어진 뒤 (라운드 중반과 비슷한 상태).
// ⚠ `--warmup=3540` 처럼 늘리면 **이미 여러 단계를 굴린 판**(먹이가 깎인 세계)을 잴 수 있다.
// 대멸종은 한 판의 **마지막** 단계라, 600틱짜리 갓 만든 세계로 재면 실제보다 훨씬 순하게 나온다
// (2026-08-09: 그래서 프로브는 통과 0/8 인데 사람은 전멸했다).
const WARMUP = Number(opt("warmup", "600"));

function presetGenome(card) {
  const g = defaultGenome();
  applyCard(g, card);
  return g;
}

const PRESETS = PRESET_CARDS.map((c) => ({
  key: c.id.replace("preset_", ""),
  name: c.name,
  genome: presetGenome(c),
}));

function pickPresets() {
  const want = opt("presets", "");
  if (want === "") return PRESETS;
  const keys = want.split(",");
  return PRESETS.filter((p) => keys.includes(p.key));
}

function mine(w) {
  const out = [];
  for (const e of w.entities) if (e.alive && e.species.isPlayer) out.push(e);
  return out;
}

function centroid(list) {
  if (list.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const e of list) {
    sx += e.x;
    sy += e.y;
  }
  return { x: sx / list.length, y: sy / list.length };
}

function fmt(v, d = 1) {
  return Number.isFinite(v) ? v.toFixed(d) : "-";
}

/** 표본이 적으면 숫자 대신 이렇게 찍는다 (합친 비율로 속지 않기 위한 규칙 2). */
function cell(values, digits = 1) {
  if (values.length < 5) return `표본 부족(${values.length})`;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return fmt(m, digits);
}

// ────────────────────────────────────────────────────────────────────────────
// order 모드 · "내 말을 듣는가"
// ────────────────────────────────────────────────────────────────────────────
async function runOrder() {
  const presets = pickPresets();
  const ORDER_TICKS = 480; // 16초 = 채집 라운드 한 판(GAME.roundSeconds)
  const MARKS = [30, 150, 480]; // 1초 · 5초 · 16초
  const ORDER_DIST = Number(opt("dist", "600")); // 지시점까지의 거리(px)
  // **방울 우선의 값과 대가를 한 판에서 같이 재는 자리** (**[사용자 2026-08-09]**).
  // `--genedrops=N` 이면 지시를 내리기 직전에 방울 N 개를 **게임과 같은 길**(spawnGeneDropNear ·
  // 전용 geneRng · 무리 곁의 고리)로 놓는다. 그러면 같은 시드·같은 세계에서 반경만 바꿔 가며
  // 「회수율은 얼마나 오르고 순종·도착은 얼마나 깎이는가」를 나란히 볼 수 있다.
  // 0(기본)이면 spawnGeneDropNear 를 한 번도 안 불러 예전과 완전히 같은 판이다.
  const GENE_DROPS = Number(opt("genedrops", "0"));

  console.log(`# order · era ${ERA} · 진도 ${STEP} · 세계 ${W}x${H}(배율 ${SCALE}) · areaScale ${AREA_SCALE} · 시드 ${SEEDS.length} · 워밍업 ${WARMUP}틱 → 지시 ${ORDER_TICKS}틱`);
  console.log(`# ORDER.pull=${ORDER.pull} arriveRadius=${ORDER.arriveRadius} geneRadius=${ORDER.geneRadius} · 방울 ${GENE_DROPS}개`);
  console.log(
    [
      "프리셋".padEnd(18),
      "순종1s", "순종5s", "순종16s", // orderFollowers / 내 종 수 (지시를 향해 실제로 당겨진 개체)
      "도착16s", // 도착 반경 안 비율
      "절반도달", // 무게중심이 처음 거리의 절반까지 온 시드 수
      "방울회수%", // 놓은 방울 중 16초 안에 주워진 비율(--genedrops 를 줬을 때만)
      "먹이", "사냥", "새끼", // 지시를 준 480틱 동안의 시험 계수
      "대조먹이", "대조사냥", "대조새끼", // 지시를 안 준 같은 세계의 같은 구간
    ].join("\t"),
  );

  for (const p of presets) {
    const obey = [[], [], []];
    const arrived = [];
    let halfReached = 0;
    const counts = { feeds: [], hunts: [], births: [] };
    const ctrl = { feeds: [], hunts: [], births: [] };
    const geneRate = [];

    for (const seed of SEEDS) {
      // (1) 지시를 준 세계
      const w = buildWorld(seed, p.genome);
      for (let i = 0; i < WARMUP; i++) w.step();
      // ⚠ **알파와 목소리 반경을 반드시 세운다.** 이게 없으면 `behavior` 의 지시 블록이 통째로 안 돈다
      //   (`world.voiceR > 0` 게이트). 실제로 이 모드는 오랫동안 순종률을 0.0/0.0/0.0 으로 찍고 있었고,
      //   지시를 준 판의 시험 계수가 **대조군과 소수점까지 같았다**(70.2/1.6/14.4 vs 70.2/1.6/14.4) ·
      //   "명령을 준 세계"를 잰다면서 명령이 한 번도 안 걸린 세계를 재고 있었던 것이다.
      //   game.ts 가 매 단계 하는 것과 같은 함수를 부른다(숫자를 여기 손으로 적으면 또 갈린다).
      w.armLead();
      w.voiceR = voiceRadius(p.genome.pips, p.genome.keys);
      w.vacuumOnLeadDeath = vacuumTicks(p.genome.pips);
      const c0 = centroid(mine(w));
      if (c0 === null) continue;
      const t = p.genome.traits;
      const canSwim = t.swimming >= SIM.swimThreshold;
      const canLand = t.swimming < SIM.aquaticOnlyThreshold;
      const canFly = t.wings >= SIM.flyThreshold;
      // 목표는 **맵 중심 쪽으로 ORDER_DIST px 떨어진 한 점**(통행 가능한 자리로 스냅).
      // 맵 반대편으로 잡으면 최대 1900px 이라 16초(480틱 × 속도 ~1.7px)로는 **물리적으로 못 간다** ·
      // 그러면 "안 따른다"와 "못 간다"가 섞여 지표가 무의미해진다. 600px 는 폰 한 화면 남짓의 탭 거리다.
      const cx = W * 0.5;
      const cy = H * 0.5;
      const vlen = Math.hypot(cx - c0.x, cy - c0.y) || 1;
      const target = w.terrain.nearestPassable(
        Math.min(W - 10, Math.max(10, c0.x + ((cx - c0.x) / vlen) * ORDER_DIST)),
        Math.min(H - 10, Math.max(10, c0.y + ((cy - c0.y) / vlen) * ORDER_DIST)),
        canSwim,
        canLand,
        canFly,
      );
      const d0 = Math.hypot(c0.x - target.x, c0.y - target.y);

      w.resetRoundCounts();
      // 방울은 **지시 직전에** 놓는다 · 게임에서도 사건이 나면 무리 곁에 떨어지고 그 뒤에 사람이 탭한다.
      for (let k = 0; k < GENE_DROPS; k++) w.spawnGeneDropNear(3, "boss");
      w.herdOrder = target;
      let mark = 0;
      let half = false;
      for (let i = 1; i <= ORDER_TICKS; i++) {
        w.step();
        const list = mine(w);
        if (list.length === 0) break;
        if (mark < MARKS.length && i === MARKS[mark]) {
          obey[mark].push(w.orderFollowers / list.length);
          mark += 1;
        }
        const c = centroid(list);
        if (c !== null && Math.hypot(c.x - target.x, c.y - target.y) <= d0 * 0.5) half = true;
      }
      if (half) halfReached += 1;
      const list = mine(w);
      if (list.length > 0) {
        let inR = 0;
        for (const e of list) if (Math.hypot(e.x - target.x, e.y - target.y) <= ORDER.arriveRadius) inR += 1;
        arrived.push(inR / list.length);
      }
      counts.feeds.push(w.roundCounts.feeds);
      counts.hunts.push(w.roundCounts.hunts);
      counts.births.push(w.roundCounts.births);
      if (w.geneDrops.length > 0) {
        geneRate.push((100 * w.geneDrops.filter((d) => d.taken).length) / w.geneDrops.length);
      }

      // (2) 대조군 · 같은 시드·같은 게놈, 지시만 안 준다
      const c2 = buildWorld(seed, p.genome);
      for (let i = 0; i < WARMUP; i++) c2.step();
      c2.resetRoundCounts();
      for (let i = 0; i < ORDER_TICKS; i++) c2.step();
      ctrl.feeds.push(c2.roundCounts.feeds);
      ctrl.hunts.push(c2.roundCounts.hunts);
      ctrl.births.push(c2.roundCounts.births);
    }

    console.log(
      [
        p.name.padEnd(18),
        cell(obey[0].map((v) => v * 100), 1),
        cell(obey[1].map((v) => v * 100), 1),
        cell(obey[2].map((v) => v * 100), 1),
        cell(arrived.map((v) => v * 100), 1),
        `${halfReached}/${SEEDS.length}`,
        geneRate.length === 0 ? "-" : cell(geneRate, 1),
        cell(counts.feeds), cell(counts.hunts), cell(counts.births),
        cell(ctrl.feeds), cell(ctrl.hunts), cell(ctrl.births),
      ].join("\t"),
    );
  }
  console.log(`# 합격선(시험): 먹이 ${GAME.trialFeedN} · 사냥 ${GAME.trialHuntN} · 새끼 ${GAME.trialBirthN}`);
}

// ────────────────────────────────────────────────────────────────────────────
// raid 모드 · "격퇴 바가 실제로 움직이는가"
// ────────────────────────────────────────────────────────────────────────────
/**
 * 보스 라운드 한 판. 지표는 "라운드 중 최소 체력 비율"(사용자가 보는 바의 양).
 * drive=true 면 **사람이 무리를 떼 쪽으로 계속 모는 것**을 흉내 낸다(매 틱 떼 무게중심으로 지시).
 * 지시가 실제로 먹히는지 + 붙이면 깎이는지를 한 판에서 같이 보는 유일한 방법이다.
 */
function raidRound(genome, type, seed, diffMul, mapType, drive = false) {
  const w = buildWorld(seed, genome, mapType);
  for (let i = 0; i < WARMUP; i++) w.step();
  w.boss = createBoss(type, W, H, w.terrain, diffMul, true);
  const maxHp = w.boss.maxHp;
  let minRatio = 1;
  let melee = 0;
  let ranged = 0;
  let killed = false;
  const ticks = GAME.bossSeconds * SIM.stepsPerSecond;
  for (let i = 0; i < ticks; i++) {
    if (drive && w.boss !== null) {
      const ms = w.boss.members;
      if (ms.length > 0) {
        let mx = 0;
        let my = 0;
        for (const m of ms) {
          mx += m.x;
          my += m.y;
        }
        w.herdOrder = { x: mx / ms.length, y: my / ms.length };
      } else w.herdOrder = { x: w.boss.x, y: w.boss.y };
    }
    w.step();
    const b = w.boss;
    if (b === null) break;
    melee = Math.max(melee, w.raidMeleeFighters ?? 0);
    ranged = Math.max(ranged, w.raidRangedFighters ?? 0);
    if (maxHp > 0) {
      const r = Math.max(0, b.hp) / maxHp;
      if (r < minRatio) minRatio = r;
      if (b.hp <= 0) {
        killed = true;
        // --full 이면 격퇴 뒤에도 끝까지 돌린다. "보스에게 죽은 내 종 수"를 HEAD 와 견줄 땐 필수다 ·
        // 격퇴 시점이 다르면 남은 틱 수가 달라져, 죽음 경로를 안 건드렸어도 사망 수가 달라 보인다.
        if (!FULL) break;
      }
    }
  }
  return { minRatio, killed, bossDeaths: w.deaths.boss, pop: w.playerPopulation, melee, ranged };
}

async function runRaid() {
  const presets = pickPresets();
  const bosses = opt("boss", "") === "" ? BOSS_HORDES : opt("boss", "").split(",");
  const diffMul = Number(opt("diff", "1"));
  const mapType = opt("map", "") === "" ? undefined : opt("map", ""); // 안 주면 이 시대의 기본 세계
  const drive = args.includes("--drive"); // 사람이 무리를 떼 쪽으로 모는 판(지시 on)

  console.log(`# raid · era ${ERA} · 진도 ${STEP} · 세계 ${W}x${H}(배율 ${SCALE}) · areaScale ${AREA_SCALE} · ${mapType ?? mapTypeForStep(STEP)} · diffMul ${diffMul} · 시드 ${SEEDS.length} · ${GAME.bossSeconds}초${drive ? " · 몰기(지시)" : " · 지시 없음"}`);
  console.log(`# 지표: 최소체력% = 라운드 중 격퇴 바가 내려간 가장 낮은 지점(사용자가 보는 양). 무흠집 = 99% 이상으로 끝난 라운드.`);
  console.log(["프리셋".padEnd(18), "보스".padEnd(10), "격퇴", "최소체력%", "무흠집", "전사(근/원)", "보스사망", "생존"].join("\t"));

  for (const p of presets) {
    for (const type of bosses) {
      const rows = [];
      for (const seed of SEEDS) rows.push(raidRound(p.genome, type, seed, diffMul, mapType, drive));
      if (rows.length === 0) continue;
      const kills = rows.filter((r) => r.killed).length;
      const untouched = rows.filter((r) => r.minRatio >= 0.99).length;
      console.log(
        [
          p.name.padEnd(18),
          type.padEnd(10),
          `${kills}/${rows.length}`,
          cell(rows.map((r) => r.minRatio * 100), 1),
          `${untouched}/${rows.length}`,
          `${fmt(rows.reduce((a, r) => a + r.melee, 0) / rows.length, 1)}/${fmt(rows.reduce((a, r) => a + r.ranged, 0) / rows.length, 1)}`,
          cell(rows.map((r) => r.bossDeaths), 1),
          cell(rows.map((r) => r.pop), 1),
        ].join("\t"),
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// poison 모드 · "독 안개를 살아서 넘을 길이 있는가"
// ────────────────────────────────────────────────────────────────────────────
//
// 왜 따로 있나: `raid` 모드는 BOSS_HORDES(떼 보스 5종)만 돌아서 **독 안개는 한 번도 프로브에 잡힌 적이
// 없었다.** 그사이 독 안개는 시대 2 부터 전 시드·전 갈래를 탈락시키고 있었다(2026-08-08 실측).
// 격퇴 체력이 0 인 보스라 raid 의 지표(최소 체력 비율)로는 애초에 잴 수도 없다 · 여기 지표는
// **끝 개체 수 · 탈락률 · 완전 멸종률**이다.
//
// 세 갈래를 **같은 시드로 나란히** 찍는다. 기준선 없이 재면 "이 갈래가 원래 못 사는 것"과 "안개가
// 죽인 것"이 구별되지 않는다(known_issues: 카운터를 절대 개체수로 재면 오독한다).
//   기준선 = 위협이 아예 없는 같은 판 · 안몲 = 안개만 얹고 손 안 댐 · 몲 = 무리를 가장 가까운 수풀로 지시
//
// 옵션: --seeds=24 --eras=0,2,4 --presets=omni,herd --drain=0.3 --shelter=0
//   --drain    프리셋의 globalDrain 을 덮어써 값을 쓸어 본다(안 주면 프리셋 값 그대로).
//   --shelter=0 수풀 피난처를 꺼서 **피난처 전/후**를 같은 자에 나란히 잰다.

/**
 * (x,y) 에서 가장 가까운 **넓은** 수풀의 한복판. 수풀이 한 칸도 없으면 null. rng 미사용 → 결정론.
 *
 * ⚠ 그냥 "가장 가까운 수풀 타일"을 찍으면 안 된다. 타일은 20px 인데 지시 해제 반경(ORDER.releaseRadius)이
 *   64px 라, 한 칸짜리 수풀을 찍으면 무리가 도착하는 순간 전원이 해제 반경 안이 되어 도로 흩어진다
 *   (실측: 수풀 체류율이 맵의 수풀 비율 24% 와 똑같았다 = 몬 효과가 0). 사람이 폰에서 실제로 하는 것도
 *   "눈에 보이는 수풀 덩어리 한복판을 탭"이지 한 칸 찍기가 아니다.
 */
function grassShelterSpot(terr, x, y) {
  const cols = terr.cols;
  const rows = terr.rows;
  const isG = (cx, cy) =>
    cx >= 0 && cy >= 0 && cx < cols && cy < rows && terr.tiles[cy * cols + cx] === TILE.grass;
  const R = 3; // 7x7 창 = 반경 60px ≈ 해제 반경(64px). 이 안이 수풀이면 흩어져도 수풀 위다.
  const win = (2 * R + 1) * (2 * R + 1);
  for (const minFrac of [0.75, 0.5, 0]) {
    let best = null;
    let bestD2 = Infinity;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (!isG(cx, cy)) continue;
        if (minFrac > 0) {
          let n = 0;
          for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (isG(cx + dx, cy + dy)) n += 1;
          if (n / win < minFrac) continue;
        }
        const gx = (cx + 0.5) * terr.cellSize;
        const gy = (cy + 0.5) * terr.cellSize;
        const d2 = (gx - x) ** 2 + (gy - y) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = { x: gx, y: gy };
        }
      }
    }
    if (best !== null) return best;
  }
  return null;
}

/**
 * 독 안개 한 판. mode: "base"(위협 없음) | "still"(안 몲) | "drive"(수풀로 몲).
 * 세 갈래 모두 같은 자리에서 알파를 세운다 · `armLead` 는 rng 를 안 쓰고, 명령을 한 번도 안 주면
 * 세계가 기존과 부동소수점까지 같다(world.ts 의 followTicks·commanded 주석). 그래야 세 갈래의
 * 차이가 **오직 지시 유무**가 된다.
 */
function poisonRound(genome, seed, era, mode, drainOverride, shelterOn) {
  const step = onboardingStep(0, era);
  const scale = mapScale(step);
  const w = Math.round(MOBILE.width * scale);
  const h = Math.round(MOBILE.height * scale);
  const world = buildWorld(seed, genome, undefined, step, scale, era);
  for (let i = 0; i < WARMUP; i++) world.step();
  world.armLead();
  world.voiceR = voiceRadius(genome.pips, genome.keys);
  world.vacuumOnLeadDeath = vacuumTicks(genome.pips);

  const diffMul = eraDifficulty(era);
  if (mode !== "base") {
    world.boss = createBoss("poison", w, h, world.terrain, diffMul, true);
    if (drainOverride !== null) world.boss.globalDrain = drainOverride * diffMul;
    if (!shelterOn) world.boss.drainShelter = false;
  }
  let spot = null;
  if (mode === "drive") {
    const c = centroid(mine(world));
    if (c !== null) spot = grassShelterSpot(world.terrain, c.x, c.y);
  }

  const ticks = GAME.bossSeconds * SIM.stepsPerSecond;
  let grassSamples = 0;
  let grassHits = 0;
  for (let i = 1; i <= ticks; i++) {
    // 「가라」는 무기한 명령이라 사람은 한 번만 탭한다. 다만 알파가 쓰러지면 sim 이 명령을 지우므로
    // (지휘 공백) 매 틱 다시 얹어 "그 사람은 여전히 그 자리를 가리키고 있다"를 흉내 낸다.
    if (spot !== null) world.herdOrder = spot;
    world.step();
    if (i % 10 === 0) {
      for (const e of mine(world)) {
        grassSamples += 1;
        if (world.terrain.isGrass(e.x, e.y)) grassHits += 1;
      }
    }
  }
  return {
    pop: world.playerPopulation,
    grass: grassSamples === 0 ? 0 : grassHits / grassSamples,
    hasGrass: spot !== null || mode !== "drive",
  };
}

// ────────────────────────────────────────────────────────────────────────────
// extinction — **대멸종 넷을 같은 자로 잰다.**
//
// 왜 이 자가 필요했나(2026-08-09). 같은 사고가 두 번 났다:
//   · 독 안개(2026-08-08) — 예고는 「공격력이나 원거리로 잡으세요」였는데 격퇴가 아예 없었다.
//   · 한파(2026-08-09) — 예고는 「대사가 낮으면 얼어 죽습니다」인데, 실제로는 **야생을 84% 지워**
//     먹이 사슬을 끊어서 육식 무리를 **굶겨** 죽였다(사용자 판: 사망 원인 굶음 76 대 추위 25).
// 둘 다 「재난이 예고한 방식으로 죽이는가」를 아무도 안 재서 났다. 값만 고치면 다음 재난에서 또 난다.
//
// **이 표가 답하는 질문 셋:**
//   ① 이 재난은 예고한 방식으로 죽이는가 — `굶음` 열이 재난 직접 사인(추위·더위·역병)보다 크면
//      **예고가 거짓말**이다. 사람은 화면이 시킨 대비를 하고도 다른 이유로 죽는다.
//   ② 야생을 얼마나 지우는가 — `야생후` 가 무너지면 육식 갈래가 자동으로 굶는다. 재난의 진짜 세기는
//      내 종에 준 피해가 아니라 **생태에 준 피해**다.
//   ③ 갈래마다 공평한가 — 초식은 풀만 있으면 살고 육식은 먹잇감이 사라지면 죽는다. 같은 재난이
//      갈래에 따라 다른 게임이 되면, 그건 빌드 선택이 아니라 복불복이다.
const STRENGTH = Number(opt("strength", "1"));

function extinctionRound(genome, seed, era, kind) {
  const step = onboardingStep(0, era);
  const scale = mapScale(step);
  const world = buildWorld(seed, genome, undefined, step, scale, era);
  for (let i = 0; i < WARMUP; i++) world.step();

  const wildBefore = world.entities.filter((e) => e.alive && !e.species.isPlayer).length;
  const popBefore = world.playerPopulation;
  // 게임과 **같은 값**을 건다(game.ts 의 applyExtinction) · 여기서 숫자를 새로 지으면 다른 세계를 재게 된다.
  // `--strength=0.7` 로 네 재난의 세기를 한꺼번에 훑는다(값을 확정하기 전 스윕용) · 기본 1 = 게임 값.
  const mul = eraDifficulty(era) * STRENGTH;
  if (kind === "cold") world.globalCold = EXTINCTION.cold * mul;
  else if (kind === "heat") world.heat = EXTINCTION.heat * mul;
  else if (kind === "famine") world.foodRegrowMultiplier = 1 + (EXTINCTION.famine - 1) * mul;
  else if (kind === "plague") world.plagueRate = EXTINCTION.plague * mul;

  const before = { ...world.deaths };
  const ticks = GAME.extinctionSeconds * SIM.stepsPerSecond;
  for (let i = 0; i < ticks; i++) world.step();
  const d = {};
  for (const k of Object.keys(world.deaths)) d[k] = world.deaths[k] - (before[k] ?? 0);
  return {
    popBefore,
    pop: world.playerPopulation,
    wildBefore,
    wild: world.entities.filter((e) => e.alive && !e.species.isPlayer).length,
    starve: d.starve ?? 0,
    // 재난이 **직접** 죽인 수 — 예고가 약속한 사인이다. 굶음보다 작으면 예고가 거짓말이다.
    direct: (d.cold ?? 0) + (d.heat ?? 0) + (d.plague ?? 0),
    predation: d.predation ?? 0,
  };
}

/**
 * 이 모드가 재는 **무리의 정체**. 기본은 프리셋(= 성장 안 한 시작 게놈)인데, 시대 3 이후에는 그 무리가
 * 재난 없이도 죽으므로 재난의 세기가 안 잡힌다. `--pips=fang:25,leg:20,eye:20,hide:20,herd:22` 를 주면
 * **실제로 자란 무리**를 재고, `--keys=fin,hide,call` 로 열쇠도 심는다(판 분석 코드에서 그대로 옮긴다).
 */
function extinctionSubjects() {
  const raw = opt("pips", "");
  if (raw === "") return pickPresets();
  const pips = emptyPips();
  for (const part of raw.split(",")) {
    const [k, v] = part.split(":");
    if (k in pips) pips[k] = Number(v);
  }
  const keys = emptyKeys();
  for (const k of opt("keys", "").split(",")) if (k !== "" && k in keys) keys[k] = true;
  const t = tiersOf(pips);
  const name = CATEGORIES.map((c) => `${CATEGORY_LABELS[c][0]}${t[c]}`).join("");
  return [{ key: "pips", name: `도장 ${name}`, genome: genomeFromPips(pips, keys) }];
}

// ────────────────────────────────────────────────────────────────────────────
// replay — **사람이 보낸 판을 그대로 되살린다.**
//
// 왜 이것이 먼저인가(2026-08-09 · [사용자] 지적).
// 프로브는 「비슷한 세계」를 만들어 재 왔다. 그런데 사람이 실제로 겪은 판과 프로브가 낸 표가
// 정면으로 어긋났다(사람: 한파에 58 → 2 전멸 · 프로브: 같은 빌드가 0/8 탈락으로 통과).
// 그때 「무엇이 다른가」를 추측으로 메우면 또 틀린다 — 실제로 이 저장소에서 두 번 연달아 틀렸다.
// 판 분석 코드에는 **시드와 모든 선택**이 들어 있다. 그러니 근사치를 재지 말고 그 판을 그대로
// 다시 굴려서, 기록과 재현이 같은지 먼저 답해야 한다.
//
// **이 모드가 답하는 것은 예/아니오 하나다: 프로브는 사람과 같은 게임을 하는가.**
//   · 재현이 기록과 같다 → 시뮬·프로브 배선은 맞다. 그러면 어긋난 것은 다른 모드의 **세계 구성**이고,
//     그 모드가 무엇을 다르게 만들었는지 좁히면 된다.
//   · 재현이 기록과 다르다 → **게임과 프로브(또는 그 사이 어딘가)가 갈라져 있다.** 어긋나는 첫 줄이
//     곧 이분 지점이다. 그때는 밸런스 수치를 하나도 믿으면 안 된다.
//
// ⚠ 재현은 **축을 전부 코드에서 읽어** 맞춘다(시드·메타 레벨·끝낸 런·은근한 보정·조종).
//   프로브 기본값(보정 끔 등)을 쓰면 그 순간 다른 판이 된다 — 이 모드에서는 `--assist` 류를 안 본다.
function replayPick(game, rec) {
  if (rec.outcome === DRAFT_REROLLED) {
    game.reroll();
    return "리롤";
  }
  if (rec.outcome === DRAFT_SKIPPED) {
    game.skipDraft();
    return "건너뜀";
  }
  if (rec.outcome === DRAFT_NONE) {
    game.skipDraft();
    return "기록없음→건너뜀";
  }
  game.pickCard(rec.outcome);
  return `${rec.outcome}번`;
}

async function runReplay() {
  // `--selftest` — **재생기 자신을 검사한다.** 손이 안 붙은 판을 하나 굴려 코드를 뽑고, 그 코드를
  // 그대로 되살려 기록과 대조한다. 여기서 완전히 같지 않으면 재생기가 고장 난 것이고, 사람 판이
  // 어긋나도 그게 「게임과 프로브의 차이」인지 「재생기 버그」인지 가릴 수 없다.
  // (사람 판은 **탭이 코드에 안 담기므로** 원리적으로 완전 일치가 안 된다 · 아래 결론 참고.)
  if (args.includes("--selftest")) {
    const HANDS = args.includes("--hands");
    console.log(`# replay --selftest · ${HANDS ? "손을 붙인" : "손이 안 붙은"} 판을 굴려 코드를 뽑고, 그 코드로 되살려 대조한다`);
    debugResetAchievements();
    setSavedProgress(0, 0);
    const g0 = new Game(MOBILE.width, MOBILE.height);
    g0.assistEnabled = false;
    g0.leadEnabled = true;
    g0.fixedSeed = opt("seed", "selftest-1");
    g0.beginRun();
    const ms = 1000 / SIM.stepsPerSecond;
    const rng0 = new Rng("selftest-policy");
    let guard0 = 0;
    while (guard0 < 600000) {
      guard0 += 1;
      if (g0.phase === "draft") {
        g0.pickCard(rng0.int(0, Math.max(0, g0.draftCards.length - 1)));
        continue;
      }
      if (g0.phase === "result") {
        if (g0.result === "win" && !g0.isFinalEra) { g0.continueToNextEra(); continue; }
        break;
      }
      // **손을 붙인다** — 탭이 재현되는지 검사하려면 원판에 탭이 있어야 한다(`--hands` 로 켠다).
      // 사람처럼 가끔, 그리고 자리를 바꿔 가며 찍는다. 매 틱 찍으면 무리가 먹지도 못하고 행군만 한다.
      if (HANDS && guard0 % 90 === 0) {
        const c = centroid(mine(g0.world));
        if (c !== null) {
          const a = rng0.unit() * Math.PI * 2;
          const r = 120 + rng0.unit() * 240;
          g0.setHerdOrder(
            Math.max(4, Math.min(g0.world.width - 4, c.x + Math.cos(a) * r)),
            Math.max(4, Math.min(g0.world.height - 4, c.y + Math.sin(a) * r)),
          );
        }
      }
      for (const c of CATEGORIES) if (g0.buyTier(c)) break; // 방울이 모이면 아무거나 하나 산다
      g0.update(ms);
    }
    const code = g0.runCode();
    console.log(`# 코드 ${code.length}자 · 시드 ${g0.fixedSeed}`);
    return replayAgainst(decodeRunCode(code), "자가 검사");
  }
  const text = opt("code", "").trim();
  if (text === "") {
    console.error("판 코드를 주세요: node scripts/balance-probe.mjs replay --code=SP1-…");
    process.exitCode = 1;
    return;
  }
  return replayAgainst(decodeRunCode(text), "사람이 보낸 판");
}

/** 디코드된 판 하나를 되살려 기록과 한 줄씩 대조한다(사람 판·자가 검사가 같은 자리를 쓴다). */
function replayAgainst(dec, label) {
  // ⚠ decodeRunCode 는 실패를 { ok:false, error } 로 준다 · `reason` 칸은 없다(2026-08-11 수정 ·
  //   전에는 늘 「(이유 없음)」이 찍혀 무엇이 잘못됐는지 알 수 없었다).
  if (dec.ok !== true) {
    console.error(`이 코드를 못 읽습니다: ${dec.error ?? "(이유 없음)"}`);
    process.exitCode = 1;
    return;
  }
  const want = dec.data;
  const now = currentCodeStamp();
  console.log(`# replay · ${label} 을(를) 그대로 되살린다`);
  console.log(
    `# 코드 도장 스키마 ${want.schema} · 게놈 v${want.genomeVersion} · 카드 풀 ${want.poolDigest.toString(16)}` +
      `  ▸ 지금 빌드 스키마 ${now.schema} · 게놈 v${now.genomeVersion} · 풀 ${now.poolDigest.toString(16)}`,
  );
  if (want.genomeVersion !== now.genomeVersion || want.poolDigest !== now.poolDigest) {
    console.log("# ⚠ 도장이 다르다 — 코드를 뽑은 뒤 게놈이나 카드 풀이 바뀌었다.");
    console.log("#   어긋남이 나와도 그것이 「버그」인지 「그 사이의 변경」인지 이 줄을 보고 갈라야 한다.");
  }
  const h = want.header;
  console.log(
    `# 축 · 시드 ${h.seed} · 메타레벨 ${h.metaLevel} · 끝낸 런 ${h.runsDone} · ` +
      `보정 ${h.assistEnabled ? "켬" : "끔"} · 조종 ${h.leadEnabled ? "켬" : "끔"} · 챔피언 ${h.champions}마리`,
  );
  if (h.champions > 0) {
    console.log("# ⚠ 챔피언이 있던 판이다 — 코드는 챔피언 **수**만 담고 게놈은 안 담는다. 재현이 여기서 갈린다.");
  }

  // --- 축을 코드에서 읽어 그대로 심는다 ---
  // ⚠ **업적 캐시를 반드시 먼저 비운다.** `achievements.ts` 의 unlockedCache 는 모듈 수명이라
  //   같은 프로세스에서 판을 두 번 굴리면 앞 판이 연 카드가 뒤 판의 드래프트 풀에 남는다
  //   (2026-08-09 known_issues). 그러면 재생이 **원래 판에 없던 카드**를 후보로 받아, 어긋남이
  //   「게임과 프로브의 차이」가 아니라 프로브 자신이 만든 오염이 된다.
  debugResetAchievements();
  setSavedProgress(h.runsDone, xpForLevelStart(h.metaLevel));
  const game = new Game(MOBILE.width, MOBILE.height);
  game.assistEnabled = h.assistEnabled;
  game.leadEnabled = h.leadEnabled;
  game.fixedSeed = h.seed;
  game.beginRun();

  const drafts = want.entries.filter((e) => e.t === "draft");
  const buys = want.entries.filter((e) => e.t === "buy");
  // 사람이 내린 탭 — **재현의 마지막 조각**(2026-08-09 신설). 단계 순번과 그 단계 안 경과 틱으로
  // 적혀 있어, 재현이 같은 단계·같은 틱에 같은 자리를 다시 찍는다.
  // ⚠ 탭이 하나도 없는 코드는 이 기능이 생기기 **전에 뽑힌 것**이다. 그 판은 조종을 했더라도
  //   되살릴 때 손을 안 댄 판이 되므로, 어긋나도 그것을 버그로 읽으면 안 된다.
  const orders = want.entries.filter((e) => e.t === "order");
  const ordersByStage = new Map();
  for (const o of orders) {
    const list = ordersByStage.get(o.stage) ?? [];
    list.push(o);
    ordersByStage.set(o.stage, list);
  }
  for (const list of ordersByStage.values()) list.sort((a, b) => a.tick - b.tick);
  const stepMs = 1000 / SIM.stepsPerSecond;
  let di = 0;
  let bi = 0;
  let stageNo = 0; // 재현이 지금 몇 번째 단계에 있는가(게임의 stageOrdinal 과 같은 눈금)
  let oi = 0; // 이번 단계에서 다음에 내릴 탭
  let ordersReplayed = 0;
  let ordersRejected = 0;
  let guard = 0;
  const notes = [];
  while (guard < 600000) {
    guard += 1;
    if (game.phase === "draft") {
      if (di >= drafts.length) {
        notes.push(`드래프트가 기록보다 많다(기록 ${drafts.length}회) — 여기서 멈춘다`);
        break;
      }
      const rec = drafts[di];
      // **후보가 같은가**가 가장 강한 신호다. 같은 시드에서 다른 후보가 나오면 카드 풀이나
      // 드래프트 rng 가 갈라진 것이라, 그 뒤의 모든 수치가 무의미해진다.
      // ⚠ 강화 꼬리(`_x2`)를 떼고 비교한다 — 코드는 카드를 **번호**로 접어 담으므로 꼬리가 안 남는다.
      //   떼지 않으면 시대 보상 드래프트가 매번 「후보가 다르다」로 잘못 잡힌다(재현은 멀쩡한데).
      const got = game.draftCards.map((c) => baseCardId(c.id));
      const wantIds = rec.cards.map((id) => baseCardId(id));
      if (got.join(",") !== wantIds.join(",")) {
        notes.push(
          `드래프트 ${di + 1}: 후보가 다르다\n    기록 ${rec.cards.join(" · ")}\n    재현 ${got.join(" · ")}`,
        );
      }
      replayPick(game, rec);
      di += 1;
      continue;
    }
    if (game.phase === "result") {
      if (game.result === "win" && !game.isFinalEra) {
        game.continueToNextEra();
        continue;
      }
      break;
    }
    // 새 단계에 들어섰나 — 게임의 stageOrdinal 과 같은 눈금으로 따라간다.
    if (game.stageOrdinalNow !== stageNo) {
      stageNo = game.stageOrdinalNow;
      oi = 0;
    }
    // 이번 단계의 이 틱에 사람이 찍은 탭이 있으면 그대로 다시 찍는다.
    // ⚠ 시각은 **게임에게 묻는다**(`stageTickNow`) · 여기서 프레임을 세면 어긋난다 —
    //   update 는 드래프트·결과 단계에서 일찍 돌아가므로 프레임 수와 단계 틱이 다르다.
    const list = ordersByStage.get(stageNo);
    while (list !== undefined && oi < list.length && list[oi].tick <= game.stageTickNow) {
      const o = list[oi];
      if (game.setHerdOrder(o.x, o.y, o.kind)) ordersReplayed += 1;
      else ordersRejected += 1;
      oi += 1;
    }
    // 구입 — **시각이 담긴 코드는 그 시각에 정확히 산다.** 옛 코드(stage 0)는 시각을 모르므로
    // 「살 수 있게 되면 곧」이라는 근사로 되돌아간다(그 판은 구입 시점이 원판과 다를 수 있다).
    // ⚠ 어느 쪽이든 **한 프레임에 하나만** 산다 · 몰아 사면 도장이 붙는 틱이 원판보다 앞당겨진다.
    const nb = buys[bi];
    if (nb !== undefined) {
      const timed = nb.stage > 0;
      // 창을 놓쳤으면(그 단계를 이미 지났으면) 곧바로 산다 — 안 그러면 `bi` 가 영영 안 넘어가
      // 뒤의 구입이 전부 막힌다(재현이 한 번 어긋나면 그때부터 아무것도 못 사는 상태가 된다).
      const due = timed
        ? nb.stage < game.stageOrdinalNow ||
          (nb.stage === game.stageOrdinalNow && nb.tick <= game.stageTickNow)
        : true;
      if (due && game.buyTier(nb.cat)) bi += 1;
    }
    game.update(stepMs);
  }

  // --- 기록과 재현을 한 줄씩 대조 ---
  const got = game.runCodeData();
  const wStages = want.entries.filter((e) => e.t === "stage");
  const gStages = got.entries.filter((e) => e.t === "stage");
  console.log("");
  console.log(`# 단계 대조 · 기록 ${wStages.length}줄 · 재현 ${gStages.length}줄`);
  console.log(["#", "시대", "단계".padEnd(10), "위협".padEnd(10), "기록 개체", "재현 개체", "기록 합불", "재현 합불"].join("\t"));
  const n = Math.max(wStages.length, gStages.length);
  let firstDiff = -1;
  for (let i = 0; i < n; i++) {
    const a = wStages[i];
    const b = gStages[i];
    const threat = a ? (a.boss ?? a.extinction ?? "-") : (b?.boss ?? b?.extinction ?? "-");
    const same = a && b && a.pop === b.pop && a.passed === b.passed && a.kind === b.kind;
    if (!same && firstDiff < 0) firstDiff = i;
    console.log(
      [
        same ? " " : "▶",
        String(a?.era ?? b?.era ?? "-"),
        String(a?.kind ?? b?.kind ?? "-").padEnd(10),
        String(threat).padEnd(10),
        a ? String(a.pop) : "-",
        b ? String(b.pop) : "-",
        a ? (a.passed ? "합격" : "불합격") : "-",
        b ? (b.passed ? "합격" : "불합격") : "-",
      ].join("\t"),
    );
  }

  console.log("");
  console.log("# 결말 대조");
  const rowsFinal = [
    ["도달 시대", want.summary.era, got.summary.era],
    ["레벨", want.summary.level, got.summary.level],
    ["끝 개체", want.summary.popEnd, got.summary.popEnd],
    ["최고 개체", want.summary.popMax, got.summary.popMax],
    ["방울 번 것", want.summary.geneEarned, got.summary.geneEarned],
    ["방울 쓴 것", want.summary.geneSpent, got.summary.geneSpent],
  ];
  for (const c of CATEGORIES) rowsFinal.push([`도장 ${CATEGORY_LABELS[c]}`, want.summary.pips[c], got.summary.pips[c]]);
  for (const [k, a, b] of rowsFinal) {
    console.log([a === b ? " " : "▶", String(k).padEnd(12), String(a), String(b)].join("\t"));
  }

  console.log("");
  console.log(
    `# 드래프트 ${di}/${drafts.length} 재현 · 방울 구입 ${bi}/${buys.length} 재현 · ` +
      `탭 ${ordersReplayed}/${orders.length} 재현${ordersRejected > 0 ? ` (거절 ${ordersRejected})` : ""}`,
  );
  if (orders.length === 0 && want.header.leadEnabled) {
    console.log("# ⚠ 탭이 한 개도 안 담긴 코드다 — 명령 기록이 생기기 전(2026-08-09 이전)에 뽑혔거나");
    console.log("#   정말로 한 번도 안 탭한 판이다. 앞이라면 **이 재현은 손을 안 댄 판**이라 어긋나는 게 정상이다.");
  }
  if (notes.length > 0) {
    console.log("# 어긋난 것:");
    for (const t of notes) console.log(`  · ${t}`);
  }
  console.log("");
  if (firstDiff < 0 && notes.length === 0 && want.summary.popEnd === got.summary.popEnd) {
    console.log("# ✅ 재현이 기록과 같다 — 프로브 배선은 게임과 같은 게임을 한다.");
    console.log("#    그러면 다른 모드가 어긋난 것은 **세계 구성**이다(그 모드가 무엇을 다르게 만드는지 좁혀라).");
  } else {
    console.log(`# ❌ 재현이 기록과 다르다. 첫 어긋남: ${firstDiff < 0 ? "(단계는 같고 결말이 다름)" : `단계 ${firstDiff + 1}`}`);
    console.log("#    그 줄까지는 같으므로, 거기서부터 이분하면 갈라진 자리가 나온다.");
    console.log("#    ⚠ 이 상태에서는 어떤 밸런스 수치도 근거로 쓰지 마라.");
  }
}

async function runExtinction() {
  const presets = extinctionSubjects();
  const eras = opt("eras", "1,3,5").split(",").map(Number);
  const KINDS = ["none", "cold", "heat", "famine", "plague"];
  const LABEL = { none: "없음", cold: "한파", heat: "폭염", famine: "대가뭄", plague: "대역병" };

  console.log(
    `# extinction · 시대 ${eras.join("·")} · 시드 ${SEEDS.length} · 프리셋 ${presets.length} · ` +
      `${GAME.extinctionSeconds}초 단계 · 워밍업 ${WARMUP}틱 · 세기 ×${STRENGTH}`,
  );
  console.log(
    "# 읽는 법: **굶음 > 직접** 이면 그 재난은 예고와 다른 방식으로 죽인다(= 화면이 거짓말한다). " +
      "야생후가 무너지면 육식 갈래가 자동으로 굶는다.",
  );
  console.log("# 직접 = 추위+더위+역병 사망(예고가 약속한 사인) · 탈락 = 끝 개체 < 통과기준 · 멸종 = 0마리.");
  console.log(
    ["시대", "프리셋".padEnd(18), "재난".padEnd(6), "통과", "내종전", "내종후", "탈락", "멸종", "야생전", "야생후", "굶음", "직접", "잡아먹힘"].join("\t"),
  );

  for (const era of eras) {
    const need = extinctionPassNeeded(era);
    for (const p of presets) {
      for (const kind of KINDS) {
        const rows = SEEDS.map((s) => extinctionRound(p.genome, s, era, kind));
        console.log(
          [
            String(era), p.name.padEnd(18), LABEL[kind].padEnd(6), String(need),
            cell(rows.map((r) => r.popBefore), 1),
            cell(rows.map((r) => r.pop), 1),
            `${rows.filter((r) => r.pop < need).length}/${rows.length}`,
            `${rows.filter((r) => r.pop === 0).length}/${rows.length}`,
            cell(rows.map((r) => r.wildBefore), 1),
            cell(rows.map((r) => r.wild), 1),
            cell(rows.map((r) => r.starve), 1),
            cell(rows.map((r) => r.direct), 1),
            cell(rows.map((r) => r.predation), 1),
          ].join("\t"),
        );
      }
    }
  }
}

async function runPoison() {
  const presets = pickPresets();
  const eras = opt("eras", "0,2,4").split(",").map(Number);
  const drainOverride = opt("drain", "") === "" ? null : Number(opt("drain", ""));
  const shelterOn = opt("shelter", "1") !== "0";

  console.log(
    `# poison · 시대 ${eras.join("·")} · 시드 ${SEEDS.length} · 프리셋 ${presets.length} · ` +
      `${GAME.bossSeconds}초 관문 · 워밍업 ${WARMUP}틱 · 피난처 ${shelterOn ? "켬" : "끔"} · ` +
      `흡수 ${drainOverride === null ? "프리셋 값" : drainOverride}`,
  );
  console.log(
    "# 기준선 = 같은 시드·같은 판에서 위협을 아예 안 얹은 것. 안몲 = 안개만 얹고 손 안 댐. " +
      "몲 = 무리를 가장 가까운 수풀로 지시(한 번 탭한 뒤 그대로).",
  );
  console.log("# 탈락 = 끝 개체 수 < 통과기준 · 멸종 = 0마리 · 수풀% = 내 종이 수풀 위에 있던 개체틱 비율(몲).");
  console.log(
    [
      "시대", "프리셋".padEnd(18), "통과",
      "기준선", "기준탈락", "기준멸종",
      "안몲", "안몲탈락", "안몲멸종",
      "몲", "몲탈락", "몲멸종", "수풀%",
    ].join("\t"),
  );

  for (const era of eras) {
    const need = bossPassNeeded(era);
    for (const p of presets) {
      const base = [];
      const still = [];
      const drive = [];
      for (const seed of SEEDS) {
        base.push(poisonRound(p.genome, seed, era, "base", drainOverride, shelterOn));
        still.push(poisonRound(p.genome, seed, era, "still", drainOverride, shelterOn));
        drive.push(poisonRound(p.genome, seed, era, "drive", drainOverride, shelterOn));
      }
      const fail = (rows) => rows.filter((r) => r.pop < need).length;
      const gone = (rows) => rows.filter((r) => r.pop === 0).length;
      console.log(
        [
          String(era),
          p.name.padEnd(18),
          String(need),
          cell(base.map((r) => r.pop), 1),
          `${fail(base)}/${base.length}`,
          `${gone(base)}/${base.length}`,
          cell(still.map((r) => r.pop), 1),
          `${fail(still)}/${still.length}`,
          `${gone(still)}/${still.length}`,
          cell(drive.map((r) => r.pop), 1),
          `${fail(drive)}/${drive.length}`,
          `${gone(drive)}/${drive.length}`,
          cell(drive.map((r) => r.grass * 100), 0),
        ].join("\t"),
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// sweep 모드 · 형질을 키운 만큼 격퇴가 되는가 (문턱 근처가 원리적으로 가능한가)
// ────────────────────────────────────────────────────────────────────────────
async function runSweep() {
  const type = opt("boss", "raider");
  const base = PRESETS.find((p) => p.key === "omni");
  const values = opt("values", "44,50,55,58,64,70,80,100").split(",").map(Number);
  console.log(`# sweep · ${type} · 균형 잡식에서 공격력만 바꿈 · era ${ERA} · 진도 ${STEP} · ${W}x${H} · areaScale ${AREA_SCALE} · 시드 ${SEEDS.length}`);
  console.log(`# 문턱: raidWarriorAttack=${SIM.raidWarriorAttack} · floor=${SIM.raidAttackFloor} · hitDamage=${SIM.raidHitDamage} · maxHp=${SIM.bossMaxHp}`);
  console.log(["공격력", "격퇴", "최소체력%", "무흠집", "전사(근/원)", "격퇴틱(중앙값)"].join("\t"));
  for (const atk of values) {
    const g = structuredClone(base.genome);
    g.pips.fang = atk; // v8 — 스윕 축이 「공격력 값」에서 「이빨 도장 수」로 바뀌었다
    refreshDerived(g);
    const rows = [];
    for (const seed of SEEDS) {
      const w = buildWorld(seed, g);
      for (let i = 0; i < WARMUP; i++) w.step();
      w.boss = createBoss(type, W, H, w.terrain, 1, true);
      const maxHp = w.boss.maxHp;
      let minRatio = 1;
      let melee = 0;
      let ranged = 0;
      let killTick = Infinity;
      const ticks = GAME.bossSeconds * SIM.stepsPerSecond;
      for (let i = 1; i <= ticks; i++) {
        w.step();
        const b = w.boss;
        if (b === null) break;
        melee = Math.max(melee, w.raidMeleeFighters ?? 0);
        ranged = Math.max(ranged, w.raidRangedFighters ?? 0);
        if (maxHp > 0) {
          minRatio = Math.min(minRatio, Math.max(0, b.hp) / maxHp);
          if (b.hp <= 0) {
            killTick = i;
            break;
          }
        }
      }
      rows.push({ minRatio, killTick, melee, ranged });
    }
    const kills = rows.filter((r) => r.killTick < Infinity);
    const med = kills.length === 0 ? NaN : kills.map((r) => r.killTick).sort((a, b) => a - b)[Math.floor(kills.length / 2)];
    console.log(
      [
        String(atk),
        `${kills.length}/${rows.length}`,
        cell(rows.map((r) => r.minRatio * 100), 1),
        `${rows.filter((r) => r.minRatio >= 0.99).length}/${rows.length}`,
        `${fmt(rows.reduce((a, r) => a + r.melee, 0) / rows.length, 1)}/${fmt(rows.reduce((a, r) => a + r.ranged, 0) / rows.length, 1)}`,
        Number.isFinite(med) ? String(med) : "-",
      ].join("\t"),
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// era0 모드 · "첫 판 한 판이 실제로 어떻게 흘러가는가"
// ────────────────────────────────────────────────────────────────────────────
/**
 * 실제 일정(SCHEDULE: 채집·채집·보스·채집·보스·대멸종)을 **game.ts 를 통째로 태워** 돈다.
 *
 * 왜 직접 안 돌리고 Game 을 태우나: game.update 에는 프로브가 손으로 베끼면 반드시 틀리는 조기 종료
 * 둘이 있다 — ① 개체 0 이면 즉시 패배 ② 보스 격퇴(hp<=0)면 그 자리에서 단계 종료. 조사 중에 ②를
 * 빠뜨렸더니 격퇴된 보스가 계속 돌며 전사 면역이 풀려 `deaths.boss` 가 0.0 → 9.4 로 거짓말을 했다.
 * 보스 선택(층위 적격)·대멸종 종류·시대 척박도·첫 시대 단순화도 전부 game 이 쥐고 있다.
 *
 * 카드 정책(--cards): first = 늘 첫 장(실제 플레이에 가깝다) · skip = 늘 건너뜀(형질 성장 0 기준선,
 * 대신 스킵 보상 새끼가 붙는다). 지시(탭)는 주지 않는다 = 손 놓고 본 하한선.
 */
function playEra0(preset, seed, policy, forcedScale) {
  // ⚠ 저장본을 **판마다 되돌린다.** 이 프로브에는 메모리 localStorage 가 얹혀 있어(파일 머리),
  //   런이 끝날 때 game 이 "끝낸 런 수"를 1 늘려 쓴다 → 안 되돌리면 두 번째 시드부터 온보딩 진도가
  //   올라가 **세계가 달라진다**(시드마다 다른 세계를 재는 사고).
  setSavedProgress(RUNS_DONE, METAXP);
  // 3번째 인자(fixedMapScale)는 원래 테스트 훅이다 · 여기서는 "옛 첫 시대(배율 2.0)와 지금(1.0)을
  // 같은 시드로 나란히 재기" 위해 쓴다(`--scale=2`). 안 주면 실제 게임과 똑같이 mapScale(era).
  const game = newGame(forcedScale);
  game.fixedSeed = seed;
  game.leadEnabled = true; // 실제 배포와 같은 설정(단계별 경험치 상한이 걸린다). 지시는 안 준다.
  game.beginRun();
  // 첫 드래프트 = 시작 종 고르기. 이 프리셋을 정확히 집는다(없으면 첫 장).
  const want = game.draftCards.findIndex((c) => c.id === `preset_${preset.key}`);
  game.pickCard(want >= 0 ? want : 0);

  const stepMs = 1000 / SIM.stepsPerSecond;
  const stages = []; // { pop, deaths } · 단계가 끝난 순간의 스냅샷
  let lastStage = game.stageNumber;
  let prev = { ...game.world.deaths };
  const snap = () => {
    const now = game.world.deaths;
    const delta = {};
    for (const k of Object.keys(now)) delta[k] = now[k] - (prev[k] ?? 0);
    prev = { ...now };
    stages.push({ pop: game.world.playerPopulation, deaths: delta });
  };

  let guard = 0;
  while (game.phase !== "result" && guard < 200000) {
    guard += 1;
    if (game.phase === "draft") {
      if (policy === "skip") game.skipDraft();
      else {
        maybeReroll(game); // --reroll 일 때만 · 내가 파는 범주가 하나도 안 뜬 드래프트면 한 번 다시 뽑는다
        game.pickCard(0);
      }
      continue;
    }
    game.update(stepMs);
    if (game.phase === "result") break;
    if (game.stageNumber !== lastStage) {
      lastStage = game.stageNumber;
      snap();
    }
  }
  snap(); // 마지막 단계(승리로 끝났거나 멸종한 그 단계)
  return {
    stages,
    won: game.result === "win",
    extinct: game.world.playerPopulation === 0,
    level: game.level,
    deaths: { ...game.world.deaths },
    reached: stages.length, // 몇 단계까지 갔나(1~6)
  };
}

const CAUSES = ["starve", "cold", "heat", "age", "boss", "predation", "plague", "venom", "wound"];

async function runEra0() {
  const policy = opt("cards", "first");
  // **이 메타 레벨에서 실제로 고를 수 있는** 시작 종만 잰다(기본은 메타 경험치 0 = 첫 플레이).
  // 잠긴 갈래를 억지로 태우면 그 사람이 겪지 않는 세계를 재게 된다.
  const forced = opt("scale", "") === "" ? undefined : Number(opt("scale", ""));
  const scale = forced ?? mapScale(0);
  setSavedProgress(RUNS_DONE, METAXP);
  const probeGame = newGame();
  probeGame.fixedSeed = "unlock-probe";
  probeGame.beginRun();
  const openIds = new Set(probeGame.draftCards.map((c) => c.id));
  const presets = pickPresets().filter((p) => openIds.has(`preset_${p.key}`));
  const locked = pickPresets().filter((p) => !openIds.has(`preset_${p.key}`));
  if (locked.length > 0) console.log(`# 잠긴 갈래(이 메타 레벨에선 못 고름): ${locked.map((p) => p.name).join(", ")}`);
  const stageNames = ["채집1", "채집2", "보스1", "채집3", "보스2", "대멸종"];
  console.log(`# era0 · 첫 시대 한 판 전체 · 세계 ${Math.round(MOBILE.width * scale)}x${Math.round(MOBILE.height * scale)}(배율 ${scale}${forced === undefined ? "" : " · 강제"}) · 시드 ${SEEDS.length} · 카드 ${policy} · 지시 없음`);
  console.log(`# 일정: ${SCHEDULE.join(" → ")} · 첫 시대는 시험(불씨) 없음 → 패배는 오직 개체 0`);
  console.log(`# 표1 · 단계가 끝난 순간의 내 종 개체 수(평균)`);
  console.log(["프리셋".padEnd(18), ...stageNames, "멸종", "도달단계", "레벨"].join("\t"));

  const all = new Map();
  for (const p of presets) {
    const runs = SEEDS.map((s) => playEra0(p, s, policy, forced));
    all.set(p.key, { name: p.name, runs });
    const cols = stageNames.map((_, i) => {
      const vs = runs.filter((r) => r.stages[i] !== undefined).map((r) => r.stages[i].pop);
      return vs.length === 0 ? "-" : fmt(vs.reduce((a, b) => a + b, 0) / vs.length, 1);
    });
    const dead = runs.filter((r) => r.extinct).length;
    console.log(
      [
        p.name.padEnd(18),
        ...cols,
        `${dead}/${runs.length}`,
        fmt(runs.reduce((a, r) => a + r.reached, 0) / runs.length, 1),
        fmt(runs.reduce((a, r) => a + r.level, 0) / runs.length, 1),
      ].join("\t"),
    );
  }

  console.log(`\n# 표2 · 사망 원인별 평균(한 판 전체 · 내 종만)`);
  console.log(["프리셋".padEnd(18), ...CAUSES, "합"].join("\t"));
  for (const [, v] of all) {
    const cols = CAUSES.map((c) => fmt(v.runs.reduce((a, r) => a + r.deaths[c], 0) / v.runs.length, 1));
    const sum = v.runs.reduce((a, r) => a + CAUSES.reduce((b, c) => b + r.deaths[c], 0), 0) / v.runs.length;
    console.log([v.name.padEnd(18), ...cols, fmt(sum, 1)].join("\t"));
  }

  console.log(`\n# 표3 · 단계별 사망 수(전 원인 합 · 프리셋 평균) — 죽음이 어느 단계에 몰려 있나`);
  console.log(["단계".padEnd(10), "사망", "그 중 최다 원인"].join("\t"));
  for (let i = 0; i < stageNames.length; i++) {
    let n = 0;
    let total = 0;
    const byCause = Object.fromEntries(CAUSES.map((c) => [c, 0]));
    for (const [, v] of all) {
      for (const r of v.runs) {
        const st = r.stages[i];
        if (st === undefined) continue;
        n += 1;
        for (const c of CAUSES) {
          total += st.deaths[c];
          byCause[c] += st.deaths[c];
        }
      }
    }
    if (n === 0) {
      console.log([stageNames[i].padEnd(10), "-", "-"].join("\t"));
      continue;
    }
    const top = CAUSES.slice().sort((a, b) => byCause[b] - byCause[a])[0];
    console.log([stageNames[i].padEnd(10), fmt(total / n, 1), `${top} ${fmt(byCause[top] / n, 1)}`].join("\t"));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// encounter 모드 · "포식자를 실제로 만나기는 하는가"
// ────────────────────────────────────────────────────────────────────────────
/** 이 개체를 위협하는 포식자인가 — behavior 의 도망 판정과 같은 기준(비우호 타종·사냥 식성·체급 이상). */
function threatens(sp, myAttack) {
  return (
    !sp.isPlayer &&
    !sp.friendly &&
    sp.genome.traits.diet > SIM.dietHuntMin &&
    sp.genome.traits.attack >= myAttack
  );
}

// ────────────────────────────────────────────────────────────────────────────
// steps 모드 · "진도가 오를 때 세계가 실제로 넓어지는가(줄어드는 구간이 없는가)"
// ────────────────────────────────────────────────────────────────────────────
/**
 * 온보딩 진도 0~3 의 세계를 **같은 시드로 나란히** 만들어 종 수·지형 비율·맵 치수·개체 수를 찍는다.
 * 테스트는 계약(단조 증가)을 못박고, 이 표는 그 계단이 실제로 어떤 크기인지를 눈으로 보게 한다.
 * ⚠ 여기 나오는 수치를 코드에 기준선으로 박지 말 것(sim 을 바꾸면 통째로 이동한다).
 */
async function runSteps() {
  const genome = defaultGenome();
  const WARM = GAME.roundSeconds * SIM.stepsPerSecond; // 채집 한 판(16초)
  console.log(`# steps · 온보딩 진도 0~3 · 균형 기본 게놈 · 시드 ${SEEDS.length} · 워밍업 ${WARM}틱(채집 한 판)`);
  console.log(`# 진도 = min(3, 끝낸 런 수 + 시대) · 척박도는 era ${ERA} 기준`);
  console.log(
    [
      "진도", "배율", "맵", "치수", "사는종", "종이름",
      "물%", "수풀%", "험지%", "산%", "바이옴", "먹이", "개체", "내종", `내종@${WARM}틱`,
    ].join("\t"),
  );
  for (let step = 0; step <= 3; step++) {
    const scale = mapScale(step);
    const names = new Set();
    const acc = { sp: [], water: [], grass: [], rough: [], mtn: [], biome: [], food: [], ents: [], mine: [], warm: [] };
    for (const seed of SEEDS) {
      const w = buildWorld(seed, genome, undefined, step, scale);
      const alive = new Set(w.entities.map((e) => e.species.name));
      for (const n of alive) names.add(n);
      acc.sp.push(alive.size);
      const tiles = w.terrain.tiles;
      const frac = (k) => tiles.filter((x) => x === k).length / tiles.length;
      acc.water.push(100 * frac(TILE.water));
      acc.grass.push(100 * frac(TILE.grass));
      acc.rough.push(100 * frac(TILE.rough));
      acc.mtn.push(100 * frac(TILE.mountain));
      acc.biome.push(new Set(w.environment.biome).size);
      acc.food.push(w.food.length);
      acc.ents.push(w.entities.length);
      acc.mine.push(w.playerPopulation);
      for (let i = 0; i < WARM; i++) w.step();
      acc.warm.push(w.playerPopulation);
    }
    const avg = (a) => (a.length === 0 ? NaN : a.reduce((x, y) => x + y, 0) / a.length);
    console.log(
      [
        String(step),
        fmt(scale, 2),
        mapTypeForStep(step),
        `${Math.round(MOBILE.width * scale)}x${Math.round(MOBILE.height * scale)}`,
        fmt(avg(acc.sp), 1),
        [...names].join("·"),
        fmt(avg(acc.water), 1),
        fmt(avg(acc.grass), 1),
        fmt(avg(acc.rough), 1),
        fmt(avg(acc.mtn), 1),
        fmt(avg(acc.biome), 1),
        fmt(avg(acc.food), 0),
        fmt(avg(acc.ents), 1),
        fmt(avg(acc.mine), 1),
        fmt(avg(acc.warm), 1),
      ].join("\t"),
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// growth · "한 런이 어디까지 가는가 · 드래프트가 무엇을 내놓는가"
// ────────────────────────────────────────────────────────────────────────────

/**
 * **최고 티어(4단)에 닿은 범주**를 세는 눈금.
 *
 * ⚠ 예전엔 여기에 형질 이름 넷(`speed`·`vision`·`attack`·`fertility`)이 `APEX_KEYS` 로 적혀 있었고,
 *   그것을 **범주 표**(`tiersOf` 는 fang·leg·eye·hide·herd 를 돌려준다)에 넣어 조회하고 있었다.
 *   그래서 늘 `undefined` 라 「정점」 칸이 **구조적으로 영원히 0**이었다(표가 아무 말도 안 하고 있었다).
 *   v9 의 성장 눈금은 범주의 티어 하나뿐이므로 CATEGORIES 를 그대로 쓴다.
 */
const TOP_TIER_CATS = CATEGORIES;

/**
 * 후보 카드 한 장을 v9 어법으로 가른다.
 *
 * ⚠ **v8 의 dead/save/live 는 걷어냈다.** 그 셋은 「이 장이 찍는 도장이 문턱을 넘기는가」의 갈래였는데,
 *   v9 의 카드는 **도장을 안 준다**(`cardPips` 가 드래프트 카드에서 늘 0). 그대로 두면 후보가 전부
 *   `dead` 로 찍혀 표가 「죽은 카드 100%」라는 거짓말을 한다. 「저축 픽」·「몸집만 바꾸는 카드」도
 *   가리킬 대상이 사라졌다.
 *
 * v9 에서 후보 한 장을 실제로 가르는 축은 셋이다:
 *   kind   = 무엇을 주는가 · `key`(없던 규칙) / `perk`(조건부 배수) / `ember`(불씨 회복)
 *   rarity = 등급 · 특성의 값어치가 곧 등급이다(`sim/perks.perkRarity` = 조건 성립 빈도 × 효과 크기)
 *   cat    = 어느 범주를 돕는가 · 게임의 뽑기 보정과 **같은 함수**(`cardFavorsCategory`)로 묻는다
 *            (특성은 축이 정확히 한 범주에 속하고 열쇠는 모 범주가 있으므로 한 장에 한 범주다)
 */
function classifyOffer(card, digs) {
  const kind = card.key !== undefined ? "key" : card.ember ? "ember" : card.perk !== undefined ? "perk" : "기타";
  const cat = CATEGORIES.find((c) => cardFavorsCategory(card, c)) ?? null;
  return {
    kind,
    cat,
    rarity: cardRarity(card),
    favors: digs.some((c) => cardFavorsCategory(card, c)),
  };
}

// --- 카드 선택 정책 (growth · econ) ----------------------------------------------------------
//
// **v9 에서 이름과 뜻을 함께 바꿨다.** v8 의 점수는 「이 장이 찍는 도장 수」였는데, v9 의 카드는
// 도장을 안 준다 · 그래서 `best`·`focus`·`apexrush` 세 정책이 **모든 후보에 0점을 매겨** 늘 첫 장을
// 골랐다. 세 정책이 `first` 와 글자 하나 안 다른 판을 돌면서 표에는 서로 다른 이름으로 찍혔다
// (2026-08-10 교차 점검이 잡은 조용한 오염 · 크래시가 아니라서 아무도 못 알아챘다).
//
// v9 에서 「어떻게 고르는가」로 뜻이 남는 축은 둘뿐이다:
//   rarity = **등급이 가장 높은 장**. 특성의 값어치가 곧 등급이라(`sim/perks.perkValue` =
//            조건 성립 빈도 × 효과 크기) 이게 「가장 센 카드를 집는 사람」이다. 옛 `best` 자리.
//   focus  = **내가 판 범주를 돕는 장**(한 우물). 판정은 게임의 뽑기 보정과 **같은 함수**
//            (`cardFavorsCategory`)로 한다 · 같은 조건이면 등급이 높은 쪽. 옛 `focus`·`apexrush` 자리.
// 대조군 둘: first(늘 첫 장 · 손 놓은 하한선) · random(무작위 · 정책의 값어치를 재는 밑바닥).
const POLICIES = ["first", "rarity", "focus", "random"];
/**
 * 옛 이름 → [v9 이름, 왜 옮기는가]. 옛 명령줄이 **조용히 다른 것을 재지 않도록** 경고와 함께 옮긴다.
 * ⚠ `skip` 은 era0 모드의 진짜 정책이다(`--cards=skip` = 드래프트를 건너뛴다). growth·econ 에는
 *   그 갈래가 없어서 예전에도 첫 장으로 떨어지고 있었다 · 이제는 그 사실을 말하고 떨어진다.
 */
const POLICY_ALIAS = {
  best: ["rarity", "v9 에서 뜻을 잃었다(도장을 주는 카드가 없어 모든 후보가 0점이었다)"],
  apexrush: ["focus", "v9 에서 뜻을 잃었다(카드가 티어를 안 올린다)"],
  skip: ["first", "growth·econ 에는 건너뛰기 갈래가 없다(era0 모드의 --cards=skip 은 그대로 작동한다)"],
};
const POLICY_LABEL = {
  first: "first(늘 첫 장)",
  rarity: "rarity(등급이 가장 높은 장)",
  focus: "focus(내가 판 범주를 돕는 장 · 같으면 등급 높은 쪽)",
  random: "random(무작위)",
};

/** 명령줄에서 받은 정책 이름을 v9 이름으로 옮긴다. 모르는 이름이면 크게 경고하고 first 로 떨어뜨린다. */
function normalizePolicy(name) {
  if (POLICIES.includes(name)) return name;
  const moved = POLICY_ALIAS[name];
  if (moved !== undefined) {
    console.error(
      `\n⚠ 카드 정책 「${name}」: ${moved[1]}. 「${moved[0]}」로 옮겨 돌린다.\n` +
        `  쓸 수 있는 이름: ${POLICIES.join(" · ")}\n`,
    );
    return moved[0];
  }
  console.error(
    `\n⚠ 모르는 카드 정책 「${name}」 · first(늘 첫 장)로 돌린다. ` +
      `쓸 수 있는 이름: ${POLICIES.join(" · ")}\n`,
  );
  return "first";
}

/**
 * 이 정책이 이 후보에 매기는 점수(클수록 고른다). **rng 를 안 쓴다**(random 만 따로 처리).
 *
 * ⚠ 등급 순서를 여기 표로 다시 적지 않는다 · `RARITY_WEIGHT`(뽑기 가중치)를 뒤집어 쓴다.
 *   드물수록 가중치가 작으므로 음수를 취하면 그대로 「귀한 순」이 되고, 등급을 새로 넣거나 이름을
 *   바꿔도 이 자리가 따라온다(두 곳에 적힌 규칙은 반드시 조용히 어긋난다).
 */
function policyScore(policy, card, digs) {
  const rare = -RARITY_WEIGHT[cardRarity(card)];
  if (policy === "focus") {
    const hit = digs.some((c) => cardFavorsCategory(card, c));
    // 방향이 맞는 장을 무조건 먼저 · 그 안에서 등급이 높은 쪽. 등급 점수는 절댓값이 100 이하라
    // 1000 을 더하면 방향이 등급을 절대 못 이긴다(한 우물이 한 우물로 남는다).
    return (hit ? 1000 : 0) + rare;
  }
  return rare; // rarity
}

/**
 * 한 런을 **끝까지**(정복 또는 패배) 돌린다 — game.ts 를 통째로 태우고, 시대 승리마다 이어간다.
 * era0 모드가 첫 시대 한 판만 보는 것과 달리 여기는 **성장 곡선 전체**가 대상이다.
 *
 * policy = 카드 선택 정책. first=늘 첫 장 · best=효과 합이 가장 큰 장(사람은 여기에 가깝다) · random=무작위.
 * veteranRuns = 저장본의 "끝낸 런 수"(0=첫 런이라 진도가 0→3 으로 오른다 · 3=늘 진도 3 = 숙련자의 세계).
 * ⚠ 챔피언(예전의 나)은 저장본에 없어 진도 3 이어도 안 나온다 — 프로브의 구조적 한계(파일 머리 주석 참조).
 */
/**
 * **손이 붙은 판을 흉내 낸다** — 사람은 화면을 보며 무리를 먹이 더미로 몰고, 보스가 뜨면 보스로 몬다.
 * 지시 없는 판(손 놓은 하한선)만 재면 "첫 런에 정복"이라는 사용자의 실기를 영영 설명하지 못한다.
 *
 * 정책(사람의 최소 실력):
 *   · 보스 단계면 떼의 무게중심으로 몬다(격퇴 = 즉시 통과 + 불씨 +1 이라 사람은 반드시 이렇게 한다).
 *   · 그 밖에는 **먹이가 가장 빽빽한 칸**으로 몬다(거리로 할인). 굶주림이 최대 사인이므로 이게 곧 실력이다.
 * 좌표만 정한다 · sim 은 한 줄도 안 건드린다(world.herdOrder 는 게임이 탭으로 쓰는 바로 그 입구다).
 */
const DRIVE_REACH = Number(opt("reach", "420")); // 사람이 한 화면에서 짚을 수 있는 거리(px)
const DRIVE_CELL = 120; // 먹이 더미를 세는 칸 크기(px)
function driveOrder(world) {
  const boss = world.boss;
  if (boss !== null && boss.maxHp > 0) {
    const ms = boss.members ?? [];
    if (ms.length > 0) {
      let mx = 0;
      let my = 0;
      for (const m of ms) {
        mx += m.x;
        my += m.y;
      }
      return { x: mx / ms.length, y: my / ms.length };
    }
    return { x: boss.x, y: boss.y };
  }
  const list = mine(world);
  if (list.length === 0) return null;
  const c = centroid(list);
  const t = world.genome.traits;
  const canSwim = t.swimming >= SIM.swimThreshold;
  const canFly = t.wings >= SIM.flyThreshold;
  const cells = new Map();
  for (const f of world.food) {
    if (!f.available) continue;
    if (f.deep) continue;
    if (f.aquatic && !canSwim) continue;
    if (f.mountainous && !canFly) continue;
    const key = `${Math.floor(f.x / DRIVE_CELL)},${Math.floor(f.y / DRIVE_CELL)}`;
    let cur = cells.get(key);
    if (cur === undefined) {
      cur = { n: 0, sx: 0, sy: 0 };
      cells.set(key, cur);
    }
    cur.n += 1;
    cur.sx += f.x;
    cur.sy += f.y;
  }
  let best = null;
  let bestScore = -Infinity;
  for (const v of cells.values()) {
    const x = v.sx / v.n;
    const y = v.sy / v.n;
    const d = Math.hypot(x - c.x, y - c.y);
    // **한 화면 안(DRIVE_REACH)만 본다.** 사람은 안 보이는 먼 대박을 탭할 수 없고, 먼 더미로 몰면
    // 행군하는 내내 아무도 안 먹는다(지시는 해제 반경 밖에서 먹이 추적을 이긴다).
    if (d > DRIVE_REACH) continue;
    const score = v.n / (1 + d / 150);
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  return best;
}

/**
 * 한 런을 **끝까지**(정복 또는 패배) 돌린다 · game.ts 를 통째로 태우고 시대 승리마다 이어간다.
 * growth · econ 이 같은 이 함수를 쓴다.
 *
 * ⚠⚠ **이 판은 방울을 한 번도 안 쓴다**(`Game.buyTier` 를 안 부른다). v9 에서 도장은 **오직 방울로만**
 *   오르므로, 이 함수가 돌리는 종은 **프리셋 시작 도장 7에서 한 칸도 안 자란다.** 그래서
 *   「4단에 언제 닿나」·「티어합」 칸은 구조적으로 0/고정이고, 이 자로는 **v9 의 성장 속도를 못 잰다.**
 *   그 자를 만들려면 「무엇을 언제 사는가」를 먼저 정해야 하는데 그건 아직 안 정해진 값이다
 *   (backlog 「1. 성장 속도 재측정」). **여기서 임의로 구입 정책을 지어내면 그 순간 이 프로브가 내는
 *   모든 성장 수치가 「내가 정한 값」이 된다** · 이 저장소가 네 번 데인 자리다.
 *   지금 이 함수가 정직하게 재는 것: 한 런의 결말(도달 시대·패배 사유) · 사망 원인 · 방울 수입과
 *   회수율 · 드래프트가 무엇을 내놓는가.
 */
function playFullRun(preset, seed, policy, veteranRuns, metaXp, drive = false) {
  setSavedProgress(veteranRuns, metaXp);
  const game = newGame();
  game.fixedSeed = seed;
  game.leadEnabled = true; // 실제 배포와 같은 설정(단계별 경험치 상한). 지시는 안 준다 = 손 놓은 하한선.
  game.beginRun();
  const want = game.draftCards.findIndex((c) => c.id === `preset_${preset.key}`);
  game.pickCard(want >= 0 ? want : 0);

  const polRng = new Rng(`${seed}-${preset.key}-policy`);
  const stepMs = 1000 / SIM.stepsPerSecond;

  // --- 방울(유전자 점수) 경제의 재료 · econ 모드가 읽는다 -------------------------------------
  // 방울은 **양이 아니라 사건**에 붙이기로 했다([사용자 2026-08-07]). 여기서 그 사건들의 실제
  // 발생 횟수를 센다. 아직 게임에 방울은 없다 — 이미 있는 사건을 세어 **가격표의 재료**를 만든다.
  // ⚠ **감시자는 시대마다 새로 만든다** · 게임이 그렇게 한다(`Game.continueToNextEra`). 런 내내
  // 이어서 재면 옛 시대의 큰 최고 기록 때문에 새 세계의 시작 무리가 늘 「가라앉은 상태」로 출발해,
  // 무너진 적이 없는데도 다시 자라기만 하면 위기 회복이 잡힌다(2026-08-08 감사 · 판당 0.55회가
  // 그 가짜였다). 프로브가 게임과 다른 규칙으로 세면 **재는 난이도가 사람이 겪는 난이도가 아니다.**
  // 개체 수 문턱 방울이 읽는 최고 기록은 이것과 다른 값이다(런 전체를 관통해야 한다) ·
  // 그건 게임이 이미 `game.peakPopulation` 으로 들고 있으므로 아래 econ 에서 그것을 그대로 읽는다.
  let crisisWatch = createCrisisWatch();
  let crises = 0; // 위기 회복 횟수(바닥을 쳤다가 돌아온 횟수)
  let overachieves = 0; // 시험 초과 달성
  game.onTrialVerdict = (v) => {
    if (v.overachieved) overachieves += 1;
  };

  // --- 방울 회수율의 재료 --------------------------------------------------------------------
  // **[사용자 2026-08-09]** "가라 명령 때 방울을 우선시해서 알아서 먹는다" 의 효과를 재는 자리.
  //
  // 세는 법: World 는 시대마다 새로 만들어지고, **못 주운 방울은 다음 세계로 옮겨진다**
  // (`game.continueToNextEra` 의 carriedDrops). 그래서
  //   주운 개수 = Σ(시대마다 taken 인 방울 수)   ·   못 주운 개수 = **런 끝 세계**에 남은 taken 아닌 수
  //   발행 개수(중복 없이) = 주운 개수 + 못 주운 개수
  // 옮겨진 방울은 새 세계에서 다시 놓이지만 「주웠다」로는 한 번만 세이므로 이 셈은 이중계산이 없다.
  let dropsTaken = 0;
  let dropsTakenValue = 0;
  /** 세계를 갈아 끼우기 **직전에** 그 세계의 결산을 뜬다(새 World 를 만들면 옛 배열은 사라진다). */
  const closeWorldDrops = () => {
    for (const d of game.world.geneDrops) {
      if (!d.taken) continue;
      dropsTaken += 1;
      dropsTakenValue += d.amount;
    }
  };
  // 손이 붙은 판에서 「목표에 실제로 닿았는가」: 방울 우선의 대가(지시가 무의미해지는가)를 재는 축.
  let ordersIssued = 0;
  let ordersArrived = 0;

  const picks = []; // 고른 카드마다 { n, era, level, name }
  const offers = []; // 열린 드래프트의 후보 카드마다 { era, level, kind, cat, rarity, favors, id }
  const topAt = {}; // 범주 → 몇 번째 카드 시점에 4단에 닿았나 { card, era }
  let topAllAt = null;
  const eraRows = new Map();
  const eraRow = (era) => {
    let r = eraRows.get(era);
    if (r === undefined) {
      r = { era, minPop: Infinity, endPop: 0, cards: 0, deaths: {}, embers: 0, level: 0, reached: 0, tierSum: 0 };
      eraRows.set(era, r);
    }
    return r;
  };

  /**
   * 티어 사다리의 눈금을 찍는다 · **범주가 최고 티어(4단)에 닿은 시점.**
   *
   * ⚠ v9 에서 이 눈금은 **카드가 아니라 방울이 민다**(`Game.buyTier`). 그런데 이 함수는 방울을
   *   한 번도 안 쓰므로(아래 playFullRun 주석) 도장은 프리셋 시작값에서 멈춰 있고, 그래서 여기 값은
   *   **구조적으로 0 이다.** 0 인 것 자체가 「이 자로는 v9 의 성장 속도를 못 잰다」는 신호다 ·
   *   눈금을 지우지 않고 남기는 이유는 구입 정책이 정해지면(backlog 「1. 성장 속도 재측정」)
   *   그 자리에서 곧바로 살아나기 때문이다.
   */
  const noteTopTier = () => {
    const tiers = tiersOf(game.pipsNow);
    for (const c of TOP_TIER_CATS) {
      if (topAt[c] === undefined && tiers[c] >= MAX_TIER) topAt[c] = { card: picks.length, era: game.era };
    }
    if (topAllAt === null && TOP_TIER_CATS.every((c) => topAt[c] !== undefined)) {
      topAllAt = { card: picks.length, era: game.era, level: game.level };
    }
  };
  noteTopTier(); // 프리셋만으로 4단이 찍히는 경우는 없지만, 기준점을 0 으로 박아 둔다

  let guard = 0;
  let ticks = 0;
  let driveTarget = null;
  let driveAt = -999;
  while (guard < 400000) {
    guard += 1;
    if (game.phase === "draft") {
      // 리롤을 **후보를 적기 전에** 쓴다 — 사람이 실제로 고르는 3장이 다시 뽑은 쪽이기 때문이다.
      // (`--reroll` 없으면 아무 일도 안 일어난다 = 지금까지와 완전히 같은 판.)
      maybeReroll(game);
      const digs = digCategories(game.pipsNow);
      const cs = game.draftCards;
      for (const c of cs) {
        const cl = classifyOffer(c, digs);
        offers.push({ era: game.era, level: game.level, kind: cl.kind, cat: cl.cat, rarity: cl.rarity, favors: cl.favors, id: c.id });
      }
      let idx = 0;
      if (policy === "rarity" || policy === "focus") {
        // **정책이 곧 「어떻게 고르는가」다** · v9 어법으로 다시 정의했다(위 POLICIES 주석).
        let bestScore = -Infinity;
        for (let i = 0; i < cs.length; i++) {
          const s = policyScore(policy, cs[i], digs);
          if (s > bestScore) {
            bestScore = s;
            idx = i;
          }
        }
      } else if (policy === "random") {
        idx = polRng.int(0, Math.max(0, cs.length - 1));
      }
      const chosen = cs[idx];
      const era = game.era;
      const level = game.level;
      game.pickCard(idx);
      picks.push({ n: picks.length + 1, era, level, name: chosen ? chosen.name : "-" });
      eraRow(era).cards += 1;
      noteTopTier();
      continue;
    }
    if (game.phase === "result") {
      const r = eraRow(game.era);
      r.endPop = game.world.playerPopulation;
      r.embers = game.embers;
      r.level = game.level;
      r.deaths = { ...game.world.deaths };
      r.reached = 1;
      // 이 시대를 끝낼 때 티어가 얼마나 올라와 있나 — 성장 곡선의 눈금(다섯 범주 티어의 합).
      r.tierSum = tierSum(game.pipsNow);
      r.geneBank = game.geneBank; // 안 쓰고 쌓아 둔 방울 · 「이 자가 성장을 안 굴린다」의 증거
      r.pips = { ...game.pipsNow };
      // 「가진 듀오」를 센다 · 열린 듀오(activeDuos=openDuos)를 세면 카드를 안 골라도 세어
      // 표가 과대집계된다(v9 · 듀오는 카드다). 2026-08-11 수정.
      r.duos = ownedDuos(game.genome.perks).length;
      if (game.result === "win" && !game.isFinalEra) {
        closeWorldDrops(); // ⚠ 세계를 갈아 끼우기 **전에** 이 시대의 방울 결산을 뜬다
        game.continueToNextEra();
        crisisWatch = createCrisisWatch(); // 게임과 같은 자리에서 같은 함수로(위 감시자 주석 참고)
        continue;
      }
      break;
    }
    // 손이 붙은 판. **다시 탭하는 시점이 중요하다** — 매 초 새 지시를 내리면 무리가 먹지 못하고
    // 행군만 한다(지시는 해제 반경 밖에서 먹이 추적을 이긴다 · behavior 의 지시 블록). 사람도 그렇게
    // 안 한다: 한 번 찍고, 도착했거나 한참 지났을 때 다시 찍는다.
    if (drive && game.phase === "watch") {
      const c = centroid(mine(game.world));
      const arrived =
        c !== null && driveTarget !== null && Math.hypot(c.x - driveTarget.x, c.y - driveTarget.y) <= 120;
      if (driveTarget === null || arrived || ticks - driveAt >= 150) {
        // 「지금까지 찍었던 목표에 실제로 닿았나」를 새 목표를 찍기 직전에 결산한다.
        // 방울 우선을 세게 걸면 무리가 방울만 쫓아 지시가 무의미해진다. 그 대가가 이 비율이다.
        if (driveTarget !== null) {
          ordersIssued += 1;
          if (arrived) ordersArrived += 1;
        }
        const o = driveOrder(game.world);
        if (o !== null) {
          driveTarget = o;
          driveAt = ticks;
          game.setHerdOrder(o.x, o.y);
        }
      }
    }
    ticks += 1;
    game.update(stepMs);
    const r = eraRow(game.era);
    const pop = game.world.playerPopulation;
    if (pop < r.minPop) r.minPop = pop;
    // 최고 기록과 위기 회복. **game.ts 와 같은 줄이다**(같은 함수 · 같은 문턱 검사 자리).
    // 최고가 CRISIS_MIN_PEAK 에 닿기 전에는 안 센다 · 판 시작 직후의 자연스러운 출렁임을 "위기"로
    // 세면 숫자가 부풀어 가격표가 통째로 어긋난다.
    if (
      stepCrisisWatch(crisisWatch, pop, CRISIS_FRAC, RECOVER_FRAC) &&
      crisisWatch.peak >= CRISIS_MIN_PEAK
    ) {
      crises += 1;
    }
  }

  // 런이 끝난 세계의 결산 · 여기 남은 taken 아닌 방울이 곧 **끝내 못 주운 것**이다
  // (못 주운 방울은 시대마다 옮겨 오므로 마지막 세계에 전부 모여 있다).
  closeWorldDrops();
  let dropsLeft = 0;
  let dropsLeftValue = 0;
  for (const d of game.world.geneDrops) {
    if (d.taken) continue;
    dropsLeft += 1;
    dropsLeftValue += d.amount;
  }

  const conquered = game.result === "win" && game.isFinalEra;
  // 보스 처치/버팀·대멸종 견딤은 런 연대기에 남는다(game.runEvents · logEvent 가 적는다).
  const evs = game.runEvents ?? [];
  const econ = {
    // **게임이 든 값을 그대로 읽는다.** 위기 감시자의 peak 은 이제 시대마다 0 으로 돌아가므로
    // 런 전체의 최고가 아니다 · 개체 수 문턱 방울은 런을 관통하는 이 값으로만 세야 맞다.
    maxPop: game.peakPopulation,
    crises,
    overachieves,
    bossKilled: evs.filter((e) => e.kind === "boss" && e.label.includes("처치")).length,
    bossHeld: evs.filter((e) => e.kind === "boss" && e.label.includes("버팀")).length,
    extinctions: evs.filter((e) => e.kind === "extinction").length,
  };
  const drops = {
    taken: dropsTaken,
    left: dropsLeft,
    made: dropsTaken + dropsLeft,
    takenValue: dropsTakenValue,
    leftValue: dropsLeftValue,
    ordersIssued,
    ordersArrived,
  };
  return {
    preset: preset.key,
    seed,
    econ,
    drops,
    conquered,
    lost: game.result === "lose",
    lostByEmbers: game.lostByEmbers,
    finalEra: game.era,
    level: game.level,
    cards: picks.length,
    rerolls: game.rerollsUsed, // --reroll 축이 실제로 몇 번 걸렸나(0 이면 축이 안 걸린 것)
    topAt,
    topAllAt,
    geneBankEnd: game.geneBank, // 런이 끝날 때까지 안 쓴 방울(위 playFullRun 주석 참고)
    offers,
    eraRows: [...eraRows.values()],
    traits: { ...game.genome.traits },
  };
}

async function runGrowth() {
  const policy = normalizePolicy(opt("policy", opt("cards", "rarity")));
  const drive = args.includes("--drive"); // 손이 붙은 판(무리를 먹이·보스로 몬다)
  // 「누구의 판인가」 축은 전부 전역이다(`--veteran`·`--metaxp=`·`--reroll`·`--assist`) ·
  // 머리글(axisLine)이 그 값을 그대로 찍는다. 여기서 다시 파싱하면 두 곳이 갈린다.
  const runsDone = RUNS_DONE;
  const metaXp = METAXP;
  // 이 메타 레벨에서 실제로 고를 수 있는 갈래만(잠긴 갈래를 억지로 태우면 없는 세계를 재게 된다).
  setSavedProgress(runsDone, metaXp);
  const probeGame = newGame();
  probeGame.fixedSeed = "unlock-probe";
  probeGame.beginRun();
  const openIds = new Set(probeGame.draftCards.map((c) => c.id));
  const presets = pickPresets().filter((p) => openIds.has(`preset_${p.key}`));

  console.log(
    `# growth · 한 런 전체(시대 0~${GAME.eraCap - 1} · 정복까지) · 카드 정책 ${POLICY_LABEL[policy]} · ` +
      `${runsDone >= 3 ? `숙련자(끝낸 런 ${runsDone} = 늘 진도 3)` : `첫 런(진도 0→3)`} · 시드 ${SEEDS.length} · ${drive ? "손이 붙은 판(1초마다 지시)" : "지시 없음(손 놓음)"}`,
  );
  console.log(
    `# 일정 ${SCHEDULE.join("→")} × ${GAME.eraCap} 시대 · 패배 = 개체 0 · 불씨 0 · 관문 생존 기준 미달
` +
      `# 티어 문턱 ${TIER_STEPS.join("·")} · ` +
      `대멸종 생존 기준 ${[0, 1, 2, 3, 4].map((e) => extinctionPassNeeded(e)).join("·")}마리 · ` +
      `보스 생존 기준 ${[0, 1, 2, 3, 4].map((e) => bossPassNeeded(e)).join("·")}마리`,
  );
  // 풀 크기를 **손으로 안 적는다** · 예전엔 「90장」이 머리글에 박혀 있었고, v9 에서 풀이 바뀐 뒤에도
  // 그대로 찍혀 보고서가 없는 세계를 말하고 있었다. 다음에 또 바뀌므로 배열에서 읽는다.
  console.log(
    `# 카드 풀 ${CARD_POOL.length}장(조건부 특성 + 열쇠) · ` +
      `**드래프트 카드는 도장을 안 준다**(v9) · 시대 보상은 강화가 아니라 카드 한 장 더 고르는 기회다`,
  );
  console.log(
    `# ⚠ **이 자는 성장 속도를 못 잰다.** 방울을 한 번도 안 쓴다(buyTier 미호출) → 도장이 프리셋 시작값에서
` +
      `#   멈추므로 표1 「4단 범주」·표2·표3 「티어합」은 구조적으로 고정이다. 그 자는 구입 정책을 정한 뒤에
` +
      `#   만든다(backlog 「1. 성장 속도 재측정」). 여기서 읽을 것은 **결말 · 사망 원인 · 드래프트 구성**이다.`,
  );

  const all = [];
  for (const p of presets) {
    for (const seed of SEEDS) all.push(playFullRun(p, seed, policy, runsDone, metaXp, drive));
  }

  console.log(`\n# 표1 · 한 런의 결말 (프리셋별 평균 · 시드 ${SEEDS.length})`);
  console.log(
    ["프리셋".padEnd(18), "정복", "패배", "도달시대", "최종레벨", "카드수", "4단범주", "안 쓴 방울"].join("\t"),
  );
  for (const p of presets) {
    const rs = all.filter((r) => r.preset === p.key);
    const topN = rs.map((r) => TOP_TIER_CATS.filter((c) => r.topAt[c] !== undefined).length);
    console.log(
      [
        p.name.padEnd(18),
        `${rs.filter((r) => r.conquered).length}/${rs.length}`,
        `${rs.filter((r) => r.lost).length}/${rs.length}`,
        fmt(rs.reduce((a, r) => a + r.finalEra + 1, 0) / rs.length, 1),
        fmt(rs.reduce((a, r) => a + r.level, 0) / rs.length, 1),
        fmt(rs.reduce((a, r) => a + r.cards, 0) / rs.length, 1),
        fmt(topN.reduce((a, b) => a + b, 0) / topN.length, 1),
        // 「안 쓴 방울」이 크면 클수록 이 자가 **성장을 하나도 안 굴리고 있다**는 뜻이다.
        // 다음 세션이 구입 정책을 넣을 때, 이 값이 곧 그때 쓸 수 있는 예산의 상한이 된다.
        fmt(rs.reduce((a, r) => a + r.geneBankEnd, 0) / rs.length, 1),
      ].join("\t"),
    );
  }
  // 리롤 축이 **실제로 걸렸는지**를 숫자로 남긴다 — 「켰다」와 「걸렸다」는 다르다(메타 레벨이
  // 낮으면 열려 있지 않아 한 번도 안 돈다). 0 인데 켰다고 적으면 그게 다음 사고의 씨앗이다.
  if (USE_REROLL) {
    console.log(
      `# 리롤 · 판당 평균 ${fmt(all.reduce((a, r) => a + r.rerolls, 0) / all.length, 2)}회 ` +
        `(한 번이라도 쓴 판 ${all.filter((r) => r.rerolls > 0).length}/${all.length})`,
    );
  }

  // 표2 는 예전에 「형질이 100 에 닿은 시점」이었다. 0~100 스케일이 v8 에서 폐기됐고, 그 뒤로는
  // 형질 이름(speed…)으로 **범주 표**(fang…)를 조회하고 있어 늘 빈칸이었다. v9 눈금으로 다시 적는다.
  console.log(`\n# 표2 · 범주가 최고 티어(${MAX_TIER}단)에 닿은 시점 (몇 번째 카드 / 몇 번째 시대 · 닿은 런만 평균)`);
  console.log(
    `#   ⚠ 이 판은 방울을 안 쓰므로 **전부 0/${all.length} 이 정상이다**(위 머리글의 경고 참고).`,
  );
  console.log(["범주".padEnd(10), "닿은 런", "카드번호", "시대"].join("\t"));
  for (const c of TOP_TIER_CATS) {
    const hits = all.filter((r) => r.topAt[c] !== undefined).map((r) => r.topAt[c]);
    console.log(
      [
        CATEGORY_LABELS[c].padEnd(10),
        `${hits.length}/${all.length}`,
        hits.length === 0 ? "-" : fmt(hits.reduce((a, h) => a + h.card, 0) / hits.length, 1),
        hits.length === 0 ? "-" : fmt(hits.reduce((a, h) => a + h.era + 1, 0) / hits.length, 1),
      ].join("\t"),
    );
  }

  console.log(`\n# 표3 · 시대별 난이도와 실제 위험 (전 런 평균 · 그 시대까지 간 런만)`);
  console.log(
    ["시대", "듀오", "티어합", "위협배율", "포식압", "통과기준", "도달런", "카드누계", "레벨", "최소개체", "끝개체", "사망", "최다 사인", "불씨", "여기서끝난런"].join("\t"),
  );
  for (let era = 0; era < GAME.eraCap; era++) {
    const rows = [];
    for (const r of all) for (const e of r.eraRows) if (e.era === era) rows.push({ e, r });
    if (rows.length === 0) {
      console.log([String(era + 1), "-", "-", fmt(eraDifficulty(era), 2), fmt(eraPredatorPressure(era), 2), String(extinctionPassNeeded(era)), "0", "-", "-", "-", "-", "-", "-", "-", "-"].join("\t"));
      continue;
    }
    const cum = rows.map(({ r, e }) => r.eraRows.filter((x) => x.era <= era).reduce((a, x) => a + x.cards, 0));
    const ended = rows.filter(({ r }) => r.finalEra === era && (r.lost || r.conquered)).length;
    const deaths = rows.map(({ e }) => Object.values(e.deaths ?? {}).reduce((a, b) => a + b, 0));
    console.log(
      [
        String(era + 1),
        fmt(rows.reduce((a, { e }) => a + (e.duos ?? 0), 0) / rows.length, 2),
        fmt(rows.reduce((a, { e }) => a + e.tierSum, 0) / rows.length, 1),
        fmt(eraDifficulty(era), 2),
        fmt(eraPredatorPressure(era), 2),
        String(extinctionPassNeeded(era)),
        String(rows.length),
        fmt(cum.reduce((a, b) => a + b, 0) / cum.length, 1),
        fmt(rows.reduce((a, { e }) => a + e.level, 0) / rows.length, 1),
        fmt(rows.reduce((a, { e }) => a + (Number.isFinite(e.minPop) ? e.minPop : 0), 0) / rows.length, 1),
        fmt(rows.reduce((a, { e }) => a + e.endPop, 0) / rows.length, 1),
        fmt(deaths.reduce((a, b) => a + b, 0) / deaths.length, 1),
        (() => {
          const by = {};
          for (const { e } of rows) for (const c of CAUSES) by[c] = (by[c] ?? 0) + (e.deaths?.[c] ?? 0);
          const top = CAUSES.slice().sort((a, b) => by[b] - by[a]);
          return top.slice(0, 2).map((c) => `${c} ${fmt(by[c] / rows.length, 1)}`).join(" · ");
        })(),
        fmt(rows.reduce((a, { e }) => a + e.embers, 0) / rows.length, 1),
        String(ended),
      ].join("\t"),
    );
  }

  // 표4 는 예전에 「정점 전 vs 정점 뒤 · 죽은 카드 / 몸집만 바꾸는 카드」였다. 그 셋이 v9 에서 함께
  // 사라졌다: 정점이라는 상태가 없고(티어는 범주마다 따로), 죽은 카드는 후보 필터(`cardRedundant`)가
  // 이미 걷어내며, 「몸집만 바꾸는 카드」는 도장과 함께 없어졌다.
  // v9 에서 이 자리가 답해야 하는 질문은 **「드래프트가 실제로 무엇을 내놓는가」** 다:
  //   · 등급 구성이 레벨을 따라 실제로 무거워지는가(`rarityWeightsAtLevel` 이 약속한 것)
  //   · 열쇠(없던 규칙)가 얼마나 자주 보이는가 · 한 런에 최대 3개뿐이라 이 비율이 곧 열쇠 빌드의 문턱
  //   · 내가 판 방향이 얼마나 자주 뜨는가 · 게임의 뽑기 보정(`draftBias`)이 실제로 읽히는 크기
  console.log(`\n# 표4 · 드래프트가 무엇을 내놓는가 (후보 카드 한 장 단위 · 시대별)`);
  console.log(
    ["시대".padEnd(6), "후보수", "열쇠%", "내방향%", "흔함%", "드묾%", "귀함%", "아주귀함%", "전설%", "돕는 범주 상위"].join("\t"),
  );
  const offerRow = (label, os) => {
    if (os.length === 0) {
      console.log([label.padEnd(6), "0", "-", "-", "-", "-", "-", "-", "-", "-"].join("\t"));
      return;
    }
    const pct = (n) => `${fmt((100 * n) / os.length, 1)}%`;
    const ofRarity = (r) => os.filter((o) => o.rarity === r).length;
    const byCat = new Map();
    for (const o of os) if (o.cat !== null) byCat.set(o.cat, (byCat.get(o.cat) ?? 0) + 1);
    const top = [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([c, n]) => `${CATEGORY_LABELS[c] ?? c} ${fmt((100 * n) / os.length, 0)}%`)
      .join(" · ");
    console.log(
      [
        label.padEnd(6),
        String(os.length),
        pct(os.filter((o) => o.kind === "key").length),
        pct(os.filter((o) => o.favors).length),
        pct(ofRarity("common")),
        pct(ofRarity("uncommon")),
        pct(ofRarity("rare")),
        pct(ofRarity("epic")),
        pct(ofRarity("legendary")),
        top,
      ].join("\t"),
    );
  };
  const allOffers = all.flatMap((r) => r.offers);
  for (let era = 0; era < GAME.eraCap; era++) {
    offerRow(String(era + 1), allOffers.filter((o) => o.era === era));
  }
  offerRow("전체", allOffers);

  const lost = all.filter((r) => r.lost);
  console.log(
    `\n# 패배 ${lost.length}/${all.length} — 불씨 소진 ${lost.filter((r) => r.lostByEmbers).length} · 개체 0 ${lost.filter((r) => !r.lostByEmbers).length}`,
  );
}

// ⚠ v8 에서 뜻이 사라진 모드 둘(apex · scale).
//   · apex  · 「정점 넷을 찍은 뒤의 드래프트 구성」을 재던 모드. 티어 구조에서는 4단이 범주마다 따로라
//              「정점 후」라는 상태가 없다. 드래프트 구성은 growth 모드의 표4 가 v9 어법으로 잰다.
//   · scale — 0~100 스케일의 산수(상한 근접 감쇠·형질 1의 실제 크기)를 재던 모드. 그 스케일 자체를
//              폐기했다(2026-08-06 회의: 「형질 1칸은 시드 노이즈에 묻힌다」가 재설계의 출발점이었다).
async function runApex() {
  console.log("apex 모드는 v8(티어 구조)에서 뜻이 사라졌습니다. growth 모드의 표4 를 쓰세요.");
}
async function runScale() {
  // ⚠ 예전엔 「tiers 모드를 쓰세요」라고 안내했는데, 그 tiers 도 v9 에서 멈춰 섰다(바로 아래).
  //   죽은 모드가 죽은 모드를 가리키면 안내가 막다른 길이 된다.
  console.log("scale 모드는 0~100 스케일과 함께 폐기됐습니다. 성장은 sim/tiers.ts 의 티어가 정합니다.");
}

/**
 * ⚠ **tiers 모드는 v9 에서 잴 대상 자체가 없어졌다** · 되살리지 않고 안내문만 남긴다
 *   (apex · scale 이 v8 에서 폐기될 때와 같은 처리 · **없는 자를 있는 척 남기지 않는다**).
 *
 * 무엇을 재던 모드인가: 시뮬 없이 산수만으로 「카드를 12~22장 뽑아 고르면 도장이 얼마나 쌓이는가」를
 * 몬테카를로로 굴려, 티어 문턱 사다리(3·8·14·20)가 카드 예산 띠 안에서 성립하는지 검산했다.
 *
 * 왜 죽었나: v9 에서 **드래프트 카드가 도장을 안 준다**(**[사용자 2026-08-07]** "카드에서 도장을
 * 완전히 뺀다" · **[사용자 2026-08-08]** "카드는 유지하고 도장만 뺀다"). 그러니 이 모드가 세던
 * 「카드가 쌓은 도장」이 정의상 전부 0 이다. 함께 쓰던 「시대 보상 강화 ×N」(`boostCard`)도 사라졌다 ·
 * 곱할 도장이 없으니 그 자리도 함께 없어졌다.
 *
 * v9 에서 사다리를 다시 재려면 **재는 축이 통째로 다르다**: 도장은 이제 **방울 구입**으로만 오르므로
 *   「방울 수입(`src/sim/gene.ts` 의 방울 사건들) → `Game.buyTier` 로 실제로 산 문턱 수」
 * 를 재야 한다. 수입 쪽은 `econ` 모드가 이미 잰다. 지출 쪽(무엇을 언제 사는가)은 **아직 안 정해진
 * 값이라 여기서 지어내지 않는다** · 그 정책이 정해지면 그때 자를 만든다
 * (backlog 「1. 성장 속도 재측정」).
 */
async function runTiers() {
  console.log("tiers 모드는 v9 에서 잴 대상이 없어져 멈춰 세웠습니다.");
  console.log(`  · 무엇을 재던 자인가 · 「카드가 쌓는 도장」으로 티어 문턱 사다리(${TIER_STEPS.join("·")})를 검산했습니다.`);
  console.log(`  · 왜 죽었나 · v9 의 드래프트 카드는 도장을 안 줍니다(풀 ${CARD_POOL.length}장 전부). 잴 대상이 정의상 0 입니다.`);
  console.log("  · v9 에서 사다리를 재려면 · 방울 수입(sim/gene.ts) → Game.buyTier 로 산 문턱 수를 재야 합니다.");
  console.log("    수입 쪽은 econ 모드가 이미 잽니다. 지출 쪽(무엇을 언제 사는가)은 아직 안 정해진 값이라");
  console.log("    여기에 지어 넣지 않았습니다 · backlog 「1. 성장 속도 재측정」에서 정한 뒤 자를 만드세요.");
  console.log("  · 지금 쓸 수 있는 자 · growth(한 런의 결말·사망 원인·드래프트 구성) · econ(방울 수입과 회수율)");
  console.log("    · replay(사람 판을 그대로 되살린다 · 지금 이 저장소에서 유일하게 검증된 자입니다).");
}

/**
 * econ · **방울(유전자 점수) 경제의 재료를 실측한다.**
 *
 * 아직 게임에 방울은 없다. 그런데 방울이 붙을 사건 넷 중 셋(보스 격퇴 · 대멸종 생존 · 시험 초과)은
 * **이미 게임에 있다.** 그 발생 횟수를 세면 구현 전에 가격표의 재료를 얻을 수 있다.
 * 나머지 하나(개체 수 문턱)는 최고 개체 수만 알면 눈금 수로 환산된다.
 *
 * ⚠ 여기서 나오는 것은 **수입(공급)** 이다. 가격표(지출)는 이 수입을 보고 정한다.
 *   지금은 손 놓은 판 기준이라 **하한선**이다. 조종이 붙으면 개체 수가 더 커져 수입도 는다.
 */
async function runEcon() {
  const policy = normalizePolicy(opt("policy", "rarity"));
  const drive = args.includes("--drive"); // 손이 붙은 판(무리를 먹이·보스로 몬다) = 지시가 걸린 판
  // 방울 우선 반경 스윕 · `--generadius=0,80,160` 처럼 주면 값마다 한 번씩 돌려 나란히 찍는다.
  // ⚠ `ORDER` 는 런타임에는 평범한 객체라 여기서 덮어쓸 수 있다(`as const` 는 타입에만 건다).
  //   0 을 주면 「방울 우선」이 통째로 꺼진 예전 세계다 = 고치기 전과 견주는 기준선.
  //
  // ⚠⚠ **이 쉼표 스윕이 내는 값을 밸런스 근거로 쓰지 마라 · 반경마다 별도 프로세스로 돌려라.**
  //   (2026-08-09 실측으로 잡았다 · `sim/params.ts` 의 ORDER.geneRadius 주석에 전말이 있다.)
  //   두 번째 묶음부터는 앞 묶음이 **프로세스에 남긴 상태**를 물려받는다: `game/achievements.ts` 의
  //   모듈 수준 `unlockedCache` 가 `readUnlocked()` 에서 localStorage 보다 우선하는 진실인데,
  //   아래 `setSavedProgress()` 는 가짜 localStorage 만 비우고 그 캐시는 못 지운다. 그래서 앞 묶음에서
  //   업적(`titan_born` 등)이 열리면 **뒤 묶음이 해금 카드가 열린 풀에서 드래프트한다** = 판 자체가
  //   세진다. 실측(`--seeds=8 --drive`): 같은 반경 160 인데 `0,160` 스윕의 표1 「균형 잡식」이 단독
  //   대비 최고개체 36.6 → 41.1 · 보스처치 3.13 → 4.00 · 도달시대 2.3 → 2.9 로 뛰고, 표3 의 160 행도
  //   남음 0.38 → 0.33 · 회수율 93.3% → 94.8% 로 어긋난다.
  //   교차 확인: `--generadius=80,80` 은 두 행이 서로도 단독과도 완전히 같다(= 스윕이라서 틀리는 게
  //   아니라, 앞 묶음이 **업적을 열었을 때만** 틀린다). 실제로 이 스윕은 표3 의 10셀 중 8셀을 거짓으로
  //   만들었고, 그 값이 한동안 `ORDER.geneRadius` 주석에 실려 있었다(2026-08-09 에 걷어냈다).
  //   ⚠ 표1·표2 도 같은 오염을 탄다(스윕이면 마지막 반경의 판만 담기는데, 그 판이 이미 오염돼 있다).
  //
  //   그래도 스윕을 안 지우는 이유: 이 오염을 재현하는 유일한 경로가 이것이고, 고침(캐시를 지우는
  //   것은 `achievements.ts` 쪽 일이라 별건이다)이 들어왔는지 확인하려면 다시 돌려 봐야 한다.
  const radii = opt("generadius", "") === "" ? [null] : opt("generadius", "").split(",").map(Number);
  // ⚠ **첫 판에 실제로 고를 수 있는 갈래만** 태운다(runGrowth 와 같은 처리). 잠긴 갈래를 넣으면
  //   playFullRun 의 `want >= 0 ? want : 0` 이 첫 카드로 떨어져 **전부 같은 판을 돌린다** — 처음엔
  //   이 걸르개가 없어서 네 갈래가 소수점까지 똑같은 수치로 나왔고, 그게 평균을 오염시켰다.
  setSavedProgress(RUNS_DONE, METAXP);
  const unlockProbe = newGame();
  unlockProbe.fixedSeed = "unlock-probe";
  unlockProbe.beginRun();
  const openIds = new Set(unlockProbe.draftCards.map((c) => c.id));
  const presets = pickPresets().filter((p) => openIds.has(`preset_${p.key}`));
  console.log(
    `# econ · 방울 출처 실측 · 카드 정책 ${POLICY_LABEL[policy]} · 시드 ${SEEDS.length} · ` +
      `${drive ? "손이 붙은 판(--drive · 지시를 준다)" : "지시 없음(손 놓음 = 수입 하한선)"}`,
  );
  console.log(`# 갈래 ${presets.length}종(이 메타 레벨에 열려 있는 것만 · 잠긴 갈래를 태우면 같은 판이 중복된다)`);
  console.log(
    `# 위기 회복 정의: 최고의 ${CRISIS_FRAC} 아래로 떨어졌다가 그 최고의 ${RECOVER_FRAC} 위로 복귀 ` +
      `(최고 ${CRISIS_MIN_PEAK} 이상일 때만 셈 · --crisis= --recover= --crisismin= 로 바꿈 · ` +
      `판정은 sim/gene.ts 의 stepCrisisWatch = 게임과 같은 규칙)`,
  );

  const all = [];
  const byRadius = [];
  for (const r of radii) {
    if (r !== null) ORDER.geneRadius = r;
    const rows = [];
    for (const p of presets) for (const seed of SEEDS) rows.push(playFullRun(p, seed, policy, RUNS_DONE, METAXP, drive));
    byRadius.push({ radius: r === null ? ORDER.geneRadius : r, rows });
    if (radii.length === 1) all.push(...rows);
  }
  if (radii.length > 1) {
    all.push(...(byRadius[byRadius.length - 1]?.rows ?? []));
    console.log(
      `# ⚠ 반경 스윕 중이다(${radii.join("·")}) · 아래 **표1·표2 는 마지막 반경(${radii[radii.length - 1]})** 의 판만 담는다.` +
        ` 비교는 표3 으로 볼 것.`,
    );
  }

  const avg = (rs, f) => rs.reduce((a, r) => a + f(r), 0) / Math.max(1, rs.length);
  console.log(`\n# 표1 · 판당 사건 횟수 (프리셋별 평균)`);
  console.log(["프리셋".padEnd(18), "최고개체", "위기회복", "보스처치", "보스버팀", "대멸종생존", "시험초과", "도달시대"].join("\t"));
  for (const p of presets) {
    const rs = all.filter((r) => r.preset === p.key);
    console.log(
      [
        p.name.padEnd(18),
        fmt(avg(rs, (r) => r.econ.maxPop), 1),
        fmt(avg(rs, (r) => r.econ.crises), 2),
        fmt(avg(rs, (r) => r.econ.bossKilled), 2),
        fmt(avg(rs, (r) => r.econ.bossHeld), 2),
        fmt(avg(rs, (r) => r.econ.extinctions), 2),
        fmt(avg(rs, (r) => r.econ.overachieves), 2),
        fmt(avg(rs, (r) => r.finalEra + 1), 1),
      ].join("\t"),
    );
  }

  // 개체 수 문턱 사다리 — 최고 개체 수를 방울 개수로 환산한다. 시작값 S, 배수 R 의 등비 눈금.
  // 「한 마리마다 하나」가 왜 안 되는지가 여기서 숫자로 보인다(선형 눈금과 나란히 찍는다).
  const ladders = [
    { label: "S20 ×1.5", rungs: (m) => countRungs(m, 20, 1.5) },
    { label: "S20 ×1.35", rungs: (m) => countRungs(m, 20, 1.35) },
    { label: "S25 ×1.5", rungs: (m) => countRungs(m, 25, 1.5) },
    { label: "S30 ×1.6", rungs: (m) => countRungs(m, 30, 1.6) },
    { label: "선형 +10", rungs: (m) => Math.max(0, Math.floor((m - 20) / 10) + 1) },
    { label: "한 마리마다(참고)", rungs: (m) => Math.max(0, m - 15) },
  ];
  console.log(`\n# 표2 · 개체 수 문턱 사다리별 · 판당 방울 개수 (전 프리셋 평균 · 최고개체 ${fmt(avg(all, (r) => r.econ.maxPop), 1)})`);
  console.log(["사다리".padEnd(18), "방울(평균)", "최소", "최대", "눈금"].join("\t"));
  for (const L of ladders) {
    const ns = all.map((r) => L.rungs(r.econ.maxPop));
    const rungList = [];
    let v = 20;
    if (L.label.startsWith("S")) {
      const S = Number(L.label.slice(1, 3));
      const R = Number(L.label.split("×")[1]);
      v = S;
      while (v <= 400 && rungList.length < 9) {
        rungList.push(Math.round(v));
        v *= R;
      }
    }
    console.log(
      [
        L.label.padEnd(18),
        fmt(ns.reduce((a, b) => a + b, 0) / ns.length, 2),
        String(Math.min(...ns)),
        String(Math.max(...ns)),
        rungList.length ? rungList.join("·") : "-",
      ].join("\t"),
    );
  }

  // 표3 · **방울 회수율**: 떨어뜨린 것 중 몇 개나 무리가 실제로 밟아 주웠나.
  // **[사용자 2026-08-09]** "가라 명령 때 방울을 우선시해서 알아서 먹는다"의 효과가 여기서 읽힌다.
  // 반경 0 = 방울 우선이 꺼진 예전 세계. 「도착률」은 그 대가다(무리가 지시 대신 방울만 쫓으면 떨어진다).
  console.log(`\n# 표3 · 방울 회수율 · ${drive ? "지시 있음(--drive)" : "지시 없음"}`);
  console.log(
    ["방울우선반경".padEnd(12), "발행(개)", "주움", "남음", "회수율%", "값회수율%", "목표도착률%"].join("\t"),
  );
  for (const g of byRadius) {
    const made = avg(g.rows, (r) => r.drops.made);
    const taken = avg(g.rows, (r) => r.drops.taken);
    const left = avg(g.rows, (r) => r.drops.left);
    const tv = g.rows.reduce((a, r) => a + r.drops.takenValue, 0);
    const lv = g.rows.reduce((a, r) => a + r.drops.leftValue, 0);
    const iss = g.rows.reduce((a, r) => a + r.drops.ordersIssued, 0);
    const arr = g.rows.reduce((a, r) => a + r.drops.ordersArrived, 0);
    console.log(
      [
        String(g.radius).padEnd(12),
        fmt(made, 2),
        fmt(taken, 2),
        fmt(left, 2),
        fmt(made > 0 ? (100 * taken) / made : 0, 1),
        fmt(tv + lv > 0 ? (100 * tv) / (tv + lv) : 0, 1),
        iss > 0 ? fmt((100 * arr) / iss, 1) : "-(지시 없음)",
      ].join("\t"),
    );
  }

  // 사건 방울(개체 수 제외)의 합 — 여기에 문턱 방울을 더한 것이 총수입이다.
  const evAvg = avg(all, (r) => r.econ.crises + r.econ.bossKilled + r.econ.extinctions + r.econ.overachieves);
  console.log(`\n# 사건 방울(위기회복+보스처치+대멸종생존+시험초과) 판당 평균 ${fmt(evAvg, 2)}개`);
  console.log(`# 총수입 = 위 + 표2 에서 고른 사다리의 방울. 티어 한 단계 값을 정할 때 이 합을 쓴다.`);
  console.log(`# ⚠ 손 놓은 판이라 **하한선**이다. 조종이 붙으면 개체 수와 격퇴가 함께 는다.`);
}

/** 시작값 S, 배수 R 의 등비 눈금 중 max 이하인 것의 개수. */
function countRungs(max, S, R) {
  let n = 0;
  for (let v = S; v <= max; v *= R) n += 1;
  return n;
}

async function runSens() {
  const key = opt("trait", "speed");
  const values = opt("values", "50,51,60,61,70,80,90,100").split(",").map(Number);
  const base = PRESETS.find((p) => p.key === opt("presets", "omni").split(",")[0]) ?? PRESETS[0];
  const TICKS = GAME.roundSeconds * SIM.stepsPerSecond * 3; // 채집 세 판(48초) — 한 판은 노이즈가 크다
  console.log(`# sens · ${TRAIT_LABELS[key]} 한 칸이 시뮬에서 읽히는가 · ${base.name} · era ${ERA} · 진도 ${STEP} · 세계 ${W}x${H} · 시드 ${SEEDS.length} · 워밍업 ${WARMUP} + ${TICKS}틱`);
  console.log(["값", "개체(평균)", "표준편차", "먹이섭취", "사망", "앞 값 대비 개체"].join("\t"));
  let prevPop = null;
  for (const v of values) {
    const g = structuredClone(base.genome);
    g.traits[key] = v;
    const pops = [];
    const eats = [];
    const dies = [];
    for (const seed of SEEDS) {
      const w = buildWorld(seed, g);
      for (let i = 0; i < WARMUP + TICKS; i++) w.step();
      pops.push(w.playerPopulation);
      eats.push(w.playerFoodEaten);
      dies.push(CAUSES.reduce((a, c) => a + w.deaths[c], 0));
    }
    const mean = pops.reduce((a, b) => a + b, 0) / pops.length;
    const sd = Math.sqrt(pops.reduce((a, b) => a + (b - mean) ** 2, 0) / pops.length);
    console.log(
      [
        String(v),
        fmt(mean, 2),
        fmt(sd, 2),
        fmt(eats.reduce((a, b) => a + b, 0) / eats.length, 1),
        fmt(dies.reduce((a, b) => a + b, 0) / dies.length, 1),
        prevPop === null ? "-" : `${mean - prevPop >= 0 ? "+" : ""}${fmt(mean - prevPop, 2)}`,
      ].join("\t"),
    );
    prevPop = mean;
  }
  console.log(`# 읽는 법: "앞 값 대비 개체" 가 "표준편차"보다 한참 작으면 그 한 칸은 **시드 운에 묻힌다**.`);
}

async function runEncounter() {
  const presets = pickPresets();
  const TICKS = GAME.roundSeconds * SIM.stepsPerSecond * 2; // 채집 두 판(첫 보스 전까지)
  console.log(`# encounter · era ${ERA} · 진도 ${STEP} · 세계 ${W}x${H}(배율 ${SCALE}) · 시드 ${SEEDS.length} · 감지 반경 ${SIM.predatorSenseRange}px · ${TICKS}틱`);
  console.log(`# 초기거리 = 시작 순간 내 무리와 가장 가까운 포식자까지(px) · 첫감지 = 그 반경 안에 처음 든 시각(초)`);
  console.log(["프리셋".padEnd(18), "초기거리", "최소", "최대", "첫감지(초)", "못만남"].join("\t"));

  for (const p of presets) {
    const d0 = [];
    const t1 = [];
    let never = 0;
    for (const seed of SEEDS) {
      const w = buildWorld(seed, p.genome);
      const myAtk = p.genome.traits.attack;
      const nearest = () => {
        let best = Infinity;
        for (const e of w.entities) {
          if (!e.alive || !e.species.isPlayer) continue;
          for (const o of w.entities) {
            if (!o.alive || !threatens(o.species, myAtk)) continue;
            const d = Math.hypot(o.x - e.x, o.y - e.y);
            if (d < best) best = d;
          }
        }
        return best;
      };
      const start = nearest();
      if (Number.isFinite(start)) d0.push(start);
      let sensed = -1;
      for (let i = 1; i <= TICKS; i++) {
        w.step();
        if (nearest() <= SIM.predatorSenseRange) {
          sensed = i;
          break;
        }
      }
      if (sensed < 0) never += 1;
      else t1.push(sensed / SIM.stepsPerSecond);
    }
    const min = d0.length === 0 ? NaN : Math.min(...d0);
    const max = d0.length === 0 ? NaN : Math.max(...d0);
    console.log(
      [
        p.name.padEnd(18),
        cell(d0, 0),
        fmt(min, 0),
        fmt(max, 0),
        t1.length === 0 ? "-" : fmt(t1.reduce((a, b) => a + b, 0) / t1.length, 1),
        `${never}/${SEEDS.length}`,
      ].join("\t"),
    );
  }
}

const t0 = Date.now();
try {
  // **무엇을 잰 것인가를 맨 위에 못박는다.** 모드 머리글보다 먼저 찍어, 출력을 어디에 붙여 넣어도
  // 축이 같이 따라가게 한다(이 저장소가 네 번 겪은 「잘못된 자로 잰 값」 사고의 재발 방지선).
  console.log(axisLine());
  if (USE_REROLL && !rerollUnlocked()) {
    console.error(
      `\n⚠ --reroll 을 줬지만 메타 경험치 ${METAXP}(레벨 ${metaLevel(METAXP)}) 에서는 리롤이 아직 안 열린다.\n` +
        `  --metaxp=${REROLL_XP} 이상을 함께 줘라. 지금 표는 리롤 없는 판이다.\n`,
    );
  }
  if (MODE === "order") await runOrder();
  else if (MODE === "raid") await runRaid();
  else if (MODE === "poison") await runPoison();
  else if (MODE === "extinction") await runExtinction();
  else if (MODE === "replay") await runReplay();
  else if (MODE === "sweep") await runSweep();
  else if (MODE === "era0") await runEra0();
  else if (MODE === "encounter") await runEncounter();
  else if (MODE === "steps") await runSteps();
  else if (MODE === "growth") await runGrowth();
  else if (MODE === "apex") await runApex();
  else if (MODE === "scale") await runScale();
  else if (MODE === "tiers") await runTiers();
  else if (MODE === "econ") await runEcon();
  else if (MODE === "sens") await runSens();
  else {
    console.error(
      `알 수 없는 모드: ${MODE} (replay | order | raid | poison | extinction | sweep | era0 | encounter | steps | growth | apex | scale | sens)`,
    );
    process.exitCode = 1;
  }
  // bossRaidable 은 보스 풀이 늘 때 프로브가 조용히 빈 표를 찍는 걸 막는 안전장치로만 참조한다.
  void bossRaidable;
} finally {
  await server.close();
}
console.log(`# ${((Date.now() - t0) / 1000).toFixed(1)}초`);
