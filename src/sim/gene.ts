// 방울(유전자 점수) · 자료 구조와 순수 헬퍼.
//
// **[사용자 2026-08-07]** 확정 설계:
//   · 필드에 방울이 나타나고, **무리가 밟고 지나가면** 주워진다. 손가락 탭으로 줍지 않는다
//     (탭은 이미 「가라」라서 충돌한다).
//   · 모은 방울로 **범주의 티어를 올린다**. 능치는 이미 `tiers.ts` 파생표가 낸다.
//   · 방울은 **양이 아니라 사건**에 붙는다. 「사냥 N회」 같은 카운터는 빌드 편향을 만든다.
//
// ⚠ 이 파일은 PixiJS 를 모른다(sim 순수 규칙). 화면은 여기 값을 **읽기만** 한다.
// ⚠ **가격표는 여기 없다.** 방울은 도장(pip)과 같은 단위라, 값은 `tiers.ts` 의 `pipsToNext` 하나가
//    정한다. 여기에 새 표를 만들면 두 곳이 조용히 어긋나고 그 순간 화면이 거짓말을 한다.

import type { Rng } from "@/sim/rng";

// ─────────────────────────────── 자료 구조 ───────────────────────────────

/**
 * 필드에 놓인 방울 하나.
 *
 * 왜 이 다섯 칸인가:
 * · `taken` 을 두고 **배열에서 지우지 않는다** · `Food.available` 과 같은 결이다. 지우는 쪽은
 *   "언제 지우나"를 정해야 하고(줍는 순간 지우면 렌더가 터지는 연출을 그릴 자리를 잃는다),
 *   한 시대에 생기는 방울은 30개 남짓이라 남겨 둬도 순회 비용이 없다. World 는 시대마다 새로
 *   만들어지므로 무한히 쌓이지도 않는다.
 * · `bornTick` 은 **렌더가 나타남을 연출하는 유일한 근거**다. 렌더는 매 프레임 `world.geneDrops` 를
 *   다시 읽으므로 "이게 새 것인가"를 스스로 알 수 없다. 나이 = `world.tick - bornTick`.
 *   수명(만료)은 **일부러 안 넣었다** · 이번 단계는 「가만히 있는 방울」까지이고, 안 정해진 규칙을
 *   필드로 미리 박으면 그게 규칙인 척 굳는다. 나중에 만료를 넣어도 이 구조는 안 바뀐다.
 * · `reason` 은 무엇 때문에 생긴 방울인가 · 화면이 「보스 격퇴 · 방울 +3」처럼 **그 자리에서**
 *   말할 수 있게 한다(대백과에 안 미룬다).
 */
export interface GeneDrop {
  x: number;
  y: number;
  /** 주우면 이만큼 들어온다. 도장(pip)과 같은 단위다. */
  amount: number;
  /** 이미 주웠는가. true 면 렌더는 안 그리고 줍기 판정도 건너뛴다. */
  taken: boolean;
  /** 나타난 틱(`world.tick`) · 렌더의 등장 연출 기준. */
  bornTick: number;
  /** 왜 생겼는가 · 화면 문구의 근거. */
  reason: GeneReason;
}

export function createGeneDrop(
  x: number,
  y: number,
  amount: number,
  bornTick: number,
  reason: GeneReason,
): GeneDrop {
  return { x, y, amount, taken: false, bornTick, reason };
}

// ─────────────────────────────── 방울이 나오는 자리 ───────────────────────────────

/**
 * 방울을 주는 여섯 사건. **양이 아니라 사건**에 붙인다 · 「사냥 N회」처럼 양에 붙이면 그 행동을
 * 많이 하는 빌드만 자라서, 카드를 어떻게 골라도 결국 같은 종이 된다.
 * "era"(새 시대 진입)는 2026-08-11 신설 — **[사용자 2026-08-11]** "4단은 찍지도 못했어" ·
 * v8 의 시대 보상(강화 ×N)이 사라져 비어 있던 자리를 방울로 잇는다(backlog 방향 그대로).
 */
export type GeneReason = "boss" | "extinction" | "milestone" | "recovery" | "trialExceed" | "era";

