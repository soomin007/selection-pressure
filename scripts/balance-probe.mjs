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
//   옵션: --seeds=6 --presets=omni,herd --boss=raider --era=0 --cards=first|skip
//
// ⚠ **시대(era)를 반드시 의식하라.** 시대마다 세계가 다르다: 맵 크기(mapScale)·종 구성(첫 시대는 셋)·
//   세계 종류(첫 시대는 초원)·척박도·챔피언 유무. 이 파일의 세계 생성은 game.ts 의 makeWorld 를
//   그대로 옮긴 buildWorld() 한 자리로 모아 뒀다 — 새 갈래가 생기면 거기만 고친다.
//   기본값은 `--era=0`(첫 시대) · 옛 대륙 세계를 재려면 `--era=3` 을 준다.

import { createServer } from "vite";

const args = process.argv.slice(2);
const MODE = args.find((a) => !a.startsWith("--")) ?? "order";
const FULL = args.includes("--full"); // 격퇴 뒤에도 라운드를 끝까지 돌린다(사망 수 회귀 비교용)
const opt = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

const { World } = await server.ssrLoadModule("/src/sim/world.ts");
const { SIM, ORDER } = await server.ssrLoadModule("/src/sim/params.ts");
const { GAME, SCHEDULE, mapScale, eraScarcity } = await server.ssrLoadModule("/src/game/config.ts");
const { createBoss, bossRaidable } = await server.ssrLoadModule("/src/sim/boss.ts");
const { defaultGenome } = await server.ssrLoadModule("/src/sim/genome.ts");
const { PRESET_CARDS, applyCard } = await server.ssrLoadModule("/src/game/cards.ts");
const { FIRST_ERA_MAP } = await server.ssrLoadModule("/src/sim/mapType.ts");
const { Game } = await server.ssrLoadModule("/src/game/game.ts");

// --- 실제 플레이 세계 치수 · 단일 근원 src/config.ts + mapScale(era) 에서 읽는다(main.ts 와 같은 길) ---
const { MOBILE } = await server.ssrLoadModule("/src/config.ts");
const ERA = Number(opt("era", "0")); // 기본은 첫 시대(지금 튜닝 대상). 옛 대륙 세계는 --era=3.
const SCALE = mapScale(ERA);
const W = Math.round(MOBILE.width * SCALE);
const H = Math.round(MOBILE.height * SCALE);
const AREA_SCALE = SCALE * SCALE;

/**
 * 이 시대의 세계를 만든다 — **game.ts 의 makeWorld 와 같은 인자**로. 첫 시대는 단순화 세계(종 셋 ·
 * 평평한 초원 · 챔피언 없음)이고 그 뒤로는 뽑힌 맵 종류다. 프로브가 존재하지 않는 세계를 재던
 * 2026-08-04 사고의 재발 방지선이 여기다.
 */
function buildWorld(seed, genome, mapTypeOverride) {
  const first = ERA === 0;
  return new World(
    seed,
    W,
    H,
    genome,
    AREA_SCALE,
    [], // 챔피언 — 첫 시대는 없음이 정상. 그 뒤는 저장본에 달려 있어 프로브에선 재현 불가 → 늘 없음.
    mapTypeOverride ?? (first ? FIRST_ERA_MAP : opt("map", "continent")),
    eraScarcity(ERA),
    first,
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

  console.log(`# order · era ${ERA} · 세계 ${W}x${H}(배율 ${SCALE}) · areaScale ${AREA_SCALE} · 시드 ${SEEDS.length} · 워밍업 ${WARMUP}틱 → 지시 ${ORDER_TICKS}틱`);
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

  console.log(`# raid · era ${ERA} · 세계 ${W}x${H}(배율 ${SCALE}) · areaScale ${AREA_SCALE} · ${mapType ?? (ERA === 0 ? FIRST_ERA_MAP : "continent")} · diffMul ${diffMul} · 시드 ${SEEDS.length} · ${GAME.bossSeconds}초${drive ? " · 몰기(지시)" : " · 지시 없음"}`);
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
  console.log(`# sweep · ${type} · 균형 잡식에서 공격력만 바꿈 · era ${ERA} · ${W}x${H} · areaScale ${AREA_SCALE} · 시드 ${SEEDS.length}`);
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

async function runEncounter() {
  const presets = pickPresets();
  const TICKS = GAME.roundSeconds * SIM.stepsPerSecond * 2; // 채집 두 판(첫 보스 전까지)
  console.log(`# encounter · era ${ERA} · 세계 ${W}x${H}(배율 ${SCALE}) · 시드 ${SEEDS.length} · 감지 반경 ${SIM.predatorSenseRange}px · ${TICKS}틱`);
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
  else {
    console.error(`알 수 없는 모드: ${MODE} (order | raid | sweep | era0 | encounter)`);
    process.exitCode = 1;
  }
  // bossRaidable 은 보스 풀이 늘 때 프로브가 조용히 빈 표를 찍는 걸 막는 안전장치로만 참조한다.
  void bossRaidable;
} finally {
  await server.close();
}
console.log(`# ${((Date.now() - t0) / 1000).toFixed(1)}초`);
