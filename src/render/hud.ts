// 최소 HUD — 실시간 개체 수/먹이/틱 + 개체 수 추이 그래프.
// 추이 그래프(스파크라인)는 천천히 변하는 효과를 폰에서 눈으로 잡게 해준다(가독성, §7).
// 본격 연출(사망 원인·하이라이트·카메라)은 Phase 6.

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { World } from "@/sim/world";
import { COLORS } from "@/config";

const GRAPH_X = 16;
const GRAPH_Y = 80;
const GRAPH_W = 220;
const GRAPH_H = 54;
const SAMPLE_EVERY = 8; // 프레임마다 너무 촘촘하지 않게
const MAX_SAMPLES = 170; // 약 23초 분량(8프레임/60fps × 170)

export class Hud {
  readonly container = new Container();
  private readonly stat: Text;
  private readonly notice: Text;
  private readonly graph = new Graphics();

  private history: number[] = [];
  private maxSeen = 1;
  private frame = 0;

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

    this.container.addChild(this.graph);
    this.container.addChild(this.stat);
    this.container.addChild(this.notice);
  }

  /** 런이 바뀌면 추이를 리셋한다. */
  reset(): void {
    this.history = [];
    this.maxSeen = 1;
    this.frame = 0;
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
    this.drawGraph();
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
}