/**
 * 사건별 방울 수 · **econ 프로브 실측으로 정한 값.**
 *
 * 어떻게 뽑았나(다음 사람이 그대로 재현할 수 있게 인자까지 적는다):
 *   `node scripts/balance-probe.mjs econ`  ← 인자 없이 = 기본값(카드 정책 best · 시드 8 ·
 *   첫 판에 열려 있는 갈래 5종 · 지시 없음 = 손 놓은 판). 아래는 2026-08-08 실행값이다.
 *   ⚠ 시드 수를 바꾸면 값이 움직인다. 표를 갱신할 때 **어떤 모드·시드로 뽑았는지 반드시 함께 적어라** ·
 *     안 적으면 다음 사람이 같은 숫자를 다시 못 만든다(전에 인자 없이 적어 둬서 실제로 재현이 안 됐다).
 *
 * 판당 발생 횟수(표1 의 갈래 평균 · 개체 수 문턱만 표2 의 「S20 ×1.5」 줄)와 곱하면:
 *   보스 격퇴   3 × 3.33 =  9.99
 *   대멸종 생존 4 × 1.48 =  5.92
 *   개체 수 문턱 2 × 2.75 =  5.50
 *   시험 초과   2 × 1.75 =  3.50
 *   위기 회복   5 × 0.20 =  1.00
 *                        ─────────
 *                          25.91   → **판당 26개 안팎**
 *
 * 26개 안팎이 뜻하는 것: 한 범주를 0에서 4단까지 올리는 데 20개(`TIER_STEPS` 의 끝)가 드니,
 * 손 놓은 판도 **한 기둥을 끝까지 세우고 다른 범주 1단(3)까지** 닿는다. 이건 **하한선**이다 ·
 * 조종이 붙으면 보스 격퇴·위기 회복이 늘어 더 나온다.
 *
 * ⚠ **위기 회복이 다섯 중 압도적으로 드물다**(0.20회 = 다섯 판에 한 번). 2026-08-08 이전 표의 0.75~0.86 은
 *   시대 전환마다 터지던 가짜를 함께 센 값이었다(감사에서 확인하고 고쳤다 · known_issues 참고).
 *   진짜 위기 회복은 원래 이만큼 드물다. 값(5)이 가장 큰 것과 짝이 맞지만, **화면이 안내하는 다섯
 *   출처 중 하나가 사실상 거의 안 도는** 상태이기도 하다 · 폰에서 굴려 보고 판단할 자리다.
 *
 * 값의 크기 순서에는 뜻이 있다: **위기 회복(5)이 가장 크다.** 접으려는 순간에 가장 크게 주는 것이
 * 이 프로젝트의 「은근한 보정」과 같은 방향이고, 그러면서도 화면에 적힌 대로 정확히 주므로
 * 거짓말이 아니다(보정은 「무엇이 나오는가」에만 걸고 「그것이 무엇을 하는가」에는 안 건다).
 */
export const GENE_AWARD: Readonly<Record<GeneReason, number>> = {
  boss: 3,
  extinction: 4,
  milestone: 2,
  recovery: 5,
  trialExceed: 2,
  // 시대 진입 · **미실측 추정값이다**(2026-08-11 신설). 시대 4 도달 판이면 +9 로, 판당 수입이
  // 약 26 → 35 가 되어 한 우물 4단(20)에 여유가 생긴다는 산수. 구입 정책 자가 서면 다시 재라
  // (backlog 「2. 성장 속도 재측정」).
  era: 3,
};

/** 사건 한국어 이름 · 방울이 뜰 때 화면이 그대로 쓴다. 다섯 에이전트가 각자 다른 말을 짓지 않게 한 곳에 둔다. */
export const GENE_REASON_LABELS: Readonly<Record<GeneReason, string>> = {
  boss: "보스 격퇴",
  extinction: "대멸종 생존",
  milestone: "개체 수 돌파",
  recovery: "위기 회복",
  trialExceed: "시험 초과 달성",
  era: "새 시대 진입",
};

// ─────────────────────────────── 개체 수 문턱 사다리 ───────────────────────────────

/** 사다리의 첫 눈금. */
export const POP_MILESTONE_START = 20;
/** 눈금 간 배수 · 매번 1.5배. */
export const POP_MILESTONE_RATIO = 1.5;
/** 눈금 개수. */
export const POP_MILESTONE_COUNT = 7;

