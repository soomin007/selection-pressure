// 월드 렌더. sim 상태를 "읽기"만 한다. (sim 은 Pixi 를 import 하지 않는다.)
// 생물 = 형질 기반 스프라이트(종마다 게놈에서 텍스처 1장 생성해 재사용 → 가볍다).
//   몸 길쭉함=속도, 눈 크기=시야, 등가시=공격력, 앞주둥이/이빨=식성. 진행 방향으로 회전.
// 배경=환경, 먹이=초록 점, 보스=빨강+위험 반경, 대멸종=화면 틴트.

import { Container, Graphics, Sprite, Texture, type Renderer } from "pixi.js";
import type { World } from "@/sim/world";
import type { Environment } from "@/sim/environment";
import type { Genome } from "@/sim/genome";
import { SIM } from "@/sim/params";

export class WorldView {
  readonly container = new Container();
  private readonly renderer: Renderer;
  private readonly envG = new Graphics();
  private readonly foodG = new Graphics();
  private readonly playerG = new Graphics(); // 내 종 강조(스프라이트 아래 빛나는 고리)
  private readonly creatureLayer = new Container();
  private readonly bossG = new Graphics();
  private readonly overlayG = new Graphics();

  private readonly pool: Sprite[] = [];
  private readonly speciesTex = new Map<number, Texture>();
  private frame = 0;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.container.addChild(this.envG);
    this.container.addChild(this.foodG);
    this.container.addChild(this.playerG);
    this.container.addChild(this.creatureLayer);
    this.container.addChild(this.bossG);
    this.container.addChild(this.overlayG);
  }

  /** 카메라 — 초점(fx,fy)을 화면 중앙에 두고 zoom 배율로. 세계 밖이 안 보이게 클램프. */
  setCamera(fx: number, fy: number, zoom: number, worldW: number, worldH: number): void {
    const halfW = worldW / (2 * zoom);
    const halfH = worldH / (2 * zoom);
    const cx = clampRange(fx, halfW, worldW - halfW);
    const cy = clampRange(fy, halfH, worldH - halfH);
    this.container.scale.set(zoom);
    this.container.pivot.set(cx, cy);
    this.container.position.set(worldW / 2, worldH / 2);
  }

  /** 런이 바뀌거나 내 종 게놈이 바뀌면 호출 — 종별 스프라이트 텍스처를 다시 만든다. */
  refreshSpecies(world: World): void {
    for (const tex of this.speciesTex.values()) tex.destroy(true);
    this.speciesTex.clear();
    for (const sp of world.species) {
      this.speciesTex.set(sp.id, makeCreatureTexture(this.renderer, sp.genome, sp.color));
    }
  }

  /** 런이 바뀔 때 한 번 — 환경 배경. */
  drawEnvironment(env: Environment): void {
    this.envG.clear();
    for (let cy = 0; cy < env.rows; cy++) {
      for (let cx = 0; cx < env.cols; cx++) {
        const i = cy * env.cols + cx;
        const cold = env.coldness[i] ?? 0;
        const fert = env.fertility[i] ?? 0;
        const warm = 1 - cold;
        const lift = 0.5 + 0.75 * fert;
        const r = clamp255((warm * 150 + cold * 28) * lift);
        const g = clamp255((warm * 82 + cold * 78) * lift);
        const b = clamp255((warm * 44 + cold * 156) * lift);
        this.envG
          .rect(cx * env.cellSize, cy * env.cellSize, env.cellSize, env.cellSize)
          .fill({ color: (r << 16) | (g << 8) | b, alpha: 1 });
      }
    }
  }

  sync(world: World, alpha = 1): void {
    this.frame += 1;
    this.foodG.clear();
    for (const f of world.food) {
      if (!f.available) continue;
      this.foodG.circle(f.x, f.y, 4).fill({ color: 0x9bee5a, alpha: 1 });
    }

    // 생물 스프라이트 풀 — sim(30/s)과 화면(60fps) 사이를 prev→현재로 보간해 드득거림을 없앤다.
    this.playerG.clear();
    const ringPulse = 0.5 + 0.5 * Math.sin((this.frame % 70) / 70 * Math.PI * 2);
    let i = 0;
    for (const e of world.entities) {
      const rx = e.prevX + (e.x - e.prevX) * alpha;
      const ry = e.prevY + (e.y - e.prevY) * alpha;

      // 내 종 강조: 스프라이트 아래 은은한 고리(폰에서 "내 무리"가 한눈에).
      if (e.species.isPlayer) {
        this.playerG.circle(rx, ry, 13).fill({ color: 0x6cff7a, alpha: 0.1 });
        this.playerG
          .circle(rx, ry, 12.5)
          .stroke({ color: 0xaaffb0, width: 1.6, alpha: 0.35 + 0.25 * ringPulse });
      }

      let sp = this.pool[i];
      if (!sp) {
        sp = new Sprite();
        sp.anchor.set(0.5);
        this.creatureLayer.addChild(sp);
        this.pool.push(sp);
      }
      sp.texture = this.speciesTex.get(e.species.id) ?? Texture.WHITE;
      sp.x = rx;
      sp.y = ry;
      // 회전은 이번 스텝의 이동 방향(prev→현재)으로 — 스텝 사이 일정해 떨리지 않는다.
      const dx = e.x - e.prevX;
      const dy = e.y - e.prevY;
      if (Math.abs(dx) + Math.abs(dy) > 0.05) sp.rotation = Math.atan2(dy, dx);
      const energy = Math.max(0, Math.min(1, e.energy / SIM.maxEnergy));
      sp.alpha = 0.5 + 0.5 * energy;
      sp.visible = true;
      i++;
    }
    for (; i < this.pool.length; i++) this.pool[i]!.visible = false;

    // 보스 + 위험 반경 (보스도 보간)
    this.bossG.clear();
    const boss = world.boss;
    if (boss) {
      const bx = boss.prevX + (boss.x - boss.prevX) * alpha;
      const by = boss.prevY + (boss.y - boss.prevY) * alpha;
      if (boss.auraRadius > 0) {
        this.bossG.circle(bx, by, boss.auraRadius).fill({ color: 0xc060e0, alpha: 0.18 });
      }
      if (boss.killRadius > 0) {
        this.bossG.circle(bx, by, boss.killRadius).fill({ color: 0xe0402a, alpha: 0.3 });
      }
      // 주목 펄스 — "여기 위험" 시선 유도(가독성, §7)
      const pulse = (this.frame % 60) / 60;
      this.bossG
        .circle(bx, by, 16 + pulse * 26)
        .stroke({ color: 0xff5535, width: 2.5, alpha: 0.55 * (1 - pulse) });
      this.bossG.circle(bx, by, 14).fill({ color: 0xff5535, alpha: 1 });
      this.bossG.circle(bx, by, 14).stroke({ color: 0x3a0d06, width: 3 });
    }

    // 대멸종 화면 틴트
    this.overlayG.clear();
    let tint = 0;
    let tintAlpha = 0;
    if (world.globalCold > 0) {
      tint = 0x3a6cff;
      tintAlpha = 0.16;
    } else if (world.heat > 0) {
      tint = 0xff5a2a;
      tintAlpha = 0.16;
    } else if (world.foodRegrowMultiplier > 1) {
      tint = 0x8a6a3a;
      tintAlpha = 0.14;
    }
    if (tintAlpha > 0)
      this.overlayG.rect(0, 0, world.width, world.height).fill({ color: tint, alpha: tintAlpha });
  }
}

