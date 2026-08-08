// 무리 지시(신탁)의 계약. 이 파일에는 숫자밖에 없다 · DOM·Pixi 타입이 하나라도 들어오면 sim 순수성이
// 깨진다(CLAUDE.md 최상위 규칙). 입력 장치(손가락)를 아는 것은 main/ui 층이고, sim 은 "어디로"만 받는다.
//
// **왜 알파 조종이 아니라 이건가.** 이 게임의 결과를 정하는 것은 전부 무리 단위다: 시험 계수(무리의
// 사냥·채집·출산), 경험치(무리가 먹은 먹이), 보스 격퇴(무리 구성원들의 형질), 승패(무리 개체 수).
// 그런데 입력만 개체 단위였다 → "내가 이 종을 관리한다는 느낌이 전혀 안 든다"(2026-08-03 사용자).
// 그래서 입력을 결과가 사는 층으로 올린다. 플레이어는 무리의 일원이 아니라 그 종을 주관하는 쪽이다.
//
// **뜻은 분명하되 이행은 종의 천성이 정한다.** 명령은 애매하지 않다(저기로 가라). 다만 무슨 일이
// 벌어지는지는 길러 온 종이 정한다:
//   · 속도가 낮으면 늦게 닿는다(maxSpeed 가 그대로 걸린다).
//   · 배고픈 개체는 **가는 길의** 먹이를 지나치지 못한다(목표가 지시 쪽이고 지시점보다 가까울 때).
//   · 위험을 본 개체는 달아난다(도망이 가장 위다).
//   · 무리 성향이 높으면 한 덩어리로 움직이고, 낮으면 몇 마리씩 흩어져 닿는다(뭉침이 그대로 작동).
// 이 넷은 새로 만든 규칙이 아니라 **이미 있는 행동 우선순위가 그대로 드러난 것**이다.
//
// **실제 우선순위(behavior.ts 의 지시 블록과 1:1로 대조할 것):**
//   도망 > 사냥감 추적 > **방울** > (가는 길·코앞의) 먹이 > 지시 > 배회.
//   · 방울(유전자 점수)은 **[사용자 2026-08-09]** 로 들어왔다 ▸ "가라 명령 때 방울을 우선시해서
//     알아서 먹는다거나 하는 건 있었으면 좋겠어." 지시가 걸린 동안, 근처(ORDER.geneRadius)에 아직
//     안 주운 방울이 있으면 그쪽을 먼저 들른다 · 주우면 저절로 지시로 돌아간다.
//     ⚠ 이 개체는 순종(orderFollowers)에 **안 센다** · 지시가 아니라 방울이 몰고 있는 것이다.
//   · 해제 반경(ORDER.releaseRadius 64px · **개체 단위**) **안**이면 지시가 아예 안 걸린다 = 예전
//     그대로 자율이다(도착 = 명령 종료가 아니라 그 근방에서 자율).
//     ⚠ ORDER.arriveRadius(200px)는 **무리 단위 화면 표시**("무리 도착" · main 의 herdArrived) 전용이다.
//       개체 게이트에 200 을 쓰면 무리 근처 탭이 통째로 무시된다(2026-08-05 사고 · 둘을 합치지 말 것).
//   · 반경 **밖**이면 지시가 이동을 가져간다. 이 개체들이 화면 "따르는 중 N/M" 의 분모
//     (world.orderPending)다 · 도망 중인 개체도 분모에 든다(그래서 N < M 이 정상). 다만 둘은
//     여전히 지시보다 위다:
//       - 물고 있는 **사냥감**(targetPrey) · 언제나. 라운드에 5~10번뿐인 드문 사건이라 끊으면 사라진다.
//       - **가는 길의 먹이** · 목표가 지시 쪽(내적 ≥ 0)이고 지시점보다 가깝거나, ORDER.grabRadius(30px)
//         안이면. 즉 "조금 돌아가는 정도"는 지나치지 못한다.
//
// ⚠ 지키는 선 하나: **방향은 반드시 따른다.** 늦게 가거나, 절반만 가거나, 도중에 흩어지는 것은
// 납득되지만 시킨 것과 다른 데로 가면 신탁이 아니라 조작 불량으로 읽힌다.
//
// ⚠ 2026-08-04 실측으로 배운 것: 위 둘째 줄("배고픈 개체는 지나치지 못한다")을 처음엔 **예외적 사정**
// 으로 상정하고 "먹이·사냥 목표가 있으면 지시를 통째로 무시"로 구현했는데, 먹이를 쫓는 것은 예외가
// 아니라 **기본 상태**였다(개체틱의 72.1%). 그래서 순종률이 7.5%(24마리 중 1~2마리)였고 사용자는
// "내 말을 듣는다는 느낌이 전혀 안 든다"고 했다. 이 파일은 숫자가 아니라 **계약**이다 · 코드와 이
// 주석이 갈리면 다음 세션이 주석을 근거로 또 잘못 판단한다. 조건문을 고치면 위 문장부터 고칠 것.

