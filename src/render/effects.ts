// 사건 연출 레이어 — sim 이 emit 한 1회성 사건(탄생/죽음/잡아먹힘)을 짧고 생동감 있는 효과로 그린다.
// 순수 렌더: sim 을 읽지 않고 main 이 사건(위치)을 넣어준다. 월드 좌표계라 카메라와 함께 움직인다.
// "개체 수가 왜 늘고 주는지"를 한눈에 읽히게 + 소수 개체 관전에 순간의 맛을 준다(사냥은 터지고, 탄생은
// 반짝이고, 자연사는 조용히 스러진다). 파티클 변주는 위치 기반 시드로 결정론(Math.random 안 씀).

import { Container, Graphics } from "pixi.js";
import type { VisualEventKind } from "@/sim/world";

// 탭 명령 피드백 핑 — **렌더 전용**이라 VisualEventKind(sim 타입)에 안 넣는다. 명령 접수/거부는
// 세계에서 일어난 사건이 아니라 입력에 대한 화면의 응답이고, sim 에 렌더 사정이 새면 순수성이 깨진다.
type PingKind = "go" | "deny";
// 반격 · 내 무리가 보스에게 **되받아친** 순간(sim 의 dealRaidHit 이 나는 자리). 물린 것(bite)과 같은
// 그림이면 "씹혔다"와 "되받아쳤다"가 화면에서 구별이 안 된다. 이건 sim 이 내는 세계의 사건이므로
// 원래 자리는 VisualEventKind 다 · sim 이 "counter" 를 그 union 에 더하면 아래 union 이 그대로
// 흡수하고(같은 문자열 리터럴은 union 에서 하나로 합쳐진다) main 의 배선(`effects.spawn(ev.kind, …)`)도
// 손댈 필요가 없다. sim 이 아직 안 냈으면 이 갈래는 그냥 안 불릴 뿐이다.
type CounterKind = "counter";
type ParticleKind = VisualEventKind | PingKind | CounterKind;

interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  tx: number; // 방향성 사건(spit)의 목표점 — 없으면 x,y 와 같다
  ty: number;
  age: number; // 경과(ms)
  life: number; // 수명(ms)
  seed: number; // 0~1, 파편·반짝임 방향/속도 변주용(위치에서 파생 → 결정론)
  dim: number; // 밝기 배율(1=내 무리 사건, <1=야생끼리 — 화면 소음 다이어트)
}

// block(튕김)은 짧고 단단해야 한다 — 길게 끌면 "막혔다"가 아니라 "뭔가 터졌다"로 읽힌다.
// go/deny(명령 핑)도 짧게 — 명령은 연달아 내리므로 오래 남으면 이전 핑이 다음 명령을 어지럽힌다.
// counter(반격)는 bite 보다 **짧고 날카롭게** · 격퇴 바가 한 번에 0.1px 도 안 움직이는 판이라,
// 사람이 실제로 읽는 것은 이 스파크다. 길게 끌면 여러 번의 반격이 뭉개져 "몇 번 쳤는지"가 사라진다.
// gene(방울을 주움)은 **여기서 안 그린다** · 값은 0 이다. 이유: `VisualEvent` 에는 amount 가 없어서
// 이 파일은 "몇 개짜리 방울을 주웠는지"를 원리적으로 알 수 없고, 그러면 3개짜리와 5개짜리가 같은
// 그림이 된다(수치가 화면 표시와 다르면 그건 거짓말이다). 방울 연출은 amount 를 아는
// `src/render/geneDrops.ts` 가 통째로 맡는다(방울 그리기 · 줍는 순간 · 화면 밖 쐐기).
// Record 가 모든 키를 요구하므로 항목 자체는 남겨 둔다 · 아래 spawn 이 gene 을 먼저 걸러낸다.
const LIFE: Record<ParticleKind, number> = {
  birth: 720, death: 820, kill: 620, bite: 240, spit: 200, block: 300, go: 350, deny: 250, counter: 190,
  gene: 0,
  // 금빛 짐승(황금 고블린)을 잡은 순간 — 시험 진행이 한 칸 오르는 사건이라 탄생(720)급으로 길게.
  goblin: 700,
};
const TAU = Math.PI * 2;

