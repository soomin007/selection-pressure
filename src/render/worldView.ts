// 월드 렌더. sim 상태를 "읽기"만 한다. (sim 은 Pixi 를 import 하지 않는다.)
// 생물 = 형질 기반 스프라이트(종마다 게놈에서 텍스처 1장 생성해 재사용 → 가볍다).
//   몸 길쭉함=속도, 눈 크기=시야, 등가시=공격력, 앞주둥이/이빨=식성. 진행 방향으로 회전.
// 배경=환경, 먹이=초록 점, 보스=빨강+위험 반경, 대멸종=화면 틴트.

import { Container, Graphics, Sprite, Texture, type Renderer } from "pixi.js";
import type { World } from "@/sim/world";
import type { Environment } from "@/sim/environment";
import type { Genome } from "@/sim/genome";
import { SIM } from "@/sim/params";
import { DEBUG, TUNE } from "@/debug";

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
  private readonly angle = new Map<number, number>(); // 개체별 부드러운 회전각(스냅 떨림 제거)
  private readonly dispPos = new Map<number, { x: number; y: number }>(); // 렌더 전용 위치 평활(고주파 떨림 제거)
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
    this.angle.clear();
    this.dispPos.clear();
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

  sync(world: World, alpha = 1, dtMS = 1000 / 60): void {
    this.frame += 1;
    // 디버그 토글 반영(?nointerp 면 보간 끔 = 현재 위치로 스냅). 평소엔 alpha 그대로.
    const interp = DEBUG.noInterp ? 1 : alpha;
    // 회전 이징을 프레임률 독립으로 — 120Hz 폰에서 한 스텝당 더 많은 프레임이 들어가
    // 회전이 빠르게 노이즈를 쫓던 떨림을 없앤다(60fps 1프레임 = TUNE.rotEase).
    const rotK = 1 - Math.pow(1 - TUNE.rotEase, dtMS / (1000 / 60));
    // 위치 평활 계수(프레임률 독립). sim 의 고주파 떨림(먹이 재타깃 등 방향 급변)을 화면에서만
    // 부드럽게 한다 — 어떤 sim 파라미터로도 못 잡는 본질적 떨림이라 렌더에서 흡수. smooth=1 이면 끔.
    const smoothK =
      TUNE.renderSmooth >= 1 ? 1 : 1 - Math.pow(1 - TUNE.renderSmooth, dtMS / (1000 / 60));
    this.foodG.clear();
    for (const f of world.food) {
      if (!f.available) continue;
      // 먹이 종류별 색(자연스러운 식물색) — 종마다 먹는 먹이가 다름을 한눈에.
      this.foodG.circle(f.x, f.y, 4).fill({ color: FOOD_COLORS[f.kind] ?? 0x9bee5a, alpha: 1 });
    }

    // 생물 스프라이트 풀 — sim(30/s)과 화면(60fps) 사이를 prev→현재로 보간해 드득거림을 없앤다.
    this.playerG.clear();
    const ringPulse = 0.5 + 0.5 * Math.sin((this.frame % 70) / 70 * Math.PI * 2);
    let i = 0;
    for (const e of world.entities) {
      // 보간 위치(목표) → 렌더 전용 저역통과로 평활. 약 50ms 지연이라 관전엔 무해하고,
      // 제자리 떨림/먹이 앞 급정거 같은 고주파 진동을 흡수한다.
      const tx = e.prevX + (e.x - e.prevX) * interp;
      const ty = e.prevY + (e.y - e.prevY) * interp;
      let dp = this.dispPos.get(e.id);
      if (!dp) {
        dp = { x: tx, y: ty };
        this.dispPos.set(e.id, dp);
      } else {
        dp.x += (tx - dp.x) * smoothK;
        dp.y += (ty - dp.y) * smoothK;
      }
      const rx = dp.x;
      const ry = dp.y;

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
      // 회전: 진행 방향으로 향하되 "방향을 굳힌다". 좁은 각도(데드존) 안의 변화는 무시하고,
      // 데드존을 넘는 진짜 방향 전환만 프레임률 독립으로 부드럽게 이징한다.
      // 매 스텝 회전 목표가 미세하게 흔들려도(전 종 공통) 데드존 안이면 안 돌아 떨림이 사라진다.
      // ?norot 면 회전 고정, ?dz/?rotk 로 데드존·이징을 폰에서 즉시 튜닝.
      if (DEBUG.freezeRotation) {
        sp.rotation = 0;
      } else {
        const dx = e.x - e.prevX;
        const dy = e.y - e.prevY;
        const moved = Math.hypot(dx, dy);
        let ang = this.angle.get(e.id);
        if (ang === undefined) ang = moved > 0 ? Math.atan2(dy, dx) : 0;
        else if (moved > ROTATE_MIN_STEP) {
          let diff = Math.atan2(dy, dx) - ang;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          if (Math.abs(diff) > TUNE.headingDeadzone) ang += diff * rotK;
        }
        this.angle.set(e.id, ang);
        sp.rotation = ang;
      }
      const energy = Math.max(0, Math.min(1, e.energy / SIM.maxEnergy));
      sp.alpha = 0.5 + 0.5 * energy;
      sp.visible = true;
      i++;
    }
    for (; i < this.pool.length; i++) this.pool[i]!.visible = false;

    // 죽은 개체의 회전각 캐시 정리(메모리 누수 방지).
    if (this.angle.size > this.pool.length + 96) {
      const live = new Set<number>();
      for (const e of world.entities) live.add(e.id);
      for (const id of this.angle.keys()) if (!live.has(id)) this.angle.delete(id);
      for (const id of this.dispPos.keys()) if (!live.has(id)) this.dispPos.delete(id);
    }

    // 보스 + 위험 반경 (보스도 보간)
    this.bossG.clear();
    const boss = world.boss;
    if (boss) {
      const bx = boss.prevX + (boss.x - boss.prevX) * interp;
      const by = boss.prevY + (boss.y - boss.prevY) * interp;
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
    } else if (world.plagueRate > 0) {
      tint = 0x5a7a3a; // 병색(칙칙한 녹황)
      tintAlpha = 0.16;
    }
    if (tintAlpha > 0)
      this.overlayG.rect(0, 0, world.width, world.height).fill({ color: tint, alpha: tintAlpha });
  }
}

// 먹이 종류별 색 — 모두 식물처럼 자연스럽되 구분되게(연두 / 청록 / 노랑풀).
const FOOD_COLORS: readonly number[] = [0x9bee5a, 0x5ad6b0, 0xd8de5a];

// 회전 떨림 방지: 이만큼(px/스텝)보다 실제로 더 움직일 때만 진행 방향을 갱신한다.
// (느린 종은 미세 변위의 방향이 노이즈라, 낮으면 제자리에서 몸이 떤다.)
const ROTATE_MIN_STEP = 0.35;

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
