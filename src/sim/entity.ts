// 개체(Entity) — 한 마리. 어떤 종(Species)에 속하며, 게놈은 그 종이 공유한다.

import { cloneGenome, type Genome } from "@/sim/genome";
import { hash01 } from "@/sim/rng";
import type { Species } from "@/sim/species";
import type { Food } from "@/sim/food";

export interface Entity {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  age: number; // 살아온 틱 수
  species: Species; // 소속 종
  genome: Genome; // 내 종은 태어난 시점의 스냅샷(세대별 형질), 야생은 species.genome 공유
  alive: boolean;
  // 직전 스텝의 위치 (렌더 보간용, 직렬화 안 함). sim 은 30/s, 화면은 60fps → 그 사이를 메운다.
  prevX: number;
  prevY: number;
  // 쫓는 목표 (런타임 상태, 직렬화 안 함). 매 틱 재탐색 대신 commit 을 유지해 목표 진동을 없앤다.
  targetFood: Food | null;
  targetPrey: Entity | null;
  // 배회(wander) 헤딩 (런타임, 직렬화 안 함). 매 틱 방향을 새로 추첨하면 제자리 떨림이 되므로,
  // 헤딩을 개체에 보존하고 조금씩만 흔들어 부드럽게 떠돈다.
  wanderAngle: number;
  // 누적 독 피해 풀(런타임, 직렬화 안 함). 독을 지닌 먹이를 잡아먹으면 그 포식자가 중독돼 쌓이고,
  // 매 틱 에너지를 깎으며 소진된다(방어 독 — 독먹이를 삼키면 되갚음). 독개구리·독뱀 같은 포식 방어.
  poison: number;
  // 다음 물기까지 남은 틱(런타임, 직렬화 안 함). 사거리에 닿아도 이게 0 이어야 한 번 문다.
  // 없으면 매 틱 판정이 굴러 접촉 즉시 즉사한다.
  attackCd: number;
  // 물린 뒤 남은 "부상" 틱(런타임, 직렬화 안 함). 이게 살아 있는 동안 기운이 다하면 사망 원인이
  // 굶주림이 아니라 **부상**이다 — 물려서 약해진 채 도망치다 쓰러진 것이지 못 먹어서 죽은 게 아니다.
  woundTicks: number;
  // 목표를 쫓는데 거의 못 움직인 연속 틱 수(런타임, 직렬화 안 함). 물벽 등에 막혀 도달 불가한 먹이에
  // 억지로 들이대다 갇히는 것을 감지 — 임계를 넘으면 그 목표를 버리고 다른 먹이를 찾는다.
  stuckTicks: number;
  // 지형 경로 추종 (런타임, 직렬화 안 함). 목표가 직선으로 안 보일 때만 격자 BFS 경로를 따라간다.
  // path = 남은 웨이포인트 타일 인덱스(앞에서부터 소비). pathGoalTile = 이 경로의 목표 타일(-1=없음,
  // 목표 타일이 바뀌면 재계산). 직선으로 보이면 경로를 버리고 직진하므로 대부분 비어 있다.
  path: number[];
  pathGoalTile: number;
  // 지금 보스에 맞설 수 있는가(런타임, 직렬화 안 함). sim 이 매 틱 판정해 여기 남긴다 · 렌더가 매
  // 프레임 isRaidFighter 를 다시 부르면 폰 프레임이 죽고, 조건을 밖에서 다시 유도하면 화면과 실제가
  // 갈린다. 보스가 없으면 늘 false(world.step 이 매 틱 끈다).
  // ⚠ 2026-08-04 현재 **프로덕션에서 이 필드를 읽는 곳이 없다**(테스트만 읽는다). worldView 가
  //   전사 표식을 그릴 때 아직 isRaidFighter 를 매 프레임 다시 부른다 → 렌더를 이 필드로 갈아타든지
  //   이 필드를 지우든지 둘 중 하나로 정리할 것. 지금은 두 계산이 나란히 돈다.
  raidFighter: boolean;
  // 다음 반격까지 남은 틱(런타임, 직렬화 안 함). 이게 0 이어야 근접 전사가 한 번 되받아친다.
  // 없으면 떼 한복판에 선 한 마리가 매 틱 깎아 격퇴가 접촉 면적에 지배당한다(전부 아니면 전무).
  raidCounterCd: number;
  // 지금 도망 중인가(런타임, 직렬화 안 함). `stepEntity` 가 매 틱 판정해 여기 남긴다 — `raidFighter` 와
  // 같은 패턴이다. 조건부 특성(`sim/perks.ts`)의 「달아나는 동안」이 이 값을 읽는다.
  //
  // ⚠ **다른 개체가 읽는다는 것이 이 필드의 존재 이유다.** 「달아나는 등」(물릴 때 버티는 힘이 오른다)은
  //   물린 쪽의 도망 여부를 문 쪽의 판정 안에서 물어야 하는데, 그건 그 개체의 stepEntity 밖이라
  //   지역 변수로는 닿을 수 없다. 자기 자신이 읽을 때는 **한 틱 전 값**이다(아래 주석 참조).
  fleeing: boolean;
  // 3×3 칸의 이웃 수(자기 포함 · 런타임, 직렬화 안 함). 위와 같은 이유로 개체에 남긴다.
  // 이웃 정보를 안 만드는 종(무리 성향 0)은 1 로 남는다 = 「혼자」.
  neighbors: number;
}

export function createEntity(
  id: number,
  x: number,
  y: number,
  species: Species,
  energy: number,
  // 번식 시 개체별 진화 — 부모에서 변이시킨 게놈을 넘긴다(넘기면 이 게놈을 그대로 소유). 없으면 종 기준선.
  genomeOverride?: Genome,
): Entity {
  return {
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    energy,
    age: 0,
    species,
    // 번식으로 부모 게놈(변이본)을 받으면 그걸 소유. 아니면 내 종은 종 기준선을 복사(초기 무리·보충),
    // 야생은 종 게놈을 공유(종 전체가 함께 진화).
    genome: genomeOverride ?? (species.isPlayer ? cloneGenome(species.genome) : species.genome),
    alive: true,
    prevX: x,
    prevY: y,
    targetFood: null,
    targetPrey: null,
    // 초기 헤딩: id 정수 해시로 [0, 2π) 에 고르게 분산(rng 미소비·같은 시드면 동일).
    // ⚠ 예전엔 (id % 360)° 라 연속 id 개체들이 1도씩만 달랐다(초기 18마리가 0°~17°).
    //   "분산"이라던 주석이 거짓이었고, 무리가 한 덩어리로 같은 경로를 돌았다(2026-08-05 수정).
    wanderAngle: hash01(id) * Math.PI * 2,
    path: [],
    pathGoalTile: -1,
    poison: 0,
    attackCd: 0,
    woundTicks: 0,
    stuckTicks: 0,
    raidFighter: false,
    raidCounterCd: 0,
    fleeing: false,
    neighbors: 1,
  };
}
