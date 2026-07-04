// 월드 렌더. sim 상태를 "읽기"만 한다. (sim 은 Pixi 를 import 하지 않는다.)
// 생물 = 형질 기반 스프라이트(종마다 게놈에서 텍스처 1장 생성해 재사용 → 가볍다).
//   몸 길쭉함=속도, 눈 크기=시야, 등가시=공격력, 앞주둥이/이빨=식성. 진행 방향으로 회전.
// 배경=환경, 먹이=초록 점, 보스=빨강+위험 반경, 대멸종=화면 틴트.

import { Container, Graphics, Sprite, Texture, type Renderer } from "pixi.js";
import type { World } from "@/sim/world";
import type { Entity } from "@/sim/entity";
import type { BossType } from "@/sim/boss";
import { TILE, type TileKind } from "@/sim/terrain";
import { TRAIT_KEYS, TRAIT_MAX, type Genome } from "@/sim/genome";
import { SIM } from "@/sim/params";
import { DEBUG, TUNE } from "@/debug";
import { personalityScale, personalityTint } from "@/render/creatureLook";
import { grassVisionFactor, nightVisionFactor } from "@/sim/behavior";

export class WorldView {
  readonly container = new Container();
  private readonly renderer: Renderer;
  private readonly envG = new Graphics();
  private readonly foodG = new Graphics();
  private readonly playerG = new Graphics(); // 내 종 강조(스프라이트 아래 빛나는 고리)
  private readonly creatureLayer = new Container();
  private readonly selectG = new Graphics(); // 탭으로 고른 개체 강조 고리(개인 카메라)
  private readonly bossG = new Graphics();
  private readonly overlayG = new Graphics();
  private selectedId: number | null = null; // 따라가며 관찰 중인 개체