// 위치 → [0,1) 결정론 해시(파티클 시드). 같은 자리 사건은 늘 같은 모양(재현성, Math.random 회피).
function seedAt(x: number, y: number): number {
  let h = ((Math.trunc(x) * 73856093) ^ (Math.trunc(y) * 19349663)) >>> 0;
  h ^= h >>> 13;
  h = (h * 2246822519) >>> 0;
  return (h >>> 0) / 4294967296;
}

// 시드 + 인덱스 → [0,1) 결정론 난수(파편마다 다른 각도·길이).
function frand(seed: number, i: number): number {
  let h = ((Math.trunc(seed * 4294967296) + i * 2654435761) >>> 0) ^ 0x9e3779b9;
  h ^= h >>> 15;
  h = (h * 2246822519) >>> 0;
  return (h >>> 0) / 4294967296;
}

export class Effects {
  readonly container = new Container();
  private readonly g = new Graphics();
  private particles: Particle[] = [];

  constructor() {
    this.container.addChild(this.g);
  }

  // 인자 순서는 `world.emit` 과 **똑같이** 맞춘다(kind, x, y, mine, tx, ty). 예전엔 mine 이 맨 뒤 기본값
  // 인자라, 호출부가 그걸 안 넘겨도 컴파일이 통과했다. 실제로 그래서 아래 다이어트가 통째로 죽어 있었다
  // (2026-08-03 발견: 야생 사건이 예전처럼 다 튀고 있었다). 필수 인자로 바꿔 컴파일러가 잡게 한다.
  // ⚠ 인자 타입에 CounterKind 를 더해 둔 이유: sim 이 "counter" 를 VisualEventKind 에 더하기 전에도
  //   이 파일이 홀로 컴파일되고, 더한 뒤엔 union 이 합쳐져 호출부가 그대로 통과한다(배선 변경 0).
  spawn(kind: VisualEventKind | CounterKind, x: number, y: number, mine: boolean, tx?: number, ty?: number): void {
    if (kind === "gene") return; // 방울은 geneDrops.ts 가 맡는다(위 LIFE 주석). 여기 오면 회색 먼지가 된다.
    if (this.particles.length > 220) return; // 과부하 방지(대량 사망 시)
    // 야생끼리의 사건은 다이어트한다(2026-08-02 사용자: 남의 연출이 정신사납다) — 탄생·자연사는
    // 아예 생략(생태 배경 소음), 사냥·발사체 같은 격한 사건만 훨씬 옅게 남긴다(세계가 살아 있다는
    // 감은 유지하되 시선은 안 뺏게). 내 무리가 얽힌 사건은 예전 그대로 또렷이.
    if (!mine && (kind === "birth" || kind === "death")) return;
    this.particles.push({
      kind, x, y, tx: tx ?? x, ty: ty ?? y, age: 0, life: LIFE[kind], seed: seedAt(x, y),
      dim: mine ? 1 : 0.3,
    });
  }

  /**
   * 탭 명령 피드백 핑(렌더 전용 — sim 사건이 아니라 main 이 직접 부른다). 월드 좌표.
   * 'go' = 이동 명령 접수(차분한 라임 파문), 'deny' = 명령 거부(회청색 짧은 튕김 — 못 가는 곳).
   */
  spawnPing(x: number, y: number, kind: PingKind): void {
    if (this.particles.length > 220) return;
    this.particles.push({ kind, x, y, tx: x, ty: y, age: 0, life: LIFE[kind], seed: seedAt(x, y), dim: 1 });
  }

