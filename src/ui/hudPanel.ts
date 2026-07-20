// 상단 HUD — 캔버스 위 DOM 오버레이(시안 A "한 줄 상태 바", 2026-07-20 화면 정리).
// 항상 보이는 건 최소만: ① 상태 바(내 종·야생 수, 레벨, 단계·남은 시간, 낮밤 점) ② 진행 타임라인
// (보스/멸종 마커 — 위협 예고는 반드시 읽혀야 한다) ③ 접힌 칩 2개(종 안내 · 내 형질).
// 나머지(종 목록·먹이 색·환경·사망 원인·추이선)는 "종 안내" 칩을 눌러야 열리는 패널로 내려간다.
// "내 형질" 칩은 buildPanel(별도 컴포넌트)을 토글한다(main 이 onTraitsToggle 로 배선).
// 두 패널은 같은 자리(칩 아래)를 쓰므로 서로 배타적으로 연다.
// sim 상태를 읽기만 한다(순수 표시). 매 프레임 update() — 텍스트·폭만 갱신하고, 마커/종 목록은
// 시그니처가 바뀔 때만 다시 만든다(가볍게 유지).

import type { World, DeathCause, DeathTally } from "@/sim/world";
import type { Species } from "@/sim/species";
import { ensurePanelStyles } from "@/ui/panelStyles";

export interface HudData {
  world: World;
  visible: boolean; // 로비면 false(HUD 전체 숨김). 드래프트 중엔 body.draft-open CSS 가 따로 가린다.
  stageText: string; // "시대 2 · 채집" 같은 단계 이름(데스크톱 상태 바)
  timeText: string; // "14초" 또는 "14초 (멈춤)"
  envText: string; // "대륙 · 따뜻한 땅 · 먹이 비옥함" — 종 안내 패널에 표시
  level: number;
  xpProgress: number; // 0~1
  timeline: { progress: number; markers: readonly { kind: string; at: number }[] };
}

export interface HudPanel {
  update: (data: HudData) => void;
  reset: () => void;
}

export interface HudCallbacks {
  /** "내 형질" 칩 토글 — main 이 buildPanel 표시를 여기에 맞춘다. */
  onTraitsToggle?: (open: boolean) => void;
}

const DEATH_INTERVAL = 48; // 사망 원인 갱신 주기(프레임)
const SAMPLE_EVERY = 8; // 추이선 표본 간격(프레임)
const MAX_SAMPLES = 150;

const CAUSE_LABEL: Record<DeathCause, string> = {
  starve: "굶음",
  cold: "추위",
  heat: "더위",
  age: "노화",
  boss: "보스",
  predation: "잡아먹힘",
  plague: "역병",
  venom: "중독",
  wound: "부상",
};

// worldView.ts 의 FOOD_COLORS 와 동기화(먹이 종류별 색: 연두 / 청록 / 노랑풀).
const FOOD_LEGEND_COLORS: readonly string[] = ["#9bee5a", "#5ad6b0", "#d8de5a"];

const hex = (c: number): string => "#" + (c & 0xffffff).toString(16).padStart(6, "0");

/** 밝기·진행도로 낮밤 단계 라벨(점 위 툴팁용). */
function phaseLabel(daylight: number, phase: number): string {
  if (daylight >= 0.66) return "낮";
  if (daylight < 0.33) return "밤";
  return phase < 0.5 ? "노을" : "새벽";
}