  private readonly pool: Sprite[] = [];
  // 생물 텍스처 캐시 — 키가 "내 종 세대별 게놈 서명" 또는 "야생 종 id". 내 종은 레벨업으로 게놈이
  // 바뀌면 새 서명 = 새 텍스처라, 그 뒤 태어난 개체만 새 모습이 된다(기존 개체는 옛 서명 텍스처 유지).
  private readonly texCache = new Map<string, Texture>();
  private readonly angle = new Map<number, number>(); // 개체별 부드러운 회전각(스냅 떨림 제거)
  private readonly heading = new Map<number, { x: number; y: number }>(); // 진행방향 벡터 저역통과(좌우 회전 진동 제거)
  private readonly dispPos = new Map<number, { x: number; y: number }>(); // 렌더 전용 위치 평활(고주파 떨림 제거)
  private frame = 0;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.container.addChild(this.envG);
    this.container.addChild(this.foodG);
    this.container.addChild(this.playerG);
    this.container.addChild(this.creatureLayer);
    this.container.addChild(this.selectG);
    this.container.addChild(this.bossG);
    this.container.addChild(this.overlayG);
  }

  /** 따라가며 관찰할 개체를 정한다(탭 선택). null 이면 선택 해제. 강조 고리를 그릴 대상. */
  setSelected(id: number | null): void {
    this.selectedId = id;
  }

  /** 개체의 렌더 표시 위치(저역통과된 부드러운 좌표). 카메라가 이 위치를 따라가면 떨림 없이 추적된다. */
  getDisplayPos(id: number): { x: number; y: number } | null {
    return this.dispPos.get(id) ?? null;
  }

  /**
   * 카메라 — 초점(fx,fy)을 화면 중앙에 두고 zoom 배율로. 월드 밖(가장자리 너머 빈 공간)이 안 보이게
   * 화면 절반만큼 안쪽으로 클램프. 월드(worldW/H)와 화면(screenW/H)을 분리해 큰 월드의 일부만 보여준다.
   */
  setCamera(
    fx: number,
    fy: number,
    zoom: number,
    worldW: number,
    worldH: number,
    screenW = worldW,
    screenH = worldH,
  ): void {
    const halfW = screenW / (2 * zoom);
    const halfH = screenH / (2 * zoom);
    const cx = clampRange(fx, halfW, worldW - halfW);
    const cy = clampRange(fy, halfH, worldH - halfH);
    this.container.scale.set(zoom);
    this.container.pivot.set(cx, cy);
    this.container.position.set(screenW / 2, screenH / 2);
  }

  /** 런이 바뀌면 호출 — 텍스처 캐시를 비운다. 텍스처는 sync 에서 개체 게놈별로 lazy 생성한다(세대별). */
  refreshSpecies(_world: World): void {
    for (const tex of this.texCache.values()) tex.destroy(true);
    this.texCache.clear();
    this.angle.clear();
    this.heading.clear();
    this.dispPos.clear();
  }

  /** 개체의 텍스처(캐시). 내 종은 세대별 게놈 서명으로, 야생은 종 id + 거친 게놈 서명으로 캐시한다.
   * 야생은 진화(공유 게놈 변화)하므로 서명을 붙여야 겉모습이 따라 바뀐다 — 안 붙이면 게놈이 변해도
   * 첫 모습 그대로라 진화가 화면에 안 보인다. 거친 버킷이라 미세 드리프트엔 안 바뀌고, 압력 적응처럼
   * 형질이 크게 움직일 때만 새 텍스처(캐시 폭증 방지 + 눈에 띄는 변화만 반영). */
  private textureFor(e: Entity): Texture {
    const key = e.species.isPlayer
      ? "p" + e.species.id + ":" + genomeSignature(e.genome)
      : "s" + e.species.id + ":" + wildGenomeSignature(e.genome);
    let tex = this.texCache.get(key);
    if (!tex) {
      tex = makeCreatureTexture(this.renderer, e.genome, e.species.color);
      this.texCache.set(key, tex);
    }
    return tex;
  }

  /** 런이 바뀔 때 한 번 — 지형 풍경(바다/육지/산)을 그린다. 표고로 음영, 환경(추위/비옥도)으로 색조. */
  drawEnvironment(world: World): void {
    const terr = world.terrain;
    const env = world.environment;
    const cs = terr.cellSize;
    this.envG.clear();
    for (let cy = 0; cy < terr.rows; cy++) {
      for (let cx = 0; cx < terr.cols; cx++) {
        const i = cy * terr.cols + cx;
        const kind = terr.tiles[i] ?? TILE.land;
        const elev = terr.elevation[i] ?? 0.5;
        // 이 타일 중심의 환경(추위/비옥도)을 샘플 — 육지 색조·산 눈에 반영.
        const s = env.sampleAt((cx + 0.5) * cs, (cy + 0.5) * cs);
        this.envG
          .rect(cx * cs, cy * cs, cs, cs)
          .fill({ color: terrainColor(kind, elev, s.coldness, s.fertility), alpha: 1 });
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
    // 헤딩 저역통과 계수(프레임률 독립). 매 스텝 진행방향이 좌우로 튀어도(저속 노이즈) 평균만 남겨
    // 스프라이트가 좌우로 부들부들 회전하는 걸 없앤다 — 떨림의 진짜 원인은 회전 목표의 방향 노이즈.
    const headK =
      TUNE.headingSmooth >= 1 ? 1 : 1 - Math.pow(1 - TUNE.headingSmooth, dtMS / (1000 / 60));
    // 위치 평활 계수(프레임률 독립). sim 의 고주파 떨림(먹이 재타깃 등 방향 급변)을 화면에서만
    // 부드럽게 한다 — 어떤 sim 파라미터로도 못 잡는 본질적 떨림이라 렌더에서 흡수. smooth=1 이면 끔.
    const smoothK =
      TUNE.renderSmooth >= 1 ? 1 : 1 - Math.pow(1 - TUNE.renderSmooth, dtMS / (1000 / 60));
    this.foodG.clear();
    for (const f of world.food) {
      if (!f.available) continue;
      // 육지 식물은 종류별 자연색, 얕은 바다는 청록, 깊은 바다는 진한 남청(물고기 전용), 고산은 흰빛.
      const color = f.mountainous
        ? MOUNTAIN_FOOD_COLOR
        : f.deep
          ? DEEP_FOOD_COLOR
          : f.aquatic
            ? SEA_FOOD_COLOR
            : (FOOD_COLORS[f.kind] ?? 0x9bee5a);
      this.foodG.circle(f.x, f.y, 4).fill({ color, alpha: 1 });
    }

    // 생물 스프라이트 풀 — sim(30/s)과 화면(60fps) 사이를 prev→현재로 보간해 드득거림을 없앤다.
    this.playerG.clear();
    const ringPulse = 0.5 + 0.5 * Math.sin((this.frame % 70) / 70 * Math.PI * 2);
    let i = 0;
    let visionRings = 0; // 시야 반경은 일부 개체에만 옅게(클러터 없이 "얼마나 멀리 보는지" 감)
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
        // 시야(이 종이 먹이를 어느 방향·얼마나 멀리 보는지) — 보는 방향(진행방향) 기준 부채꼴로.
        // 정지(헤딩이 거의 0)면 두리번거리므로 원으로. 일부 개체에만 옅게(클러터 없이 시야각 감).
        if (visionRings < 14) {
          // behavior 의 시야 계산과 똑같이 개체별로 — 밤·수풀에서 줄어드는 실제 시야를 그대로 그린다
          // (시각=로직 1:1). 수풀에 든 개체는 부채꼴이 눈에 띄게 줄어 "시야가 가려짐"이 보인다.
          const v01 = e.genome.traits.vision / TRAIT_MAX;
          const eVision =
            SIM.visionBase *
            v01 *
            nightVisionFactor(world.daylight, v01) *
            grassVisionFactor(world, e.x, e.y, v01);
          const hd = this.heading.get(e.id);
          if (eVision > 1) {
            if (hd && Math.hypot(hd.x, hd.y) > 0.02) {
              const fa = Math.atan2(hd.y, hd.x);
              this.playerG
                .moveTo(rx, ry)
                .arc(rx, ry, eVision, fa - VISION_FOV_HALF, fa + VISION_FOV_HALF)
                .lineTo(rx, ry)
                .stroke({ color: 0x7ec8ff, width: 1, alpha: 0.08 });
            } else {
              this.playerG.circle(rx, ry, eVision).stroke({ color: 0x7ec8ff, width: 1, alpha: 0.06 });
            }
          }
          // 초음파 — 전방위 원(보라). 시야 부채꼴과 달리 사방·밝기 무관. 시야 없이 초음파로 사는 종 표시.
          const echo01 = e.genome.traits.echo / TRAIT_MAX;
          if (echo01 > 0) {
            this.playerG
              .circle(rx, ry, SIM.echoBase * echo01)
              .stroke({ color: 0xc07aff, width: 1, alpha: 0.09 });
          }
          visionRings++;
        }
        // 원거리 종 — 겨눈 먹잇감으로 발사 궤적 선(붙지 않고 멀리서 쏜다). 근접 종은 안 그린다.
        const rng01 = e.genome.traits.ranged / TRAIT_MAX;
        if (rng01 > 0.35 && e.targetPrey && e.targetPrey.alive) {
          const tp = e.targetPrey;
          this.playerG
            .moveTo(rx, ry)
            .lineTo(tp.x, tp.y)
            .stroke({ color: 0xfff0a0, width: 1.2, alpha: 0.4 });
        }
        this.playerG.circle(rx, ry, 13).fill({ color: 0x6cff7a, alpha: 0.1 });
        this.playerG
          .circle(rx, ry, 12.5)
          .stroke({ color: 0xaaffb0, width: 1.6, alpha: 0.35 + 0.25 * ringPulse });
      } else if (e.species.friendly) {
        // 우호적 친척 무리 — 내 종(초록)과 다른 청록 고리로 "내 편이지만 다른 무리"를 한눈에 구분.
        this.playerG.circle(rx, ry, 12).fill({ color: 0x35d6c0, alpha: 0.08 });
        this.playerG
          .circle(rx, ry, 11.5)
          .stroke({ color: 0x7fffe8, width: 1.4, alpha: 0.3 + 0.2 * ringPulse });
      } else if (e.species.faction !== 0) {
        // 야생 동맹(같은 편끼리 안 싸움) — 옅은 금빛 고리로 "저 종들은 한 편"을 표시(내 편보다 은은하게).
        this.playerG
          .circle(rx, ry, 11.5)
          .stroke({ color: 0xffcf6a, width: 1.2, alpha: 0.22 + 0.14 * ringPulse });
      }

      // 중독(독 걸림) 표식 — 종 불문. sp.tint 곱셈만으론 초록 생물이 탁해질 뿐 "보라"가 안 나므로,
      // 둘레에 맥동하는 보라 오라 + 피어오르는 독 방울로 "쟤 지금 중독됐다(독먹이를 삼킴)"를 확실히 보여준다.
      if (e.poison > 0) {
        const pInt = Math.min(1, e.poison / SIM.venomOnHit); // 독 세기 0~1(한 번 삼킨 양 기준)
        const pulse = 0.5 + 0.5 * Math.sin(this.frame * 0.16);
        const rr = 10 + pInt * 5;
        this.playerG
          .circle(rx, ry, rr)
          .stroke({ color: 0xd23bff, width: 1.6 + pInt, alpha: 0.4 + 0.4 * pulse });
        for (let b = 0; b < 3; b++) {
          const ang = (b / 3) * Math.PI * 2 - this.frame * 0.06; // 천천히 도는 독 방울
          const br = rr + 2 + 3 * pulse; // 오라 밖으로 피어오른다
          this.playerG
            .circle(rx + Math.cos(ang) * br, ry + Math.sin(ang) * br, 1.5 + pInt)
            .fill({ color: 0xe066ff, alpha: 0.35 + 0.45 * pulse });
        }
      }

      let sp = this.pool[i];
      if (!sp) {
        sp = new Sprite();
        sp.anchor.set(0.5);
        // 서브픽셀 떨림 차단: 스프라이트를 정수 픽셀에 스냅. 위치 평활(어떤 세기든)으로도 안 잡히던
        // 떨림은 진폭이 아니라 sub-pixel 안티앨리어싱 깜빡임이라, 그건 roundPixels 만이 없앤다.
        sp.roundPixels = true;
        this.creatureLayer.addChild(sp);
        this.pool.push(sp);
      }
      sp.texture = this.textureFor(e);
      sp.x = rx;
      sp.y = ry;
      // 개체별 미세 개성(크기·명암) — 같은 종이라도 한 마리씩 달라 보이게. id 결정론, sim 무관.
      sp.scale.set(personalityScale(e.id));
      // 독(중독) 걸린 개체는 보라빛으로 — "독이 퍼지는 중"이 한눈에(지속 피해의 시각 피드백).
      sp.tint = e.poison > 0 ? 0xcc66ff : personalityTint(e.id);
      // 회전: 떨림(좌우 진동)의 원인은 회전 "목표"가 매 스텝의 미세 이동 방향이라 노이즈가 크다는 것.
      // → 진행방향 벡터를 저역통과(headK)해 평균 방향만 목표로 삼는다. 방향이 한 스텝씩 홱홱 뒤집혀도
      // 평활된 헤딩은 거의 안 움직여 회전이 안정된다(제자리·이동 중 둘 다). 진짜 전환은 서서히 따라감.
      // 데드존/이징은 그 위에 얹어 미세 잔회전까지 막는다. ?norot 회전고정 · ?head/?dz/?rotk 폰 튜닝.
      if (DEBUG.freezeRotation) {
        sp.rotation = 0;
      } else {
        const dx = e.x - e.prevX;
        const dy = e.y - e.prevY;
        const moved = Math.hypot(dx, dy);
        let hd = this.heading.get(e.id);
        if (!hd) {
          hd = { x: dx, y: dy };
          this.heading.set(e.id, hd);
        } else if (moved > ROTATE_MIN_STEP) {
          // 헤딩 벡터를 저역통과. 좌우로 뒤집히는 방향은 평균이 0 근처로 수렴 → 각도 안 바뀜.
          hd.x += (dx - hd.x) * headK;
          hd.y += (dy - hd.y) * headK;
        }
        const hmag = Math.hypot(hd.x, hd.y);
        let ang = this.angle.get(e.id);
        if (ang === undefined) ang = hmag > 1e-4 ? Math.atan2(hd.y, hd.x) : 0;
        else if (hmag > 1e-3) {
          // 평활된 헤딩이 목표. 데드존 너머만 부드럽게 따라간다.
          let diff = Math.atan2(hd.y, hd.x) - ang;
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
      for (const id of this.heading.keys()) if (!live.has(id)) this.heading.delete(id);
      for (const id of this.dispPos.keys()) if (!live.has(id)) this.dispPos.delete(id);
    }

    // 선택 개체 강조 — 탭으로 고른 한 마리를 또렷한 고리로 표시(카메라가 이 아이를 따라간다).
    // 폰에서 한눈에 보이게 밝은 금빛 + 은은한 맥동. 위치는 렌더 표시 좌표(저역통과)라 떨지 않는다.
    this.selectG.clear();
    if (this.selectedId !== null) {
      const dp = this.dispPos.get(this.selectedId);
      if (dp) {
        const pulse = 0.5 + 0.5 * Math.sin((this.frame % 64) / 64 * Math.PI * 2);
        const r = 17 + pulse * 3;
        this.selectG.circle(dp.x, dp.y, r).stroke({ color: 0xffe08a, width: 2.4, alpha: 0.9 });
        this.selectG.circle(dp.x, dp.y, r + 3).stroke({ color: 0xffe08a, width: 1.2, alpha: 0.3 });
      }
    }

    // 보스 시각은 로직과 1:1 (known_issues). 실제로 쫓아와 무는 개체만 점 + 물기 반경 + 주목 펄스로
    // 그린다(도망 대상): 단일 추격자(chaser) 또는 사나운 무리(members 여러 마리가 사방에서 몰려온다).
    // 전역 솎기/흡수 시련(위치 무관)은 개체가 없으므로 여기서 안 그리고 아래 전체 화면 틴트로만 표현한다.
    this.bossG.clear();
    const boss = world.boss;
    const pulse = (this.frame % 60) / 60; // 주목 펄스(가독성 §7)
    if (boss && boss.members.length > 0) {
      // 개체형 떼 시련 — 떼가 무리 대형으로 몰려온다. 종류마다 색을 달리하고(구분), 떼 전체를 감싸는
      // 위협 오라 + 개별 점으로 "한 무리가 덮쳐온다"를 보인다(개별 점만 있으면 "무리"로 안 읽힌다).
      const hc = HORDE_COLORS[boss.type] ?? HORDE_DEFAULT;
      const pts = boss.members.map((m) => ({
        x: m.prevX + (m.x - m.prevX) * interp,
        y: m.prevY + (m.y - m.prevY) * interp,
      }));
      let cx = 0;
      let cy = 0;
      for (const p of pts) {
        cx += p.x;
        cy += p.y;
      }
      cx /= pts.length;
      cy /= pts.length;
      let maxR = 0;
      for (const p of pts) {
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d > maxR) maxR = d;
      }
      // 무리를 감싸는 위협 오라(맥동) — 어디를 덮치는 무리인지 한눈에.
      this.bossG.circle(cx, cy, maxR + 22).fill({ color: hc.aura, alpha: 0.1 + pulse * 0.06 });
      this.bossG.circle(cx, cy, maxR + 22).stroke({ color: hc.ring, width: 2, alpha: 0.3 });
      for (const p of pts) this.drawPredatorDot(p.x, p.y, boss.killRadius, pulse, 7, hc.dot);
    } else if (boss && boss.killRadius > 0) {
      const bx = boss.prevX + (boss.x - boss.prevX) * interp;
      const by = boss.prevY + (boss.y - boss.prevY) * interp;
      this.drawPredatorDot(bx, by, boss.killRadius, pulse, 14, HORDE_DEFAULT.dot);
    }

    // 낮/밤 + 대멸종 화면 틴트 (둘 다 overlayG — 밤을 먼저 깔고 대멸종 틴트를 그 위에)
    this.overlayG.clear();
    // 밤일수록 짙은 남색으로 어둑하게. daylight 1=낮(영향 없음), 0=자정(가장 어둑). 생물은 보이게.
    const night = (1 - world.daylight) * NIGHT_MAX_ALPHA;
    if (night > 0.01)
      this.overlayG.rect(0, 0, world.width, world.height).fill({ color: NIGHT_COLOR, alpha: night });
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
    } else if (boss && boss.killRadius === 0) {
      // 전역 시련(독 안개) — 위치 무관하게 온 땅의 에너지를 흡수한다. 시각=로직 1:1(known_issues):
      // 진짜 전역 재난이라 화면 전체 틴트로 표현한다. 나머지 시련(약탈자·외톨이·매복자)은 실제 떼
      // 개체로 실재화돼 killRadius>0 이라 여기 안 오고 위의 점+오라로 그려진다.
      const v = TRIAL_VISUALS[boss.type];
      if (v) {
        tint = v.color;
        tintAlpha = v.baseAlpha + v.pulseAmp * Math.sin(this.frame * v.pulseSpeed);
      }
    }
    if (tintAlpha > 0)
      this.overlayG.rect(0, 0, world.width, world.height).fill({ color: tint, alpha: tintAlpha });
  }

  /** 쫓아와 무는 개체 하나(추격자 또는 무리의 한 마리)를 물기 반경 + 맥동 고리 + 점으로 그린다. */
  private drawPredatorDot(
    x: number,
    y: number,
    killRadius: number,
    pulse: number,
    dot: number,
    color: number,
  ): void {
    this.bossG.circle(x, y, killRadius).fill({ color, alpha: 0.3 });
    this.bossG
      .circle(x, y, dot + 2 + pulse * dot * 1.8)
      .stroke({ color, width: 2.5, alpha: 0.55 * (1 - pulse) });
    this.bossG.circle(x, y, dot).fill({ color, alpha: 1 });
    this.bossG.circle(x, y, dot).stroke({ color: 0x3a0d06, width: 3 });
  }
}

