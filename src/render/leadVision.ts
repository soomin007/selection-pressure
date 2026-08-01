// 알파 시점 월드 칠하기 — 사람이 한 마리를 직접 모는 조종 모드(`?alpha`)에서만 켜지는 렌더 레이어.
//
// 왜 필요한가: 지금까지의 화면은 **관전용**이라 질문이 "이 종은 몇 마리인가"였다. 직접 몰기 시작하면
// 질문이 통째로 바뀐다 — 저건 먹을 수 있나 / 저기로 갈 수 있나 / 쟤가 날 잡아먹나. 그 답은 이미 시뮬
// 안에 전부 있는데 화면에만 없었다. 그래서 새 패널을 만드는 대신 **월드 자체를 "알파가 할 수 있는 것"으로
// 칠한다**(CLAUDE.md 전달 규칙 1순위: "그 자체로 보이는 것").
//
// 이 파일은 sim 을 **읽기만** 한다(Pixi 는 render 층에서만). 판정은 가능한 한 sim 이 export 한 함수를
// 그대로 부른다 — 같은 규칙을 두 군데 적으면 원본이 바뀔 때 화면이 조용히 거짓말을 한다
// (known_issues "화면에 뜨는 숫자를 규칙에서 다시 유도하지 마라"). 부득이 다시 적은 곳은 ⚠ 로 표시하고
// 원본 위치를 적어 뒀다.

import { Graphics } from "pixi.js";
import type { World } from "@/sim/world";
import type { Entity } from "@/sim/entity";
import type { Food } from "@/sim/food";
import type { Genome } from "@/sim/genome";
import { TRAIT_MAX } from "@/sim/genome";
import { SIM } from "@/sim/params";
import { biteOutcome, grazeEfficiency, leadRelation, sizeDev } from "@/sim/behavior";
import { personalityScale } from "@/render/creatureLook";

// ─────────────────────────── 색 ───────────────────────────
// 기존 팔레트와 안 싸우게 고른다. 이미 임자가 있는 색: 내 종 초록(0x6cff7a) · 알파 청백(0xf0f8ff) ·
// 무리 방패 연파랑(0xcfe6ff) · 단골/동맹 금빛(0xffd24a·0xffcf6a) · 독 보라(0xd23bff) · 보스 붉은빛.
// 색만으로는 절대 구분 안 되므로 **모양**을 주 신호로 삼는다(아래 두 표식은 형태부터 다르다).

/** 위험(나를 잡아먹을 수 있다) — 붉은 **톱니(이빨) 링**. 보스의 매끈한 원형 오라와 형태가 갈린다. */
const THREAT_COLOR = 0xff3b30;
/** 먹잇감(내가 잡아먹을 수 있다) — 호박빛 **코너 브래킷(조준 표적)**. 게임의 어떤 표식도 브래킷을 안 쓴다. */
const PREY_COLOR = 0xffb43a;
/** 표식 밑에 까는 어두운 선 — 사막·눈처럼 밝은 지형 위에서 표식이 사라지는 걸 막는다(LEAD_OUTLINE 과 같은 이유). */
const MARK_OUTLINE = 0x0a0508;
/** 못 가는 곳 스크림 — 밤 오버레이(0x0a1030)보다 중립적인 먹빛. 지형색을 죽이되 물빛/바위는 남는다. */
const BLOCK_FILL = 0x05070c;
const BLOCK_ALPHA = 0.42;
/** 못 가는 곳 경계선 — 차가운 회청. "벽"으로 읽히되 위험(붉은)·먹이(호박)와 안 겹친다. */
const BLOCK_EDGE = 0xaebfd2;

