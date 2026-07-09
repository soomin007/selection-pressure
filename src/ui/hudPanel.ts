// 상단 HUD — 캔버스 위 DOM 오버레이(3a "포근한 관찰"). 예전엔 Pixi(render/hud.ts)로 그렸지만,
// 커스텀 폰트(Jua·JetBrains Mono)와 유리 패널을 브라우저가 그대로 처리하도록 DOM 으로 옮겼다.
// 세 조각: ① 정보 카드(내 종/야생 수·시대·단계·남은 시간·낮밤·레벨 진행바·사망 알림, 데스크톱은 추이선)
//          ② 진행 타임라인(막대 + 보스/멸종 마커)  ③ 종/먹이 색 범례(접이식 "종 안내").
// sim 상태를 읽기만 한다(순수 표시). 매 프레임 update() — 텍스트·폭만 갱신하고, 마커/범례 행은
// 시그니처가 바뀔 때만 다시 만든다(가볍게 유지).

import type { World, DeathCause, DeathTally } from "@/sim/world";
import type { Species } from "@/sim/species";
import { ensurePanelStyles } from "@/ui/panelStyles";

export interface HudData {
  world: World;
  statusText: string; // statusLine() — 여러 줄(\n). "" 면 로비(HUD 숨김).
  level: number;
  xpProgress: number; // 0~1
  timeline: { progress: number; markers: readonly { kind: string; at: number }[] };
}

export interface HudPanel {
  update: (data: HudData) => void;
  reset: () => void;
}

const DEATH_INTERVAL = 48; // 사망 알림 갱신 주기(프레임)
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
};

// worldView.ts 의 FOOD_COLORS 와 동기화(먹이 종류별 색: 연두 / 청록 / 노랑풀).
const FOOD_LEGEND_COLORS: readonly string[] = ["#9bee5a", "#5ad6b0", "#d8de5a"];

const hex = (c: number): string => "#" + (c & 0xffffff).toString(16).padStart(6, "0");

/** 밝기·진행도로 낮밤 단계 라벨. */
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

