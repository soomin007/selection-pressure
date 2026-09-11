// 감독 패널 — 왼쪽 상시 열: **일정표**(위) + **지침 시트**(아래) + 작전타임 버튼.
// (**[사용자 2026-09-11]** 감독형 전환 · 계약은 docs/design/manager_instructions.md 4절)
//
// 이 파일은 그리기만 한다. 일정표는 game.schedule(파생 getter), 발동 수는 world.sheetFired(판정 자리에서
// 센 값)를 **읽기만** 하고, 여기서 규칙을 다시 유도하지 않는다(known_issues 「화면에 뜨는 숫자를 규칙에서
// 다시 유도하지 마라」). 지침 편집은 game.setSheet 한 문으로만 들어간다 · 세계가 서 있을 때만 열린다.
//
// 문장 틀은 하나다: 「[누가] [어떤 때] [무엇을 한다]」. 칸을 누르면 그 칸에 들어갈 단어 목록이 뜬다
// (황금 우상의 단어 은행 · 끌어 넣기는 다음 조각). 줄마다 이번 틱 발동 수가 붙어 「어느 줄이 지금
// 움직이고 있나」가 화면에서 읽힌다(Unicorn Overlord 의 불만 · 「이빨 1인데 보스가 왜 죽었지」의 답).
//
// ⚠ 이 CSS 는 템플릿 리터럴 안이다 · 주석에 백틱을 쓰지 말 것(known_issues 2026-08-10).
// ⚠ 데스크톱 확대(--ui-zoom)는 body 직속 규칙(panelStyles)이 건다 · 여기서 vh/vw 를 쓰지 않는다.

import { ensurePanelStyles } from "@/ui/panelStyles";
import { registerKeyLayer } from "@/ui/keys";
import type { ScheduleEntry } from "@/game/game";
import {
  ACT_INFO,
  FINAL_DIRECTIVE,
  WHEN_KEYS,
  WHO_INFO,
  WHO_KEYS,
  whenLabel,
  type Act,
  type Directive,
  type Who,
} from "@/sim/instructions";
import type { PerkWhen } from "@/sim/perks";

/** 왼쪽 열의 폭(CSS px · 확대 전). goalBar·내 형질 패널이 데스크톱에서 이만큼 비켜 선다(main · buildPanel). */
export const MANAGER_COLUMN_PX = 272;
/** 열의 왼쪽 여백 + 폭 + 오른쪽 여백 = 다른 HUD 가 시작하는 x. */
export const MANAGER_COLUMN_RESERVE_PX = 8 + MANAGER_COLUMN_PX + 12;

const Z = 11; // goalBar(9) 위 · 드래프트(15)·구입(16) 아래

export interface ManagerCallbacks {
  /** 작전타임 부르기(관전 중 · 예산이 남았을 때). */
  onTimeout: () => void;
  /** 작전타임 끝 · 경기 재개. */
  onResume: () => void;
  /** 지침이 바뀌었다 · game.setSheet 로 넘어간다(거절되면 다음 프레임에 원래 시트로 되돌아온다). */
  onSheetChange: (rows: Directive[]) => void;
}

export interface ManagerData {
  /** 런 중인가(관전·작전타임·구입). 드래프트·결과·로비에서는 숨긴다. */
  visible: boolean;
  eraLabel: string;
  schedule: readonly ScheduleEntry[];
  sheet: readonly Directive[];
  maxRows: number;
  /** 줄별 발동 수 · 길이 = sheet.length + 1(마지막 = 「알아서」 고정 줄). */
  fired: readonly number[];
  /** 본능(도망·사냥·금빛)이 이동을 가져간 수. */
  instinct: number;
  /** 지금 지침을 고칠 수 있는가(세계가 서 있는가). */
  canEdit: boolean;
  /** 지금 열쇠로 쓸 수 있는 「무엇을」 단어(없는 열쇠의 단어는 목록에 안 뜬다). */
  acts: readonly Act[];
  /** 작전타임 중인가. */
  inTimeout: boolean;
  /** 작전타임이 위협 시작의 자동 작전타임인가. */
  timeoutIsAuto: boolean;
  /** 남은 호출 작전타임 수. */
  timeoutsLeft: number;
  /** 지금 위협 문구(자동 작전타임의 머리말 · 없으면 빈 문자열). */
  threatText: string;
}

