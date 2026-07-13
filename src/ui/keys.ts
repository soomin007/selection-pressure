// 키보드 레이어 라우터 — 데스크톱 키보드 조작의 단일 진입점.
//
// 화면(레이어)마다 우선순위와 "지금 열려 있나"를 등록하면, keydown 마다 열려 있는 레이어 중
// 가장 위(우선순위 최대) 하나만 키를 받는다. 우선순위는 그 화면의 z-index 와 같은 값을 쓴다
// (눈에 보이는 최상단 화면 = 키를 받는 화면).
//
// 최상단 레이어가 처리하지 못한 키도 아래 레이어로 내려보내지 않는다 — 모달 뒤에 깔린 화면이
// 몰래 반응하는 사고(예: 보고서 화면 뒤 결과 화면이 Enter 로 새 런을 시작)를 원천 차단한다.

/** true 를 돌려주면 "이 키를 썼다"는 뜻 — 라우터가 preventDefault 를 건다(스크롤 등 기본 동작 차단). */
export type KeyHandler = (e: KeyboardEvent) => boolean;

interface KeyLayer {
  priority: number;
  isOpen: () => boolean;
  onKey: KeyHandler;
}

const layers: KeyLayer[] = [];
let installed = false;

export function registerKeyLayer(priority: number, isOpen: () => boolean, onKey: KeyHandler): void {
  layers.push({ priority, isOpen, onKey });
  layers.sort((a, b) => b.priority - a.priority);
  install();
}

function install(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    // 브라우저·OS 단축키(조합키)와 한글 IME 조합 중 입력은 건드리지 않는다.
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    // 마우스로 누른 버튼에 포커스가 남아 있으면 Enter/Space 가 그 버튼을 "한 번 더" 누른다
    // (이미 숨은 화면의 버튼일 수도 있다). 게임 키는 전부 여기서 라우팅하므로 포커스를 걷어낸다.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
    for (const layer of layers) {
      if (!layer.isOpen()) continue;
      if (layer.onKey(e)) e.preventDefault();
      return;
    }
  });
}

/**
 * 키 안내 칩(<kbd> 모양) — 버튼 옆에 붙여 "이 키로도 된다"를 알린다.
 * 모바일에선 CSS(.ui-kbd)가 통째로 숨긴다(키보드가 없으니 소음일 뿐).
 */
export function keyChip(label: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "ui-kbd";
  chip.textContent = label;
  return chip;
}