// 전역 시련 화면 틴트 — 지금은 독 안개만(진짜 전역 재난). 나머지 시련은 실제 떼 개체로 실재화돼
// HORDE_COLORS 로 그린다. tintAlpha = base + amp·sin(frame·speed).
interface TrialVisual {
  color: number;
  baseAlpha: number;
  pulseAmp: number;
  pulseSpeed: number;
}
const TRIAL_VISUALS: Partial<Record<BossType, TrialVisual>> = {
  // 독 안개 — 온 땅의 에너지를 빨아들인다. 진한 녹황을 느리게 맥동(살아 움직이는 독).
  poison: { color: 0x5f8f36, baseAlpha: 0.22, pulseAmp: 0.07, pulseSpeed: 0.06 },
};

// 개체형 떼 시련의 색 — 종류마다 확연히 달리해 "무엇이 덮치는지" 구분한다(점·오라·물기 반경 공용).
//   dot 개별 점, aura 무리 감싸는 오라(채움), ring 오라 테두리.
interface HordeColor {
  dot: number;
  aura: number;
  ring: number;
}
const HORDE_DEFAULT: HordeColor = { dot: 0xff5535, aura: 0x9a1a0e, ring: 0xd8321a };
const HORDE_COLORS: Partial<Record<BossType, HordeColor>> = {
  swarm: { dot: 0xff7a2a, aura: 0x7a2a08, ring: 0xd8641a }, // 성난 주황(사나운 무리)
  raider: { dot: 0xff2e5a, aura: 0x7a0a24, ring: 0xd81a44 }, // 핏빛 진홍(약탈)
  isolation: { dot: 0x33c0d8, aura: 0x0a3a4a, ring: 0x1f92b0 }, // 청록(외톨이 사냥꾼)
  stalker: { dot: 0xc060d0, aura: 0x3a0a3a, ring: 0x8a2a9a }, // 자주(그림자 매복)
};

