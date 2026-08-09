// 규칙기반 개체 행동 (기획서 §3.3). ML 아님 — 게놈 × 단순 규칙 × 환경.
// 다종 생태계: 초식은 식물을, 육식은 다른 종을 먹는다. 포식자는 피하고(속도), 사냥은 공격력으로.
// 무리 성향은 모임(cohesion) + 보온(huddle).
//
// 이동 = "관성 기반 조향". 매 틱 속도를 목표 방향으로 한 번에 꺾지 않고(드득드득/홱 꺾임의 원인),
// 원하는 속도(desired)로 일부만 보간한다. 목표(먹이/먹잇감)는 한 번 정하면 유효한 동안 유지해
// (hysteresis) 매 틱 재탐색이 만드는 목표 진동(제자리 떨림)을 없앤다.
// 결정론: 무작위는 world.rng 만(배회·번식·사냥 확률), 처리 순서 고정.

import type { World, DeathCause } from "@/sim/world";
import type { Entity } from "@/sim/entity";
import type { Food } from "@/sim/food";
import type { Terrain } from "@/sim/terrain";
import type { Traits } from "@/sim/genome";
import { TRAIT_MAX, cloneGenome, mutateGenome } from "@/sim/genome";
import { carnivory01, grazeEfficiency, huntEfficiency } from "@/sim/diet";
import { hasDuo } from "@/sim/tiers";
import { createEntity } from "@/sim/entity";
import { areFriends } from "@/sim/species";
import { bossCanHunt, isRaidFighter, isRaidRangedFighter, raidRangedPower, dealRaidHit, bossRaidTargetFor } from "@/sim/boss";
import { ORDER, SIM } from "@/sim/params";

interface Vec {
  x: number;
  y: number;
}

/**
 * 비행이 유지비에 곱하는 배수(못 나는 종은 1 = 영향 없음).
 *
 * ⚠ **v8 에서 뒤집었다.** 예전엔 날개가 클수록 이 대가가 **줄었다**(`flyMetabolismRelief`) — 저장소에서
 * 유일하게 "투자할수록 싸지는" 자리였고, **[사용자 2026-08-06]** 「티어가 오를수록 대가도 확연히
 * 벌어진다」와 정면으로 어긋났다. 이제 문턱을 넘으면 **고정 ×1.25** 이고 티어가 올라도 안 깎인다.
 * 나는 것은 편해지는 일이 아니라 계속 비싼 일이다.
 */
export function flyDrainMultiplier(wings: number): number {
  if (wings < SIM.flyThreshold) return 1;
  return 1 + SIM.flyMetabolismCost;
}

// 식성 곡선은 **야생종 전용의 옛 규칙**이라 `sim/diet.ts` 로 옮겼다(게놈이 순환 import 없이 쓰려고).
// 여기서 재수출해 기존 호출부·테스트를 그대로 살린다.
export { carnivory01, grazeEfficiency, huntEfficiency };

/**
 * 사냥 스퍼트 배수(질주형 육식) — 육식성이 강한 종이 먹잇감을 추격할 때 최대 속도가 오른다(치타·사자의
 * 폭발적 추격). 추격 중(hunting)이 아니거나 초식이면 1(영향 없음).
 *
 * v8: 입력이 식성 값에서 **육식성 세기(carnivory 0~1)** 로 바뀌었다. 플레이어는 이빨 티어가 이 값을
 * 정하고(0 · 0.15 · 0.45 · 0.75 · 1.0), 야생종은 예전 식성 곡선이 정한다 — 두 세계가 같은 축을 쓴다.
 */
export function huntSprintFactor(carnivory: number, hunting: boolean): number {
  if (!hunting) return 1;
  return 1 + SIM.huntSprintBonus * carnivory;
}

/**
 * "큰 사냥" 배수 — 육식성이 강할수록 한 번의 사냥이 주는 에너지가 커진다.
 * `maxEnergyFor` 의 높아진 상한과 짝이다 — 이게 없으면 높아진 상한이 드문 사냥으로 안 채워져 무의미하다.
 */
export function gorgeFactor(carnivory: number): number {
  return 1 + SIM.carnGorgeBonus * carnivory;
}

/**
 * 무리사냥 먹이 나눔(늑대 무리가 사냥감을 함께 먹는다) — 순수 육식이 사냥에 성공하면 주위 같은 종 무리가
 * 그 카커스(huntGain)에서 몫을 나눠 받는다. 이 packmate 가 받는 에너지다. herding·carnivory01 로 스케일 →
 * "무리사냥 빌드"(순수 육식 + 높은 herding + 뭉친 무리)에서만 크게 켜진다. 이 나눔이 herding 을 육식의
 * 생존 레버로 만든다: 뭉친 팩은 소수의 사냥으로도 다 같이 먹어 자생한다(질주=speed·포만과 나란한 세 번째
 * 사냥법). 잡식·초식(carnivory01=0)은 0(무영향 — 통과기준 보존).
 *
 * herding 은 임계 기반(ranged 형질과 같은 패턴)으로 스케일한다 — packShareThreshold 이하는 나눔 0,
 * 넘어서면 선형으로 오른다. 나눔이 "긴밀하게 뭉친 팩"(높은 herding 을 찍은 무리 빌드)에만 켜지게 해서,
 * 야생 포식자(diet 85·herding 40)를 완전히 배제한다. 제곱·세제곱 스케일로는 야생 pop 이 늘면 뭉쳐 나눠
 * 먹는 되먹임으로 폭주해 잡식 승률을 떨어뜨렸다(game.test 회귀). 임계로 야생을 딱 끊어 잡식 밸런스를
 * 보존한다 — 순수 육식 + 고 herding 은 플레이어 무리 빌드뿐이다(다른 야생 고 herding 종은 다 초식이라
 * carnivory01=0 으로 애초에 제외).
 */
export function packHerdFactor(herding: number): number {
  return clamp((herding - SIM.packShareThreshold) / Math.max(1, TRAIT_MAX - SIM.packShareThreshold), 0, 1);
}
export function packShareGain(huntGain: number, carnivory: number, herding: number): number {
  return huntGain * SIM.packSharePerMember * packHerdFactor(herding) * carnivory;
}

/**
 * 식성별 에너지 상한 — 순수 육식은 큰 사냥의 영양을 maxEnergy 위로 비축한다("긴 포만"). 문턱 70=maxEnergy
 * (잡식·초식은 상한 100 그대로), 완전 육식 100=maxEnergy + carnGorgeReserve. 비축분은 별도 로직 없이
 * 그냥 대사로 천천히 줄어 다음 사냥까지의 생존 시간이 된다 — 드물게 성공해도 크게 먹고 오래 버티는 대형
 * 포식자. 잡식(diet 50)은 carnivory01=0 이라 100 그대로 → 통과기준(잡식 기준선) 밸런스 불변.
 */
export function maxEnergyFor(carnivory: number): number {
  return SIM.maxEnergy + SIM.carnGorgeReserve * carnivory;
}

/**
 * **규칙 면제** — 파생 능치가 100 에 닿았는가. v8 에서 이것은 곧 **그 범주의 최고 티어(4단)** 다.
 *
 * 파생표(`sim/tiers.ts`)는 4단에서만 100 을 넘게 잡혀 있다: 다리 112 · 눈 112 · 이빨 100 ·
 * 가죽 104 · 무리 번식 100. 3단은 전부 90 대 아래라 걸리지 않고, 야생종은 어느 축도 100 에 못 닿는다.
 * 그래서 `isApex` 한 줄이 「4단 = 규칙 면제」를 **표 하나만 고치면 되는 구조**로 구현한다.
 *
 * **[사용자 2026-08-06]** 최고 티어의 보상은 수치가 아니라 **규칙 밖으로 나가는 것**이다:
 *   · 다리 IV — 험한 땅이 걸음을 못 늦추고, **사냥하는 야생의 표적 목록에서 통째로 빠진다**
 *   · 눈  IV — 밤도 수풀도 상대의 은신도 눈을 못 가린다. **다만 좁아진 시야각은 그대로다**
 *              (자기 고유 대가를 되사지 않는다 · 사각을 메우려면 듀오 「파수꾼」을 켜야 한다)
 *   · 이빨 IV — 어떤 가죽도 이빨을 막지 못한다(체급 차로 "안 박힘"이 안 걸린다)
 *   · 가죽 IV — 대멸종의 환경 피해(한파·기근·역병·폭염)를 안 받는다
 *   · 무리 IV — 어미가 치르는 출산 대가가 준다
 *
 * ⚠ 수치를 조금 더 주는 방식으로는 절대 보상이 안 된다(실측: 옛 정점의 험지 면제 +0.15% ·
 *   수풀 면제 +0.50%). 99 에서 이미 거의 다 얻은 것의 나머지이기 때문이다.
 */
export function isApex(v: number): boolean {
  return v >= TRAIT_MAX;
}

/**
 * 몸집 편차(-1 ~ 0 ~ +1) — **50 이 정확히 0**이다. 모든 몸집 효과가 이 값에 비례하므로, 몸집을 안
 * 건드린 종(야생 전부·기존 프리셋)은 보정이 전부 0 이라 v6 과 똑같이 굴러간다(밸런스 보존의 열쇠).
 */
export function sizeDev(size: number): number {
  return (size - TRAIT_MAX / 2) / (TRAIT_MAX / 2);
}

/** 몸집이 최대 속도에 곱하는 배수. 큰 몸은 느리다(50 = 1.0). */
export function sizeSpeedFactor(size: number): number {
  return Math.max(0.1, 1 - SIM.sizeSpeedCost * sizeDev(size));
}

/** 몸집이 기본 대사에 곱하는 배수. 큰 몸은 많이 먹는다(50 = 1.0). */
export function sizeDrainFactor(size: number): number {
  return Math.max(0.1, 1 + SIM.sizeMetabolismCost * sizeDev(size));
}

/** 몸집이 번식 확률에 곱하는 배수. 큰 몸은 새끼를 적게 친다(50 = 1.0). */
export function sizeFertilityFactor(size: number): number {
  return Math.max(0, 1 - SIM.sizeFertilityCost * sizeDev(size));
}

/**
 * 실제로 먹히는 은신(0~1) — 큰 몸은 못 숨는다. 몸집 50 이하면 감쇠가 없고, 커질수록 은신이 무력해진다.
 * 몸집과 은신을 한 축의 양끝으로 묶는 연결고리다: **커져서 버티거나, 작게 숨거나. 둘 다는 안 된다.**
 */
export function effectiveCamo(camouflage: number, size: number): number {
  const camo01 = clamp(camouflage / TRAIT_MAX, 0, 1);
  if (camo01 <= 0) return 0;
  const bulk = Math.max(0, sizeDev(size)); // 몸집 50 이하는 0(감쇠 없음)
  return camo01 * (1 - SIM.sizeCamoPenalty * bulk);
}

/**
 * 은신이 포식자의 **시야** 감지 반경에 곱하는 배수(0~1). 은신 100·몸집 50 이면 ×0.2 — 코앞에 와서야
 * 발견된다. 은신 0 이면 1.0(영향 없음)이라 안 찍은 종은 기존 그대로다.
 *
 * ⚠ **초음파에는 안 통한다.** 은신은 눈을 속이는 것이지 소리를 지우는 게 아니다(호출부에서 시야 반경에만
 * 곱한다). 감각 축끼리의 가위바위보 — 숨는 종은 초음파 사냥꾼 앞에서 무력하다.
 */
export function camoVisionFactor(camouflage: number, size: number): number {
  return 1 - SIM.camoVisionCut * effectiveCamo(camouflage, size);
}

/** 한 번의 물기가 어떻게 되는가. 순수 함수라 테스트로 규칙을 못 박는다. */
export interface BiteOutcome {
  /** 이빨이 안 박힌다 — 체급 차가 너무 크다. 즉사도 피해도 없다. */
  ignored: boolean;
  /** 이 물기가 곧바로 잡아먹을 확률 */
  killChance: number;
  /** 못 죽였을 때 깎는 기운 */
  damage: number;
}

/**
 * 한 번의 물기 결과. **무는 힘 − 버티는 힘 + 몸집 차**로 정한다.
 *
 * v8 에서 **공격력을 무기와 방어로 쪼갰다** (**[사용자 2026-08-06]** 승인). 예전엔 상대의 `attack` 을
 * 내 피해에서 뺐으므로 **공격력 한 칸이 무기와 방어를 동시에 올렸다** — 어떤 값어치를 매겨도 이빨이
 * 항상 정답이 되는 구조였다. **[사용자]** "뭐가 됐든 특정 선택이 '항상 정답'이 되어서는 안 돼."
 *   · attack(이빨)  — 무기. 얼마나 잘 죽이는가.
 *   · defense(가죽) — 방어. 얼마나 안 죽는가.
 *   · size          — 체급. 파생값이라 이빨·가죽을 파면 저절로 커지고, 다리·무리를 파면 작아진다.
 *
 * ⚠ **야생종은 `defense = attack` 으로 채운다**(`genomeFromTraits`). 그러면 이 식이 v7 과 비트 단위로
 *   같은 수를 내므로 손으로 오래 튜닝한 야생 생태가 1도 안 흔들린다. 쪼갠 것은 플레이어 쪽 선택지이지
 *   세계의 물리를 바꾸는 일이 아니다.
 *
 * - 체급이 `biteIgnoreDiff` 넘게 밀리면 **아무 일도 안 일어난다** — "일정 이하의 공격은 무시".
 *   몸집이 크면 여기에 걸려 아예 안 물린다("코끼리는 못 문다").
 * - 그 위에서는 즉사 확률이 체급 차에 비례하고, 못 죽인 물기는 기운을 깎는다("여러 번 물리다 쓰러진다").
 */
export function biteOutcome(
  attack: number,
  preyDefense: number,
  size: number = TRAIT_MAX / 2,
  preySize: number = TRAIT_MAX / 2,
): BiteOutcome {
  const diff01 =
    (attack - preyDefense) / TRAIT_MAX + (SIM.sizeBiteWeight * (size - preySize)) / TRAIT_MAX;
  // **정점 공격력(100)** — 어떤 가죽도 이빨을 막지 못한다. 체급 차로 "안 박힘"이 되는 규칙에서 벗어난다
  // (아무리 큰 상대라도 물 수는 있다 — 다만 확률·피해는 여전히 체급 차를 따른다).
  if (diff01 <= -SIM.biteIgnoreDiff && !isApex(attack)) {
    return { ignored: true, killChance: 0, damage: 0 };
  }
  return {
    ignored: false,
    killChance: clamp(SIM.killChanceBias + diff01 * SIM.killChanceScale, 0, SIM.killChanceMax),
    damage: SIM.biteDamage * Math.max(0, 1 + diff01),
  };
}

