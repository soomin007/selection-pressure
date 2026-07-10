// 사건 연출 레이어 — sim 이 emit 한 1회성 사건(탄생/죽음/잡아먹힘)을 짧고 생동감 있는 효과로 그린다.
// 순수 렌더: sim 을 읽지 않고 main 이 사건(위치)을 넣어준다. 월드 좌표계라 카메라와 함께 움직인다.
// "개체 수가 왜 늘고 주는지"를 한눈에 읽히게 + 소수 개체 관전에 순간의 맛을 준다(사냥은 터지고, 탄생은
// 반짝이고, 자연사는 조용히 스러진다). 파티클 변주는 위치 기반 시드로 결정론(Math.random 안 씀).

import { Container, Graphics } from "pixi.js";
import type { VisualEventKind } from "@/sim/world";

interface Particle {
  kind: VisualEventKind;
  x: number;
  y: number;
  age: number; // 경과(ms)
  life: number; // 수명(ms)
  seed: number; // 0~1, 파편·반짝임 방향/속도 변주용(위치에서 파생 → 결정론)
}

const LIFE: Record<VisualEventKind, number> = { birth: 720, death: 820, kill: 620, bite: 260 };
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

  spawn(kind: VisualEventKind, x: number, y: number): void {
    if (this.particles.length > 220) return; // 과부하 방지(대량 사망 시)
    this.particles.push({ kind, x, y, age: 0, life: LIFE[kind], seed: seedAt(x, y) });
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
  const fade = 1 - t; // 1→0 으로 옅어짐
  const e = 1 - (1 - t) * (1 - t); // easeOut — 처음 빠르게 퍼지고 끝에 느려짐(터지는 맛)
  const x = p.x;
  const y = p.y;
  if (p.kind === "kill") {
    drawKill(g, x, y, t, e, fade, p.seed);
  } else if (p.kind === "birth") {
    drawBirth(g, x, y, e, fade, p.seed);
  } else if (p.kind === "bite") {
    drawBite(g, x, y, e, fade, p.seed);
  } else {
    drawDeath(g, x, y, e, fade, p.seed);
  }
}

// 잡아먹힘/즉사 — 가장 극적인 순간. 흰 섬광 → 붉은 충격파 고리 → 사방으로 튀는 핏빛 파편(길이·각도 제각각).
function drawKill(g: Graphics, x: number, y: number, t: number, e: number, fade: number, seed: number): void {
  // 흰 섬광(맨 처음 아주 짧게 번쩍) — 타격의 임팩트.
  const flash = Math.max(0, 1 - t * 3.2);
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
  g.circle(x, y, 2 + e * 7).stroke({ color: 0xff6a4a, width: 1.8 * fade + 0.3, alpha: 0.8 * fade });
  const n = 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + seed * TAU;
    const d = 3 + e * 8;
    g.circle(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.4 * fade + 0.3).fill({ color: 0xff4326, alpha: 0.9 * fade });
  }
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