/**
 * 개체 수 최고 기록이 넘을 때마다 방울을 주는 눈금 = 20 · 30 · 45 · 68 · 101 · 152 · 228.
 *
 * **반올림은 마지막에 한 번만** 한다. 눈금마다 반올림한 값을 다시 1.5배 하면 68×1.5=102 가 되어
 * 확정된 사다리(101)와 어긋난다. 여기서는 `20 × 1.5^i` 를 그대로 계산하고 나서 반올림한다:
 *   20 · 30 · 45 · 67.5 · 101.25 · 151.875 · 227.8125 → 20 · 30 · 45 · 68 · 101 · 152 · 228.
 *
 * ⚠ **지금은 뒤 두 눈금(152 · 228)에 원리적으로 못 닿는다** · `SIM.populationCap` 이 120 이고
 *   그건 야생까지 포함한 세계 전체의 상한이라, 내 종 혼자 그 위로 갈 수 없다. 실측 발생 2.75회도
 *   보통 45~68 근처에서 멈춘다는 뜻이다. 그래도 사다리를 잘라 두지 않는 것은 상한을 올리면 그때
 *   저절로 살아나기 때문이다.
 *
 * 출처: **[사용자 2026-08-07]** 가 정한 것은 「개체 수 문턱을 **배수로 벌어지는 지점**에 둔다」는
 * 방향과 `20·30·45·68·100` **다섯 눈금 예시**이고, **간격은 프로브로 정하라**는 것이었다
 * (`session_logs/2026-08-07.md`). 눈금을 일곱으로 늘린 것과 배수를 1.5 로 못 박은 것은 **내 판단**이다 ·
 * 근거가 낡았다 싶으면 다시 따져도 되는 값이다(사용자가 확정한 수가 아니다).
 */
export const POP_MILESTONES: readonly number[] = (() => {
  const out: number[] = [];
  for (let i = 0; i < POP_MILESTONE_COUNT; i += 1) {
    out.push(Math.round(POP_MILESTONE_START * POP_MILESTONE_RATIO ** i));
  }
  return out;
})();

/**
 * **최고 기록이 `prevMax` 에서 `newMax` 로 올랐을 때 넘은 눈금 수.**
 *
 * 「최고 기록」을 기준으로 삼는 이유: 지금 개체 수로 재면 20 언저리에서 오르내릴 때마다 방울이
 * 쏟아진다. 최고 기록은 단조 증가라 눈금 하나는 한 런에 한 번만 지나간다.
 *
 * 경계 규칙은 「닿으면 준다」(`m <= newMax`) · 화면에 「20마리」라 적었으면 20마리에서 받아야 한다.
 * 한 번에 여러 눈금을 건너뛰면(대량 번식) 그만큼 센다.
 */
export function milestonesCrossed(prevMax: number, newMax: number): number {
  if (newMax <= prevMax) return 0;
  let n = 0;
  for (const m of POP_MILESTONES) {
    if (m > prevMax && m <= newMax) n += 1;
  }
  return n;
}

// ─────────────────────────────── 위기 회복 ───────────────────────────────

/** 「위기」로 보는 선 · 최고 기록의 이 비율 **아래로** 떨어지면 가라앉은 것으로 친다. */
export const CRISIS_LOW = 0.5;
/** 「회복」으로 보는 선 · 최고 기록의 이 비율 **위로** 돌아오면 회복이다. */
export const CRISIS_BACK = 0.9;

/**
 * 위기 회복 판정의 상태. game 이 하나 들고 매 틱 `stepCrisisWatch` 에 개체 수를 넣는다.
 *
 * 왜 순수 함수로 여기 두는가: 「절반 아래로 떨어졌다 90% 위로 복귀」는 **상태 기계**라, 부르는 쪽마다
 * 다시 짜면 반드시 조금씩 달라진다(어디를 최고로 볼 것인가 · 회복 뒤 최고를 갱신할 것인가).
 * 한 곳에 두고 테스트로 못 박는다.
 */
export interface CrisisWatch {
  /** 지금까지의 최고 개체 수. */
  peak: number;
  /** 최고의 절반 아래로 가라앉아 있는가. */
  sunk: boolean;
}

export function createCrisisWatch(): CrisisWatch {
  return { peak: 0, sunk: false };
}

