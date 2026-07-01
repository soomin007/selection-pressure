// 최소 HUD — 정보 박스(내 종/야생 수 · 단계·시간·환경, 죽을 때만 사망 알림) + 종/먹이 색 범례(접이식).
// 레이아웃별 최적화: 모바일은 슬림(그래프 X, 패널 접힘), 데스크톱은 추이 그래프 포함 + 패널 펼침.

import { Container, Graphics, Rectangle, Text, TextStyle } from "pixi.js";
import type { World } from "@/sim/world";
import type { DeathCause, DeathTally } from "@/sim/world";
import type { Species } from "@/sim/species";
import { COLORS } from "@/config";

const DEATH_INTERVAL = 48; // 사망 알림 갱신 주기(프레임)

// 종/먹이 색 범례 — 정보 박스 아래. Y 는 레이아웃별(데스크톱 박스가 더 길다).
const LEGEND_X = 16;
const LEGEND_W = 150;
const LEGEND_PAD = 7;
const LEGEND_ROW = 18;
const LEGEND_SWATCH = 6; // 색 동그라미 반지름
const LEGEND_Y_MOBILE = 164; // 정보 박스 → 타임라인 막대 → (여기) 범례 순
const LEGEND_Y_DESKTOP = 212;

// 런 진행 타임라인 막대 — 정보 박스 아래(상단 노치에 가리지 않게). full-width, 아래에 마커 라벨.
const TIMELINE_Y_MOBILE = 140;
const TIMELINE_Y_DESKTOP = 188;
const TIMELINE_H = 8;

// worldView.ts 의 FOOD_COLORS 와 동기화 유지(먹이 종류별 색: 연두 / 청록 / 노랑풀).
const FOOD_LEGEND_COLORS: readonly number[] = [0x9bee5a, 0x5ad6b0, 0xd8de5a];

/** 밝기·진행도로 낮밤 단계 라벨. 노을(정오→자정, phase<0.5) vs 새벽(자정→정오)을 phase 로 가른다. */
function phaseLabel(daylight: number, phase: number): string {
  if (daylight >= 0.66) return "낮";
  if (daylight < 0.33) return "밤";
  return phase < 0.5 ? "노을" : "새벽";
}

/** 두 색(0xRRGGBB)을 t(0~1)로 선형 보간. */
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

// 정보 박스 — 모바일은 슬림(내 종+상태), 데스크톱은 추이 그래프까지. 사망 알림은 죽을 때만 한 줄 추가.
const PANEL_X = 8;
const PANEL_Y = 8;
const PANEL_W = 236;
// 정보 박스 내부 세로 순서: stat → 상태 2줄 → (데스크톱: 추이 그래프) → 경험치 게이지 → 사망 알림.
// 경험치 게이지를 사망 알림 "위"에 둬 둘이 겹치지 않게 한다(박스 높이는 게이지·사망 포함해 늘렸다).
const PANEL_H_MOBILE = 104; // stat + 상태 2줄 + 경험치 게이지
const PANEL_H_MOBILE_DEATH = 128; // + 사망 알림
const PANEL_H_DESKTOP = 154; // stat + 상태 2줄 + 추이 그래프 + 경험치 게이지
const PANEL_H_DESKTOP_DEATH = 176; // + 사망 알림
const DEATH_Y_MOBILE = 108; // 경험치 게이지(88) 아래
const DEATH_Y_DESKTOP = 158; // 경험치 게이지(138) 아래

// 낮밤 타이머 — 정보 박스 둘째 줄(상태) 우측. 개체 수(첫 줄)가 길어져도 겹치지 않게 수직 분리.
const DAY_DOT_X = PANEL_X + PANEL_W - 16;
const DAY_DOT_Y = 52;
const DAY_DOT_COLOR = 0xffd24a; // 낮(밝은 노랑)
const NIGHT_DOT_COLOR = 0x2a3a6a; // 밤(어두운 남색)