/**
 * 알파의 통행·섭식 능력. 게놈에서 한 번 뽑아 두고 그 프레임 내내 재사용한다.
 *
 * ⚠ 여기 문턱 비교는 sim 이 함수로 안 내주는 것들이라 **다시 적은 것**이다. 원본:
 *   · canSwim / canLand  — `behavior.stepEntity` (`swimThreshold` / `aquaticOnlyThreshold`)
 *   · canFly             — `behavior.chooseGoal` (`flyThreshold`)
 *   · aquaticOnly        — `behavior.nearestFood` (깊은 바다 먹이 게이트)
 *   · canGraze           — `behavior.stepEntity` (`grazeEfficiency(diet) > grazeMinEff`)
 * 저쪽 문턱이 바뀌면 여기도 같이 고쳐야 한다 — 안 그러면 화면이 "갈 수 있다/먹을 수 있다"를 거짓말한다.
 * (사냥 관계는 여기 없다 — 그건 sim 이 `leadRelation` 으로 내주므로 그걸 그대로 읽는다.)
 */
export interface LeadCaps {
  readonly canSwim: boolean;
  readonly canLand: boolean;
  readonly canFly: boolean;
  readonly aquaticOnly: boolean;
  readonly canGraze: boolean;
}

export function leadCapsOf(g: Genome): LeadCaps {
  const t = g.traits;
  return {
    canSwim: t.swimming >= SIM.swimThreshold,
    canLand: t.swimming < SIM.aquaticOnlyThreshold,
    canFly: t.wings >= SIM.flyThreshold,
    aquaticOnly: t.swimming >= SIM.aquaticOnlyThreshold,
    canGraze: grazeEfficiency(t.diet) > SIM.grazeMinEff,
  };
}

/** 통행 능력이 실제로 달라졌는가 — 지형 레이어를 다시 그릴지 정하는 키(형질이 바뀌면 막힌 곳이 열린다). */
export function passKey(caps: LeadCaps): string {
  return `${caps.canSwim ? 1 : 0}${caps.canLand ? 1 : 0}${caps.canFly ? 1 : 0}`;
}

/**
 * 알파가 이 먹이를 먹을 수 있는가.
 *
 * ⚠ `behavior.nearestFood` 안의 익명 술어를 **다시 적은 것**이다(그 술어는 export 돼 있지 않다).
 *   깊은 바다 → 물 전용 종만 · 얕은 바다 → 수영 종만 · 고산 → 비행 종만 · 그 외 → 종의 먹이 종류.
 *   그 위에 `canGraze` 가 전체 게이트다(순수 육식은 애초에 식물 목표를 안 잡는다 — stepEntity).
 *   nearestFood 가 바뀌면 여기도 같이 고쳐야 한다.
 */
export function leadCanEatFood(f: Food, caps: LeadCaps, kinds: readonly number[]): boolean {
  if (!caps.canGraze) return false;
  if (f.deep) return caps.aquaticOnly;
  if (f.aquatic) return caps.canSwim;
  if (f.mountainous) return caps.canFly;
  return kinds.includes(f.kind);
}

/**
 * 어떤 표식을 그릴지(참/거짓)와 얼마나 세게 그릴지(0~1)를 나눠 들고 있다.
 *
 * ⚠ **세기 0 을 "관계 없음"으로 쓰면 안 된다.** 체급이 꽤 밀리는 포식자는 한 입에 죽일 확률이 0 이어도
 *   이빨은 박히고 기운을 깎는다(여러 번 물려 쓰러진다). 그때 표식을 안 그리면 화면이 "무해하다"고
 *   거짓말한다. 그래서 그릴지 말지는 언제나 threat/prey 불리언이 정한다.
 */
export interface LeadMarkWeights {
  /** 저쪽이 나를 잡아먹을 수 있다(sim 판정 그대로). */
  readonly threat: boolean;
  /** 내가 저쪽을 잡아먹을 수 있다(sim 판정 그대로). */
  readonly prey: boolean;
  /** threat 일 때만 뜻이 있다 — 한 번의 물기가 나를 곧바로 죽일 확률(최대치 대비 0~1). */
  readonly threatPower: number;
  /** prey 일 때만 뜻이 있다 — 같은 척도. */
  readonly preyPower: number;
}

