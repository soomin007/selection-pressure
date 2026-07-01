// 미니맵 — 큰 맵(3배)에서 전체를 한눈에. 카메라가 일부만 보여주므로 조망용으로 거의 필수.
// 지형(바다/육지/산)을 축소해 1회 그리고, 매 프레임 내 무리·보스·현재 보는 영역(뷰포트)을 얹는다.
// sim 상태를 "읽기"만 한다. 화면 좌표(app.stage 직속) — 카메라 변환 밖이라 항상 모서리 고정.

import { Container, Graphics, Rectangle, type FederatedPointerEvent } from "pixi.js";
import type { World } from "@/sim/world";
import { TILE } from "@/sim/terrain";

const MM_W = 100; // 미니맵 폭(px). 높이는 월드 종횡비로 결정.

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class Minimap {
  readonly container = new Container();
  private readonly bgG = new Graphics();
  private readonly terrainG = new Graphics();
  private readonly dynG = new Graphics();
  private terrainRef: World["terrain"] | null = null; // 새 런(지형 바뀜) 감지용
  private scale = 1;
  private mmH = 0;
  private dragging = false;
  /** 미니맵을 누르거나 끌면 그 지점의 월드 좌표를 넘긴다(수동 카메라 팬). main 이 카메라에 반영. */
  onPan: ((worldX: number, worldY: number) => void) | null = null;

  constructor() {
    this.container.addChild(this.bgG);
    this.container.addChild(this.terrainG);
    this.container.addChild(this.dynG);

    // 미니맵을 눌러/끌어 카메라를 옮긴다. 드래그가 미니맵 밖으로 나가도 globalpointermove 로 계속 추적.
    this.container.eventMode = "static";
    this.container.cursor = "pointer";
    this.container.on("pointerdown", (e: FederatedPointerEvent) => {
      this.dragging = true;
      this.emitPan(e);
    });
    this.container.on("globalpointermove", (e: FederatedPointerEvent) => {
      if (this.dragging) this.emitPan(e);
    });
    const end = (): void => {
      this.dragging = false;
    };
    this.container.on("pointerup", end);
    this.container.on("pointerupoutside", end);
  }

  /** 미니맵 위 포인터 지점 → 월드 좌표로 환산해 onPan 에 넘긴다(월드 범위로 클램프). */
  private emitPan(e: FederatedPointerEvent): void {
    if (this.scale <= 0) return;
    const local = this.container.toLocal(e.global);
    const worldW = MM_W / this.scale;
    const worldH = this.mmH / this.scale;
    this.onPan?.(clamp(local.x / this.scale, 0, worldW), clamp(local.y / this.scale, 0, worldH));
  }

  /** 지형(정적)을 축소해 그린다. 새 런(terrain 참조가 바뀜)일 때만 다시 그려 가볍다. */
  private drawTerrain(world: World): void {
    this.terrainRef = world.terrain;
    this.scale = MM_W / world.width;
    this.mmH = world.height * this.scale;
    const terr = world.terrain;
    const px = terr.cellSize * this.scale;

    this.bgG.clear();
    this.bgG
      .roundRect(-3, -3, MM_W + 6, this.mmH + 6, 5)
      .fill({ color: 0x0c1018, alpha: 0.82 })
      .stroke({ color: 0x3b465c, width: 1, alpha: 0.95 });
    // 드래그 히트 영역(패널 크기가 월드 종횡비로 정해지므로 여기서 갱신).
    this.container.hitArea = new Rectangle(-3, -3, MM_W + 6, this.mmH + 6);

    this.terrainG.clear();
    for (let cy = 0; cy < terr.rows; cy++) {
      for (let cx = 0; cx < terr.cols; cx++) {
        const k = terr.tiles[cy * terr.cols + cx];
        const color = k === TILE.water ? 0x21456a : k === TILE.mountain ? 0x6b6b74 : 0x33502f;
        this.terrainG.rect(cx * px, cy * px, px + 0.6, px + 0.6).fill(color);
      }
    }
  }

  /** 매 프레임 — 내 무리(초록 점) · 보스(빨강) · 현재 보는 영역(흰 사각형). */
  sync(world: World, camX: number, camY: number, zoom: number, screenW: number, screenH: number): void {
    if (world.terrain !== this.terrainRef) this.drawTerrain(world);
    const s = this.scale;
    this.dynG.clear();

    // 내 무리 — 작은 초록 점(내 종만; 야생은 배경 지형으로 충분).
    for (const e of world.entities) {
      if (e.species.isPlayer) this.dynG.rect(e.x * s - 0.6, e.y * s - 0.6, 1.6, 1.6).fill(0x7cff88);
    }

    // 보스 — 눈에 띄는 빨강.
    const boss = world.boss;
    if (boss) this.dynG.circle(boss.x * s, boss.y * s, 2.4).fill(0xff4030);

    // 현재 보는 영역(카메라 뷰포트) — 화면 절반을 월드 좌표로 환산해 사각형으로.
    const halfW = (screenW / (2 * zoom)) * s;
    const halfH = (screenH / (2 * zoom)) * s;
    this.dynG
      .rect(camX * s - halfW, camY * s - halfH, halfW * 2, halfH * 2)
      .stroke({ color: 0xffffff, width: 1, alpha: 0.7 });
  }

  /** 화면 우하단 등 모서리에 배치(여백 margin). */
  place(screenW: number, screenH: number, margin = 10): void {
    this.container.position.set(screenW - MM_W - margin, screenH - this.mmH - margin);
  }

  /** 화면 좌표(px)가 미니맵 패널 위인지 — 미니맵을 탭했을 때 뒤의 개체가 선택되지 않게 막는다. */
  containsScreenPoint(x: number, y: number): boolean {
    const p = this.container.position;
    return x >= p.x - 4 && x <= p.x + MM_W + 4 && y >= p.y - 4 && y <= p.y + this.mmH + 4;
  }

  get height(): number {
    return this.mmH;
  }
}