/** 낮밤 점 색 — 밤(남색)↔낮(호박)을 daylight(0~1)로 보간. */
function dayNightColor(daylight: number): string {
  const night = [42, 58, 106]; // 남색
  const day = [245, 195, 59]; // amber
  const r = Math.round(night[0]! + (day[0]! - night[0]!) * daylight);
  const g = Math.round(night[1]! + (day[1]! - night[1]!) * daylight);
  const b = Math.round(night[2]! + (day[2]! - night[2]!) * daylight);
  return `rgb(${r},${g},${b})`;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function createHudPanel(cb: HudCallbacks = {}): HudPanel {
  ensurePanelStyles();
  injectHudStyles();

  const isDesktop = document.body?.dataset.layout === "desktop";

  const root = document.createElement("div");
  root.className = "hud-root";

  // ── ① 상태 바(한 줄) ──
  const strip = document.createElement("div");
  strip.className = "hud-strip";
  const mineDot = document.createElement("span");
  mineDot.className = "hud-mine-dot";
  const statMine = document.createElement("span");
  statMine.className = "hud-stat-mine";
  const statWild = document.createElement("span");
  statWild.className = "hud-stat-wild";
  const sep1 = document.createElement("span");
  sep1.className = "hud-sep";
  const levelText = document.createElement("span");
  levelText.className = "hud-level";
  const xpTrack = document.createElement("span");
  xpTrack.className = "hud-xp-track";
  const xpFill = document.createElement("span");
  xpFill.className = "hud-xp-fill";
  xpTrack.appendChild(xpFill);
  const sep2 = document.createElement("span");
  sep2.className = "hud-sep hud-desktop-only";
  const stageEl = document.createElement("span");
  stageEl.className = "hud-stage hud-desktop-only"; // 모바일은 좁아 남은 시간만 남긴다
  const timeEl = document.createElement("span");
  timeEl.className = "hud-time";
  const dayDot = document.createElement("span");
  dayDot.className = "hud-day-dot";
  strip.append(mineDot, statMine, statWild, sep1, levelText, xpTrack, sep2, stageEl, timeEl, dayDot);

  // ── ② 진행 타임라인 ──
  const tlWrap = document.createElement("div");
  tlWrap.className = "hud-timeline-wrap";
  const tlTrack = document.createElement("div");
  tlTrack.className = "hud-timeline";
  const tlFill = document.createElement("div");
  tlFill.className = "hud-timeline-fill";
  tlTrack.appendChild(tlFill);
  tlWrap.appendChild(tlTrack);

  // ── ③ 접힌 칩 2개 ──
  const chips = document.createElement("div");
  chips.className = "hud-chips";
  const legendChip = document.createElement("button");
  legendChip.className = "hud-chip";
  const traitsChip = document.createElement("button");
  traitsChip.className = "hud-chip";
  chips.append(legendChip, traitsChip);

  // ── 종 안내 패널(칩 아래, 접힘이 기본) ──
  const legend = document.createElement("div");
  legend.className = "hud-legend";
  const legendBody = document.createElement("div"); // 종 목록 + 먹이 색(시그니처 갱신 시 재구성)
  const envLine = document.createElement("div"); // 환경 요약(예전 상태 카드 둘째 줄)
  envLine.className = "hud-envline";
  const death = document.createElement("div"); // 최근 사망 원인
  death.className = "hud-death";
  death.style.display = "none";
  // 추이선(데스크톱 전용) — 내 종 수 스파크라인.
  const graphSvg = document.createElementNS(SVG_NS, "svg");
  graphSvg.setAttribute("viewBox", "0 0 210 40");
  graphSvg.setAttribute("preserveAspectRatio", "none");
  graphSvg.classList.add("hud-graph");
  const graphLine = document.createElementNS(SVG_NS, "polyline");
  graphLine.setAttribute("fill", "none");
  graphLine.setAttribute("stroke", "#8FD14F");
  graphLine.setAttribute("stroke-width", "2");
  graphLine.setAttribute("stroke-linejoin", "round");
  graphLine.setAttribute("stroke-linecap", "round");
  graphSvg.appendChild(graphLine);
  legend.appendChild(legendBody);
  legend.appendChild(envLine);
  legend.appendChild(death);
  if (isDesktop) legend.appendChild(graphSvg);

  // 칩 상태 — 두 패널은 같은 자리를 쓰므로 하나를 열면 다른 하나는 닫는다.
  let legendOpen = false;
  let traitsOpen = false;
  const refreshChips = (): void => {
    legendChip.textContent = legendOpen ? "종 안내 ▾" : "종 안내 ▸";
    traitsChip.textContent = traitsOpen ? "내 형질 ▾" : "내 형질 ▸";
    legendChip.classList.toggle("on", legendOpen);
    traitsChip.classList.toggle("on", traitsOpen);
    legend.style.display = legendOpen ? "block" : "none";
  };
  legendChip.addEventListener("click", () => {
    legendOpen = !legendOpen;
    if (legendOpen && traitsOpen) {
      traitsOpen = false;
      cb.onTraitsToggle?.(false);
    }
    legendSig = ""; // 열 때 목록을 다시 그리게
    refreshChips();
  });
  traitsChip.addEventListener("click", () => {
    traitsOpen = !traitsOpen;
    if (traitsOpen && legendOpen) legendOpen = false;
    cb.onTraitsToggle?.(traitsOpen);
    refreshChips();
  });
  refreshChips();

  root.append(strip, tlWrap, chips, legend);
  document.body.appendChild(root);

  // ── 상태(프레임 간 유지) ──
  let frame = 0;
  let prevDeaths: DeathTally | null = null;
  let deathText = "";
  const history: number[] = [];
  let maxSeen = 1;
  let tlSig = "";
  let legendSig = "";
  let lastSpecies: readonly Species[] = [];
  let lastCounts = new Map<number, number>();
  const legendCounts: { id: number; el: HTMLElement }[] = [];

  function reset(): void {
    frame = 0;
    prevDeaths = null;
    deathText = "";
    death.textContent = "";
    death.style.display = "none";
    history.length = 0;
    maxSeen = 1;
    tlSig = "";
    legendSig = "";
    // 새 런은 닫힌 기본 상태로(화면을 비워 두는 게 원칙).
    legendOpen = false;
    if (traitsOpen) {
      traitsOpen = false;
      cb.onTraitsToggle?.(false);
    }
    refreshChips();
  }

  function updateDeathFeed(deaths: DeathTally): void {
    if (!prevDeaths) {
      prevDeaths = { ...deaths };
      deathText = "";
      return;
    }
    const parts: { label: string; n: number }[] = [];
    for (const cause of Object.keys(deaths) as DeathCause[]) {
      const delta = deaths[cause] - prevDeaths[cause];
      if (delta > 0) parts.push({ label: CAUSE_LABEL[cause], n: delta });
    }
    prevDeaths = { ...deaths };
    parts.sort((a, b) => b.n - a.n);
    // 패널이 좁으니 상위 2개 원인만(가독성).
    deathText = parts.length
      ? "사망  " + parts.slice(0, 2).map((p) => `${p.label} ${p.n}`).join("  ·  ")
      : "";
  }

  function updateGraph(mine: number): void {
    if (!isDesktop) return;
    if (frame % SAMPLE_EVERY === 0) {
      history.push(mine);
      if (history.length > MAX_SAMPLES) history.shift();
      if (mine > maxSeen) maxSeen = mine;
    }
    if (history.length < 2) {
      graphLine.setAttribute("points", "");
      return;
    }
    const W = 210;
    const H = 40;
    const pts = history
      .map((v, i) => {
        const x = (i / (MAX_SAMPLES - 1)) * W;
        const y = H - (v / maxSeen) * (H - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    graphLine.setAttribute("points", pts);
  }

  function updateTimeline(tl: HudData["timeline"]): void {
    tlFill.style.width = `${Math.max(0, Math.min(1, tl.progress)) * 100}%`;
    const sig = tl.markers.map((m) => `${m.kind}@${m.at.toFixed(3)}`).join(",");
    if (sig === tlSig) return;
    tlSig = sig;
    // 마커 재구성(막대 위 색 탭 + 아래 라벨 칩). 시점이 바뀔 때만.
    for (const old of Array.from(tlTrack.querySelectorAll(".hud-marker"))) old.remove();
    tl.markers.forEach((m) => {
      const isBoss = m.kind === "boss";
      const mk = document.createElement("div");
      mk.className = "hud-marker" + (isBoss ? " boss" : " end");
      mk.style.left = `${Math.max(0, Math.min(1, m.at)) * 100}%`;
      const tab = document.createElement("div");
      tab.className = "hud-marker-tab";
      const lbl = document.createElement("div");
      lbl.className = "hud-marker-label";
      lbl.textContent = isBoss ? "보스" : "멸종";
      mk.append(tab, lbl);
      tlTrack.appendChild(mk);
    });
  }

  function applyLegend(species: readonly Species[], counts: Map<number, number>): void {
    const sig = species.map((s) => `${s.id}:${s.color}`).join(",");
    if (sig !== legendSig) {
      legendSig = sig;
      legendBody.replaceChildren();
      legendCounts.length = 0;
      for (const sp of species) {
        const row = document.createElement("div");
        row.className = "hud-legend-row";
        const dot = document.createElement("span");
        dot.className = "hud-legend-dot";
        dot.style.background = hex(sp.color);
        // 내 종·우호 친척·야생 동맹을 고리 색으로 구분(화면 고리와 맞춤).
        if (sp.isPlayer) dot.style.boxShadow = "0 0 0 2px #aaffb0";
        else if (sp.friendly) dot.style.boxShadow = "0 0 0 2px #7fffe8";
        else if (sp.faction !== 0) dot.style.boxShadow = "0 0 0 2px #ffcf6a";
        const name = document.createElement("span");
        name.className = "hud-legend-name";
        name.textContent = sp.name;
        const count = document.createElement("span");
        count.className = "hud-legend-count";
        row.append(dot, name, count);
        legendBody.appendChild(row);
        legendCounts.push({ id: sp.id, el: count });
      }
      // 구분선 + 먹이 색.
      const foodRow = document.createElement("div");
      foodRow.className = "hud-legend-food";
      const foodLabel = document.createElement("span");
      foodLabel.className = "hud-legend-foodlabel";
      foodLabel.textContent = "먹이";
      foodRow.appendChild(foodLabel);
      for (const c of FOOD_LEGEND_COLORS) {
        const d = document.createElement("span");
        d.className = "hud-legend-fooddot";
        d.style.background = c;
        foodRow.appendChild(d);
      }
      legendBody.appendChild(foodRow);
    }
    // 실시간 개체 수 갱신(텍스트만).
    for (const lc of legendCounts) {
      const next = String(counts.get(lc.id) ?? 0);
      if (lc.el.textContent !== next) lc.el.textContent = next;
    }
  }

  function update(data: HudData): void {
    const { world } = data;
    root.style.display = data.visible ? "block" : "none";
    if (!data.visible) return;

    const mine = world.playerPopulation;
    statMine.textContent = `내 종 ${mine}`;
    statWild.textContent = `야생 ${world.population - mine}`;
    stageEl.textContent = data.stageText;
    timeEl.textContent = data.timeText;

    const phase = phaseLabel(world.daylight, world.dayPhase);
    dayDot.style.background = dayNightColor(world.daylight);
    if (dayDot.title !== phase) dayDot.title = phase;

    levelText.textContent = `Lv.${data.level}`;
    xpFill.style.width = `${Math.max(0, Math.min(1, data.xpProgress)) * 100}%`;

    updateTimeline(data.timeline);

    frame += 1;
    updateGraph(mine);
    if (frame % DEATH_INTERVAL === 0) {
      updateDeathFeed(world.deaths);
      death.textContent = deathText;
      death.style.display = deathText ? "block" : "none";
    }

    // 종 안내 패널 내용은 열려 있을 때만 갱신(닫혀 있으면 화면 비용 0).
    if (legendOpen) {
      envLine.textContent = data.envText;
      lastSpecies = world.species;
      if (frame % 6 === 0) {
        lastCounts = new Map<number, number>();
        for (const e of world.entities) lastCounts.set(e.species.id, (lastCounts.get(e.species.id) ?? 0) + 1);
      }
      applyLegend(lastSpecies, lastCounts);
    }
  }

  return { update, reset };
}

let hudStylesAdded = false;
function injectHudStyles(): void {
  if (hudStylesAdded || document.getElementById("hud-style")) return;
  hudStylesAdded = true;
  const s = document.createElement("style");
  s.id = "hud-style";
  s.textContent = `
  .hud-root { position: fixed; top: 0; left: 0; right: 0; z-index: 8; pointer-events: none; font-family: var(--font-body); }

  /* ① 상태 바 — 유리 알약 하나에 핵심만(내 종·야생, 레벨, 단계·시간, 낮밤 점) */
  .hud-strip {
    position: absolute; display: flex; align-items: center; pointer-events: auto; user-select: none;
    background: var(--panel); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    border: 1px solid var(--line); color: var(--ink);
  }
  body[data-layout="desktop"] .hud-strip { top: 16px; left: 50%; transform: translateX(-50%); gap: 14px; padding: 8px 22px; border-radius: 999px; }
  body[data-layout="mobile"] .hud-strip { top: calc(8px + env(safe-area-inset-top)); left: 8px; right: 8px; gap: 9px; padding: 8px 13px; border-radius: 16px; }
  body[data-layout="mobile"] .hud-desktop-only { display: none; }
  .hud-mine-dot { width: 11px; height: 11px; border-radius: 50%; background: var(--lime); flex: none; }
  .hud-stat-mine { font-family: var(--font-title); font-size: 21px; color: var(--ink); white-space: nowrap; }
  body[data-layout="mobile"] .hud-stat-mine { font-size: 18px; }
  .hud-stat-wild { font-family: var(--font-title); font-size: 15px; color: var(--faint); white-space: nowrap; }
  body[data-layout="mobile"] .hud-stat-wild { font-size: 13px; }
  .hud-sep { width: 1px; align-self: stretch; background: var(--line); flex: none; }
  .hud-level { font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: var(--amber); flex: none; white-space: nowrap; }
  .hud-xp-track { width: 110px; height: 9px; border-radius: 5px; background: rgba(255,255,255,0.07); overflow: hidden; flex: none; }
  body[data-layout="mobile"] .hud-xp-track { width: 56px; flex: 1 1 auto; }
  .hud-xp-fill { display: block; height: 100%; width: 0%; border-radius: 5px; background: var(--amber); transition: width 0.12s linear; }
  .hud-stage { font-size: 14px; color: var(--sub); white-space: nowrap; }
  .hud-time { font-family: var(--font-mono); font-size: 12.5px; color: var(--sub); white-space: nowrap; }
  .hud-day-dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }

  /* ② 타임라인 — 상태 바 아래. 마커(보스/멸종 예고)는 반드시 보인다 */
  .hud-timeline-wrap { position: absolute; pointer-events: none; padding-bottom: 20px; }
  body[data-layout="desktop"] .hud-timeline-wrap { top: 86px; left: 50%; transform: translateX(-50%); width: 560px; }
  body[data-layout="mobile"] .hud-timeline-wrap { top: calc(64px + env(safe-area-inset-top)); left: 14px; right: 14px; }
  .hud-timeline { position: relative; height: 6px; border-radius: 3px; background: rgba(18,16,12,0.72); box-shadow: 0 0 0 1px var(--line); }
  .hud-timeline-fill { height: 100%; border-radius: 3px; background: var(--lime); transition: width 0.12s linear; }
  .hud-marker { position: absolute; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; pointer-events: none; }
  .hud-marker-tab { width: 4px; height: 14px; border-radius: 3px; }
  .hud-marker.boss .hud-marker-tab { background: var(--red); }
  .hud-marker.end .hud-marker-tab { background: var(--ink); }
  .hud-marker-label {
    margin-top: 3px; padding: 1px 6px; border-radius: var(--r-chip);
    font-family: var(--font-mono); font-size: 10px; line-height: 1.4; white-space: nowrap;
    background: rgba(18,16,12,0.85);
  }
  .hud-marker.boss .hud-marker-label { color: var(--red); box-shadow: 0 0 0 1px rgba(232,92,67,0.5); }
  .hud-marker.end .hud-marker-label { color: var(--ink); box-shadow: 0 0 0 1px var(--line); }

  /* ③ 접힌 칩 — 참고 정보(종 안내·내 형질)는 부르면 나온다 */
  .hud-chips { position: absolute; display: flex; gap: 8px; pointer-events: auto; }
  body[data-layout="desktop"] .hud-chips { top: 92px; left: 16px; }
  body[data-layout="mobile"] .hud-chips { top: calc(96px + env(safe-area-inset-top)); left: 8px; }
  .hud-chip {
    font: 700 11px var(--font-mono); letter-spacing: 0.06em; color: var(--sub);
    background: var(--panel); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
    border: 1px solid var(--line); border-radius: 999px; padding: 9px 13px;
    cursor: pointer; touch-action: auto; user-select: none; white-space: nowrap;
  }
  .hud-chip.on { color: var(--ink); border-color: rgba(245,235,220,0.4); }

  /* 종 안내 패널 — 칩 아래. 종 목록 + 먹이 색 + 환경 + 사망 원인 + 추이선(데스크톱) */
  .hud-legend {
    position: absolute; pointer-events: auto; box-sizing: border-box; padding: 9px 12px;
    width: max-content; max-width: 300px; max-height: 420px; overflow-y: auto;
    background: var(--panel); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
    border: 1px solid var(--line); border-radius: var(--r-card); color: var(--ink); user-select: none;
  }
  body[data-layout="desktop"] .hud-legend { top: 140px; left: 16px; }
  body[data-layout="mobile"] .hud-legend { top: calc(144px + env(safe-area-inset-top)); left: 8px; max-width: calc(100vw - 16px); }
  .hud-legend-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; min-width: 150px; }
  .hud-legend-dot { width: 11px; height: 11px; border-radius: 50%; flex: none; }
  .hud-legend-name { flex: 1; font-size: 13px; color: var(--ink); word-break: keep-all; }
  .hud-legend-count { font-family: var(--font-mono); font-size: 12px; color: var(--sub); flex: none; }
  .hud-legend-food { display: flex; align-items: center; gap: 6px; margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--line); }
  .hud-legend-foodlabel { font-family: var(--font-mono); font-size: 11px; color: var(--sub); margin-right: 6px; }
  .hud-legend-fooddot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
  .hud-envline { margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--line); font-size: 12px; line-height: 1.4; color: var(--sub); word-break: keep-all; }
  .hud-death { margin-top: 6px; font-size: 12.5px; color: var(--red); }
  .hud-graph { display: block; width: 210px; height: 40px; margin-top: 8px; }
  `;
  document.head.appendChild(s);
}
