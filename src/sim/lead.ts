// 알파 조종(앞장서기)의 명령 계약. 이 파일에는 숫자·불리언밖에 없다 —
// DOM·Pixi 타입이 하나라도 들어오면 sim 순수성이 깨진다(CLAUDE.md 최상위 규칙).
// 입력 장치(손가락·키보드)를 아는 것은 main/ui 층이고, sim 은 "방향과 세기"만 받는다.

import { SIM, LEAD } from "@/sim/params";

/**
 * 유지 입력(레벨). 사람이 손가락·키를 누르고 있는 "상태"를 그대로 옮긴 값.
 * 레벨 입력이라 한 프레임이 0틱이든 15틱이든 씹히지도 중복되지도 않는다.
 * targetId(사냥 대상 지정)도 같은 레벨 입력이다 — 명령이 사는 동안 입력층이 매 프레임 다시 보낸다.
 */
export interface LeadCommand {
  /** 진행 방향 단위 벡터. 카메라가 회전하지 않으므로 화면 축 = 월드 축이다. */
  readonly dx: number;
  readonly dy: number;
  /** 0~1. 이 개체가 낼 수 있는 최대 속도의 몇 할로 밀 것인가. 0 이면 명령 없음과 같다. */
  readonly throttle: number;
  /**
   * "지금 문다"를 누르고 있는가(유지 입력). 방향과 같은 레벨 입력이라 프레임률·배속과 무관하다 —
   * 누르고 있으면 쿨다운이 도는 대로 계속 물고, 그 쿨다운은 AI 사냥이 쓰는 것과 **같은 값**이다.
   *
   * ⚠ 이 값은 "누구를 언제 물지"만 정한다. 사거리·판정·피해·쿨다운은 전부 AI 사냥 경로 그대로다
   *   (behavior.resolveBite 하나를 둘이 같이 부른다). 알파 전용 보너스가 붙는 순간 형질이 장식이 된다.
   *
   * 왜 선택 필드인가: 기존 호출부·테스트가 `{dx, dy, throttle}` 세 필드로 명령을 만든다. 없으면
   * "안 문다"로 읽히는데(아래 behavior 의 `bite === true` 게이트), 그게 안전한 기본값이고 무엇보다
   * **명령을 한 번도 안 준 세계가 기존과 1비트도 안 달라진다**는 보장을 그대로 지킨다.
   */
  readonly bite?: boolean;
  /**
   * 사냥 대상 지정(개체 id). 사람이 탭으로 "저 놈"을 잠갔을 때만 실린다. 없으면 자동 선택
   * (가장 가까운 물 수 있는 상대 — 기존 E 키 경로 그대로)이라, 기존 호출부는 아무것도 안 바뀐다.
   *
   * 방향·bite 와 같은 **레벨 입력**이다: 명령이 사는 동안 입력층이 매 프레임 다시 보내고,
   * sim 은 저장·기억하지 않는다(매 틱 미러만 — 다음 틱 명령에 없으면 그걸로 끝).
   * ⚠ 지정이 무효(죽음·범위 밖)면 자동으로 딴 놈을 무는 게 아니라 **아무도 안 겨눈다** —
   *   잠근 대상을 놓쳤는데 옆의 다른 개체를 무는 사고를 막는다(behavior.leadBiteTarget).
   */
  readonly targetId?: number;
}

/**
 * 알파 조종 상태. World 가 필드 하나로 들고 있다(World 생성자는 안 건드린다 = rng 소비 순서 불변).
 *
 * x·y·visionR·echoR·fx·fy·omni 는 **틱 시작에 한 번 굳히는 파생값**이다. 개체 루프 안에서 갱신하면
 * "몇 번째로 순회됐나"에 따라 이웃이 보는 값이 달라진다(숨은 순회 순서 의존 = 결정론 지뢰).
 *
 * 전부 런타임 전용 — 직렬화 안 함(entity.ts 의 관례와 같다). 저장·리플레이에 실릴 것은
 * LeadCommand(숫자 3개)뿐이다.
 */
