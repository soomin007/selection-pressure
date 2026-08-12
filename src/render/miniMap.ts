// 미니맵 — 큰 맵(3배)에서 전체를 한눈에. 카메라가 일부만 보여주므로 조망용으로 거의 필수.
// 지형(바다/육지/산)을 축소해 1회 그리고, 매 프레임 내 무리·보스·현재 보는 영역(뷰포트)을 얹는다.
// sim 상태를 "읽기"만 한다. 화면 좌표(app.stage 직속) — 카메라 변환 밖이라 항상 모서리 고정.

import { Container, Graphics, Rectangle, type FederatedPointerEvent } from "pixi.js";
import { COLORS } from "@/config";
import type { World } from "@/sim/world";
import { TILE } from "@/sim/terrain";

const MM_W = 84; // 미니맵 폭(px). 높이는 월드 종횡비로 결정. HUD 갈아엎기(2026-08-02)에서 한 단계 축소.
// 화면 위에서 미니맵까지의 거리(px, ui 배율 전). 상단에는 이제 목표 한 줄(goalBar, ~54px)뿐이라
// 그 바로 아래 선다. 노치(safe-area)는 goalBar 가 이미 지나 있다. ⚠ scripts/overlap-check.mjs 가
// 이 상수들을 복제한다 — 바꾸면 거기도 같이.
const MM_TOP = 64;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class Minimap {
  readonly container = new Container();
  private readonly bgG = new Graphics();
  private readonly terrainG = new Graphics();
  private readonly dynG = new Graphics();
  private terrainRef: World["terrain"] | null = null; // 새 런(지형 바뀜) 감지용
  private scale = 1;
  private mmH = 0;
  private ui = 1; // 데스크톱 UI 확대 배율(main.applyUiScale) — 배치·탭 판정에 같은 배율 적용
  private dragging = false;
  /** 미니맵을 누르거나 끌면 그 지점의 월드 좌표를 넘긴다(수동 카메라 팬). main 이 카메라에 반영. */
  onPan: ((worldX: number, worldY: number) => void) | null = null;

  /** 지금 미니맵을 누르고(쥐고) 있는가 — 훔쳐보기 자동 복귀 타이머가 손을 뗄 때까지 멈추도록 main 이
   *  읽는다. onPan 은 누르는 순간과 움직일 때만 오므로, 가만히 누르고 있는 상태는 이 값으로만 안다. */
  get panHeld(): boolean {
    return this.dragging;
  }

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
      .roundRect(-4, -4, MM_W + 8, this.mmH + 8, 6)
      .fill({ color: 0x1a140e, alpha: 0.82 }) // 따뜻한 흙빛 프레임(3a 토큰)
      .stroke({ color: 0x3a352c, width: 1, alpha: 0.95 });
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

    // 내 무리 — 작은 lime 점(내 종만; 야생은 배경 지형으로 충분).
    for (const e of world.entities) {
      if (e.species.isPlayer) this.dynG.rect(e.x * s - 0.6, e.y * s - 0.6, 1.6, 1.6).fill(0x8fd14f);
    }

    // 보스 — 눈에 띄는 red(3a 위협 색).
    //
    // ⚠ **자리가 있는 위협만 찍는다** (2026-08-10 · **[사용자]** "독안개 때 맵에 마치 보스처럼
    //   빨간 점이 뜨는 문제"). 독 안개는 **전역**이라 좌표에 아무 뜻이 없다 — 그 점을 따라가도
    //   거기 무엇이 있지 않고, 오히려 「저기를 피하면 된다」는 거짓 정보를 준다.
    //   `boss.ts` 의 독 안개 스펙은 이미 "보스 점도 안 그린다"고 적어 뒀는데 **코드가 그 약속을
    //   안 지키고 있었다** — 규칙을 글로만 적어 두면 이렇게 조용히 갈라진다.
    //   판정은 「국소적인가」다: 닿으면 죽는 반경이나 눈에 보이는 오라가 있어야 자리가 뜻을 갖는다.
    //   (독 안개는 둘 다 0 이고, 대신 `worldView` 가 **흡수가 실제로 걸리는 칸**에 안개를 칠한다.)
    const boss = world.boss;
    if (boss && (boss.auraRadius > 0 || boss.killRadius > 0)) {
      this.dynG.circle(boss.x * s, boss.y * s, 2.4).fill(0xe85c43);
    }

    // 황금 고블린(시험 「금빛 짐승 잡기」) — 무리에서 떨어진 곳에 뜨는 목표라 **미니맵이 방향 표시다**
    // (화면 밖이면 이 점이 유일한 단서 · 첫 시대는 세계가 한 화면이라 미니맵 없이도 늘 보인다).
    // 방울 점(1.9px)보다 크고, 링을 둘러 "물건"이 아니라 "쫓을 것"으로 읽히게 한다.
    const gb = world.goblin;
    if (gb !== null) {
      this.dynG.circle(gb.x * s, gb.y * s, 2.6).fill(0xffd24a);
      this.dynG.circle(gb.x * s, gb.y * s, 4.2).stroke({ color: 0xffd24a, width: 1, alpha: 0.8 });
    }

    // 방울(유전자 점수) · 아직 안 주운 것만 금빛 점으로. **화면 밖 방울을 여기서 세어 볼 수 있다.**
    // 화면 가장자리 쐐기(render/geneDrops.ts)는 「어느 쪽인가」만 말하고 가까운 셋까지만 그린다 →
    // 「지금 이 세계에 몇 개가 어디 남았나」는 이 지도가 아니면 알 길이 없다.
    // 내 무리 점(1.6px lime 사각)보다 크고 둥글어 섞이지 않는다. 색은 필드의 방울과 같은 값이다.
    for (const d of world.geneDrops) {
      if (!d.taken) this.dynG.circle(d.x * s, d.y * s, 1.9).fill(COLORS.gene);
    }

    // 알파(조종 중인 앞장 개체) — 기본 줌이 2.2 로 오르며 미니맵이 사실상 유일한 조망 수단이 됐다.
    // "내가 지금 어디인가"가 즉시 읽혀야 하므로 내 종 점(1.6px lime)보다 밝고 큰 흰 점 + 링으로 띄운다.
    // 색은 월드의 알파 표식(청백 0xf0f8ff 계열)과 이어진다. 관전(?watch)은 leaderId<0 라 아무것도 안 뜬다.
    const lid = world.lead.leaderId;
    if (lid >= 0) {
      for (const e of world.entities) {
        if (e.id !== lid) continue;
        this.dynG.circle(e.x * s, e.y * s, 2.8).stroke({ color: 0xffffff, width: 1, alpha: 0.95 });
        this.dynG.circle(e.x * s, e.y * s, 1.4).fill(0xffffff);
        break;
      }
    }

    // 현재 보는 영역(카메라 뷰포트) — 화면 절반을 월드 좌표로 환산해 사각형으로.
    const halfW = (screenW / (2 * zoom)) * s;
    const halfH = (screenH / (2 * zoom)) * s;
    this.dynG
      .rect(camX * s - halfW, camY * s - halfH, halfW * 2, halfH * 2)
      .stroke({ color: 0xffffff, width: 1, alpha: 0.7 });
  }

  /** 데스크톱 UI 확대 — 미니맵 패널 전체를 배율만큼 키운다. 드래그 좌표는 toLocal 이 스케일을 반영. */
  setUiScale(s: number): void {
    this.ui = s;
    this.container.scale.set(s);
  }

  /** 화면 우하단 등 모서리에 배치(여백 margin). 확대 배율만큼 커진 실제 크기로 계산한다. */
  place(screenW: number, screenH: number, margin = 10): void {
    // **우상단.** 탭 명령 조종이라 화면 아래쪽은 월드를 탭하는 손이 오간다. 미니맵이 아래 있으면
    // 손에 가리거나 손이 미니맵을 누른다. 상단 **왼쪽**은 목표 한 줄과 그 아래로 펼쳐지는
    // 패널이 이미 쓰므로 빈 쪽인 오른쪽에 둔다.
    // 세로 오프셋은 노치(safe-area)까지 감안해 넉넉히. 겹치면 지도가 아니라 방해물이다.
    // screenH 는 이제 안 쓰지만 호출부 시그니처를 유지한다(다른 배치로 되돌릴 때를 위해).
    void screenH;
    this.container.position.set(screenW - (MM_W + margin) * this.ui, MM_TOP * this.ui);
  }

  /** 화면 좌표(px)가 미니맵 패널 위인지 — 미니맵을 탭했을 때 뒤의 개체가 선택되지 않게 막는다. */
  containsScreenPoint(x: number, y: number): boolean {
    const p = this.container.position;
    const u = this.ui;
    return x >= p.x - 4 * u && x <= p.x + (MM_W + 4) * u && y >= p.y - 4 * u && y <= p.y + (this.mmH + 4) * u;
  }

  get height(): number {
    return this.mmH;
  }
}
