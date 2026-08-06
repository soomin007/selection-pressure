// 명령 휠 · 현재 명령 줄 — **[사용자 2026-08-06]** 조작 다양화 지시의 화면 쪽.
//
// 원문: "조작도 탭으로 이동 명령 하나만 두지 말고, 꾹 눌러서 뭐 여러 개의 명령 휠에서 하나를 정하게
// 한다든가, 더블탭으로 회피 명령이라든가 하는 식으로 좀 다양하게 하고, 이전에 내린 명령 취소 혹은
// 철회 기능도 만들어줘."
//
// 이 파일이 지키는 두 가지:
//  ① **한 손으로 끝난다.** 누른 채 밀어서 고르고 떼면 실행된다. 손가락을 뗐다가 다시 짚는 동작이 없다.
//  ② **못 여는 칸이 보인다.** 잠긴 칸을 감추지 않고 회색으로 그린다 — 그래야 "무리 3단이 되면 원진이
//     열린다"를 대백과가 아니라 **손에서** 알게 된다(CLAUDE.md 전달 규칙). 성장이 손끝에서 읽히는 자리다.
//
// ⚠ 스타일을 인라인으로 두는 것은 의도다. 이 조각은 캔버스 위에 잠깐 떴다 사라지는 손끝 UI라
//   panelStyles 의 패널 문법(테두리·헤더·스크롤)과 성격이 다르고, 거기 섞으면 패널 규칙이 흐려진다.

import type { OrderKind, OrderSpec } from "@/sim/herdOrder";

export interface WheelSlot {
  spec: OrderSpec;
  unlocked: boolean;
  /** 남은 쿨타임(틱). 0 이면 지금 쓸 수 있다. */
  cdLeft: number;
}

export interface CommandWheelHandlers {
  /** 휠에서 하나를 골라 손을 뗐다. 월드 좌표는 휠을 연 그 자리다. */
  onPick: (kind: OrderKind, wx: number, wy: number) => void;
}

const RADIUS = 78; // 휠 반지름(px) — 엄지 한 뼘 안. 폰 실기로 조절할 값이다.
const SLOT = 46; // 칸 지름(px) · 손끝 최소 터치 44px 보다 조금 크게

/**
 * 명령 휠. `open()` 으로 그 자리에 띄우고, `moveTo()` 로 손가락을 따라가며 고르고, `close()` 로 실행한다.
 * 화면 좌표(px)로 그리고, 실행할 때 넘길 월드 좌표는 연 쪽이 들고 있다가 그대로 돌려준다.
 */
export class CommandWheel {
  private readonly root: HTMLDivElement;
  private readonly slots: HTMLDivElement[] = [];
  private items: WheelSlot[] = [];
  private hover = -1;
  private cx = 0;
  private cy = 0;
  private wx = 0;
  private wy = 0;
  private open_ = false;