/**
 * 개체 수 한 번을 넣고 **이번에 위기 회복이 성립했는지**를 돌려준다(true 면 방울을 줄 순간).
 *
 * 규칙:
 * · 최고 기록은 늘 갱신한다(회복하면서 최고를 넘어도 자연스럽다).
 * · 가라앉지 않은 상태에서 `peak × 0.5` **미만**으로 떨어지면 `sunk = true`.
 *   **정확히 절반은 아직 가라앉은 것이 아니다**(`<` 이지 `<=` 가 아니다) · 최고 20에서 딱 10이면
 *   위기가 아니다. 부등호 하나가 어긋나면 같은 판을 놓고 게임과 프로브가 다른 답을 낸다.
 * · 가라앉은 상태에서 `peak × 0.9` **이상**으로 돌아오면 true 를 돌려주고 `sunk = false`.
 * · 최고가 0 인(아직 아무도 안 산) 동안은 아무 일도 안 일어난다.
 *
 * ⚠ 최고 기록을 낮추지 않으므로, 한 번 크게 컸다가 계속 작게 사는 런은 회복 방울을 반복해서
 *   받지 못한다(가라앉은 채로 90% 를 못 넘기니까). 그게 의도다 · 회복은 **돌아왔을 때** 주는 것이다.
 *
 * `low`·`back` 은 **문턱 스윕 전용 선택 인자**다. `scripts/balance-probe.mjs` 가 `--crisis=`
 * `--recover=` 로 선을 옮겨 가며 재는데, 그걸 위해 프로브가 상태 기계를 다시 짜면 그 순간 규칙이
 * 두 곳에 살게 된다(실제로 프로브가 `<=` 를 써서 부등호가 이미 어긋나 있었다). **게임 코드는 인자를
 * 넘기지 않는다** · 넘기는 순간 화면에 적힌 것과 다른 규칙으로 방울을 주게 된다.
 * 「언제부터 사건으로 치는가」(최소 최고 기록)는 여기 없다 · 부르는 쪽이 `peak` 를 보고 정한다
 * (게임은 `GAME.geneCrisisMinPeak`, 프로브는 `--crisismin=`).
 */
export function stepCrisisWatch(
  w: CrisisWatch,
  pop: number,
  low: number = CRISIS_LOW,
  back: number = CRISIS_BACK,
): boolean {
  if (pop > w.peak) w.peak = pop;
  if (w.peak <= 0) return false;
  if (!w.sunk) {
    if (pop < w.peak * low) w.sunk = true;
    return false;
  }
  if (pop >= w.peak * back) {
    w.sunk = false;
    return true;
  }
  return false;
}

// ─────────────────────────────── 줍기 · 나타나는 자리 ───────────────────────────────

/**
 * **밟고 지나가면 주워지는 거리(px).** 먹이의 `eatRadius`(9) 보다 넉넉하다 · 먹이는 개체가 일부러
 * 찾아가는 것이고 방울은 **지나가다 걸리는** 것이라, 좁으면 "분명 밟았는데 안 주워졌다"가 된다.
 * (이 수치는 내 판단이다. 실기에서 손맛을 보고 조정해도 된다.)
 */
export const GENE_PICK_RADIUS = 16;

/**
 * 방울이 무리에서 떨어져 나타나는 고리(px). 발밑에 떨어뜨리면 **가만히 있어도 주워져** 조종이
 * 아무 뜻이 없어지고, 너무 멀면 화면 밖이라 있는 줄도 모른다. 폰 논리 해상도 540x960 의 화면
 * 대각이 약 1100px 이므로 아래 값은 "보이는데 걸어가야 하는" 거리다.
 * (이 수치는 내 판단이다. 실기에서 조정해도 된다.)
 */
export const GENE_SPAWN_RING = { min: 120, max: 320 } as const;

/**
 * 고리 위의 무작위 어긋남 하나. **반드시 전용 rng(`world.geneRng`)를 넣어라** · 메인 rng 를 쓰면
 * 소비 횟수가 밀려 야생 생태 밸런스가 통째로 이동한다(`species.ts` 의 `WILD_RNG_KEYS` 제약과 같은 계열).
 *
 * 반지름을 `√` 로 펴서 고리 면적에 고르게 흩는다(안 펴면 안쪽에 몰린다).
 */
export function geneDropOffset(
  rng: Rng,
  minR: number = GENE_SPAWN_RING.min,
  maxR: number = GENE_SPAWN_RING.max,
): { dx: number; dy: number } {
  const a = rng.unit() * Math.PI * 2;
  const t = rng.unit();
  const r = Math.sqrt(minR * minR + t * (maxR * maxR - minR * minR));
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r };
}

/** 방울 하나가 이 개체에게 닿았는가 · 줍기 판정의 단일 진실(제곱 거리라 √ 안 쓴다). */
export function geneDropReached(drop: GeneDrop, x: number, y: number): boolean {
  if (drop.taken) return false;
  const dx = drop.x - x;
  const dy = drop.y - y;
  return dx * dx + dy * dy <= GENE_PICK_RADIUS * GENE_PICK_RADIUS;
}