// 레벨업 경험치 게이지 — 정보 박스와 범례 사이. 먹이를 먹어 채우면 레벨업(형질 선택).
const XP_LABEL_X = 16;
const XP_BAR_X = 58;
const XP_BAR_W = 172;
const XP_BAR_H = 9;
const XP_Y_MOBILE = 88; // 정보 박스 안, 상태 2줄 아래 · 사망 알림(108) 위
const XP_Y_DESKTOP = 138; // 정보 박스 안, 추이 그래프 아래 · 사망 알림(158) 위
const XP_FILL_COLOR = 0xffd24a;

// 추이 그래프(데스크톱 전용) — 정보 박스 안 스파크라인.
const GRAPH_X = 16;
const GRAPH_Y = 88;
const GRAPH_W = 210;
const GRAPH_H = 46;
const SAMPLE_EVERY = 8; // 프레임마다 너무 촘촘하지 않게
const MAX_SAMPLES = 150;

const CAUSE_LABEL: Record<DeathCause, string> = {
  starve: "굶음",
  cold: "추위",
  heat: "더위",
  age: "노화",
  boss: "보스",
  predation: "잡아먹힘",
  plague: "역병",
};

export class Hud {
  readonly container = new Container();
  private readonly isDesktop =
    typeof document !== "undefined" && document.body?.dataset.layout === "desktop";
  private readonly stat: Text;
  private readonly notice: Text;
  private readonly deathFeed: Text;
  private readonly dayDot = new Graphics(); // 낮밤 색 원(노랑=낮, 남색=밤)
  private readonly dayLabel: Text; // 낮/노을/밤/새벽
  private readonly xpG = new Graphics(); // 레벨업 경험치 게이지 바
  private readonly levelText: Text; // Lv.N
  private readonly timelineG = new Graphics(); // 런 전체 진행 타임라인(긴 막대 + 위협 마커)
  private readonly markerLabels: Text[] = []; // 타임라인 마커 라벨(보스/멸종) 재사용 풀
  private readonly panelBg = new Graphics();
  private readonly graph = new Graphics(); // 추이 그래프(데스크톱 전용)
  private history: number[] = [];
  private maxSeen = 1;
  private frame = 0;
  private prevDeaths: DeathTally | null = null;

  // 종/먹이 색 범례(거의 정적 — 종 구성이 바뀔 때만 다시 그린다).
  private readonly legend = new Container();
  private readonly legendBgG = new Graphics();
  private readonly legendG = new Graphics();
  private legendSig = "";
  // 레이아웃별 기본값: 데스크톱은 펼침(공간 여유), 모바일은 접힘(클러터 최소화). 탭으로 토글.
  private legendOpen = this.isDesktop;
  private readonly legendTitleStyle = new TextStyle({
    fill: COLORS.textDim,
    fontSize: 13,
    fontWeight: "600",
  });
  private readonly legendItemStyle = new TextStyle({ fill: COLORS.text, fontSize: 14 });
  // 종별 실시간 개체 수(행 우측). 행은 구성이 바뀔 때만 다시 그리고, 수 텍스트만 매 프레임 갱신한다.
  private readonly legendCountStyle = new TextStyle({ fill: 0xbcc6d4, fontSize: 13, fontWeight: "600" });
  private legendCounts: { id: number; text: Text }[] = [];