/** 앞장선 개체(알파)에서 본 다른 개체와의 관계. 화면 표시와 조종 능력이 **둘 다 이 하나를 읽는다.** */
export interface LeadRelation {
  /** 저쪽이 나를 잡아먹을 수 있다 — 사냥하는 식성이고, 나를 물면 이빨이 박힌다. */
  threat: boolean;
  /** 내가 저쪽을 잡아먹을 수 있다 — 내가 사냥하는 식성이고, 물면 이빨이 박힌다. */
  prey: boolean;
  /**
   * 노릴 수는 있는데 **이빨이 안 박히는** 상대(사냥하는 식성이지만 체급이 크게 밀린다 — "코끼리는 못 문다").
   * prey 와 배타적이다.
   *
   * 왜 따로 두나: 이게 없으면 못 무는 상대는 화면에도 안 뜨고 사냥 버튼도 안 겨눠서, 플레이어가
   * **"왜 안 되는지"를 영영 못 배운다**(없다는 것으로 가르치는 건 가장 약한 가르침이다).
   * 노릴 수 있게 두고 물었을 때 튕기게 해야 몸으로 안다(world 의 "block" 사건).
   */
  tough: boolean;
}

/**
 * 알파와 다른 개체의 관계 — **"쟤가 날 잡아먹나 / 내가 쟤를 잡아먹나"의 단일 진실.**
 *
 * 왜 여기 있나: 이 판정은 두 곳이 쓴다. ① 화면(누구에게 위험 표식을 붙일까) ② 조종 능력(물기 버튼이
 * 저 개체에 통하나). 같은 규칙을 두 군데 적으면 조용히 어긋나고, 그러면 **화면이 거짓말한다** —
 * 이 저장소는 방금 그 사고를 겪었다(known_issues "화면 숫자를 규칙에서 다시 유도하지 마라").
 * herdShielded 를 렌더가 그대로 읽는 것과 같은 이유·같은 패턴이다.
 *
 * 판정은 시뮬이 실제로 쓰는 것 둘을 그대로 조합한다:
 *  · 사냥하는 식성인가 — `diet > SIM.dietHuntMin` (stepEntity 의 canHunt 와 같은 식)
 *  · 물면 박히는가 — `biteOutcome(...).ignored` 가 아닌가. **공격력 차와 몸집 차를 함께** 본다.
 *    그래서 같은 종이라도 개체마다 갈릴 수 있다(큰 개체는 못 문다). 그게 화면에 그대로 보여야 한다.
 *
 * 같은 종·친화 진영(친척)은 둘 다 false 다 — 서로 안 잡아먹는다.
 * ⚠ 무리 방어(herdShielded)는 **일부러 안 본다.** 그건 "AI 포식자가 표적으로 고르는가"의 규칙이지
 *   "물면 박히는가"가 아니다. 사람이 몰고 들어가 무는 것까지 막지는 않는다.
 * rng 미사용·순수 함수(테스트로 규칙을 못 박는다).
 */
export function leadRelation(lead: Entity, other: Entity): LeadRelation {
  if (lead.species.id === other.species.id || areFriends(lead.species, other.species)) {
    return { threat: false, prey: false, tough: false };
  }
  const me = lead.genome.traits;
  const it = other.genome.traits;
  const threat = it.hunt > 0 && !biteOutcome(it.attack, me.defense, it.size, me.size).ignored;
  const canHunt = me.hunt > 0;
  const lands = !biteOutcome(me.attack, it.defense, me.size, it.size).ignored;
  return { threat, prey: canHunt && lands, tough: canHunt && !lands };
}

/**
 * 무리 방어 규칙(순수 함수 — 테스트로 규칙을 못 박는다). 무리 성향이 임계를 넘고 곁에 같은 종이
 * 충분히 있으면 방패가 선다. 둘 다 있어야 한다: 형질만 높고 흩어져 있으면 방패가 없고(뭉쳐야 방어다),
 * 우연히 모였어도 무리 성향이 낮으면 없다(형질을 찍어야 방어다).
 */
export function herdShieldedBy(herding: number, neighbors: number): boolean {
  return herding > SIM.herdShieldThreshold && neighbors >= SIM.herdShieldNeighbors;
}

/**
 * 무리 방어 — 이 개체가 "뭉친 무리 안"이라 포식자가 표적으로 삼지 않는가(사자가 물소 떼를 안 덮친다).
 *
 * 이진 판정인 게 의도다 — 확률을 깎는 방식은 소용이 없었다(프로브). 잡히는 개체는 이미 무리에서
 * 떨어진 낙오자라 "이웃 수" 보정이 애초에 안 걸렸기 때문이다. 표적 선택에서 통째로 빼야 무리가 산다.
 * 무리에서 떨어지는 순간 방패가 사라지므로 완전 면역이 아니다 — 포식자는 늘 가장자리를 노린다.
 *
 * 무리 성향이 임계 이하면 이웃을 세지도 않는다(순회 비용 0 — 야생종이 전부 여기서 빠진다).
 * rng 미사용·격자 순회 순서 고정 → 결정론 보존.
 */
// export: 렌더(worldView)가 "방패가 선 무리 개체"에 보호 링을 그리려고 같은 판정을 읽는다. 시각=로직
// 1:1 — 화면의 방패 링이 실제로 포식자가 안 오는 개체와 정확히 일치해야 한다(안 그러면 표시가 거짓말).
/**
 * **정점 속도(100)의 보상 — 아무도 나를 따라잡지 못한다.** 사냥하는 개체가 표적을 고르는 단계에서
 * 이 개체를 통째로 뺀다(무리 방어 `herdShielded` 와 같은 형태의 이진 규칙).
 *
 * 왜 표적 제외인가: "물릴 확률을 깎는" 방식은 이 저장소에서 이미 두 번 실패했다 — 잡히는 개체는
 * 이미 쫓기기 시작한 뒤라 확률 보정이 늦다. 규칙에서 벗어나려면 **쫓기 전에** 빠져야 한다.
 *
 * ⚠ 보스는 안 봐준다(`boss.ts` 는 이 함수를 안 부른다). 관문은 관문으로 남아야 한다 — 정점 하나로
 *   시대의 시험을 통째로 건너뛰면 성장과 난이도의 경주가 그 자리에서 끝난다.
 */
export function outrunsHunters(p: Entity): boolean {
  return isApex(p.genome.traits.speed);
}

export function herdShielded(p: Entity, world: World): boolean {
  const herding = p.genome.traits.herding;
  if (herding <= SIM.herdShieldThreshold) return false;
  const neighbors = world.grid.countMatching(
    p.x,
    p.y,
    SIM.herdShieldRadius,
    (m) => m.alive && m !== p && m.species.id === p.species.id,
  );
  // 듀오 「원진」(가죽 III + 무리 III): 이웃이 **하나만** 있어도 벽이 선다(사향소의 원).
  if (hasDuo(p.genome.pips, "ring") && neighbors >= 1) return true;
  return herdShieldedBy(herding, neighbors);
}

/**
 * 잡아먹는다 — 즉사 물기든, 여러 번 물려 기운이 다한 것이든 결과는 같다.
 * 방어 독(venom): 독먹이를 삼키면 포식자가 중독되고 영양도 못 얻는다 — 독개구리·독뱀을 삼킨 대가.
 * venom 이 강할수록 독은 크게 옮고 사냥 이득은 준다("잡아먹으면 손해"의 포식 방어).
 */
function devour(e: Entity, prey: Entity, world: World): void {
  const preyVenom = prey.genome.traits.venom;
  prey.alive = false;
  world.recordDeath(prey.species, "predation");
  world.emit("kill", prey.x, prey.y, e.species.isPlayer || prey.species.isPlayer); // 연출: 잡아먹힘(빨강 터짐)
  if (e.species.isPlayer) {
    world.roundCounts.hunts += 1; // 시험 계수: 내 종의 사냥 성공(잡은 쪽만, 잡아먹힌 쪽 아님)
    world.playerHuntKills += 1; // 경험치 원천 ② — 사냥은 하이 리스크 하이 리턴이다(**[사용자 2026-08-06]**)
    // 시험 「표시된 것 사냥」 — 금빛 표식이 찍힌 그 개체를 잡았는가. 표식은 목록에서 빠진다.
    const mi = world.trialMarks.indexOf(prey.id);
    if (mi >= 0) {
      world.trialMarks.splice(mi, 1);
      world.roundCounts.marked += 1;
      world.emit("kill", prey.x, prey.y, true); // 표식을 잡은 순간은 한 번 더 크게 알린다
    }
  }
  if (preyVenom > 0) e.poison += SIM.venomOnHit * (preyVenom / TRAIT_MAX);
  const et = e.genome.traits;
  const carn = et.carnivory;
  // 사냥 수입 = 기본 × 방어독 감쇠 × 사냥 효율(이빨 티어) × 큰 사냥(육식성이 강할수록 크게 먹는다).
  // 육식 빌드는 상한(maxEnergyFor)이 100 위로 올라 이 큰 사냥을 비축한다(긴 포만) — 초식은 상한 100 그대로.
  // 듀오 「큰 턱」(가죽 III + 이빨 III): 한 번 문 것으로 기력이 훨씬 많이 찬다.
  const jaw = hasDuo(e.genome.pips, "bigjaw") ? 1.5 : 1;
  const huntGain = SIM.predationEnergy * (1 - preyVenom / TRAIT_MAX) * et.hunt * gorgeFactor(carn) * jaw;
  e.energy = Math.min(maxEnergyFor(carn), e.energy + huntGain);
  // 무리사냥 먹이 나눔: 사냥감을 같은 종 무리가 함께 먹는다(늑대). 사냥감 주위 같은 종 순수 육식 무리에게
  // 카커스 몫을 지급 — 뭉친 팩은 소수의 사냥으로 다 같이 먹어 자생한다(herding 이 육식 생존 레버). 순수
  // 육식 킬에서만(carnivory01>0) 순회 비용을 치른다. 밀도가 열쇠라 흩어진 야생 포식자(4마리)는 팩을 못 이뤄
  // 나눔이 거의 없다(자연 격리). 나눔 몫은 packmate 자신의 herding·식성으로 스케일(무리 성향이 클수록 많이).
  if (carn > 0) {
    // 듀오 「늑대의 법」(이빨 III + 무리 III): 같이 잡은 것을 나누는 몫이 커진다.
    const law = hasDuo(e.genome.pips, "wolflaw") ? 1.6 : 1;
    world.grid.forEachMatching(prey.x, prey.y, SIM.packShareRadius, (m) => {
      if (!m.alive || m === e || m.species.id !== e.species.id) return;
      const mt = m.genome.traits;
      const share = packShareGain(huntGain, mt.carnivory, mt.herding) * law;
      if (share > 0) m.energy = Math.min(maxEnergyFor(mt.carnivory), m.energy + share);
    });
  }
  e.targetPrey = null;
}

/**
 * 이 형질의 사냥 사정거리(px). 근접 기본값(SIM.attackRange)에 원거리(ranged) 형질이 얹힌다.
 * 임계 기반이라 임계 이하는 기존 기울기(밸런스 불변), 초과분만 급하게 는다(전문 원거리 종만 멀리서 쏜다).
 *
 * stepEntity 안에 있던 지역 계산을 **한 글자도 안 바꾸고** 뽑은 것이다(visionRadius 추출과 같은 이유·같은 방식).
 * 따로 뽑은 까닭: 사람이 시킨 물기(leadBiteTarget)가 AI 사냥과 **같은 사거리**를 써야 하는데, 그 식을 두 군데
 * 적으면 한쪽만 바뀌었을 때 화면의 버튼과 실제 물기가 조용히 어긋난다.
 * ⚠ 덧셈 순서를 바꾸면 부동소수점 마지막 자리가 달라져 결정론 지문이 깨진다. 순서를 손대지 말 것.
 */
export function attackRangeOf(t: Traits): number {
  const rangedLow = Math.min(t.ranged, SIM.rangedThreshold);
  const rangedHigh = Math.max(0, t.ranged - SIM.rangedThreshold);
  return (
    SIM.attackRange +
    (rangedLow / TRAIT_MAX) * SIM.rangedBonus +
    (rangedHigh / TRAIT_MAX) * SIM.rangedBonusHigh
  );
}

/**
 * 한 번의 물기를 실제로 해소한다 — **AI 사냥과 사람이 시킨 물기가 이 함수 하나를 같이 부른다.**
 *
 * 왜 함수로 뽑았나: 알파 조종의 약속이 "능력을 새로 얻는 게 아니라 이미 있는 능력을 사람이 대신
 * 결정하는 것"이라서다. 물기 결과를 두 군데 적으면 언젠가 한쪽에만 보정이 붙고, 그 순간 형질이
 * 장식이 된다(공격력·몸집을 안 찍어도 사람이 몰면 문다). 같은 코드를 부르면 그럴 수가 없다.
 *
 * 부작용 순서는 예전 사냥 블록 그대로다: 쿨다운 세팅 → (원거리면) 발사체 → 물기 판정 → rng 굴림 →
 * 잡아먹기 또는 피해+부상 → 기운이 다하면 그 자리에서 잡아먹힘.
 */
function resolveBite(e: Entity, prey: Entity, world: World, ranged: boolean): void {
  const t = e.genome.traits;
  e.attackCd = SIM.attackCooldownTicks;
  // 원거리 종은 발사체(spit)가 먹잇감으로 날아간다(레일건 조준선 대신 생물다운 뱉기/가시). 근접은 그 자리 물기.
  if (ranged) world.emit("spit", e.x, e.y, e.species.isPlayer || prey.species.isPlayer, prey.x, prey.y);
  // 독은 방어(삼킨 쪽이 중독)라 사냥 성공과 무관 — 물기 판정은 공격력 차와 **몸집 차**를 본다.
  // 큰 먹잇감은 잘 안 죽고, 아주 크면 이빨이 아예 안 박힌다(biteIgnoreDiff).
  // 듀오 「매복」(눈 III + 이빨 III): **아직 한 번도 안 다친** 상대에 넣는 첫 이빨은 피해 2배.
  // 듀오 「덮치기」(이빨 III + 다리 III): 쫓던 표적에 넣는 물기는 거의 빗나가지 않는다.
  const pips = e.genome.pips;
  const bite = biteOutcome(t.attack, prey.genome.traits.defense, t.size, prey.genome.traits.size);
  if (!bite.ignored) {
    if (prey.woundTicks <= 0 && hasDuo(pips, "ambush")) bite.damage *= 2;
    if (e.targetPrey === prey && hasDuo(pips, "pounce")) {
      bite.killChance = Math.min(SIM.killChanceMax, bite.killChance + 0.25);
    }
  }
  // 이빨이 안 박혔다("일정 공격력 이하의 공격은 무시"). 판정상 아무 일도 안 일어나지만 **화면에는
  // 튕겨 나가는 게 보여야 한다** — 안 그러면 "왜 공격이 안 먹히는지"를 알 방법이 화면에 없다.
  // 물린 쪽 자리에서, 문 쪽을 향해(tx,ty) 튕김을 그린다. rng 미사용이라 결정론·밸런스 불변이고,
  // 쿨다운은 위에서 이미 소모됐으므로 헛물기에 대가도 그대로 있다.
  if (bite.ignored) {
    world.emit("block", prey.x, prey.y, e.species.isPlayer || prey.species.isPlayer, e.x, e.y);
    return;
  }
  if (world.rng.chance(bite.killChance)) {
    devour(e, prey, world);
    return;
  }
  prey.energy -= bite.damage;
  prey.woundTicks = SIM.woundTicks; // 다쳤다 — 이 동안 쓰러지면 "부상"이지 굶주림이 아니다
  if (!ranged) world.emit("bite", prey.x, prey.y, e.species.isPlayer || prey.species.isPlayer); // 근접만 그 자리 물기
  // 여러 번 물려 기운이 다하면 그 자리에서 잡아먹힌다(사망 원인은 잡아먹힘 — 포식자가 먹는다).
  if (prey.energy <= 0) devour(e, prey, world);
}