const NO_MARK: LeadMarkWeights = { threat: false, prey: false, threatPower: 0, preyPower: 0 };

/**
 * 알파 시점 표식의 **세기**를 뽑는다.
 *
 * "그릴 것인가 말 것인가"는 **sim 의 `leadRelation` 하나가 정한다** — 화면과 조종 능력(물기)이 같은
 * 함수를 읽어야 "먹잇감으로 표시된 개체 = 실제로 물리는 개체"가 정의상 어긋날 수 없다
 * (known_issues "화면에 뜨는 숫자를 규칙에서 다시 유도하지 마라"). 여기서 규칙을 다시 적지 않는다.
 *
 * 여기가 더하는 건 "얼마나 센가"뿐이고, 그 값도 sim 이 실제 물기에 쓰는 `biteOutcome` 에서 그대로
 * 읽는다(굵기·진하기로 옮길 뿐이다). `leadRelation` 이 참이면 그 물기는 `ignored` 가 아니므로
 * killChance 가 반드시 의미 있는 값이다 — 두 값이 어긋날 수 없다.
 *
 * ⚠ **지형 도달 가능성은 일부러 안 본다.** "물면 박히는가"와 "거기까지 갈 수 있는가"는 다른 질문이고,
 *   후자는 이미 못 가는 지형 레이어가 같은 화면에서 답한다(물속 물고기에 브래킷 + 바다는 어둡게 =
 *   "물면 잡히지만 갈 수는 없다"). 여기에 도달 판정을 섞으면 물기 버튼과 화면이 갈라진다.
 */
export function leadMarkWeights(lead: Entity, other: Entity): LeadMarkWeights {
  const rel = leadRelation(lead, other);
  if (!rel.threat && !rel.prey) return NO_MARK;
  const me = lead.genome.traits;
  const it = other.genome.traits;
  return {
    threat: rel.threat,
    prey: rel.prey,
    threatPower: rel.threat
      ? biteOutcome(it.attack, me.attack, it.size, me.size).killChance / SIM.killChanceMax
      : 0,
    preyPower: rel.prey
      ? biteOutcome(me.attack, it.attack, me.size, it.size).killChance / SIM.killChanceMax
      : 0,
  };
}

/**
 * 개체의 화면상 몸 반지름(근사). 표식이 몸을 파고들지도, 멀리 떠 있지도 않게 하는 데만 쓴다.
 * ⚠ `makeCreatureTexture` 의 `sizeScale`·`len` 식과 스프라이트에 곱하는 `personalityScale` 을
 *   그대로 따라 계산한 것이다. 그쪽 몸 크기 식이 바뀌면 여기도 같이 고쳐야 한다.
 */
export function bodyRadiusOf(e: Entity): number {
  const t = e.genome.traits;
  const sizeScale = 1 + sizeDev(t.size) * 0.62;
  const len = (9 + (t.speed / TRAIT_MAX) * 9) * sizeScale;
  return len * personalityScale(e.id);
}

/**
 * 위험 표식 — 개체를 감싸는 **붉은 톱니 링**(안쪽을 향한 이빨). 매끈한 원(내 종 고리·무리 방패·보스
 * 오라)과 형태부터 갈려 겹쳐도 구분된다. 세기(한 입에 죽을 확률)가 굵기·진하기에 실린다.
 * `prox` 는 거리 감쇠(가까울수록 1) — 먼 위협까지 진하게 칠하면 코앞의 위협이 안 도드라진다.
 */
