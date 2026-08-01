// src/sim 순수성 정적 스캔 — "시뮬은 화면 없이 돌아간다"를 파일 내용으로 못 박는다.
//
// 왜 정적 스캔인가: 타입 검사도 단위 테스트도 이 위반을 못 잡는다. Pixi 를 하나 import 해도
// vitest 는 그냥 돌아가고(jsdom 없이도 모듈 로드는 된다), 그 순간 sim 은 "화면이 있어야 도는 코드"가
// 되어 헤드리스 재현·결정론 검증이 조용히 무너진다.
//
// 알파 조종(?alpha)을 붙이면서 이 파일을 세운 이유: 조종은 **입력**이라 손가락·키보드·URL 플래그가
// sim 안으로 새기 가장 쉬운 자리다. sim 이 아는 것은 "방향과 세기"(LeadCommand)까지이고,
// 그 값을 누가 어떻게 만들었는지(DOM·Pixi·?alpha)는 main/ui 층의 일이다.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 이 테스트 파일이 놓인 곳이 곧 검사 대상 디렉터리다(src/sim). */
const SIM_DIR = dirname(fileURLToPath(import.meta.url));

/** src/sim 안의 모든 .ts (테스트 파일 포함 — 테스트가 Pixi 를 끌어와도 순수성 신호가 흐려진다). */
function simFiles(): string[] {
  return readdirSync(SIM_DIR)
    .filter((f) => f.endsWith(".ts"))
    .sort();
}

/** 금지 문자열이 든 파일 목록(줄 번호까지) — 실패했을 때 어디를 고칠지 바로 보이게. */
function offenders(needle: string): string[] {
  const out: string[] = [];
  for (const file of simFiles()) {
    const lines = readFileSync(join(SIM_DIR, file), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.includes(needle)) out.push(`${file}:${i + 1}`);
    });
  }
  return out;
}

// ⚠ 금지 문자열을 **쪼개서** 조립한다. 통째로 적으면 이 파일 자신이 첫 번째 위반자로 걸려
//   영원히 빨간불이다. 그렇다고 이 파일을 검사 대상에서 빼면, 여기에 Pixi 를 import 해도 아무도
//   못 잡는 구멍이 생긴다 — 쪼개 두면 자기 자신까지 정직하게 검사된다.
const IMPORT = 'from "';
const NEEDLE_PIXI = IMPORT + 'pixi.js"';
const NEEDLE_DEBUG = IMPORT + '@/debug"';
const NEEDLE_RANDOM = "Math." + "random(";

describe("sim 순수성 (정적 스캔)", () => {
  it("검사할 sim 파일이 실제로 존재한다(스캔이 빈손으로 초록불 내지 않게)", () => {
    expect(simFiles().length).toBeGreaterThan(10);
    // 스캐너가 정말 무언가를 잡아내긴 하는가 — 확실히 존재하는 문자열로 확인한다.
    expect(offenders(IMPORT).length).toBeGreaterThan(10);
  });

  it('src/sim 은 "pixi.js" 를 import 하지 않는다', () => {
    // sim 은 순수 TypeScript다. 그리기는 src/render 에서만 한다(CLAUDE.md 최상위 구조 규칙).
    expect(offenders(NEEDLE_PIXI)).toEqual([]);
  });

  it('src/sim 은 "@/debug" 를 import 하지 않는다', () => {
    // ?alpha 같은 URL 플래그를 sim 이 직접 읽으면 "화면을 알아야 도는 시뮬"이 된다.
    // 조종 모드가 sim 에 닿는 통로는 world.lead 필드 하나뿐이어야 한다.
    expect(offenders(NEEDLE_DEBUG)).toEqual([]);
  });

  it("src/sim 은 시드 RNG 밖의 무작위를 부르지 않는다", () => {
    // 무작위는 전부 시드 RNG(rng.ts)로만 흐른다 — (게놈 + 환경 시드) → 항상 같은 결과.
    expect(offenders(NEEDLE_RANDOM)).toEqual([]);
  });
});