  constructor() {
    this.stat = new Text({
      text: "",
      style: new TextStyle({ fill: 0xffffff, fontSize: 22, fontWeight: "700" }),
    });
    this.stat.position.set(16, 14);

    this.notice = new Text({
      text: "",
      style: new TextStyle({ fill: 0xccd3df, fontSize: 17, lineHeight: 20 }),
    });
    this.notice.position.set(16, 44);

    this.deathFeed = new Text({
      text: "",
      style: new TextStyle({ fill: 0xffba8a, fontSize: 13 }),
    });
    this.deathFeed.position.set(16, this.isDesktop ? DEATH_Y_DESKTOP : DEATH_Y_MOBILE);

    // 낮밤 타이머 — 정보 박스 우상단. 색 원(낮밤 색) + 라벨(우측 정렬, 원 왼쪽).
    this.dayLabel = new Text({
      text: "",
      style: new TextStyle({ fill: 0xccd3df, fontSize: 12, fontWeight: "600" }),
    });
    this.dayLabel.anchor.set(1, 0);
    this.dayLabel.position.set(DAY_DOT_X - 11, 46);

    // 레벨 라벨(경험치 게이지 왼쪽).
    this.levelText = new Text({
      text: "",
      style: new TextStyle({ fill: XP_FILL_COLOR, fontSize: 13, fontWeight: "800" }),
    });
    this.levelText.position.set(XP_LABEL_X, (this.isDesktop ? XP_Y_DESKTOP : XP_Y_MOBILE) - 3);

    // 정보 박스(맨 뒤) — 글자·그래프의 공용 배경. 사망 알림 유무에 따라 높이만 다시 그린다(drawPanel).
    this.container.addChild(this.panelBg);
    if (this.isDesktop) this.container.addChild(this.graph); // 추이 그래프는 데스크톱만
    this.container.addChild(this.stat);
    this.container.addChild(this.notice);
    this.container.addChild(this.deathFeed);
    this.container.addChild(this.dayDot);
    this.container.addChild(this.dayLabel);
    this.container.addChild(this.timelineG);
    this.container.addChild(this.xpG);
    this.container.addChild(this.levelText);
    this.drawPanel();

    // 범례: 배경(맨 뒤) → 색 동그라미/구분선 → 이름 텍스트(updateLegend 에서 추가) 순.
    this.legend.position.set(LEGEND_X, this.isDesktop ? LEGEND_Y_DESKTOP : LEGEND_Y_MOBILE);
    this.legend.addChild(this.legendBgG);
    this.legend.addChild(this.legendG);
    this.container.addChild(this.legend);

    // 범례를 탭하면 접기/펴기. (HUD 컨테이너는 자식 이벤트 통과용 passive)
    this.container.eventMode = "passive";
    this.legend.eventMode = "static";
    this.legend.cursor = "pointer";
    this.legend.on("pointertap", () => {
      this.legendOpen = !this.legendOpen;
    });
  }

  /** 런이 바뀌면 추이·사망 피드를 리셋한다. */
  reset(): void {
    this.history = [];
    this.maxSeen = 1;
    this.frame = 0;
    this.prevDeaths = null;
    this.deathFeed.text = "";
    this.drawPanel();
    this.legendSig = ""; // 새 런에서 종 구성이 바뀌면 다시 그리도록
  }

  sync(
    world: World,
    statusText: string,
    level: number,
    xpProgress: number,
    timeline: { progress: number; markers: readonly { kind: string; at: number }[] },
    screenW: number,
  ): void {
    const mine = world.playerPopulation;
    this.stat.text = `내 종 ${mine}   야생 ${world.population - mine}`;
    this.notice.text = statusText;
    this.updateDayNight(world);
    this.updateXpGauge(level, xpProgress);
    this.updateTimeline(timeline, screenW);

    this.frame += 1;
    if (this.isDesktop && this.frame % SAMPLE_EVERY === 0) {
      this.history.push(mine);
      if (this.history.length > MAX_SAMPLES) this.history.shift();
      if (mine > this.maxSeen) this.maxSeen = mine;
    }
    if (this.frame % DEATH_INTERVAL === 0) this.updateDeathFeed(world.deaths);
    this.updateLegend(world.species);
    if (this.frame % 6 === 0) this.updateLegendCounts(world); // 종별 실시간 수(가볍게 6프레임마다)

    // 로비(빈 상태줄)에선 정보 박스도 숨김. 범례는 관전 중에만(드래프트="카드 선택" 제외).
    const notLobby = statusText !== "";
    const onWatch = notLobby && !statusText.includes("카드 선택");
    this.panelBg.visible = notLobby;
    this.graph.visible = notLobby; // 그래프는 데스크톱만 컨테이너에 있음
    this.stat.visible = notLobby;
    this.notice.visible = notLobby;
    this.deathFeed.visible = notLobby;
    this.dayDot.visible = notLobby;
    this.dayLabel.visible = notLobby;
    this.timelineG.visible = notLobby;
    if (!notLobby) for (const lbl of this.markerLabels) lbl.visible = false;
    this.xpG.visible = notLobby;
    this.levelText.visible = notLobby;
    this.legend.visible = onWatch;
    this.drawGraph();
  }