export interface ManagerPanel {
  update: (d: ManagerData) => void;
  /** 단어 목록이 떠 있는가(키 라우팅용). */
  isPicking: () => boolean;
  /** 폰: 접힌 상태 토글. 데스크톱에서는 아무 일도 안 한다. */
  toggleCollapsed: () => void;
  root: HTMLElement;
}

type Slot = "who" | "when" | "act";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function setText(n: HTMLElement, t: string): void {
  if (n.textContent !== t) n.textContent = t;
}

function slotLabel(slot: Slot, d: Directive): string {
  return slot === "who" ? WHO_INFO[d.who].label : slot === "when" ? whenLabel(d.when) : ACT_INFO[d.act].label;
}

export function createManagerPanel(cb: ManagerCallbacks): ManagerPanel {
  ensurePanelStyles();
  ensureManagerStyles();
  const isDesktop = document.body?.dataset.layout === "desktop";

  const root = el("div", "mgr-root");
  root.dataset["layout"] = isDesktop ? "desktop" : "mobile";
  root.style.display = "none";

  // ── 일정표 ──
  const schedCard = el("section", "mgr-card mgr-sched");
  const schedHead = el("div", "mgr-head");
  const schedTitle = el("div", "mgr-title", "일정표");
  const schedEra = el("div", "mgr-era", "");
  schedHead.append(schedTitle, schedEra);
  const track = el("div", "mgr-track");
  const cells: { root: HTMLElement; num: HTMLElement; label: HTMLElement; sub: HTMLElement; bar: HTMLElement }[] = [];
  // 지금 단계의 위협 이름은 칸이 좁아(여섯 칸) 칸 밑 한 줄로 뺀다 · 칸에 넣으면 옆 칸을 침범한다(겹침 검사 실측).
  const nowLine = el("div", "mgr-now", "");
  nowLine.style.display = "none";
  schedCard.append(schedHead, track, nowLine);

  // ── 지침 시트 ──
  const sheetCard = el("section", "mgr-card mgr-sheet");
  const sheetHead = el("div", "mgr-head");
  const sheetTitle = el("div", "mgr-title", "지침");
  const timeoutBtn = el("button", "mgr-timeout", "작전타임");
  timeoutBtn.type = "button";
  sheetHead.append(sheetTitle, timeoutBtn);
  const note = el("div", "mgr-note", "");
  const rowsBox = el("div", "mgr-rows");
  const finalRow = el("div", "mgr-row final");
  const finalWords = el("div", "mgr-words");
  for (const slot of ["who", "when", "act"] as const) {
    const w = el("span", `mgr-word ${slot} fixed`, slotLabel(slot, FINAL_DIRECTIVE));
    finalWords.append(w);
  }
  const finalCount = el("span", "mgr-count", "");
  finalRow.append(finalWords, finalCount);
  const addBtn = el("button", "mgr-add", "+ 줄 추가");
  addBtn.type = "button";
  const instinctLine = el("div", "mgr-instinct", "");
  sheetCard.append(sheetHead, note, rowsBox, finalRow, addBtn, instinctLine);

  // ── 단어 목록(팝오버) ──
  const picker = el("div", "mgr-picker");
  picker.style.display = "none";

  // 폰: 접기 손잡이
  const handle = el("button", "mgr-handle", "지침 ▴");
  handle.type = "button";

  root.append(schedCard, sheetCard, picker);
  if (!isDesktop) root.append(handle);
  document.body.appendChild(root);

  // ── 작전타임 베일 · 세계 위를 덮는다(왼쪽 열은 그 위에 남는다) ──
  // **[사용자 2026-09-12]** "보스나 대멸종 직전에 작전타임 걸렸을 때 그게 작전타임 때문이라는 걸 좀 더 직관적으로
  // 알 수 있게 · 지금은 그냥 갑자기 게임이 버그로 얼어서 죽어버린 느낌". 스포츠 중계의 TIMEOUT 자막 · 풋볼 매니저의
  // 하프타임 화면처럼 **화면이 통째로 상태를 바꿔야** 멈춤이 의도라는 것이 읽힌다. 세계를 어둡게 덮고, 한가운데에
  // 「작전타임」과 이유, 큰 「경기 재개」를 둔다. 왼쪽 열(z 11)은 베일(z 10) 위라 지침을 고칠 수 있다.
  const veil = el("div", "mgr-veil");
  veil.style.display = "none";
  const veilBox = el("div", "mgr-veil-box");
  const veilKicker = el("div", "mgr-veil-kicker", "작전타임");
  const veilTitle = el("div", "mgr-veil-title", "");
  const veilSub = el("div", "mgr-veil-sub", "");
  const veilBtn = el("button", "mgr-veil-btn", "경기 재개");
  veilBtn.type = "button";
  const veilHint = el("div", "mgr-veil-hint", isDesktop ? "Enter 로도 재개합니다 · 지침은 왼쪽에서 고칩니다" : "지침은 아래 서랍에서 고칩니다");
  veilBox.append(veilKicker, veilTitle, veilSub, veilBtn, veilHint);
  veil.append(veilBox);
  document.body.appendChild(veil);
  veilBtn.addEventListener("click", () => cb.onResume());

  // ── 상태 ──
  let last: ManagerData | null = null;
  let rowSig = "";
  let picking: { row: number; slot: Slot } | null = null;
  let collapsed = !isDesktop;
  if (collapsed) root.classList.add("collapsed");

  const rowEls: { root: HTMLElement; words: Record<Slot, HTMLButtonElement>; count: HTMLElement; up: HTMLButtonElement; down: HTMLButtonElement; del: HTMLButtonElement }[] = [];

  function closePicker(): void {
    picking = null;
    picker.style.display = "none";
    picker.replaceChildren();
  }

  function emit(rows: Directive[]): void {
    closePicker();
    cb.onSheetChange(rows);
  }

  function currentRows(): Directive[] {
    return (last?.sheet ?? []).map((d) => ({ ...d }));
  }

  function openPicker(row: number, slot: Slot, anchor: HTMLElement): void {
    if (last === null || !last.canEdit) return;
    if (picking !== null && picking.row === row && picking.slot === slot) {
      closePicker();
      return;
    }
    picking = { row, slot };
    picker.replaceChildren();
    const title = el("div", "mgr-picker-title", slot === "who" ? "누가" : slot === "when" ? "어떤 때" : "무엇을 한다");
    picker.append(title);
    const cur = last.sheet[row];
    const keys: readonly string[] = slot === "who" ? WHO_KEYS : slot === "when" ? WHEN_KEYS : last.acts;
    for (const k of keys) {
      const b = el("button", "mgr-pick");
      b.type = "button";
      const label = slot === "who" ? WHO_INFO[k as Who].label : slot === "when" ? whenLabel(k as PerkWhen) : ACT_INFO[k as Act].label;
      const desc = slot === "who" ? WHO_INFO[k as Who].desc : slot === "act" ? ACT_INFO[k as Act].desc : "";
      const l = el("span", "mgr-pick-label", label);
      b.append(l);
      if (desc) b.append(el("span", "mgr-pick-desc", desc));
      const selected = cur !== undefined && (cur as unknown as Record<Slot, string>)[slot] === k;
      if (selected) b.classList.add("on");
      b.addEventListener("click", () => {
        const rows = currentRows();
        const r = rows[row];
        if (r === undefined) return;
        if (slot === "who") r.who = k as Who;
        else if (slot === "when") r.when = k as PerkWhen;
        else r.act = k as Act;
        emit(rows);
      });
      picker.append(b);
    }
    // 팝오버 자리: 누른 칸 바로 아래(패널 좌표계). 아래에 자리가 모자라면 **칸 위로** 연다 · 폰 서랍은
    // 화면 아래에 붙어 있어 아래로 열면 목록이 화면 밖으로 나간다(2026-09-11 겹침 스크린샷에서 확인).
    const rr = root.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    // zoom 아래에서 getBoundingClientRect 는 확대된 CSS px 를 돌려준다 · 패널 안 좌표도 같은 배율이라 비율로 옮긴다.
    const zoom = rr.width > 0 ? rr.width / root.offsetWidth : 1;
    picker.style.left = `${Math.max(0, (ar.left - rr.left) / zoom)}px`;
    picker.style.top = `${(ar.bottom - rr.top) / zoom + 4}px`;
    picker.style.display = "block";
    // 오른쪽으로 삐져나가면 패널 폭 안으로 민다.
    const pw = picker.offsetWidth;
    const maxLeft = root.offsetWidth - pw - 8;
    if (parseFloat(picker.style.left) > maxLeft) picker.style.left = `${Math.max(0, maxLeft)}px`;
    // 아래로 화면을 넘기면 칸 위로 · 위로는 **목표 줄(goalBar) 아래까지만**(그 줄을 덮으면 할 일이 안 보인다 ·
    // 겹침 검사 실측). 화면 좌표는 zoom 이 곱해진 CSS px 다.
    const ph = picker.offsetHeight * zoom;
    const viewportH = window.innerHeight;
    if (ar.bottom + 4 + ph > viewportH) {
      const goal = document.querySelector(".goal-root");
      const ceiling = (goal ? goal.getBoundingClientRect().bottom : 0) + 8;
      const above = (ar.top - rr.top) / zoom - picker.offsetHeight - 4;
      const topMin = (ceiling - rr.top) / zoom;
      picker.style.top = `${Math.max(topMin, above)}px`;
    }
  }

  function ensureRows(n: number): void {
    while (rowEls.length < n) {
      const idx = rowEls.length;
      const r = el("div", "mgr-row");
      const words = el("div", "mgr-words");
      const mk = (slot: Slot): HTMLButtonElement => {
        const b = el("button", `mgr-word ${slot}`);
        b.type = "button";
        b.addEventListener("click", () => openPicker(idx, slot, b));
        return b;
      };
      const who = mk("who");
      const when = mk("when");
      const act = mk("act");
      words.append(who, when, act);
      const count = el("span", "mgr-count", "");
      const tools = el("div", "mgr-tools");
      const up = el("button", "mgr-tool", "▲");
      up.type = "button";
      up.title = "위로";
      const down = el("button", "mgr-tool", "▼");
      down.type = "button";
      down.title = "아래로";
      const del = el("button", "mgr-tool del", "×");
      del.type = "button";
      del.title = "줄 지우기";
      up.addEventListener("click", () => {
        const rows = currentRows();
        if (idx <= 0 || idx >= rows.length) return;
        const a = rows[idx - 1] as Directive;
        rows[idx - 1] = rows[idx] as Directive;
        rows[idx] = a;
        emit(rows);
      });
      down.addEventListener("click", () => {
        const rows = currentRows();
        if (idx < 0 || idx + 1 >= rows.length) return;
        const a = rows[idx + 1] as Directive;
        rows[idx + 1] = rows[idx] as Directive;
        rows[idx] = a;
        emit(rows);
      });
      del.addEventListener("click", () => {
        const rows = currentRows();
        if (idx >= rows.length) return;
        rows.splice(idx, 1);
        emit(rows);
      });
      tools.append(up, down, del);
      r.append(words, count, tools);
      rowEls.push({ root: r, words: { who, when, act }, count, up, down, del });
      rowsBox.append(r);
    }
  }

  addBtn.addEventListener("click", () => {
    if (last === null || !last.canEdit || last.sheet.length >= last.maxRows) return;
    const rows = currentRows();
    rows.push({ who: "all", when: "always", act: "gather" });
    emit(rows);
  });
  timeoutBtn.addEventListener("click", () => {
    if (last === null) return;
    if (last.inTimeout) cb.onResume();
    else cb.onTimeout();
  });
  handle.addEventListener("click", () => toggleCollapsed());

  function toggleCollapsed(): void {
    if (isDesktop) return;
    collapsed = !collapsed;
    root.classList.toggle("collapsed", collapsed);
    setText(handle, collapsed ? "지침 ▴" : "접기 ▾");
    if (collapsed) closePicker();
  }

  function renderSchedule(d: ManagerData): void {
    setText(schedEra, d.eraLabel);
    while (cells.length < d.schedule.length) {
      const c = el("div", "mgr-cell");
      const num = el("span", "mgr-cell-num", "");
      const label = el("span", "mgr-cell-label", "");
      const sub = el("span", "mgr-cell-sub", "");
      const bar = el("span", "mgr-cell-bar", "");
      c.append(num, label, sub, bar);
      track.append(c);
      cells.push({ root: c, num, label, sub, bar });
    }
    d.schedule.forEach((s, i) => {
      const c = cells[i];
      if (c === undefined) return;
      c.root.dataset["state"] = s.state;
      c.root.dataset["kind"] = s.kind;
      setText(c.num, String(s.ordinal));
      setText(c.label, s.label);
      // 칸이 좁다(여섯 칸 · 폰 폭) · 지금 칸은 남은 초만(진행은 아래 막대가 말한다) · 앞 칸의 대멸종 종류는
      // 세 글자라 들어간다. 지금 위협의 이름은 칸 밑 한 줄(nowLine)로.
      const sub =
        s.state === "now"
          ? `${s.secondsLeft ?? 0}초`
          : s.threat
            ? s.threat
            : s.state === "done"
              ? "끝"
              : `${s.seconds}초`;
      setText(c.sub, sub);
      if (s.state === "now") {
        const t = s.threat ? `지금 ${s.label} · ${s.threat}` : "";
        setText(nowLine, t);
        nowLine.style.display = t ? "" : "none";
        nowLine.dataset["kind"] = s.kind;
      }
      const frac = s.state === "now" && s.secondsLeft !== null ? 1 - Math.max(0, Math.min(1, s.secondsLeft / s.seconds)) : s.state === "done" ? 1 : 0;
      c.bar.style.transform = `scaleX(${frac.toFixed(3)})`;
    });
  }

  function renderSheet(d: ManagerData): void {
    // 편집 가능 여부·작전타임 상태에 따라 머리 문구와 버튼이 갈린다.
    const editing = d.canEdit;
    sheetCard.classList.toggle("editing", editing);
    if (d.inTimeout) {
      setText(timeoutBtn, "경기 재개");
      timeoutBtn.className = "mgr-timeout resume";
      timeoutBtn.disabled = false;
      setText(
        note,
        d.timeoutIsAuto
          ? `작전타임. ${d.threatText || "위협이 나타났습니다."} 지침을 고친 뒤 경기를 재개하세요.`
          : "작전타임. 지침을 고친 뒤 경기를 재개하세요.",
      );
    } else if (editing) {
      setText(timeoutBtn, "지침 고치는 중");
      timeoutBtn.className = "mgr-timeout";
      timeoutBtn.disabled = true;
      setText(note, "세계가 멈춘 동안 지침을 고칠 수 있습니다.");
    } else {
      setText(timeoutBtn, d.timeoutsLeft > 0 ? `작전타임 ${d.timeoutsLeft}` : "작전타임 없음");
      timeoutBtn.className = "mgr-timeout";
      timeoutBtn.disabled = d.timeoutsLeft <= 0;
      setText(note, "경기 중에는 못 고칩니다. 줄 옆 숫자가 지금 그 줄대로 움직이는 수입니다.");
    }
    ensureRows(d.sheet.length);
    const sig = `${editing ? "e" : "r"}|${d.sheet.map((r) => `${r.who}.${r.when}.${r.act}`).join(",")}|${d.maxRows}`;
    if (sig !== rowSig) {
      rowSig = sig;
      if (picking !== null && picking.row >= d.sheet.length) closePicker();
      rowEls.forEach((r, i) => {
        const dv = d.sheet[i];
        if (dv === undefined) {
          r.root.style.display = "none";
          return;
        }
        r.root.style.display = "";
        setText(r.words.who, slotLabel("who", dv));
        setText(r.words.when, slotLabel("when", dv));
        setText(r.words.act, slotLabel("act", dv));
        for (const b of [r.words.who, r.words.when, r.words.act]) b.disabled = !editing;
        r.up.disabled = !editing || i === 0;
        r.down.disabled = !editing || i === d.sheet.length - 1;
        r.del.disabled = !editing;
      });
      addBtn.style.display = editing && d.sheet.length < d.maxRows ? "" : "none";
      setText(addBtn, `+ 줄 추가 (${d.sheet.length}/${d.maxRows})`);
    }
    // 발동 수는 매 프레임 바뀐다 · 문자열 비교로만 DOM 을 건드린다.
    rowEls.forEach((r, i) => {
      if (i >= d.sheet.length) return;
      const n = d.fired[i] ?? 0;
      setText(r.count, editing ? "" : String(n));
      r.count.classList.toggle("live", !editing && n > 0);
    });
    const fin = d.fired[d.sheet.length] ?? 0;
    setText(finalCount, editing ? "" : String(fin));
    finalCount.classList.toggle("live", !editing && fin > 0);
    setText(instinctLine, !editing && d.instinct > 0 ? `본능이 앞선 개체 ${d.instinct} (달아나거나 쫓거나 방울 줍는 중)` : "");
  }

  function renderVeil(d: ManagerData): void {
    const on = d.visible && d.inTimeout;
    veil.style.display = on ? "" : "none";
    if (!on) return;
    veil.dataset["auto"] = d.timeoutIsAuto ? "1" : "0";
    if (d.timeoutIsAuto) {
      // 위협 문구는 game 이 만든 것 그대로(「지금 위협 「…」 · 대응 힌트」) · 비어 있으면 일반 문구.
      setText(veilTitle, "위협이 나타났습니다");
      setText(veilSub, d.threatText || "경기가 멈췄습니다. 지침을 고친 뒤 재개하세요.");
    } else {
      setText(veilTitle, "감독이 부른 작전타임");
      setText(veilSub, "경기가 멈췄습니다. 지침을 고친 뒤 재개하세요.");
    }
  }

  function update(d: ManagerData): void {
    const wasVisible = last !== null && last.visible;
    last = d;
    if (!d.visible) {
      if (wasVisible) closePicker();
      root.style.display = "none";
      return;
    }
    root.style.display = "";
    renderSchedule(d);
    renderSheet(d);
    renderVeil(d);
    if (!d.canEdit && picking !== null) closePicker();
  }

  // Esc 로 단어 목록만 닫는다(작전타임 종료는 main 의 키 레이어가 맡는다).
  registerKeyLayer(
    Z + 1,
    () => picking !== null,
    (e) => {
      if (e.code === "Escape") {
        closePicker();
        return true;
      }
      return false;
    },
  );

  return {
    update,
    isPicking: () => picking !== null,
    toggleCollapsed,
    root,
  };
}

