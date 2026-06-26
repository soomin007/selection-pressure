// 사건 연출 레이어 — sim 이 emit 한 1회성 사건(탄생/죽음/잡아먹힘)을 짧은 효과로 그린다.
// 순수 렌더: sim 을 읽지 않고 main 이 사건(위치)을 넣어준다. 월드 좌표계라 카메라와 함께 움직인다.
// "개체 수가 왜 늘고 주는지"를 한눈에 읽히게 + 떨리는 점 무더기에 생동감을 준다.

import { Container, Graphics } from "pixi.js";
import type { VisualEventKind } from "@/sim/world";

interface Particle {
  kind: VisualEventKind;
  x: number;
  y: number;
  age: number; // 경과(ms)
  life: number; // 수명(ms)
}

const LIFE: Record<VisualEventKind, number> = { birth: 640, death: 760, kill: 560 };

export class Effects {
  readonly container = new Container();
  private readonly g = new Graphics();
  private particles: Particle[] = [];

  constructor() {
    this.container.addChild(this.g);
  }

  spawn(kind: VisualEventKind, x: number, y: number): void {
    if (this.particles.length > 220) return; // 과부하 방지(대량 사망 시)
    this.particles.push({ kind, x, y, age: 0, life: LIFE[kind] });
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
  if (p.kind === "birth") {
    // 탄생 — 작은 점에서 초록 링이 퍼지며 사라짐 + 환한 속심
    g.circle(p.x, p.y, 4 + t * 15).stroke({ color: 0x9bff8a, width: 2.5, alpha: 0.9 * fade });
    g.circle(p.x, p.y, 3.5 * fade + 1).fill({ color: 0xe6ffd6, alpha: 0.95 * fade });
  } else if (p.kind === "death") {
    // 자연사 — 회색 원이 커지며 옅어짐(조용히 스러짐) + 옅은 테두리
    g.circle(p.x, p.y, 5 + t * 11).fill({ color: 0x8a909c, alpha: 0.6 * fade });
    g.circle(p.x, p.y, 5 + t * 11).stroke({ color: 0xb6bdca, width: 1.5, alpha: 0.5 * fade });
  } else {
    // 잡아먹힘/즉사 — 빨간 링 + 사방으로 튀는 선(터짐). 크고 또렷하게.
    const reach = 9 + t * 20;
    g.circle(p.x, p.y, 4 + t * 8).stroke({ color: 0xff5a3a, width: 2.5, alpha: 0.95 * fade });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      g.moveTo(p.x + Math.cos(a) * reach * 0.45, p.y + Math.sin(a) * reach * 0.45)
        .lineTo(p.x + Math.cos(a) * reach, p.y + Math.sin(a) * reach)
        .stroke({ color: 0xff8a5a, width: 2, alpha: 0.9 * fade });
    }
  }
}
