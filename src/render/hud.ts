// 최소 HUD — 실시간 개체 수/먹이 + 개체 수 추이 그래프 + 최근 사망 원인 피드.
// 추이 그래프와 사망 피드는 "왜 줄어드나"를 관전 중에 바로 읽게 해준다(가독성, §7).

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { World } from "@/sim/world";
import type { DeathCause, DeathTally } from "@/sim/world";
import type { Species } from "@/sim/species";
import { COLORS } from "@/config";

const GRAPH_X = 16;
const GRAPH_Y = 80;
const GRAPH_W = 220;
const GRAPH_H = 54;
const SAMPLE_EVERY = 8; // 프레임마다 너무 촘촘하지 않게
const MAX_SAMPLES = 170; // 약 23초 분량(8프레임/60fps × 170)
const DEATH_INTERVAL = 48; // 사망 피드 갱신 주기(프레임)

// 종/먹이 색 범례 — 좌측 그래프·사망피드 아래에 고정(HUD 는 화면 픽셀 공간이라 좌측 고정 좌표).
const LEGEND_X = 16;
const LEGEND_Y = 168;
const LEGEND_W = 150;
const LEGEND_PAD = 7;
const LEGEND_ROW = 18;
const LEGEND_SWATCH = 6; // 색 동그라미 반지름

// worldView.ts 의 FOOD_COLORS 와 동기화 유지(먹이 종류별 색: 연두 / 청록 / 노랑풀).
const FOOD_LEGEND_COLORS: readonly number[] = [0x9bee5a, 0x5ad6b0, 0xd8de5a];

const CAUSE_LABEL: Record<DeathCause, string> = {
  starve: "굶음",
  cold: "추위",
  heat: "더위",
  age: "노화",
  boss: "보스",
  predation: "잡아먹힘",
};

export class Hud {
  readonly container = new Container();
  private readonly stat: Text;
  private readonly notice: Text;
  private readonly deathFeed: Text;
  private readonly graph = new Graphics();

  private history: number[] = [];
  private maxSeen = 1;
  private frame = 0;
  private prevDeaths: DeathTally | null = null;

  // 종/먹이 색 범례(거의 정적 — 종 구성이 바뀔 때만 다시 그린다).
  private readonly legend = new Container();
  private readonly legendBgG = new Graphics();
  private readonly legendG = new Graphics();
  private legendSig = "";
  private readonly legendTitleStyle = new TextStyle({
    fill: COLORS.textDim,
    fontSize: 13,
    fontWeight: "600",
  });
  private readonly legendItemStyle = new TextStyle({ fill: COLORS.text, fontSize: 14 });

  constructor() {
    this.stat = new Text({
      text: "",
      style: new TextStyle({ fill: COLORS.text, fontSize: 22, fontWeight: "600" }),
    });
    this.stat.position.set(16, 14);

    this.notice = new Text({
      text: "",
      style: new TextStyle({ fill: COLORS.textDim, fontSize: 20 }),
    });
    this.notice.position.set(16, 44);

    this.deathFeed = new Text({
      text: "",
      style: new TextStyle({ fill: 0xffba8a, fontSize: 15 }),
    });
    this.deathFeed.position.set(GRAPH_X, GRAPH_Y + GRAPH_H + 8);

    this.container.addChild(this.graph);
    this.container.addChild(this.stat);
    this.container.addChild(this.notice);
    this.container.addChild(this.deathFeed);

    // 범례: 배경(맨 뒤) → 색 동그라미/구분선 → 이름 텍스트(updateLegend 에서 추가) 순.
    this.legend.position.set(LEGEND_X, LEGEND_Y);
    this.legend.addChild(this.legendBgG);
    this.legend.addChild(this.legendG);
    this.container.addChild(this.legend);
  }

  /** 런이 바뀌면 추이·사망 피드를 리셋한다. */
  reset(): void {
    this.history = [];
    this.maxSeen = 1;
    this.frame = 0;
    this.prevDeaths = null;
    this.deathFeed.text = "";
    this.legendSig = ""; // 새 런에서 종 구성이 바뀌면 다시 그리도록
  }