export interface LeadState {
  /** 사람이 모는 개체 id. -1 = 알파 없음(= 기능이 아예 안 켜진 것). */
  leaderId: number;
  /** 이번 틱의 유지 입력. null 이거나 throttle 0 이면 개입 0 — 알파도 평범한 개체로 산다. */
  cmd: LeadCommand | null;
  /**
   * "최근에 조종 입력이 있었다"가 남아 있는 틱 수. 0 이면 무리 추종이 **아예 안 걸린다**.
   * ★ 이 필드는 아래 commanded 와 함께 결정론 보장을 떠받친다: 명령을 한 번도 안 받으면
   *   followTicks 는 영원히 0, commanded 는 영원히 false 다. 그래서 **sim 안에서 조종 때문에
   *   갈라지는 분기가 하나도 남지 않고**, 알파를 지정만 한 세계는 기존 세계와 부동소수점까지
   *   동일하다(게놈과 무관하게).
   * 매 틱 감소, 명령이 있는 틱마다 LEAD.followHoldTicks 로 재충전 →
   * 손가락을 떼도 잠깐은 무리가 따라와 대열이 딸꾹질하지 않는다.
   */
  followTicks: number;
  /**
   * "이 세계를 사람이 한 번이라도 몰았다." 끈끈한(sticky) 플래그 — 한 번 true 가 되면 다시 안 내려간다.
   * 첫 조종 입력(cmd.throttle > 0) 틱에 올라가고, 알파가 죽어 승계돼도 초기화하지 않는다
   * (사람이 이 세계를 이미 몰았다는 사실은 앞장선 개체가 바뀌어도 그대로다).
   *
   * 쓰는 곳은 보스의 수풀 엄폐 봉인 하나뿐이다(boss.bossCanHunt).
   * ★ followTicks 가 아니라 sticky 인 이유: 악용 수법이 "무리를 수풀에 몰아넣고 손 떼기"다.
   *   followTicks 로 걸면 손을 떼고 1.5초 뒤 엄폐가 되살아나 봉인이 반쯤 무의미해진다.
   *   sticky 면 한 번이라도 몰았으면 그 세계에선 엄폐가 끝까지 꺼지고, **한 번도 안 몰았으면
   *   기존과 완전히 동일**하다(알파를 지정만 한 세계의 부동소수점 동일성 보장). 두 요구를 동시에 만족한다.
   * ⚠ World 는 단계마다 새로 생기므로 이 값도 단계별로 리셋된다. 그건 의도다(안 몰면 예전 규칙 그대로).
   */
  commanded: boolean;
  /**
   * 이번 틱에 실제로 알파에게 끌린 개체 수(런타임 전용, 직렬화 안 함). HUD 의 "따르는 무리 N".
   * behavior 의 cohesion 블록이 `follow` 를 true 로 판정한 바로 그 자리에서 1 씩 더한다 —
   * 조건을 밖에서 다시 유도하지 않으므로 **정의상 규칙과 어긋날 수 없다**(도망 중 개체는 애초에
   * cohesion 블록에 못 들어오므로 자동으로 빠진다). 합계라 개체 순회 순서와 무관하다.
   * 매 틱 syncLeadStart 에서 0 으로 초기화한다.
   */
  followerCount: number;
  /**
   * 앞장선 자를 따라갈 때의 뭉침 가중치(×무리 성향). 기본값은 LEAD.followCohesion 이고,
   * 폰에서 `?follow=<수>` 로 덮어쓸 수 있다(배포를 다시 하지 않고 손끝 느낌을 튜닝하려고 — game 층이
   * 매 프레임 세팅한다). 형질이 규칙이라는 원칙은 이 값과 무관하다: 무리 성향 0 이면 곱해서 0 이다.
   */
  followWeight: number;
  /** 알파의 틱 시작 위치. 무리 추종·승계·안개가 전부 이 값을 본다. */
  x: number;
  y: number;
  /** 알파가 실제로 보는 반경(px) — behavior.visionRadius 와 같은 값(밤·수풀 감쇠 포함). 렌더 안개용. */
  visionR: number;
  /** 알파의 초음파 반경(px). 전방위. 렌더 안개용. */
  echoR: number;
  /** 진행 방향 단위 벡터(부채꼴 시야의 축). omni 면 안 쓴다. */
  fx: number;
  fy: number;
  /** 저속·정지라 부채꼴 대신 전방위로 보는 중인가(SIM.fovMinSpeed 이하). */
  omni: boolean;
  /** 알파가 바뀐 틱(승계 연출 신호). -1 = 아직 없음. world.events 를 안 늘려 렌더/테스트 기대치 불변. */
  changedTick: number;
  /**
   * **지금 노릴 수 있는 대상의 id.** -1 = 없음(= 보이는 데에 물릴 상대가 하나도 없다).
   *
   * 화면의 사냥 버튼이 켜지는 근거다. 범위는 **사정거리와 감지 범위 중 넓은 쪽**이라
   * "볼 수 있으면 노릴 수 있다"가 된다(시야 형질이 곧 사냥 가능 범위다). 사정거리만 보면 근접 종은
   * 버튼이 사실상 안 켜져 물기가 원거리 종 전용 기능이 돼 버린다(실측: 90초 동안 한 번도).
   * ⚠ **노린다 ≠ 문다.** 누르면 그 상대를 표적으로 붙들어 쫓고(AI 사냥과 같은 질주가 붙는다),
   *   실제 물기는 여전히 사정거리 안에서 같은 판정·같은 쿨다운으로만 일어난다.
   *
   * ⚠ 이 값은 실제 물기가 부르는 **바로 그 함수**에서 나온다. 버튼이 가리키는 대상과 실제로
   *   물리는 대상이 정의상 같아야 하기 때문이다(known_issues "화면에 뜨는 숫자를 규칙에서
   *   다시 유도하지 마라"). 화면의 호박빛 브래킷도 같은 뿌리(leadRelation)를 읽는다.
   *
   * 런타임 전용(직렬화 안 함). 매 틱 syncLeadStart 에서 갱신 — rng 미사용·개체 순회 순서 무관
   * (동률이면 작은 id 를 고르는 전순서라 답이 하나뿐이다).
   */
  biteTargetId: number;
  /**
   * 이번 틱 명령이 지정한 사냥 대상 id. -1 = 지정 없음(자동 선택).
   * syncLeadStart 가 매 틱 cmd.targetId 를 **미러링만** 한다 — sim 이 저장·기억하지 않으므로
   * (레벨 입력) 명령이 끊기면 다음 틱에 저절로 -1 로 돌아간다. leadBiteTarget 이 이 값을 읽어
   * 유효(생존 + 물 수 있거나 노릴 수 있는 관계 + 겨눔 범위 안)하면 그 개체만 겨누고, 무효면
   * 자동 대체 없이 null 을 낸다. 런타임 전용(직렬화 안 함).
   */
  orderTargetId: number;
}