import { HERD_VOICE, HERD_VACUUM_TICKS, tierOf, type Category, type Keys, type Pips } from "@/sim/tiers";

/**
 * 무리 명령의 종류. **[사용자 2026-08-06]** 조작 다양화 지시("탭으로 이동 명령 하나만 두지 말고,
 * 꾹 눌러서 여러 개의 명령 휠에서 하나를 정하게 한다든가, 더블탭으로 회피 명령이라든가")의 구현이다.
 *
 * **칸은 티어로 열린다.** 못 여는 칸은 회색으로 보인다 → 다음 판의 동기가 되고, 무엇보다
 * **성장이 숫자가 아니라 손에서 읽힌다.** 이것이 티어 구조가 조작에 닿는 자리다.
 */
export type OrderKind = "move" | "hunt" | "evade" | "gather" | "scan" | "brace" | "ring" | "drive";

export interface OrderSpec {
  kind: OrderKind;
  /** 명령 휠에 뜨는 이름(두 글자~네 글자). */
  label: string;
  /** 이 칸을 여는 범주. `null` = 처음부터 열려 있다. */
  cat: Category | null;
  /** 그 범주가 이 티어 이상이어야 열린다. */
  tier: number;
  /** 잠겨 있을 때 보이는 한 줄 — **무엇을 하면 열리는지**를 그 자리에서 말한다(대백과에 안 미룬다). */
  hint: string;
  /** 무엇을 하는 명령인가(휠에 뜨는 설명 한 줄). */
  desc: string;
  /**
   * **이 명령이 실제로 그 일을 하는가.** false 면 휠에서 고를 수 없고(회색), 힌트가 준비 중임을 말한다.
   *
   * ⚠ 왜 이 필드가 있나(2026-08-09). 여덟 칸 중 **일곱이 코드상 「가라」와 완전히 같았다** —
   *   `order.kind` 를 읽는 분기가 sim 어디에도 없어서, 같은 시드에서 「가라」와 「잡아라」의 개체
   *   좌표가 비트 단위로 같았다. 그런데 화면은 "표시한 것을 함께 쫓습니다"·"둥글게 서서 안쪽을
   *   지킵니다"라고 말하고, 그 위에 쿨타임과 기력 소모까지 물렸다. 즉 **「가라」에 벌칙만 얹은
   *   칸**이었다(엄격히 나쁜 선택지). 「피해라」는 이제 진짜가 됐고, 나머지 여섯은 **잠근다** —
   *   이 저장소의 규칙("수치가 화면 표시와 다르면 그건 거짓말이다")에는 잠그는 쪽이 맞다.
   *   구현하는 세션이 이 값을 true 로 되돌리고 hint 를 티어 문구로 되돌리면 된다.
   */
  ready: boolean;
  /**
   * 쿨타임(틱). **[사용자 2026-08-06]** 특수 명령에만 건다 — 「가라」에는 안 건다.
   * 기본 조작이 막히면 조종 감각 자체가 죽는다.
   * ⚠ `ready: false` 인 칸의 값은 **한 번도 안 걸린다**(애초에 명령이 안 나간다) · 구현될 때를 위한
   *   설계값으로 남겨 둔 것이지, 지금 무는 대가가 아니다.
   */
  cooldown: number;
  /** 이 명령이 개체의 기력을 이만큼 쓴다(회피처럼 몸을 쥐어짜는 것). 무는 대상은 **목소리가 닿는 개체뿐**. */
  energy: number;
}

/**
 * 명령 휠의 여덟 칸. 다섯 범주가 저마다 하나씩 열고, 마지막 하나는 듀오가 연다.
 * ⚠ 여기 티어 조건과 `sim/tiers.ts` 의 파생표는 한 쌍이다. 한쪽만 만지면 「이 티어에서 열린다」가
 *   화면과 실제로 갈라진다.
 */