  /** 런/월드가 바뀌면 이전 사건 잔여를 지운다. */
  clear(): void {
    this.particles.length = 0;
    this.g.clear();
  }

  update(dtMS: number): void {
    const g = this.g;
    g.clear();
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.age += dtMS;
      if (p.age >= p.life) continue;
      drawParticle(g, p, p.age / p.life);
      alive.push(p);
    }
    this.particles = alive;
  }
}

function drawParticle(g: Graphics, p: Particle, t: number): void {
  // dim 을 fade 에 실어 야생끼리 사건은 선 굵기·알파가 함께 준다(따로 알파만 줄이는 것보다 존재감이
  // 확실히 작아진다). 내 무리 사건은 dim=1 이라 예전과 동일.
  const fade = (1 - t) * p.dim; // 1→0 으로 옅어짐
  const e = 1 - (1 - t) * (1 - t); // easeOut — 처음 빠르게 퍼지고 끝에 느려짐(터지는 맛)
  const x = p.x;
  const y = p.y;
  if (p.kind === "kill") {
    drawKill(g, x, y, t, e, fade, p.seed, p.dim);
  } else if (p.kind === "birth") {
    drawBirth(g, x, y, e, fade, p.seed);
  } else if (p.kind === "bite") {
    drawBite(g, x, y, e, fade, p.seed);
  } else if (p.kind === "spit") {
    drawSpit(g, x, y, p.tx, p.ty, p.age, p.life, p.seed, p.dim);
  } else if (p.kind === "block") {
    drawBlock(g, x, y, p.tx, p.ty, t, fade, p.seed);
  } else if (p.kind === "counter") {
    drawCounter(g, x, y, p.tx, p.ty, t, fade, p.seed);
  } else if (p.kind === "go") {
    drawGoPing(g, x, y, e, fade);
  } else if (p.kind === "deny") {
    drawDenyPing(g, x, y, t, fade);
  } else if (p.kind === "goblin") {
    drawGoblinCatch(g, x, y, e, fade, p.seed);
  } else {
    drawDeath(g, x, y, e, fade, p.seed);
  }
}

// 금빛 짐승(황금 고블린)을 잡았다 — 금빛 파문 + 사방으로 튀는 반짝 여덟. 시험 진행이 오르는 사건이라
// 사냥의 빨강(kill)과 확실히 구별되는 "얻었다" 색을 쓴다(방울·고블린 몸과 같은 금 계열).
function drawGoblinCatch(g: Graphics, x: number, y: number, e: number, fade: number, seed: number): void {
  g.circle(x, y, 5 + e * 20).stroke({ color: 0xffd24a, width: 2.4 * fade + 0.5, alpha: 0.85 * fade });
  g.circle(x, y, 3 + e * 10).stroke({ color: 0xfff3c4, width: 1.4 * fade + 0.3, alpha: 0.7 * fade });
  for (let k = 0; k < 8; k += 1) {
    const a = seed * TAU + (k * TAU) / 8;
    const d = 4 + e * (14 + 6 * ((seed * 13 + k) % 3));
    g.circle(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.7 * fade + 0.3).fill({
      color: k % 2 === 0 ? 0xffd24a : 0xffffff,
      alpha: 0.9 * fade,
    });
  }
}

// 이동 명령 접수 — 차분한 라임 파문. 목표 깃발(worldView 의 이동 목표 표식)과 같은 라임 계열이라
// "이 파문이 남긴 깃발"로 이어져 읽힌다. 파편 없이 고리만 — 명령 응답은 사건(탄생·사냥)보다 조용해야
// 화면이 안 시끄럽다(이동 명령은 몇 초에 한 번씩 계속 내린다).
function drawGoPing(g: Graphics, x: number, y: number, e: number, fade: number): void {
  g.circle(x, y, 4 + e * 14).stroke({ color: 0xbcf24e, width: 2 * fade + 0.4, alpha: 0.7 * fade });
  g.circle(x, y, 2 + e * 7).stroke({ color: 0xe4ffb0, width: 1.2 * fade + 0.3, alpha: 0.5 * fade });
  g.circle(x, y, 1.8 * fade + 0.4).fill({ color: 0xe4ffb0, alpha: 0.8 * fade });
}

