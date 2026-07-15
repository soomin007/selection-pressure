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
import type { Traits } from "@/sim/genome";
import { TRAIT_MAX, cloneGenome, mutateGenome } from "@/sim/genome";
import { createEntity } from "@/sim/entity";
import { areFriends } from "@/sim/species";
import { bossCanHunt, bossRaidable } from "@/sim/boss";
import { SIM } from "@/sim/params";

interface Vec {
  x: number;
  y: number;
}

/**
 * 비행이 대사에 곱하는 배수(못 나는 종은 1 = 영향 없음).
 *
 * 날개가 클수록 같은 거리를 덜 지치며 난다 — 문턱(flyThreshold)에서 대가가 가장 크고, 100 에서
 * `flyMetabolismRelief` 만큼 줄어든다. 이 기울기가 없으면 날개 수치는 순전히 켜짐/꺼짐이라
 * 「튼튼한 날개」 같은 강화 카드가 아무 의미도 없다(수영·초음파·독·원거리는 모두 수치가 의미를 갖는다).
 */
export function flyDrainMultiplier(wings: number): number {
  if (wings < SIM.flyThreshold) return 1;
  const span = Math.max(1, TRAIT_MAX - SIM.flyThreshold);
  const span01 = Math.min(1, Math.max(0, (wings - SIM.flyThreshold) / span));
  return 1 + SIM.flyMetabolismCost * (1 - SIM.flyMetabolismRelief * span01);
}

/**
 * 식성(diet) 섭취 효율 — 특화할수록 자기 먹이에서 온전히(1.0), 잡식일수록 페널티(제너럴리스트 페널티).
 *
 * 곡선: 순수 초식(diet ≤ dietHuntMin)은 채집 1.0, 잡식 구간(dietHuntMin~dietGrazeMax)에서 효율이 떨어진다
 * (잡식 끝 diet 70 에서 0.7). 야생 초식종(diet 12~30)은 효율이 안 변해 통과기준 밸런스가 **잡식 기준선에만**
 * 걸린다(밸런스 이동 최소화).
 *
 * **diet 70 위(순수 육식)는 채집 효율이 완만히 0 으로 감소한다(2026-07-15 채집 절벽 완화).** 예전엔 여기가
 * `canGraze` 이진 게이트로 **뚝 끊겨**(70% → 0%) 순수 육식이 사냥 사이에 굶어 죽었다 — 이제 사냥이 주력이되
 * 풀도 조금 뜯어 연명하는 fallback 이 된다. tail 이 급해(carnGrazeFalloff) 야생 포식자(diet 85)에겐 채집
 * 이득이 거의 안 간다(생태 보존): diet 74=46% · 85=9% · 100=0%.
 */
export function grazeEfficiency(diet: number): number {
  const span = SIM.dietGrazeMax - SIM.dietHuntMin;
  const omni01 = clamp((diet - SIM.dietHuntMin) / span, 0, 1); // 0=순수 초식 … 1=채집 상한(잡식 끝)
  const base = 1 - SIM.dietSpecializationPenalty * omni01; // diet 70 에서 0.7
  if (diet <= SIM.dietGrazeMax) return base;
  // 순수 육식 구간(70~100): base 에서 완만히 0 으로. over=0(diet 70)→1(diet 100).
  const over = clamp((diet - SIM.dietGrazeMax) / Math.max(1, TRAIT_MAX - SIM.dietGrazeMax), 0, 1);
  return base * (1 - over) ** SIM.carnGrazeFalloff;
}
export function huntEfficiency(diet: number): number {
  const span = SIM.dietGrazeMax - SIM.dietHuntMin;
  const omni01 = clamp((SIM.dietGrazeMax - diet) / span, 0, 1); // 0=순수 육식 … 1=사냥 하한(잡식 끝)
  return 1 - SIM.dietSpecializationPenalty * omni01;
}