  sync(world: World, statusText: string): void {
    const mine = world.playerPopulation;
    this.stat.text = `내 종 ${mine}   야생 ${world.population - mine}`;
    this.notice.text = statusText;

    this.frame += 1;
    if (this.frame % SAMPLE_EVERY === 0) {
      this.history.push(mine);
      if (this.history.length > MAX_SAMPLES) this.history.shift();
      if (mine > this.maxSeen) this.maxSeen = mine;
    }
    if (this.frame % DEATH_INTERVAL === 0) this.updateDeathFeed(world.deaths);
    this.updateLegend(world.species);
    // 범례는 관전 중에만 — 로비(빈 상태줄)·드래프트(카드 선택)에선 숨겨 패널과 안 겹치게.
    this.legend.visible = statusText !== "" && !statusText.includes("카드 선택");
    this.drawGraph();
  }

  /** 최근 구간에 내 종이 어떤 원인으로 죽었는지 한 줄로. */
  private updateDeathFeed(deaths: DeathTally): void {
    if (!this.prevDeaths) {
      this.prevDeaths = { ...deaths };
      this.deathFeed.text = "";
      return;
    }
    const parts: string[] = [];
    for (const cause of Object.keys(deaths) as DeathCause[]) {
      const delta = deaths[cause] - this.prevDeaths[cause];
      if (delta > 0) parts.push(`${CAUSE_LABEL[cause]} ${delta}`);
    }
    this.prevDeaths = { ...deaths };
    parts.sort((a, b) => Number(b.split(" ")[1]) - Number(a.split(" ")[1]));
    this.deathFeed.text = parts.length ? `최근 사망  ${parts.join("  ·  ")}` : "";
  }

  private drawGraph(): void {
    this.graph.clear();
    this.graph.rect(GRAPH_X, GRAPH_Y, GRAPH_W, GRAPH_H).fill({ color: 0x121722, alpha: 0.55 });
    if (this.history.length < 2) return;

    const n = this.history.length;
    const scaleY = (v: number): number => GRAPH_Y + GRAPH_H - (v / this.maxSeen) * (GRAPH_H - 6) - 3;
    const scaleX = (i: number): number => GRAPH_X + (i / (MAX_SAMPLES - 1)) * GRAPH_W;

    this.graph.moveTo(scaleX(0), scaleY(this.history[0] ?? 0));
    for (let i = 1; i < n; i++) {
      this.graph.lineTo(scaleX(i), scaleY(this.history[i] ?? 0));
    }
    this.graph.stroke({ color: COLORS.accent, width: 2, alpha: 0.95 });
  }

  /** 종(색+이름)·먹이 색 범례를 그린다. 종 구성이 바뀔 때만 다시 그려 가볍다. */
  private updateLegend(species: readonly Species[]): void {
    const sig = species.map((s) => `${s.id}:${s.color}`).join(",");
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
    if (species.length === 0) return;

    let y = LEGEND_PAD;
    const title = new Text({ text: "종 안내", style: this.legendTitleStyle });
    title.position.set(LEGEND_PAD, y);
    this.legend.addChild(title);
    y += 18;

    for (const sp of species) {
      const cx = LEGEND_PAD + LEGEND_SWATCH;
      const cy = y + LEGEND_ROW / 2;
      this.legendG.circle(cx, cy, LEGEND_SWATCH).fill({ color: sp.color });
      if (sp.isPlayer) {
        // 화면 속 내 종 초록 고리와 맞춰 범례에서도 내 종임을 표시.
        this.legendG.circle(cx, cy, LEGEND_SWATCH + 2).stroke({ color: 0xaaffb0, width: 1.5 });
      }
      const label = new Text({ text: sp.name, style: this.legendItemStyle });
      label.position.set(LEGEND_PAD + LEGEND_SWATCH * 2 + 6, y);
      this.legend.addChild(label);
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

    // 배경 패널 — legendBgG 는 첫 자식이라 항상 텍스트·동그라미 뒤에 렌더된다.
    // 어두운 월드에 묻히지 않게 불투명도↑ + 옅은 테두리로 또렷하게.
    this.legendBgG
      .roundRect(0, 0, LEGEND_W, y + 2, 8)
      .fill({ color: 0x0c1018, alpha: 0.88 })
      .stroke({ color: 0x3b465c, width: 1, alpha: 0.95 });
  }
}