// 명령 거부 — 회청색 짧은 튕김. 링이 부풀다 도로 움츠러들어 "밀려났다(안 된다)"로 읽히고, 가로 빗장이
// 진입 금지 표지를 만든다(X 는 죽음·삭제로 읽힐 수 있어 피했다). 색은 못 가는 지형 경계선
// (leadVision BLOCK_EDGE 0xaebfd2)과 같은 회청 계열 — "거부 = 길이 없는 곳"이 색으로 이어진다.
function drawDenyPing(g: Graphics, x: number, y: number, t: number, fade: number): void {
  const bounce = t < 0.45 ? t / 0.45 : 1 - ((t - 0.45) / 0.55) * 0.45; // 0→1→0.55 (부풀다 되밀림)
  const r = 3 + bounce * 8;
  g.circle(x, y, r).stroke({ color: 0xaebfd2, width: 2 * fade + 0.5, alpha: 0.85 * fade });
  g.moveTo(x - r * 0.7, y)
    .lineTo(x + r * 0.7, y)
    .stroke({ color: 0xcdd9e6, width: 1.8 * fade + 0.4, alpha: 0.8 * fade, cap: "round" });
}

/**
 * 튕김 — 이빨이 안 박힌 물기(biteOutcome.ignored). 예전엔 이 경우 화면에 아무것도 안 나와서
 * "왜 공격이 안 먹히지"를 알 방법이 없었다. **0.3초 안에 "막혔다"가 읽혀야 하므로 부드럽게 퍼지지
 * 않고 딱 서 있다가 사라진다** — 퍼지면 막힘이 아니라 폭발로 읽힌다.
 * (x,y)=물린 쪽, (tx,ty)=문 쪽. 단단한 호가 문 쪽을 향해 서고(방패), 불꽃이 문 쪽으로 되튄다(튕겨 나감).
 */
function drawBlock(
  g: Graphics, x: number, y: number, tx: number, ty: number, t: number, fade: number, seed: number,
): void {
  const dx = tx - x;
  const dy = ty - y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const ang = Math.atan2(uy, ux);
  const snap = Math.min(1, t / 0.3); // 앞 30% 에 탁 서고 나머지는 자리만 지키며 옅어진다
  const r = 7 + snap * 3.5;
  const half = 0.95; // 호의 반각(rad) — 약 55도. 정면만 막는다는 게 보이게 좁게.
  const cx = x + ux * 2.5;
  const cy = y + uy * 2.5;
  // ⚠ arc 앞에는 **반드시 moveTo 로 호의 시작점을 찍는다.** 모든 파티클이 Graphics 하나에 이어서
  //   그려지므로, 안 찍으면 직전 파티클이 남긴 끝점에서 여기까지 **직선이 그어진다**(화면을 가로지르는
  //   줄로 보인다 · 2026-08-04 사용자 보고). 같은 규칙을 worldView 의 시야 부채꼴이 이미 지키고 있다.
  const r2 = Math.max(1, r - 2.6);
  const a0 = ang - half;
  const b0 = ang - half * 0.7;
  g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r)
    .arc(cx, cy, r, a0, ang + half)
    .stroke({ color: 0xdff0ff, width: 2.6 * fade + 0.6, alpha: 0.9 * fade, cap: "round" });
  g.moveTo(cx + Math.cos(b0) * r2, cy + Math.sin(b0) * r2)
    .arc(cx, cy, r2, b0, ang + half * 0.7)
    .stroke({ color: 0xffffff, width: 1.3 * fade + 0.3, alpha: 0.75 * fade, cap: "round" });
  // 되튀는 불꽃 — 문 쪽으로 짧게 흩어진다.
  for (let i = 0; i < 3; i++) {
    const a = ang + (frand(seed, i) - 0.5) * 1.1;
    const s0 = r + 1;
    const s1 = s0 + (5 + frand(seed, i + 7) * 6) * (0.35 + snap * 0.65);
    g.moveTo(cx + Math.cos(a) * s0, cy + Math.sin(a) * s0)
      .lineTo(cx + Math.cos(a) * s1, cy + Math.sin(a) * s1)
      .stroke({ color: 0xbfe4ff, width: 1.5 * fade + 0.2, alpha: 0.8 * fade, cap: "round" });
  }
}