function clamp255(v: number): number {
  const n = Math.round(v);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

function clampRange(v: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2; // zoom 이 1 이하라 범위가 뒤집히면 중앙
  return v < lo ? lo : v > hi ? hi : v;
}

function darken(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 0xff) * f);
  const g = Math.round(((color >> 8) & 0xff) * f);
  const b = Math.round((color & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

// 게놈에서 한 종의 생물 스프라이트 텍스처를 만든다(앞쪽 = +x). 형질이 형태로 드러난다.
// 나중에 더 정교한 아트로 바꿀 땐 이 함수만 손보면 된다.
function makeCreatureTexture(renderer: Renderer, genome: Genome, color: number): Texture {
  const t = genome.traits;
  const g = new Graphics();
  const dark = darken(color, 0.55);

  const len = 9 + t.speed * 6; // 몸 반길이 (빠를수록 길쭉)
  const wid = 7 - t.speed * 2.2; // 몸 반너비

  // 등가시 (공격력) — 위쪽 삼각형들
  const spikes = Math.round(t.attack * 5);
  for (let s = 0; s < spikes; s++) {
    const px = -len * 0.5 + (s / Math.max(1, spikes - 1)) * len;
    const h = 4 + t.attack * 5;
    g.poly([px - 3, -wid, px, -wid - h, px + 3, -wid]).fill({ color: dark });
  }

  // 몸통
  g.ellipse(0, 0, len, wid).fill({ color }).stroke({ color: dark, width: 2 });

  // 식성별 앞부분
  if (t.diet > SIM.dietGrazeMax) {
    // 육식 — 뾰족한 주둥이 + 이빨
    const snout = 7 + t.diet * 7;
    g.poly([len - 2, -wid * 0.55, len - 2 + snout, 0, len - 2, wid * 0.55]).fill({ color });
    g.poly([len + snout * 0.5, -1.5, len + snout, 0, len + snout * 0.5, 1.5]).fill({
      color: 0xffffff,
    });
  } else if (t.diet > SIM.dietHuntMin) {
    // 잡식 — 둥근 주둥이
    g.circle(len, 0, wid * 0.5).fill({ color });
  } else {
    // 초식 — 위쪽 작은 귀 두 개
    g.circle(len * 0.2, -wid, 3).fill({ color });
    g.circle(len * 0.2 + 6, -wid, 3).fill({ color });
  }

  // 눈 (시야)
  const eye = 1.8 + t.vision * 3.2;
  g.circle(len * 0.5, -wid * 0.35, eye).fill({ color: 0xffffff });
  g.circle(len * 0.5 + eye * 0.3, -wid * 0.35, eye * 0.55).fill({ color: 0x0a0a0a });

  // 고해상도로 생성(작은 스프라이트가 뭉개지지 않게 슈퍼샘플).
  const tex = renderer.generateTexture({ target: g, resolution: 3, antialias: true });
  g.destroy();
  return tex;
}