function ensureManagerStyles(): void {
  if (document.getElementById("mgr-style")) return;
  const s = document.createElement("style");
  s.id = "mgr-style";
  s.textContent = `
  .mgr-root { position: fixed; z-index: ${Z}; display: flex; flex-direction: column; gap: 8px;
    color: var(--ink); font-family: var(--font-body); font-size: 12px; line-height: 1.4;
    user-select: none; pointer-events: none; }
  .mgr-root[data-layout="desktop"] { left: 8px; top: 8px; bottom: 8px; width: ${MANAGER_COLUMN_PX}px; }
  /* 폰: 아래 서랍. 접히면 일정표만 남고, 펼치면 시트가 위로 자란다(vh 금지 · 고정 px 상한). */
  .mgr-root[data-layout="mobile"] { left: 8px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom)); }
  .mgr-root[data-layout="mobile"] .mgr-sheet { max-height: 300px; overflow-y: auto; }
  /* 폰은 세로가 짧다 · 목록이 목표 줄과 지침 칸 사이에 들어가게 낮춘다(넘치면 목록 안에서 스크롤). */
  .mgr-root[data-layout="mobile"] .mgr-picker { max-height: 240px; }
  .mgr-root[data-layout="mobile"].collapsed .mgr-sheet { display: none; }
  .mgr-root[data-layout="mobile"] .mgr-sched { order: 2; }
  .mgr-root[data-layout="mobile"] .mgr-sheet { order: 1; }
  .mgr-root[data-layout="mobile"] .mgr-handle { order: 0; align-self: flex-end; }
  .mgr-card { pointer-events: auto; background: var(--panel); border: 1px solid var(--line);
    border-radius: var(--r-card); padding: 9px 10px; backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
    display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  /* 시트는 내용만큼만 · 줄이 많아지면 열 안에서 스크롤한다(빈 카드가 세로를 다 차지하지 않게). */
  .mgr-root[data-layout="desktop"] .mgr-sheet { flex: 0 1 auto; overflow-y: auto; }
  .mgr-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .mgr-title { font-family: var(--font-title); font-size: 14px; letter-spacing: 0.02em; }
  .mgr-era { color: var(--sub); font-family: var(--font-mono); font-size: 11px; }
  /* 일정표 · 여섯 칸 가로 띠. 지금 칸은 밝고, 지난 칸은 흐리다. */
  .mgr-track { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3px; }
  .mgr-cell { position: relative; display: flex; flex-direction: column; gap: 1px; padding: 5px 4px 7px;
    border-radius: 8px; background: rgba(245, 235, 220, 0.05); border: 1px solid transparent; min-width: 0; overflow: hidden; }
  .mgr-cell[data-state="now"] { background: rgba(143, 209, 79, 0.14); border-color: rgba(143, 209, 79, 0.5); }
  .mgr-cell[data-state="done"] { opacity: 0.45; }
  .mgr-cell[data-kind="boss"][data-state="ahead"] { border-color: rgba(232, 92, 67, 0.35); }
  .mgr-cell[data-kind="extinction"][data-state="ahead"] { border-color: rgba(90, 176, 226, 0.4); }
  .mgr-cell[data-kind="boss"][data-state="now"] { background: rgba(232, 92, 67, 0.16); border-color: rgba(232, 92, 67, 0.6); }
  .mgr-cell[data-kind="extinction"][data-state="now"] { background: rgba(90, 176, 226, 0.16); border-color: rgba(90, 176, 226, 0.6); }
  .mgr-cell-num { font-family: var(--font-mono); font-size: 10px; color: var(--faint); }
  .mgr-cell-label { font-family: var(--font-title); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mgr-cell-sub { font-size: 10px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mgr-cell-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--lime);
    transform-origin: left; transform: scaleX(0); }
  .mgr-cell[data-kind="boss"] .mgr-cell-bar { background: var(--red); }
  .mgr-cell[data-kind="extinction"] .mgr-cell-bar { background: var(--blue); }
  .mgr-now { font-size: 11px; color: var(--sub); }
  .mgr-now[data-kind="boss"] { color: var(--red); }
  .mgr-now[data-kind="extinction"] { color: var(--blue); }
  /* 지침 · 줄 = 단어 셋 + 발동 수 + (편집 중) 도구. */
  .mgr-note { color: var(--sub); font-size: 11px; }
  .mgr-sheet.editing .mgr-note { color: var(--amber); }
  .mgr-rows { display: flex; flex-direction: column; gap: 4px; }
  .mgr-row { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 10px;
    background: rgba(245, 235, 220, 0.05); border: 1px solid var(--line); }
  .mgr-row.final { opacity: 0.75; border-style: dashed; }
  .mgr-words { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; min-width: 0; }
  .mgr-word { font: inherit; font-size: 12px; padding: 2px 7px; border-radius: 999px; border: 1px solid transparent;
    color: var(--ink); background: rgba(245, 235, 220, 0.08); cursor: default; white-space: nowrap; }
  .mgr-word.who { background: rgba(185, 140, 224, 0.18); border-color: rgba(185, 140, 224, 0.35); }
  .mgr-word.when { background: rgba(90, 176, 226, 0.16); border-color: rgba(90, 176, 226, 0.35); }
  .mgr-word.act { background: rgba(143, 209, 79, 0.16); border-color: rgba(143, 209, 79, 0.35); }
  .mgr-sheet.editing .mgr-word:not(.fixed) { cursor: pointer; }
  .mgr-sheet.editing .mgr-word:not(.fixed):hover { filter: brightness(1.2); }
  .mgr-word:disabled { opacity: 1; }
  .mgr-count { min-width: 22px; text-align: right; font-family: var(--font-mono); font-size: 12px; color: var(--faint); }
  .mgr-count.live { color: var(--lime); }
  .mgr-tools { display: none; gap: 2px; }
  .mgr-sheet.editing .mgr-tools { display: flex; }
  .mgr-tool { font: inherit; font-size: 11px; width: 20px; height: 20px; padding: 0; border-radius: 6px;
    border: 1px solid var(--line); background: rgba(245, 235, 220, 0.06); color: var(--sub); cursor: pointer; }
  .mgr-tool:disabled { opacity: 0.3; cursor: default; }
  .mgr-tool.del { color: var(--red); }
  .mgr-add { font: inherit; font-size: 12px; padding: 6px; border-radius: 10px; border: 1px dashed var(--line);
    background: transparent; color: var(--sub); cursor: pointer; }
  .mgr-add:hover { color: var(--ink); border-color: rgba(245, 235, 220, 0.3); }
  .mgr-instinct { color: var(--faint); font-size: 11px; min-height: 1.4em; }
  .mgr-timeout { font-family: var(--font-title); font-size: 12px; padding: 5px 10px; border-radius: 999px;
    border: 1px solid rgba(245, 195, 59, 0.5); background: rgba(245, 195, 59, 0.14); color: var(--amber); cursor: pointer; }
  .mgr-timeout:disabled { opacity: 0.45; cursor: default; }
  .mgr-timeout.resume { background: var(--lime); color: #1B2A0A; border-color: var(--limeD); }
  /* 작전타임 베일 · 세계를 덮고 한가운데에 상태를 크게. 왼쪽 열(z 11)·구입(16) 아래, 목표 줄(z 9) 위. */
  .mgr-veil { position: fixed; inset: 0; z-index: 10; pointer-events: auto; display: flex; align-items: center;
    justify-content: center; background: rgba(6, 5, 3, 0.55); backdrop-filter: blur(1.5px); -webkit-backdrop-filter: blur(1.5px);
    animation: mgr-veil-in 0.25s ease-out; }
  .mgr-veil-box { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center;
    padding: 22px 28px; max-width: 420px; box-sizing: border-box;
    background: var(--panel); border: 1px solid rgba(245, 195, 59, 0.55); border-radius: var(--r-focus);
    box-shadow: 0 0 0 4px rgba(245, 195, 59, 0.12), 0 18px 50px rgba(0, 0, 0, 0.6);
    animation: mgr-veil-pulse 1.6s ease-in-out infinite; }
  .mgr-veil-kicker { font-family: var(--font-display); font-size: 34px; letter-spacing: 0.08em; color: var(--amber); }
  .mgr-veil-title { font-family: var(--font-title); font-size: 18px; color: var(--ink); }
  .mgr-veil[data-auto="1"] .mgr-veil-title { color: var(--red); }
  .mgr-veil-sub { font-size: 13px; color: var(--sub); line-height: 1.5; }
  .mgr-veil-btn { margin-top: 6px; font-family: var(--font-title); font-size: 17px; padding: 12px 28px; border: 0;
    border-radius: var(--r-btn); background: var(--lime); color: #1B2A0A; cursor: pointer; border-bottom: 5px solid var(--limeD); }
  .mgr-veil-btn:active { transform: translateY(4px); border-bottom-width: 1px; }
  .mgr-veil-hint { font-size: 11px; color: var(--faint); }
  @keyframes mgr-veil-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes mgr-veil-pulse { 0%, 100% { box-shadow: 0 0 0 4px rgba(245, 195, 59, 0.12), 0 18px 50px rgba(0, 0, 0, 0.6); }
    50% { box-shadow: 0 0 0 10px rgba(245, 195, 59, 0.05), 0 18px 50px rgba(0, 0, 0, 0.6); } }
  /* 폰: 서랍이 아래에 있으니 베일 상자를 위로 올려 서랍과 안 겹치게. */
  .mgr-root[data-layout="mobile"] ~ .mgr-veil { align-items: flex-start; padding-top: 72px; }
  .mgr-handle { pointer-events: auto; font: inherit; font-size: 12px; padding: 5px 10px; border-radius: 999px;
    border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer; }
  /* 단어 목록 팝오버 · 패널 안 절대 좌표. */
  .mgr-picker { position: absolute; z-index: 2; pointer-events: auto; width: 230px; max-height: 320px; overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--panelSolid); border: 1px solid rgba(245, 235, 220, 0.3); border-radius: 12px; padding: 6px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55); display: flex; flex-direction: column; gap: 2px; }
  .mgr-picker-title { font-family: var(--font-title); font-size: 12px; color: var(--sub); padding: 2px 6px 4px; }
  .mgr-pick { font: inherit; text-align: left; display: flex; flex-direction: column; gap: 1px; padding: 5px 8px;
    border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--ink); cursor: pointer; }
  .mgr-pick:hover { background: rgba(245, 235, 220, 0.08); }
  .mgr-pick.on { border-color: rgba(143, 209, 79, 0.5); background: rgba(143, 209, 79, 0.1); }
  .mgr-pick-label { font-size: 12px; }
  .mgr-pick-desc { font-size: 10.5px; color: var(--sub); }
  `;
  document.head.appendChild(s);
}
