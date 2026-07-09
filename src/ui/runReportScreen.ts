// 런 보고서 화면 — 한 혈통(run)이 끝나면 그 일생을 되짚는다. 캔버스 위 HTML 오버레이(결과 화면 위에 뜬다).
// ① 개체 수 추이 ② 형질의 흐름(개체별 진화가 무리 평균으로 드러난다) ③ 연대기(무슨 일이 언제 있었나).
// 결정론·밸런스와 무관 — game 층이 관전 중 남긴 RunHistory 를 읽어 그리기만 한다.
// 문구는 쉬운 말·담백. 그래프는 self-contained SVG(반응형, 세로 화면 우선).

import type { RunHistory, RunSample, RunEvent, RunEventKind } from "@/game/game";
import { MUTABLE_TRAITS, TRAIT_LABELS, type MutableTrait } from "@/sim/genome";
import { ensurePanelStyles } from "@/ui/panelStyles";

export interface RunReportScreen {
  show: (history: RunHistory) => void;
  hide: () => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// 형질별 선 색 — 형질 6색 매핑(고정)과 일치(속도 amber·시야 blue·공격 red·무리 purple·대사 orange·번식 lime).
const TRAIT_COLOR: Record<MutableTrait, string> = {
  speed: "#F5C33B",
  vision: "#5AB0E2",
  attack: "#E85C43",
  herding: "#B98CE0",
  metabolism: "#F2903A",
  fertility: "#8FD14F",
};

// 사건 종류별 점 색 — 연대기에서 무슨 일이었는지 한눈에. 3a 의미 색.
const EVENT_COLOR: Record<RunEventKind, string> = {
  start: "#8FD14F",
  card: "#F5C33B",
  boss: "#E85C43",
  extinction: "#5AB0E2",
  era: "#B98CE0",
  end: "#F5EEE1",
};

export function createRunReportScreen(onClose: () => void): RunReportScreen {
  ensurePanelStyles(); // :root 토큰 보장
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:41; display:none; overflow-y:auto;" +
    "background:var(--bg-report); font-family:var(--font-body);" +
    "-webkit-overflow-scrolling:touch;";

  const panel = document.createElement("div");
  panel.style.cssText =
    "max-width:440px; margin:0 auto; box-sizing:border-box; padding:calc(20px + env(safe-area-inset-top)) 18px 44px; color:var(--ink);";
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const show = (history: RunHistory): void => {
    panel.replaceChildren();

    // 헤더 — 제목 + 닫기(결과 화면으로 돌아간다).
    const head = document.createElement("div");
    head.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:10px;";
    const title = document.createElement("div");
    title.textContent = "이 혈통의 기록";
    title.style.cssText = "font-family:var(--font-title); font-size:20px; color:var(--ink);";
    const close = document.createElement("button");
    close.textContent = "닫기";
    close.style.cssText =
      "flex:none; padding:8px 18px; border:1px solid var(--line); border-radius:999px;" +
      "background:rgba(255,255,255,0.05); color:var(--sub); font-family:var(--font-body); font-size:14px; cursor:pointer;";
    close.addEventListener("click", onClose);
    head.append(title, close);
    panel.appendChild(head);

    const sub = document.createElement("div");
    sub.textContent = `한 종이 걸어온 길. ${history.durationSec}초 동안 개체 수와 형질이 어떻게 움직였는지 되짚습니다.`;
    sub.style.cssText = "margin-top:8px; color:var(--sub); font-size:13px; line-height:1.55; word-break:keep-all;";
    panel.appendChild(sub);

    const samples = history.samples;
    if (samples.length >= 2) {
      panel.appendChild(sectionTitle("개체 수"));
      panel.appendChild(populationGraph(samples));
      panel.appendChild(sectionTitle("형질의 흐름"));
      panel.appendChild(caption("개체마다 조금씩 다른 형질이 세대를 거치며 무리 전체로는 어디로 쏠렸는지. 가운데 점선은 시작값 50."));
      panel.appendChild(traitGraph(samples));
      panel.appendChild(traitLegend());
    }

    panel.appendChild(sectionTitle("연대기"));
    panel.appendChild(chronicle(history.events));

    overlay.scrollTop = 0;
    overlay.style.display = "block";
  };

  const hide = (): void => {
    overlay.style.display = "none";
  };

  return { show, hide };
}

// ─────────── 작은 조립 부품 ───────────

function sectionTitle(text: string): HTMLElement {
  const t = document.createElement("div");
  t.textContent = text;
  t.style.cssText =
    "margin:24px 0 8px; font-family:var(--font-title); font-size:15px; color:var(--ink); letter-spacing:0.02em;";
  return t;
}

function caption(text: string): HTMLElement {
  const c = document.createElement("div");
  c.textContent = text;
  c.style.cssText = "margin:-2px 0 8px; color:var(--faint); font-size:12px; line-height:1.55; word-break:keep-all;";
  return c;
}

function graphFrame(): HTMLElement {
  const box = document.createElement("div");
  box.style.cssText =
    "padding:9px 11px; background:var(--panelSolid); border:1px solid var(--line); border-radius:var(--r-card);";
  return box;
}

function makeSvg(w: number, h: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.cssText = "display:block;";
  return svg;
}

function polyline(points: string, color: string, width: number): SVGPolylineElement {
  const p = document.createElementNS(SVG_NS, "polyline");
  p.setAttribute("points", points);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", color);
  p.setAttribute("stroke-width", String(width));
  p.setAttribute("stroke-linejoin", "round");
  p.setAttribute("stroke-linecap", "round");
  return p;
}

function svgText(x: number, y: number, text: string, color: string, anchor: string): SVGTextElement {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  t.setAttribute("fill", color);
  t.setAttribute("font-size", "9");
  t.setAttribute("text-anchor", anchor);
  t.setAttribute("font-family", "'JetBrains Mono',ui-monospace,monospace");
  t.textContent = text;
  return t;
}

/** 개체 수 추이 — 면적 채운 초록 선. 위기(수가 확 줄어든 골)와 회복이 한눈에 보인다. */
function populationGraph(samples: RunSample[]): HTMLElement {
  const box = graphFrame();
  const W = 300;
  const H = 96;
  const PADX = 4;
  const PADT = 12;
  const PADB = 12;
  const svg = makeSvg(W, H);
  const tMax = samples[samples.length - 1]!.t || 1;
  const pMax = Math.max(1, ...samples.map((s) => s.population));
  const x = (t: number): number => PADX + (t / tMax) * (W - 2 * PADX);
  const y = (v: number): number => PADT + (1 - v / pMax) * (H - PADT - PADB);

  // 면적(선 아래를 옅게 채운다) + 선.
  const linePts = samples.map((s) => `${x(s.t).toFixed(1)},${y(s.population).toFixed(1)}`);
  const areaPts = `${x(0).toFixed(1)},${(H - PADB).toFixed(1)} ${linePts.join(" ")} ${x(tMax).toFixed(1)},${(H - PADB).toFixed(1)}`;
  const area = document.createElementNS(SVG_NS, "polygon");
  area.setAttribute("points", areaPts);
  area.setAttribute("fill", "#8FD14F");
  area.setAttribute("fill-opacity", "0.16");
  svg.appendChild(area);
  svg.appendChild(polyline(linePts.join(" "), "#8FD14F", 2));

  // 최댓값·끝시간 라벨.
  svg.appendChild(svgText(PADX, PADT - 3, `최대 ${pMax}`, "#8C7C68", "start"));
  svg.appendChild(svgText(W - PADX, H - 2, `${tMax}초`, "#8C7C68", "end"));
  box.appendChild(svg);
  return box;
}

/** 형질의 흐름 — 변이 6종의 무리 평균 꺾은선(공통 스케일). 시작값 50 기준선을 함께 그려 방향을 읽게 한다. */
function traitGraph(samples: RunSample[]): HTMLElement {
  const box = graphFrame();
  const W = 300;
  const H = 132;
  const PADX = 4;
  const PADT = 8;
  const PADB = 12;
  const svg = makeSvg(W, H);
  const tMax = samples[samples.length - 1]!.t || 1; // 시간축은 전체 기준
  // 멸종 순간의 최종 샘플은 개체 수 0이라 형질 평균도 0으로 찍힌다 — 형질 그래프에선 빼야 "0으로 급락"하는
  // 착시(진화가 아니라 멸종 아티팩트)가 안 생긴다. 개체가 살아있는 샘플만 형질 선으로 그린다.
  const live = samples.filter((s) => s.population > 0);
  const pts = live.length >= 2 ? live : samples;

  // 모든 형질·모든 시점을 아우르는 공통 y 범위(여유를 둬 선이 천장·바닥에 붙지 않게).
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of pts) {
    for (const k of MUTABLE_TRAITS) {
      const v = s.traits[k];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 100;
  }
  const margin = Math.max(4, (hi - lo) * 0.15);
  lo -= margin;
  hi += margin;
  if (hi - lo < 1) hi = lo + 1;
  const x = (t: number): number => PADX + (t / tMax) * (W - 2 * PADX);
  const y = (v: number): number => PADT + (1 - (v - lo) / (hi - lo)) * (H - PADT - PADB);

  // 시작값 50 기준선(범위 안일 때만).
  if (lo <= 50 && hi >= 50) {
    const base = document.createElementNS(SVG_NS, "line");
    base.setAttribute("x1", String(x(0)));
    base.setAttribute("x2", String(x(tMax)));
    base.setAttribute("y1", y(50).toFixed(1));
    base.setAttribute("y2", y(50).toFixed(1));
    base.setAttribute("stroke", "#4a4234");
    base.setAttribute("stroke-width", "1");
    base.setAttribute("stroke-dasharray", "3 3");
    svg.appendChild(base);
    svg.appendChild(svgText(PADX, y(50) - 3, "50", "#8C7C68", "start"));
  }

  for (const k of MUTABLE_TRAITS) {
    const line = pts.map((s) => `${x(s.t).toFixed(1)},${y(s.traits[k]).toFixed(1)}`).join(" ");
    svg.appendChild(polyline(line, TRAIT_COLOR[k], 1.8));
  }
  box.appendChild(svg);
  return box;
}

function traitLegend(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex; flex-wrap:wrap; gap:7px 14px; margin-top:10px;";
  for (const k of MUTABLE_TRAITS) {
    const item = document.createElement("div");
    item.style.cssText = "display:flex; align-items:center; gap:6px;";
    const sw = document.createElement("span");
    sw.style.cssText = `flex:none; width:13px; height:3px; border-radius:2px; background:${TRAIT_COLOR[k]};`;
    const lb = document.createElement("span");
    lb.textContent = TRAIT_LABELS[k];
    lb.style.cssText = "font-size:12px; color:var(--sub);";
    item.append(sw, lb);
    wrap.appendChild(item);
  }
  return wrap;
}

/** 연대기 — 사건을 시간순으로. 시각 · 색 점 · 한 줄. */
function chronicle(events: RunEvent[]): HTMLElement {
  const list = document.createElement("div");
  list.style.cssText = "display:flex; flex-direction:column; margin-top:2px;";
  if (events.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "남긴 자취가 없습니다.";
    empty.style.cssText = "color:var(--faint); font-size:13px; padding:8px 0;";
    list.appendChild(empty);
    return list;
  }
  events.forEach((e) => {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex; align-items:flex-start; gap:10px; padding:8px 0; border-top:1px solid var(--line);";
    const time = document.createElement("div");
    time.textContent = `${e.t}초`;
    time.style.cssText =
      "flex:none; width:42px; color:var(--faint); font-family:var(--font-mono); font-size:12px; font-variant-numeric:tabular-nums; padding-top:2px;";
    const dot = document.createElement("div");
    dot.style.cssText =
      `flex:none; width:9px; height:9px; border-radius:50%; margin-top:4px; background:${EVENT_COLOR[e.kind]};`;
    const label = document.createElement("div");
    label.textContent = e.label;
    label.style.cssText = "flex:1; font-size:14px; color:var(--ink); line-height:1.45; word-break:keep-all;";
    row.append(time, dot, label);
    list.appendChild(row);
  });
  return list;
}