export function drawThreatMark(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  strength: number,
  prox: number,
  pulse: number,
): void {
  const teeth = 9;
  const inner = r * 0.76;
  const pts: number[] = [];
  for (let k = 0; k < teeth * 2; k++) {
    const a = (k / (teeth * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = k % 2 === 0 ? r : inner;
    pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  // 위험은 먹잇감보다 **세게** 그린다 — 0.5 초 안에 골라야 하는 건 "어디가 위험한가"가 먼저다.
  const al = (0.5 + 0.45 * strength) * prox * (0.8 + 0.2 * pulse);
  g.poly(pts, true).stroke({ color: MARK_OUTLINE, width: 4.2 + strength, alpha: 0.42 * prox });
  g.poly(pts, true).stroke({ color: THREAT_COLOR, width: 2 + 1.6 * strength, alpha: al });
}

/**
 * 먹잇감 표식 — 개체 네 모서리의 **호박빛 조준 브래킷**. 링이 아니라 끊어진 갈고리 넷이라
 * 위험(톱니 링)과 한눈에 갈리고, 둘 다인 개체는 "톱니 링 + 브래킷"이 겹쳐 그대로 읽힌다.
 * 세기(내가 한 입에 죽일 확률)가 굵기·진하기에 실린다.
 */
export function drawPreyMark(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  strength: number,
  prox: number,
): void {
  const h = r * 1.02;
  const L = h * 0.46;
  // 같은 경로를 두 번 만든다 — Pixi 의 stroke() 는 경로를 소비하므로 밑선·윗선을 각각 그려야 한다.
  const build = (): void => {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = x + sx * h;
        const cy = y + sy * h;
        g.moveTo(cx - sx * L, cy).lineTo(cx, cy).lineTo(cx, cy - sy * L);
      }
    }
  };
  // 세기(내가 한 입에 죽일 확률)를 진하기에 크게 실어, "물 수는 있는데 잘 안 죽는 상대"와 "확실한 한 끼"가
  // 갈린다. 위험(붉은 톱니)보다 전체적으로 한 단계 연하게 둬 둘이 겹쳐도 위험이 먼저 눈에 든다.
  const w = 1.5 + 1.1 * strength;
  build();
  g.stroke({ color: MARK_OUTLINE, width: w + 2, alpha: 0.3 * prox });
  build();
  g.stroke({ color: PREY_COLOR, width: w, alpha: (0.26 + 0.58 * strength) * prox });
}

/**
 * 알파가 **못 들어가는 지형**을 덮는 정적 레이어.
 *
 * 매 프레임 다시 그리면 안 된다 — 타일이 수천 개라 폰에서 그대로 프레임을 갉아먹는다. 지형은
 * "알파의 통행 능력(수영·뭍·비행)이 바뀔 때"만 달라지므로 그 키가 바뀔 때만 다시 만든다
 * (드래프트로 수영을 얻으면 그 프레임에 바다가 열린다). 그 사이엔 이미 만든 도형을 재사용한다.
 */
export class LeadTerrainLayer {
  readonly g = new Graphics();
  private key = "";
  /**
   * 마지막으로 그린 지형 객체. 단계·런이 바뀌면 World 가 통째로 새로 생기므로 이 참조가 달라진다.
   * 참조로 비교하는 이유: 통행 능력이 그대로여도 **지형이 바뀌면 막힌 곳이 달라진다** — 호출부가
   * reset 을 불러 주기를 기대하면 한 군데만 빠뜨려도 화면이 옛 지도를 덮은 채 거짓말한다.
   */
  private terrainRef: object | null = null;

  /** 새 지형(런·단계 교체) — 다음 update 에서 무조건 다시 만든다. */
  reset(): void {
    this.key = "";
    this.terrainRef = null;
    this.g.clear();
  }

  /** caps 가 null 이면(조종 모드 꺼짐) 레이어를 통째로 비우고 숨긴다 = 기존 화면과 문자 그대로 같다. */
  update(world: World, caps: LeadCaps | null): void {
    if (caps === null) {
      if (this.key !== "") this.reset();
      this.g.visible = false;
      return;
    }
    this.g.visible = true;
    const k = passKey(caps);
    // 통행 능력도 지형도 그대로 → 이미 그려 둔 도형을 그냥 재사용한다(이 프레임 비용 0).
    if (k === this.key && world.terrain === this.terrainRef) return;
    this.key = k;
    this.terrainRef = world.terrain;
    this.rebuild(world, caps);
  }

  private rebuild(world: World, caps: LeadCaps): void {
    const g = this.g;
    g.clear();
    const terr = world.terrain;
    const cs = terr.cellSize;
    const cols = terr.cols;
    const rows = terr.rows;

    // 막힌 타일 표 — 판정은 sim 의 공개 메서드를 그대로 부른다(규칙을 다시 안 적는다).
    const blocked = new Uint8Array(cols * rows);
    let any = false;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const px = (cx + 0.5) * cs;
        const py = (cy + 0.5) * cs;
        if (!terr.isPassable(px, py, caps.canSwim, caps.canLand, caps.canFly)) {
          blocked[cy * cols + cx] = 1;
          any = true;
        }
      }
    }
    if (!any) return; // 비행 종은 어디든 간다 — 아무것도 안 덮는다

    // 1) 스크림 — 가로로 이어진 구간(run)을 사각형 하나로 묶어 도형 수를 줄인다(폰 GPU 는 정점에 민감).
    for (let cy = 0; cy < rows; cy++) {
      let start = -1;
      for (let cx = 0; cx <= cols; cx++) {
        const b = cx < cols && blocked[cy * cols + cx] === 1;
        if (b) {
          if (start < 0) start = cx;
        } else if (start >= 0) {
          g.rect(start * cs, cy * cs, (cx - start) * cs, cs).fill({ color: BLOCK_FILL, alpha: BLOCK_ALPHA });
          start = -1;
        }
      }
    }

    // 2) 경계선 — 갈 수 있는 곳과 맞닿은 변만 긋는다("여기까지"가 선 하나로 읽힌다).
    //    어두운 밑선 → 밝은 선 순서로 두 번. 밝은 지형(눈 덮인 산) 위에서도 선이 안 사라진다.
    const edges: number[] = []; // x0,y0,x1,y1 ...
    const hatch: number[] = []; // 경계에 닿은 막힌 타일의 대각 빗금(무늬로 "출입 금지"를 보탠다)
    const open = (cx: number, cy: number): boolean =>
      cx < 0 || cy < 0 || cx >= cols || cy >= rows ? false : blocked[cy * cols + cx] === 0;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (blocked[cy * cols + cx] === 0) continue;
        const x0 = cx * cs;
        const y0 = cy * cs;
        let border = false;
        if (open(cx, cy - 1)) { edges.push(x0, y0, x0 + cs, y0); border = true; }
        if (open(cx, cy + 1)) { edges.push(x0, y0 + cs, x0 + cs, y0 + cs); border = true; }
        if (open(cx - 1, cy)) { edges.push(x0, y0, x0, y0 + cs); border = true; }
        if (open(cx + 1, cy)) { edges.push(x0 + cs, y0, x0 + cs, y0 + cs); border = true; }
        if (border) hatch.push(x0, y0 + cs, x0 + cs, y0);
      }
    }
    const trace = (arr: readonly number[]): void => {
      for (let i = 0; i + 3 < arr.length; i += 4) {
        g.moveTo(arr[i] as number, arr[i + 1] as number).lineTo(arr[i + 2] as number, arr[i + 3] as number);
      }
    };
    if (edges.length > 0) {
      trace(edges);
      g.stroke({ color: 0x04060a, width: 3.2, alpha: 0.42 });
      trace(edges);
      g.stroke({ color: BLOCK_EDGE, width: 1.3, alpha: 0.5 });
    }
    if (hatch.length > 0) {
      trace(hatch);
      g.stroke({ color: BLOCK_EDGE, width: 1, alpha: 0.16 });
    }
  }
}