  constructor(
    parent: HTMLElement,
    private readonly handlers: CommandWheelHandlers,
  ) {
    this.root = document.createElement("div");
    this.root.style.cssText = [
      "position:fixed",
      "left:0;top:0",
      "pointer-events:none",
      "z-index:70",
      "display:none",
      "font-family:inherit",
    ].join(";");
    parent.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /**
   * 휠을 연다. `sx,sy` 는 손가락이 있는 화면 좌표, `wx,wy` 는 그 자리의 월드 좌표.
   * 칸이 하나(가라)뿐이면 열지 않는다 — 고를 것이 없는 휠은 방해일 뿐이다.
   */
  open(sx: number, sy: number, wx: number, wy: number, items: WheelSlot[]): boolean {
    if (items.length <= 1) return false;
    this.items = items;
    this.cx = sx;
    this.cy = sy;
    this.wx = wx;
    this.wy = wy;
    this.hover = -1;
    this.root.replaceChildren();
    this.slots.length = 0;

    const n = items.length;
    for (let i = 0; i < n; i++) {
      const it = items[i] as WheelSlot;
      // 12시부터 시계 방향. 「가라」가 늘 12시라 손이 위치를 외운다.
      const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const x = sx + Math.cos(ang) * RADIUS;
      const y = sy + Math.sin(ang) * RADIUS;
      const el = document.createElement("div");
      const ready = it.unlocked && it.cdLeft <= 0;
      el.style.cssText = [
        "position:absolute",
        `left:${Math.round(x - SLOT / 2)}px`,
        `top:${Math.round(y - SLOT / 2)}px`,
        `width:${SLOT}px;height:${SLOT}px`,
        "border-radius:50%",
        "display:flex;align-items:center;justify-content:center",
        "font-size:13px;font-weight:700;letter-spacing:-0.02em",
        ready ? "color:#f2f6f2" : "color:#7d8a7d",
        ready ? "background:rgba(24,34,26,0.92)" : "background:rgba(18,22,19,0.82)",
        ready ? "border:2px solid #8fd14f" : "border:2px solid #3a463c",
        "box-shadow:0 2px 10px rgba(0,0,0,0.45)",
        "transition:transform 90ms ease",
      ].join(";");
      el.textContent = it.spec.label;
      this.root.appendChild(el);
      this.slots.push(el);
    }

    // 가운데 설명 줄 — 지금 고르고 있는 것이 무엇을 하는지, 잠겼으면 **무엇을 하면 열리는지**.
    const hint = document.createElement("div");
    hint.dataset["role"] = "hint";
    hint.style.cssText = [
      "position:absolute",
      `left:${Math.round(sx - 110)}px`,
      `top:${Math.round(sy - 13)}px`,
      "width:220px",
      "text-align:center",
      "font-size:12px;line-height:1.35",
      "color:#cfe0cf",
      "text-shadow:0 1px 3px rgba(0,0,0,0.9)",
    ].join(";");
    hint.textContent = "밀어서 고르고 떼면 실행됩니다";
    this.root.appendChild(hint);

    this.root.style.display = "block";
    this.open_ = true;
    return true;
  }

  /** 손가락이 움직였다 — 가장 가까운 칸을 고른다. 가운데 근처면 아무것도 안 고른 상태(취소). */
  moveTo(sx: number, sy: number): void {
    if (!this.open_) return;
    const dx = sx - this.cx;
    const dy = sy - this.cy;
    const d = Math.hypot(dx, dy);
    let idx = -1;
    if (d > RADIUS * 0.42) {
      const n = this.items.length;
      // 각도를 칸 수로 나눠 가장 가까운 칸. 12시가 0번.
      const ang = Math.atan2(dy, dx) + Math.PI / 2;
      const norm = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      idx = Math.round((norm / (Math.PI * 2)) * n) % n;
    }
    if (idx === this.hover) return;
    this.hover = idx;
    for (let i = 0; i < this.slots.length; i++) {
      const el = this.slots[i] as HTMLDivElement;
      el.style.transform = i === idx ? "scale(1.18)" : "scale(1)";
    }
    const hint = this.root.querySelector<HTMLDivElement>('[data-role="hint"]');
    if (hint) {
      if (idx < 0) hint.textContent = "밀어서 고르고 떼면 실행됩니다";
      else {
        const it = this.items[idx] as WheelSlot;
        if (!it.unlocked) hint.textContent = it.spec.hint;
        else if (it.cdLeft > 0) hint.textContent = "아직 숨을 고르는 중입니다";
        else hint.textContent = it.spec.desc;
      }
    }
  }

  /** 손을 뗐다 — 고르고 있던 칸을 실행한다. 아무것도 안 골랐거나 잠긴 칸이면 그냥 닫힌다. */
  close(): void {
    if (!this.open_) return;
    const idx = this.hover;
    this.open_ = false;
    this.root.style.display = "none";
    if (idx < 0) return;
    const it = this.items[idx];
    if (!it || !it.unlocked || it.cdLeft > 0) return;
    this.handlers.onPick(it.spec.kind, this.wx, this.wy);
  }

  /** 실행하지 않고 닫는다(드래프트가 열리는 등 바깥 사정). */
  cancel(): void {
    this.open_ = false;
    this.hover = -1;
    this.root.style.display = "none";
  }
}

/**
 * **현재 명령 한 줄.** 철회하려면 먼저 무엇이 걸려 있는지 화면에 있어야 한다 — 뭐가 걸렸는지 안 보이면
 * 취소할 것도 없다. 그 줄을 탭하면 철회되고 무리는 자율로 돌아간다(**[사용자 2026-08-06]**).
 */
export class OrderLine {
  private readonly el: HTMLButtonElement;
  private shown = "";

  constructor(parent: HTMLElement, onCancel: () => void) {
    this.el = document.createElement("button");
    this.el.type = "button";
    this.el.style.cssText = [
      "position:fixed",
      "left:50%",
      "transform:translateX(-50%)",
      "bottom:96px",
      "z-index:55",
      "display:none",
      "align-items:center;gap:8px",
      "padding:6px 12px",
      "border-radius:999px",
      "border:1px solid rgba(143,209,79,0.55)",
      "background:rgba(18,26,20,0.88)",
      "color:#dfeadf",
      "font-size:12px;font-family:inherit;letter-spacing:-0.01em",
      "box-shadow:0 2px 10px rgba(0,0,0,0.4)",
      "cursor:pointer",
    ].join(";");
    this.el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onCancel();
    });
    parent.appendChild(this.el);
  }

  /** 걸린 명령을 보여준다. `null` 이면 줄을 감춘다. */
  set(label: string | null): void {
    if (label === null) {
      if (this.shown !== "") {
        this.shown = "";
        this.el.style.display = "none";
      }
      return;
    }
    if (label === this.shown) return;
    this.shown = label;
    this.el.textContent = `${label} · 눌러서 철회`;
    this.el.style.display = "flex";
  }
}