/**
 * 반격 · 내 무리가 보스를 **되받아친** 순간. 물린 것(drawBite, 붉은 살점)과 색·모양·방향이 전부 달라야
 * "씹혔다"와 "쳤다"가 갈린다: 밝은 금빛이 **보스 쪽으로** 곧게 뻗는다(bite 는 사방으로 흩어지는 붉은 파편).
 * (x,y)=때린 개체, (tx,ty)=맞은 보스. 방향이 없으면(같은 점) 위로 뻗는다.
 * 격퇴 바가 한 번에 1픽셀도 안 움직이는 구간이 있으므로, "지금 깎이고 있다"를 사람이 읽는 자리가 여기다.
 */
function drawCounter(
  g: Graphics, x: number, y: number, tx: number, ty: number, t: number, fade: number, seed: number,
): void {
  const dx = tx - x;
  const dy = ty - y;
  const d = Math.hypot(dx, dy);
  const ux = d > 0.001 ? dx / d : 0;
  const uy = d > 0.001 ? dy / d : -1; // 방향이 없으면 위로(하늘로 치켜든 반격)
  const ang = Math.atan2(uy, ux);
  const snap = Math.min(1, t / 0.22); // 앞 22% 에 탁 뻗고 나머지는 그 자리에서 옅어진다(날카롭게)
  // 확대(2026-08-13 결정 회의 안건 4 · B안): 배속 화면에서 반격이 읽히는 유일한 순간이 이 스파크라
  // 창의 길이·굵기를 키우고 창끝에 맞은 자리 번쩍임을 더했다. 수명(190ms)은 그대로 — 길어지면
  // 여러 번의 반격이 뭉개진다(위 LIFE 주석).
  const reach = 9 + snap * 20;
  const cx = x + ux * 3;
  const cy = y + uy * 3;
  // 뻗는 금빛 창 · 두 겹(바깥 진한 금 + 안쪽 흰빛)이라 어두운 지형·밤 오버레이 위에서도 안 묻힌다.
  g.moveTo(cx, cy)
    .lineTo(cx + ux * reach, cy + uy * reach)
    .stroke({ color: 0xffb524, width: 4.2 * fade + 0.6, alpha: 0.95 * fade, cap: "round" });
  // 창끝의 타격 번쩍 — 맞은 자리(보스 가장자리)가 아주 짧게 희게 번쩍여 "닿았다"가 읽힌다.
  const hitFlash = Math.max(0, 1 - t * 2.6);
  if (hitFlash > 0) {
    g.circle(cx + ux * reach, cy + uy * reach, 2.2 + 2.4 * hitFlash).fill({
      color: 0xffffff,
      alpha: 0.75 * hitFlash,
    });
  }
  g.moveTo(cx, cy)
    .lineTo(cx + ux * reach * 0.7, cy + uy * reach * 0.7)
    .stroke({ color: 0xfff4c8, width: 1.5 * fade + 0.3, alpha: 0.95 * fade, cap: "round" });
  // 창끝에서 갈라지는 불꽃 셋 · **보스 쪽으로만** 튄다(되받아친 방향이 형태로 읽힌다).
  for (let i = 0; i < 3; i++) {
    const a = ang + (frand(seed, i) - 0.5) * 0.9;
    const r0 = reach * 0.8;
    const r1 = r0 + (4 + frand(seed, i + 11) * 6) * snap;
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
      .lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
      .stroke({ color: 0xffd76a, width: 1.6 * fade + 0.2, alpha: 0.9 * fade, cap: "round" });
  }
  g.circle(x, y, 2.6 * fade + 0.6).fill({ color: 0xfff4c8, alpha: 0.9 * fade }); // 뿌리의 섬광(친 자리)
}