// 먹이 종류별 색 — 모두 식물처럼 자연스럽되 구분되게(연두 / 청록 / 노랑풀).
const FOOD_COLORS: readonly number[] = [0x9bee5a, 0x5ad6b0, 0xd8de5a];
// 바다 먹이 색 — 물 위에서 밝게 빛나는 청록(수영 종만 먹는 틈새 강조).
const SEA_FOOD_COLOR = 0x7fe9ff;
// 깊은 바다 먹이 색 — 진한 남청 반짝임(물 전용 종=물고기만 먹는 전용 틈새. 얕은 청록과 구분).
const DEEP_FOOD_COLOR = 0x3a7bff;
// 고산 먹이 색 — 산 위에서 밝게 빛나는 흰빛(눈 위 열매 느낌 — 날개 종만 먹는 틈새 강조. 바다 청록의 하늘 대칭).
const MOUNTAIN_FOOD_COLOR = 0xfff0c0;
// 밤 오버레이 — 짙은 남색을 daylight 에 반비례해 덮는다(자정에 가장 어둑하되 생물은 보이게).
const NIGHT_COLOR = 0x0a1030;
const NIGHT_MAX_ALPHA = 0.4;
// 시야 부채꼴 반각(라디안) — sim 의 fovHalfCos 와 같은 각도로 표시(보는 방향 ± 이만큼).
const VISION_FOV_HALF = Math.acos(SIM.fovHalfCos);