/**
 * 사람이 시킨 사냥의 **겨눔 반경**(px) — 사정거리와 감지 범위 중 넓은 쪽.
 * 사정거리(12px)만 보면 근접 종은 버튼이 사실상 안 켜진다(실측: 90초 동안 한 번도. 먹잇감 최근접이
 * 평균 90px 였다). 그러면 물기는 원거리 종만의 능력이 되고, 근접 종에겐 없는 기능이나 마찬가지다.
 * "볼 수 있으면 노릴 수 있다"가 맞는 규칙이고, 그래서 **시야 형질이 사냥 가능 범위를 정한다** —
 * 눈이 밝을수록 멀리서 표적을 잡는다(초음파 종은 사방으로). 노린다고 물리는 건 아니다: 실제 물기는
 * 여전히 사정거리 안에서만, 같은 판정·같은 쿨다운으로 일어난다.
 *
 * 함수로 뽑은 까닭: 렌더가 같은 값을 읽어 "이 밖은 못 겨눈다"(브래킷 흐림)를 그린다 — 겨눔 규칙의
 * 단일 진실이고, 식을 두 군데 적으면 화면과 실제가 조용히 어긋난다(복제 금지 원칙).
 * ⚠ leadBiteTarget 안에 있던 계산을 **한 글자도 안 바꾸고** 옮겼다. max 비교 순서·수식을 바꾸면
 *   부동소수점 마지막 자리가 달라져 golden 지문이 깨진다(attackRangeOf 의 주석과 같은 이유).
 * rng 미사용·순수 읽기.
 */
export function leadTargetRange(lead: Entity, world: World): number {
  const lt = lead.genome.traits;
  return Math.max(
    attackRangeOf(lt),
    visionRadius(lt, world, lead.x, lead.y),
    SIM.echoBase * (lt.echo / TRAIT_MAX),
  );
}

/**
 * 사람이 물기를 눌렀을 때 **누가 물리는가** — 겨눔 반경(leadTargetRange) 안에서
 * `leadRelation(...).prey` 인 개체 중 가장 가까운 것. 거리가 같으면 **작은 id**(id 는 유일값이라
 * 동률이 원리적으로 없는 전순서다 → 격자 순회 순서와 무관하게 답이 하나다. rng 로 고르면 결정론이 깨진다).
 *
 * **지정 사냥(world.lead.orderTargetId ≥ 0)이면 그 개체만 본다.** 유효(생존 + prey|tough +
 * 겨눔 범위 안)하면 그것, 무효면 **null** — 자동 최근접으로 대체하지 않는다. 잠근 대상을 놓쳤는데
 * 옆의 다른 개체를 무는 사고를 막기 위해서다(명령은 "그 놈"이지 "아무나"가 아니다).
 *
 * ⚠ 조건을 여기서 다시 유도하지 않는다. "내가 쟤를 잡아먹을 수 있나"는 `leadRelation` 하나가 정하고,
 *   화면의 호박빛 브래킷(render/leadVision)도 같은 함수를 읽는다 → **브래킷이 뜬 개체 = 물리는 개체**가
 *   정의상 어긋날 수 없다(known_issues "화면에 뜨는 숫자를 규칙에서 다시 유도하지 마라").
 *   사거리도 AI 사냥이 쓰는 `attackRangeOf` 그대로다.
 *
 * 전체 순회가 아니라 격자 이웃만 훑는다(사거리는 12~60px 남짓이라 몇 칸이면 끝난다).
 * rng 미사용·순수 읽기 — 그래서 화면 표시용으로 매 틱 불러도 세계가 안 갈린다.
 */
export function leadBiteTarget(lead: Entity, world: World): Entity | null {
  const r = leadTargetRange(lead, world);
  // 지정 사냥 — 이 분기는 명령에 targetId 가 실렸을 때만 밟힌다(orderTargetId 는 매 틱 명령 미러라,
  // 명령을 한 번도 안 준 세계는 늘 -1 → 아래 자동 선택이 문자 그대로 기존 코드다. rng 미사용).
  const orderId = world.lead.orderTargetId;
  if (orderId >= 0) {
    for (const o of world.entities) {
      if (o.id !== orderId) continue;
      if (o === lead || !o.alive) return null;
      const rel = leadRelation(lead, o);
      if (!rel.prey && !rel.tough) return null;
      const d2 = (o.x - lead.x) ** 2 + (o.y - lead.y) ** 2;
      // 범위 밖이어도 null — 잠금이 풀린 게 아니라 "지금은 못 겨눈다"다(명령은 레벨 입력이라
      // 다시 범위에 들면 다음 틱에 저절로 되잡힌다).
      return d2 <= r * r ? o : null;
    }
    return null; // 지정한 개체가 세상에 없다(이미 걷혔다) — 역시 자동 대체 없음
  }
  // **물리는 상대를 늘 먼저 고른다.** 못 무는 거구(tough)는 근처에 진짜 먹잇감이 하나도 없을 때만
  // 겨눈다 — 그래야 코앞의 코끼리 때문에 저쪽 토끼를 놓치는 일이 없고, 동시에 "왜 안 되는지"를
  // 배울 기회(물었을 때의 튕김)는 남는다. 정렬 키는 (물리는가, 거리², id) 순의 전순서라 답이 하나다.
  let best: Entity | null = null;
  let bestId = -1;
  let bestD2 = Infinity;
  let bestLands = false;
  world.grid.forEachMatching(lead.x, lead.y, r, (o) => {
    // 격자는 틱 시작에 만들어지므로 이번 틱에 이미 죽은 개체가 남아 있을 수 있다(AI 사냥도 alive 를 본다).
    if (o === lead || !o.alive) return;
    const rel = leadRelation(lead, o);
    if (!rel.prey && !rel.tough) return;
    const d2 = (o.x - lead.x) ** 2 + (o.y - lead.y) ** 2;
    const better =
      best === null ||
      (rel.prey !== bestLands ? rel.prey : d2 < bestD2 || (d2 === bestD2 && o.id < bestId));
    if (better) {
      bestLands = rel.prey;
      bestD2 = d2;
      bestId = o.id;
      best = o;
    }
  });
  return best;
}

