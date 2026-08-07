// 방울(유전자 점수) 렌더 레이어 · sim 의 `world.geneDrops` 를 **읽기만** 해서 그린다.
//
// 이 레이어가 지켜야 하는 것은 하나다: **처음 본 사람도 "저건 주우러 가야 하는 것"이라고 알아야 한다.**
// 이 프로젝트의 전달 규칙 1순위가 「그 자체로 보이는 것」이고, 대백과를 읽을 사람은 없다.
// 그래서 방울은 먹이와 **네 가지가 동시에** 다르다:
//   ① 떠 있다 · 먹이는 땅에 붙은 납작한 점인데 방울은 그림자를 아래 두고 공중에서 오르내린다.
//   ② 각졌다 · 먹이는 언제나 원인데 방울은 육각 보석이다(실루엣만으로 갈린다).
//   ③ 빛난다 · 후광 + 도는 빛살. 먹이에는 어떤 빛도 없다.
//   ④ **빛살 개수 = 값** · 3개짜리 방울은 빛살이 셋, 5개짜리는 다섯이다. 숫자를 안 읽어도 크기가 보인다.
// 후광의 바깥 지름은 `GENE_PICK_RADIUS` 그대로다 · 「저 빛 안에 무리를 넣으면 주워진다」가
// 화면에서 실제 판정과 1:1로 맞아떨어진다(수치가 화면 표시와 다르면 그건 거짓말이다).
//
// ⚠ **sim 을 고치지 않는다.** 줍는 순간도 sim 이 내주는 사건이 아니라 `drop.taken` 이 false→true 로
//    바뀌는 것을 이 레이어가 스스로 알아채서 연출한다. worldView 의 격퇴 바가 `boss.hp` 가 줄어든 것
//    하나만 보고 「방금 깎였다」를 그리는 것과 같은 방식이고, 판정을 렌더에서 새로 만들지 않으므로
//    연출과 실제가 정의상 어긋날 수 없다.

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { COLORS } from "@/config";
import type { World } from "@/sim/world";
import type { GeneDrop } from "@/sim/gene";
import { GENE_PICK_RADIUS, GENE_REASON_LABELS } from "@/sim/gene";
import { SIM } from "@/sim/params";

const TAU = Math.PI * 2;

// ── 색 ────────────────────────────────────────────────────────────────────────
// 금빛 계열. 먹이(초록·청록·황록·주황·흰빛)와 색만으로는 못 가르므로 위 ①~④가 함께 일한다.
// 시험 표식(0xffd24a)도 금빛이지만 그건 **야생 몸에 두른 빈 고리**라 실루엣이 아예 다르다.
// ⚠ 본체 색만은 이 파일이 정하지 않는다 · HUD 카운터(`ui/genePanel` 의 `--gene`)와 **같은 값**이어야
//   「저 금빛을 밟았더니 저 숫자가 올랐다」가 이어진다. 단일 진실은 `config.ts` 의 `COLORS.gene` 이다.
const GENE_GOLD = COLORS.gene; // 본체
const GENE_CORE = 0xfff4c8; // 속심·빛살 끝(밝은 흰금)
const GENE_DARK = 0x0b0e14; // 밑선 · 밝은 지형(사막·눈) 위에서 표식이 사라지는 걸 막는다
const GENE_TEXT = 0xffe9a8;

// ── 시간 상수 ─────────────────────────────────────────────────────────────────
/** 나타나는 연출이 도는 시간(초). 이 동안 보석이 자라고 링이 퍼진다. */
const SPAWN_SEC = 0.7;
/** 줍는 순간 연출의 수명(ms). 짧고 분명하게 · 길게 끌면 다음에 주운 것과 뭉갠다. */
const BURST_MS = 620;
/** 나타난 자리에 잠깐 뜨는 문구의 수명(ms). */
const LABEL_MS = 1800;
/** 주운 자리에서 떠오르는 「+N」의 수명(ms). */
const GAIN_MS = 950;
/** 동시에 떠 있는 문구 상한 · 한꺼번에 여러 개가 뜨면 서로 겹쳐 아무것도 안 읽힌다. */
const MAX_LABELS = 6;