/**
 * 순수 육식도(0~1) — 문턱(dietGrazeMax=70)에서 0, 완전 육식(100)에서 1. 잡식/초식(diet ≤ 70)은 0.
 * "순수 육식일수록 세지는" 형질(스퍼트·큰 사냥·긴 포만)이 공유하는 스케일이라, 잡식·야생 초식은 이 값이
 * 0 이라 전부 영향 0(통과기준 밸런스 보존). 야생 포식자(diet 85)만 ≈0.5 로 절반 세기를 받는다.
 */
export function carnivory01(diet: number): number {
  return clamp((diet - SIM.dietGrazeMax) / Math.max(1, TRAIT_MAX - SIM.dietGrazeMax), 0, 1);
}

/**
 * 사냥 스퍼트 배수(질주형 육식) — 순수 육식이 먹잇감을 추격할 때 최대 속도가 오른다(치타·사자의 폭발적
 * 추격). 순수 육식일수록 크다(문턱 dietGrazeMax 에서 0, 완전 육식 100 에서 최대). 추격 중(hunting)이
 * 아니거나 잡식/초식이면 1(영향 없음). speed 형질이 "질주형 육식"의 사냥법이 된다 — 도망치는 초식을
 * speed 50 으론 못 잡아 순수 육식이 첫 사냥 전에 굶던 병목(known_issues)을 푼다.
 */
export function huntSprintFactor(diet: number, hunting: boolean): number {
  if (!hunting) return 1;
  return 1 + SIM.huntSprintBonus * carnivory01(diet);
}

/**
 * "큰 사냥" 배수 — 순수 육식의 한 번의 사냥이 주는 에너지를 키운다(문턱 70=1, 완전 육식 100=최대).
 * 잡식·초식(carnivory01=0)은 1(영향 없음). maxEnergyFor 의 높아진 상한과 짝을 이뤄, 드문 사냥으로도
 * 창고를 채워 오래 버티게 한다(긴 포만). 이게 없으면 높아진 상한이 드문 사냥으로 안 채워져 무의미하다.
 */