export function stepEntity(e: Entity, world: World, newborns: Entity[]): void {
  const t = e.genome.traits;
  // 형질은 0~100 자연수 저장 → 계수 계산은 0~1 로 정규화(÷TRAIT_MAX)해 해석한다(임계 비교는 0~100 그대로).
  const speed01 = t.speed / TRAIT_MAX;
  const metabolism01 = t.metabolism / TRAIT_MAX;
  const herding01 = t.herding / TRAIT_MAX;
  const fertility01 = t.fertility / TRAIT_MAX;
  // 날개≥flyThreshold 면 비행 — 산·물을 날아 넘고, 험지 감속을 무시하며, 높이 날아 시야가 넓다.
  // 대신 계속 날갯짓이라 대사가 더 든다(비행의 대가). 날개 0 인 종은 canFly=false → 전부 영향 0(밸런스 보존).
  const canFly = t.wings >= SIM.flyThreshold;
  // 원거리(ranged) 사거리 — 사냥 사정거리이자, 원거리 종이 먹잇감에 붙지 않고 멈춰 쏘는 거리(kiting).
  // 임계 기반: 임계(rangedThreshold) 이하는 기존 기울기(밸런스 불변), 초과분만 급한 기울기로 사거리가
  // 확 는다 → 전문 원거리 종만 멀리서 쏜다(야생·부수적 ranged 는 근접 그대로).
  // (식은 attackRangeOf 로 뽑아 뒀다 — 사람이 시킨 물기가 **같은 사거리**를 써야 하기 때문이다.)
  const atkRange = attackRangeOf(t);
  // 사냥 스퍼트(질주형 육식): 순수 육식이 먹잇감을 추격 중이면 속도가 오른다 — 도망치는 초식을 speed 50
  // 으론 못 잡던 병목을 speed 형질로 푼다(치타의 폭발적 추격). 순수 육식일수록·추격 중일 때만이라 야생
  // 초식·잡식은 영향 0.
  const sprintFactor = huntSprintFactor(t.carnivory, e.targetPrey !== null);
  // 험지(거친 땅)에선 이동이 느려진다 — speed 형질이 높을수록 덜 느려진다(속도가 지형에서 가치). 비행은 무시.
  // 몸집이 크면 느리다(sizeSpeedFactor — 몸집 50 이면 1.0 이라 영향 없음).
  // **정점 속도(100)**: 험한 땅도 이 걸음을 늦추지 못한다(험지 감속 완전 면제).
  const roughFree = canFly || isApex(t.speed);
  const maxSpeed =
    SIM.maxSpeedBase * (0.4 + speed01) *
    (roughFree ? 1 : roughSpeedFactor(world, e.x, e.y, speed01)) * sprintFactor *
    sizeSpeedFactor(t.size);
  // 이 자리에서 실제로 보는 반경. 밤·수풀 감쇠, 비행 보너스, 정점 시야(100) 면제가 전부 visionRadius
  // 안에 있다(렌더가 같은 함수로 안개 구멍을 뚫어 화면과 로직을 1:1 로 맞춘다).
  const vision = visionRadius(t, world, e.x, e.y);
  // **공통 유지비(청구서)** — v8 의 두 겹 대가 중 (a). 티어가 오르면 이 배수가 오른다
  // (**[사용자 2026-08-06]** "대가는 두 겹. 공통 대사 유지비 + 범주마다 고유한 대가 하나씩").
  // 야생종은 `upkeep = 0.5 + 대사/100` 이라 v7 과 비트 단위로 같다.
  // 거기에 곱해지는 둘: 나는 것은 계속 비싸고(flyDrainMultiplier), 큰 몸은 많이 먹는다(sizeDrainFactor).
  // 그리고 **다리의 고유 대가** — 최고 속도에 가까울수록 배가 고파진다(질주 뒤 지침).
  const sprintDrain = t.sprintCost > 0 ? 1 + t.sprintCost * Math.min(1, Math.hypot(e.vx, e.vy) / Math.max(0.01, maxSpeed)) : 1;
  const drain =
    SIM.metabolismDrain * t.upkeep * flyDrainMultiplier(t.wings) * sizeDrainFactor(t.size) * sprintDrain;
  // ⚠ 수명은 **일부러 유지비와 안 묶었다.** 여기에 유지비를 곱하면 야생 전 종의 수명이 함께 움직여
  //   손으로 튜닝한 붐-버스트가 흔들린다. 유지비의 대가는 「굶주림」 한 축으로만 낸다(읽히는 축이 하나여야
  //   플레이어가 무엇 때문에 죽었는지 안다).
  const maxAge = SIM.baseMaxAge;
  // **사냥/채집 자격은 이제 효율이 직접 말한다.** 이빨 0단은 `hunt === 0` 이라 사냥이 원리적으로 불가하고
  // (**[사용자]** 초식 거인 경로 = 이빨에 도장을 하나도 안 넣는 것 자체가 빌드), 채집은 효율이 바닥
  // (grazeMinEff)보다 남아 있는 한 계속된다 — 극단 육식이 무의미한 채집 이동을 하지 않게 여기서 끊는다.
  const canHunt = t.hunt > 0;
  const canGraze = t.graze > SIM.grazeMinEff;
  // 수영 종만 물에 들어가고(산은 못 넘되 비행은 예외), 물 전용(수영 아주 높음)은 육지에 못 올라온다.
  const canSwim = t.swimming >= SIM.swimThreshold;
  const canLand = t.swimming < SIM.aquaticOnlyThreshold;

  // 무리 이웃(3×3 칸) — cohesion(이동)과 huddle(보온)에 함께 쓴다.
  const nb = t.herding > 0 ? world.grid.neighborhood(e.x, e.y) : null;

  // --- 원하는 속도(desired) 계산 ---
  let desired: Vec;
  let turn: number = SIM.steerTurn;

  // **레이드 — 카운터 형질이 강한 개체(전사)는 도망 대신 맞선다.** 보스가 물어 올 때 그 자리에서 맞받아쳐
  // 격퇴 체력을 깎는다(boss.memberKills·killRadius 가 dealRaidHit). 카운터가 공격·속도·무리·시야면 전사가
  // 되고, 약한 개체는 그대로 도망(computeFlee) — "전사와 도망자". 접근·kiting 이 아니라 그 자리 반격인
  // 이유: 떼가 내 종보다 빨라 kiting 이 원천적으로 안 통한다(도망 차단이 설계). 전사만 맞서 전멸도 없다.
  const raidBoss = world.boss;
  const fighter = raidBoss !== null && isRaidFighter(raidBoss, e, world); // 근접(공격·카운터) 또는 원거리
  // **원거리 전사** — 보스가 사거리 안에 들면 쏜다(격퇴 체력 깎기). 근접 전사가 제자리에서 반격하듯, 원거리도
  // 쫓지 않는다(보스가 무리로 오므로) — 지형에 막혀 접근 못 하던 문제를 없앤다. 안 죽는 전사라 코앞이어도 쏜다.
  if (fighter && raidBoss && isRaidRangedFighter(raidBoss, e, world)) {
    const tgt = bossRaidTargetFor(raidBoss, e.x, e.y);
    if ((e.x - tgt.x) ** 2 + (e.y - tgt.y) ** 2 <= atkRange * atkRange && e.attackCd <= 0) {
      dealRaidHit(raidBoss, raidRangedPower(t) * SIM.raidRangedMul, world);
      e.attackCd = SIM.attackCooldownTicks;
      world.emit("spit", e.x, e.y, e.species.isPlayer, tgt.x, tgt.y); // 연출: 발사체가 보스로 날아간다(원거리)
    }
  }
  const flee = fighter ? null : computeFlee(e, world, t, maxSpeed, canSwim, canLand, canFly);
  const fleeing = flee !== null;
  if (flee) {
    desired = flee;
    turn = SIM.fleeTurn; // 도망은 빠르게 반응
  } else {
    const goal = chooseGoal(e, world, vision, SIM.echoBase * (t.echo / TRAIT_MAX), canHunt, canGraze);
    if (goal) {
      // 지형 길찾기: 목표가 직선으로 보이면 직진, 막혀 있으면 격자 BFS 경로를 따라 우회한다.
      const nav = navTo(e, world, goal, canSwim, canLand, canFly);
      // 최종 목표가 직선으로 보일 때만 도착 감속(arrive) — 가까울수록 줄여 오버슈트(와리가리)를 없앤다.
      // 사냥: 원거리 종은 사거리에서 멈춰 쏜다(붙지 않음 — kiting). 근접 종은 사정거리(공격 사거리)까지 바짝.
      const huntR = Math.max(SIM.huntArriveRadius, atkRange * 0.85);
      const r = nav.final ? (e.targetPrey !== null ? huntR : SIM.arriveRadius) : 0;
      desired = toward(nav.x - e.x, nav.y - e.y, maxSpeed, r);
    } else {
      e.path.length = 0; // 목표가 없으면 경로 버림(배회로 전환)
      e.pathGoalTile = -1;
      desired = wanderDesired(e, world, maxSpeed);
    }
    // 무리 cohesion: 무리에서 충분히 벗어났을 때만 무게중심으로 끌어당긴다.
    // 무리 안(comfort)에선 cohesion 0 — COM 이 격자 양자화로 매 틱 튀어, 늘 적용하면 무리 종이
    // 제자리에서 떤다. 벗어난 정도에 비례해 서서히 세져(램프) 경계에서의 떨림도 없앤다.
    if (nb && nb.count > 1) {
      // 알파 조종: **최근에 조종 입력이 있었던 동안만**(followTicks>0) 내 종은 3×3 무게중심 대신
      // 앞장선 개체를 목표로 삼는다. 명령이 한 번도 없으면 followTicks 가 영원히 0 이라 아래는
      // 문자 그대로 기존 코드다(무입력 동일성의 유일한 근거 — leaderId 만 보고 갈아타면 안 된다).
      //
      // 가중치는 손대지 않는다 → herding 0 이면 w=0 이라 **아무도 안 따라온다**(형질이 곧 규칙).
      // ⚠ nb.comX/comY 는 종을 안 가린 혼합 무게중심이다(SpatialGrid.neighborhood 는 근처 야생도
      //   센다). 알파로 갈아타는 것은 "추종을 더한 것"인 동시에 "그 야생 혼입을 지운 것"이기도 하다.
      //   ON/OFF 를 견줄 때 이 차이를 버그로 오해하지 말 것.
      const L = world.lead;
      const follow =
        L.followTicks > 0 && L.leaderId >= 0 && e.species.isPlayer && e.id !== L.leaderId;
      const ax = follow ? L.x : nb.comX;
      const ay = follow ? L.y : nb.comY;
      const hdx = ax - e.x;
      const hdy = ay - e.y;
      const hd = Math.hypot(hdx, hdy);
      // 목표가 벽 너머(직선으로 안 보임)면 cohesion 을 끈다 — 못 가는 무리를 쫓아 벽에 정지하지
      // 않게(길찾기는 먹이 목표에만 적용되므로 cohesion 발 끼임은 여기서 막는다). 알파가 물 건너로
      // 가면 육상 무리가 물가에 머리를 박고 서는 것도 같은 장치가 막는다.
      // near/reach 로 쪼갠 것은 순수 정리다 — lineOfSight 는 예전과 똑같이 hd>comfort 일 때만 불린다.
      const near = hd <= SIM.herdComfortRadius;
      const reach = !near && world.terrain.lineOfSight(e.x, e.y, ax, ay, canSwim);
      // HUD 의 "따르는 무리 N" 은 여기서, 규칙이 실제로 판정된 그 자리에서 센다. 바깥에서 조건을 다시
      // 유도하면(예전 followsLead) 이 블록이 flee 의 else 안이라는 사실이 빠져 도망 중인 개체까지
      // 세어 버렸다(실측 54%가 실제로는 도망 중이었다).
      // 세는 조건 = "곁에 있거나(near) 실제로 끌려오는 중(reach)". 둘 다 아니면 산·물에 가려 알파
      // 쪽으로 한 번도 안 당겨지는 개체다 — 그건 따라오는 게 아니라 못 오는 것이라 세지 않는다
      // (안 그러면 실측 17%가 부풀었다). 나머지 조건(도망 아님·내 종·알파 본인 아님·herding>0·
      // 이웃 있음·followTicks>0)은 여기 닿은 시점에 전부 통과돼 있다 = 정의상 정확하다.
      // rng 를 안 건드리고 단순 합계라 개체 순회 순서와 무관하다.
      if (follow && (near || reach)) L.followerCount += 1;
      if (reach) {
        const pull = Math.min(1, (hd - SIM.herdComfortRadius) / SIM.herdComfortRamp);
        // 앞장선 자를 따라갈 때만 더 센 가중치를 쓴다(L.followWeight). 무게중심 뭉침은 그대로
        // SIM.herdCohesion 이라 **기존 모드는 1비트도 안 바뀐다**. 왜 다른 값인지는 params.ts 의
        // LEAD.followCohesion 주석에 있다(무게중심은 권위 없는 평균, 앞장선 자는 사람이 정한 방향).
        // ⚠ herding01 은 그대로 곱한다 — 무리 성향 0 이면 여전히 아무도 안 따라온다(형질이 규칙).
        const w = (follow ? L.followWeight : SIM.herdCohesion) * herding01 * pull;
        const herd = scaleTo(hdx, hdy, maxSpeed);
        desired = {
          x: desired.x * (1 - w) + herd.x * w,
          y: desired.y * (1 - w) + herd.y * w,
        };
      }
    }
  }

  // --- 알파 조종: 방향만 사람이 정한다 ---
  // 위쪽 자율 판단(computeFlee·chooseGoal·navTo·wanderDesired·cohesion)은 **하나도 건너뛰지 않았다.**
  // 배회 분기의 world.rng.range 한 번이 사라지면 난수 스트림이 통째로 밀린다(known_issues 의
  // "쌍둥이" 함정과 같은 자리). 여기서는 결과값 desired·turn 만 덮어쓴다.
  //
  // maxSpeed 를 반드시 곱한다 — 속도 형질·몸집·험지 감속·비행·사냥 스퍼트가 전부 그 안에 있다.
  // 상수 속도로 밀면 "형질이 손끝으로 읽힌다"는 목적 자체가 사라진다.
  //
  // turn 은 **기존 상수 SIM.fleeTurn 을 재사용**한다. 새 조향 상수를 만들지 않는 이유:
  // 카드가 말하지 않는 물리(예: 몸집→회전반경)를 손끝에 지어내면 "표시와 실제가 다르다"와
  // 같은 위반이다. 사람이 모는 개체는 도망칠 때처럼 즉각 반응한다 — 그게 이 값의 뜻이다.
  //
  // fleeing 플래그는 읽지도 쓰지도 않는다(끼임 감지·사냥·섭취 세 갈래가 거기 매달려 있어서,
  // 알파만 예외로 만들면 "쫓기면서 먹는" 알파 전용 규칙이 생겨 권능이 는다).
  // 덮어쓰기가 관성 앞에서 끝나야 아래 축분리 지형 차단과 경계 반사를 명령 벡터도 통과한다
  // (수영 없이 물에 못 들어가고, 날개 없이 산을 못 넘고, 맵 밖으로 못 나간다).
  const lcmd = world.lead.cmd;
  if (lcmd !== null && lcmd.throttle > 0 && e.id === world.lead.leaderId) {
    const push = maxSpeed * Math.min(1, lcmd.throttle);
    desired = { x: lcmd.dx * push, y: lcmd.dy * push };
    turn = SIM.fleeTurn;
  }

  // --- 무리 지시(신탁): 뜻은 분명하되 이행은 종의 천성이 정한다 (sim/herdOrder.ts) ---
  // 위 자율 판단을 **하나도 건너뛰지 않는다** · 배회의 world.rng 소비가 사라지면 난수 스트림이 통째로
  // 밀린다(known_issues 의 "쌍둥이" 함정). 여기서는 결과값 desired 만 섞는다. 지시가 없으면(null)
  // 이 블록은 통째로 안 돌아, 명령을 한 번도 안 준 세계는 기존과 부동소수점까지 같다.
  //
  // 우선순위: 도망 > 사냥감 추적 > (가는 길·코앞의) 먹이 > **지시** > 배회.
  // ⚠ 단 **해제 반경(releaseRadius, 개체 단위) 밖에서는 지시가 그 밖의 먹이를 이긴다.** 예전 조건은
  //   targetFood/targetPrey 가 하나라도 있으면 지시를 통째로 무시했는데, 먹이를 쫓는 것은 예외적
  //   사정이 아니라 **기본 상태**다(실측: 개체틱의 72.1%). 그래서 순종률이 7.5% 였고 사용자가
  //   "내 말을 듣는다는 느낌이 전혀 안 든다"고 했다. herdOrder.ts 가 스스로 정한 마지막 선
  //   "방향은 반드시 따른다"를 코드가 못 지키고 있던 것이다.
  //
  // "가는 길" 예외는 남긴다 · 목표가 지시 쪽(내적 ≥ 0)이고 지시점보다 가까우면 그것부터 먹고 간다.
  // 순수 기하라 rng 를 한 번도 안 쓴다(스트림 불변).
  //
  // ★ chooseGoal 은 한 글자도 안 건드린다 · targetFood 는 그대로 세팅해 두고 **이동 벡터만** 덮는다.
  //   먹기는 근접(eatRadius) 판정이라 행진 중 지나치는 먹이는 자동으로 먹힌다(아래 섭취 블록).
  //
  // ★ **목소리가 닿는 데까지만 간다** (**[사용자 2026-08-06]** 확정). 명령은 알파에서 이 거리 안의
  //   개체에게만 걸리고, 그 거리를 **무리 티어가 넓힌다**(260px → 4000px · 열쇠 「부름」이면 ×1.6).
  //   그래서 무리를 안 판 종은 소수를 직접 데리고 다니는 손맛, 무리를 판 종은 대군을 한 번에 움직이는
  //   맛이 된다 — **같은 게임에서 조작 감각이 둘로 갈린다.**
  //   ⚠ 반경이 0 이하면(알파 없음·지휘 공백) 이 블록이 통째로 안 돈다 = 명령이 아예 안 통한다.
  const order = world.herdOrder;
  const inVoice = world.hearsOrder(e.x, e.y);
  if (order !== null && e.species.isPlayer && inVoice) {
    const odx = order.x - e.x;
    const ody = order.y - e.y;
    const od2 = odx * odx + ody * ody;
    if (order.kind === "evade") {
      // ── 「피해라」(더블탭) · **탭한 자리의 반대 방향으로 달아난다** ────────────────────────
      // 2026-08-09 이전에는 이 칸이 **정반대로 작동했다.** 휠에는 "반대 방향으로 흩어져 달아납니다"
      // 라고 써 놓고, sim 에는 `order.kind` 를 읽는 분기가 **한 줄도 없어서** 「가라」와 똑같이
      // **탭한 자리로 무리를 보냈다**(같은 시드에서 두 명령의 개체 좌표가 비트 단위로 같았다).
      // 위험을 보고 더블탭하면 무리가 그리로 갔다 · 기본 조작이 정반대였다.
      //
      // 방향 계산은 **도망과 같은 함수**(clearFleeDir)를 쓴다. 새 회피 로직을 지어내면 "포식자에게서
      // 달아나는 것"과 "시켜서 달아나는 것"이 다른 물리를 갖게 되고, 무엇보다 저 함수만이 막다른
      // 반도·만으로 달아나는 것을 미리 피한다(probe 로 앞을 내다본다). 속도도 maxSpeed 그대로라
      // 다리 형질이 그대로 손끝에 읽힌다.
      //
      // **누가 듣는가 = 누가 기력을 내는가.** 이 블록에 드는 개체 집합은 game 의 기력 소모가 무는
      // 집합과 **같은 함수**(world.hearsOrder)로 정해진다 · 둘이 갈리면 "기력만 내고 안 움직인
      // 개체"가 생긴다(2026-08-09 이전이 정확히 그랬다).
      //
      // 진짜 위험(도망)은 여전히 위다 · 포식자에게 쫓기는 개체를 탭 방향 기준으로 다시 틀면
      // 포식자 쪽으로 밀어 넣을 수 있다. 우선순위는 문서 그대로 **도망 > 지시**다.
      world.orderPending += 1;
      if (!fleeing && od2 > 1e-12) {
        const away = clearFleeDir(e, world, -odx, -ody, maxSpeed, canSwim, canLand, canFly);
        desired = {
          x: desired.x * (1 - ORDER.pull) + away.x * ORDER.pull,
          y: desired.y * (1 - ORDER.pull) + away.y * ORDER.pull,
        };
        world.orderFollowers += 1;
      }
      // 「피해라」는 여기서 끝난다 · 아래 「가라」의 도착·먹이 예외는 뜻이 정반대라 안 밟는다.
    } else {
      // **해제는 거리가 아니라 "닿았는가"로 판정한다.** 직선거리만 재면 물 건너 코앞에서 놓인다:
      // 호수가 U자로 감싼 자리(오목한 만)에 목표가 있으면, 무리가 맞은편 물가에 닿는 순간 이미 해제
      // 반경 안이라 이 블록이 통째로 스킵되고 우회 길찾기(navTo)가 호출조차 안 된다. 그 자리에서
      // orderPending 이 0 이 되니 화면은 「무리 도착」이라 말하고, 사람 눈에는 "명령은 먹혔다는데
      // 안 들어간다"로 보인다(2026-08-08 사용자 제보).
      // 실측(폭별 스윕 · 목표를 감싼 물 팔의 두께): 1타일(20px) 만에서 개체틱의 48%가 "막힌 채 해제"
      // 였고 400틱 내내 아무도 주머니에 못 들어갔다(최근접 50px에서 얼어붙음). 2타일(40px) 이상이면
      // 맞은편 물가가 해제 반경 밖이라 지시가 유지돼 저절로 돌아 들어갔다 · 즉 **해제 반경보다 얇은
      // 물이 곧 함정**이다.
      // 지형이 사이를 막고 있으면 아직 못 닿은 것이다 → 지시를 유지해 navTo 가 돌아가게 둔다.
      //
      // ⚠ 여기서 쓰는 것은 `lineOfSight` 가 아니라 **`walkableLine`**(대각 모서리를 안 뚫는 판정)이다.
      //   lineOfSight 는 8연결이라 물 모서리 위에서 개체의 소수점 이동마다 참/거짓이 뒤집힌다. 그러면
      //   이 게이트가 매 틱 "놓았다/잡았다"를 오가고, 개체는 놓인 틱엔 옆의 먹이로, 잡힌 틱엔 목표로
      //   끌려 **서로 상쇄돼 제자리에 굳는다**(실측: 만 어귀 58px 앞에서 275틱 정지 · 속도 0.1~0.4px).
      //   걷는 판정으로 물으면 그 자리에서 답이 한결같아 지시가 끊기지 않고 무리가 물가를 돌아 들어간다.
      // 둘 다 순수 기하다(rng 미사용) · 지시가 없으면 이 블록 자체가 안 도므로 스트림 불변.
      const nearOrder = od2 <= ORDER.releaseRadius * ORDER.releaseRadius;
      const reached =
        nearOrder && world.terrain.walkableLine(e.x, e.y, order.x, order.y, canSwim, canLand, canFly);
      if (!reached) {
        // 해제 반경 밖(또는 지형에 막혀 못 닿은 자리) = **아직 목표에 못 닿은** 개체. 화면의 "따르는 중 N/M" 분모가 이 수다.
        // 도망 중이라 이번 틱 이동을 지시에 못 준 개체도 여기 센다(그래서 N < M 이 정상 상태다) ·
        // 분모를 살아 있는 내 종 전부로 잡으면 이미 도착한 개체까지 불복종처럼 읽힌다(2026-08-05).
        // 순수 기하 + 정수 합산뿐이라 rng 를 안 쓴다(지시가 없으면 이 블록이 통째로 안 돎 · 스트림 불변).
        world.orderPending += 1;
      }
      if (!fleeing) {
        // 물고 있는 사냥감은 **지시보다 위다**(예전 우선순위 그대로). 사냥은 라운드에 5~10번뿐인 드물고
        // 값진 사건이고 표적이 달아나므로, 한 번 중단되면 그 사냥은 통째로 사라진다. 실측: 사냥감까지
        // 지시로 덮으면 시험 계수가 사냥 9.0 → 2.5(합격선 5 미달) · 사냥꾼 프리셋은 새끼도 11.2 → 6.5 로
        // 무너졌다. 쫓는 개체가 늘 소수라 순종률 손해는 작다(사냥꾼 프리셋이 여전히 가장 잘 따른다).
        // 먹이(풀)는 다르다 · 한 라운드에 100번 넘게 일어나는 기본 행동이라 이걸 안 덮으면 지시가
        // 사실상 아무 일도 안 한다(그게 이번 결함의 원인이었다: 개체틱의 72.1%가 먹이 추적).
        const hunting = e.targetPrey !== null;
        // ── **방울 우선** · **[사용자 2026-08-09]** "가라 명령 때 방울을 우선시해서 알아서 먹는다" ──
        // 방울(유전자 점수)은 밟으면 주워지는데(반경 16px) **아무도 그것을 목표로 삼지 않아** 판마다
        // 필드에 남았다. 지시를 따르는 개체가 근처(ORDER.geneRadius)의 아직 안 주운 방울을 만나면
        // 그쪽을 먼저 들른다 · 주워지면(taken) 다음 틱에 저절로 지시로 돌아간다(상태를 안 들고 있다).
        //
        // 우선순위에서의 자리: 도망 > 사냥감 > **방울** > 가는 길의 먹이 > 지시 > 배회.
        //  · 사냥감보다 아래인 이유: 사냥은 판에 5~10번뿐이라 끊으면 통째로 사라진다(위 문단의 실측).
        //  · 먹이보다 위인 이유: 방울은 판당 스무 개 남짓이고 사람이 이미 **번 것**이라, 풀 한 포기와
        //    같은 무게로 두면 영영 안 주워진다. 수가 적어 채집을 잡아먹을 여지도 없다.
        // ⚠ **지시가 걸린 동안에만** 작동한다(이 블록 안이다) · 지시 없는 세계는 1비트도 안 바뀐다.
        // ⚠ 도착(reached) 뒤에도 작동한다 · 그래야 목표 근방에 떨어진 방울을 무리가 알아서 줍는다.
        //   대신 이 개체는 **순종(orderFollowers)에 안 센다** · 지시가 아니라 방울이 몰고 있는 것이라,
        //   세면 화면의 "따르는 중 N/M" 이 부풀어 거짓말이 된다(가는 길 먹이와 같은 처리).
        // ⚠ 통행 특성을 넘기는 이유: **걸어 닿을 수 있는 방울만** 고르게 하기 위해서다. 직선거리만
        //   보던 시절에는 물 건너 방울이 뽑혀 개체가 물가에 머리를 박은 채 굶어 죽었다(2026-08-09 ·
        //   `nearestFreeDrop` 주석에 실측이 있다). 이 개체가 갈 수 있는가는 이 개체의 게놈이 정한다.
        const drop = hunting ? null : nearestFreeDrop(world, e.x, e.y, canSwim, canLand, canFly);
        if (drop !== null) {
          // 길찾기를 태우는 이유는 지시와 같다 · 직선으로 끌면 물가·산자락에서 벽을 따라 미끄러진다.
          const nav = navTo(e, world, drop, canSwim, canLand, canFly);
          const go = toward(nav.x - e.x, nav.y - e.y, maxSpeed, 0);
          desired = {
            x: desired.x * (1 - ORDER.pull) + go.x * ORDER.pull,
            y: desired.y * (1 - ORDER.pull) + go.y * ORDER.pull,
          };
        } else if (!reached) {
          // 쫓던 먹이가 "가는 길"에 있나 · 있으면 그것부터 먹고 간다(배고픈 개체는 지나치지 못한다).
          // 가는 길 = 지시 쪽(내적 ≥ 0)이고 지시점보다 가깝다. 여기에 **코앞(grabRadius)** 을 더한다 ·
          // 방향 조건만 두면 등 뒤의 먹이가 매 틱 버려져 행군 중엔 거의 못 먹는다.
          const food = e.targetFood;
          let onTheWay = false;
          if (!hunting && food !== null) {
            const gdx = food.x - e.x;
            const gdy = food.y - e.y;
            const gd2 = gdx * gdx + gdy * gdy;
            onTheWay = gd2 <= ORDER.grabRadius * ORDER.grabRadius || (gd2 < od2 && gdx * odx + gdy * ody >= 0);
          }
          if (!hunting && !onTheWay) {
            // 격자 길찾기를 태운다 · 직선으로 끌면 물가·산자락에서 벽을 따라 미끄러지기만 한다
            // (known_issues "반응형 벽 회피는 진동을 만든다 · 격자 BFS 가 정답").
            // 도착 감속도 해제 반경 기준이다 · 게이트가 200 이던 시절엔 min(1, d/200)=1 이 항상 참이라
            // 죽은 코드였고, 게이트를 64 로 줄이면서 처음 살아났다(문턱 근처에서 지나침·진동 방지).
            const nav = navTo(e, world, { x: order.x, y: order.y }, canSwim, canLand, canFly);
            const go = toward(nav.x - e.x, nav.y - e.y, maxSpeed, nav.final ? ORDER.releaseRadius : 0);
            desired = {
              x: desired.x * (1 - ORDER.pull) + go.x * ORDER.pull,
              y: desired.y * (1 - ORDER.pull) + go.y * ORDER.pull,
            };
            // 순종의 질을 화면에 보여 주는 숫자는 **여기서**, 규칙이 판정된 그 자리에서 센다.
            // 밖에서 조건을 다시 유도하면 화면과 실제가 갈린다(known_issues).
            // 세는 것은 **지시가 이번 틱 이동을 가져간 개체**뿐이다 · 가는 길의 먹이로 잠깐 새는 개체는
            // 안 센다(그건 지시가 아니라 천성이 모는 것이라, 세면 순종이 부풀어 화면이 거짓말한다).
            world.orderFollowers += 1;
          }
        }
      }
    }
  }

  // --- 관성: 현재 속도를 desired 로 부드럽게 (홱 꺾임/제자리 떨림 제거) ---
  e.vx += (desired.x - e.vx) * turn;
  e.vy += (desired.y - e.vy) * turn;

  // --- 위치 갱신: 지형 차단(축 분리) → 월드 경계 반사 ---
  // 다음 위치가 막힌 타일(산 / 수영 못 하면 물)이면 그 축 이동만 취소해 벽을 따라 미끄러진다
  // (완전 반사보다 스티킹·떨림이 적다). maxSpeed < 타일폭이라 한 틱에 타일을 건너뛰지 않는다.
  const nx = e.x + e.vx;
  const ny = e.y + e.vy;
  if (world.terrain.isPassable(nx, e.y, canSwim, canLand, canFly)) e.x = nx;
  else e.vx = 0;
  if (world.terrain.isPassable(e.x, ny, canSwim, canLand, canFly)) e.y = ny;
  else e.vy = 0;
  if (e.x < 0) {
    e.x = 0;
    e.vx = -e.vx;
  } else if (e.x > world.width) {
    e.x = world.width;
    e.vx = -e.vx;
  }
  if (e.y < 0) {
    e.y = 0;
    e.vy = -e.vy;
  } else if (e.y > world.height) {
    e.y = world.height;
    e.vy = -e.vy;
  }

  // --- 끼임 감지: 목표가 있는데 이번 스텝 거의 못 움직였으면(물벽 등에 막힘) 카운트. 오래 막히면 도달
  // 불가로 보고 목표를 버려 다른 먹이를 찾게 한다 — 물가 먹이에 억지로 들이대다 갇히는 것을 푼다. ---
  if ((e.targetFood || e.targetPrey) && !fleeing) {
    const dxm = e.x - e.prevX;
    const dym = e.y - e.prevY;
    if (dxm * dxm + dym * dym < SIM.stuckMinMove * SIM.stuckMinMove) {
      e.stuckTicks += 1;
      if (e.stuckTicks >= SIM.stuckLimit) {
        e.targetFood = null;
        e.targetPrey = null;
        e.path.length = 0;
        e.pathGoalTile = -1;
        e.stuckTicks = 0;
      }
    } else {
      e.stuckTicks = 0;
    }
  } else {
    e.stuckTicks = 0;
  }

  // --- 섭취 / 사냥 (쫓던 목표가 사정거리면) ---
  if (e.attackCd > 0) e.attackCd -= 1;

  // --- 알파 조종: 사람이 시킨 물기 ---
  // 알파가 능력을 새로 얻는 게 아니다. AI 가 사냥할 때 쓰는 바로 그 경로(resolveBite)를, 바로 그
  // 사거리(atkRange)와 쿨다운(attackCd)으로 쓴다. 다른 것은 하나뿐이다 — **누구를 언제 물지를
  // 사람이 정한다.** 대미지 보너스도, 늘어난 사거리도, 무조건 명중도 없다. 힘이 모자라면 못 문다.
  //
  // ★ 게이트는 반드시 `cmd !== null && cmd.bite` 다. `leaderId >= 0`(알파를 지정했나)으로 걸면
  //   **명령을 한 번도 안 준 세계가 갈라진다** — leadBiteTarget 이 world.rng 를 안 쓰더라도, 물기가
  //   한 번이라도 나가는 순간 rng.chance 가 스트림을 밀어 그 뒤 전부가 다른 세계가 된다.
  //   같은 자리에서 이미 크리티컬 버그가 났었다(lead.test.ts 의 격리 테스트가 그 감지기다).
  //
  // 대상이 없으면 **아무 일도 안 일어난다 — 쿨다운도 안 돈다.** 헛손질에 벌을 주면 "안 되는 이유"가
  // 화면에서 안 읽히는 벌이 된다(버튼은 대상이 있을 때만 켜지므로 헛손질 자체가 드물다).
  //
  // ⚠ 도망(fleeing) 중에도 나간다. AI 의 사냥·섭취는 `!fleeing` 에 걸려 있지만, "쫓길 때 맞설 것인가
  //   달아날 것인가"는 이 모드에서 사람이 정하는 것이고(레이드의 전사/도망자와 같은 갈림길),
  //   무엇보다 **화면에 켜진 버튼이 안 먹히면 그게 거짓말**이다. 이득은 없다 — 판정·피해·쿨다운은 그대로다.
  const bcmd = world.lead.cmd;
  if (bcmd !== null && bcmd.bite === true && e.id === world.lead.leaderId) {
    const aim = leadBiteTarget(e, world);
    if (aim !== null) {
      // ① **표적을 붙든다** — AI 포식자가 사냥할 때 세우는 바로 그 상태(targetPrey)다. 이걸 안 세우면
      //    사람이 모는 포식자가 AI 보다 **느리다**: 사냥 질주(huntSprintFactor)가 `targetPrey !== null`
      //    에 걸려 있어서다. 도망치는 먹잇감을 질주 없이 12px 까지 손으로 몰아붙이는 건 사실상 불가능해,
      //    실측에서 근접 종은 버튼이 90초 동안 한 번도 안 켜졌다. 표적을 세우면 질주가 붙고, 사정거리에
      //    닿는 순간 아래 AI 경로가 알아서 문다 — 사람은 모는 데 집중한다.
      //    새 능력이 아니다. AI 가 스스로 고르던 표적을 **사람이 대신 고르는 것**뿐이다.
      e.targetPrey = aim;
      // ② 이미 사정거리 안이면 지금 문다(같은 판정·같은 쿨다운). 쿨다운 중이면 아무 일도 안 일어난다.
      const adx = aim.x - e.x;
      const ady = aim.y - e.y;
      if (e.attackCd <= 0 && adx * adx + ady * ady <= atkRange * atkRange) {
        resolveBite(e, aim, world, t.ranged >= SIM.rangedThreshold);
      }
    }
  }

  if (!fleeing && e.targetPrey && e.targetPrey.alive) {
    const prey = e.targetPrey;
    const dx = prey.x - e.x;
    const dy = prey.y - e.y;
    // 원거리 종은 이 넓은 사거리(atkRange, 상단 계산)에서 쏜다 — 붙지 않고 멀리서 명중.
    // 물기는 쿨다운마다 한 번. 예전엔 매 틱 굴려 접촉 즉시 즉사였다.
    if (dx * dx + dy * dy <= atkRange * atkRange && e.attackCd <= 0) {
      resolveBite(e, prey, world, t.ranged >= SIM.rangedThreshold);
    }
  } else if (!fleeing && e.targetFood && e.targetFood.available) {
    const food = e.targetFood;
    const dx = food.x - e.x;
    const dy = food.y - e.y;
    if (dx * dx + dy * dy <= SIM.eatRadius * SIM.eatRadius) {
      if (food.mountainous) {
        // 산 보물 — 에너지 만땅 + 동족 여럿 즉시 태어남(무리가 확 불어나는 대박). 희소한 보상(날개 종만).
        e.energy = SIM.maxEnergy;
        for (let k = 0; k < SIM.mountainTreasureSpawn; k++) {
          if (world.entities.length + newborns.length >= world.cap) break;
          // 출생 자리를 극좌표(각도+거리)로 뽑는다. draw 2회 그대로(스트림 보존), 해석만 바꿨다.
          // 예전 ±12px 사각 분산은 몸 반길이보다 좁아 대박 새끼들이 한 자리에 겹쳐 태어났다.
          const broodAngle = world.rng.range(0, Math.PI * 2);
          const broodDist = world.rng.range(10, 24);
          // 경계 클램프 필수: isPassable 은 경계 밖 좌표도 타일만 통행 가능하면 그대로 돌려준다.
          const bx = Math.max(0, Math.min(world.width, e.x + Math.cos(broodAngle) * broodDist));
          const by = Math.max(0, Math.min(world.height, e.y + Math.sin(broodAngle) * broodDist));
          const spot = world.terrain.nearestPassable(bx, by, canSwim, canLand, canFly);
          const brood = createEntity(world.nextId(), spot.x, spot.y, e.species, SIM.startEnergy);
          brood.wanderAngle = broodAngle; // 태어난 방향 그대로 부모 바깥쪽으로 첫걸음(연속 id 라도 흩어진다)
          newborns.push(brood);
          world.emit("birth", spot.x, spot.y, e.species.isPlayer); // 연출: 대박 탄생(초록 반짝 여럿)
          if (e.species.isPlayer) world.roundCounts.births += 1; // 시험 계수: 산 보물 대박 탄생도 새끼로 센다
        }
        food.regrowTimer = Math.round(
          SIM.foodRegrowTicks * world.foodRegrowMultiplier * SIM.mountainTreasureRegrow,
        );
      } else {
        // 채집 수입 = 기본 × 풀 효율. 이빨 티어가 낮출수록 줄고(이빨의 고유 대가), 무리 티어가 높을수록
        // 개체당 몫이 준다(무리의 고유 대가 · "잡은 것은 함께 먹지만 풀은 나눠 뜯어 몫이 준다").
        e.energy = Math.min(SIM.maxEnergy, e.energy + SIM.foodEnergy * t.graze);
        // 시대가 지날수록(foodScarcity) 먹힌 풀이 더 느리게 자란다 — 큰 무리일수록 고갈이 빨라 회복이 억제된다.
        food.regrowTimer = Math.round(SIM.foodRegrowTicks * world.foodRegrowMultiplier * world.foodScarcity);
        if (e.species.isPlayer) world.roundCounts.feeds += 1; // 시험 계수: 채집 섭취 확정(산 보물은 births 로 센다)
      }
      food.available = false;
      e.targetFood = null;
      // 레벨업 경험치 소스(내 종 섭취만) — 보물은 크게(즉시 레벨업 쪽으로).
      if (e.species.isPlayer) world.playerFoodEaten += food.mountainous ? SIM.mountainTreasureSpawn : 1;
    }
  }

  // --- 허기 + 노화. 추위(저대사 불리, 무리 보온으로 완화) + 폭염(고대사 불리). ---
  const env = world.environment.sampleAt(e.x, e.y);
  const huddle = nb ? Math.min(1, (nb.count - 1) / SIM.huddleFull) * herding01 : 0;
  const warmthFactor = 1 - SIM.huddleWarmth * huddle;
  // 평상시 추위(빙하 바이옴 env.coldness)는 그대로, 대멸종 한파(globalCold)만 더 매섭게(클라이맥스 필터).
  const coldField = env.coldness + world.globalCold * SIM.globalColdLethality;
  // **가죽 4단(규칙 면제)** — 대멸종의 환경 피해(한파·폭염)를 안 받는다. 눈보라가 화면을 덮는데
  // 내 무리만 색이 안 바랜다. 대신 가죽은 여기 닿기까지 21개의 도장을 먹는다.
  const envProof = isApex(t.defense);
  const coldDrain = envProof ? 0 : SIM.coldPenalty * coldField * (1 - metabolism01) * warmthFactor;
  // 열기 = 국소 사막·열대우림 열기(env.heat) + 대멸종 폭염(world.heat). 두꺼운 몸일수록 더위에 약하다.
  const heatField = env.heat + world.heat;
  const heatDrain = envProof ? 0 : SIM.heatPenalty * heatField * metabolism01;
  // 독(중독) — 누적 독이 있으면 매 틱 에너지를 깎는다(지속 피해). poison 풀이 소진될 때까지.
  const poisonDmg = e.poison > 0 ? Math.min(e.poison, SIM.venomTickDamage) : 0;
  if (poisonDmg > 0) e.poison -= poisonDmg;
  e.energy -= drain + coldDrain + heatDrain + poisonDmg;
  e.age += 1;
  if (e.woundTicks > 0) e.woundTicks -= 1;

  // --- 죽음 (사망 원인 집계, §7). 이번 틱 가장 큰 소모로 귀속(독>추위/폭염>기본 대사). ---
  if (e.energy <= 0) {
    let cause: DeathCause = "starve";
    if (poisonDmg > 0 && poisonDmg >= coldDrain && poisonDmg >= heatDrain && poisonDmg >= drain) {
      cause = "venom"; // 방어 독으로 중독사 — 독먹이를 삼킨 포식자가 되갚음당해 죽는다
    } else if (e.woundTicks > 0) {
      // 물려서 기운이 깎인 채 도망치다 쓰러졌다. 못 먹어서 죽은 게 아니다(포식자는 놓쳤으니 못 먹는다).
      cause = "wound";
    } else if (coldDrain >= heatDrain && coldDrain > drain) cause = "cold";
    else if (heatDrain > coldDrain && heatDrain > drain) cause = "heat";
    e.alive = false;
    world.recordDeath(e.species, cause);
    world.emit("death", e.x, e.y, e.species.isPlayer); // 연출: 자연사(회색 흩어짐)
    return;
  }
  if (e.age >= maxAge) {
    e.alive = false;
    world.recordDeath(e.species, "age");
    world.emit("death", e.x, e.y, e.species.isPlayer);
    return;
  }

  // --- 번식 (에너지 충분 + 확률, 상한 미만). 자식은 같은 종. ---
  // 큰 몸은 새끼를 적게 친다(sizeFertilityFactor — 몸집 50 이면 1.0). 「다산 초식」(작고 많이)과
  // 「거대 초식」(크고 적게)이 여기서 갈린다.
  //
  // **정점 번식력(100)** — 새끼를 쳐도 어미가 덜 지친다(번식 대가가 apexBreedCost 배로 준다).
  //
  // ⚠ 두 번 헛짚었다. 이 자리는 rng 와 먹이 상한이 둘 다 걸려 있어 "보상"이 쉽게 자해가 된다:
  //   ① **쌍둥이**(한 배에 둘) — 새끼를 한 마리 더 낳느라 rng 를 두 번 더 소비해 스트림이 밀렸다.
  //      시뮬이 통째로 다른 세계가 됐다(개체 수 45 vs 65 는 좋고 나쁨이 아니라 그냥 다른 전개였다).
  //   ② **번식 문턱 완화**(78 → 54.6) — rng 는 안 건드렸지만, 기운이 모자란 채로 낳게 만들어 어미와
  //      새끼가 **둘 다 반쯤 굶은 채로 갈라졌다**. 굶주림 사망 125 → 176, 평균 개체 수 127 → 121
  //      (피크만 오르고 평균은 떨어지는 붐-버스트). 먹이가 유한하니 "더 자주 낳기"는 보상이 못 된다.
  //
  // 지금 방식은 문턱(78)을 그대로 두고 **어미가 치르는 대가만** 깎는다 — 기운이 넉넉할 때만 낳는 규칙은
  // 그대로라 굶는 새끼가 안 늘고, 어미가 살아남아 다음 번식에 더 빨리 닿는다. rng 소비도 불변이다.
  if (
    world.entities.length + newborns.length < world.cap &&
    e.energy >= SIM.reproduceThreshold &&
    world.rng.chance(SIM.reproduceRate * (0.3 + fertility01) * sizeFertilityFactor(t.size))
  ) {
    const childEnergy = e.energy * 0.5; // 새끼가 받는 기운 — 정점이어도 그대로(새끼를 더 살찌우는 게 아니다)
    e.energy -= isApex(t.fertility) ? childEnergy * SIM.apexBreedCost : childEnergy;
    // 출생 자리를 극좌표(각도+거리)로 뽑는다. draw 2회 그대로(스트림 보존), 해석만 바꿨다.
    // 예전 ±6px 사각 분산은 몸 반길이(약 13.5px)보다 좁아 새끼가 부모와 겹친 채 태어났고,
    // 초기 헤딩(entity.ts wanderAngle)까지 순번이라 무리가 한 덩어리로 같은 경로를 돌았다(2026-08-05 수정).
    const birthAngle = world.rng.range(0, Math.PI * 2);
    const birthDist = world.rng.range(10, 24);
    // 경계 클램프 필수: isPassable 은 경계 밖 좌표도 타일만 통행 가능하면 그대로 돌려준다.
    // 구석에 몰린 무리의 새끼가 월드 밖에 태어나던 회귀를 실측으로 잡았다("월드 밖으로 못 나간다" 테스트).
    const cx = Math.max(0, Math.min(world.width, e.x + Math.cos(birthAngle) * birthDist));
    const cy = Math.max(0, Math.min(world.height, e.y + Math.sin(birthAngle) * birthDist));
    // 막힌 타일에 태어나면 갇히므로 가장 가까운 통행 타일로 스냅(rng 미사용 → 결정론·밸런스 보존).
    const spot = world.terrain.nearestPassable(cx, cy, canSwim, canLand, canFly);
    // 개체별 진화 — 내 종 새끼는 부모 게놈을 물려받아 조금 변이한다(독립 mutRng → 메인 스트림 불변).
    // 야생은 종 게놈 공유(개체 변이 없음 — 야생은 종 단위 진화가 따로 있다).
    const childGenome = e.species.isPlayer
      ? mutateGenome(cloneGenome(e.genome), world.mutRng, SIM.mutationStrength)
      : undefined;
    const child = createEntity(world.nextId(), spot.x, spot.y, e.species, childEnergy, childGenome);
    child.wanderAngle = birthAngle; // 태어난 방향 그대로 부모 바깥쪽으로 첫걸음
    newborns.push(child);
    world.emit("birth", spot.x, spot.y, e.species.isPlayer); // 연출: 탄생(초록 반짝)
    if (e.species.isPlayer) world.roundCounts.births += 1; // 시험 계수: 내 종 새끼 탄생
  }
}