export function createLeadState(): LeadState {
  return {
    leaderId: -1,
    cmd: null,
    followTicks: 0,
    commanded: false,
    followerCount: 0,
    followWeight: LEAD.followCohesion,
    x: 0,
    y: 0,
    visionR: 0,
    echoR: 0,
    fx: 1,
    fy: 0,
    omni: true,
    changedTick: -1,
    biteTargetId: -1,
    orderTargetId: -1,
  };
}

/**
 * 알파가 지금 이 지점을 감지하는가 — 전방위 초음파 원 또는 진행 방향 부채꼴 시야.
 * chooseGoal 이 먹이를 찾을 때 쓰는 판정과 같은 식이고, 화면의 안개 구멍도 이 식으로 뚫는다
 * (감지 범위 = 안개가 걷힌 범위. 어긋나면 화면이 거짓말이 된다).
 * 굳힌 스냅샷만 읽으므로 순수·순회 순서 무관·rng 미사용.
 */
export function leadSenses(L: LeadState, tx: number, ty: number): boolean {
  const dx = tx - L.x;
  const dy = ty - L.y;
  const d = Math.hypot(dx, dy);
  if (d <= L.echoR) return true;
  if (d > L.visionR) return false;
  if (L.omni || d < 1e-6) return true;
  return (L.fx * dx + L.fy * dy) / d >= SIM.fovHalfCos;
}
