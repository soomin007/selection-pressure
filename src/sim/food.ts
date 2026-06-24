// 먹이(Food) — 고정 위치(정적 맵). 먹히면 사라졌다가 일정 틱 뒤 다시 자란다.
// 위치는 시드로 배치되므로 재현 가능. (절차 환경은 Phase 3)

export interface Food {
  x: number;
  y: number;
  available: boolean;
  regrowTimer: number; // available=false 일 때 남은 재생 틱
}

export function createFood(x: number, y: number): Food {
  return { x, y, available: true, regrowTimer: 0 };
}