/** 보스/포식자가 도망 범위 안이면 도망 속도(단위×maxSpeed), 아니면 null. 도망 방향은 지형 회피로 보정. */
function computeFlee(
  e: Entity,
  world: World,
  t: Traits,
  maxSpeed: number,
  canSwim: boolean,
  canLand: boolean,
  canFly: boolean,
): Vec | null {
  const boss = world.boss;
  // **나를 잡을 수 있는 보스만 무섭다** — 층위(하늘/땅/물)가 안 겹치면 쫓아와도 못 문다(boss.huntLayers).
  // 나는 종은 땅 보스를 보고도 달아나지 않고 하던 일을 한다(회피가 곧 보상). 야생 포식자 쪽에 이미 있는
  // "닿을 수 있는 포식자만 무섭다"와 같은 원칙 — 못 닿는 위협에서 도망치면 채집 시간만 버린다.
  const bossThreatens = boss !== null && bossCanHunt(boss, e, world);
  if (boss && bossThreatens && boss.members.length > 0) {
    // 개체형 떼 시련 — 가장 가까운 떼 개체로부터 도망친다(사방에서 오니 완전 회피는 어렵다).
    // 그림자 매복자(cullVisionResist>0)는 시야가 넓을수록 더 멀리서 알아채 미리 피한다(시야 카운터).
    let best2 = Infinity;
    let bx = 0;
    let by = 0;
    for (const m of boss.members) {
      const dx = e.x - m.x;
      const dy = e.y - m.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best2) {
        best2 = d2;
        bx = dx;
        by = dy;
      }
    }
    const visionPad = boss.cullVisionResist > 0 ? SIM.stalkerVisionFlee * (t.vision / TRAIT_MAX) : 0;
    const fr = boss.killRadius + SIM.fleeRadiusPad + visionPad;
    if (best2 < fr * fr) return clearFleeDir(e, world, bx, by, maxSpeed, canSwim, canLand, canFly);
  } else if (boss && bossThreatens && boss.killRadius > 0) {
    const bdx = e.x - boss.x;
    const bdy = e.y - boss.y;
    const bd2 = bdx * bdx + bdy * bdy;
    const fr = boss.killRadius + SIM.fleeRadiusPad + boss.visionFlee * (t.vision / TRAIT_MAX);
    if (bd2 < fr * fr) return clearFleeDir(e, world, bdx, bdy, maxSpeed, canSwim, canLand, canFly);
  }
  // 듀오 「먼저 보고 먼저 뛴다」(눈 III + 다리 III): 포식자를 1.5배 멀리서 알아챈다(가젤·영양).
  const senseR = hasDuo(e.genome.pips, "seefirst") ? SIM.predatorSenseRange * 1.5 : SIM.predatorSenseRange;
  const predator = world.grid.nearestMatching(
    e.x,
    e.y,
    senseR,
    (p) =>
      p.alive && p !== e && p.species.id !== e.species.id && !areFriends(e.species, p.species) &&
      // v8: "사냥하는 종인가"는 사냥 효율이(이빨 0단은 0), "나를 위협하는가"는 **저쪽 무는 힘 vs 내 버티는
      // 힘**이 판정한다. 야생은 `defense = attack` 이라 v7 과 같은 수가 나온다.
      p.genome.traits.hunt > 0 && p.genome.traits.attack >= t.defense &&
      // **닿을 수 있는 포식자만 무섭다.** 먹잇감 조준(chooseGoal)과 같은 규칙 — 물 건너 물고기한테서
      // 도망칠 이유가 없다. 지금 야생 물고기는 초식이라 실제로는 안 걸리지만(프로브: 0건), 육식 수생종이
      // 생기면 곧바로 터진다. 같은 종류의 버그를 먹잇감 쪽에서 이미 겪었다(물가 머리박기).
      world.terrain.isPassable(p.x, p.y, canSwim, canLand, canFly),
  );
  if (predator) {
    return clearFleeDir(e, world, e.x - predator.x, e.y - predator.y, maxSpeed, canSwim, canLand, canFly);
  }
  return null;
}