export function gorgeFactor(diet: number): number {
  return 1 + SIM.carnGorgeBonus * carnivory01(diet);
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
export function packShareGain(huntGain: number, diet: number, herding: number): number {
  return huntGain * SIM.packSharePerMember * packHerdFactor(herding) * carnivory01(diet);
}

/**
 * 식성별 에너지 상한 — 순수 육식은 큰 사냥의 영양을 maxEnergy 위로 비축한다("긴 포만"). 문턱 70=maxEnergy
 * (잡식·초식은 상한 100 그대로), 완전 육식 100=maxEnergy + carnGorgeReserve. 비축분은 별도 로직 없이
 * 그냥 대사로 천천히 줄어 다음 사냥까지의 생존 시간이 된다 — 드물게 성공해도 크게 먹고 오래 버티는 대형
 * 포식자. 잡식(diet 50)은 carnivory01=0 이라 100 그대로 → 통과기준(잡식 기준선) 밸런스 불변.
 */
export function maxEnergyFor(diet: number): number {
  return SIM.maxEnergy + SIM.carnGorgeReserve * carnivory01(diet);
}

/**
 * **정점(apex)** — 값 형질이 상한(100)에 닿았는가. 닿으면 그 형질만의 특별한 능력이 켜진다.
 *
 * 왜 필요한가: 상한 근접 감쇠(cards.ts growthFalloff)로 100 은 **값비싼 목표**가 됐다. 비싸진 만큼
 * 닿았을 때 뭔가 있어야 한다(사용자: "100에 도달했을 때 뭔가 보상을 줄 거리는 없어?").
 * 예전엔 그냥 멈춤(clamp)일 뿐이라 "최고조"에 아무 의미가 없었다.
 *
 * 정점 효과는 **그 형질의 약점을 지우는** 쪽으로 준다 — 수치를 더 키우는 게 아니라 "규칙에서 벗어난다":
 *   · 속도 100 — 험한 땅도 이 걸음을 늦추지 못한다(험지 감속 면제)
 *   · 시야 100 — 어둠도 수풀도 눈을 가리지 못한다(밤·수풀 시야 감쇠 면제)
 *   · 공격력 100 — 어떤 가죽도 이빨을 막지 못한다(체급 차로 "안 박힘"이 안 걸린다)
 *   · 번식력 100 — 한 배에 둘을 친다(쌍둥이)
 *   · 몸집 100 — 따로 안 준다. 이미 체급만으로 보통 포식자의 이빨이 안 박힌다(그 자체가 정점 보상).
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
 * 한 번의 물기 결과. **공격력 차 + 몸집 차**로 정한다(v7 부터).
 *
 * v6 까지는 attack 하나가 "무기이자 몸집"을 겸했다. v7 에서 몸집(size)을 떼어내 두 축이 됐다:
 *   · attack — 사냥 무기(이빨·발톱). 얼마나 잘 죽이는가.
 *   · size   — 체급. 얼마나 안 죽는가.
 * 유효 체급 차 = (공격력 차 + sizeBiteWeight × 몸집 차) / 100. **몸집이 둘 다 50 이면 몸집 항이 정확히
 * 0** 이라 v6 판정과 완전히 같다(밸런스 보존).
 *
 * - 체급이 `biteIgnoreDiff` 넘게 밀리면 **아무 일도 안 일어난다** — "일정 공격력 이하의 공격은 무시".
 *   몸집이 크면 여기에 걸려 아예 안 물린다("코끼리는 못 문다").
 * - 그 위에서는 즉사 확률이 체급 차에 비례하고, 못 죽인 물기는 기운을 깎는다("여러 번 물리다 쓰러진다").
 */
export function biteOutcome(
  attack: number,
  preyAttack: number,
  size: number = TRAIT_MAX / 2,
  preySize: number = TRAIT_MAX / 2,
): BiteOutcome {
  const diff01 =
    (attack - preyAttack) / TRAIT_MAX + (SIM.sizeBiteWeight * (size - preySize)) / TRAIT_MAX;
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
export function herdShielded(p: Entity, world: World): boolean {
  const herding = p.genome.traits.herding;
  if (herding <= SIM.herdShieldThreshold) return false;
  const neighbors = world.grid.countMatching(
    p.x,
    p.y,
    SIM.herdShieldRadius,
    (m) => m.alive && m !== p && m.species.id === p.species.id,
  );
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
  world.emit("kill", prey.x, prey.y); // 연출: 잡아먹힘(빨강 터짐)
  if (preyVenom > 0) e.poison += SIM.venomOnHit * (preyVenom / TRAIT_MAX);
  const diet = e.genome.traits.diet;
  // 사냥 수입 = 기본 × 방어독 감쇠 × 식성 효율(육식 특화일수록 온전히, 잡식은 페널티) × 큰 사냥(순수 육식은
  // 크게 먹는다). 순수 육식은 상한(maxEnergyFor)이 100 위로 올라 이 큰 사냥을 비축한다(긴 포만) — 잡식은
  // gorgeFactor 1·상한 100 이라 기존과 동일.
  const huntGain =
    SIM.predationEnergy * (1 - preyVenom / TRAIT_MAX) * huntEfficiency(diet) * gorgeFactor(diet);
  e.energy = Math.min(maxEnergyFor(diet), e.energy + huntGain);
  // 무리사냥 먹이 나눔: 사냥감을 같은 종 무리가 함께 먹는다(늑대). 사냥감 주위 같은 종 순수 육식 무리에게
  // 카커스 몫을 지급 — 뭉친 팩은 소수의 사냥으로 다 같이 먹어 자생한다(herding 이 육식 생존 레버). 순수
  // 육식 킬에서만(carnivory01>0) 순회 비용을 치른다. 밀도가 열쇠라 흩어진 야생 포식자(4마리)는 팩을 못 이뤄
  // 나눔이 거의 없다(자연 격리). 나눔 몫은 packmate 자신의 herding·식성으로 스케일(무리 성향이 클수록 많이).
  if (carnivory01(diet) > 0) {
    world.grid.forEachMatching(prey.x, prey.y, SIM.packShareRadius, (m) => {
      if (!m.alive || m === e || m.species.id !== e.species.id) return;
      const md = m.genome.traits.diet;
      const share = packShareGain(huntGain, md, m.genome.traits.herding);
      if (share > 0) m.energy = Math.min(maxEnergyFor(md), m.energy + share);
    });
  }
  e.targetPrey = null;
}

export function stepEntity(e: Entity, world: World, newborns: Entity[]): void {
  const t = e.genome.traits;
  // 형질은 0~100 자연수 저장 → 계수 계산은 0~1 로 정규화(÷TRAIT_MAX)해 해석한다(임계 비교는 0~100 그대로).
  const speed01 = t.speed / TRAIT_MAX;
  const vision01 = t.vision / TRAIT_MAX;
  const metabolism01 = t.metabolism / TRAIT_MAX;
  const herding01 = t.herding / TRAIT_MAX;
  const fertility01 = t.fertility / TRAIT_MAX;
  // 날개≥flyThreshold 면 비행 — 산·물을 날아 넘고, 험지 감속을 무시하며, 높이 날아 시야가 넓다.
  // 대신 계속 날갯짓이라 대사가 더 든다(비행의 대가). 날개 0 인 종은 canFly=false → 전부 영향 0(밸런스 보존).
  const canFly = t.wings >= SIM.flyThreshold;
  // 원거리(ranged) 사거리 — 사냥 사정거리이자, 원거리 종이 먹잇감에 붙지 않고 멈춰 쏘는 거리(kiting).
  // 임계 기반: 임계(rangedThreshold) 이하는 기존 기울기(밸런스 불변), 초과분만 급한 기울기로 사거리가
  // 확 는다 → 전문 원거리 종만 멀리서 쏜다(야생·부수적 ranged 는 근접 그대로).
  const rangedLow = Math.min(t.ranged, SIM.rangedThreshold);
  const rangedHigh = Math.max(0, t.ranged - SIM.rangedThreshold);
  const atkRange =
    SIM.attackRange +
    (rangedLow / TRAIT_MAX) * SIM.rangedBonus +
    (rangedHigh / TRAIT_MAX) * SIM.rangedBonusHigh;
  // 사냥 스퍼트(질주형 육식): 순수 육식이 먹잇감을 추격 중이면 속도가 오른다 — 도망치는 초식을 speed 50
  // 으론 못 잡던 병목을 speed 형질로 푼다(치타의 폭발적 추격). 순수 육식일수록·추격 중일 때만이라 야생
  // 초식·잡식은 영향 0.
  const sprintFactor = huntSprintFactor(t.diet, e.targetPrey !== null);
  // 험지(거친 땅)에선 이동이 느려진다 — speed 형질이 높을수록 덜 느려진다(속도가 지형에서 가치). 비행은 무시.
  // 몸집이 크면 느리다(sizeSpeedFactor — 몸집 50 이면 1.0 이라 영향 없음).
  // **정점 속도(100)**: 험한 땅도 이 걸음을 늦추지 못한다(험지 감속 완전 면제).
  const roughFree = canFly || isApex(t.speed);
  const maxSpeed =
    SIM.maxSpeedBase * (0.4 + speed01) *
    (roughFree ? 1 : roughSpeedFactor(world, e.x, e.y, speed01)) * sprintFactor *
    sizeSpeedFactor(t.size);
  // 밤엔 시야가 준다(낮=영향 없음). vision 형질이 높을수록 밤에도 잘 본다 → 야행성 틈새(큰 눈).
  // 시야 반경 = visionBase × (시야/100). 하한이 없어 시야 0 이면 아무것도 못 본다(감각 형질의 대가).
  // 비행 종은 높이 날아 시야가 넓다(× (1+flyVisionBonus)).
  // **정점 시야(100)**: 어둠도 수풀도 눈을 가리지 못한다(밤·수풀 감쇠 완전 면제).
  const apexEye = isApex(t.vision);
  const vision =
    SIM.visionBase *
    vision01 *
    (apexEye ? 1 : nightVisionFactor(world.daylight, vision01)) *
    (apexEye ? 1 : grassVisionFactor(world, e.x, e.y, vision01)) *
    (canFly ? 1 + SIM.flyVisionBonus : 1);
  // 큰 몸은 많이 먹는다(sizeDrainFactor — 몸집 50 이면 1.0). 대사(metabolism)가 "효율"이라면 몸집은
  // "총량"이다: 큰 몸은 효율이 좋아도 절대 소모가 크다.
  const drain =
    SIM.metabolismDrain * (0.5 + metabolism01) * flyDrainMultiplier(t.wings) * sizeDrainFactor(t.size);
  const maxAge = SIM.baseMaxAge;
  // 식성 구간: 초식(<35) 식물만 / 잡식(35~70) 둘 다 / 육식(>70) 사냥 위주 + 채집 fallback(효율이 남는 한).
  const canHunt = t.diet > SIM.dietHuntMin;
  // 채집 게이트를 효율 기반으로(2026-07-15 채집 절벽 완화). 예전엔 `diet < 70` 이진이라 순수 육식이 채집을
  // 아예 못 해 굶어 죽었다. 이제 채집 효율이 유의미하게 남아 있으면(diet ~86 까지) 풀도 뜯는다. 극단 육식
  // (diet 87+, 효율 <6%)은 무의미한 채집 이동을 안 하게 여기서 끊는다 — grazeEfficiency 의 tail 과 한 쌍이다.
  const canGraze = grazeEfficiency(t.diet) > SIM.grazeMinEff;
  // 수영 종만 물에 들어가고(산은 못 넘되 비행은 예외), 물 전용(수영 아주 높음)은 육지에 못 올라온다.
  const canSwim = t.swimming >= SIM.swimThreshold;
  const canLand = t.swimming < SIM.aquaticOnlyThreshold;

  // 무리 이웃(3×3 칸) — cohesion(이동)과 huddle(보온)에 함께 쓴다.
  const nb = t.herding > 0 ? world.grid.neighborhood(e.x, e.y) : null;

  // --- 원하는 속도(desired) 계산 ---
  let desired: Vec;
  let turn: number = SIM.steerTurn;

  // **레이드 — 강한 개체(전사)는 도망 대신 맞서 반격한다(공격 카운터 보스).** 공격력이 문턱을 넘는 내 종
  // 개체는 약탈자 떼에 안 도망치고 평소처럼(채집·무리) 버티며, 떼가 물어 올 때 공격력으로 반격해 격퇴
  // 체력을 깎는다(boss.memberKills). 약한 개체는 그대로 도망(computeFlee) — "전사와 도망자".
  // 접근·kiting 이 아니라 "반격"인 이유: 약탈자 떼는 내 종보다 빨라(도망 차단이 설계) kiting 이 원천적으로
  // 안 통한다. 이미 있는 카운터(공격력 반격)를 격퇴로 확장하는 게 자연스럽다.
  const warrior = isRaidWarrior(e, world, t);
  const flee = warrior ? null : computeFlee(e, world, t, maxSpeed, canSwim, canLand, canFly);
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
      const hdx = nb.comX - e.x;
      const hdy = nb.comY - e.y;
      const hd = Math.hypot(hdx, hdy);
      // 무게중심이 벽 너머(직선으로 안 보임)면 cohesion 을 끈다 — 못 가는 무리를 쫓아 벽에 정지하지
      // 않게(길찾기는 먹이 목표에만 적용되므로 cohesion 발 끼임은 여기서 막는다).
      if (hd > SIM.herdComfortRadius && world.terrain.lineOfSight(e.x, e.y, nb.comX, nb.comY, canSwim)) {
        const pull = Math.min(1, (hd - SIM.herdComfortRadius) / SIM.herdComfortRamp);
        const w = SIM.herdCohesion * herding01 * pull;
        const herd = scaleTo(hdx, hdy, maxSpeed);
        desired = {
          x: desired.x * (1 - w) + herd.x * w,
          y: desired.y * (1 - w) + herd.y * w,
        };
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
  if (!fleeing && e.targetPrey && e.targetPrey.alive) {
    const prey = e.targetPrey;
    const dx = prey.x - e.x;
    const dy = prey.y - e.y;
    // 원거리 종은 이 넓은 사거리(atkRange, 상단 계산)에서 쏜다 — 붙지 않고 멀리서 명중.
    // 물기는 쿨다운마다 한 번. 예전엔 매 틱 굴려 접촉 즉시 즉사였다.
    if (dx * dx + dy * dy <= atkRange * atkRange && e.attackCd <= 0) {
      e.attackCd = SIM.attackCooldownTicks;
      // 독은 방어(삼킨 쪽이 중독)라 사냥 성공과 무관 — 물기 판정은 공격력 차와 **몸집 차**를 본다.
      // 큰 먹잇감은 잘 안 죽고, 아주 크면 이빨이 아예 안 박힌다(biteIgnoreDiff).
      const bite = biteOutcome(
        t.attack, prey.genome.traits.attack, t.size, prey.genome.traits.size,
      );
      // ignored 면 아무 일도 안 일어난다("일정 공격력 이하의 공격은 무시").
      if (!bite.ignored) {
        if (world.rng.chance(bite.killChance)) {
          devour(e, prey, world);
        } else {
          prey.energy -= bite.damage;
          prey.woundTicks = SIM.woundTicks; // 다쳤다 — 이 동안 쓰러지면 "부상"이지 굶주림이 아니다
          world.emit("bite", prey.x, prey.y); // 연출: 물렸다(작은 붉은 튐)
          // 여러 번 물려 기운이 다하면 그 자리에서 잡아먹힌다(사망 원인은 잡아먹힘 — 포식자가 먹는다).
          if (prey.energy <= 0) devour(e, prey, world);
        }
      }
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
          const bx = e.x + world.rng.range(-12, 12);
          const by = e.y + world.rng.range(-12, 12);
          const spot = world.terrain.nearestPassable(bx, by, canSwim, canLand, canFly);
          newborns.push(createEntity(world.nextId(), spot.x, spot.y, e.species, SIM.startEnergy));
          world.emit("birth", spot.x, spot.y); // 연출: 대박 탄생(초록 반짝 여럿)
        }
        food.regrowTimer = Math.round(
          SIM.foodRegrowTicks * world.foodRegrowMultiplier * SIM.mountainTreasureRegrow,
        );
      } else {
        // 채집 수입 = 기본 × 식성 효율(초식 특화일수록 온전히, 잡식은 페널티).
        e.energy = Math.min(SIM.maxEnergy, e.energy + SIM.foodEnergy * grazeEfficiency(t.diet));
        // 시대가 지날수록(foodScarcity) 먹힌 풀이 더 느리게 자란다 — 큰 무리일수록 고갈이 빨라 회복이 억제된다.
        food.regrowTimer = Math.round(SIM.foodRegrowTicks * world.foodRegrowMultiplier * world.foodScarcity);
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
  const coldDrain = SIM.coldPenalty * coldField * (1 - metabolism01) * warmthFactor;
  // 열기 = 국소 사막·열대우림 열기(env.heat) + 대멸종 폭염(world.heat). 둘 다 고대사(고에너지) 개체에 불리.
  const heatField = env.heat + world.heat;
  const heatDrain = SIM.heatPenalty * heatField * metabolism01;
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
    world.emit("death", e.x, e.y); // 연출: 자연사(회색 흩어짐)
    return;
  }
  if (e.age >= maxAge) {
    e.alive = false;
    world.recordDeath(e.species, "age");
    world.emit("death", e.x, e.y);
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
    const cx = e.x + world.rng.range(-6, 6);
    const cy = e.y + world.rng.range(-6, 6);
    // 막힌 타일에 태어나면 갇히므로 가장 가까운 통행 타일로 스냅(rng 미사용 → 결정론·밸런스 보존).
    const spot = world.terrain.nearestPassable(cx, cy, canSwim, canLand, canFly);
    // 개체별 진화 — 내 종 새끼는 부모 게놈을 물려받아 조금 변이한다(독립 mutRng → 메인 스트림 불변).
    // 야생은 종 게놈 공유(개체 변이 없음 — 야생은 종 단위 진화가 따로 있다).
    const childGenome = e.species.isPlayer
      ? mutateGenome(cloneGenome(e.genome), world.mutRng, SIM.mutationStrength)
      : undefined;
    newborns.push(createEntity(world.nextId(), spot.x, spot.y, e.species, childEnergy, childGenome));
    world.emit("birth", spot.x, spot.y); // 연출: 탄생(초록 반짝)
  }
}

/**
 * 이 개체가 지금 "레이드 전사"인가 — 공격 카운터 보스(격퇴 체력 있음)에 맞서 반격하는 강한 개체.
 * 전사면 그 보스에게 안 도망친다(computeFlee 스킵). 실제 격퇴는 떼가 물어 올 때 반격으로 일어난다
 * (boss.memberKills 가 공격력≥문턱이면 격퇴 체력을 깎고 전사를 살린다).
 * 공격 카운터 보스(cullAttackResist>0=약탈자)에만 — 다른 카운터 보스는 2단계에서 각자 방식으로.
 */
function isRaidWarrior(e: Entity, world: World, t: Traits): boolean {
  const boss = world.boss;
  return (
    e.species.isPlayer &&
    boss !== null &&
    bossRaidable(boss) &&
    boss.cullAttackResist > 0 &&
    t.attack >= SIM.raidWarriorAttack &&
    bossCanHunt(boss, e, world)
  );
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
  const predator = world.grid.nearestMatching(
    e.x,
    e.y,
    SIM.predatorSenseRange,
    (p) =>
      p.alive && p !== e && p.species.id !== e.species.id && !areFriends(e.species, p.species) &&
      p.genome.traits.diet > SIM.dietHuntMin && p.genome.traits.attack >= t.attack &&
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
  const canSensePrey = (p: Entity): boolean => {
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d2 = dx * dx + dy * dy;
    const camoF = camoVisionFactor(p.genome.traits.camouflage, p.genome.traits.size);
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
    if (p.alive && p.species.id !== e.species.id && reachable && !herdShielded(p, world)) {
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
 * 개체가 보는 방향(=이동 방향) 기준 시야각 안인지 판정하는 함수를 만든다. 움직일 때만 부채꼴이고,
 * 정지·저속(fovMinSpeed 미만)이면 항상 true(전방위 — 멈춰선 두리번거린다). dot 곱으로 가볍게 판정.
 * (단위 테스트용 export.)
 */
export function makeFovTest(e: Entity): (tx: number, ty: number) => boolean {
  const speed = Math.hypot(e.vx, e.vy);
  if (speed <= SIM.fovMinSpeed) return () => true;
  const fvx = e.vx / speed;
  const fvy = e.vy / speed;
  return (tx: number, ty: number): boolean => {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const d = Math.hypot(dx, dy);
    return d < 1e-6 || (fvx * dx + fvy * dy) / d >= SIM.fovHalfCos;
  };
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
 * 험지 이동 배율 — 험지 안이면 속도가 준다(speed 0 → roughSpeedFloor 배). speed 형질이 높을수록
 * 감속이 사라진다(speed 1 이면 거의 1.0). 험지 밖이면 1.0. 속도가 지형에서 가치를 갖게 하는 지점.
 * 인자 speed 는 0~1 정규화 값. (수풀 시야 grassVisionFactor 와 대칭.)
 */
export function roughSpeedFactor(world: World, x: number, y: number, speed: number): number {
  if (!world.terrain.isRough(x, y)) return 1;
  return Math.min(1, SIM.roughSpeedFloor + SIM.roughSpeedBonus * speed);
}

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