  /**
   * 런 전체 진행 타임라인 — 정보 박스 아래 긴 막대(왼→오 차오름) + 보스(빨강)·대멸종(파랑) 시점 마커.
   * 각 마커 아래에 "보스"/"멸종" 라벨을 붙여, 처음 보는 사람도 무슨 위협이 언제 오는지 알 수 있게 한다.
   */
  private updateTimeline(
    timeline: { progress: number; markers: readonly { kind: string; at: number }[] },
    screenW: number,
  ): void {
    const barX = 12;
    const barY = this.isDesktop ? TIMELINE_Y_DESKTOP : TIMELINE_Y_MOBILE;
    const barH = TIMELINE_H;
    const barW = Math.max(60, screenW - 24);
    this.timelineG.clear();
    this.timelineG
      .roundRect(barX, barY, barW, barH, 4)
      .fill({ color: 0x0c1018, alpha: 0.85 })
      .stroke({ color: 0x3b465c, width: 1, alpha: 0.95 });
    const fw = barW * Math.max(0, Math.min(1, timeline.progress));
    if (fw > 1) this.timelineG.roundRect(barX, barY, fw, barH, 4).fill({ color: 0x6cc24a, alpha: 0.9 });
    // 위협 마커(세로 선) + 그 아래 라벨(보스/멸종).
    timeline.markers.forEach((m, i) => {
      const mx = barX + barW * Math.max(0, Math.min(1, m.at));
      const col = m.kind === "boss" ? 0xff5535 : 0x8ab4ff;
      this.timelineG.rect(mx - 1.5, barY - 3, 3, barH + 6).fill({ color: col });
      let label = this.markerLabels[i];
      if (!label) {
        label = new Text({ text: "", style: new TextStyle({ fontSize: 10, fontWeight: "700" }) });
        label.anchor.set(0.5, 0);
        this.container.addChild(label);
        this.markerLabels.push(label);
      }
      label.text = m.kind === "boss" ? "보스" : "멸종";
      label.style.fill = col;
      label.position.set(mx, barY + barH + 2);
      label.visible = true;
    });
    for (let i = timeline.markers.length; i < this.markerLabels.length; i++) {
      const lbl = this.markerLabels[i];
      if (lbl) lbl.visible = false;
    }
  }

  /** 레벨업 경험치 게이지 — 레벨 라벨 + 채움 바(먹이를 먹어 채우면 레벨업). */
  private updateXpGauge(level: number, xpProgress: number): void {
    this.levelText.text = `Lv.${level}`;
    const y = this.isDesktop ? XP_Y_DESKTOP : XP_Y_MOBILE;
    this.xpG.clear();
    this.xpG
      .roundRect(XP_BAR_X, y, XP_BAR_W, XP_BAR_H, 4)
      .fill({ color: 0x11161f, alpha: 0.9 })
      .stroke({ color: 0x3b465c, width: 1, alpha: 0.95 });
    const w = Math.max(0, Math.min(1, xpProgress)) * (XP_BAR_W - 2);
    if (w > 0.5) {
      this.xpG.roundRect(XP_BAR_X + 1, y + 1, w, XP_BAR_H - 2, 3).fill({ color: XP_FILL_COLOR });
    }
  }

  /** 낮밤 타이머 — 정보 박스 우상단의 색 원(낮=노랑↔밤=남색)과 단계 라벨(낮/노을/밤/새벽). */
  private updateDayNight(world: World): void {
    const dl = world.daylight;
    this.dayLabel.text = phaseLabel(dl, world.dayPhase);
    this.dayDot.clear();
    this.dayDot.circle(DAY_DOT_X, DAY_DOT_Y, 6).fill({ color: lerpColor(NIGHT_DOT_COLOR, DAY_DOT_COLOR, dl) });
  }