// ── 화면 밖 방울을 가리키는 쐐기 ───────────────────────────────────────────────
// 세로 화면 + 기본 줌(2.2)에서 보이는 월드는 대각 250px 남짓인데, 방울은 무리에서 120~320px 떨어져
// 나타난다(`GENE_SPAWN_RING`). 즉 **태어나는 방울의 상당수가 화면 밖**이라, 가리키는 것이 없으면
// 있는 줄도 모른 채 사라진다. 미니맵이 이미 조망 장치이지만 거기는 점 하나가 1.6px 이라 금빛 방울을
// 얹어도 내 무리 점과 안 갈린다 · 그래서 「어느 쪽인가」는 화면 가장자리 쐐기가 맡는다.
// (미니맵에도 방울 점을 얹는 것은 minimap.ts 임자의 몫으로 남겼다.)
/** 동시에 그리는 쐐기 수 상한. 가까운 것부터. 넷 이상이면 가장자리가 화살표 밭이 된다. */
const ARROW_MAX = 3;
/** 쐐기 아이콘의 화면 크기(CSS px) · 줌으로 나눠 월드px 로 바꿔 쓰므로 어느 배율에서도 같은 크기다. */
const ARROW_ICON_CSS = 6.2;
/** 쐐기 하나가 중심에서 화살촉 끝까지 뻗는 거리(아이콘 크기의 배수) · `tipR` 과 같은 값이다. */
const ARROW_HALF = 3.4;
// 가장자리 여백(CSS px). 위쪽은 목표 한 줄, 우상단은 미니맵을 피한다.
// ⚠ 이 수치는 minimap.ts(MM_W 84 · MM_TOP 64)와 상단 UI 배치를 보고 잡은 **복제값**이다
//   (scripts/overlap-check.mjs 가 미니맵 상수를 복제하는 것과 같은 사정). 저쪽을 옮기면 여기도 옮긴다.
const ARROW_PAD_CSS = 30;
const ARROW_TOP_CSS = 78;
const ARROW_BOTTOM_CSS = 44;
/**
 * 우상단 미니맵이 차지하는 대략의 상자(CSS px) · 이 안에 쐐기가 들어가면 밀어낸다.
 * 미니맵은 폭 84 + 여백 10 이고 높이가 월드 종횡비로 정해지는데(폰 세로에서 약 182), 데스크톱
 * 확대 배율(uiScale)이 곱해지면 더 커진다. 그래서 실측값보다 넉넉하게 잡는다 · 넉넉해서 손해 보는
 * 것은 쐐기가 모서리에서 조금 물러나는 것뿐이고, 모자라면 지도와 화살표가 겹쳐 둘 다 못 읽는다.
 */
const MINIMAP_BOX_W_CSS = 130;
const MINIMAP_BOX_H_CSS = 270;

/** 지금 보이는 월드 구간 · worldView 가 자기 카메라 상태를 그대로 넘긴다. */
export interface GeneView {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
  /** 월드px → 화면px 배율. 화면 고정 크기 아이콘을 그릴 때 나눗셈에 쓴다. */
  zoom: number;
  /**
   * **DOM 목표 줄이 지금 실제로 차지한 아래 끝**(이 레이어와 같은 논리 화면 단위).
   *
   * 왜 필요한가: 위 `ARROW_TOP_CSS` 같은 고정값은 문구가 길어지는 순간 틀린다. 이 저장소는
   * 캔버스 글씨에서 이미 같은 사고를 겪고 `goalBar.bottomPx()` 를 넘기는 길을 만들어 뒀다
   * (main.ts 의 `hudSafe` · "고정값(예전 66px)은 문구가 길어지는 순간 틀린다").
   * 쐐기도 같은 근거를 써야 보스 위협 두 줄·관문 칩으로 HUD 가 자랄 때 그 뒤에 안 깔린다.
   * 안 넘기면 0 으로 보고 예전처럼 고정값만 쓴다(배선 안 한 화면에서도 안 깨지게).
   */
  topSafe?: number;
}