// 회전 떨림 방지: 이만큼(px/스텝)보다 실제로 더 움직일 때만 진행 방향을 갱신한다.
// (느린 종은 미세 변위의 방향이 노이즈라, 낮으면 제자리에서 몸이 떤다.)
const ROTATE_MIN_STEP = 0.35;

function clamp255(v: number): number {
  const n = Math.round(v);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// 지형 색 팔레트(RGB). 바다=깊이별 남색→청록, 산=암석→눈, 육지=비옥도별 황갈→초록(추우면 차갑게).
type RGB = readonly [number, number, number];
const WATER_DEEP: RGB = [16, 38, 72];
const WATER_SHALLOW: RGB = [46, 112, 150];
const ROCK: RGB = [86, 82, 94];
const SNOW: RGB = [206, 212, 222];
const LAND_BARREN: RGB = [122, 106, 64];
const LAND_LUSH: RGB = [54, 110, 50];
const LAND_COOL: RGB = [78, 96, 92];
// 수풀 — 무성한 진초록(트인 육지보다 어둡고 짙어 "시야를 가리는 덤불"로 읽힌다).
const GRASS_DEEP: RGB = [30, 74, 34];
const GRASS_LUSH: RGB = [40, 96, 40];
// 험지 — 거친 회갈색 자갈밭(산 아래. 바위·돌이 많아 "느리게 통과하는 땅"으로 읽힌다).
const ROUGH_LO: RGB = [96, 88, 76];
const ROUGH_HI: RGB = [124, 116, 104];
// 렌더 음영용 표고 밴드(terrain 의 기본 분류 경계와 맞춤 — 시각 전용이라 근사면 충분).
const WATER_BAND = 0.32;
const MOUNTAIN_BAND = 0.76;

function mix(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function pack(c: RGB): number {
  return (clamp255(c[0]) << 16) | (clamp255(c[1]) << 8) | clamp255(c[2]);
}

function terrainColor(kind: TileKind, elev: number, cold: number, fert: number): number {
  if (kind === TILE.water) {
    // 표고가 낮을수록(깊을수록) 어두운 남색, 해안에 가까울수록 청록.
    return pack(mix(WATER_DEEP, WATER_SHALLOW, elev / WATER_BAND));
  }
  if (kind === TILE.mountain) {
    // 높을수록·추울수록 눈으로.
    const t = (elev - MOUNTAIN_BAND) / (1 - MOUNTAIN_BAND);
    return pack(mix(ROCK, SNOW, t * 0.7 + cold * 0.5));
  }
  if (kind === TILE.grass) {
    // 수풀 — 비옥할수록 짙은 초록. 트인 육지보다 어두워 "덤불"로 읽힌다. 추우면 차갑게.
    return pack(mix(mix(GRASS_DEEP, GRASS_LUSH, fert), LAND_COOL, cold * 0.3));
  }
  if (kind === TILE.rough) {
    // 험지 — 산 아래 거친 자갈밭. 표고가 높을수록 밝은 바위색. 추우면 차갑게.
    const t = (elev - 0.7) / (MOUNTAIN_BAND - 0.7);
    return pack(mix(mix(ROUGH_LO, ROUGH_HI, t), LAND_COOL, cold * 0.3));
  }
  // 육지 — 비옥하면 초록, 척박하면 황갈. 추운 땅은 차갑게.
  return pack(mix(mix(LAND_BARREN, LAND_LUSH, fert), LAND_COOL, cold * 0.35));
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

/** 색을 흰색 쪽으로 f(0~1)만큼 섞는다(하이라이트/입체감용). */
function lighten(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 0xff) + (255 - ((color >> 16) & 0xff)) * f);
  const g = Math.round(((color >> 8) & 0xff) + (255 - ((color >> 8) & 0xff)) * f);
  const b = Math.round((color & 0xff) + (255 - (color & 0xff)) * f);
  return (r << 16) | (g << 8) | b;
}

// 게놈을 텍스처 캐시 키로 만든다 — 형질을 0.05(=1/20) 단위로 반올림해 서명. 같은 세대(같은 게놈)면
// 같은 키라 텍스처를 재사용하고, 레벨업으로 형질이 바뀌면 새 서명 = 새 텍스처(그때 태어난 세대 모습).
function genomeSignature(g: Genome): string {
  const t = g.traits;
  let s = "";
  for (const k of TRAIT_KEYS) s += Math.round(t[k] * 20) + ",";
  return s;
}

// 야생종용 거친 게놈 서명 — 형질(0~100)을 12 단위 버킷으로 뭉뚱그린다. 진화로 형질이 눈에 띄게(약 12↑)
// 움직여야 새 텍스처가 나므로, 매 진화의 미세 드리프트(±1.2)엔 캐시가 안 늘고 압력 적응 같은 큰 변화만
// 겉모습에 반영된다(한 종당 버킷 조합 소수 → 텍스처 캐시 상한).
function wildGenomeSignature(g: Genome): string {
  const t = g.traits;
  let s = "";
  for (const k of TRAIT_KEYS) s += Math.round(t[k] / 12) + ",";
  return s;
}

// 게놈에서 한 종의 생물 스프라이트 텍스처를 만든다(앞쪽 = +x). 형질이 형태로 드러난다.
// 나중에 더 정교한 아트로 바꿀 땐 이 함수만 손보면 된다. (프리셋 선택 창의 외형 미리보기도 재사용)
export function makeCreatureTexture(renderer: Renderer, genome: Genome, color: number): Texture {
  const t = genome.traits;
  // 형질은 0~100 저장 → 외형 계산은 0~1 로 정규화해 쓴다(식성 비교는 0~100 임계 그대로).
  // 폰 검토라 미묘한 차이는 안 읽힌다 → 형질별 외형 폭을 크게 벌리고, 특화 형질(수영·초음파·날개)은
  // 지느러미·큰 귀·날개로 뚜렷이 드러내 프리셋/빌드를 한눈에 구분한다.
  const speed01 = t.speed / TRAIT_MAX;
  const attack01 = t.attack / TRAIT_MAX;
  const diet01 = t.diet / TRAIT_MAX;
  const vision01 = t.vision / TRAIT_MAX;
  const swim01 = t.swimming / TRAIT_MAX;
  const echo01 = t.echo / TRAIT_MAX;
  const wing01 = t.wings / TRAIT_MAX;
  const venom01 = t.venom / TRAIT_MAX;
  const ranged01 = t.ranged / TRAIT_MAX;
  const g = new Graphics();
  const shade = darken(color, 0.5); // 윤곽선·그림자
  const belly = darken(color, 0.72); // 배(아래) 그림자
  const glow = lighten(color, 0.42); // 등(위) 하이라이트
  const fin = darken(color, 0.68); // 지느러미·꼬리

  const len = 8 + speed01 * 10; // 몸 반길이 (빠를수록 길쭉·날렵 — 8~18)
  const wid = 8.5 - speed01 * 4; // 몸 반너비 (느릴수록 통통 — 8.5~4.5)

  // 날개 (비행) — 맨 뒤 레이어. 곡선으로 펼친 한 쌍(펄럭이는 새 실루엣).
  if (wing01 > 0.05) {
    const wl = wid + 6 + wing01 * 13;
    for (const s of [-1, 1]) {
      g.moveTo(len * 0.4, s * wid * 0.4)
        .quadraticCurveTo(len * 0.05, s * wl, -len * 0.2, s * wl * 0.85)
        .quadraticCurveTo(-len * 0.5, s * wl * 0.45, -len * 0.55, s * wid * 0.5)
        .fill({ color: darken(color, 0.8) });
    }
  }

  // 꼬리지느러미 (수영) — 수영 종(60↑)에만. 뒤로 뻗은 부채꼴 꼬리(물고기 실루엣).
  if (swim01 > 0.6) {
    const f = (swim01 - 0.6) / 0.4;
    const tl = 6 + f * 9;
    g.moveTo(-len * 0.8, 0)
      .quadraticCurveTo(-len - tl, -wid - f * 5, -len - tl * 0.7, -wid * 0.25)
      .quadraticCurveTo(-len - tl, 0, -len - tl * 0.7, wid * 0.25)
      .quadraticCurveTo(-len - tl, wid + f * 5, -len * 0.8, 0)
      .fill({ color: fin });
  }

  // 몸통 — 유선형(머리 둥글고 꼬리로 좁아짐). 곡선으로 유기적 실루엣 + 윤곽선.
  g.moveTo(len, 0)
    .quadraticCurveTo(len * 0.8, -wid, len * 0.05, -wid)
    .quadraticCurveTo(-len * 0.55, -wid * 0.95, -len, -wid * 0.28)
    .quadraticCurveTo(-len * 1.06, 0, -len, wid * 0.28)
    .quadraticCurveTo(-len * 0.55, wid * 0.95, len * 0.05, wid)
    .quadraticCurveTo(len * 0.8, wid, len, 0)
    .fill({ color })
    .stroke({ color: shade, width: 1.4, alpha: 0.9 });

  // 배 그림자(아래 절반 어둡게) + 등 하이라이트(위쪽 밝은 띠) — 빛 받는 입체감.
  g.moveTo(len * 0.85, wid * 0.2)
    .quadraticCurveTo(len * 0.05, wid, -len * 0.7, wid * 0.5)
    .quadraticCurveTo(-len * 0.2, wid * 0.35, len * 0.85, wid * 0.2)
    .fill({ color: belly, alpha: 0.5 });
  g.moveTo(len * 0.7, -wid * 0.4)
    .quadraticCurveTo(len * 0.05, -wid * 0.82, -len * 0.5, -wid * 0.42)
    .quadraticCurveTo(len * 0.05, -wid * 0.55, len * 0.7, -wid * 0.4)
    .fill({ color: glow, alpha: 0.45 });

  // 등지느러미 능선 (공격력) — 힘셀수록 날카로운 톱니 능선(가시 대신 유기적).
  if (attack01 > 0.08) {
    const h = 3 + attack01 * 9;
    const teeth = 3;
    g.moveTo(len * 0.45, -wid * 0.8);
    for (let s = 1; s <= teeth; s++) {
      const px = len * 0.45 - (s / teeth) * len * 0.95;
      g.lineTo(px + len * 0.12, -wid - h).lineTo(px, -wid * 0.72);
    }
    g.fill({ color: shade });
  }

  // 원거리 창 (ranged) — 앞으로 길게 뻗은 창/부리(멀리 닿는 무기). 크고 밝은 촉으로 뚜렷하게.
  if (ranged01 > 0.1) {
    const horn = 9 + ranged01 * 20;
    g.moveTo(len - 1, -3)
      .quadraticCurveTo(len + horn * 0.6, -1.5, len + horn, 0)
      .quadraticCurveTo(len + horn * 0.6, 1.5, len - 1, 3)
      .fill({ color: lighten(shade, 0.25) });
    g.moveTo(len + horn * 0.45, -1.2)
      .lineTo(len + horn, 0)
      .lineTo(len + horn * 0.45, 1.2)
      .fill({ color: 0xffffff });
  }

  // 머리 앞부분 (식성)
  if (t.diet > SIM.dietGrazeMax) {
    // 육식 — 날카로운 주둥이 + 흰 이빨
    const snout = 6 + diet01 * 8;
    g.moveTo(len * 0.55, -wid * 0.5)
      .quadraticCurveTo(len + snout, -wid * 0.12, len + snout, 0)
      .quadraticCurveTo(len + snout, wid * 0.12, len * 0.55, wid * 0.5)
      .fill({ color: darken(color, 0.9) });
    g.poly([len + snout * 0.55, -1.6, len + snout, 0, len + snout * 0.55, 1.6]).fill({ color: 0xffffff });
  } else if (t.diet <= SIM.dietHuntMin) {
    // 초식 — 부드러운 귀 두 개(길쭉 타원)
    g.ellipse(len * 0.28, -wid * 0.9, 2.4, 4.2).fill({ color }).stroke({ color: shade, width: 0.8 });
    g.ellipse(len * 0.28 + 5.5, -wid * 0.9, 2.4, 4.2).fill({ color }).stroke({ color: shade, width: 0.8 });
  }

  // 초음파 귀 (echo) — 머리 위 큰 뾰족 귀 한 쌍(박쥐).
  if (echo01 > 0.1) {
    const eh = 5 + echo01 * 12;
    for (const s of [0, 1]) {
      const bx = len * 0.28 + s * 5;
      g.moveTo(bx - 3, -wid * 0.8).lineTo(bx + 1, -wid * 0.8 - eh).lineTo(bx + 4, -wid * 0.8).fill({ color: shade });
      g.moveTo(bx - 1, -wid * 0.8).lineTo(bx + 1, -wid * 0.8 - eh * 0.6).lineTo(bx + 2.5, -wid * 0.8).fill({ color });
    }
  }

  // 눈 (시야) — 생동감: 흰자 + 동공 + 반짝 하이라이트. 시야 클수록 큰 눈.
  const eye = 2 + vision01 * 4.5;
  const ex = len * 0.55;
  const ey = -wid * 0.32;
  g.circle(ex, ey, eye).fill({ color: 0xffffff }).stroke({ color: shade, width: 0.6 });
  g.circle(ex + eye * 0.22, ey, eye * 0.55).fill({ color: 0x10141a });
  g.circle(ex + eye * 0.5, ey - eye * 0.32, eye * 0.24).fill({ color: 0xffffff });

  // 독침 (venom) = 방어 독 — 몸에 보라 독 반점(경고색: 잡아먹으면 중독). 독 지닌 종을 한눈에.
  if (venom01 > 0.1) {
    const vr = 1.4 + venom01 * 2;
    g.circle(-len * 0.25, wid * 0.35, vr).fill({ color: 0xc030e0 });
    g.circle(len * 0.3, -wid * 0.4, vr).fill({ color: 0xc030e0 });
    g.circle(len * 0.05, wid * 0.5, vr * 0.8).fill({ color: 0xc030e0 });
  }

  // 고해상도로 생성(작은 스프라이트가 뭉개지지 않게 슈퍼샘플).
  const tex = renderer.generateTexture({ target: g, resolution: 3, antialias: true });
  g.destroy();
  return tex;
}