/**
 * 도망 방향(awayX,awayY)을 지형에 맞게 보정한다. 그 방향이 막혀(또는 막다른 곳이라) 있으면, 포식자
 * 에서 멀어지는 성분(cos off)과 현재 헤딩 일관성(진동 억제)을 함께 점수화해 통행 가능한 최선 방향으로
 * 튼다. 도망이 벽(물/산)으로 가 코너에 고립·잡히는 것을 줄인다. 헤딩 가중 덕에 avoidWalls 같은
 * 좌우 진동이 없고, probe 를 한 칸보다 멀리 봐서 막다른 반도·만으로 도망치는 것을 미리 피한다.
 */
function clearFleeDir(
  e: Entity,
  world: World,
  awayX: number,
  awayY: number,
  maxSpeed: number,
  canSwim: boolean,
  canLand: boolean,
  canFly: boolean,
): Vec {
  const d = Math.hypot(awayX, awayY);
  if (d < 1e-6) return { x: 0, y: 0 };
  const base = Math.atan2(awayY, awayX);
  const probe = world.terrain.cellSize * SIM.fleeProbeTiles;
  // 도망 방향이 probe 거리까지 트였으면 그대로(대부분). 비행 종은 지형에 안 막혀 항상 트임.
  if (fleeClear(world, e.x, e.y, base, probe, canSwim, canLand, canFly)) {
    return { x: Math.cos(base) * maxSpeed, y: Math.sin(base) * maxSpeed };
  }
  // 막힘 — away 유지 + 헤딩 일관성으로 통행 가능한 최선 방향을 고른다.
  const heading = Math.atan2(e.vy, e.vx);
  let bestAng = base;
  let bestScore = -Infinity;
  for (const off of FLEE_OFFSETS) {
    const a = base + off;
    if (!fleeClear(world, e.x, e.y, a, probe, canSwim, canLand, canFly)) continue;
    const score = Math.cos(off) + SIM.fleeHeadingWeight * Math.cos(a - heading);
    if (score > bestScore) {
      bestScore = score;
      bestAng = a;
    }
  }
  return { x: Math.cos(bestAng) * maxSpeed, y: Math.sin(bestAng) * maxSpeed };
}

/** (x,y)에서 각도 ang 로 probe 거리까지 통행 가능한가(LOS). 끝점까지 보므로 막다른 곳을 미리 안다. */
function fleeClear(
  world: World,
  x: number,
  y: number,
  ang: number,
  probe: number,
  canSwim: boolean,
  canLand: boolean,
  canFly: boolean,
): boolean {
  return world.terrain.lineOfSight(
    x, y, x + Math.cos(ang) * probe, y + Math.sin(ang) * probe, canSwim, canLand, canFly,
  );
}

// 도망 회피 탐색 각(라디안). 0.4rad 씩 좌우로 점점 크게 — away 에 가까운(작은 편차) 통행 방향 우선.
const FLEE_OFFSETS: readonly number[] = [
  0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.0, -2.0, 2.4, -2.4, 2.8, -2.8,
];