// 원거리 공격 — 뱉은 것/쏜 가시가 목표로 **빠르게 날아간다**(레일건 조준선 대신 생물다운 발사체). 비행은
// **거리 기반이되 아주 짧게**(sim 은 즉시 명중·처치하므로, 발사체가 느리면 "닿기 전에 이미 죽는다" — 사용자
// 지적). 짧은 꼬리 알갱이가 곧게 날아가 곧장 톡 튄다.
function drawSpit(g: Graphics, sx: number, sy: number, tx: number, ty: number, ageMs: number, life: number, seed: number, dim: number): void {
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.hypot(dx, dy) || 1;
  const flightMs = Math.min(dist / 1.7, 85); // 빠른 발사체(59px ≈ 35ms) — 죽음과 거의 동시에 명중해 어긋남이 안 보인다
  const travel = Math.min(1, ageMs / flightMs);
  const ux = dx / dist;
  const uy = dy / dist;
  if (travel < 1) {
    const px = sx + dx * travel;
    const py = sy + dy * travel;
    const tail = 5 + seed * 3; // 꼬리 길이(개체마다 조금 다름)
    // 비행 구간도 dim 을 먹인다 — 야생끼리의 발사체가 "정체 모를 흰 줄"로 시선을 뺏던 주범이다.
    g.moveTo(px - ux * tail, py - uy * tail).lineTo(px, py)
      .stroke({ color: 0xd9c47e, width: 2 * dim, alpha: 0.72 * dim, cap: "round" });
    g.circle(px, py, 2.2 * dim).fill({ color: 0xfff2c0, alpha: 0.95 * dim });
  } else {
    const it = Math.min(1, (ageMs - flightMs) / Math.max(1, life - flightMs)); // 도착 후 진행 0→1
    const fade = (1 - it) * dim;
    // 명중 — 작은 튐(닿아 터진 자리). 작고 짧아 화면을 안 어지럽힌다.
    g.circle(tx, ty, 1.5 + it * 5).stroke({ color: 0xe6cf88, width: 1.6 * fade + 0.3, alpha: 0.8 * fade });
    g.circle(tx, ty, 1.6 * fade + 0.3).fill({ color: 0xfff2c0, alpha: 0.85 * fade });
  }
}

// 잡아먹힘/즉사 — 가장 극적인 순간. 흰 섬광 → 붉은 충격파 고리 → 사방으로 튀는 핏빛 파편(길이·각도 제각각).
function drawKill(g: Graphics, x: number, y: number, t: number, e: number, fade: number, seed: number, dim: number): void {
  // 흰 섬광(맨 처음 아주 짧게 번쩍) — 타격의 임팩트. 야생끼리는 옅게(dim — 흰 번쩍임이 제일 시끄럽다).
  const flash = Math.max(0, 1 - t * 3.2) * dim;
  if (flash > 0) g.circle(x, y, 5 + e * 5).fill({ color: 0xffffff, alpha: 0.85 * flash });
  // 붉은 충격파 고리 — 빠르게 퍼지며 얇아진다.
  g.circle(x, y, 4 + e * 26).stroke({ color: 0xff4326, width: 3.2 * fade + 0.4, alpha: 0.92 * fade });
  // 사방으로 튀는 파편 — 각도·길이가 파편마다 달라 "터졌다"로 읽힌다.
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + seed * TAU;
    const spd = 0.6 + frand(seed, i) * 0.7; // 파편별 속도
    const r0 = 6 + e * 20 * spd;
    const r1 = r0 + (6 + frand(seed, i + 40) * 8) * fade; // 파편 길이
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    g.moveTo(x + ca * r0, y + sa * r0)
      .lineTo(x + ca * r1, y + sa * r1)
      .stroke({ color: 0xff7a4a, width: 2.2 * fade + 0.3, alpha: 0.9 * fade });
  }
}

