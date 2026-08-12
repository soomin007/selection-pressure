// 로비/타이틀 화면. 뒤에서는 배경 생태계가 잔잔히 돌아간다(Game 로비 단계).
// 도전 과제로 연 꾸밈을 여기서 하나 고른다(효과 없음 — 보이는 것만 바뀐다). 해금 사다리도 여기서 연다.

import { ensurePanelStyles } from "@/ui/panelStyles";
import { registerKeyLayer, keyChip } from "@/ui/keys";
import { createCosmeticPicker } from "@/ui/cosmeticPicker";

export interface Lobby {
  show: () => void;
  hide: () => void;
}

export function createLobby(
  onStart: () => void,
  onGlossary: () => void,
  onCosmetic: () => void,
  onLadder: () => void,
  /** 저장 데이터(레벨·해금·도전 과제·챔피언)를 전부 지운다. 두 번 눌러야 실행된다. */
  onResetData: () => void,
): Lobby {
  ensurePanelStyles();

  const root = document.createElement("div");
  root.className = "lobby-root";

  const title = document.createElement("div");
  title.className = "lobby-title";
  title.textContent = "적자생존";

  const sub = document.createElement("div");
  sub.className = "lobby-sub";
  sub.textContent = "한 종을 길러 생태계의 정점에 올리세요.";

  const start = document.createElement("button");
  start.className = "lobby-start";
  start.textContent = "게임 시작";
  start.appendChild(keyChip("Enter"));
  start.addEventListener("click", onStart);

  // 보조 버튼 줄 — 대백과 + 해금 사다리(투명 배경 + 호박빛 밑줄, 핸드오프 §4 보조 버튼).
  const secondaryRow = document.createElement("div");
  secondaryRow.style.cssText = "display:flex; gap:18px; margin-top:8px;";
  const linkBtn = (text: string, cb: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText =
      "padding:6px 4px 3px; border:0; background:transparent;" +
      "color:var(--ink); font-family:var(--font-body); font-size:14px; cursor:pointer;" +
      "border-bottom:1.5px solid var(--amber);";
    b.addEventListener("click", cb);
    return b;
  };
  const glossaryBtn = linkBtn("대백과", onGlossary);
  glossaryBtn.appendChild(keyChip("G"));
  const ladderBtn = linkBtn("열리는 것들", onLadder);
  ladderBtn.appendChild(keyChip("L"));
  secondaryRow.append(glossaryBtn, ladderBtn);

  // 키보드 조작 · 로비가 보일 때만. 대백과·해금 오버레이가 열리면 그쪽(높은 우선순위)이 키를 가져간다.
  registerKeyLayer(
    5,
    () => root.style.display !== "none",
    (e) => {
      if (e.repeat) return false;
      switch (e.code) {
        case "Enter":
        case "NumpadEnter":
          onStart();
          return true;
        case "KeyG":
          onGlossary();
          return true;
        case "KeyL":
          onLadder();
          return true;
        default:
          return false;
      }
    },
  );

  const hint = document.createElement("div");
  hint.className = "lobby-hint";
  // 첫 화면은 지금 게임을 소개해야 한다. 예전 문구("무리가 살아남는 것을 지켜보세요")는 조작이 없던
  // 관전형 시절의 것이라, 탭으로 이끄는 지금 게임과 어긋나 있었다(2026-08-03 정정).
  hint.textContent = "탭으로 우두머리를 이끌고, 라운드마다 닥치는 시련을 넘으세요.";

  // 꾸밈 고르기 — 재사용 컴포넌트. 하나도 안 열렸으면 스스로 숨는다(첫 판 화면을 안 어지럽힌다).
  const cosmetics = createCosmeticPicker(onCosmetic);
  cosmetics.el.style.marginTop = "16px";

  // 저장 데이터 지우기 · 되돌릴 수 없으므로 **두 번 눌러야** 실행된다(브라우저 확인창은 폰에서
  // 흐름을 끊고 자동 검증도 막으므로 안 쓴다). 다른 곳으로 갔다 오면 확인 상태는 풀린다.
  const RESET_IDLE = "저장 데이터 지우기";
  const RESET_ARMED = "정말 지울까요? 한 번 더 누르면 지워집니다";
  const resetBtn = document.createElement("button");
  resetBtn.className = "lobby-reset";
  resetBtn.textContent = RESET_IDLE;
  let armed = false;
  const disarm = (): void => {
    armed = false;
    resetBtn.textContent = RESET_IDLE;
    resetBtn.classList.remove("armed");
  };
  resetBtn.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      resetBtn.textContent = RESET_ARMED;
      resetBtn.classList.add("armed");
      return;
    }
    disarm();
    onResetData();
    resetBtn.textContent = "지웠습니다. 첫 플레이 상태입니다.";
    setTimeout(disarm, 2600);
  });

  root.append(title, sub, start, secondaryRow, cosmetics.el, hint, resetBtn);
  document.body.appendChild(root);

  return {
    show: () => {
      cosmetics.refresh(); // 방금 딴 꾸밈이 바로 보이게 열 때마다 다시 읽는다
      disarm(); // 지우기 확인 상태는 로비를 다시 열 때마다 푼다(실수로 두 번째 탭이 눌리지 않게)
      root.style.display = "flex";
      // 타이틀 화면에선 ?dev 패널을 숨긴다(첫 화면이 개발용 버튼으로 어지럽지 않게 — panelStyles 규칙).
      document.body.classList.add("lobby-open");
    },
    hide: () => {
      root.style.display = "none";
      document.body.classList.remove("lobby-open");
    },
  };
}