/** 줍는 순간의 연출 하나(렌더 전용 상태). */
interface Burst {
  x: number;
  y: number;
  amount: number;
  age: number;
}

/** 떠오르는 문구 하나(렌더 전용 상태). */
interface Label {
  t: Text;
  x: number;
  y: number;
  age: number;
  life: number;
  /** 수명 동안 위로 뜨는 거리(월드px). */
  rise: number;
}

const clampRange = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class GeneDropLayer {
  /** 지면 표식(그림자·바닥 광원·부르는 파문) · 생물 **아래** 레이어. */
  readonly groundG = new Graphics();
  /** 방울 본체 · 줍기 연출 · 화면 밖 쐐기 · 생물 **위** 레이어(무리가 밟고 지나가도 안 묻힌다). */
  readonly mainG = new Graphics();
  /** 문구 · 밤/대멸종 틴트 **위** 레이어(어떤 조명에서도 읽혀야 한다). */
  readonly textC = new Container();

  /** 지금 보고 있는 방울 배열(참조). 세계가 바뀌면 참조가 바뀌므로 그걸로 시대 전환을 안다. */
  private dropsRef: GeneDrop[] | null = null;
  /**
   * 인덱스별로 「이미 주워진 것을 봤는가」. 방울 배열은 push 만 하고 **지우지 않으므로**(gene.ts)
   * 인덱스가 곧 방울의 신원이다. 길이는 곧 「지난 프레임까지 본 방울 수」라, 그보다 뒤 인덱스는
   * 이번 프레임에 새로 나타난 방울이다(등장 연출·문구의 근거).
   */
  private takenSeen: boolean[] = [];
  private bursts: Burst[] = [];
  private labels: Label[] = [];
  private readonly textPool: Text[] = [];
  /** 맥동·회전용 자체 시계(ms). sim 틱과 무관해야 일시정지 중에도 화면이 죽지 않는다. */
  private timeMS = 0;

  /** 런/월드가 갈릴 때 · 지난 세계의 방울 연출이 새 화면 첫 프레임에 남지 않게 통째로 비운다. */
  reset(): void {
    this.dropsRef = null;
    this.takenSeen.length = 0;
    this.bursts.length = 0;
    for (const l of this.labels) {
      l.t.visible = false;
      this.textPool.push(l.t);
    }
    this.labels.length = 0;
    this.groundG.clear();
    this.mainG.clear();
  }

  /**
   * 한 프레임. **sim 을 수정하지 않는다** · `world.geneDrops` 를 읽고, `taken` 이 이번에 켜진 것을
   * 찾아 줍기 연출을 띄우고, 남은 방울을 그린다.
   */
  sync(world: World, dtMS: number, view: GeneView): void {
    this.timeMS += dtMS;
    const drops = world.geneDrops;
    if (drops !== this.dropsRef) {
      // 새 세계 · 인덱스 신원이 통째로 갈리므로 「봤다」 기록을 버린다(안 버리면 새 방울이 이미
      // 주워진 것으로 보이거나, 지난 세계 연출이 새 자리에서 터진다).
      this.reset();
      this.dropsRef = drops;
    }

    // ① 사건 감지 · 새로 생긴 방울과 방금 주워진 방울.
    for (let i = 0; i < drops.length; i += 1) {
      const d = drops[i];
      if (!d) continue;
      if (i >= this.takenSeen.length) {
        this.takenSeen.push(d.taken);
        // 나타난 이유를 그 자리에서 한 번 말한다 · 「왜 이게 생겼는지」를 대백과에 미루지 않는다.
        if (!d.taken) this.pushLabel(`${GENE_REASON_LABELS[d.reason]} +${d.amount}`, d.x, d.y - 26, 9, LABEL_MS, 12);
        continue;
      }
      if (d.taken && this.takenSeen[i] !== true) {
        this.takenSeen[i] = true;
        this.bursts.push({ x: d.x, y: d.y, amount: d.amount, age: 0 });
        this.pushLabel(`+${d.amount}`, d.x, d.y - 12, 12, GAIN_MS, 20);
      }
    }

    // ② 그리기.
    this.groundG.clear();
    this.mainG.clear();
    const offView: { d: GeneDrop; dist: number }[] = [];
    for (const d of drops) {
      if (d.taken) continue;
      // 후광 반경만큼 여유를 둬야 가장자리에 반쯤 걸친 방울이 통째로 사라지지 않는다.
      if (this.inView(d.x, d.y, GENE_PICK_RADIUS + 8, view)) {
        this.drawDrop(d, world.tick);
      } else {
        const dx = d.x - view.cx;
        const dy = d.y - view.cy;
        offView.push({ d, dist: dx * dx + dy * dy });
      }
    }
    if (offView.length > 0 && view.halfW < 1e8) {
      offView.sort((a, b) => a.dist - b.dist);
      const n = Math.min(ARROW_MAX, offView.length);
      for (let i = 0; i < n; i += 1) {
        const item = offView[i];
        if (item) this.drawOffScreenArrow(item.d, view);
      }
    }

    this.drawBursts(dtMS);
    this.stepLabels(dtMS);
  }

  private inView(x: number, y: number, margin: number, view: GeneView): boolean {
    return (
      Math.abs(x - view.cx) <= view.halfW + margin && Math.abs(y - view.cy) <= view.halfH + margin
    );
  }

  // ── 방울 한 알 ──────────────────────────────────────────────────────────────

  /**
   * 필드에 놓인 방울 하나. 값(amount)은 **빛살 개수**로 나온다 · 숫자를 못 읽어도 3개짜리와
   * 5개짜리가 실루엣에서 갈린다. 나타난 뒤 `SPAWN_SEC` 동안 보석이 자라고 링이 퍼져,
   * 「방금 생겼다」와 「아까부터 있었다」가 구별된다.
   */
  private drawDrop(d: GeneDrop, tick: number): void {
    const bornT = clampRange((tick - d.bornTick) / (SPAWN_SEC * SIM.stepsPerSecond), 0, 1);
    const grow = 1 - (1 - bornT) * (1 - bornT); // easeOut · 톡 튀어나오는 맛
    const ph = this.timeMS / 1000;
    // 방울마다 위상을 어긋낸다 · 여럿이 한 박자로 뛰면 화면이 스트로브처럼 깜빡인다.
    const off = (d.bornTick % 37) * 0.17 + (d.amount % 5) * 0.29;
    const pulse = 0.5 + 0.5 * Math.sin(ph * 2.0 + off);
    const bob = Math.sin(ph * 1.6 + off) * 2.2;
    const spin = ph * 0.9 + off; // 6.9초에 한 바퀴 · 빛살을 세어 볼 수 있을 만큼 느리게
    const gx = d.x;
    const gy = d.y - (7 + bob) * grow; // **떠 있다** · 먹이(땅에 붙은 점)와 갈리는 첫 신호

    // 바닥 · 그림자가 있어야 「떠 있다」가 착시가 아니라 사실로 읽힌다.
    this.groundG.ellipse(d.x, d.y + 1, 6.4 * grow, 2.5 * grow).fill({ color: 0x000000, alpha: 0.2 });
    this.groundG
      .ellipse(d.x, d.y + 1, 13 * grow, 5.2 * grow)
      .fill({ color: GENE_GOLD, alpha: (0.07 + 0.04 * pulse) * grow });
    // 안으로 조여드는 파문 · 밖으로 퍼지면 폭발(위험)로 읽힌다. 안으로 모이면 「여기로 와라」다.
    // 파문의 시작 지름 = 줍기 반경 · 「이 안에 무리를 넣으면 주워진다」가 판정과 정확히 같다.
    const rt = ((this.timeMS / 1500 + off) % 1 + 1) % 1;
    const rr = GENE_PICK_RADIUS * (1 - rt) * grow;
    if (rr > 1) {
      this.groundG
        .ellipse(d.x, d.y + 1, rr, rr * 0.42)
        .stroke({ color: GENE_GOLD, width: 1.6, alpha: 0.5 * rt * grow });
    }

    // 후광 · 바깥 지름이 줍기 반경 그대로다.
    this.mainG
      .circle(gx, gy, GENE_PICK_RADIUS * grow)
      .fill({ color: GENE_GOLD, alpha: (0.065 + 0.04 * pulse) * grow });
    this.mainG.circle(gx, gy, 10.5 * grow).fill({ color: GENE_GOLD, alpha: 0.1 * grow });

    drawGeneIcon(this.mainG, gx, gy, 6.8 * grow, d.amount, spin, 1);

    // 나타나는 순간의 링 · 멀리서도 「지금 뭔가 생겼다」가 보인다.
    if (bornT < 1) {
      const f = 1 - bornT;
      this.mainG
        .circle(gx, gy, 5 + grow * 26)
        .stroke({ color: GENE_CORE, width: 2.4 * f + 0.3, alpha: 0.85 * f });
    }
  }

  // ── 줍는 순간 ───────────────────────────────────────────────────────────────

  /**
   * 「밟고 지나가면 주워진다」의 그 순간. 금빛 고리가 퍼지고 알갱이가 **위로** 빨려 올라간다
   * (아래로 흩어지면 흘린 것으로 읽힌다 · 위로 오르면 내 것이 됐다로 읽힌다).
   * 사냥의 붉은 터짐·탄생의 초록 팝과 색이 확실히 갈려서 사건이 안 뭉갠다.
   */
  private drawBursts(dtMS: number): void {
    if (this.bursts.length === 0) return;
    const alive: Burst[] = [];
    for (const b of this.bursts) {
      b.age += dtMS;
      if (b.age >= BURST_MS) continue;
      const t = b.age / BURST_MS;
      const fade = 1 - t;
      const e = 1 - (1 - t) * (1 - t);
      // 흰 섬광 · 맨 앞 짧게만(주웠다는 타격감).
      if (t < 0.3) {
        const f = 1 - t / 0.3;
        this.mainG.circle(b.x, b.y, 4 + e * 7).fill({ color: 0xffffff, alpha: 0.7 * f });
      }
      this.mainG
        .circle(b.x, b.y, 4 + e * 24)
        .stroke({ color: GENE_GOLD, width: 3 * fade + 0.4, alpha: 0.9 * fade });
      // 알갱이 개수 = 주운 값. 「몇 개 들어왔나」가 숫자를 안 읽어도 보인다.
      // 어두운 테두리를 먼저 깔아야 밝은 지형(사막·눈) 위에서도 알갱이가 안 사라진다.
      const n = Math.max(1, Math.min(8, Math.round(b.amount)));
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * TAU + b.amount * 0.7;
        const r = e * 15;
        const px = b.x + Math.cos(a) * r;
        const py = b.y + Math.sin(a) * r - e * 16; // 위로 빨려 올라간다
        const rr = 2.6 * fade + 0.6;
        this.mainG.circle(px, py, rr + 0.9).fill({ color: GENE_DARK, alpha: 0.45 * fade });
        this.mainG.circle(px, py, rr).fill({ color: GENE_GOLD, alpha: 0.95 * fade });
        this.mainG.circle(px, py, rr * 0.5).fill({ color: GENE_CORE, alpha: 0.95 * fade });
      }
      alive.push(b);
    }
    this.bursts = alive;
  }

  // ── 화면 밖 쐐기 ────────────────────────────────────────────────────────────

  /**
   * 화면 밖 방울을 가리키는 쐐기 · 가장자리 안쪽에 붙이고 방울 쪽을 향한다.
   * 쐐기 뒤에는 **방울과 똑같은 아이콘**(빛살 개수까지)을 화면 고정 크기로 붙인다 · 가리키는 것과
   * 가서 만나는 것이 같은 그림이라야 「저 화살표가 그 금빛 보석이다」가 설명 없이 이어진다.
   */
  private drawOffScreenArrow(d: GeneDrop, view: GeneView): void {
    const z = view.zoom > 0 ? view.zoom : 1;
    const padW = Math.max(10, ARROW_PAD_CSS / z);
    // 위쪽 여백은 **지금 HUD 가 실제로 차지한 높이**를 넘는다 · 쐐기 반쪽(ARROW_HALF)까지 더해야
    // 화살촉 끝이 알약 뒤로 안 들어간다. `topSafe` 를 안 넘기면 예전 고정값 그대로 돈다.
    const topGuard = Math.max(ARROW_TOP_CSS, (view.topSafe ?? 0) + ARROW_ICON_CSS * ARROW_HALF);
    const padTop = Math.max(10, topGuard / z);
    const padBottom = Math.max(10, ARROW_BOTTOM_CSS / z);
    let ax = clampRange(d.x, view.cx - view.halfW + padW, view.cx + view.halfW - padW);
    let ay = clampRange(d.y, view.cy - view.halfH + padTop, view.cy + view.halfH - padBottom);
    // 우상단 미니맵 상자를 피한다 · 지도 위에 화살표가 겹치면 둘 다 못 읽는다.
    const boxL = view.cx + view.halfW - MINIMAP_BOX_W_CSS / z;
    const boxB = view.cy - view.halfH + MINIMAP_BOX_H_CSS / z;
    if (ax > boxL && ay < boxB) {
      // 아래로 밀되, 그러다 화면 아래로 나가면 대신 왼쪽으로 밀어낸다.
      if (boxB <= view.cy + view.halfH - padBottom) ay = boxB;
      else ax = boxL;
    }

    const dx = d.x - ax;
    const dy = d.y - ay;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;
    const ux = dx / dist;
    const uy = dy / dist;
    const s = ARROW_ICON_CSS / z; // 화면 고정 크기(어느 배율에서도 같은 크기로 보인다)
    const ph = this.timeMS / 1000;
    // 가장자리에 붙은 표식은 가만히 있으면 화면 얼룩으로 읽힌다 · 방울 쪽으로 살짝 밀렸다 돌아온다.
    const nudge = (0.5 + 0.5 * Math.sin(ph * 3.2)) * s * 0.9;
    const bx = ax + ux * nudge;
    const by = ay + uy * nudge;

    drawGeneIcon(this.mainG, bx, by, s, d.amount, ph * 0.9, 0.95);

    // 쐐기 · 아이콘 바깥쪽으로 뾰족하게.
    const px = -uy;
    const py = ux;
    const tipR = s * ARROW_HALF;
    const baseR = s * 2.2;
    const half = s * 1.25;
    const tri = [
      bx + ux * tipR, by + uy * tipR,
      bx + ux * baseR + px * half, by + uy * baseR + py * half,
      bx + ux * baseR - px * half, by + uy * baseR - py * half,
    ];
    this.mainG
      .poly(tri)
      .fill({ color: GENE_GOLD, alpha: 0.95 })
      .stroke({ color: GENE_DARK, width: s * 0.34, alpha: 0.7 });
  }

  // ── 문구 ────────────────────────────────────────────────────────────────────

  /** 떠오르는 문구 하나를 띄운다. 상한을 넘으면 가장 오래된 것을 밀어낸다. */
  private pushLabel(text: string, x: number, y: number, size: number, life: number, rise: number): void {
    while (this.labels.length >= MAX_LABELS) {
      const old = this.labels.shift();
      if (!old) break;
      old.t.visible = false;
      this.textPool.push(old.t);
    }
    const t = this.acquireText();
    t.style.fontSize = size;
    t.text = text;
    t.visible = true;
    t.x = x;
    t.y = y;
    this.labels.push({ t, x, y, age: 0, life, rise });
  }

  private acquireText(): Text {
    const reused = this.textPool.pop();
    if (reused) return reused;
    const t = new Text({
      text: "",
      style: new TextStyle({
        fill: GENE_TEXT,
        fontSize: 10,
        fontWeight: "800",
        // 굵은 어두운 테두리 · 사막·눈·풀 어디 위에 떠도 글씨가 안 사라진다(격퇴 숫자와 같은 이유).
        stroke: { color: 0x0b0e14, width: 4 },
      }),
    });
    t.anchor.set(0.5, 0.5);
    // 월드 레이어는 카메라 줌으로 확대되므로 화면 배율만큼 높은 해상도로 굽는다(흐림 방지).
    t.resolution = Math.min(4, (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1) * 2);
    this.textC.addChild(t);
    return t;
  }

  private stepLabels(dtMS: number): void {
    if (this.labels.length === 0) return;
    const alive: Label[] = [];
    for (const l of this.labels) {
      l.age += dtMS;
      if (l.age >= l.life) {
        l.t.visible = false;
        this.textPool.push(l.t);
        continue;
      }
      const t = l.age / l.life;
      const e = 1 - (1 - t) * (1 - t);
      l.t.x = l.x;
      l.t.y = l.y - l.rise * e;
      // 앞 15% 에 뜨고 뒤 40% 에 스러진다 · 중간은 또렷하게 서 있어야 읽을 시간이 생긴다.
      l.t.alpha = t < 0.15 ? t / 0.15 : t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      alive.push(l);
    }
    this.labels = alive;
  }
}