/**
 * 쫓을 목표 좌표를 고른다. 기존 목표가 유효(존재·시야 안)하면 유지(hysteresis)해 목표 진동을 막고,
 * 무효일 때만 새로 가까운 것을 찾는다. 잡식은 먹잇감/식물 중 가까운 쪽에 commit.
 */
function chooseGoal(
  e: Entity,
  world: World,
  vision: number,
  echoRange: number,
  canHunt: boolean,
  canGraze: boolean,
): Vec | null {
  // 감지 범위 = 시야(전방·원거리)와 초음파(전방위·근거리) 중 넓은 쪽. 목표 유지도 이 기준.
  const senseRange = Math.max(vision, echoRange);
  const keep2 = (senseRange * SIM.targetKeepFactor) ** 2;

  // 식성으로 못 먹게 된 목표는 버린다(예: 드래프트로 육식이 되면 식물 목표 해제).
  if (!canHunt) e.targetPrey = null;
  if (!canGraze) e.targetFood = null;

  // 1) 눈앞의 가장 가까운 새 후보(먹이·먹잇감)를 매 틱 살핀다 — 더 쉬운(가까운) 먹이가 나타나면 갈아타려고.
  //    감지 = 시야(전방 부채꼴·vision 반경) 또는 초음파(전방위·echoRange). 초음파로 사는 종은 시야가
  //    좁아도(또는 없어도) 사방을 짧게 듣는다. 정지·저속이면 시야도 전방위(두리번).
  const vision2 = vision * vision;
  const echo2 = echoRange * echoRange;
  const inFov = makeFovTest(e);
  const canSense = (x: number, y: number): boolean => {
    const dx = x - e.x;
    const dy = y - e.y;
    const d2 = dx * dx + dy * dy;
    return (d2 < vision2 && inFov(x, y)) || d2 < echo2;
  };
  // 통행 능력 — nearestFood 가 하는 것과 같은 방식으로 게놈에서 뽑는다(chooseGoal 은 이 값을 안 받는다).
  const canSwim = e.genome.traits.swimming >= SIM.swimThreshold;
  const canLand = e.genome.traits.swimming < SIM.aquaticOnlyThreshold;
  const canFly = e.genome.traits.wings >= SIM.flyThreshold;

  /**
   * 먹잇감 감지 — 먹이(식물)와 달리 **상대가 숨을 수 있다**(은신). 은신은 시야 반경만 줄이고
   * 초음파는 못 속인다: 눈을 속이는 것이지 소리를 지우는 게 아니다. 숨는 종은 초음파 사냥꾼 앞에서
   * 무력하다(감각 축끼리의 가위바위보). 큰 몸은 잘 못 숨는다(effectiveCamo).
   */
  // **정점 시야(100)** — 숨은 것도 보인다. 은신은 눈을 속이는 것인데, 이 눈은 안 속는다(규칙 면제).
  const apexEye = isApex(e.genome.traits.vision);
  const canSensePrey = (p: Entity): boolean => {
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d2 = dx * dx + dy * dy;
    // 듀오 「바위」(가죽 III + 눈 III): 가만히 있으면 돌처럼 보인다 — 숨기 열쇠가 없어도 안 띈다.
    const still = p.vx * p.vx + p.vy * p.vy < 0.02 && hasDuo(p.genome.pips, "stone");
    const camoF = apexEye
      ? 1
      : Math.min(
          camoVisionFactor(p.genome.traits.camouflage, p.genome.traits.size),
          still ? 0.35 : 1,
        );
    const hidden2 = vision2 * camoF * camoF; // 반경에 곱하므로 제곱거리엔 제곱으로
    return (d2 < hidden2 && inFov(p.x, p.y)) || d2 < echo2;
  };

  let prey: Entity | null = null;
  let food: Food | null = null;
  if (canHunt) {
    prey = world.grid.nearestMatching(
      e.x,
      e.y,
      senseRange,
      (p) =>
        p.alive && p !== e && p.species.id !== e.species.id &&
        !areFriends(e.species, p.species) && canSensePrey(p) &&
        // **닿을 수 있는 먹잇감만.** 먹이(nearestFood)엔 이 검사가 있었는데 먹잇감엔 없어서, 땅 위 종이
        // 물속 물고기를 노리고 물가에 머리를 박은 채 굶어 죽었다(프로브: 내 종 개체틱의 31%).
        // 끼임 감지(stuckTicks)로는 못 푼다 — 물가에서 튕기며 진동해 "움직였다"로 판정된다.
        world.terrain.isPassable(p.x, p.y, canSwim, canLand, canFly) &&
        // **정점 속도(100)는 아예 안 쫓는다** — 따라잡을 수 없는 것을 쫓는 것은 굶는 길이다.
        !outrunsHunters(p) &&
        // **뭉친 무리는 아예 안 건드린다**(무리 방어). 사자가 물소 떼 한가운데를 덮치지 않고 가장자리·
        // 낙오자를 노리는 것과 같다. 물기 확률을 깎는 방식으로도 해 봤으나 소용없었다 — 애초에 잡히는
        // 개체는 이미 무리에서 떨어져 나온 낙오자라 "이웃 수" 보정이 걸리지 않았다(프로브: 저항을 걸어도
        // 잡아먹힘 29→22 에 그쳐 도달 단계가 안 변함). 표적 선택 단계에서 막아야 무리가 실제로 산다.
        !herdShielded(p, world),
    );
  }
  if (canGraze) food = nearestFood(e, world, senseRange, canSense);
  if (prey && food) {
    if (dist2(e, prey) <= dist2(e, food)) food = null;
    else prey = null;
  }
  const cand2 = prey ? dist2(e, prey) : food ? dist2(e, food) : Infinity;

  // 2) 기존 목표 유지 — 단 "히스테리시스": 새 후보가 확실히 더 가까울 때만(cand2 < cur2 × switchGain) 갈아탄다.
  //    조금 더 가까운 정도로는 안 바꿔 목표 진동(떨림)을 막고, 눈앞의 훨씬 쉬운 먹이면 바꿔 불합리한 고집을
  //    없앤다. 목표에 다가갈수록 cur2 가 줄어 더 끈질겨진다(합리적 — 거의 다 온 먹이는 안 놓는다).
  if (e.targetPrey) {
    const p = e.targetPrey;
    // 쫓던 먹잇감이 물로 들어가 버렸으면(또는 애초에 못 닿는 곳이면) 놓아준다 — 안 그러면 히스테리시스가
    // 그 목표를 붙들어 물가에서 계속 머리를 박는다. 쫓던 먹잇감이 **무리로 돌아가 버려도** 놓아준다
    // (무리 방어) — 안 그러면 표적 제외를 뚫고 무리 한가운데까지 쫓아 들어간다.
    const reachable = world.terrain.isPassable(p.x, p.y, canSwim, canLand, canFly);
    if (p.alive && p.species.id !== e.species.id && reachable && !herdShielded(p, world) && !outrunsHunters(p)) {
      const cur2 = dist2(e, p);
      if (cur2 <= keep2 && cand2 >= cur2 * SIM.targetSwitchGain) return { x: p.x, y: p.y };
    }
    e.targetPrey = null;
  }
  if (e.targetFood) {
    const f = e.targetFood;
    if (f.available) {
      const cur2 = dist2(e, f);
      if (cur2 <= keep2 && cand2 >= cur2 * SIM.targetSwitchGain) return { x: f.x, y: f.y };
    }
    e.targetFood = null;
  }

  // 3) 새 후보 채택
  if (prey) {
    e.targetPrey = prey;
    return { x: prey.x, y: prey.y };
  }
  if (food) {
    e.targetFood = food;
    return { x: food.x, y: food.y };
  }
  return null;
}

/**
 * 목표(goal)로 향하는 다음 지점을 돌려준다(+ 그것이 최종 목표인지 final).
 *  1) 목표가 직선으로 보이면 그대로 직진(final=true) — 대부분의 경우, BFS 없이 가볍다.
 *  2) 막혀 있으면 격자 BFS 경로(캐시)를 따라 다음 웨이포인트로 향한다(final=false, 경유라 감속 안 함).
 *  3) 다음 웨이포인트가 보이면 현재 것을 건너뛰어(funnel) 계단형 경로를 부드럽게 단축한다.
 * 반응형 회피(avoidWalls)의 좌우 진동·local minima 없이 "막히면 못 돌아간다"를 근본 해결한다.
 */
function navTo(
  e: Entity,
  world: World,
  goal: Vec,
  canSwim: boolean,
  canLand: boolean,
  canFly: boolean,
): { x: number; y: number; final: boolean } {
  const terr = world.terrain;
  // 1) 직선으로 보이면 직진 — 경로 버림. 비행 종은 지형에 안 막혀 늘 직진(BFS 안 탐).
  if (terr.lineOfSight(e.x, e.y, goal.x, goal.y, canSwim, canLand, canFly)) {
    if (e.path.length > 0) {
      e.path.length = 0;
      e.pathGoalTile = -1;
    }
    return { x: goal.x, y: goal.y, final: true };
  }
  // 2) 막힘 — 목표 타일이 바뀌었거나 경로가 없으면 BFS 재계산(그 외엔 캐시 재사용).
  const goalTile = terr.tileIndex(goal.x, goal.y);
  if (e.pathGoalTile !== goalTile || e.path.length === 0) {
    e.path = terr.findPath(e.x, e.y, goal.x, goal.y, canSwim, canLand, canFly);
    e.pathGoalTile = goalTile;
  }
  // 3) 경로 단축(funnel): 다음 웨이포인트가 보이면 현재 것을 건너뛴다.
  while (e.path.length >= 2) {
    const w1 = e.path[1] as number;
    if (terr.lineOfSight(e.x, e.y, terr.tileCenterX(w1), terr.tileCenterY(w1), canSwim, canLand, canFly)) {
      e.path.shift();
    } else break;
  }
  // 4) 현재 웨이포인트에 충분히 닿으면 소비.
  if (e.path.length > 0) {
    const w0 = e.path[0] as number;
    const wx = terr.tileCenterX(w0);
    const wy = terr.tileCenterY(w0);
    const reach = terr.cellSize * 0.6;
    if ((e.x - wx) ** 2 + (e.y - wy) ** 2 < reach * reach) e.path.shift();
  }
  // 경로 소진/못 찾음 → 목표로 직진 시도(axis sliding 이 막아주니 갇히진 않는다).
  if (e.path.length === 0) return { x: goal.x, y: goal.y, final: true };
  const w = e.path[0] as number;
  return { x: terr.tileCenterX(w), y: terr.tileCenterY(w), final: false };
}

/** 목표가 없을 때: 보존된 헤딩을 조금씩 흔들며 순항(멈추지 않고 부드럽게 떠돈다). */
function wanderDesired(e: Entity, world: World, maxSpeed: number): Vec {
  const cruise = maxSpeed * SIM.cruiseFactor;
  // 헤딩을 개체에 보존해 조금씩만 흔든다 — 매 틱 큰 난수로 재추첨하거나 노이즈 큰 속도 방향에
  // 기대면 느린 종이 제자리에서 떤다(부들거림). 작은 누적 흔들림이라야 부드러운 떠돌기가 된다.
  e.wanderAngle += world.rng.range(-SIM.wanderTurn, SIM.wanderTurn);
  return { x: Math.cos(e.wanderAngle) * cruise, y: Math.sin(e.wanderAngle) * cruise };
}

function nearestFood(
  e: Entity,
  world: World,
  senseRange: number,
  canSense: (tx: number, ty: number) => boolean,
): Food | null {
  const kinds = e.species.foodKinds;
  const canSwim = e.genome.traits.swimming >= SIM.swimThreshold;
  const aquaticOnly = e.genome.traits.swimming >= SIM.aquaticOnlyThreshold; // 물 전용(진짜 물고기)
  const canFly = e.genome.traits.wings >= SIM.flyThreshold;
  // 먹이 공간 격자로 감지 반경 안만 검사(완전탐색 대신 — 큰 맵 성능). available·종류·감지는 pred 로.
  return world.foodGrid.nearest(e.x, e.y, senseRange, (f) => {
    if (!f.available) return false;
    if (f.deep) {
      if (!aquaticOnly) return false; // 깊은 바다 먹이는 물 전용 종(물고기)만 — 양용 종(바다 풀뜯이) 배제
    } else if (f.aquatic) {
      if (!canSwim) return false; // 바다 먹이는 수영 형질이 충분한 종만 먹는다(육상 종엔 무경쟁 틈새)
    } else if (f.mountainous) {
      if (!canFly) return false; // 고산 먹이는 날개 형질이 충분한 종만 먹는다(비행 종의 무경쟁 틈새 — 바다 대칭)
    } else if (!kinds.includes(f.kind)) {
      return false; // 이 종이 못 먹는 먹이 종류는 건너뛴다(먹이 분할)
    }
    return canSense(f.x, f.y); // 시야(전방 부채꼴) 또는 초음파(전방위)로 감지되는 먹이만
  });
}

