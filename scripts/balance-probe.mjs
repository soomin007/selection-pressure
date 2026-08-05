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
//   npm run probe -- sweep        공격력 스윕 x 약탈자
//   npm run probe -- era0         첫 시대 한 판 전체(실제 일정) · 단계별 개체 수 + 사망 원인 전 항목
//   npm run probe -- encounter    내 종과 가장 가까운 포식자의 초기 거리 · 첫 감지 시각
//   npm run probe -- steps        온보딩 진도 0~3 의 세계를 나란히(종 수·지형 비율·맵 치수·개체 수)
//   npm run probe -- growth       한 런 전체(시대 0~4 · 정복까지) · 카드 장 수 · 정점 도달 시점 · 시대별 위험
//   npm run probe -- apex         정점 4개를 찍은 게놈의 드래프트 후보 구성(죽은 카드·몸집만 바꾸는 카드 비율)
//   npm run probe -- scale        0~100 스케일의 산수만(시뮬 없음): 감쇠·정점 보상·형질 1의 실제 크기
//   옵션: --seeds=6 --presets=omni,herd --boss=raider --era=0 --step=2 --cards=first|skip
//   growth 전용: --policy=first|best|random --veteran(끝낸 런 3 = 늘 진도 3) --metaxp=<수>
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
const { GAME, SCHEDULE, mapScale, eraScarcity, eraDifficulty, onboardingStep, stepUsesDrawnMap, stepWorldOptions } =
  await server.ssrLoadModule("/src/game/config.ts");
const { createBoss, bossRaidable } = await server.ssrLoadModule("/src/sim/boss.ts");
const { defaultGenome, TRAIT_KEYS, TRAIT_LABELS, TRAIT_CEILING } =
  await server.ssrLoadModule("/src/sim/genome.ts");
const {
  PRESET_CARDS, applyCard, cardDelta, cardRedundant, cardPrereqMet, drawCards,
  growthFalloff, effectiveDelta, cardPoolFor, PRESET_LINEAGE, boostCard,
} = await server.ssrLoadModule("/src/game/cards.ts");
const { cardAvailable } = await server.ssrLoadModule("/src/game/achievements.ts");
// 정점 보상의 크기를 재는 데만 쓴다 — 화면·sim 과 **같은 함수**여야 표가 거짓말을 안 한다.
const { nightVisionFactor } = await server.ssrLoadModule("/src/sim/behavior.ts");
const { Rng } = await server.ssrLoadModule("/src/sim/rng.ts");
const { FIRST_ERA_MAP } = await server.ssrLoadModule("/src/sim/mapType.ts");
const { TILE } = await server.ssrLoadModule("/src/sim/terrain.ts");
const { Game } = await server.ssrLoadModule("/src/game/game.ts");

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
function buildWorld(seed, genome, mapTypeOverride, step = STEP, scale = SCALE) {
  return new World(
    seed,
    Math.round(MOBILE.width * scale),
    Math.round(MOBILE.height * scale),
    genome,
    scale * scale,
    [], // 챔피언 — 마지막 진도 전에는 없음이 정상. 그 뒤는 저장본에 달려 프로브에선 재현 불가 → 늘 없음.
    mapTypeOverride ?? mapTypeForStep(step),
    eraScarcity(ERA),
    stepWorldOptions(step),
  );
}