// 탄생 — 경쾌한 팝. 초록 고리가 퍼지고, 밝은 속심 + 위로 흩날리는 반짝임 몇 점(새 생명의 들뜸).
function drawBirth(g: Graphics, x: number, y: number, e: number, fade: number, seed: number): void {
  g.circle(x, y, 3 + e * 17).stroke({ color: 0x9bff8a, width: 2.5 * fade + 0.3, alpha: 0.85 * fade });
  g.circle(x, y, 4 * fade + 1).fill({ color: 0xe9ffdc, alpha: 0.95 * fade });
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + seed * TAU;
    const r = e * (12 + frand(seed, i) * 8);
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r - e * 6; // 살짝 위로 떠오른다
    g.circle(px, py, 1.7 * fade + 0.4).fill({ color: 0xd6ffb0, alpha: 0.9 * fade });
  }
}

// 자연사 — 조용히 스러짐. 옅은 회색 퍼짐 + 아래로 가라앉는 먼지 몇 점(사냥의 붉은 터짐과 톤이 확실히 대비).
// 물렸다(즉사 아님) — 짧고 작게 튄다. 잡아먹힘(drawKill)의 축소판이라 "같은 종류의 사건"으로 읽히되,
// 크기·수명이 확연히 작아 "아직 안 죽었다"가 구분된다. 추격 중 여러 번 뜨므로 화면을 어지럽히면 안 된다.
function drawBite(g: Graphics, x: number, y: number, e: number, fade: number, seed: number): void {
  // 물기 — 딱딱한 링+점(폭발형) 대신 살점이 튀듯 짧은 파편이 흩뿌려진다(유기적, 사용자 피드백). 무는
  // 방향(seed)으로 살짝 쏠려 "여기를 물었다"가 읽히고, 작고 짧아 추격 중 여러 번 떠도 안 어지럽다.
  const n = 4;
  const base = seed * TAU;
  for (let i = 0; i < n; i++) {
    const a = base + (i / n) * TAU + (frand(seed, i) - 0.5) * 0.7;
    const r0 = 1.4 + e * 4;
    const r1 = r0 + (3 + frand(seed, i + 20) * 5) * fade;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    g.moveTo(x + ca * r0, y + sa * r0)
      .lineTo(x + ca * r1, y + sa * r1)
      .stroke({ color: 0xd94b34, width: 1.7 * fade + 0.3, alpha: 0.82 * fade, cap: "round" });
  }
  g.circle(x, y, 2.2 * fade + 0.6).fill({ color: 0xff6a4a, alpha: 0.55 * fade }); // 무른 중심(살점)
}

function drawDeath(g: Graphics, x: number, y: number, e: number, fade: number, seed: number): void {
  g.circle(x, y, 5 + e * 11).fill({ color: 0x8a909c, alpha: 0.5 * fade });
  g.circle(x, y, 5 + e * 11).stroke({ color: 0xb6bdca, width: 1.2 * fade, alpha: 0.45 * fade });
  const n = 4;
  for (let i = 0; i < n; i++) {
    const a = seed * TAU + i * 2.1;
    const r = e * (6 + frand(seed, i) * 6);
    const px = x + Math.cos(a) * r;
    const py = y + e * (7 + i * 1.5); // 아래로 가라앉는다
    g.circle(px, py, 1.5 * fade + 0.3).fill({ color: 0x9aa0ac, alpha: 0.5 * fade });
  }
}
