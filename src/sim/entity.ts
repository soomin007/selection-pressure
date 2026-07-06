// 개체(Entity) — 한 마리. 어떤 종(Species)에 속하며, 게놈은 그 종이 공유한다.

import { cloneGenome, type Genome } from "@/sim/genome";
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
  // 목표를 쫓는데 거의 못 움직인 연속 틱 수(런타임, 직렬화 안 함). 물벽 등에 막혀 도달 불가한 먹이에
  // 억지로 들이대다 갇히는 것을 감지 — 임계를 넘으면 그 목표를 버리고 다른 먹이를 찾는다.
  stuckTicks: number;
  // 지형 경로 추종 (런타임, 직렬화 안 함). 목표가 직선으로 안 보일 때만 격자 BFS 경로를 따라간다.
  // path = 남은 웨이포인트 타일 인덱스(앞에서부터 소비). pathGoalTile = 이 경로의 목표 타일(-1=없음,
  // 목표 타일이 바뀌면 재계산). 직선으로 보이면 경로를 버리고 직진하므로 대부분 비어 있다.
  path: number[];
  pathGoalTile: number;
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
    // 초기 헤딩을 id 로 결정론적으로 분산(같은 시드면 동일). 처음 배회 때 방향이 한쪽으로 쏠리지 않게.
    wanderAngle: ((id % 360) * Math.PI) / 180,
    path: [],
    pathGoalTile: -1,
    poison: 0,
    stuckTicks: 0,
  };
}