const SEEDS_ALL = [
  "p-1", "p-2", "p-3", "p-4", "p-5", "p-6", "p-7", "p-8",
  "p-9", "p-10", "p-11", "p-12", "p-13", "p-14", "p-15", "p-16",
];
const SEEDS = SEEDS_ALL.slice(0, Number(opt("seeds", "8")));
const BOSS_HORDES = ["swarm", "raider", "isolation", "stalker", "hornet"];
const WARMUP = 600; // 틱. 무리가 자리를 잡고 흩어진 뒤 (라운드 중반과 비슷한 상태)

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

  console.log(`# order · era ${ERA} · 진도 ${STEP} · 세계 ${W}x${H}(배율 ${SCALE}) · areaScale ${AREA_SCALE} · 시드 ${SEEDS.length} · 워밍업 ${WARMUP}틱 → 지시 ${ORDER_TICKS}틱`);
  console.log(`# ORDER.pull=${ORDER.pull} arriveRadius=${ORDER.arriveRadius}`);
  console.log(
    [
      "프리셋".padEnd(18),
      "순종1s", "순종5s", "순종16s", // orderFollowers / 내 종 수 (지시를 향해 실제로 당겨진 개체)
      "도착16s", // 도착 반경 안 비율
      "절반도달", // 무게중심이 처음 거리의 절반까지 온 시드 수
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

    for (const seed of SEEDS) {
      // (1) 지시를 준 세계
      const w = buildWorld(seed, p.genome);
      for (let i = 0; i < WARMUP; i++) w.step();
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
    g.traits.attack = atk;
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
  setSavedProgress(0, 0);
  // 3번째 인자(fixedMapScale)는 원래 테스트 훅이다 · 여기서는 "옛 첫 시대(배율 2.0)와 지금(1.0)을
  // 같은 시드로 나란히 재기" 위해 쓴다(`--scale=2`). 안 주면 실제 게임과 똑같이 mapScale(era).
  const game = new Game(MOBILE.width, MOBILE.height, forcedScale);
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
      else game.pickCard(0);
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
  // 첫 판에 **실제로 고를 수 있는** 시작 종만 잰다 — 메타 레벨 1(첫 플레이)에서 열려 있는 갈래.
  // 잠긴 갈래를 억지로 태우면 신규 플레이어가 겪지 않는 세계를 재게 된다.
  const forced = opt("scale", "") === "" ? undefined : Number(opt("scale", ""));
  const scale = forced ?? mapScale(0);
  const probeGame = new Game(MOBILE.width, MOBILE.height);
  probeGame.fixedSeed = "unlock-probe";
  probeGame.beginRun();
  const openIds = new Set(probeGame.draftCards.map((c) => c.id));
  const presets = pickPresets().filter((p) => openIds.has(`preset_${p.key}`));
  const locked = pickPresets().filter((p) => !openIds.has(`preset_${p.key}`));
  if (locked.length > 0) console.log(`# 잠긴 갈래(첫 플레이에선 못 고름): ${locked.map((p) => p.name).join(", ")}`);
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
// growth / apex / scale · "성장이 난이도를 언제 추월하는가 · 정점 뒤에 무엇이 남는가"
// ────────────────────────────────────────────────────────────────────────────

/** 정점(만렙)이 있는 형질 넷 — 이 넷이 다 100 이면 값형질 성장은 끝난다(몸집·대사·식성만 남는다). */
const APEX_KEYS = ["speed", "vision", "attack", "fertility"];

/**
 * 이 카드가 이 게놈에 실제로 일으키는 변화. **드래프트 칩이 화면에 보여주는 것과 같은 함수**(cardDelta)를
 * 쓴다 — 카드에 적힌 원값(+15)이 아니라 성장 스케일·상한 근접 감쇠·정점 고정·클램프를 다 거친 값이다.
 * 그래서 "효과 0" 판정이 화면과 어긋나지 않는다.
 */
function cardEffect(card, traits) {
  const deltas = {};
  let pos = 0;
  let neg = 0;
  let n = 0;
  for (const key of TRAIT_KEYS) {
    const d = cardDelta(card, key, traits[key]);
    if (d === 0) continue;
    deltas[key] = d;
    n += 1;
    if (d > 0) pos += d;
    else neg -= d;
  }
  return { deltas, pos, neg, n };
}

/** 카드 한 장의 갈래 · dead=아무것도 안 바뀜 / size=몸집만 / live=그 밖(가장 크게 바뀌는 형질과 함께). */
function classifyCard(card, traits) {
  const eff = cardEffect(card, traits);
  const keys = Object.keys(eff.deltas);
  if (keys.length === 0) return { kind: "dead", key: null, eff };
  if (keys.length === 1 && keys[0] === "size") return { kind: "size", key: "size", eff };
  let best = null;
  let bestAbs = -1;
  for (const k of keys) {
    const a = Math.abs(eff.deltas[k]);
    if (a > bestAbs) {
      bestAbs = a;
      best = k;
    }
  }
  return { kind: "live", key: best, eff };
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

function playFullRun(preset, seed, policy, veteranRuns, metaXp, drive = false) {
  setSavedProgress(veteranRuns, metaXp);
  const game = new Game(MOBILE.width, MOBILE.height);
  game.fixedSeed = seed;
  game.leadEnabled = true; // 실제 배포와 같은 설정(단계별 경험치 상한). 지시는 안 준다 = 손 놓은 하한선.
  game.beginRun();
  const want = game.draftCards.findIndex((c) => c.id === `preset_${preset.key}`);
  game.pickCard(want >= 0 ? want : 0);

  const polRng = new Rng(`${seed}-${preset.key}-policy`);
  const stepMs = 1000 / SIM.stepsPerSecond;

  const picks = []; // 고른 카드마다 { n, era, level, name, apexHit }
  const offers = []; // 열린 드래프트의 후보 카드마다 { era, n, postApex, kind, key }
  const apexAt = {}; // 형질 → 몇 번째 카드에서 100 에 닿았나 { card, era }
  let apexAllAt = null;
  const eraRows = new Map();
  const eraRow = (era) => {
    let r = eraRows.get(era);
    if (r === undefined) {
      r = { era, minPop: Infinity, endPop: 0, cards: 0, deaths: {}, embers: 0, level: 0, reached: 0 };
      eraRows.set(era, r);
    }
    return r;
  };

  const noteApex = () => {
    const t = game.genome.traits;
    for (const k of APEX_KEYS) {
      if (apexAt[k] === undefined && t[k] >= TRAIT_CEILING[k]) apexAt[k] = { card: picks.length, era: game.era };
    }
    if (apexAllAt === null && APEX_KEYS.every((k) => apexAt[k] !== undefined)) {
      apexAllAt = { card: picks.length, era: game.era, level: game.level };
    }
  };
  noteApex(); // 프리셋만으로 정점이 찍히는 경우는 없지만, 기준점을 0 으로 박아 둔다

  let guard = 0;
  let ticks = 0;
  let driveTarget = null;
  let driveAt = -999;
  while (guard < 400000) {
    guard += 1;
    if (game.phase === "draft") {
      const postApex = APEX_KEYS.every((k) => apexAt[k] !== undefined);
      const traits = game.genome.traits;
      const cs = game.draftCards;
      for (const c of cs) {
        const cl = classifyCard(c, traits);
        offers.push({ era: game.era, postApex, kind: cl.kind, key: cl.key, id: c.id });
      }
      let idx = 0;
      if (policy === "best" || policy === "apexrush") {
        let bestScore = -Infinity;
        for (let i = 0; i < cs.length; i++) {
          const eff = cardEffect(cs[i], traits);
          let s = eff.pos;
          if (policy === "apexrush") {
            s = 0;
            for (const k of APEX_KEYS) s += Math.max(0, eff.deltas[k] ?? 0);
          }
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
      noteApex();
      continue;
    }
    if (game.phase === "result") {
      const r = eraRow(game.era);
      r.endPop = game.world.playerPopulation;
      r.embers = game.embers;
      r.level = game.level;
      r.deaths = { ...game.world.deaths };
      r.reached = 1;
      if (game.result === "win" && !game.isFinalEra) {
        game.continueToNextEra();
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
  }

  const conquered = game.result === "win" && game.isFinalEra;
  return {
    preset: preset.key,
    seed,
    conquered,
    lost: game.result === "lose",
    lostByEmbers: game.lostByEmbers,
    finalEra: game.era,
    level: game.level,
    cards: picks.length,
    apexAt,
    apexAllAt,
    offers,
    eraRows: [...eraRows.values()],
    traits: { ...game.genome.traits },
  };
}

async function runGrowth() {
  const policy = opt("policy", opt("cards", "best"));
  const veteran = args.includes("--veteran");
  const drive = args.includes("--drive"); // 손이 붙은 판(무리를 먹이·보스로 몬다)
  const runsDone = veteran ? 3 : 0;
  const metaXp = Number(opt("metaxp", "0"));
  // 첫 판에 실제로 고를 수 있는 갈래만(잠긴 갈래를 억지로 태우면 없는 세계를 재게 된다).
  setSavedProgress(runsDone, metaXp);
  const probeGame = new Game(MOBILE.width, MOBILE.height);
  probeGame.fixedSeed = "unlock-probe";
  probeGame.beginRun();
  const openIds = new Set(probeGame.draftCards.map((c) => c.id));
  const presets = pickPresets().filter((p) => openIds.has(`preset_${p.key}`));

  console.log(
    `# growth · 한 런 전체(시대 0~${GAME.eraCap - 1} · 정복까지) · 카드 정책 ${policy} · ` +
      `${veteran ? "숙련자(끝낸 런 3 = 늘 진도 3)" : "첫 런(진도 0→3)"} · 메타 경험치 ${metaXp} · 시드 ${SEEDS.length} · ${drive ? "손이 붙은 판(1초마다 지시)" : "지시 없음(손 놓음)"}`,
  );
  console.log(
    `# 일정 ${SCHEDULE.join("→")} × ${GAME.eraCap} 시대 · 패배는 개체 0 과 불씨 0 둘뿐 · 관문 통과 기준 ${GAME.bossPassThreshold}마리`,
  );

  const all = [];
  for (const p of presets) {
    for (const seed of SEEDS) all.push(playFullRun(p, seed, policy, runsDone, metaXp, drive));
  }

  console.log(`\n# 표1 · 한 런의 결말과 성장 총량 (프리셋별 평균 · 시드 ${SEEDS.length})`);
  console.log(
    ["프리셋".padEnd(18), "정복", "패배", "도달시대", "최종레벨", "카드수", "정점4완성(카드/시대)", "정점개수"].join("\t"),
  );
  for (const p of presets) {
    const rs = all.filter((r) => r.preset === p.key);
    const done = rs.filter((r) => r.apexAllAt !== null);
    const apexN = rs.map((r) => APEX_KEYS.filter((k) => r.apexAt[k] !== undefined).length);
    console.log(
      [
        p.name.padEnd(18),
        `${rs.filter((r) => r.conquered).length}/${rs.length}`,
        `${rs.filter((r) => r.lost).length}/${rs.length}`,
        fmt(rs.reduce((a, r) => a + r.finalEra + 1, 0) / rs.length, 1),
        fmt(rs.reduce((a, r) => a + r.level, 0) / rs.length, 1),
        fmt(rs.reduce((a, r) => a + r.cards, 0) / rs.length, 1),
        done.length === 0
          ? "-"
          : `${fmt(done.reduce((a, r) => a + r.apexAllAt.card, 0) / done.length, 1)} / ` +
            `${fmt(done.reduce((a, r) => a + r.apexAllAt.era + 1, 0) / done.length, 1)} (${done.length}/${rs.length})`,
        fmt(apexN.reduce((a, b) => a + b, 0) / apexN.length, 1),
      ].join("\t"),
    );
  }

  console.log(`\n# 표2 · 형질이 100 에 닿은 시점 (몇 번째 카드 / 몇 번째 시대 · 닿은 런만 평균)`);
  console.log(["형질".padEnd(10), "닿은 런", "카드번호", "시대"].join("\t"));
  for (const k of APEX_KEYS) {
    const hits = all.filter((r) => r.apexAt[k] !== undefined).map((r) => r.apexAt[k]);
    console.log(
      [
        TRAIT_LABELS[k].padEnd(10),
        `${hits.length}/${all.length}`,
        hits.length === 0 ? "-" : fmt(hits.reduce((a, h) => a + h.card, 0) / hits.length, 1),
        hits.length === 0 ? "-" : fmt(hits.reduce((a, h) => a + h.era + 1, 0) / hits.length, 1),
      ].join("\t"),
    );
  }

  console.log(`\n# 표3 · 시대별 난이도와 실제 위험 (전 런 평균 · 그 시대까지 간 런만)`);
  console.log(
    ["시대", "위협배율", "척박배율", "도달런", "카드누계", "레벨", "최소개체", "끝개체", "사망", "최다 사인", "불씨", "여기서끝난런"].join("\t"),
  );
  for (let era = 0; era < GAME.eraCap; era++) {
    const rows = [];
    for (const r of all) for (const e of r.eraRows) if (e.era === era) rows.push({ e, r });
    if (rows.length === 0) {
      console.log([String(era + 1), fmt(eraDifficulty(era), 2), fmt(eraScarcity(era), 2), "0", "-", "-", "-", "-", "-", "-", "-", "-"].join("\t"));
      continue;
    }
    const cum = rows.map(({ r, e }) => r.eraRows.filter((x) => x.era <= era).reduce((a, x) => a + x.cards, 0));
    const ended = rows.filter(({ r }) => r.finalEra === era && (r.lost || r.conquered)).length;
    const deaths = rows.map(({ e }) => Object.values(e.deaths ?? {}).reduce((a, b) => a + b, 0));
    console.log(
      [
        String(era + 1),
        fmt(eraDifficulty(era), 2),
        fmt(eraScarcity(era), 2),
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

  console.log(`\n# 표4 · 드래프트 후보 3장의 구성 — 정점 4개를 다 찍기 전 vs 찍은 뒤 (후보 카드 한 장 단위)`);
  console.log(["구간".padEnd(12), "후보수", "아무것도안바뀜", "몸집만", "그밖", "그밖의 주형질 상위"].join("\t"));
  for (const phase of [false, true]) {
    const os = all.flatMap((r) => r.offers).filter((o) => o.postApex === phase);
    if (os.length === 0) {
      console.log([(phase ? "정점 뒤" : "정점 전").padEnd(12), "0", "-", "-", "-", "-"].join("\t"));
      continue;
    }
    const dead = os.filter((o) => o.kind === "dead").length;
    const size = os.filter((o) => o.kind === "size").length;
    const live = os.filter((o) => o.kind === "live");
    const byKey = new Map();
    for (const o of live) byKey.set(o.key, (byKey.get(o.key) ?? 0) + 1);
    const top = [...byKey.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, n]) => `${TRAIT_LABELS[k]} ${fmt((100 * n) / os.length, 0)}%`)
      .join(" · ");
    console.log(
      [
        (phase ? "정점 뒤" : "정점 전").padEnd(12),
        String(os.length),
        `${fmt((100 * dead) / os.length, 1)}%`,
        `${fmt((100 * size) / os.length, 1)}%`,
        `${fmt((100 * live.length) / os.length, 1)}%`,
        top,
      ].join("\t"),
    );
  }

  const lost = all.filter((r) => r.lost);
  console.log(
    `\n# 패배 ${lost.length}/${all.length} — 불씨 소진 ${lost.filter((r) => r.lostByEmbers).length} · 개체 0 ${lost.filter((r) => !r.lostByEmbers).length}`,
  );
}

/**
 * apex 모드 · **정점 4개를 찍은 게놈 앞에 드래프트가 무엇을 내놓는가**를 게임과 같은 필터로 잰다.
 * growth 모드의 표4 는 실제 런에서 나온 후보라 표본이 그 런의 갈래에 묶인다 — 이쪽은 갈래 8종을 전부
 * 쓸어 "구조적으로 무엇이 남는가"를 본다. sim 을 안 돌리므로 빠르다.
 */
async function runApex() {
  const DRAFTS = Number(opt("drafts", "400"));
  const level = Number(opt("level", "13")); // 사용자의 실기 스크린샷과 같은 런 레벨
  const metaLvl = Number(opt("metalvl", "9")); // 갈래 8종이 다 열린 숙련자(잠긴 갈래를 재면 안 되는 세계)

  /** 이 게놈 상태 앞에서 드래프트가 무엇을 내놓는가 · filtered=false 면 cardRedundant 를 끈다. */
  function survey(traits, lineage, filtered, tag) {
    const allow = (c) =>
      cardAvailable(c.id, metaLvl) && cardPrereqMet(c, traits) && (!filtered || !cardRedundant(c, traits));
    const pool = cardPoolFor(lineage).filter(allow);
    const rng = new Rng(`${tag}-${lineage}-${filtered}`);
    let dead = 0;
    let size = 0;
    let n = 0;
    const byKey = new Map();
    for (let i = 0; i < DRAFTS; i++) {
      for (const c of drawCardsCompat(rng, 3, allow, level, lineage)) {
        n += 1;
        const cl = classifyCard(c, traits);
        if (cl.kind === "dead") dead += 1;
        else if (cl.kind === "size") size += 1;
        else byKey.set(cl.key, (byKey.get(cl.key) ?? 0) + 1);
      }
    }
    // 풀 자체의 구성(뽑기 확률과 무관한 "장 수") — 후보가 몇 갈래로 남았는지를 본다.
    let poolDead = 0;
    let poolSize = 0;
    for (const c of pool) {
      const cl = classifyCard(c, traits);
      if (cl.kind === "dead") poolDead += 1;
      else if (cl.kind === "size") poolSize += 1;
    }
    const top = [...byKey.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, c]) => `${TRAIT_LABELS[k]} ${fmt((100 * c) / n, 0)}%`)
      .join(" · ");
    return { pool: pool.length, poolDead, poolSize, n, dead, size, live: n - dead - size, top };
  }

  /** 게놈 상태 셋 — 정점 전(프리셋 그대로) · 정점 4개 · 실기(정점 4개 + 무리 성향 100 · 대사 28). */
  const STATES = [
    { key: "before", name: "정점 전(프리셋)", make: (p) => structuredClone(p.genome).traits },
    {
      key: "apex4",
      name: "정점 4개",
      make: (p) => {
        const t = structuredClone(p.genome).traits;
        for (const k of APEX_KEYS) t[k] = TRAIT_CEILING[k];
        return t;
      },
    },
    {
      // 2026-08-05 폰 실기 스크린샷: 레벨 13 · 속도·시야·공격력·번식력 100 · 무리 성향 최대 · 대사 28.
      // 정점 넷만 재면 "무리 성향" 카드가 아직 살아 있는 것으로 잡혀 실제보다 후해 보인다.
      key: "real",
      name: "실기(정점4 + 무리 100 · 대사 28)",
      make: (p) => {
        const t = structuredClone(p.genome).traits;
        for (const k of APEX_KEYS) t[k] = TRAIT_CEILING[k];
        t.herding = 100;
        t.metabolism = 28;
        return t;
      },
    },
  ];

  console.log(`# apex · 정점을 찍은 게놈 앞에 드래프트가 무엇을 내놓는가 · 갈래별 ${DRAFTS} 드래프트(카드 ${DRAFTS * 3}장) · 런 레벨 ${level} · 메타 레벨 ${metaLvl}`);
  console.log(`# 분류는 화면과 같은 함수(cardDelta)로 · dead=게놈이 한 칸도 안 움직임 · size=몸집만 움직임`);

  for (const st of STATES) {
    console.log(`\n# ${st.name} · **현재 코드의 필터 그대로**(cardRedundant 켬 = 죽은 카드를 후보에서 뺀다)`);
    console.log(["갈래".padEnd(16), "후보풀(장)", "풀 중 죽음", "풀 중 몸집만", "뽑힌 카드 죽음", "몸집만", "그밖", "그밖의 주형질"].join("\t"));
    for (const p of PRESETS) {
      const lineage = PRESET_LINEAGE[`preset_${p.key}`];
      const t = st.make(p);
      const r = survey(t, lineage, true, st.key);
      console.log(
        [
          p.name.padEnd(16),
          String(r.pool),
          String(r.poolDead),
          String(r.poolSize),
          `${fmt((100 * r.dead) / r.n, 1)}%`,
          `${fmt((100 * r.size) / r.n, 1)}%`,
          `${fmt((100 * r.live) / r.n, 1)}%`,
          r.top,
        ].join("\t"),
      );
    }
  }

  // 필터를 끈 판 — **사용자가 폰에서 실제로 본 화면**이다(「철벽 대형」처럼 세 효과가 전부 막힌 카드가
  // 후보에 그대로 떴다). 필터는 이 조사와 같은 날 다른 세션이 넣는 중이라, 둘을 나란히 둬야
  // "필터가 무엇을 고치고 무엇을 못 고치는가"가 갈린다.
  console.log(`\n# 필터를 끄면(= 이 수정 전, 사용자가 실기에서 본 상태) · 실기 게놈`);
  console.log(["갈래".padEnd(16), "후보풀(장)", "풀 중 죽음", "뽑힌 카드 죽음", "몸집만", "그밖"].join("\t"));
  for (const p of PRESETS) {
    const lineage = PRESET_LINEAGE[`preset_${p.key}`];
    const t = STATES[2].make(p);
    const r = survey(t, lineage, false, "nofilter");
    console.log(
      [
        p.name.padEnd(16),
        String(r.pool),
        String(r.poolDead),
        `${fmt((100 * r.dead) / r.n, 1)}%`,
        `${fmt((100 * r.size) / r.n, 1)}%`,
        `${fmt((100 * r.live) / r.n, 1)}%`,
      ].join("\t"),
    );
  }

  // 남은 의사결정이 실제로 몇 갈래인가 — 후보풀을 "무엇을 바꾸는 카드인가"로 묶는다.
  // 형질 하나하나가 아니라 **선택의 갈래**를 세는 표다(몸집 ↕ · 대사 ↕ · 식성 ↕ · 아직 안 연 능력).
  console.log(`\n# 실기 게놈에서 남은 의사결정의 갈래 (후보풀을 바꾸는 형질로 묶음 · 필터 켬)`);
  console.log(["갈래".padEnd(16), "남은 카드", "몸집↑", "몸집↓", "대사↑", "대사↓", "식성↑", "식성↓", "아직 안 연 능력", "그 밖"].join("\t"));
  for (const p of PRESETS) {
    const lineage = PRESET_LINEAGE[`preset_${p.key}`];
    const t = STATES[2].make(p);
    const allow = (c) => cardAvailable(c.id, metaLvl) && cardPrereqMet(c, t) && !cardRedundant(c, t);
    const pool = cardPoolFor(lineage).filter(allow);
    const bucket = { sizeUp: 0, sizeDown: 0, metaUp: 0, metaDown: 0, dietUp: 0, dietDown: 0, ability: 0, other: 0 };
    const ABILITY = ["swimming", "wings", "echo", "venom", "ranged", "camouflage", "herding"];
    for (const c of pool) {
      const cl = classifyCard(c, t);
      const d = cl.eff.deltas;
      if (ABILITY.some((k) => (d[k] ?? 0) > 0)) bucket.ability += 1;
      else if ((d.size ?? 0) > 0) bucket.sizeUp += 1;
      else if ((d.size ?? 0) < 0) bucket.sizeDown += 1;
      else if ((d.metabolism ?? 0) > 0) bucket.metaUp += 1;
      else if ((d.metabolism ?? 0) < 0) bucket.metaDown += 1;
      else if ((d.diet ?? 0) > 0) bucket.dietUp += 1;
      else if ((d.diet ?? 0) < 0) bucket.dietDown += 1;
      else bucket.other += 1;
    }
    console.log(
      [
        p.name.padEnd(16),
        String(pool.length),
        String(bucket.sizeUp),
        String(bucket.sizeDown),
        String(bucket.metaUp),
        String(bucket.metaDown),
        String(bucket.dietUp),
        String(bucket.dietDown),
        String(bucket.ability),
        String(bucket.other),
      ].join("\t"),
    );
  }
}
/** drawCards 를 게임과 같은 인자로 부르는 얇은 껍데기(인자 순서를 한 자리에 묶어 둔다). */
function drawCardsCompat(rng, n, allow, level, lineage) {
  return drawCards(rng, n, allow, level, undefined, lineage);
}

/**
 * scale 모드 · **0~100 자연수 스케일 자체의 산수**. 시뮬을 안 돌린다(시드 노이즈가 안 섞인다).
 *   ① 상한 근접 감쇠가 카드 한 장의 실효 상승폭을 어떻게 깎는가
 *   ② 50 에서 100 까지 몇 장이 드는가
 *   ③ 정점(100) 보상이 99 대비 실제로 몇 % 인가
 *   ④ 형질 1 이 시뮬 수치에서 몇 % 인가
 */
async function runScale() {
  console.log(`# scale · 0~100 스케일의 산수(시뮬 없음) · 감쇠 FALLOFF_FROM=50 POWER=0.5 · 성장 스케일 0.75`);
  console.log(`\n# 표1 · 카드 한 장의 실효 상승폭(값형질) — 카드에 적힌 원값 대비`);
  const raws = [15, 22, 26];
  console.log(["현재값", "감쇠배율", ...raws.map((r) => `원값+${r}`)].join("\t"));
  for (let v = 50; v <= 99; v += 5) {
    console.log(
      [
        String(v),
        fmt(growthFalloff("speed", v), 3),
        ...raws.map((r) => `+${effectiveDelta("speed", r, v)}`),
      ].join("\t"),
    );
  }
  console.log(["99", fmt(growthFalloff("speed", 99), 3), ...raws.map((r) => `+${effectiveDelta("speed", r, 99)}`)].join("\t"));

  console.log(`\n# 표2 · 50 에서 100 까지 카드 몇 장이 드는가(같은 카드를 반복해 뽑는다고 가정)`);
  console.log(["카드 원값", "50→100 장수", "50→80", "80→95", "95→100"].join("\t"));
  for (const raw of [12, 15, 18, 22, 26, 30]) {
    const stepsTo = (from, to) => {
      let v = from;
      let n = 0;
      while (v < to && n < 500) {
        const d = effectiveDelta("speed", raw, v);
        if (d <= 0) break;
        v += d;
        n += 1;
      }
      return v >= to ? String(n) : `못 닿음(${v})`;
    };
    console.log([`+${raw}`, stepsTo(50, 100), stepsTo(50, 80), stepsTo(80, 95), stepsTo(95, 100)].join("\t"));
  }

  console.log(`\n# 표3 · 정점(100) 보상이 99 대비 실제로 얼마나 센가`);
  console.log(["형질".padEnd(10), "보상", "99 일 때", "100 일 때", "차이"].join("\t"));
  const rf = (v01) => Math.min(1, SIM.roughSpeedFloor + SIM.roughSpeedBonus * v01);
  console.log(["속도".padEnd(10), "험지 감속 면제", fmt(rf(0.99), 4), "1.0000", `+${fmt(100 * (1 / rf(0.99) - 1), 2)}%`].join("\t"));
  const nv = (v01, day) => nightVisionFactor(day, v01);
  console.log(["시야".padEnd(10), "자정 시야 면제", fmt(nv(0.99, 0), 4), "1.0000", `+${fmt(100 * (1 / nv(0.99, 0) - 1), 2)}%`].join("\t"));
  console.log(["시야".padEnd(10), "수풀 시야 면제", fmt(Math.min(1, SIM.grassVisionFloor + SIM.grassVisionBonus * 0.99), 4), "1.0000", `+${fmt(100 * (1 / Math.min(1, SIM.grassVisionFloor + SIM.grassVisionBonus * 0.99) - 1), 2)}%`].join("\t"));
  console.log(["공격력".padEnd(10), `체급 무시(diff01 ≤ -${SIM.biteIgnoreDiff} 도 문다)`, "이빨 안 박힘", "무조건 박힘", "이진(조건부)"].join("\t"));
  console.log(["번식력".padEnd(10), "번식 대가 감소", "기운 50% 잃음", `기운 ${fmt(50 * SIM.apexBreedCost, 0)}% 잃음`, `대가 -${fmt(100 * (1 - SIM.apexBreedCost), 0)}%`].join("\t"));

  console.log(`\n# 표4 · 형질 1 이 시뮬에서 얼마나 큰가(60 → 61 · 그리고 전 구간 폭)`);
  console.log(["형질".padEnd(10), "식", "60", "61", "1 당 변화", "0→100 전체 폭"].join("\t"));
  const sp = (v) => SIM.maxSpeedBase * (0.4 + v / 100);
  console.log(["속도".padEnd(10), "maxSpeed = 1.7×(0.4+속도/100)", fmt(sp(60), 4), fmt(sp(61), 4), `+${fmt(100 * (sp(61) / sp(60) - 1), 2)}%`, `×${fmt(sp(100) / sp(0), 2)}`].join("\t"));
  const vs = (v) => SIM.visionBase * (v / 100);
  console.log(["시야".padEnd(10), "반경 = 200×(시야/100)", fmt(vs(60), 1), fmt(vs(61), 1), `+${fmt(100 * (vs(61) / vs(60) - 1), 2)}%`, `0 → 200px`].join("\t"));
  const fr = (v) => SIM.reproduceRate * (0.3 + v / 100);
  console.log(["번식력".padEnd(10), "확률 = 0.01×(0.3+번식/100)", fmt(fr(60), 5), fmt(fr(61), 5), `+${fmt(100 * (fr(61) / fr(60) - 1), 2)}%`, `×${fmt(fr(100) / fr(0), 2)}`].join("\t"));
  console.log(["공격력".padEnd(10), "물기 판정 diff01 = (내-상대)/100", "0.00", "0.01", `문턱까지 ${fmt(SIM.biteIgnoreDiff * 100, 0)}점`, "-0.35 이하면 안 박힘"].join("\t"));
  console.log(
    `\n# 참고 · 한 장(+15)의 실효 상승폭은 형질 50 에서 +11, 80 에서 +7, 95 에서 +4 다. ` +
      `속도로 치면 각각 최대 속도 +11.0% · +5.6% · +2.9% 다.`,
  );

  // ── 카드 경제만 떼어 본다 · **시뮬을 안 돌린다.** 살아남기(생존)와 자라기(성장)를 갈라 놓아야
  //    "정점이 쉬운가"에 답할 수 있다 — sim 을 태우면 일찍 죽은 판이 성장 곡선을 가려 버린다.
  //    드래프트는 게임과 완전히 같은 규칙으로 돈다(해금·전제·cardRedundant·레벨별 등급 보정·소프트 디듑).
  const ECON_N = Number(opt("econ", "24")); // 한 런에 실제로 얻는 카드 수의 상한 언저리(아래 표7 참조)
  const ECON_TRIES = Number(opt("tries", "40"));
  const metaLvlE = Number(opt("metalvl", "9"));
  console.log(`\n# 표6 · **카드 경제만** — 카드 ${ECON_N}장을 순서대로 고르면 형질이 어디까지 가나(시뮬 없음 · ${ECON_TRIES}회 평균)`);
  console.log(`# 정책 best=효과 합이 가장 큰 장 · apexrush=정점 넷의 상승분이 가장 큰 장 · first=늘 첫 장 · random=무작위. 시대 보상(×2)은 4·8·12·16번째 카드로 넣는다(런당 4회).`);
  console.log(["갈래".padEnd(16), "정책".padEnd(8), "정점1", "정점2", "정점3", "정점4(4개 완성)", "12장뒤", "17장뒤", "24장뒤", "속도/시야/공격/번식"].join("\t"));
  for (const p of PRESETS) {
    const lineage = PRESET_LINEAGE[`preset_${p.key}`];
    for (const policy of ["best", "apexrush", "first", "random"]) {
      const hitN = [[], [], [], []];
      const finals = [];
      const at = { 12: 0, 17: 0 };
      const traitSum = { speed: 0, vision: 0, attack: 0, fertility: 0 };
      for (let tryI = 0; tryI < ECON_TRIES; tryI++) {
        const g = structuredClone(p.genome);
        const rng = new Rng(`econ-${p.key}-${policy}-${tryI}`);
        const picked = new Map();
        const hits = [];
        for (let n = 1; n <= ECON_N; n++) {
          const t = g.traits;
          const level = Math.min(20, 1 + n);
          const allow = (c) => cardAvailable(c.id, metaLvlE) && cardPrereqMet(c, t) && !cardRedundant(c, t);
          let cs = drawCards(rng, 3, allow, level, picked, lineage);
          if (n % 4 === 0) cs = cs.map((c) => boostCard(c, GAME.eraRewardBoost));
          if (cs.length === 0) break;
          let idx = 0;
          if (policy === "best" || policy === "apexrush") {
            // apexrush = **정점 넷(속도·시야·공격력·번식력)만 보고** 고른다. 화면의 큰 숫자 넷을 올리려는
            // 사람의 근사 · 이 게임에서 "수치를 키운다"고 하면 사실상 이 넷을 가리킨다.
            let bs = -Infinity;
            for (let i = 0; i < cs.length; i++) {
              const eff = cardEffect(cs[i], t);
              let s = 0;
              if (policy === "best") s = eff.pos;
              else for (const k of APEX_KEYS) s += Math.max(0, eff.deltas[k] ?? 0);
              if (s > bs) {
                bs = s;
                idx = i;
              }
            }
          } else if (policy === "random") idx = rng.int(0, cs.length - 1);
          const before = APEX_KEYS.filter((k) => t[k] >= TRAIT_CEILING[k]).length;
          applyCard(g, cs[idx]);
          picked.set(cs[idx].id, (picked.get(cs[idx].id) ?? 0) + 1);
          const after = APEX_KEYS.filter((k) => g.traits[k] >= TRAIT_CEILING[k]).length;
          for (let a = before; a < after; a++) hits[a] = n;
          if (n === 12 || n === 17) at[n] = at[n] + after;
        }
        for (let a = 0; a < 4; a++) if (hits[a] !== undefined) hitN[a].push(hits[a]);
        finals.push(APEX_KEYS.filter((k) => g.traits[k] >= TRAIT_CEILING[k]).length);
        for (const k of APEX_KEYS) traitSum[k] += g.traits[k];
      }
      const col = (i) =>
        hitN[i].length === 0
          ? "-"
          : `${fmt(hitN[i].reduce((a, b) => a + b, 0) / hitN[i].length, 1)}장(${hitN[i].length}/${ECON_TRIES})`;
      console.log(
        [
          p.name.padEnd(16),
          policy.padEnd(8),
          col(0),
          col(1),
          col(2),
          col(3),
          fmt(at[12] / ECON_TRIES, 2),
          fmt(at[17] / ECON_TRIES, 2),
          fmt(finals.reduce((a, b) => a + b, 0) / finals.length, 2),
          APEX_KEYS.map((k) => fmt(traitSum[k] / ECON_TRIES, 0)).join("/"),
        ].join("\t"),
      );
    }
  }

  console.log(`\n# 표7 · 한 런에 얻을 수 있는 카드 수의 **상한** — 단계별 경험치 상한(leadStageXpCap ${GAME.leadStageXpCap})이 정한다`);
  console.log(`# 경험치 필요량 = ${GAME.xpBase} + (레벨-1)×${GAME.xpPerLevel} · 한 런 = ${SCHEDULE.length}단계 × ${GAME.eraCap}시대 = ${SCHEDULE.length * GAME.eraCap}단계`);
  console.log(["단계 수", "상한 경험치", "도달 레벨", "레벨 카드", "시대 보상", "카드 합"].join("\t"));
  for (const stages of [6, 12, 18, 24, 30]) {
    const budget = stages * GAME.leadStageXpCap;
    let lv = 1;
    let spent = 0;
    while (spent + GAME.xpBase + (lv - 1) * GAME.xpPerLevel <= budget) {
      spent += GAME.xpBase + (lv - 1) * GAME.xpPerLevel;
      lv += 1;
    }
    const eras = Math.max(0, Math.ceil(stages / SCHEDULE.length) - 1);
    console.log([String(stages), String(budget), String(lv), String(lv - 1), String(eras), String(lv - 1 + eras)].join("\t"));
  }

  console.log(`\n# 표5 · 시대 곡선(복리) — 위협 강도와 척박도`);
  console.log(["시대", "위협배율", "전 시대 대비", "척박배율", "보스 격퇴체력", "즉사반경 배수"].join("\t"));
  for (let era = 0; era < GAME.eraCap; era++) {
    const d = eraDifficulty(era);
    const prev = era === 0 ? 1 : eraDifficulty(era - 1);
    console.log(
      [String(era + 1), fmt(d, 3), `+${fmt(100 * (d / prev - 1), 1)}%`, fmt(eraScarcity(era), 3), fmt(SIM.bossMaxHp * d, 0), `×${fmt(d, 2)}`].join("\t"),
    );
  }
}

/**
 * sens 모드 · **형질 한 칸이 실제 시뮬에서 읽히는가**. scale 모드의 산수(속도 +1 = 최대 속도 +1.0%)가
 * 화면에서 체감되는 크기인지 답하려면, 그 차이를 **시드 편차와 나란히** 놓아야 한다.
 * 같은 세계에서 형질만 바꿔 한 라운드를 돌리고, 값 사이의 차이와 시드 사이의 흩어짐을 함께 찍는다.
 */
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
  if (MODE === "order") await runOrder();
  else if (MODE === "raid") await runRaid();
  else if (MODE === "sweep") await runSweep();
  else if (MODE === "era0") await runEra0();
  else if (MODE === "encounter") await runEncounter();
  else if (MODE === "steps") await runSteps();
  else if (MODE === "growth") await runGrowth();
  else if (MODE === "apex") await runApex();
  else if (MODE === "scale") await runScale();
  else if (MODE === "sens") await runSens();
  else {
    console.error(
      `알 수 없는 모드: ${MODE} (order | raid | sweep | era0 | encounter | steps | growth | apex | scale | sens)`,
    );
    process.exitCode = 1;
  }
  // bossRaidable 은 보스 풀이 늘 때 프로브가 조용히 빈 표를 찍는 걸 막는 안전장치로만 참조한다.
  void bossRaidable;
} finally {
  await server.close();
}
console.log(`# ${((Date.now() - t0) / 1000).toFixed(1)}초`);
