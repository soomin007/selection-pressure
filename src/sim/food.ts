// 먹이(Food) — 고정 위치(정적 맵). 먹히면 사라졌다가 일정 틱 뒤 다시 자란다.
// 종류(kind)가 있어 종마다 먹는 먹이가 다르다 → 먹이 경쟁을 분할해 여러 초식종이 공존한다.
// 위치·종류는 시드로 배치되므로 재현 가능. (절차 환경은 Phase 3)

export interface Food {
  x: number;
  y: number;
  kind: number; // 먹이 종류 (0..K-1). 종마다 먹을 수 있는 종류가 다르다.
  available: boolean;
  regrowTimer: number; // available=false 일 때 남은 재생 틱
  aquatic: boolean; // true = 바다 먹이(수영 형질이 충분한 종만 먹는다). false = 육지 식물.
  mountainous: boolean; // true = 고산 먹이(날개 형질이 충분한 종만 먹는다 — 산 위 무경쟁 틈새). 바다 먹이의 하늘 대칭.
  deep: boolean; // true = 깊은 바다 먹이(물 전용 종=진짜 물고기만 먹는다). 얕은 바다(양용 종도 먹음)와 분리된 물고기 전용 틈새.
}

export function createFood(
  x: number,
  y: number,
  kind: number,
  aquatic = false,
  mountainous = false,
  deep = false,
): Food {
  return { x, y, kind, available: true, regrowTimer: 0, aquatic, mountainous, deep };
}