/**
 * **가장 가까운, 아직 안 주웠고 「걸어 닿을 수 있는」 방울**(ORDER.geneRadius 안). 없으면 null.
 *
 * **[사용자 2026-08-09]** "가라 명령 때 방울을 우선시해서 알아서 먹는다거나 하는 건 있었으면 좋겠어."
 * 부르는 곳은 behavior 의 **지시 블록 한 자리뿐**이다. 지시가 없는 세계에서는 한 번도 안 불린다
 * (그것이 「지시 없는 세계 1비트 불변」을 지키는 방식이다).
 *
 * ## 왜 도달 판정이 있나 (2026-08-09 실측 · 이 함수가 개체를 굶겨 죽였다)
 * 처음엔 `taken` 과 **직선거리**만 봤다. 통행 가능성도 경로 존재도 안 봤다. 그래서 물 건너·산 너머
 * 방울이 뽑혔고, 그것이 그대로 `navTo` 로 들어갔다. navTo 는 길을 못 찾으면(findPath 가 빈 배열)
 * **목표로 직진**(final=true)을 돌려준다 · 그 벡터가 `ORDER.pull`(0.9)로 섞여 개체의 천성(먹이 찾기)이
 * 10%만 남고, 개체는 물가·산자락에 머리를 박은 채 선다. 그리고 안 풀린다:
 *   (a) 방울 추적에는 끼임 카운터가 없다(끼임 감지는 `targetFood`/`targetPrey` 가 있을 때만 돈다)
 *   (b) 「가라」는 `ticks=0` 무기한이라 사람이 철회할 때까지 유지된다
 *   (c) 도착(reached) 뒤에도 이 분기가 돈다
 * 실측(폭 1타일 물벽 · 지시는 북쪽 끝 · 방울은 벽 남쪽 30px · `sim/herdOrder.test.ts` 의 그 판):
 *   · 개체 하나 600틱 · 6시드: 고치기 전에는 여섯 시드 전부 y=480(물벽 북쪽 면)에 얼어붙어
 *     정지 179~322틱 뒤 232~423틱에 **아사**했다. 고친 뒤에는 정지 0~14틱 · 다섯 시드 생존
 *     (남은 하나는 방울이 없어도 굶는 시드다 · 혼자 390px 를 행군하는 판이라 그렇다).
 *   · 무리 12마리 900틱 · 4시드: 생존 0/1/0/0 → **3/10/3/0** · 정지(개체틱 합) 1058~4745 → 4~106.
 * 실제 생성 맵에서도 군도 20~30/120 · 대양 9~25/118 회의 방울이 "반경 안에 길 없는 개체"를 가졌다
 * (대륙·판게아는 0/120 이라, 밸런스 기준선인 대륙 판의 수치는 이 고침으로 한 자리도 안 움직인다 ·
 *  군도 판 16시드에서는 순종률이 오르고 회수율은 같거나 오른다: 다산 초식 무리 56.3% → 62.5%).
 *
 * ## 판정은 `world.pickGeneDropSpot`(방울을 **놓을** 자리를 고르는 함수)과 같은 것을 쓴다
 * 거기가 요구하는 두 가지는 ① 내 종이 지나갈 수 있는 지형 ② **실제로 걸어 닿는 곳**이고, ②는
 * `findPath(...).length > 0` 로 판정한다. 여기서도 같은 질문을 던진다. 다만 **답을 미리 만들어 둔다**
 * (`reachLabels`). 놓을 때와 주우러 갈 때의 판정이 갈리면 "놓이기는 하는데 아무도 안 가는" 방울이
 * 생기거나, 반대로 "갈 수 있는데 무시하는" 방울이 생긴다.
 * ①은 ②에 포함된다 · 막힌 타일은 라벨이 -1 이라 어느 개체와도 같은 번호가 될 수 없다.
 *
 * · rng 미사용 · 동률이면 배열에서 먼저 나온 것(= 먼저 떨어진 것)을 고르는 전순서라 답이 하나뿐이다.
 * · 방울은 한 시대에 스무 개 남짓이고 주운 것도 배열에 남으므로(taken) 선형 훑기로 충분하다.
 * · 도달 판정은 **거리 심사를 통과한 후보에만** 건다 · 반경 밖 방울에는 한 번도 안 묻는다.
 * · 야생은 방울을 못 줍는다(`world.collectGeneDrops` 의 `isPlayer`) · 이 함수를 야생 경로에서 부르면
 *   그 계약이 조용히 깨지므로, 부르는 자리가 내 종 전용 블록 안이라는 것이 곧 계약의 이행이다.
 */
function nearestFreeDrop(
  world: World,
  x: number,
  y: number,
  canSwim: boolean,
  canLand: boolean,
  canFly: boolean,
): Vec | null {
  let best: Vec | null = null;
  let bestD2 = ORDER.geneRadius * ORDER.geneRadius;
  for (const d of world.geneDrops) {
    if (d.taken) continue;
    const dx = d.x - x;
    const dy = d.y - y;
    const d2 = dx * dx + dy * dy;
    // 싼 것부터: 거리로 먼저 자르고, 지금까지의 최선을 이긴 후보에만 도달을 묻는다.
    if (d2 >= bestD2) continue;
    if (!canWalkTo(world.terrain, x, y, d.x, d.y, canSwim, canLand, canFly)) continue;
    bestD2 = d2;
    best = { x: d.x, y: d.y };
  }
  return best;
}

/**
 * (x0,y0) 에서 (x1,y1) 로 **걸어갈 길이 있는가.** `terrain.findPath(...).length > 0` 과 같은 답을
 * 돌려주되(같은 4방향 연결 · 같은 통행 규칙), BFS 를 매번 돌리는 대신 **연결 영역 라벨을 한 번 만들어
 * 두고 번호만 비교**한다.
 *
 * 왜 이렇게까지 하나: 이 판정을 부르는 `nearestFreeDrop` 은 **개체마다 매 틱** 불린다. 거기서 findPath
 * 를 부르면 길이 없는 경우가 최악이다. BFS 가 도달 가능한 타일을 **전부** 훑고 나서야 "없다"고 답한다.
 * 그리고 길이 없는 경우가 바로 이 판정이 존재하는 이유(= 자주 일어나는 쪽)라, 고치려던 상황에서
 * 가장 비싸진다. 라벨은 지형 한 판·통행 특성 하나당 딱 한 번 만들고(격자 27x48 = 1296칸), 그 뒤로는
 * 배열 읽기 두 번이다.
 *
 * · **결정론**: 순수 기하 + 고정 순회 순서 · rng 미사용. 캐시는 (지형, 통행 특성) → 답의 메모일 뿐이라
 *   같은 입력에 늘 같은 값이고, 세계를 1비트도 안 바꾼다.
 * · **게으르다**: 라벨은 이 함수가 처음 불릴 때 만들어진다 = 지시가 걸리고 반경 안에 방울이 있을 때만.
 *   지시 없는 세계에서는 `nearestFreeDrop` 자체가 안 불리므로 라벨도 안 만들어진다.
 * · 통행 특성은 게놈에서 오고 게놈은 시대(World)마다 새로 만들어지지만, 한 시대 안에서도 안전하도록
 *   특성 조합을 키에 넣는다(같은 지형 위에 육상 종과 비행 종의 답이 섞이면 안 된다).
 * · 개체가 막힌 타일 위에 서 있으면(라벨 -1) 무조건 false 다 · 그 자리에서 어디로도 "걸어갈 길"을
 *   보장할 수 없으니, 방울을 안 고르고 지시를 따르게 두는 쪽이 안전하다(이 함수가 고치려는 결함이
 *   정확히 "못 가는 데로 끌려가 굳는 것"이다).
 */
function canWalkTo(
  terr: Terrain,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  canSwim: boolean,
  canLand: boolean,
  canFly: boolean,
): boolean {
  if (canFly) return true; // 비행 종은 어느 두 점 사이든 지형에 안 막힌다(라벨을 만들 것도 없다)
  const label = reachLabels(terr, canSwim, canLand, canFly);
  const from = label[terr.tileIndex(x0, y0)] ?? -1;
  if (from < 0) return false;
  return from === (label[terr.tileIndex(x1, y1)] ?? -1);
}

/**
 * 지형 한 판의 **연결 통행 영역 라벨** 캐시. `label[타일] = 영역 번호`(막힌 타일은 -1) ·
 * 두 타일의 번호가 같으면 그 사이에 4방향으로 걸어갈 길이 반드시 있다.
 *
 * `Terrain` 은 시대마다 새로 만들어지고 타일 배열이 `readonly` 라 한 판 안에서는 답이 안 변한다.
 * 그래서 지형 객체를 키로 한 WeakMap 이면 수명 관리가 저절로 된다(지형이 버려지면 라벨도 함께 간다).
 * 안쪽 Map 의 키는 통행 특성 세 개를 비트로 접은 것이다.
 *
 * ⚠ 통행 규칙 자체는 여기서 다시 쓰지 않는다 · 반드시 `terrain.isPassable` 에 물어본다. 규칙을 두 곳에
 *   적으면 "지나갈 수 있다고 판정한 곳으로 갔는데 못 지나가는" 어긋남이 조용히 생긴다.
 */
const REACH_LABELS = new WeakMap<Terrain, Map<number, Int32Array>>();

function reachLabels(terr: Terrain, canSwim: boolean, canLand: boolean, canFly: boolean): Int32Array {
  const key = (canSwim ? 1 : 0) | (canLand ? 2 : 0) | (canFly ? 4 : 0);
  let byProfile = REACH_LABELS.get(terr);
  if (byProfile === undefined) {
    byProfile = new Map<number, Int32Array>();
    REACH_LABELS.set(terr, byProfile);
  }
  const cached = byProfile.get(key);
  if (cached !== undefined) return cached;

  const cols = terr.cols;
  const rows = terr.rows;
  const n = cols * rows;
  const label = new Int32Array(n).fill(-1);
  const passable = (idx: number): boolean =>
    terr.isPassable(terr.tileCenterX(idx), terr.tileCenterY(idx), canSwim, canLand, canFly);
  let id = 0;
  for (let start = 0; start < n; start += 1) {
    if (label[start] !== -1 || !passable(start)) continue;
    // 4방향 flood fill · 이웃 순회 순서는 findPath 와 같게 고정한다(답이 같아야 하는 두 함수다).
    const queue: number[] = [start];
    label[start] = id;
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++] ?? 0;
      const cx = cur % cols;
      const cy = (cur - cx) / cols;
      if (cx + 1 < cols && label[cur + 1] === -1 && passable(cur + 1)) {
        label[cur + 1] = id;
        queue.push(cur + 1);
      }
      if (cx - 1 >= 0 && label[cur - 1] === -1 && passable(cur - 1)) {
        label[cur - 1] = id;
        queue.push(cur - 1);
      }
      if (cy + 1 < rows && label[cur + cols] === -1 && passable(cur + cols)) {
        label[cur + cols] = id;
        queue.push(cur + cols);
      }
      if (cy - 1 >= 0 && label[cur - cols] === -1 && passable(cur - cols)) {
        label[cur - cols] = id;
        queue.push(cur - cols);
      }
    }
    id += 1;
  }
  byProfile.set(key, label);
  return label;
}

/**
 * 개체가 보는 방향(=이동 방향) 기준 시야각 안인지 판정하는 함수를 만든다. 움직일 때만 부채꼴이고,
 * 정지·저속(fovMinSpeed 미만)이면 항상 true(전방위 — 멈춰선 두리번거린다). dot 곱으로 가볍게 판정.
 * (단위 테스트용 export.)
 */
export function makeFovTest(e: Entity): (tx: number, ty: number) => boolean {
  const speed = Math.hypot(e.vx, e.vy);
  if (speed <= SIM.fovMinSpeed) return () => true;
  const fvx = e.vx / speed;
  const fvy = e.vy / speed;
  const cos = fovCosOf(e);
  return (tx: number, ty: number): boolean => {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const d = Math.hypot(dx, dy);
    return d < 1e-6 || (fvx * dx + fvy * dy) / d >= cos;
  };
}

/**
 * 이 개체의 시야각(부채꼴) cos — **클수록 좁다.** 눈 티어의 고유 대가가 여기 산다.
 *
 * ⚠ **최고 티어여도 안 넓어진다.** 예전 「정점 시야」는 부채꼴 규칙을 통째로 면제해 줬는데, 그건
 * **[사용자 2026-08-06]** 「티어가 오를수록 대가도 확연히 벌어진다」와 정면으로 어긋난다. 눈 4단은
 * 밤·수풀·상대 은신에서 규칙 밖으로 나가되(`isApex`), **뒤는 끝까지 캄캄하다.**
 * 사각을 메우는 유일한 길은 듀오 「파수꾼」(눈 III + 무리 III)이다 — 무리가 사각을 나눠 진다.
 */
export function fovCosOf(e: Entity): number {
  const cos = e.genome.traits.fovCos;
  if (cos <= SIM.fovHalfCos) return cos;
  // 파수꾼: 기본 시야각을 넘어 좁아진 몫을 절반만 진다.
  return hasDuo(e.genome.pips, "sentinel") ? SIM.fovHalfCos + (cos - SIM.fovHalfCos) * 0.5 : cos;
}

/**
 * 밤 시야 배율. daylight 1(정오)=1.0(영향 없음), 0(자정)=가장 어두움. vision 형질이 높을수록 밤
 * 하한이 올라간다(야행성 — 큰 눈은 밤에도 본다). 낮↔밤을 daylight 로 부드럽게 보간. (단위 테스트용 export)
 */
export function nightVisionFactor(daylight: number, vision: number): number {
  const nightMin = SIM.nightVisionFloor + SIM.nightVisionBonus * vision;
  return nightMin + (1 - nightMin) * daylight;
}

/**
 * 수풀 시야 배율 — 수풀 안이면 시야가 준다(vision 0 → grassVisionFloor 배). vision 형질이 높을수록
 * 감쇠가 사라진다(vision 1 이면 거의 1.0). 수풀 밖이면 1.0. 시야가 지형에서 가치를 갖게 하는 지점.
 */
export function grassVisionFactor(world: World, x: number, y: number, vision: number): number {
  if (!world.terrain.isGrass(x, y)) return 1;
  return Math.min(1, SIM.grassVisionFloor + SIM.grassVisionBonus * vision);
}

/**
 * 이 형질이 이 자리에서 실제로 보는 반경(px). 밤·수풀 감쇠와 비행 보너스, 정점 시야(100) 면제가
 * 전부 들어 있다. stepEntity 안에 있던 지역 계산을 **한 글자도 안 바꾸고** 뽑은 것이다.
 * 따로 뽑은 이유: 렌더가 시야 안개 구멍을 정확히 같은 값으로 뚫어야 화면이 로직과 1:1 이 된다
 * (보이는 범위와 아는 범위가 어긋나면 화면이 거짓말을 한다).
 * ⚠ 곱셈 순서를 바꾸면 부동소수점 마지막 자리가 달라져 결정론 지문이 깨진다. 순서를 손대지 말 것.
 */
export function visionRadius(t: Traits, world: World, x: number, y: number): number {
  const vision01 = t.vision / TRAIT_MAX;
  const apexEye = isApex(t.vision);
  return (
    SIM.visionBase *
    vision01 *
    (apexEye ? 1 : nightVisionFactor(world.daylight, vision01)) *
    (apexEye ? 1 : grassVisionFactor(world, x, y, vision01)) *
    (t.wings >= SIM.flyThreshold ? 1 + SIM.flyVisionBonus : 1)
  );
}

/**
 * 험지 이동 배율 — 험지 안이면 속도가 준다(speed 0 → roughSpeedFloor 배). speed 형질이 높을수록
 * 감속이 사라진다(speed 1 이면 거의 1.0). 험지 밖이면 1.0. 속도가 지형에서 가치를 갖게 하는 지점.
 * 인자 speed 는 0~1 정규화 값. (수풀 시야 grassVisionFactor 와 대칭.)
 */
export function roughSpeedFactor(world: World, x: number, y: number, speed: number): number {
  if (!world.terrain.isRough(x, y)) return 1;
  return Math.min(1, SIM.roughSpeedFloor + SIM.roughSpeedBonus * speed);
}

// (followsLead 는 삭제했다. 조건을 바깥에서 다시 유도하면 cohesion 블록이 "도망이 아닐 때"의
//  else 안에 있다는 사실이 빠져 화면이 거짓 숫자를 띄웠다. 이제 world.lead.followerCount 를 읽는다 —
//  세는 자리가 판정하는 자리와 같아서 어긋날 수가 없다.)

/** (dx,dy) 를 길이 len 으로 정규화. 0 벡터는 0 그대로. */
function scaleTo(dx: number, dy: number, len: number): Vec {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: 0, y: 0 };
  return { x: (dx / d) * len, y: (dy / d) * len };
}

/**
 * (dx,dy) 방향으로 향하는 desired 속도. arriveRadius>0 이면 그 거리 안에서 선형 감속(도착)해
 * 목표를 지나쳐 진동하는 오버슈트를 없앤다. arriveRadius=0 이면 전속(scaleTo 와 동일).
 */
function toward(dx: number, dy: number, maxSpeed: number, arriveRadius: number): Vec {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: 0, y: 0 };
  const speed = arriveRadius > 0 ? maxSpeed * Math.min(1, d / arriveRadius) : maxSpeed;
  return { x: (dx / d) * speed, y: (dy / d) * speed };
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