  /** 최근 구간에 내 종이 어떤 원인으로 죽었는지 한 줄로(죽을 때만 잠깐). */
  private updateDeathFeed(deaths: DeathTally): void {
    if (!this.prevDeaths) {
      this.prevDeaths = { ...deaths };
      this.deathFeed.text = "";
      this.drawPanel();
      return;
    }
    const parts: string[] = [];
    for (const cause of Object.keys(deaths) as DeathCause[]) {
      const delta = deaths[cause] - this.prevDeaths[cause];
      if (delta > 0) parts.push(`${CAUSE_LABEL[cause]} ${delta}`);
    }
    this.prevDeaths = { ...deaths };
    parts.sort((a, b) => Number(b.split(" ")[1]) - Number(a.split(" ")[1]));
    // 박스가 좁으니 상위 2개 원인만(가독성). 사망 알림이 있으면 박스가 한 줄 늘어난다.
    this.deathFeed.text = parts.length ? `사망  ${parts.slice(0, 2).join("  ·  ")}` : "";
    this.drawPanel();
  }

  /** 정보 박스 배경 — 레이아웃(데스크톱은 그래프 포함) + 사망 알림 유무에 따라 높이가 달라진다. */
  private drawPanel(): void {
    const hasDeath = this.deathFeed.text !== "";
    const h = this.isDesktop
      ? hasDeath
        ? PANEL_H_DESKTOP_DEATH
        : PANEL_H_DESKTOP
      : hasDeath
        ? PANEL_H_MOBILE_DEATH
        : PANEL_H_MOBILE;
    this.panelBg.clear();
    this.panelBg
      .roundRect(PANEL_X, PANEL_Y, PANEL_W, h, 10)
      .fill({ color: 0x0c1018, alpha: 0.88 })
      .stroke({ color: 0x3b465c, width: 1, alpha: 0.95 });
  }

  /** 추이 그래프(데스크톱 전용) — 정보 박스 안 스파크라인. */
  private drawGraph(): void {
    if (!this.isDesktop) return;
    this.graph.clear();
    if (this.history.length < 2) return;
    const n = this.history.length;
    const scaleY = (v: number): number => GRAPH_Y + GRAPH_H - (v / this.maxSeen) * (GRAPH_H - 6) - 3;
    const scaleX = (i: number): number => GRAPH_X + (i / (MAX_SAMPLES - 1)) * GRAPH_W;
    this.graph.moveTo(scaleX(0), scaleY(this.history[0] ?? 0));
    for (let i = 1; i < n; i++) this.graph.lineTo(scaleX(i), scaleY(this.history[i] ?? 0));
    this.graph.stroke({ color: COLORS.accent, width: 2, alpha: 0.95 });
  }

  /** 종별 실시간 개체 수를 행 우측에 갱신(텍스트만 — 행 재생성 없이 가볍게). */
  private updateLegendCounts(world: World): void {
    if (this.legendCounts.length === 0) return;
    const counts = new Map<number, number>();
    for (const e of world.entities) counts.set(e.species.id, (counts.get(e.species.id) ?? 0) + 1);
    for (const lc of this.legendCounts) {
      const next = String(counts.get(lc.id) ?? 0);
      if (lc.text.text !== next) lc.text.text = next; // 바뀔 때만 재렌더
    }
  }