export function createHudPanel(): HudPanel {
  ensurePanelStyles();
  injectHudStyles();

  const isDesktop = document.body?.dataset.layout === "desktop";

  const root = document.createElement("div");
  root.className = "hud-root";

  // ── 정보 카드 ──
  const card = document.createElement("div");
  card.className = "hud-card";

  const row1 = document.createElement("div");
  row1.className = "hud-row1";
  const stat = document.createElement("div");
  stat.className = "hud-stat";
  const statMine = document.createElement("span");
  statMine.className = "hud-stat-mine";
  const statWild = document.createElement("span");
  statWild.className = "hud-stat-wild";
  stat.append(statMine, statWild);
  const dayWrap = document.createElement("div");
  dayWrap.className = "hud-daynight";
  const dayLabel = document.createElement("span");
  dayLabel.className = "hud-day-label";
  const dayDot = document.createElement("span");
  dayDot.className = "hud-day-dot";
  dayWrap.append(dayLabel, dayDot);
  row1.append(stat, dayWrap);

  const notice = document.createElement("div");
  notice.className = "hud-notice";

  // 추이선(데스크톱 전용) — 정보 카드 안 스파크라인.
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

  const xpRow = document.createElement("div");
  xpRow.className = "hud-xprow";
  const levelText = document.createElement("span");
  levelText.className = "hud-level";
  const xpTrack = document.createElement("div");
  xpTrack.className = "hud-xp-track";
  const xpFill = document.createElement("div");
  xpFill.className = "hud-xp-fill";
  xpTrack.appendChild(xpFill);
  xpRow.append(levelText, xpTrack);

  const death = document.createElement("div");
  death.className = "hud-death";
  death.style.display = "none";

  card.append(row1, notice);
  if (isDesktop) card.appendChild(graphSvg);
  card.append(xpRow, death);

  // ── 타임라인 ──
  const tlWrap = document.createElement("div");
  tlWrap.className = "hud-timeline-wrap";
  const tlTrack = document.createElement("div");
  tlTrack.className = "hud-timeline";
  const tlFill = document.createElement("div");
  tlFill.className = "hud-timeline-fill";
  tlTrack.appendChild(tlFill);
  tlWrap.appendChild(tlTrack);

  // ── 범례 ──
  const legend = document.createElement("div");
  legend.className = "hud-legend";
  const legendHeader = document.createElement("div");
  legendHeader.className = "hud-legend-header";
  const legendBody = document.createElement("div");
  legendBody.className = "hud-legend-body";
  legend.append(legendHeader, legendBody);
  let legendOpen = isDesktop;
  legendHeader.addEventListener("click", () => {
    legendOpen = !legendOpen;
    legendSig = ""; // 다시 그리도록
    applyLegend(lastSpecies, lastCounts);
  });

  root.append(card, tlWrap, legend);
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
    // 카드가 좁으니 상위 2개 원인만(가독성).
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
    const sig = `${legendOpen ? 1 : 0}|${species.map((s) => `${s.id}:${s.color}`).join(",")}`;
    if (sig !== legendSig) {
      legendSig = sig;
      legendHeader.textContent = legendOpen ? "종 안내 ▾" : "종 안내 ▸";
      legendBody.replaceChildren();
      legendCounts.length = 0;
      legendBody.style.display = legendOpen ? "block" : "none";
      if (legendOpen) {
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
    }
    // 실시간 개체 수 갱신(텍스트만).
    for (const lc of legendCounts) {
      const next = String(counts.get(lc.id) ?? 0);
      if (lc.el.textContent !== next) lc.el.textContent = next;
    }
  }

  function update(data: HudData): void {
    const { world, statusText } = data;
    const notLobby = statusText !== "";
    root.style.display = notLobby ? "block" : "none";
    if (!notLobby) return;

    const mine = world.playerPopulation;
    statMine.textContent = `내 종 ${mine}`;
    statWild.textContent = `야생 ${world.population - mine}`;
    notice.textContent = statusText;

    dayLabel.textContent = phaseLabel(world.daylight, world.dayPhase);
    dayDot.style.background = dayNightColor(world.daylight);

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

    // 범례는 관전 중에만(드래프트 "카드 선택" 제외).
    const onWatch = !statusText.includes("카드 선택");
    legend.style.display = onWatch ? "block" : "none";
    if (onWatch) {
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
  .hud-root {
    position: fixed; top: 0; left: 0; right: 0; z-index: 8; pointer-events: none;
    padding: calc(8px + env(safe-area-inset-top)) calc(8px + env(safe-area-inset-right)) 0 calc(8px + env(safe-area-inset-left));
    display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
    font-family: var(--font-body);
  }
  /* 정보 카드 — 따뜻한 유리 알약 */
  .hud-card {
    pointer-events: auto; box-sizing: border-box;
    /* 폭을 우상단 컨트롤(1x·⏸) 앞에서 끊는다 — 안 그러면 카드 오른쪽이 버튼 밑으로 파고들어 낮밤 표식이 깔린다. */
    max-width: min(300px, calc(100vw - 128px)); padding: 8px 12px 9px;
    background: var(--panel); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    border: 1px solid var(--line); border-radius: var(--r-panel);
    color: var(--ink); user-select: none;
  }
  /* 개체 수 왼쪽, 낮밤 표식을 바로 그 오른쪽에 붙인다(왼쪽 정렬). 예전 space-between 은 낮밤을 카드
     오른쪽 끝으로 밀어 컨트롤 버튼 밑에 가렸다. */
  .hud-row1 { display: flex; align-items: baseline; justify-content: flex-start; gap: 11px; }
  .hud-stat { display: flex; align-items: baseline; gap: 12px; }
  .hud-stat-mine { font-family: var(--font-title); font-size: 21px; color: var(--ink); }
  .hud-stat-wild { font-family: var(--font-title); font-size: 15px; color: var(--faint); }
  .hud-daynight { display: flex; align-items: center; gap: 6px; flex: none; }
  .hud-day-label { font-family: var(--font-mono); font-size: 11px; color: var(--sub); }
  .hud-day-dot { width: 11px; height: 11px; border-radius: 50%; flex: none; }
  .hud-notice { margin-top: 3px; font-size: 13px; line-height: 1.4; color: var(--sub); white-space: pre-line; }
  .hud-graph { display: block; width: 210px; height: 40px; margin-top: 8px; }
  .hud-xprow { display: flex; align-items: center; gap: 9px; margin-top: 8px; }
  .hud-level { font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: var(--amber); flex: none; }
  .hud-xp-track { flex: 1; height: 9px; border-radius: 5px; background: rgba(255,255,255,0.07); overflow: hidden; }
  .hud-xp-fill { height: 100%; width: 0%; border-radius: 5px; background: var(--amber); transition: width 0.12s linear; }
  .hud-death { margin-top: 7px; font-size: 12.5px; color: var(--red); }

  /* 타임라인 — 얇은 막대 + 보스/멸종 마커 */
  .hud-timeline-wrap { align-self: stretch; padding: 6px 4px 20px; }
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

  /* 범례 — 접이식 "종 안내". 접혔을 땐 내용(제목 한 줄)만큼만 차지하는 칩으로 둔다(전체 폭 바로
     늘어나면 상단이 꽉 막혀 보인다). 펼치면 종 목록에 맞춰 fit-content 가 알아서 넓어진다. */
  .hud-legend {
    pointer-events: auto; box-sizing: border-box; padding: 7px 10px;
    align-self: flex-start; width: fit-content; max-width: min(300px, calc(100vw - 16px));
    background: var(--panel); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
    border: 1px solid var(--line); border-radius: var(--r-card); color: var(--ink); user-select: none; cursor: pointer;
  }
  .hud-legend-header { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em; color: var(--sub); }
  .hud-legend-body { margin-top: 6px; min-width: 132px; }
  .hud-legend-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
  .hud-legend-dot { width: 11px; height: 11px; border-radius: 50%; flex: none; }
  .hud-legend-name { flex: 1; font-size: 13px; color: var(--ink); word-break: keep-all; }
  .hud-legend-count { font-family: var(--font-mono); font-size: 12px; color: var(--sub); flex: none; }
  .hud-legend-food { display: flex; align-items: center; gap: 6px; margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--line); }
  .hud-legend-foodlabel { font-family: var(--font-mono); font-size: 11px; color: var(--sub); margin-right: 6px; }
  .hud-legend-fooddot { width: 10px; height: 10px; border-radius: 50%; flex: none; }

  /* 데스크톱 — 카드/범례는 좌상단, 타임라인은 상단 중앙으로 */
  body[data-layout="desktop"] .hud-timeline-wrap {
    position: absolute; top: 14px; left: 50%; transform: translateX(-50%); width: min(420px, 40vw); align-self: auto; padding: 6px 0 20px;
  }
  `;
  document.head.appendChild(s);
}
