// 먹이(Food) — 고정 위치(정적 맵). 먹히면 사라졌다가 일정 틱 뒤 다시 자란다.
// 종류(kind)가 있어 종마다 먹는 먹이가 다르다 → 먹이 경쟁을 분할해 여러 초식종이 공존한다.
// 위치·종류는 시드로 배치되므로 재현 가능. (절차 환경은 Phase 3)

export interface Food {
  x: number;
  y: number;
  kind: number; // 먹이 종류 (0..K-1). 종마다 먹을 수 있는 종류가 다르다.
  available: boolean;
  regrowTimer: number; // available=false 일 때 남은 재생 틱
}

export function createFood(x: number, y: number, kind: number): Food {
  return { x, y, kind, available: true, regrowTimer: 0 };
}