/**
 * 방울 아이콘 한 개 · **필드의 방울과 화면 밖 쐐기가 같은 함수를 쓴다.** 둘이 다른 그림이면
 * 「저 화살표가 가리키는 게 그 금빛 보석」이라는 연결이 끊긴다.
 *
 * `amount` 는 **빛살 개수**로 나온다 · 값이 그림 자체다(숫자를 안 읽어도 크기가 보인다).
 * 몸통이 육각인 이유는 먹이가 언제나 원이기 때문이다 · 각진 실루엣 하나로 이미 갈린다.
 *
 * ⚠ `arc()` 를 안 쓴다. Pixi v8 의 `stroke()` 는 직전 끝점을 현재 위치로 남기므로 곧바로 `arc()` 를
 *   부르면 도형 사이가 직선으로 메워진다(worldView 의 토막 링 주석에 적힌 그 함정).
 */
function drawGeneIcon(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  amount: number,
  spin: number,
  alpha: number,
): void {
  if (r <= 0.2) return;
  const n = Math.max(1, Math.min(8, Math.round(amount)));
  for (let i = 0; i < n; i += 1) {
    const a = spin + (i / n) * TAU;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const r0 = r * 0.9;
    const r1 = r * 1.95;
    const x0 = x + ca * r0;
    const y0 = y + sa * r0;
    const x1 = x + ca * r1;
    const y1 = y + sa * r1;
    // 어두운 밑선을 먼저 깔고 금빛을 얹는다 · 밝은 지형 위에서 빛살이 통째로 사라지는 걸 막는다.
    g.moveTo(x0, y0).lineTo(x1, y1)
      .stroke({ color: GENE_DARK, width: r * 0.46, alpha: 0.45 * alpha, cap: "round" });
    g.moveTo(x0, y0).lineTo(x1, y1)
      .stroke({ color: GENE_GOLD, width: r * 0.24, alpha: 0.95 * alpha, cap: "round" });
    g.circle(x1, y1, r * 0.23).fill({ color: GENE_CORE, alpha: 0.95 * alpha });
  }
  const pts: number[] = [];
  for (let k = 0; k < 6; k += 1) {
    const a = spin * 0.5 + (k / 6) * TAU;
    pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.94);
  }
  g.poly(pts)
    .fill({ color: GENE_GOLD, alpha: 0.95 * alpha })
    .stroke({ color: GENE_DARK, width: r * 0.24, alpha: 0.6 * alpha });
  g.circle(x, y, r * 0.42).fill({ color: GENE_CORE, alpha: 0.95 * alpha });
}