/** 아직 구현 안 된 칸의 힌트·설명 한 줄(여섯 칸이 같은 문구를 쓴다 · 한 곳에서만 고친다). */
const WIP_HINT = "아직 준비 중입니다";
export const ORDER_SPECS: readonly OrderSpec[] = [
  {
    kind: "move", label: "가라", cat: null, tier: 0, ready: true,
    hint: "", desc: "그 자리로 무리를 보냅니다.", cooldown: 0, energy: 0,
  },
  {
    kind: "hunt", label: "잡아라", cat: "fang", tier: 1, ready: false,
    hint: WIP_HINT, desc: WIP_HINT, cooldown: 60, energy: 0,
  },
  {
    kind: "evade", label: "피해라", cat: "leg", tier: 1, ready: true,
    hint: "다리 1단이 되면 열립니다", desc: "탭한 자리에서 반대쪽으로 흩어져 달아납니다.", cooldown: 90, energy: 8,
  },
  {
    kind: "gather", label: "모여라", cat: "herd", tier: 1, ready: false,
    hint: WIP_HINT, desc: WIP_HINT, cooldown: 60, energy: 0,
  },
  {
    kind: "scan", label: "살펴라", cat: "eye", tier: 2, ready: false,
    hint: WIP_HINT, desc: WIP_HINT, cooldown: 120, energy: 0,
  },
  {
    kind: "brace", label: "버텨라", cat: "hide", tier: 3, ready: false,
    hint: WIP_HINT, desc: WIP_HINT, cooldown: 180, energy: 4,
  },
  {
    kind: "ring", label: "원진", cat: "herd", tier: 3, ready: false,
    hint: WIP_HINT, desc: WIP_HINT, cooldown: 180, energy: 0,
  },
  {
    kind: "drive", label: "몰아라", cat: null, tier: 0, ready: false,
    hint: WIP_HINT, desc: WIP_HINT, cooldown: 150, energy: 0,
  },
];

export const ORDER_SPEC_BY_KIND: ReadonlyMap<OrderKind, OrderSpec> = new Map(
  ORDER_SPECS.map((s) => [s.kind, s]),
);

/**
 * 이 명령 칸이 지금 열려 있는가 — **게이트는 여기 하나뿐**이다(휠의 회색 표시도, game 의 명령 접수도
 * 이 함수만 본다). 「몰아라」만 듀오 조건이라 따로 본다.
 *
 * ⚠ 구현 안 된 칸(`ready: false`)은 티어와 무관하게 잠긴다. 게이트를 둘로 쪼개면(티어 게이트 +
 *   구현 게이트) 반드시 한쪽만 보는 호출부가 생겨, 화면은 회색인데 명령은 나가는(또는 그 반대의)
 *   어긋남이 난다 — 이 저장소가 이미 여러 번 겪은 「같은 규칙을 두 곳에 적었다」 함정이다.
 */
export function orderUnlocked(spec: OrderSpec, pips: Pips): boolean {
  if (!spec.ready) return false;
  if (spec.kind === "drive") return tierOf(pips.fang) >= 3 && tierOf(pips.herd) >= 3;
  if (spec.cat === null) return true;
  return tierOf(pips[spec.cat]) >= spec.tier;
}

/**
 * **명령이 닿는 거리(px)** — **[사용자 2026-08-06]** 확정. 명령은 목소리가 닿는 데까지만 가고,
 * 그 거리를 무리 티어가 넓힌다. 열쇠 「부름」이 여기 붙는다.
 *
 * 이 하나가 조작 감각을 둘로 가른다: 무리를 안 판 종은 **소수를 직접 데리고 다니는 손맛**,
 * 무리를 판 종은 **대군을 한 번에 움직이는 맛**. 같은 게임에서 두 가지 조종이 나온다.
 */
export function voiceRadius(pips: Pips, keys: Keys): number {
  const base = HERD_VOICE[Math.min(HERD_VOICE.length - 1, tierOf(pips.herd))] as number;
  return keys.call ? base * 1.6 : base;
}

/**
 * **지휘 공백** — 알파가 죽고 나서 명령이 안 통하는 틱 수. 무리 티어가 줄인다(조직이 있으면 다음
 * 개체가 곧바로 이어받는다).
 *
 * ⚠ 알파의 죽음으로 **불씨를 깎지 않는다.** 불씨는 다섯뿐인데 알파는 앞장서는 자리라 자주 죽고
 *   (한 번에 판의 20%), 무엇보다 불씨는 「시험에 떨어졌다」 한 뜻만 가진 미터인데 알파 죽음을 섞으면
 *   그 뜻이 흐려진다.
 */
export function vacuumTicks(pips: Pips): number {
  return HERD_VACUUM_TICKS[Math.min(HERD_VACUUM_TICKS.length - 1, tierOf(pips.herd))] as number;
}

/**
 * 무리에게 내린 뜻. 월드 좌표 한 점 + 무엇을 하라는 것인가.
 * 없으면(null) 무리는 완전히 자율로 산다(= 관전).
 */
export interface HerdOrder {
  readonly x: number;
  readonly y: number;
  /** 무엇을 하라는 명령인가. 없으면 「가라」(이동) — 기존 호출부·테스트가 그대로 산다. */
  readonly kind?: OrderKind;
  /** 이 명령이 몇 틱 더 유효한가(특수 명령만). 0 이하 = 무기한(이동). */
  readonly ticks?: number;
}