  /** 종(색+이름)·먹이 색 범례를 그린다. 종 구성이 바뀔 때만 다시 그려 가볍다. */
  private updateLegend(species: readonly Species[]): void {
    // 접힘 상태도 시그니처에 포함 → 토글 시 다시 그린다.
    const sig = `${this.legendOpen ? 1 : 0}|${species.map((s) => `${s.id}:${s.color}`).join(",")}`;
    if (sig === this.legendSig) return;
    this.legendSig = sig;

    // 이전 이름 텍스트만 정리하고 배경/동그라미 그래픽은 재사용한다.
    for (const child of this.legend.removeChildren()) {
      if (child !== this.legendBgG && child !== this.legendG) child.destroy();
    }
    this.legend.addChild(this.legendBgG);
    this.legend.addChild(this.legendG);
    this.legendBgG.clear();
    this.legendG.clear();
    this.legendCounts = []; // 이전 수 텍스트는 위 removeChildren 에서 파괴됨 → 새로 모은다
    if (species.length === 0) {
      this.legend.hitArea = new Rectangle(0, 0, 0, 0);
      return;
    }

    // 헤더(탭으로 접기/펴기 — 화살표로 상태 표시).
    let y = LEGEND_PAD;
    const header = new Text({
      text: this.legendOpen ? "종 안내 ▾" : "종 안내 ▸",
      style: this.legendTitleStyle,
    });
    header.position.set(LEGEND_PAD, y);
    this.legend.addChild(header);
    y += 18;

    if (this.legendOpen) {
      for (const sp of species) {
        const cx = LEGEND_PAD + LEGEND_SWATCH;
        const cy = y + LEGEND_ROW / 2;
        this.legendG.circle(cx, cy, LEGEND_SWATCH).fill({ color: sp.color });
        if (sp.isPlayer) {
          // 화면 속 내 종 초록 고리와 맞춰 범례에서도 내 종임을 표시.
          this.legendG.circle(cx, cy, LEGEND_SWATCH + 2).stroke({ color: 0xaaffb0, width: 1.5 });
        } else if (sp.friendly) {
          // 우호적 친척 — 화면의 청록 고리와 맞춰 "내 편"임을 표시(야생과 구분).
          this.legendG.circle(cx, cy, LEGEND_SWATCH + 2).stroke({ color: 0x7fffe8, width: 1.5 });
        } else if (sp.faction !== 0) {
          // 야생 동맹 — 화면의 금빛 고리와 맞춰 "저 종들은 한 편"임을 표시.
          this.legendG.circle(cx, cy, LEGEND_SWATCH + 2).stroke({ color: 0xffcf6a, width: 1.3 });
        }
        const label = new Text({ text: sp.name, style: this.legendItemStyle });
        label.position.set(LEGEND_PAD + LEGEND_SWATCH * 2 + 6, y);
        this.legend.addChild(label);
        // 행 우측에 실시간 개체 수(우측 정렬). updateLegendCounts 가 매 프레임 .text 만 갱신.
        const countText = new Text({ text: "", style: this.legendCountStyle });
        countText.anchor.set(1, 0);
        countText.position.set(LEGEND_W - LEGEND_PAD, y);
        this.legend.addChild(countText);
        this.legendCounts.push({ id: sp.id, text: countText });
        y += LEGEND_ROW;
      }

      // 구분선 + 먹이 색(흩어진 색점들이 먹이임을 한눈에).
      y += 4;
      this.legendG
        .moveTo(LEGEND_PAD, y)
        .lineTo(LEGEND_W - LEGEND_PAD, y)
        .stroke({ color: 0x3a4150, width: 1 });
      y += 8;
      const foodLabel = new Text({ text: "먹이", style: this.legendTitleStyle });
      foodLabel.position.set(LEGEND_PAD, y);
      this.legend.addChild(foodLabel);
      let fx = LEGEND_PAD + 44;
      for (const col of FOOD_LEGEND_COLORS) {
        this.legendG.circle(fx, y + 7, 5).fill({ color: col });
        fx += 22;
      }
      y += LEGEND_ROW;
    }

    // 배경 패널 — 접힘이면 헤더만(좁은 칩). legendBgG 는 첫 자식이라 항상 뒤에 렌더된다.
    // 어두운 월드에 묻히지 않게 불투명도↑ + 옅은 테두리로 또렷하게.
    const w = this.legendOpen ? LEGEND_W : 96;
    const h = y + 2;
    this.legendBgG
      .roundRect(0, 0, w, h, 8)
      .fill({ color: 0x0c1018, alpha: 0.88 })
      .stroke({ color: 0x3b465c, width: 1, alpha: 0.95 });
    this.legend.hitArea = new Rectangle(0, 0, w, h);
  }
}
