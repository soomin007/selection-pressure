// 월드 렌더. sim 상태를 "읽기"만 한다. (sim 은 Pixi 를 import 하지 않는다.)
// 생물 = 형질 기반 스프라이트(종마다 게놈에서 텍스처 1장 생성해 재사용 → 가볍다).
//   몸 길쭉함=속도, 눈 크기=시야, 등가시=공격력, 앞주둥이/이빨=식성. 진행 방향으로 회전.
// 배경=환경, 먹이=초록 점, 보스=빨강+위험 반경, 대멸종=화면 틴트.

import { Container, Graphics, Sprite, Text, TextStyle, Texture, type Renderer } from "pixi.js";
import type { World } from "@/sim/world";
import type { Entity } from "@/sim/entity";
import type { Boss, BossType, Layer } from "@/sim/boss";
// ⚠ "누가 맞설 수 있는가"·"이 보스를 깎을 수 있는가"는 **sim 이 판정한다.** 렌더는 조건식을 다시
//   쓰지 않고 sim 의 그 함수(isRaidFighter · bossRaidable)를 그대로 부른다 · 층위·수풀 엄폐·형질
//   문턱이 전부 그 안에 있어서, 표식이 붙은 개체 = 실제로 때리는 개체가 정의상 어긋날 수 없다.
//   (world.entities 는 매 스텝 끝에 산 개체만 남게 걸러지므로 sim 쪽 alive 검사와도 결과가 같다.)
//   비용: 내 종 개체(수십 마리)에 프레임당 한 번이라 폰에서도 무시할 수준이다.
import { bossRaidable, isRaidFighter } from "@/sim/boss";
import { TILE, type Terrain, type TileKind } from "@/sim/terrain";
import type { Biome } from "@/sim/environment";
import { TRAIT_KEYS, TRAIT_MAX, type Genome } from "@/sim/genome";
import { SIM } from "@/sim/params";
import { DEBUG, TUNE } from "@/debug";
import {
  personalityScale,
  personalityStretch,
  personalityTint,
  creatureLook,
  lookBucket,
  DEFAULT_LOOK,
  type CreatureLook,
} from "@/render/creatureLook";
import {
  grassVisionFactor,
  nightVisionFactor,
  sizeDev,
  effectiveCamo,
  herdShielded,
  isApex,
  outrunsHunters,
  leadTargetRange,
} from "@/sim/behavior";
import type { CosmeticId } from "@/game/achievements";
// 방울(유전자 점수) · 그리기·줍기 연출·화면 밖 쐐기가 전부 그 파일 안에 산다. 여기서는 레이어를
// 올바른 z 순서에 끼우고 프레임마다 한 번 부르기만 한다(worldView 가 이미 1900줄이다).
import { GeneDropLayer } from "@/render/geneDrops";
import { CARRION_ROT_TICKS, carcassEdible } from "@/sim/carrion";
import {
  LeadTerrainLayer,
  bodyRadiusOf,
  drawLockedPreyMark,
  drawPreyMark,
  drawThreatMark,
  leadCanEatFood,
  leadCapsOf,
  leadMarkWeights,
  type LeadCaps,
} from "@/render/leadVision";

export class WorldView {
  readonly container = new Container();
  /**
   * 내 종에 걸친 꾸밈(도전 과제 보상). **효과 없음** — 보이는 것만 바꾼다.
   * main 이 런 시작·로비에서 `equippedCosmetic()` 으로 채운다.
   */
  playerCosmetic: CosmeticId | null = null;
  private readonly renderer: Renderer;
  private readonly envG = new Graphics();
  private readonly foodG = new Graphics();
  private readonly playerG = new Graphics(); // 내 종 강조(스프라이트 아래 빛나는 고리)
  private readonly leadG = new Graphics(); // 앞장선 개체(알파 조종) 지면 표식 — 스프라이트 아래
  // 알파 시점 레이어(조종 모드 전용). leadId 가 null 이면 전부 비고 숨어 기존 화면과 문자 그대로 같다.
  private readonly leadTerrain = new LeadTerrainLayer(); // 못 가는 지형(정적 — 통행 능력이 바뀔 때만 재생성)
  private readonly relG = new Graphics(); // 관계 고리(위험 톱니 링 / 먹잇감 브래킷) — 스프라이트 아래
  private readonly creatureLayer = new Container();
  // (전사 쐐기 레이어(fighterG)는 2026-08-11 에 걷어냈다 — **[사용자]** "주황색 콘 굳이 필요한가?" ·
  //  「맞설 개체 0」의 경고 한 줄이 그 정보의 유일한 생존자다 · drawRaidBar 주석 참조.)
  /**
   * **다친 개체의 기운 선** — 물린 뒤 얼마 동안만 몸 위에 뜬다(**[사용자 2026-08-10]** 확정).
   *
   * 왜 「다친 애만」인가: **[사용자]** "애들 각각의 체력을 다 보여주면 그건 너무 화면이 난잡할 것
   * 같은데, 그렇다고 지금처럼 개체별 체력을 아예 숨겨버리면 애들이 공격을 하는지를 모르니 피해
   * 관련 특성은 뭐 얼마나 도움이 되는지 가늠이 안 돼."
   * 무리 서른 마리 중 지금 싸우는 것은 보통 한둘이라, 그 한둘만 그리면 **평소 화면은 그대로 깨끗하고
   * 싸움이 붙은 자리만 눈에 들어온다.**
   *
   * ⚠ 이 표시가 뜻을 가지려면 **전투가 여러 번의 물기로 진행되어야 한다.** 같은 날 전투를
   *   「즉사 판정」에서 「피해 싸움」으로 옮긴 것(`params.ts`)과 한 몸이다 — 옛 값에서는 사냥이
   *   0.17초에 끝나 선이 뜨기도 전에 개체가 사라졌다.
   */
  private readonly woundG = new Graphics();
  private readonly moveTargetG = new Graphics(); // 이동 명령 목표 깃발(탭 명령 조종) — 도착까지 서 있다
  private readonly trialZoneG = new Graphics(); // 시험이 세계에 찍은 자리(「표시된 자리에 N마리」)
  private readonly trialMarkG = new Graphics(); // 표식이 찍힌 야생(「표시된 것 N마리 사냥」)
  private readonly bossG = new Graphics();
  // 방울(유전자 점수) · 지면 표식은 생물 아래, 본체는 생물 위, 문구는 밤 틴트 위로 나뉘어 붙는다.
  private readonly geneLayer = new GeneDropLayer();
  /**
   * **DOM 목표 줄이 지금 차지한 아래 끝**(이 뷰의 논리 화면 단위) · main 이 매 프레임 넣는다.
   * 화면 밖 방울을 가리키는 쐐기가 그 줄 뒤에 깔리지 않게 하는 유일한 근거다
   * (고정값은 문구가 길어지는 순간 틀린다 · main.ts 의 `hudSafe` 주석과 같은 사정).
   */
  hudSafeLogical = 0;
  private readonly overlayG = new Graphics();
  /**
   * **피난처가 있는 전역 안개**(독 안개) 전용 레이어 · 안개를 화면 전체가 아니라 **흡수가 실제로
   * 걸리는 자리에만** 칠한다. 수풀 위는 비워 두므로 "저기는 안전하다"가 눈으로 읽힌다
   * (전달 규칙 1순위: 그 자체로 보이는 것).
   *
   * 왜 별도 레이어인가: 지형은 런/단계마다 한 번만 바뀌므로 도형을 그때 한 번만 짓고(drawEnvironment),
   * 매 프레임에는 `alpha`(맥동)와 `tint`(보스 색)만 바꾼다. 매 프레임 수천 개 타일을 다시 그리면
   * 폰 프레임이 죽는다. 흰색으로 짓고 tint 로 색을 입히는 이유는 색의 단일 진실이 TRIAL_VISUALS 이기
   * 때문이다(여기에 색을 복제하면 둘이 갈린다).
   */
  private readonly fogG = new Graphics();
  // 격퇴 바 옆 남은 체력 숫자. 밤·대멸종 틴트(overlayG) **위**에 둔다 · 이 숫자는 어떤 조명에서도
  // 읽혀야 한다(바 1픽셀이 6HP 라 숫자가 유일하게 정직한 눈금이다).
  private readonly raidTextC = new Container();
  private raidText: Text | null = null;
  private leadId: number | null = null; // 사람이 앞장세운 개체(알파). null 이면 표식을 아예 안 그린다
  private moveTarget: { x: number; y: number } | null = null; // 이동 명령 목표(월드 좌표). null = 명령 없음
  private moveTargetAvoid = false; // true = 「피해라」의 자리(가라는 깃발이 아니라 붉은 반발 고리를 그린다)
  // ── 격퇴 바를 "사건"으로 그리기 위한 렌더 전용 상태 ─────────────────────────────────────────
  // 값은 오직 sim 의 boss.hp 에서 읽는다. "언제 깎였나"도 **바가 가리키는 그 값이 줄어든 것**으로만
  // 안다 · 판정을 렌더에서 새로 만들지 않았으므로 번쩍임·잔상이 숫자와 어긋날 수 없다.
  private raidBossRef: Boss | null = null; // 보스가 바뀌면(새 라운드) 아래 상태를 통째로 리셋
  private raidHpPrev = 0;
  private raidGhostHp = 0; // 잔상 기준(최근에 깎이기 전 체력) · 바 뒤에 옅게 남는다
  private raidHitAge = RAID_FLASH_MS; // 마지막으로 깎인 뒤 지난 ms (처음엔 "방금 아님")

  private readonly pool: Sprite[] = [];
  // 생물 텍스처 캐시 — 키가 "내 종 세대별 게놈 서명" 또는 "야생 종 id". 내 종은 레벨업으로 게놈이
  // 바뀌면 새 서명 = 새 텍스처라, 그 뒤 태어난 개체만 새 모습이 된다(기존 개체는 옛 서명 텍스처 유지).
  private readonly texCache = new Map<string, Texture>();
  private readonly angle = new Map<number, number>(); // 개체별 부드러운 회전각(스냅 떨림 제거)
  private readonly heading = new Map<number, { x: number; y: number }>(); // 진행방향 벡터 저역통과(좌우 회전 진동 제거)
  private readonly dispPos = new Map<number, { x: number; y: number }>(); // 렌더 전용 위치 평활(고주파 떨림 제거)
  private frame = 0;
  // 지금 보이는 월드 구간(setCamera 가 채운다). 초기값이 아주 크므로 카메라가 오기 전엔 아무것도 안 잘린다.
  private viewCX = 0;
  private viewCY = 0;
  private viewHalfW = 1e9;
  private viewHalfH = 1e9;
  private viewZoom = 1; // 월드px ↔ 화면px 환산(화면px = 월드px × zoom). 화면 고정 UI 를 피할 때 쓴다.

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.container.addChild(this.envG);
    // 못 가는 지형은 지형 바로 위·먹이 아래 — 먹이와 생물은 안 어둡게 하고 "땅"만 죽인다.
    this.container.addChild(this.leadTerrain.g);
    this.container.addChild(this.foodG);
    // 방울의 지면 표식(그림자·바닥 광원·조여드는 파문)은 먹이 위·생물 아래 · 땅에 눕는 빛이라
    // 몸을 안 덮으면서 "저 자리에 뭔가 있다"를 무리 발밑에서도 알린다.
    this.container.addChild(this.geneLayer.groundG);
    this.container.addChild(this.playerG);
    // 알파 표식은 스프라이트 **아래**(지면에 눕는 표식) — 몸을 가리면 무슨 종인지가 안 읽힌다.
    this.container.addChild(this.leadG);
    // 관계 고리도 스프라이트 아래 — 몸 바깥 반경에만 그리므로 안 가려지고, 몸(=무슨 종인지)을 안 덮는다.
    this.container.addChild(this.relG);
    this.container.addChild(this.creatureLayer);
    // 다친 기운 선은 스프라이트 **위** · 몸 **바깥 위쪽**에 눕는다. 지금 벌어지는 일을 말하는
    // 표시라 다른 개체에 파묻히면 안 되고, 몸 위가 아니라 머리 위라 무슨 종인지도 안 가린다.
    this.container.addChild(this.woundG);
    // 이동 목표 깃발은 스프라이트 **위** — 무리가 목표 지점을 밟고 지나가도 깃발이 파묻히지 않아야
    // "어디로 가는 중인가"를 잃지 않는다(작은 표식이라 몸을 가려도 한 마리 일부다).
    this.container.addChild(this.trialZoneG);
    this.container.addChild(this.moveTargetG);
    this.container.addChild(this.trialMarkG);
    // 방울 본체는 스프라이트 **위** · 무리가 밟고 지나가는 물건이라 몸에 파묻히면 "주우러 갈 것"이
    // 화면에서 사라진다(이동 목표 깃발과 같은 이유). 보스보다는 아래 · 덮치는 것이 늘 우선이다.
    this.container.addChild(this.geneLayer.mainG);
    this.container.addChild(this.bossG);
    this.container.addChild(this.overlayG);
    this.container.addChild(this.fogG); // 밤 틴트 위 · 안개는 밤보다 앞이다(밤이 안개를 지우면 안 된다)
    this.container.addChild(this.raidTextC); // 밤 틴트 위 · 남은 체력 숫자만은 늘 또렷하게
    this.container.addChild(this.geneLayer.textC); // 같은 이유로 밤 틴트 위(「보스 격퇴 +3」·「+3」)
  }

  /**
   * 사람이 앞장세운 개체(알파 조종). null 이면 표식·시야 예외가 통째로 꺼져 관전 화면과 같다.
   * main 이 매 프레임 `world.lead.leaderId`(승계로 바뀐다)를 그대로 넘긴다 — 여기서 상태를 안 들고 있으면
   * 앞장서던 개체가 쓰러진 뒤에도 옛 자리에 표식이 남는다.
   */
  setLead(id: number | null): void {
    this.leadId = id;
  }

  /**
   * 이동 명령의 목표 지점(월드 좌표). 탭 명령 조종에서 main 이 명령을 내릴 때 세우고, 도착·대체·취소 시
   * null 로 지운다 — 렌더는 상태를 판단하지 않고 "지금 유효한 명령"을 그대로 그릴 뿐이다(단일 진실 = main
   * 의 명령 상태). 깃발은 카메라와 함께 움직이고, 서 있는 동안 부드럽게 맥동한다.
   */
  setMoveTarget(p: { x: number; y: number } | null, avoid = false): void {
    this.moveTarget = p;
    this.moveTargetAvoid = avoid;
  }

  /** 개체의 렌더 표시 위치(저역통과된 부드러운 좌표). 카메라가 이 위치를 따라가면 떨림 없이 추적된다. */
  getDisplayPos(id: number): { x: number; y: number } | null {
    return this.dispPos.get(id) ?? null;
  }

  /**
   * 지금 조종 중인 알파 개체와 그 능력(통행·섭식). 조종 모드가 아니거나(leadId=null) 알파가 방금
   * 쓰러져 승계 중이면 null 이고, 그러면 알파 시점 레이어가 통째로 꺼진다.
   * 프레임당 한 번만 도는 선형 탐색이라(개체 상한 120) 비용이 사실상 없다.
   */
  private findLead(world: World): { e: Entity; caps: LeadCaps } | null {
    if (this.leadId === null) return null;
    for (const e of world.entities) {
      if (e.id === this.leadId) return { e, caps: leadCapsOf(e.genome) };
    }
    return null;
  }

  /** 이 월드 좌표가 지금 화면 안(여유 margin 포함)인가. 알파 시점 레이어의 화면 밖 컬링에만 쓴다. */
  private inView(x: number, y: number, margin: number): boolean {
    return (
      Math.abs(x - this.viewCX) <= this.viewHalfW + margin &&
      Math.abs(y - this.viewCY) <= this.viewHalfH + margin
    );
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
    // 보이는 월드 구간을 기억해 둔다 — 알파 시점 레이어가 "화면 밖"을 아예 안 그리는 데 쓴다.
    // (sync 가 setCamera 보다 먼저 도는 프레임이 있어 한 프레임 낡을 수 있다 → 아래에서 여유를 둔다.)
    this.viewCX = cx;
    this.viewCY = cy;
    this.viewHalfW = halfW;
    this.viewHalfH = halfH;
    this.viewZoom = zoom > 0 ? zoom : 1;
    this.container.scale.set(zoom);
    this.container.pivot.set(cx, cy);
    this.container.position.set(screenW / 2, screenH / 2);
  }

  /**
   * **화면에 실제로 반영된** 카메라 중심(월드 밖으로 안 나가게 잘린 값)과 배율.
   * 떨림 계측(`?camprobe` · scripts/camera-probe.mjs)이 읽는 유일한 창구다 — 눈이 보는 것은
   * 클램프 **뒤**의 값이라, main 의 camX/camY 를 재면 맵 가장자리에서 없는 떨림을 재게 된다.
   */
  cameraCenter(): { x: number; y: number; zoom: number } {
    return { x: this.viewCX, y: this.viewCY, zoom: this.viewZoom };
  }

  /** 런이 바뀌면 호출 — 텍스처 캐시를 비운다. 텍스처는 sync 에서 개체 게놈별로 lazy 생성한다(세대별). */
  refreshSpecies(_world: World): void {
    for (const tex of this.texCache.values()) tex.destroy(true);
    this.texCache.clear();
    this.angle.clear();
    this.heading.clear();
    this.dispPos.clear();
    // 이전 런의 이동 명령 깃발이 새 월드에 남는 걸 막는 안전망(명령 상태 자체는 main 이 지운다).
    this.moveTarget = null;
    this.moveTargetAvoid = false;
    this.moveTargetG.clear();
    // 시험 표식도 같은 이유로 지운다 — 새 월드의 첫 프레임에 지난 라운드의 자리·표식이 남으면
    // 플레이어가 그리로 무리를 몰다 시간을 버린다.
    this.trialZoneG.clear();
    this.trialMarkG.clear();
    // 방울 연출도 런 단위로 비운다 · 지난 런에서 주운 「+3」이 새 세계 첫 프레임에 뜨면 안 된다.
    // (시대 전환은 geneLayer 가 방울 배열 참조가 바뀐 것으로 스스로 알아채 비운다.)
    this.geneLayer.reset();
    // 격퇴 바 상태도 런 단위로 리셋 · 안 그러면 지난 런의 잔상·번쩍임이 새 보스의 첫 프레임에 뜬다.
    this.raidBossRef = null;
    this.raidHpPrev = 0;
    this.raidGhostHp = 0;
    this.raidHitAge = RAID_FLASH_MS;
    if (this.raidText) this.raidText.visible = false;
  }

  /** 개체의 텍스처(캐시). 내 종은 세대별 게놈 서명으로, 야생은 종 id + 거친 게놈 서명으로 캐시한다.
   * 야생은 진화(공유 게놈 변화)하므로 서명을 붙여야 겉모습이 따라 바뀐다 — 안 붙이면 게놈이 변해도
   * 첫 모습 그대로라 진화가 화면에 안 보인다. 거친 버킷이라 미세 드리프트엔 안 바뀌고, 압력 적응처럼
   * 형질이 크게 움직일 때만 새 텍스처(캐시 폭증 방지 + 눈에 띄는 변화만 반영). */
  /**
   * 도전 과제 꾸밈을 내 종 개체 한 마리에 그린다. 스프라이트 **아래** 레이어(playerG)라 몸을 안 가린다.
   * 개체 id 로 위상을 어긋내 무리 전체가 한 박자로 깜빡이지 않게 한다(스트로브 방지).
   */
  private drawCosmetic(rx: number, ry: number, id: number): void {
    const c = this.playerCosmetic;
    if (c === null) return;
    const ph = ((this.frame + id * 7) % 96) / 96; // 0→1 반복, 개체별 위상
    if (c === "rainbow") {
      // 몸 tint(곱셈)만으론 초록 몸이 탁해질 뿐 색이 안 읽힌다 — 흐르는 색 오라를 함께 깐다.
      const col = rainbowTint(this.frame, id, 0.1); // 오라는 진한 색으로
      this.playerG.circle(rx, ry, 16).fill({ color: col, alpha: 0.18 });
      this.playerG.circle(rx, ry, 12.5).stroke({ color: col, width: 2.4, alpha: 0.8 });
    } else if (c === "glow") {
      // 후광 — 밝기가 천천히 숨쉰다. 초록 지형 위에서도 읽히도록 넉넉히 밝게(폰 검토 기준).
      const b = 0.5 + 0.5 * Math.sin(ph * Math.PI * 2);
      this.playerG.circle(rx, ry, 19 + 4 * b).fill({ color: 0xfff2b0, alpha: 0.1 + 0.12 * b });
      this.playerG.circle(rx, ry, 13).fill({ color: 0xffe08a, alpha: 0.18 + 0.22 * b });
      this.playerG.circle(rx, ry, 12.5).stroke({ color: 0xfff6d0, width: 1.6, alpha: 0.5 + 0.4 * b });
    } else if (c === "halo") {
      // 머리 위에 뜬 얇은 금빛 고리(살짝 위아래로 흔들린다).
      const hy = ry - 15 + Math.sin(ph * Math.PI * 2) * 1.2;
      this.playerG.ellipse(rx, hy, 7.5, 2.6).stroke({ color: 0xffe08a, width: 1.3, alpha: 0.85 });
      this.playerG.ellipse(rx, hy, 7.5, 2.6).stroke({ color: 0xfff6d0, width: 0.5, alpha: 0.5 });
    } else if (c === "stardust") {
      // 지나간 자리에 남는 반짝이 — 다섯 알이 퍼지며 사그라든다.
      // playerG 는 스프라이트 **아래** 레이어라, 몸(반지름 ~15) 안쪽에 그리면 통째로 가려진다.
      // 그래서 몸 바깥(15px~)에서 시작해 퍼져 나가게 한다. 초록 지형에 안 묻히게 흰빛.
      for (let k = 0; k < 5; k++) {
        const t = (ph + k / 5) % 1;
        const r = 2.8 * (1 - t) + 0.7;
        const d = 15 + t * 14; // 몸 바깥에서 시작
        const ang = (id % 360) * 0.0175 + t * 1.2 + k * 1.25;
        const sx = rx - Math.cos(ang) * d;
        const sy = ry - Math.sin(ang) * d;
        const a = 1 - t * 0.85;
        this.playerG.circle(sx, sy, r + 1.6).fill({ color: 0xffe08a, alpha: 0.35 * a });
        this.playerG.circle(sx, sy, r).fill({ color: 0xfffbe8, alpha: 0.95 * a });
      }
    }
  }

  private textureFor(e: Entity): Texture {
    // 개체별 룩 버킷을 키에 더한다 — 같은 종·세대라도 무늬·눈이 다른 텍스처를 버킷 수만큼 갖는다.
    // 버킷이 유한(LOOK_BUCKETS)이라 캐시는 (게놈 서명 × 버킷)으로 상한이 있다.
    const lb = lookBucket(e.id);
    const key = e.species.isPlayer
      ? "p" + e.species.id + ":" + genomeSignature(e.genome) + ":" + lb
      : "s" + e.species.id + ":" + wildGenomeSignature(e.genome) + ":" + lb;
    let tex = this.texCache.get(key);
    if (!tex) {
      tex = makeCreatureTexture(this.renderer, e.genome, e.species.color, creatureLook(e.id));
      this.texCache.set(key, tex);
    }
    return tex;
  }

  /** 런이 바뀔 때 한 번 — 지형 풍경(바다/육지/산)을 그린다. 표고로 음영, 환경(추위/비옥도)으로 색조. */
  drawEnvironment(world: World): void {
    const terr = world.terrain;
    const env = world.environment;
    const cs = terr.cellSize;
    // 지형이 통째로 바뀌었다(새 런·새 단계) → 알파의 "못 가는 곳"도 다음 프레임에 다시 만든다.
    this.leadTerrain.reset();
    this.envG.clear();
    for (let cy = 0; cy < terr.rows; cy++) {
      for (let cx = 0; cx < terr.cols; cx++) {
        const i = cy * terr.cols + cx;
        const kind = terr.tiles[i] ?? TILE.land;
        const elev = terr.elevation[i] ?? 0.5;
        // 이 타일 중심의 환경(바이옴/추위/비옥도)을 샘플 — 바이옴별 육지 색·산 눈에 반영.
        const s = env.sampleAt((cx + 0.5) * cs, (cy + 0.5) * cs);
        this.envG
          .rect(cx * cs, cy * cs, cs, cs)
          .fill({ color: terrainColor(kind, elev, s.biome, s.coldness, s.fertility), alpha: 1 });
      }
    }
    this.buildFog(terr);
  }

  /**
   * 피난처 안개의 도형을 **지형이 바뀔 때 한 번만** 짓는다 · 수풀이 아닌 칸만 덮는다.
   * sim 의 흡수 예외(`boss.drainShelter` + `terrain.isGrass`)와 **같은 판정**이라 화면에서 비어 있는
   * 자리가 곧 안 빨리는 자리다(시각=로직 1:1). 흰색으로 지어 두고 색은 매 프레임 tint 로 입힌다.
   * 한 줄씩 가로로 이어 붙여(run-length) 사각형 수를 수천에서 수백으로 줄인다.
   */
  private buildFog(terr: Terrain): void {
    this.fogG.clear();
    const cs = terr.cellSize;
    for (let cy = 0; cy < terr.rows; cy++) {
      let runStart = -1;
      for (let cx = 0; cx <= terr.cols; cx++) {
        const foggy = cx < terr.cols && terr.tiles[cy * terr.cols + cx] !== TILE.grass;
        if (foggy && runStart < 0) runStart = cx;
        else if (!foggy && runStart >= 0) {
          this.fogG.rect(runStart * cs, cy * cs, (cx - runStart) * cs, cs).fill({ color: 0xffffff, alpha: 1 });
          runStart = -1;
        }
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
    // ── 알파 시점(조종 모드 전용) 준비 ─────────────────────────────────────────────
    // lead 가 null 이면 아래 분기가 전부 기존 경로로 떨어진다 = 관전 화면은 문자 그대로 예전 그대로다.
    const lead = this.findLead(world);
    this.leadTerrain.update(world, lead ? lead.caps : null);
    // 겨눔 반경 — sim 이 물기 대상 판정(leadBiteTarget)에 쓰는 **같은 함수**를 읽는다. 이 밖의 먹잇감
    // 브래킷은 흐려진다("브래킷은 뜨는데 사냥은 안 되는" 어긋남 방지). 식을 렌더에 복제하지 않는다.
    const aimR = lead ? leadTargetRange(lead.e, world) : 0;
    // 사냥 잠금 대상 — 단일 진실은 sim 필드(world.lead.orderTargetId, 매 틱 명령 미러). main 에서
    // 별도 setter 를 받지 않는다 — 화면의 잠금 표식과 실제로 물리는 대상이 정의상 어긋날 수 없게.
    const orderId = lead ? world.lead.orderTargetId : -1;
    // ── 격퇴(보스에게 맞서기) 준비 ────────────────────────────────────────────────
    // "지금 이 보스를 깎을 수 있는가"는 sim 의 bossRaidable 하나가 정한다. 못 깎는 보스(독 안개·격퇴
    // 없음)면 아래가 전부 꺼져 예전 화면과 같다.
    const boss = world.boss;
    const raidBoss: Boss | null = boss !== null && bossRaidable(boss) ? boss : null;
    this.trackRaidHp(raidBoss, dtMS);
    if (lead !== null) {
      this.relG.clear();
      this.relG.visible = true;
    } else if (this.relG.visible) {
      this.relG.clear();
      this.relG.visible = false;
    }

    this.foodG.clear();
    // 조종 중이면 **화면 밖 먹이는 아예 안 그린다.** 알파 시점 표시를 얹으면서도 도형 수를 오히려 줄이려는
    // 것이다(폰 프레임이 이 게임의 생명 — 먹이는 수백 개고 대부분 화면 밖이다). 관전은 예전 그대로 전부.
    const leadKinds = lead ? lead.e.species.foodKinds : null;
    for (const f of world.food) {
      if (!f.available) continue;
      if (lead && !this.inView(f.x, f.y, 24)) continue;
      // 육지 식물은 종류별 자연색, 얕은 바다는 청록, 깊은 바다는 진한 남청(물고기 전용), 고산은 흰빛.
      const color = f.mountainous
        ? MOUNTAIN_FOOD_COLOR
        : f.deep
          ? DEEP_FOOD_COLOR
          : f.aquatic
            ? SEA_FOOD_COLOR
            : (FOOD_COLORS[f.kind] ?? 0x9bee5a);
      if (!leadKinds || !lead) {
        this.foodG.circle(f.x, f.y, 4).fill({ color, alpha: 1 });
        continue;
      }
      // 못 먹는 먹이는 흐리게 죽인다 — "가서 먹으면 되는 것"만 또렷이 남아야 한눈에 골라 간다.
      // 먹을 수 있는 것엔 옅은 흰 고리를 둘러 배경(초록 풀밭)에 묻히지 않게 한다.
      if (leadCanEatFood(f, lead.caps, leadKinds)) {
        // 먹을 수 있는 먹이는 또렷한 점 하나면 충분하다. 흰 고리를 둘렀었는데(배경에 묻히지 말라고)
        // 확대 화면에선 고리밭이 돼 "밀도가 너무 높다"(2026-08-02 사용자)의 한 축이었다 — 뺐다.
        // 못 먹는 먹이가 흐려지는 대비만으로 "먹을 것"은 이미 갈린다.
        this.foodG.circle(f.x, f.y, 4.6).fill({ color, alpha: 1 });
      } else {
        // 아주 지워 버리진 않는다 — 세계가 텅 빈 것처럼 보이면 "저기 먹이가 있긴 한데 내가 못 먹는다"는
        // 정보(예: 이 바다는 통째로 남의 밥상)까지 같이 사라진다.
        this.foodG.circle(f.x, f.y, 3).fill({ color, alpha: 0.22 });
      }
    }

    // ── 사체 · 「썩은 고기를 먹는 위」(이빨 4단 카드)가 있는 판에서만 쌓인다(world.legacyDeath).
    //    없는 판은 배열이 늘 비어 있어 이 루프가 0회다. 갈비뼈 실루엣이면 「죽은 것이 남긴 것」이
    //    설명 없이 읽히고(전달 규칙 1순위), 부패의 마지막 4분의 1에서 스러져 「곧 없어진다」도 보인다.
    for (const c of world.carcasses) {
      if (!carcassEdible(c, world.tick)) continue;
      if (lead && !this.inView(c.x, c.y, 24)) continue;
      const rot = (world.tick - c.bornTick) / CARRION_ROT_TICKS;
      const a = rot > 0.75 ? (1 - rot) / 0.25 : 1;
      this.foodG.ellipse(c.x, c.y + 1, 7, 3).fill({ color: 0x1a140e, alpha: 0.35 * a });
      for (let i = -1; i <= 1; i += 1) {
        this.foodG
          .moveTo(c.x + i * 3, c.y - 3)
          .lineTo(c.x + i * 3.6, c.y + 3)
          .stroke({ color: 0xe8dcc4, width: 1.4, alpha: 0.9 * a });
      }
      this.foodG.circle(c.x - 5.5, c.y - 1, 2).fill({ color: 0xe8dcc4, alpha: 0.9 * a });
    }

    // 생물 스프라이트 풀 — sim(30/s)과 화면(60fps) 사이를 prev→현재로 보간해 드득거림을 없앤다.
    this.playerG.clear();
    const ringPulse = 0.5 + 0.5 * Math.sin((this.frame % 70) / 70 * Math.PI * 2);
    // 위험 표식용 맥동 — 다른 고리들(70프레임)보다 빨라 "급하다"로 읽힌다. 조종 모드에서만 쓴다.
    const threatPulse = 0.5 + 0.5 * Math.sin((this.frame % 44) / 44 * Math.PI * 2);
    // 이번 프레임에 **맞설 수 있는** 내 종 개체 수(아래 개체 루프에서 sim 판정으로 센다).
    // 이 수가 0 이면 격퇴 바를 아예 안 그린다 · 못 깎는 판에 가득 찬 바를 띄우는 건 화면의 거짓말이다.
    let raidFighters = 0;
    let relMarks = 0;
    const nbWindow = 2.4 * SIM.stepsPerSecond; // 신생아 강조 지속(스텝)
    const nbPeriod = 0.8 * SIM.stepsPerSecond; // nb-pulse 반복 주기(스텝)
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

      // 나는 개체(날개≥문턱)는 **공중에 떠 있다** — 아래로 어긋난 그림자로 그걸 보인다. 이게 없으면
      // 땅 보스가 코앞에서 지나가는데 왜 안 잡히는지 화면에서 알 수 없다(시각=로직 1:1, known_issues).
      // 날갯짓에 맞춰 미세하게 오르내려 "떠 있음"이 살아 있다. playerG 는 스프라이트 아래 레이어다.
      if (e.genome.traits.wings >= SIM.flyThreshold) {
        // 부드러운 드롭 섀도 — 바깥에서 안으로 진해지는 동심 타원 셋(가짜 블러). 예전엔 밝은 테두리를
        // 두른 딱딱한 타원이었는데, 그림자가 아니라 화면 오류처럼 보였다(사용자). 그림자는 테두리가
        // 없고 가장자리가 흐려야 그림자로 읽힌다. 몸 바로 아래·조금 오른쪽에 작게 깔아 "떠 있음"만 준다.
        // playerG 는 스프라이트 **아래** 레이어라, 몸(반지름 ~15) 안쪽에 그리면 통째로 가려진다
        // (known_issues). 몸 바깥 오른쪽 아래로 충분히 밀어야 "높이 떠 있어 그림자가 저만치 진다"가 된다.
        const bob = Math.sin((this.frame + e.id * 11) * 0.07) * 1.0;
        const sx = rx + 15;
        const sy = ry + 18 + bob;
        this.playerG.ellipse(sx, sy, 11, 4.6).fill({ color: 0x000000, alpha: 0.1 });
        this.playerG.ellipse(sx, sy, 8.5, 3.6).fill({ color: 0x000000, alpha: 0.16 });
        this.playerG.ellipse(sx, sy, 6, 2.6).fill({ color: 0x000000, alpha: 0.24 });
      }

      // 내 종 강조: 스프라이트 아래 은은한 고리(폰에서 "내 무리"가 한눈에).
      if (e.species.isPlayer) {
        // 시야(이 종이 먹이를 어느 방향·얼마나 멀리 보는지) — 보는 방향(진행방향) 기준 부채꼴로.
        // 정지(헤딩이 거의 0)면 두리번거리므로 원으로.
        // 조종 중(알파 있음)에는 **알파 한 마리에만** 그린다 — 무리 열넷의 부채꼴·초음파가 겹치면
        // 확대 화면이 도형 밭이 된다(2026-08-02 사용자: 밀도가 너무 높다). 조종 판단의 근거는 알파의
        // 감지 범위 하나면 충분하다. 관전(?watch)은 형질 관찰이 목적이라 예전대로 여럿(상한 14)에.
        if (lead ? e.id === this.leadId : visionRings < 14) {
          // behavior 의 시야 계산과 똑같이 개체별로 — 밤·수풀에서 줄어드는 실제 시야를 그대로 그린다
          // (시각=로직 1:1). 수풀에 든 개체는 부채꼴이 눈에 띄게 줄어 "시야가 가려짐"이 보인다.
          const v01 = e.genome.traits.vision / TRAIT_MAX;
          const eVision =
            SIM.visionBase *
            v01 *
            nightVisionFactor(world.daylight, v01) *
            grassVisionFactor(world, e.x, e.y, v01);
          const hd = this.heading.get(e.id);
          // **정점 시야(100)는 부채꼴 규칙에서 벗어난다** — 달리면서도 사방을 본다(`behavior.makeFovTest`).
          // sim 이 늘 전방위인데 화면만 부채꼴이면 "뒤에 있는 것을 어떻게 봤지?"가 되고, 애써 얻은
          // 정점 보상이 화면에서 영영 안 읽힌다(known_issues: sim 효과를 넣으면 그리는 곳도 함께 고친다).
          const apexEye = isApex(e.genome.traits.vision);
          if (eVision > 1) {
            if (apexEye) {
              // 사방 · 정점은 금빛으로 갈라 "이건 보통 눈이 아니다"를 한눈에 알린다.
              this.playerG.circle(rx, ry, eVision).stroke({ color: 0xffe27a, width: 1.4, alpha: 0.16 });
            } else if (hd && Math.hypot(hd.x, hd.y) > 0.02) {
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
          // 초음파 — 전방위 감지. 시야 부채꼴과 달리 사방·밝기 무관. "여기까지 사방을 듣는다"를 옅은 채움
          // 원(감지 범위)으로 보이고, 안에서 밖으로 퍼지는 핑 파동으로 "초음파를 쏘고 있다"를 표현한다.
          const echo01 = e.genome.traits.echo / TRAIT_MAX;
          if (echo01 > 0) {
            const er = SIM.echoBase * echo01;
            this.playerG.circle(rx, ry, er).fill({ color: 0xc07aff, alpha: 0.05 });
            this.playerG.circle(rx, ry, er).stroke({ color: 0xc07aff, width: 1, alpha: 0.18 });
            // 핑(파동) — 개체마다 위상을 달리해(id) 사방에서 동시에 쏘지 않게. 안→밖으로 퍼지며 옅어진다.
            const ping = ((this.frame + (e.id % 60)) % 60) / 60;
            this.playerG
              .circle(rx, ry, er * ping)
              .stroke({ color: 0xd6a0ff, width: 1.4, alpha: 0.32 * (1 - ping) });
          }
          visionRings++;
        }
        // 원거리 공격은 이제 매 프레임 조준선(레일건) 대신 발사 순간 날아가는 발사체(effects "spit")로
        // 표현한다 — 생물다운 뱉기/가시(사용자 피드백). 여기선 안 그린다.
        this.playerG.circle(rx, ry, 13).fill({ color: 0x6cff7a, alpha: 0.1 });
        this.playerG
          .circle(rx, ry, 12.5)
          .stroke({ color: 0xaaffb0, width: 1.6, alpha: 0.35 + 0.25 * ringPulse });
        // **무리 방어 표식** — 이 개체가 뭉친 무리 안이라 포식자가 표적으로 안 삼는가(herdShielded).
        // "포식자가 안 온다"는 그 자체로는 눈에 안 보이는 방어라(backlog ⑥), 방패가 선 개체에 파란 보호
        // 링을 얹어 "이 무리는 지금 지켜지고 있다"를 그 자리에서 보인다. 초록 강조 고리(내 종)와 다른
        // 색·바깥 반경이라 겹쳐도 구분된다. 무리에서 떨어지면(낙오) 링이 사라져 "혼자면 위험"도 읽힌다.
        // herding 문턱을 먼저 걸러 야생·비무리 종의 판정 비용(격자 순회)을 0 으로 둔다(herdShielded 내부).
        // **정점 속도(100) 표식** — 사냥하는 것들이 표적을 고르는 단계에서 이 개체를 아예 뺀다
        // (`behavior.outrunsHunters`). "안 쫓아온다"는 그 자체로는 눈에 안 보이는 보상이라, 무리 방어가
        // 파란 보호 링을 얻은 것과 같은 이유로 표식을 준다. 링을 하나 더 얹지 않고 **뒤로 흐르는 잔상
        // 두 줄**로 그리는 이유: 이미 초록 고리·파란 방패 링이 겹치는 자리라 세 번째 링은 도형 밭이 되고,
        // 잔상은 그 자체로 "너무 빨라 못 잡는다"를 말한다. 판정은 sim 함수를 그대로 읽는다(시각=로직 1:1).
        if (outrunsHunters(e)) {
          const hd = this.heading.get(e.id);
          const hm = hd ? Math.hypot(hd.x, hd.y) : 0;
          if (hd && hm > 0.02) {
            const ux = hd.x / hm;
            const uy = hd.y / hm;
            // 진행 방향의 좌우로 살짝 벌린 두 줄이 뒤로 흐른다(맥동으로 길이가 숨쉰다).
            const len = 15 + 5 * ringPulse;
            for (const s of [-1, 1]) {
              const ox = -uy * 5 * s;
              const oy = ux * 5 * s;
              this.playerG
                .moveTo(rx - ux * 8 + ox, ry - uy * 8 + oy)
                .lineTo(rx - ux * (8 + len) + ox, ry - uy * (8 + len) + oy)
                .stroke({ color: 0xffe27a, width: 1.8, alpha: 0.5 });
            }
          }
        }
        if (e.genome.traits.herding > SIM.herdShieldThreshold && herdShielded(e, world)) {
          // 초록 강조 고리(반경 12.5)보다 바깥에 둬 두 링이 분리돼 보이게 한다. 파란빛 채움 + 밝은
          // 스트로크로 "보호막" 느낌. 숨쉬듯 맥동해 살아 있는 방어로 읽힌다.
          const sh = 0.5 + 0.5 * Math.sin((this.frame % 84) / 84 * Math.PI * 2);
          this.playerG.circle(rx, ry, 18).fill({ color: 0x8fbcff, alpha: 0.06 + 0.06 * sh });
          this.playerG
            .circle(rx, ry, 17.5)
            .stroke({ color: 0xcfe6ff, width: 2, alpha: 0.38 + 0.28 * sh });
        }
        // **맞설 수 있는 개체 수 집계** · 판정은 sim 의 isRaidFighter 그대로다(렌더가 조건을 다시
        // 쓰면 화면과 실제가 갈린다). 개체마다 붙이던 전사 쐐기는 걷어냈다(**[사용자 2026-08-11]**
        // "주황색 콘 굳이 필요한가?") — 이 수가 0 인 순간만 격퇴 바 자리가 한 줄로 말한다(drawRaidBar).
        if (raidBoss !== null && isRaidFighter(raidBoss, e, world)) {
          raidFighters++;
        }
        // 도전 과제 꾸밈 — 효과는 전혀 없다. 무지갯빛은 몸 색이라 아래 sp.tint 에서 처리한다.
        this.drawCosmetic(rx, ry, e.id);
        // 신생아 표식 — 갓 태어난 내 종 개체를 amber 링(nb-pulse: 밖으로 퍼지며 옅어짐)으로 잠깐 강조.
        // 초록 발광 고리와 달리 "퍼지는 핑"이라 움직임으로 구분되고, id 위상 오프셋으로 개체마다 어긋나
        // 펄스해(초기 무리가 같은 나이라도 동기 스트로브가 안 생김) 자연스럽다. age 기반이라 결정론.
        if (e.age < nbWindow) {
          const ph = ((e.age + (e.id % nbPeriod)) % nbPeriod) / nbPeriod; // 0→1 반복(개체별 위상)
          const a = 0.9 * Math.max(0, 1 - ph / 0.65) * (1 - e.age / nbWindow);
          if (a > 0.02) {
            this.playerG
              .circle(rx, ry, 6 + ph * 18)
              .stroke({ color: 0xf5c33b, width: 2.6 * (1 - ph) + 0.5, alpha: a });
          }
        }
      } else if (e.species.champion) {
        // 비동기 생물(S2) — 지난 런의 "예전의 나". 금빛 고리 + 머리 위 왕관으로 "정복자가 돌아왔다"를 표시.
        this.playerG.circle(rx, ry, 13).fill({ color: 0xffd24a, alpha: 0.1 });
        this.playerG
          .circle(rx, ry, 12.5)
          .stroke({ color: 0xffe08a, width: 1.6, alpha: 0.4 + 0.3 * ringPulse });
        // 작은 왕관 — 세 개의 뾰족한 삼각(황금). 개체 위에 떠 있다.
        const cyu = ry - 15;
        this.playerG
          .poly([rx - 5, cyu + 3, rx - 5, cyu - 2, rx - 2.5, cyu + 0.5, rx, cyu - 3, rx + 2.5, cyu + 0.5, rx + 5, cyu - 2, rx + 5, cyu + 3])
          .fill({ color: 0xffd24a })
          .stroke({ color: 0x8a5a0a, width: 1 });
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

      // ── 알파 시점 관계 고리 ─────────────────────────────────────────────────────
      // "쟤가 날 잡아먹나 / 내가 쟤를 잡아먹나"를 그 개체 위에 직접 칠한다. 무해한 개체는 **아무것도
      // 안 그린다** — 전부 칠하면 화면이 고리로 뒤덮여 정작 위험이 안 읽힌다(밀도가 이 작업의 핵심).
      // 화면 밖도 안 그리고, 개체 수 상한(안전장치)도 둔다. 내 종은 이미 초록 고리가 있어 제외한다.
      if (lead && !e.species.isPlayer && this.inView(rx, ry, 56)) {
        // 잠금 대상은 개수 상한의 예외 — 명령이 걸린 표적 하나가 상한에 밀려 안 그려지면 "명령이 사라졌다"
        // 로 오독한다(어차피 한 마리라 비용도 없다).
        const locked = e.id === orderId;
        if (locked || relMarks < LEAD_MARK_CAP) {
          // 그릴지 말지는 sim 의 leadRelation 하나가 정한다(leadMarkWeights 안에서 부른다) —
          // 화면에 먹잇감으로 표시된 개체 = 실제로 물리는 개체가 정의상 어긋날 수 없다.
          // 잠금 대상만은 rel 과 무관하게 그린다: 노릴 수 있지만 한 입엔 안 죽는 상대(tough)는 rel.prey
          // 가 아니어도 사냥 명령이 걸릴 수 있고(sim 의 leadBiteTarget 이 prey|tough 를 받는다),
          // 그때 표식이 없으면 명령이 화면에서 실종된다.
          const rel = leadMarkWeights(lead.e, e);
          if (locked || rel.threat || rel.prey) {
            // 가까운 위협일수록 진하게(0.5~1.0). 먼 것은 "저기 있다" 정도만. 기준을 화면 크기가 아니라
            // **월드 거리**로 잡는다 — 폰과 데스크톱에서 같은 거리가 같은 세기여야 감이 같아진다.
            const dist = Math.hypot(rx - lead.e.x, ry - lead.e.y);
            const prox = 0.5 + 0.5 * clamp01((REL_FAR - dist) / (REL_FAR - REL_NEAR));
            const mr = bodyRadiusOf(e) + 5;
            if (rel.threat) drawThreatMark(this.relG, rx, ry, mr, rel.threatPower, prox, threatPulse);
            if (locked) {
              // 잠금 브래킷 — 진한 호박빛·큰 반경·맥동(threatPulse: 빠른 맥동 = 진행 중인 사냥의 긴박함).
              drawLockedPreyMark(this.relG, rx, ry, mr, rel.preyPower, threatPulse);
            } else if (rel.prey) {
              // 겨눔 범위 판정은 sim 좌표로(leadBiteTarget 의 거리식과 같은 값) — 렌더 평활 좌표(rx,ry)로
              // 재면 경계 바로 앞뒤에서 화면과 실제 겨눔이 어긋난다.
              const inAim = (e.x - lead.e.x) ** 2 + (e.y - lead.e.y) ** 2 <= aimR * aimR;
              drawPreyMark(this.relG, rx, ry, mr, rel.preyPower, inAim ? prox : prox * PREY_OUT_OF_AIM_DIM);
            }
            relMarks++;
          }
        }
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
      // 개체별 미세 개성(크기·길쭉함·명암·색조) — 같은 종이라도 한 마리씩 달라 보이게. id 결정론, sim 무관.
      // 무늬·눈은 텍스처(룩 버킷)에서, 크기·톤은 여기 스프라이트에서 — 두 층이 겹쳐 개체가 또렷이 갈린다.
      const ps = personalityScale(e.id);
      const st = personalityStretch(e.id); // >1 길고 홀쭉(몸 방향=x 늘림), <1 짧고 통통
      // (v7: 몸집은 텍스처(makeCreatureTexture 의 sizeScale)가 이미 반영한다 — 개체별 게놈 값이라
      //  같은 종 안에서도 큰 놈·작은 놈이 갈린다. 종 단위 bodyScale 배율은 제거됐다.)
      sp.scale.set(ps * st, ps / st);
      // 독(중독) 걸린 개체는 보라빛으로 — "독이 퍼지는 중"이 한눈에(지속 피해의 시각 피드백).
      // 중독이 무지갯빛보다 우선한다(꾸밈이 위험 신호를 가리면 안 된다).
      sp.tint =
        e.poison > 0
          ? 0xcc66ff
          : e.species.isPlayer && this.playerCosmetic === "rainbow"
            ? rainbowTint(this.frame, e.id)
            : personalityTint(e.id);
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
      // 은신(v7) · 숨는 종은 흐릿하게 보인다. 포식자가 "못 보는" 규칙이 화면에서도 읽혀야 한다.
      // 큰 몸은 못 숨으므로(effectiveCamo) 커진 종은 흐려지지도 않는다.
      const hide = effectiveCamo(e.genome.traits.camouflage, e.genome.traits.size);
      // ⚠ 불투명도는 **가독성과 직접 맞바꾸는 채널**이다. 예전엔 기력을 여기에 실어(0.5~1.0) 배고픈
      // 개체가 늘 반투명했고, 짙은 지형 위에서 생물이 안 보였다(2026-08-03 사용자: "배경은 진한데
      // 캐릭터들은 반투명해서 가시성이 떨어진다"). 기력은 미세한 차이로만 남기고(0.88~1.0) 바닥을
      // 올린다. 은신도 내 무리는 덜 흐려지게 한다 · 내 애들은 어떤 경우에도 보여야 한다.
      const hideFade = (e.species.isPlayer ? 0.16 : 0.3) * hide;
      sp.alpha = (0.88 + 0.12 * energy) * (1 - hideFade);
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

    // 앞장선 개체(알파) 표식 — 개체 루프가 끝난 뒤에 그린다. 위치(dispPos)·진행방향(heading)이
    // 이번 프레임 값으로 다 채워진 다음이라야 몸·부채꼴과 같은 자리를 가리킨다.
    this.drawLead();

    // 이동 명령 목표 깃발 — 명령이 사는 동안(도착 전) 계속 서 있다.
    this.drawMoveTarget();
    this.drawWounded(world);
    this.drawTrialZone(world);
    this.drawTrialMarks(world);

    // 방울(유전자 점수) · 카메라 상태를 그대로 넘긴다(화면 밖 방울을 가리키는 쐐기가 이 값을 쓴다).
    // setCamera 가 이 프레임보다 늦게 도는 경우가 있어 한 프레임 낡을 수 있는데, 쐐기는 가장자리
    // 여백 안쪽에 붙으므로 그 정도 어긋남은 눈에 안 띈다(격퇴 바가 같은 값을 같은 방식으로 쓴다).
    this.geneLayer.sync(world, dtMS, {
      cx: this.viewCX,
      cy: this.viewCY,
      halfW: this.viewHalfW,
      halfH: this.viewHalfH,
      zoom: this.viewZoom,
      topSafe: this.hudSafeLogical,
    });

    // 보스 시각은 로직과 1:1 (known_issues). 실제로 쫓아와 무는 개체만 점 + 물기 반경 + 주목 펄스로
    // 그린다(도망 대상): 단일 추격자(chaser) 또는 사나운 무리(members 여러 마리가 사방에서 몰려온다).
    // 전역 솎기/흡수 시련(위치 무관)은 개체가 없으므로 여기서 안 그리고 아래 전체 화면 틴트로만 표현한다.
    this.bossG.clear();
    // (boss 는 위 "격퇴 준비" 에서 이미 꺼내 뒀다 · 전사 수를 개체 루프에서 세야 해서 앞으로 옮겼다.)
    // 주목 펄스(가독성 §7) — 부드러운 sin(0→1→0). 톱니(frame%60/60)는 매 2초 1→0 으로 뚝 끊겨 링·오라가
    // 번쩍여 "화면 깜빡임"으로 보였다(특히 그림자 매복자=여러 멤버+밝은 눈). sin 으로 매끄럽게 맥동시킨다.
    const pulse = 0.5 + 0.5 * Math.sin((this.frame % 72) / 72 * Math.PI * 2);
    if (boss && boss.members.length > 0) {
      // 개체형 떼 시련 — 떼가 무리 대형으로 몰려온다. 종류마다 색을 달리하고(구분), 떼 전체를 감싸는
      // 위협 오라 + 개별 점으로 "한 무리가 덮쳐온다"를 보인다(개별 점만 있으면 "무리"로 안 읽힌다).
      const hc = HORDE_COLORS[boss.type] ?? HORDE_DEFAULT;
      const pts = boss.members.map((m) => ({
        x: m.prevX + (m.x - m.prevX) * interp,
        y: m.prevY + (m.y - m.prevY) * interp,
        hx: m.x - m.prevX, // 진행 방향(실루엣이 이쪽을 향한다)
        hy: m.y - m.prevY,
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
      // 각 떼 개체를 종류별 위압적 생물로(사나운 무리·약탈자·외톨이·매복자·말벌 떼).
      for (const p of pts) {
        this.drawLayerCue(boss.roam, p.x, p.y, 10);
        this.drawBossCreature(p.x, p.y, p.hx, p.hy, 10, boss.type, hc.dot, boss.killRadius, pulse);
      }
      // 격퇴 체력 바 · 떼의 무게중심 위에 붙인다(2026-08-02 HUD 갈아엎기에서 상시 상단 바를 걷어냈다).
      // 떼가 화면 밖이면 가장자리 안쪽으로 밀어 붙인다(drawRaidBar 안) · 카메라는 내 무리를 따라가므로
      // 둘이 갈리면 바가 아무 데도 없어서 "안 움직인다"가 아니라 **본 적이 없다**가 된다.
      this.drawRaidBar(raidBoss, raidFighters, cx, cy - maxR - 30, cx, cy);
    } else if (boss && boss.killRadius > 0) {
      const bx = boss.prevX + (boss.x - boss.prevX) * interp;
      const by = boss.prevY + (boss.y - boss.prevY) * interp;
      const hc = HORDE_COLORS[boss.type] ?? HORDE_DEFAULT;
      // 단일 추격자(치타·큰수리·상어) — 크게 그려 "한 마리 맹수가 돌진한다"를 강조.
      this.drawLayerCue(boss.roam, bx, by, 20);
      this.drawBossCreature(bx, by, boss.x - boss.prevX, boss.y - boss.prevY, 20, boss.type, hc.dot, boss.killRadius, pulse);
      // 격퇴 체력 바 — 몸 위에(위 떼 분기와 같은 이유).
      this.drawRaidBar(raidBoss, raidFighters, bx, by - 36, bx, by);
    } else {
      // 격퇴 대상이 없는 프레임(보스 없음·독 안개) · 남은 숫자를 지운다.
      this.hideRaidText();
    }

    // 낮/밤 + 대멸종 화면 틴트 (둘 다 overlayG — 밤을 먼저 깔고 대멸종 틴트를 그 위에)
    this.overlayG.clear();
    // 밤일수록 짙은 남색으로 어둑하게. daylight 1=낮(영향 없음), 0=자정(가장 어둑). 생물은 보이게.
    const night = (1 - world.daylight) * NIGHT_MAX_ALPHA;
    if (night > 0.01)
      this.overlayG.rect(0, 0, world.width, world.height).fill({ color: NIGHT_COLOR, alpha: night });
    let tint = 0;
    let tintAlpha = 0;
    let fogAlpha = 0; // 피난처 안개(수풀만 비운다) · 화면 전체 틴트(tintAlpha)와 배타적으로 쓴다
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
        const a = v.baseAlpha + v.pulseAmp * Math.sin(this.frame * v.pulseSpeed);
        if (boss.drainShelter) {
          // **피난처가 있는 안개** · 화면을 통째로 덮지 않는다. 수풀 위는 비워, 어디로 몰아야 하는지가
          // 문구가 아니라 그림으로 보인다. 색의 단일 진실은 TRIAL_VISUALS 하나(여기선 tint 로만 입힌다).
          this.fogG.tint = v.color;
          fogAlpha = a;
        } else {
          tint = v.color;
          tintAlpha = a;
        }
      }
    }
    if (tintAlpha > 0)
      this.overlayG.rect(0, 0, world.width, world.height).fill({ color: tint, alpha: tintAlpha });
    // 매 프레임 여기 한 자리에서만 켜고 끈다 · 보스가 사라진 프레임에 옛 안개가 남지 않게.
    this.fogG.visible = fogAlpha > 0;
    this.fogG.alpha = fogAlpha;
  }

  /**
   * 앞장선 개체(알파) 표식 — "지금 내 손이 미는 것은 이 한 마리"를 몸을 안 가리고 알린다.
   *
   * 머리 위는 이미 임자가 있다(단골 별 y-20 · 정복자 왕관 y-15) → 지면에 눕는 표식으로 그린다.
   * **끊어진** 링인 이유: 이어진 링은 반경만 다를 뿐 내 종 고리(12.5)·무리 방패 링(17.5)과 같은 모양이라
   * 폰 화면에서 한 덩어리로 뭉친다. 토막 링 + 진행 방향 쐐기는 형태부터 달라 겹쳐도 갈린다.
   * 색은 청백 — 금빛(선택·단골)·초록(내 종)·보라(독)와 안 겹치고, 연파랑 방패보다 밝고 희다.
   *
   * 방향은 스프라이트 회전과 **같은** 평활 헤딩(this.heading)을 쓴다. 몸이 향한 쪽과 쐐기가 어긋나면
   * "내가 미는 방향"이 화면에서 거짓말이 된다(시각=로직 1:1). 시야 부채꼴도 같은 값을 쓴다.
   */
  private drawLead(): void {
    this.leadG.clear();
    if (this.leadId === null) return;
    const dp = this.dispPos.get(this.leadId);
    if (!dp) return; // 방금 쓰러진 알파 — 승계가 끝나면 다음 프레임에 이어받은 개체 자리에 그려진다
    const pulse = 0.5 + 0.5 * Math.sin(((this.frame % 60) / 60) * Math.PI * 2);
    // 바닥 발광 — 열댓 마리가 겹친 무리 한복판에서도 "어느 놈이 나인가"를 찾게. 지형색을 안 죽일 만큼 옅게.
    this.leadG
      .circle(dp.x, dp.y, LEAD_RING_R)
      .fill({ color: LEAD_COLOR, alpha: 0.06 + 0.03 * pulse });
    // 끊어진 링 — 네 토막이 천천히 돈다(살아 있는 표적 마커).
    // ⚠ 토막은 `arc()` 가 아니라 점을 직접 찍어 잇는다. Pixi 의 `stroke()` 는 직전 끝점을 현재 위치로
    //   남기므로(GraphicsContext._initNextPathLocation) 바로 `arc()` 를 부르면 토막 사이가 직선으로
    //   메워지고, 그걸 피하려 호 시작점으로 `moveTo` 하면 이번엔 같은 점이 연속 두 번 들어가 선 굵기
    //   법선이 0 으로 나눠진다(buildLine → NaN 정점 = 그 도형이 통째로 안 그려진다).
    //   기존 시야 부채꼴(위쪽)이 안전한 건 moveTo 대상이 호 시작점이 아니라 **중심**이기 때문이다.
    const spin = ((this.frame % 300) / 300) * Math.PI * 2;
    const seg = (Math.PI * 2) / 4;
    const gap = 0.5; // 토막 사이 빈 각(rad). 이보다 좁으면 그냥 이어진 링으로 보인다
    const steps = 7; // 토막 하나를 직선 7개로 — 반경 15px 에서 각진 게 안 보인다
    for (let s = 0; s < 4; s++) {
      const a0 = spin + s * seg + gap / 2;
      const span = seg - gap;
      const pts: number[] = [];
      for (let k = 0; k <= steps; k++) {
        const a = a0 + (span * k) / steps;
        pts.push(dp.x + Math.cos(a) * LEAD_RING_R, dp.y + Math.sin(a) * LEAD_RING_R);
      }
      // 어두운 밑선을 먼저 깔고 그 위에 청백. 흰 선만 그으면 밝은 지형(사막·눈·마른 풀) 위에서
      // 대비가 없어 표식이 사라진다 — 폰 화면에서 "내가 미는 놈"을 못 찾으면 조종 자체가 안 된다.
      // 같은 점 배열을 poly 로 두 번 넘긴다(stroke 는 경로를 소비하므로 다시 그려 줘야 한다).
      this.leadG.poly(pts, false).stroke({ color: LEAD_OUTLINE, width: 4.2, alpha: 0.3 });
      this.leadG
        .poly(pts, false)
        .stroke({ color: LEAD_COLOR, width: 2.2, alpha: 0.55 + 0.3 * pulse });
    }
    // 진행 방향 쐐기 — 링 바깥으로 뾰족하게. 조향 입력이 실제로 몸에 먹혔는지가 여기서 읽힌다
    // (미는 방향과 몸이 도는 방향이 다르면 그게 곧 "형질이 무거워 잘 안 돈다"는 정보다).
    const hd = this.heading.get(this.leadId);
    if (!hd) return;
    const hm = Math.hypot(hd.x, hd.y);
    if (hm <= 0.02) return; // 멈춰 있으면 방향이 노이즈다(시야 부채꼴과 같은 문턱) — 링만 남긴다
    const ux = hd.x / hm;
    const uy = hd.y / hm;
    const px = -uy; // 진행 방향의 수직 — 쐐기 밑변 폭
    const py = ux;
    const tip = LEAD_RING_R + 9.5;
    const base = LEAD_RING_R + 1.5;
    const half = 5.2;
    this.leadG
      .poly([
        dp.x + ux * tip,
        dp.y + uy * tip,
        dp.x + ux * base + px * half,
        dp.y + uy * base + py * half,
        dp.x + ux * base - px * half,
        dp.y + uy * base - py * half,
      ])
      .fill({ color: LEAD_COLOR, alpha: 0.55 + 0.3 * pulse })
      .stroke({ color: LEAD_OUTLINE, width: 1, alpha: 0.35 }); // 밝은 지형 위 대비(링과 같은 이유)
  }

  /**
   * 이동 명령 목표 깃발 — "지금 무리가 어디로 가는 중인가"가 도착까지 한 지점에 서 있다.
   * 라임 계열인 이유: 명령 접수 파문(effects 의 go 핑)과 같은 계열이라 "파문이 남긴 깃발"로 이어지고,
   * 위험 붉은빛·먹잇감 호박빛·알파 청백과 안 겹친다. 내 종 초록(0x6cff7a)보다 노랗게 틀어 무리 위에
   * 깃발이 서도 색이 섞이지 않는다. 월드 좌표 레이어라 카메라와 함께 움직인다.
   * 바닥 링이 부드럽게 맥동해 "아직 유효한 명령"임이 읽힌다(멎은 표식은 잔상으로 오독된다).
   */
  /**
   * **다친 개체의 기운 선** — 물린 뒤 `woundTicks` 가 도는 동안만 머리 위에 뜬다.
   *
   * **[사용자 2026-08-10]**: "애들 각각의 체력을 다 보여주면 그건 너무 화면이 난잡할 것 같은데,
   * 그렇다고 지금처럼 개체별 체력을 아예 숨겨버리면 애들이 공격을 하는지를 모르니 피해 관련 특성은
   * 뭐 얼마나 도움이 되는지 가늠이 안 돼." → **다친 애만** 그린다.
   *
   * 왜 `woundTicks` 인가: 그 값은 sim 이 **물린 순간에만** 세우는 것이라(`resolveBite`),
   * 「지금 싸움이 붙었다」와 정확히 같은 뜻이다. 기운이 낮다고 그리면 **굶주린 개체가 전부 켜져**
   * 평소 화면이 난잡해진다 — 그건 사용자가 싫다고 한 바로 그 그림이다.
   *
   * 색은 **내 무리와 남을 가른다**: 내 애가 다치면 붉게(위험 색), 남이 다치면 옅은 흰색으로
   * (「내가 물어 놓은 것」이 눈에 덜 급하게). 길이는 몸 크기를 따라가되 상한을 둔다.
   * ⚠ 이 선은 지형·다른 개체 위에 뜨지만 **머리 위**라 몸(=무슨 종인가)을 안 덮는다.
   */
  private drawWounded(world: World): void {
    this.woundG.clear();
    for (const e of world.entities) {
      if (!e.alive || e.woundTicks <= 0) continue;
      // 평활된 렌더 좌표를 쓴다(몸이 그려지는 바로 그 자리) · 없으면 sim 좌표로 떨어진다.
      const p = this.dispPos.get(e.id) ?? { x: e.x, y: e.y };
      const r = bodyRadiusOf(e);
      // 폰 실기 판정(2026-08-11 사용자: "체력바 잘 안 보이고") — 길이·두께·불투명도를 한 단씩 올렸다.
      // 전투가 3물기(약 1초)라 이 선이 사는 시간 자체가 짧으니, 뜨는 동안은 확실히 보여야 한다.
      const w = Math.min(30, Math.max(16, r * 2.0)); // 선 길이 — 몸을 따라가되 너무 길어지지 않게
      const h = 3.2; // 두께(월드 px · 기본 줌 2.2 에서 화면 약 7px)
      const y = p.y - r - 6;
      const x = p.x - w / 2;
      const hp = Math.max(0, Math.min(1, e.energy / SIM.maxEnergy));
      // 물린 직후가 가장 진하고 부상이 아물면서 옅어진다 — 「방금 맞았다」가 세기로도 읽힌다.
      const fade = Math.min(1, e.woundTicks / SIM.woundTicks);
      const alpha = 0.55 + 0.4 * fade;
      // 어두운 밑판을 반 px 크게 깔아 밝은 지형(사막·눈) 위에서도 선이 안 사라진다(방울 빛살과 같은 수법).
      this.woundG.rect(x - 0.6, y - 0.6, w + 1.2, h + 1.2).fill({ color: 0x120d09, alpha: alpha * 0.85 });
      if (hp > 0) {
        const col = e.species.isPlayer ? 0xe85c43 : 0xf5ebdc;
        this.woundG.rect(x, y, w * hp, h).fill({ color: col, alpha });
      }
    }
  }

  private drawMoveTarget(): void {
    this.moveTargetG.clear();
    const p = this.moveTarget;
    if (!p) return;
    const pulse = 0.5 + 0.5 * Math.sin(((this.frame % 66) / 66) * Math.PI * 2);
    // 「피해라」의 자리: **깃발을 세우지 않는다.** 깃발은 "여기로 가라"는 뜻이라 정반대를 말하게 된다.
    // 대신 붉은 고리 + 바깥으로 뻗는 짧은 화살표 넷 = "이 자리에서 멀어져라". 색은 위협(붉은)
    // 계열이라 라임(가라)과 한눈에 갈린다 · 명령이 사는 몇 초 동안 맥동해 유효함이 읽힌다.
    if (this.moveTargetAvoid) {
      const ar = 9 + 3 * pulse;
      this.moveTargetG.circle(p.x, p.y, ar + 1).stroke({ color: LEAD_OUTLINE, width: 3.4, alpha: 0.3 });
      this.moveTargetG.circle(p.x, p.y, ar).stroke({ color: AVOID_COLOR, width: 1.8, alpha: 0.6 + 0.3 * pulse });
      this.moveTargetG.circle(p.x, p.y, 1.6).fill({ color: AVOID_LIGHT, alpha: 0.9 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const x0 = p.x + c * (ar + 2.5);
        const y0 = p.y + s * (ar + 2.5);
        const x1 = p.x + c * (ar + 8);
        const y1 = p.y + s * (ar + 8);
        this.moveTargetG.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: LEAD_OUTLINE, width: 3.2, alpha: 0.3 });
        this.moveTargetG.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: AVOID_LIGHT, width: 1.5, alpha: 0.9 });
      }
      return;
    }
    // 바닥 링 — 지면에 눕는 타원(깃발이 "이 지점 땅"에 꽂혔음을 보인다). 어두운 밑선 → 라임 순서로
    // 두 번 — 밝은 지형(사막·눈) 위에서 표식이 사라지는 걸 막는다(LEAD_OUTLINE 과 같은 이유).
    const rr = 5.5 + 1.5 * pulse;
    this.moveTargetG.ellipse(p.x, p.y, rr + 1, (rr + 1) * 0.45).stroke({ color: LEAD_OUTLINE, width: 2.6, alpha: 0.3 });
    this.moveTargetG.ellipse(p.x, p.y, rr, rr * 0.45).stroke({ color: FLAG_COLOR, width: 1.6, alpha: 0.55 + 0.25 * pulse });
    this.moveTargetG.circle(p.x, p.y, 1.5).fill({ color: FLAG_LIGHT, alpha: 0.9 });
    // 깃대 + 깃면 — 작은 삼각 페넌트. 폰 기본 줌(2.2)에서 화면 ~33px 높이라 손가락 옆에서도 읽히되
    // 개체 몸(반지름 ~15)보다 작아 시야를 안 막는다.
    const top = p.y - 15;
    this.moveTargetG.moveTo(p.x, p.y).lineTo(p.x, top).stroke({ color: LEAD_OUTLINE, width: 3.4, alpha: 0.35 });
    this.moveTargetG.moveTo(p.x, p.y).lineTo(p.x, top).stroke({ color: FLAG_LIGHT, width: 1.6, alpha: 0.9 });
    this.moveTargetG
      .poly([p.x, top, p.x + 8, top + 3.2, p.x, top + 6.4])
      .fill({ color: FLAG_COLOR, alpha: 0.92 })
      .stroke({ color: LEAD_OUTLINE, width: 1, alpha: 0.4 });
  }

  /**
   * **시험이 세계에 찍은 자리** — 「표시된 자리에 N마리」 시험의 그 원.
   *
   * **[사용자 2026-08-06]** 「시험을 "무엇을 해라"에서 "무엇을 지켜라"로. 세계 위에 목표를 찍는다.」
   * 예전 시험은 화면 어디에도 없어서 "뭘 하려는 건지 모르겠다"가 나왔다(2026-08-02 폰 실기).
   * 이 원이 그 답이다 — **보이면 몰면 되고, 명령이 곧 답이 된다.**
   *
   * 색은 명령 깃발과 같은 계열(라임)로 둔다: 둘 다 "여기로 가라"는 뜻이라 색이 다르면 둘째 언어가 된다.
   * 다만 깃발은 내가 찍은 것, 이 원은 세계가 찍은 것이라 **점선**으로 갈라 놓는다.
   */
  private drawTrialZone(world: World): void {
    this.trialZoneG.clear();
    const z = world.trialZone;
    if (!z) return;
    const pulse = 0.5 + 0.5 * Math.sin(((this.frame % 96) / 96) * Math.PI * 2);
    // 바닥을 옅게 채워 "안"과 "밖"이 갈린다 — 테두리만 있으면 어디까지가 안인지 손끝에서 안 읽힌다.
    this.trialZoneG.circle(z.x, z.y, z.r).fill({ color: FLAG_COLOR, alpha: 0.06 + 0.03 * pulse });
    // 점선 테두리 · 세그먼트를 직접 그린다(Pixi v8 에 점선 스트로크가 없다).
    const seg = 22;
    const n = Math.max(12, Math.round((2 * Math.PI * z.r) / seg));
    for (let i = 0; i < n; i += 2) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      this.trialZoneG
        .moveTo(z.x + Math.cos(a0) * z.r, z.y + Math.sin(a0) * z.r)
        .lineTo(z.x + Math.cos(a1) * z.r, z.y + Math.sin(a1) * z.r)
        .stroke({ color: FLAG_COLOR, width: 2.4, alpha: 0.55 + 0.25 * pulse });
    }
  }

  /**
   * **황금 고블린** — 「금빛 짐승 N마리 잡기」 시험의 목표. **[사용자 2026-08-07]** 확정
   * ("좀 눈에 띄게 금색으로 번쩍번쩍하게"). 옛 「표식이 찍힌 야생」 그리기를 갈아엎었다(2026-08-12).
   *
   * 설명 없이 읽히는 것이 목적이다(전달 규칙 1순위): 금빛 몸 + 맥동 광륜 + 도는 반짝 네 점.
   * 생물 스프라이트가 아니라 이 레이어에 직접 그린다 — 생태 밖 존재라 몸집·형질 시각 문법(크기 =
   * 몸집 등)을 물려받으면 오히려 거짓말이 된다.
   */
  private drawTrialMarks(world: World): void {
    this.trialMarkG.clear();
    const g = world.goblin;
    if (g === null) return;
    if (!this.inView(g.x, g.y, 80)) return;
    const pulse = 0.5 + 0.5 * Math.sin(((this.frame % 40) / 40) * Math.PI * 2);
    const spin = ((this.frame % 90) / 90) * Math.PI * 2;
    // 광륜(바깥 어두운 밑선 → 금빛 한 겹) — 밝은 지형(사막·눈) 위에서도 안 사라지게 밑선을 깐다.
    this.trialMarkG.circle(g.x, g.y, 15 + 3 * pulse).stroke({ color: LEAD_OUTLINE, width: 3, alpha: 0.35 });
    this.trialMarkG.circle(g.x, g.y, 13 + 3 * pulse).stroke({ color: GOBLIN_GOLD, width: 2.2, alpha: 0.9 });
    // ── 금빛 「짐승」 — 원 하나로 그렸더니 "전혀 짐승같지 않다"([사용자 2026-08-12]). 진행 방향으로
    //    눕는 몸통 + 머리 + 귀 두 짝 + 꼬리를 그린다(보스 실루엣과 같은 문법 · 방향은 sim 의 heading).
    const ux = Math.cos(g.heading);
    const uy = Math.sin(g.heading);
    const px = -uy; // 몸의 옆 방향
    const py = ux;
    const P = (f: number, s: number): { x: number; y: number } => ({
      x: g.x + ux * f + px * s,
      y: g.y + uy * f + py * s,
    });
    // 꼬리(뒤로 가늘게 흔들리는 선) — 살아 있는 것으로 읽히는 가장 싼 신호.
    const wag = Math.sin(((this.frame % 22) / 22) * Math.PI * 2) * 2.4;
    const tailEnd = { x: g.x - ux * 12 + px * wag, y: g.y - uy * 12 + py * wag };
    this.trialMarkG
      .moveTo(P(-5.5, 0).x, P(-5.5, 0).y)
      .lineTo(tailEnd.x, tailEnd.y)
      .stroke({ color: GOBLIN_GOLD, width: 1.8, alpha: 0.9, cap: "round" });
    // 몸통(뒤 크고 앞 작은 원 두 개 겹침 = 길쭉한 등) + 머리.
    const hind = P(-3, 0);
    const fore = P(2.5, 0);
    const head = P(7, 0);
    this.trialMarkG.circle(hind.x, hind.y, 5).fill({ color: GOBLIN_GOLD, alpha: 0.95 });
    this.trialMarkG.circle(fore.x, fore.y, 4.2).fill({ color: GOBLIN_GOLD, alpha: 0.95 });
    this.trialMarkG.circle(head.x, head.y, 3).fill({ color: 0xfff3c4, alpha: 0.95 });
    // 귀 두 짝(머리에서 옆·위로 뾰족) — "동물 머리"로 읽히게 하는 결정적 한 획.
    for (const s of [1, -1]) {
      const base = P(6, s * 2);
      const tip = P(8.5, s * 4.6);
      this.trialMarkG
        .moveTo(base.x, base.y)
        .lineTo(tip.x, tip.y)
        .stroke({ color: 0xfff3c4, width: 2, alpha: 0.95, cap: "round" });
    }
    // 발(몸 아래 좌우로 총총 · 걷는 위상은 프레임에서) — 점 네 개면 충분하다.
    const step = Math.sin(((this.frame % 14) / 14) * Math.PI * 2) * 1.6;
    for (const [f, s] of [
      [-4, 3.8],
      [-2, -3.8],
      [1.5, 3.8],
      [3.5, -3.8],
    ] as const) {
      const foot = P(f + step * (s > 0 ? 0.4 : -0.4), s);
      this.trialMarkG.circle(foot.x, foot.y, 1.1).fill({ color: GOBLIN_GOLD, alpha: 0.85 });
    }
    // 도는 반짝 네 점 — 「번쩍번쩍」. 각도는 프레임에서 오므로 결정론과 무관한 순수 연출이다.
    for (let k = 0; k < 4; k += 1) {
      const a = spin + (k * Math.PI) / 2;
      const rr = 11 + 2 * pulse;
      this.trialMarkG
        .circle(g.x + Math.cos(a) * rr, g.y + Math.sin(a) * rr, 1.6)
        .fill({ color: 0xffffff, alpha: 0.55 + 0.35 * pulse });
    }
  }

  /**
   * 쫓아와 무는 보스 개체 하나(단일 추격자 또는 떼의 한 마리)를 그린다 — 물기 반경(즉사, 게임성) +
   * 맥동 고리(주목) + **종류별 실루엣**(진행 방향으로 회전). 종류마다 모양이 달라 "무엇이 덮치는지"가
   * 색뿐 아니라 형태로도 한눈에 읽힌다(사용자 피드백: 보스가 다 비슷한 점이라 개성이 없다).
   */
  private drawBossCreature(
    x: number,
    y: number,
    hx: number,
    hy: number,
    size: number,
    type: BossType,
    color: number,
    killRadius: number,
    pulse: number,
  ): void {
    drawBossShape(this.bossG, x, y, hx, hy, size, type, color, killRadius, pulse);
  }

  /**
   * 격퇴 체력의 변화를 좇는다(렌더 전용 상태 갱신). **판정을 만들지 않는다** · sim 의 boss.hp 가
   * 줄었다는 사실 하나만 본다. 그래서 번쩍임·잔상이 바가 가리키는 값과 정의상 어긋날 수 없다.
   * 보스가 바뀌면(라운드 교체) 통째로 리셋해 지난 보스의 잔상이 새 바에 남지 않게 한다.
   */
  private trackRaidHp(boss: Boss | null, dtMS: number): void {
    if (boss === null) {
      this.raidBossRef = null;
      return;
    }
    if (this.raidBossRef !== boss) {
      this.raidBossRef = boss;
      this.raidHpPrev = boss.hp;
      this.raidGhostHp = boss.hp;
      this.raidHitAge = RAID_FLASH_MS;
      return;
    }
    this.raidHitAge += dtMS;
    if (boss.hp < this.raidHpPrev) this.raidHitAge = 0; // 방금 깎였다
    this.raidHpPrev = boss.hp;
    // 잔상 · 깎인 자리를 잠깐 붙들고 있다가 천천히 따라 내려온다. 한 번의 반격이 바를 0.4px 밖에
    // 못 움직여도, 잠깐 쌓인 몫은 눈에 보이는 폭이 된다("최근에 이만큼 깎았다").
    if (boss.hp > this.raidGhostHp) this.raidGhostHp = boss.hp; // 새 라운드·회복 시 위로는 즉시 맞춘다
    else if (this.raidHitAge > RAID_GHOST_HOLD_MS) {
      const k = 1 - Math.pow(1 - RAID_GHOST_EASE, dtMS / (1000 / 60));
      this.raidGhostHp += (boss.hp - this.raidGhostHp) * k;
      if (this.raidGhostHp - boss.hp < 0.02) this.raidGhostHp = boss.hp;
    }
  }

  /** 남은 체력 숫자(Pixi Text)를 처음 쓸 때 한 번 만든다. 화면 밖에 두는 대신 visible 로 껐다 켠다. */
  private ensureRaidText(): Text {
    if (this.raidText === null) {
      const t = new Text({
        text: "",
        style: new TextStyle({
          fill: 0xfff2ec,
          fontSize: RAID_TEXT_SIZE,
          fontWeight: "800",
          // 굵은 어두운 테두리 · 사막·눈·풀 어디 위에 떠도 숫자가 안 사라진다(표식 밑선과 같은 이유).
          stroke: { color: 0x0b0e14, width: 4 },
        }),
      });
      t.anchor.set(0, 0.5);
      // 월드 레이어는 카메라 줌으로 확대되므로 화면 배율만큼 높은 해상도로 구워 흐림을 막는다.
      // 매 프레임 바꾸면 텍스처를 다시 굽는다 → 만들 때 한 번만 정한다.
      t.resolution = Math.min(4, (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1) * 2);
      this.raidTextC.addChild(t);
      this.raidText = t;
    }
    return this.raidText;
  }

  private hideRaidText(): void {
    if (this.raidText) this.raidText.visible = false;
  }

  /**
   * 격퇴 체력 바 · "얼마나 남았나"가 아니라 **"방금 깎였다"** 를 보이는 표시다.
   * 바 1픽셀이 6HP 가 넘는데 근접 반격 한 번은 1.2HP 가 상한이라, 폭만으로는 사건을 원리적으로 못
   * 보여 준다(공격력 100 이어도 한 방이 1픽셀에 못 미친다). 그래서 셋을 함께 쓴다:
   *   ① 남은 체력을 소수점 한 자리까지 **숫자로** 적는다(유일하게 정직한 눈금).
   *   ② 깎인 순간 바 끝이 희게 번쩍인다.
   *   ③ 최근에 깎인 몫이 옅은 잔상으로 남아 "이만큼 줄였다"가 폭으로 보인다.
   * 그리고 **맞설 수 있는 개체가 하나도 없으면 바를 아예 안 그린다** · 못 깎는 판에 가득 찬 바를
   * 띄우는 것은 화면이 하는 거짓말이다(known_issues: 수치가 화면 표시와 다르면 그건 거짓말이다).
   * (ax,ay)=붙이고 싶은 자리, (fx,fy)=보스가 실제로 있는 자리(화면 밖일 때 가리킬 방향).
   */
  private drawRaidBar(
    boss: Boss | null, fighters: number, ax: number, ay: number, fx: number, fy: number,
  ): void {
    if (boss === null || boss.maxHp <= 0) {
      this.hideRaidText();
      return;
    }
    const g = this.bossG;
    const w = RAID_BAR_W;
    const h = RAID_BAR_H;
    const ratio = clamp01(boss.hp / boss.maxHp);
    const ghost = clamp01(this.raidGhostHp / boss.maxHp);
    // 화면 밖이면 가장자리 안쪽으로 밀어 붙인다. 카메라는 내 무리를 따라가는데 바는 보스 위에만 있어서,
    // 둘이 갈리는 순간 바가 화면 어디에도 없었다(보스전 자동 표본에서 한 번도 안 잡혔다).
    let x = ax;
    let y = ay;
    let clamped = false;
    if (this.viewHalfW < 1e8) {
      // 위아래 여백은 **화면 고정 UI** 를 피해야 하므로 화면px 기준으로 잡고 월드px 로 환산한다
      // (목표 줄은 top 8px 에 살고 상세 패널이 62px 에서 열린다 → 그 아래로 내려야 안 가린다).
      const padTop = Math.max(RAID_PAD_Y, RAID_TOP_CSS / this.viewZoom);
      const padBottom = Math.max(RAID_PAD_Y, RAID_BOTTOM_CSS / this.viewZoom);
      const nx = clampRange(x, this.viewCX - this.viewHalfW + RAID_PAD_L, this.viewCX + this.viewHalfW - RAID_PAD_R);
      const ny = clampRange(y, this.viewCY - this.viewHalfH + padTop, this.viewCY + this.viewHalfH - padBottom);
      if (Math.abs(nx - x) > 0.5 || Math.abs(ny - y) > 0.5) clamped = true;
      x = nx;
      y = ny;
    }
    // **맞설 수 있는 개체가 하나도 없으면 바 대신 그 사실을 말한다**(2026-08-11).
    // 개체마다 붙던 전사 쐐기(주황 콘)는 걷어냈다 — **[사용자 2026-08-11]** "그게 굳이 필요한가?" ·
    // 그 표식이 진짜 필요한 순간은 「아무도 못 맞서는 판」 하나뿐이라(도입 사유가 그 사고였다),
    // 그 한 순간만 여기 한 줄로 남긴다. 못 깎는 판에 가득 찬 바를 띄우는 거짓말도 그대로 막힌다.
    if (fighters <= 0) {
      const t0 = this.ensureRaidText();
      t0.text = "맞설 수 있는 개체가 없습니다";
      t0.x = x - w / 2;
      t0.y = y + h / 2;
      if (this.viewHalfW < 1e8 && t0.x + t0.width > this.viewCX + this.viewHalfW - 4) {
        t0.x = this.viewCX + this.viewHalfW - 4 - t0.width;
      }
      t0.visible = true;
      return;
    }
    // 바탕 판 · 어떤 지형 위에서도 바가 뜨게.
    g.roundRect(x - w / 2 - 1.6, y - 1.6, w + 3.2, h + 3.2, 4).fill({ color: 0x0b0e14, alpha: 0.78 });
    // ③ 잔상(최근에 깎은 몫) · 남은 체력과 잔상 사이 구간을 옅은 금빛으로. 이 폭이 "내가 지금 깎고 있는 양"이다.
    if (ghost > ratio + 0.0005) {
      g.roundRect(x - w / 2 + w * ratio, y, Math.max(1, w * (ghost - ratio)), h, 2)
        .fill({ color: 0xffd76a, alpha: 0.55 });
    }
    g.roundRect(x - w / 2, y, Math.max(1.5, w * ratio), h, 2.5).fill({ color: 0xff5a44, alpha: 0.95 });
    // ② 깎인 순간의 번쩍임 · 남은 체력의 끝(줄어드는 그 지점)에서 흰빛이 짧게 터진다.
    if (this.raidHitAge < RAID_FLASH_MS) {
      const f = 1 - this.raidHitAge / RAID_FLASH_MS;
      const ex = x - w / 2 + w * ratio;
      g.roundRect(ex - 1.5, y - 1.5 - f * 1.5, 3, h + 3 + f * 3, 1.6).fill({ color: 0xffffff, alpha: 0.9 * f });
      g.circle(ex, y + h / 2, 3 + f * 5).stroke({ color: 0xfff4c8, width: 1.6 * f + 0.3, alpha: 0.8 * f });
    }
    // 화면 밖으로 밀렸으면 보스가 있는 쪽을 가리키는 쐐기를 함께 · "저쪽에 있다"가 없으면 바가 유령이 된다.
    if (clamped) {
      const dx = fx - x;
      const dy = fy - y;
      const d = Math.hypot(dx, dy);
      if (d > 1) {
        const ux = dx / d;
        const uy = dy / d;
        const bx = x + ux * (w / 2 + 9);
        const by = y + h / 2 + uy * (h / 2 + 9);
        const px = -uy;
        const py = ux;
        g.poly([
          bx + ux * 7, by + uy * 7,
          bx - ux * 2 + px * 5, by - uy * 2 + py * 5,
          bx - ux * 2 - px * 5, by - uy * 2 - py * 5,
        ])
          .fill({ color: 0xff5a44, alpha: 0.95 })
          .stroke({ color: 0x0b0e14, width: 1.4, alpha: 0.75 });
      }
    }
    // ① 남은 체력 숫자 · **소수점 한 자리**. 정수로 반올림하면 199.6/200 이 "100%" 로 찍혀,
    //    실제로 깎이고 있는데 화면은 안 깎였다고 말하게 된다(그게 이번 사건의 핵심 거짓말이다).
    //    내림이라 꽉 찼을 때만 100.0% 다.
    const t = this.ensureRaidText();
    t.text = (Math.floor(ratio * 1000) / 10).toFixed(1) + "%";
    t.x = x + w / 2 + 5;
    t.y = y + h / 2;
    // 오른쪽 여백(RAID_PAD_R)은 "100.0%" 기준의 어림이라, 글자 폭이 그보다 넓어지는 화면에서는 숫자가
    // 잘린다. 실제 글자 폭(t.width)으로 한 번 더 확인해 넘치면 바 **왼쪽**으로 넘긴다 · 화면 끝에
    // 붙어 잘린 숫자는 없는 것만 못하다.
    if (this.viewHalfW < 1e8 && t.x + t.width > this.viewCX + this.viewHalfW - 4) {
      t.x = x - w / 2 - 5 - t.width;
    }
    t.visible = true;
  }

  /**
   * 보스가 **어느 층에서** 사냥하는지의 단서. 화면만 보고 "왜 저게 날 못 잡지?"를 알 수 있어야 한다
   * (시각=로직 1:1, known_issues). 하늘 보스는 아래로 어긋난 그림자(높이 떠 있다 → 물속은 못 건드린다),
   * 물 보스는 퍼지는 파문(물속을 가른다 → 뭍은 못 건드린다). 땅 보스는 땅에 붙어 있어 단서가 필요 없다.
   */
  private drawLayerCue(roam: Layer, x: number, y: number, size: number): void {
    if (roam === "air") {
      this.bossG
        .ellipse(x + size * 0.62, y + size * 0.88, size * 0.62, size * 0.3)
        .fill({ color: 0x0a1408, alpha: 0.3 });
    } else if (roam === "water") {
      const t = (this.frame % 66) / 66;
      for (const k of [0, 0.5]) {
        const p = (t + k) % 1;
        this.bossG
          .ellipse(x, y, size * (1.1 + p * 1.6), size * (0.5 + p * 0.8))
          .stroke({ color: 0xd8f0ff, width: 1.6, alpha: 0.34 * (1 - p) });
      }
    }
  }
}

/**
 * 보스 실루엣을 Graphics 에 직접 그린다(월드 좌표, 진행 방향으로 회전). WorldView 밖으로 뺀 이유는
 * 프리뷰 하니스(boss-preview.html)가 같은 함수로 5종을 렌더해 시각 검증하기 위함 — 화면과 검증이 1:1.
 * 종류별 모양이 달라 "무엇이 덮치는지"가 색뿐 아니라 형태로도 읽힌다. 스타일은 makeCreatureTexture 와
 * 통일(색 파생 굵은 윤곽선 + 플랫 2~3톤 + 큰 눈).
 */
export function drawBossShape(
  g: Graphics,
  x: number,
  y: number,
  hx: number,
  hy: number,
  size: number,
  type: BossType,
  color: number,
  killRadius: number,
  pulse: number,
): void {
    // 물기 반경(닿으면 즉사) + 맥동 고리 — 로직과 1:1(known_issues), 게임성 유지.
    if (killRadius > 0) g.circle(x, y, killRadius).fill({ color, alpha: 0.24 });
    g.circle(x, y, size * 1.25 + pulse * size * 1.3).stroke({ color, width: 2.2, alpha: 0.45 * (1 - pulse) });

    // 진행 방향(헤딩)으로 회전. 거의 안 움직이면 아래(+y)를 향하게 둔다(몰려오는 방향). 앞=+x.
    const mag = Math.hypot(hx, hy);
    const ca = mag > 0.02 ? hx / mag : 0;
    const sa = mag > 0.02 ? hy / mag : 1;
    const s = size;
    // 로컬 좌표(앞=+x, 등=-y 위쪽 밝게, 배=+y 아래쪽 어둡게)를 헤딩으로 돌려 화면 좌표로. 단위는 몸 크기 s 배수.
    const P = (fx: number, fy: number): [number, number] => {
      const ox = fx * s;
      const oy = fy * s;
      return [x + ox * ca - oy * sa, y + ox * sa + oy * ca];
    };
    const pol = (pts: ReadonlyArray<readonly [number, number]>): Graphics => {
      const flat: number[] = [];
      for (const [fx, fy] of pts) flat.push(...P(fx, fy));
      return g.poly(flat);
    };

    // 생물(makeCreatureTexture)과 같은 톤 체계 — 색에서 파생한 굵은 단일 윤곽선 + 플랫 2~3톤.
    const line = darken(color, 0.42); // 굵은 통일 윤곽선(고정 갈색이 아니라 보스 색 계열이라 붕 안 뜬다)
    const back = lighten(color, 0.42); // 등(위) 하이라이트 — 불투명 밝은 패치
    const limb = darken(color, 0.66); // 지느러미·뿔·귀 등 어두운 부속(보스는 대비를 살짝 세게)
    const maw = darken(color, 0.14); // 벌린 아가리 안(거의 검게)
    const OW = 2.6; // 윤곽선 두께(생물보다 살짝 굵게 = 위압)

    // 큰 눈 — 생물과 통일(어두운 테 + 흰자 + 동공 + 반짝). 눈썹 없음(사용자 요청).
    const eye = (fx: number, fy: number, r: number): void => {
      const [ex, ey] = P(fx, fy);
      g.circle(ex, ey, r + 0.9).fill({ color: line });
      g.circle(ex, ey, r).fill({ color: 0xffffff });
      g.circle(...P(fx + 0.05, fy + 0.02), r * 0.56).fill({ color: 0x140404 }); // 동공(앞을 노린다)
      g.circle(...P(fx + 0.01, fy - 0.06), r * 0.24).fill({ color: 0xffffff }); // 반짝
    };
    // 다리/촉수 하나 — 어두운 부속을 굵은 라운드 선으로. 끝점은 P(회전 안전), 두께는 px. 발끝에 작은 발.
    const leg = (ax: number, ay: number, bx: number, by: number, w: number): void => {
      g.moveTo(...P(ax, ay)).lineTo(...P(bx, by)).stroke({ color: limb, width: w, cap: "round" });
      g.circle(...P(bx, by), w * 0.6).fill({ color: limb });
    };
    // 앞으로 벌린 아가리의 흰 송곳니 둘(위/아래 모서리에서 앞으로) — top-down 정면 입.
    const frontFangs = (baseFx: number, half: number, tipFx: number): void => {
      for (const sgn of [-1, 1])
        pol([[baseFx, sgn * half], [tipFx, sgn * 0.03], [baseFx, sgn * 0.04]])
          .fill({ color: 0xfff3e2 }).stroke({ color: line, width: 0.6 });
    };

    if (type === "chaser") {
      // 빠른 추격자 — 오직 속도. 극도로 길고 가는 유선형 몸에 다리를 앞뒤로 쭉 뻗은 전력질주 자세.
      // 귀 없고 매끈한 뾰족 코(벌린 아가리 없음)로 "공기를 가르는" 인상 → isolation(다부진 늑대)과 확실히 대비.
      leg(-0.55, 0.24, -1.35, 0.66, s * 0.13); // 뒷다리(뒤로 쭉 뻗음)
      leg(-0.55, -0.24, -1.35, -0.66, s * 0.13);
      leg(0.7, 0.22, 1.45, 0.62, s * 0.13); // 앞다리(앞으로 쭉 뻗음)
      leg(0.7, -0.22, 1.45, -0.62, s * 0.13);
      g.moveTo(...P(-1.15, 0)) // 길게 나부끼는 가는 꼬리
        .quadraticCurveTo(...P(-1.95, -0.22), ...P(-2.7, -0.4))
        .stroke({ color: limb, width: s * 0.11, cap: "round" });
      g.moveTo(...P(2.25, 0)) // 극도로 길고 가는 유선형 몸(뾰족한 코, 목 없이 매끈)
        .quadraticCurveTo(...P(1.5, -0.28), ...P(0.5, -0.33))
        .quadraticCurveTo(...P(-0.55, -0.35), ...P(-1.15, -0.13))
        .quadraticCurveTo(...P(-1.4, 0), ...P(-1.15, 0.13))
        .quadraticCurveTo(...P(-0.55, 0.35), ...P(0.5, 0.33))
        .quadraticCurveTo(...P(1.5, 0.28), ...P(2.25, 0))
        .closePath().fill({ color }).stroke({ color: line, width: OW });
      g.moveTo(...P(1.8, 0)) // 가는 척추 능선 하이라이트
        .quadraticCurveTo(...P(0.3, -0.11), ...P(-0.9, -0.02))
        .quadraticCurveTo(...P(0.3, 0.09), ...P(1.8, 0)).closePath().fill({ color: back });
      g.circle(...P(2.18, 0), s * 0.07).fill({ color: line }); // 코끝
      eye(1.15, -0.17, s * 0.17);
      eye(1.15, 0.17, s * 0.17);
    } else if (type === "raider") {
      // 약탈자 — 앞으로 큰 뿔 하나를 앞세워 들이받는 육중한 짐승(코뿔소/투구벌레). 다리 짧고 단단, 입 하나.
      // 카운터=공격력(맞서 싸움). 뿔이 하나라 "촉수 오징어"로 안 읽힌다.
      for (const sgn of [-1, 1]) { // 짧고 단단한 여섯 다리
        leg(0.55, sgn * 0.62, 0.9, sgn * 1.05, s * 0.16);
        leg(-0.1, sgn * 0.68, -0.35, sgn * 1.12, s * 0.16);
        leg(-0.72, sgn * 0.6, -1.0, sgn * 1.0, s * 0.16);
      }
      g.moveTo(...P(1.1, 0)) // 육중한 몸(넓은 타원, 장갑)
        .quadraticCurveTo(...P(0.95, -0.72), ...P(0.15, -0.84))
        .quadraticCurveTo(...P(-0.85, -0.92), ...P(-1.18, -0.3))
        .quadraticCurveTo(...P(-1.34, 0), ...P(-1.18, 0.3))
        .quadraticCurveTo(...P(-0.85, 0.92), ...P(0.15, 0.84))
        .quadraticCurveTo(...P(0.95, 0.72), ...P(1.1, 0))
        .closePath().fill({ color }).stroke({ color: line, width: OW });
      g.moveTo(...P(0.65, 0)) // 등딱지 하이라이트
        .quadraticCurveTo(...P(-0.3, -0.52), ...P(-1.02, -0.05))
        .quadraticCurveTo(...P(-0.3, 0.42), ...P(0.65, 0)).closePath().fill({ color: back });
      pol([[1.0, -0.28], [1.0, 0.28], [2.55, 0]]).fill({ color: limb }).stroke({ color: line, width: 1.6 }); // 큰 뿔 하나(앞으로)
      pol([[2.05, -0.1], [2.55, 0], [2.05, 0.1]]).fill({ color: lighten(color, 0.5) }); // 뿔 끝 밝게
      eye(0.72, -0.42, s * 0.2); // 작은 눈 둘(뿔 뿌리 양옆)
      eye(0.72, 0.42, s * 0.2);
    } else if (type === "isolation") {
      // 외톨이 사냥꾼 — 홀로 무리를 노리는 늑대. chaser(가는 질주체)와 달리 몸이 짧고 다부지며 머리가 크고
      // 뾰족 귀가 도드라진다. 쩍 벌린 이빨 주둥이로 "무는 사냥꾼". 카운터=무리 성향(함께 뭉침).
      leg(0.45, 0.44, 0.82, 1.0, s * 0.15); // 다부진 네 다리(버티는 자세)
      leg(0.45, -0.44, 0.82, -1.0, s * 0.15);
      leg(-0.55, 0.46, -0.92, 1.02, s * 0.15);
      leg(-0.55, -0.46, -0.92, -1.02, s * 0.15);
      g.moveTo(...P(-1.0, 0)) // 꼬리(한쪽으로 늘어진다)
        .quadraticCurveTo(...P(-1.55, 0.32), ...P(-1.95, 0.08))
        .stroke({ color: limb, width: s * 0.16, cap: "round" });
      pol([[1.05, -0.36], [1.72, -1.08], [0.6, -0.64]]).fill({ color: limb }).stroke({ color: line, width: 1.3 }); // 크고 뾰족한 귀
      pol([[1.05, 0.36], [1.72, 1.08], [0.6, 0.64]]).fill({ color: limb }).stroke({ color: line, width: 1.3 });
      g.moveTo(...P(1.6, 0)) // 짧고 다부진 몸 + 큰 머리
        .quadraticCurveTo(...P(1.45, -0.54), ...P(0.85, -0.62))
        .quadraticCurveTo(...P(-0.2, -0.68), ...P(-0.95, -0.42))
        .quadraticCurveTo(...P(-1.22, -0.18), ...P(-1.12, 0))
        .quadraticCurveTo(...P(-1.22, 0.18), ...P(-0.95, 0.42))
        .quadraticCurveTo(...P(-0.2, 0.68), ...P(0.85, 0.62))
        .quadraticCurveTo(...P(1.45, 0.54), ...P(1.6, 0))
        .closePath().fill({ color }).stroke({ color: line, width: OW });
      g.moveTo(...P(1.1, 0)) // 등 하이라이트
        .quadraticCurveTo(...P(0.1, -0.24), ...P(-0.9, -0.02))
        .quadraticCurveTo(...P(0.1, 0.2), ...P(1.1, 0)).closePath().fill({ color: back });
      pol([[1.78, 0], [1.12, -0.32], [1.12, 0.32]]).fill({ color: maw }).stroke({ color: line, width: 0.9 }); // 쩍 벌린 주둥이
      frontFangs(1.28, 0.26, 1.74);
      eye(0.92, -0.3, s * 0.2);
      eye(0.92, 0.3, s * 0.2);
    } else if (type === "stalker") {
      // 그림자 매복자 — 숨어 덮치는 비대칭 어둠 덩어리 + 번뜩이는 눈(시야가 카운터라 눈을 강조) + 뻗는 촉수.
      // 대칭 가시공(바이러스 느낌)을 피해 불규칙한 그림자 실루엣으로.
      const R: readonly number[] = [1.02, 0.68, 1.2, 0.62, 1.32, 0.82, 1.0, 0.58, 1.24, 0.72, 0.9, 0.86];
      const n = R.length;
      const haze: number[] = [];
      const body: number[] = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const rr = (R[k] ?? 1) * s;
        const bx = x + Math.cos(a) * rr;
        const by = y + Math.sin(a) * rr;
        body.push(bx, by);
        haze.push(x + (bx - x) * 1.4, y + (by - y) * 1.4);
      }
      g.poly(haze).fill({ color: darken(color, 0.5), alpha: 0.2 }); // 바깥 어둠 번짐
      g.moveTo(...P(0.55, -0.34)).quadraticCurveTo(...P(1.55, -0.5), ...P(2.1, -0.1)) // 뻗는 촉수 둘(잡으러)
        .stroke({ color: darken(color, 0.6), width: s * 0.17, cap: "round" });
      g.moveTo(...P(0.55, 0.34)).quadraticCurveTo(...P(1.55, 0.56), ...P(2.15, 0.2))
        .stroke({ color: darken(color, 0.6), width: s * 0.17, cap: "round" });
      g.poly(body).fill({ color: darken(color, 0.72) }).stroke({ color: line, width: OW }); // 어둠 덩어리
      const glowEye = (dx: number, dy: number, r: number): void => {
        g.circle(x + dx, y + dy, r * 1.9).fill({ color: 0xff5cf2, alpha: 0.2 }); // 번짐
        g.circle(x + dx, y + dy, r + 0.9).fill({ color: line });
        g.circle(x + dx, y + dy, r).fill({ color: 0xff6cf2 });
        g.circle(x + dx - r * 0.22, y + dy - r * 0.22, r * 0.36).fill({ color: 0xffffff });
      };
      glowEye(s * 0.34, -s * 0.1, s * 0.27); // 번뜩이는 눈 셋(불규칙 배치)
      glowEye(s * 0.02, s * 0.4, s * 0.17);
      glowEye(-s * 0.4, -s * 0.24, s * 0.16);
    } else if (type === "swarm") {
      // 사나운 무리 — 큰 턱(집게)으로 무는 사나운 벌레. 작고 여럿이라 떼로 몰려든다(다리 여섯·두 마디 몸).
      // 카운터=번식력(솎여도 수로 메움). 벌레라 물고기와 확실히 구분된다.
      for (const sgn of [-1, 1]) { // 여섯 다리
        leg(0.3, sgn * 0.5, 0.62, sgn * 1.0, s * 0.1);
        leg(-0.15, sgn * 0.55, -0.45, sgn * 1.05, s * 0.1);
        leg(-0.58, sgn * 0.48, -0.9, sgn * 0.92, s * 0.1);
      }
      g.moveTo(...P(0.8, -0.16)).quadraticCurveTo(...P(1.5, -0.5), ...P(1.75, -0.02)) // 큰 집게(턱) 둘
        .stroke({ color: limb, width: s * 0.12, cap: "round" });
      g.moveTo(...P(0.8, 0.16)).quadraticCurveTo(...P(1.5, 0.5), ...P(1.75, 0.02))
        .stroke({ color: limb, width: s * 0.12, cap: "round" });
      g.circle(...P(-0.5, 0), s * 0.64).fill({ color }).stroke({ color: line, width: OW }); // 배(뒷마디)
      g.circle(...P(0.4, 0), s * 0.54).fill({ color }).stroke({ color: line, width: OW }); // 가슴/머리(앞마디)
      g.circle(...P(-0.5, 0), s * 0.34).fill({ color: back }); // 배 하이라이트
      eye(0.5, -0.22, s * 0.15);
      eye(0.5, 0.22, s * 0.15);
    } else if (type === "raptor") {
      // 하늘의 사냥꾼(큰수리) — 활짝 편 큰 날개 + 갈고리 부리 + 앞으로 뻗은 발톱. 위에서 본 맹금.
      // 날개가 몸보다 훨씬 커야 "난다"가 한눈에 읽혀 땅 보스들과 실루엣이 확실히 갈린다.
      for (const sgn of [-1, 1]) {
        g.moveTo(...P(0.5, sgn * 0.24)) // 뒤로 스윕한 큰 날개
          .quadraticCurveTo(...P(0.4, sgn * 1.5), ...P(-0.75, sgn * 2.1))
          .quadraticCurveTo(...P(-0.5, sgn * 1.1), ...P(-0.7, sgn * 0.3))
          .closePath()
          .fill({ color: limb })
          .stroke({ color: line, width: 1.6 });
        for (const k of [0, 1, 2]) // 날개 끝 칼깃 셋(펼친 손가락)
          g.moveTo(...P(-0.6 + k * 0.08, sgn * (1.85 - k * 0.2)))
            .lineTo(...P(-1.05 - k * 0.12, sgn * (2.15 - k * 0.34)))
            .stroke({ color: line, width: 1.2, cap: "round" });
      }
      leg(0.85, 0.3, 1.5, 0.6, s * 0.11); // 앞으로 뻗은 발톱(낚아채러)
      leg(0.85, -0.3, 1.5, -0.6, s * 0.11);
      pol([[-0.95, -0.14], [-0.95, 0.14], [-1.9, 0.52], [-1.98, 0], [-1.9, -0.52]]) // 부채꼴 꼬리
        .fill({ color: limb }).stroke({ color: line, width: 1.4 });
      g.moveTo(...P(1.5, 0)) // 유선형 몸
        .quadraticCurveTo(...P(1.1, -0.42), ...P(0.2, -0.48))
        .quadraticCurveTo(...P(-0.7, -0.42), ...P(-1.05, 0))
        .quadraticCurveTo(...P(-0.7, 0.42), ...P(0.2, 0.48))
        .quadraticCurveTo(...P(1.1, 0.42), ...P(1.5, 0))
        .closePath().fill({ color }).stroke({ color: line, width: OW });
      g.moveTo(...P(1.0, 0)) // 등 하이라이트
        .quadraticCurveTo(...P(0.0, -0.2), ...P(-0.85, -0.02))
        .quadraticCurveTo(...P(0.0, 0.18), ...P(1.0, 0)).closePath().fill({ color: back });
      pol([[1.32, -0.17], [1.32, 0.17], [2.05, 0.03]]) // 갈고리 부리(노란 맹금 부리)
        .fill({ color: 0xffd86a }).stroke({ color: line, width: 1.2 });
      g.circle(...P(1.97, 0.07), s * 0.07).fill({ color: line }); // 부리 끝 갈고리
      eye(1.0, -0.25, s * 0.19);
      eye(1.0, 0.25, s * 0.19);
    } else if (type === "hornet") {
      // 성난 말벌 — 투명한 날개 + 가는 허리 + 노랑·검정 줄무늬 배 + 뒤로 뻗은 침. 하늘에서 몰려와 쏜다.
      const stripe = 0x241a06; // 검은 줄무늬(말벌의 표식 — 노랑 몸에서 바로 읽힌다)
      for (const sgn of [-1, 1]) {
        g.ellipse(...P(0.0, sgn * 0.6), s * 0.6, s * 0.28).fill({ color: 0xffffff, alpha: 0.36 }); // 투명 날개
        g.ellipse(...P(0.0, sgn * 0.6), s * 0.6, s * 0.28).stroke({ color: line, width: 0.7, alpha: 0.5 });
        leg(0.25, sgn * 0.28, 0.55, sgn * 0.72, s * 0.07); // 가는 다리
        leg(-0.3, sgn * 0.3, -0.6, sgn * 0.74, s * 0.07);
      }
      g.moveTo(...P(-1.42, 0)).lineTo(...P(-2.15, 0)) // 뒤로 뻗은 침
        .stroke({ color: line, width: s * 0.1, cap: "round" });
      g.ellipse(...P(-0.72, 0), s * 0.72, s * 0.5).fill({ color }).stroke({ color: line, width: OW }); // 줄무늬 배
      for (const bx of [-1.05, -0.62, -0.2]) // 검은 띠 셋
        pol([[bx, -0.36], [bx + 0.15, -0.36], [bx + 0.15, 0.36], [bx, 0.36]]).fill({ color: stripe });
      g.circle(...P(0.28, 0), s * 0.42).fill({ color: stripe }).stroke({ color: line, width: 1.6 }); // 검은 가슴(가는 허리)
      g.circle(...P(0.92, 0), s * 0.38).fill({ color }).stroke({ color: line, width: OW }); // 머리
      for (const sgn of [-1, 1]) // 더듬이
        g.moveTo(...P(1.15, sgn * 0.16)).quadraticCurveTo(...P(1.6, sgn * 0.5), ...P(1.95, sgn * 0.42))
          .stroke({ color: line, width: 1.2, cap: "round" });
      eye(1.02, -0.24, s * 0.15);
      eye(1.02, 0.24, s * 0.15);
    } else if (type === "shark") {
      // 굶주린 상어 — 길쭉한 유선형 몸 + 초승달 꼬리 + 가슴지느러미 + 등지느러미 능선. 물속만 돈다.
      pol([[-1.7, 0], [-2.55, -0.72], [-2.15, 0], [-2.55, 0.72]]) // 초승달 꼬리
        .fill({ color: limb }).stroke({ color: line, width: 1.4 });
      for (const sgn of [-1, 1]) // 가슴지느러미(넓게 뻗은 낫)
        pol([[0.4, sgn * 0.36], [-0.05, sgn * 1.3], [-0.4, sgn * 0.44]])
          .fill({ color: limb }).stroke({ color: line, width: 1.3 });
      g.moveTo(...P(2.0, 0)) // 길쭉한 몸(뾰족한 코)
        .quadraticCurveTo(...P(1.3, -0.36), ...P(0.2, -0.46))
        .quadraticCurveTo(...P(-1.0, -0.42), ...P(-1.7, -0.12))
        .quadraticCurveTo(...P(-1.85, 0), ...P(-1.7, 0.12))
        .quadraticCurveTo(...P(-1.0, 0.42), ...P(0.2, 0.46))
        .quadraticCurveTo(...P(1.3, 0.36), ...P(2.0, 0))
        .closePath().fill({ color }).stroke({ color: line, width: OW });
      g.moveTo(...P(1.55, 0.06)) // 흰 배(상어의 아랫면)
        .quadraticCurveTo(...P(0.2, 0.34), ...P(-1.3, 0.14))
        .quadraticCurveTo(...P(0.2, 0.18), ...P(1.55, 0.06)).closePath().fill({ color: back });
      pol([[0.8, 0], [0.0, -0.17], [-0.55, 0], [0.0, 0.17]]) // 등지느러미 능선(척추 위로 솟은 칼)
        .fill({ color: limb }).stroke({ color: line, width: 1.2 });
      pol([[2.05, 0], [1.32, -0.3], [1.32, 0.3]]).fill({ color: maw }).stroke({ color: line, width: 0.9 }); // 벌린 아가리
      frontFangs(1.48, 0.24, 1.98);
      eye(1.18, -0.3, s * 0.15);
      eye(1.18, 0.3, s * 0.15);
    } else {
      g.circle(x, y, s).fill({ color }).stroke({ color: line, width: OW });
      eye(0.3, -0.2, s * 0.3);
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
  // 독 안개 · 온 땅의 에너지를 빨아들인다. 느리게 맥동하는 탁한 독빛(살아 움직이는 독).
  // ⚠ 화면 전체 틴트이던 시절의 값(0x5f8f36 · 0.22)에서 **어둡고 짙게** 바꿨다. 안개가 이제 수풀을
  //   비우고 칠하므로, 옅으면 「비운 자리」가 안 읽힌다 · 초록 땅 위의 초록 틴트는 눈에 안 걸린다.
  //   어둡게 깔면 수풀만 원래 밝기로 남아 "밝은 데가 안전한 데"가 설명 없이 보인다.
  poison: { color: 0x2e3d16, baseAlpha: 0.5, pulseAmp: 0.07, pulseSpeed: 0.06 },
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
  chaser: { dot: 0xff4028, aura: 0x8a1206, ring: 0xe03418 }, // 새빨강(질주하는 추격자 — 단일 돌진)
  swarm: { dot: 0xff7a2a, aura: 0x7a2a08, ring: 0xd8641a }, // 성난 주황(사나운 무리)
  raider: { dot: 0xff2e5a, aura: 0x7a0a24, ring: 0xd81a44 }, // 핏빛 진홍(약탈)
  isolation: { dot: 0x33c0d8, aura: 0x0a3a4a, ring: 0x1f92b0 }, // 청록(외톨이 사냥꾼)
  stalker: { dot: 0xc060d0, aura: 0x3a0a3a, ring: 0x8a2a9a }, // 자주(그림자 매복)
  // 짙은 구릿빛 갈색(맹금). 밝은 황금(0xe0a020)은 하늘 개척자 프리셋의 내 종 색(0xf0c840)과 겹쳐
  // "내 종인지 보스인지" 헷갈렸다 — 훨씬 짙고 붉게 내려 갈라놓는다(사나운 무리의 밝은 주황과도 구분).
  raptor: { dot: 0xb5642a, aura: 0x3a1a04, ring: 0xe08828 },
  hornet: { dot: 0xffc814, aura: 0x5a4400, ring: 0xd8a000 }, // 경고 노랑(말벌 — 줄무늬는 실루엣에서)
  shark: { dot: 0xb0bcc8, aura: 0x1a3a5a, ring: 0xe0405a }, // 강철 회청 몸 + 핏빛 고리(청록 바다에서 튄다)
};

// 먹이 종류별 색 — 모두 식물처럼 자연스럽되 구분되게(연두 / 청록 / 노랑풀 / 바이옴 전용=주황 열매).
// 종류 3 = 바이옴 전용 먹이(사막·침엽수림·우림에, 특화종만 먹음) — 주황빛 열매로 일반 먹이와 구분.
const FOOD_COLORS: readonly number[] = [0x9bee5a, 0x5ad6b0, 0xd8de5a, 0xf0a848];
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

// 앞장선 개체(알파 조종) 표식 색: 청백. 초록(내 종)·보라(독)와 안 겹치고,
// 연파랑 무리 방패(0xcfe6ff)보다 희고 밝다.
const LEAD_COLOR = 0xf0f8ff;
// 표식 밑에 까는 어두운 윤곽 — 사막·눈·마른 풀처럼 밝은 지형 위에서 흰 표식이 사라지는 걸 막는다.
const LEAD_OUTLINE = 0x06080d;
// 표식 링 반경(월드 px) — 내 종 초록 고리(12.5)와 무리 방패 링(17.5) 사이에 끼워 둘 다와 안 겹친다.
const LEAD_RING_R = 15;
// 한 프레임에 그릴 관계 고리 수 상한(안전장치). 화면 밖 컬링만으로도 보통 10~20 개라 실제로는 안 걸리지만,
// 개체가 화면에 몰리는 최악(떼 시련이 한 화면에 들어옴)에도 프레임이 안 무너지게 못을 박아 둔다.
// 관계 표식(브래킷·톱니 링) 화면 동시 상한 — 40이었는데 확대 화면에선 표식이 세계를 덮었다
// (2026-08-02 사용자: 밀도). 가까운 것부터 순회되는 게 아니라 "먼저 만난 12개"지만, 화면 안 개체가
// 12를 넘는 일 자체가 드물고 잠금 대상은 상한 예외라 명령 표시는 절대 안 잘린다.
const LEAD_MARK_CAP = 12;
// 관계 고리 거리 감쇠(월드 px) — 이 안쪽은 최대 세기, 이 바깥은 바닥(0.5). 코앞의 위협이 저 멀리 것과
// 같은 진하기면 "지금 급한 것"이 안 도드라진다.
// 기본 줌 1.55→2.2(탭 명령 조종) 재조정: 폰 논리 화면 540×~1170 에서 보이는 월드가 반폭 ~123px·
// 반높이 ~265px(대각 반지름 ~292px)로 줄었다. 옛 값(90/420)은 FAR 가 화면 대각을 훌쩍 넘어 화면에
// 든 표식 전부가 사실상 최대 진하기 = 감쇠가 없는 것과 같았다. FAR=300 은 화면 대각 반지름 바로
// 바깥 — 화면에 들어오는 순간부터 감쇠가 걸린다. NEAR=70 은 몸(반지름 ~15) 서너 개 거리 = 정말
// 코앞인 것만 최대 세기.
const REL_NEAR = 70;
const REL_FAR = 300;
// 겨눔 범위(leadTargetRange) 밖 먹잇감 브래킷의 진하기 배율 — "표식은 뜨는데 지금은 못 겨눈다"를
// 흐림으로 말한다(범위에 들면 원래 진하기로 돌아와 "지금 물 수 있다"가 켜진 것처럼 읽힌다).
const PREY_OUT_OF_AIM_DIM = 0.35;
// 이동 명령 깃발 색 — 명령 접수 파문(effects drawGoPing 0xbcf24e)과 같은 라임. 두 파일이 같은 값을
// 들고 있으니 바꿀 땐 함께 바꾼다(색이 갈리면 "파문 → 깃발" 연결이 끊긴다).
const FLAG_COLOR = 0xbcf24e;
/** 시험 표식의 금빛 · 먹잇감 호박빛과 같은 계열이라 "저건 노릴 것"이 색만으로 읽힌다. */
const GOBLIN_GOLD = 0xffd24a; // 황금 고블린 · 미니맵 점 · 잡는 순간의 파문(effects)과 같은 금
const FLAG_LIGHT = 0xe4ffb0; // 깃대·중심점(밝은 라임 — 어두운 지형 위 가독)
// 「피해라」 표식의 붉은빛 · 위협(보스 떼 0xff5535)과 같은 계열이라 "저기서 멀어져라"가 색만으로 읽힌다.
// 라임(가라)과 정반대 색이라 두 명령이 한눈에 갈린다.
const AVOID_COLOR = 0xff6a4a;
const AVOID_LIGHT = 0xffc8b4;

// ── 격퇴 체력 바 ────────────────────────────────────────────────────────────────────────
// 폭 44 → 72 월드px. 다만 폭을 키우는 것만으로는 절대 안 된다 · 근접 반격 한 번(최대 1.2HP)이 200HP
// 바에서 차지하는 몫은 0.43px 라, 사건 단위가 표시 단위보다 작다. 숫자·번쩍임·잔상이 그래서 필요하다.
const RAID_BAR_W = 72;
const RAID_BAR_H = 6;
const RAID_TEXT_SIZE = 12; // 월드px = 기본 줌(1)에서 화면 12px. 굵은 어두운 테두리로 대비를 벌었다.
// 바를 화면 안으로 밀어 넣을 때 가장자리에서 남길 여백(월드px). 오른쪽은 숫자("100.0%") 폭까지 뺀다.
const RAID_PAD_L = 46;
const RAID_PAD_R = 106;
const RAID_PAD_Y = 22; // 최소 여백(월드px)
// 위아래는 화면px 기준(줌으로 나눠 월드px 로 환산). 위는 목표 줄(top 8px, 상세 패널이 62px 에서
// 열린다)을 피하고, 아래는 미니맵·조작 열 위로 뜨게 한다. 값이 어긋나면 바가 UI 뒤로 숨는다.
const RAID_TOP_CSS = 66;
const RAID_BOTTOM_CSS = 34;
const RAID_FLASH_MS = 260; // 깎인 순간 흰 번쩍임이 사는 시간
const RAID_GHOST_HOLD_MS = 700; // 잔상이 그 자리에 머무는 시간(이 뒤로 천천히 따라 내려온다)
const RAID_GHOST_EASE = 0.06; // 잔상이 따라 내려오는 세기(60fps 1프레임 기준)

// 맞서는 개체(전사) 표식 색 · 반격 스파크(effects drawCounter 0xffb524)와 같은 금빛 계열이다.
// "금빛 표식이 붙은 놈 = 치는 놈, 금빛 스파크 = 방금 쳤다" 로 색이 이어져 읽힌다.
// 붉은 계열을 안 쓴 이유: 보스·물기·즉사 반경이 전부 붉은색이라 내 편 표식이 위협으로 오독된다.

// 회전 떨림 방지: 이만큼(px/스텝)보다 실제로 더 움직일 때만 진행 방향을 갱신한다.
// (느린 종은 미세 변위의 방향이 노이즈라, 낮으면 제자리에서 몸이 떤다.)
const ROTATE_MIN_STEP = 0.35;

// 등가시가 나기 시작하는 공격력 하한(0~1). 이보다 낮은 종(초식·약한 종)은 등이 매끈해 "가시=공격형"이
// 한눈에 대비된다. 기본 게놈 attack 50(=0.5)이면 가시가 나므로, 확실히 순한 종만 매끈.
const SPIKE_MIN = 0.28;

/**
 * 무지갯빛 꾸밈의 색. 개체 id 로 위상을 어긋내 무리가 한 색으로 동기화되지 않게 한다.
 * `lo` 가 채도를 정한다 — 몸 틴트는 곱셈이라 연하게(0.55, 진하면 원래 종 색이 죽어 무슨 종인지 안 읽힌다),
 * 몸을 감싸는 오라는 진하게(0.1) 써서 색이 한눈에 읽히게 한다.
 */
function rainbowTint(frame: number, id: number, lo = 0.55): number {
  const h = ((frame * 0.006 + (id % 17) / 17) % 1) * 6;
  const i = Math.floor(h);
  const f = h - i;
  const hi = 1;
  const q = hi - (hi - lo) * f;
  const t = lo + (hi - lo) * f;
  let r = hi;
  let g = t;
  let b = lo;
  if (i === 1) {
    r = q;
    g = hi;
    b = lo;
  } else if (i === 2) {
    r = lo;
    g = hi;
    b = t;
  } else if (i === 3) {
    r = lo;
    g = q;
    b = hi;
  } else if (i === 4) {
    r = t;
    g = lo;
    b = hi;
  } else if (i >= 5) {
    r = hi;
    g = lo;
    b = q;
  }
  return (clamp255(r * 255) << 16) | (clamp255(g * 255) << 8) | clamp255(b * 255);
}

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
// 험지 — 거친 회갈색 자갈밭(산 아래. 바위·돌이 많아 "느리게 통과하는 땅"으로 읽힌다).
const ROUGH_LO: RGB = [96, 88, 76];
const ROUGH_HI: RGB = [124, 116, 104];
// 바이옴 바탕색(척박/건조 상태) — 한눈에 사막/빙하/우림이 갈리게 뚜렷이 구분. 비옥할수록 BIOME_LUSH 로 섞인다.
const BIOME_COLORS: Record<Biome, RGB> = {
  glacier: [206, 220, 234], // 얼음 벌판 — 창백한 하늘빛 흰색
  taiga: [96, 128, 120], // 침엽수림 — 서늘한 청록 회색(눈 덮인 침엽수)
  desert: [204, 178, 116], // 사막 — 모래빛 황갈
  grassland: [128, 148, 78], // 초원 — 마른 풀빛
  wetland: [72, 122, 104], // 습지 — 축축한 청록
  rainforest: [46, 108, 52], // 열대우림 — 짙은 밀림 초록
};
// 바이옴별 비옥(먹이 풍부) 쪽 색 — 바탕색보다 생기 있는 초록. fert 로 바탕↔이쪽 보간.
const BIOME_LUSH: Record<Biome, RGB> = {
  glacier: [180, 204, 200], // 얼음에도 이끼 낀 청록빛
  taiga: [60, 104, 78], // 짙은 침엽수 초록
  desert: [150, 156, 86], // 오아시스 관목의 마른 초록
  grassland: [86, 138, 60], // 무성한 초원
  wetland: [40, 118, 84], // 짙은 습지 수풀
  rainforest: [28, 104, 44], // 가장 짙은 밀림
};
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

function terrainColor(kind: TileKind, elev: number, biome: Biome, cold: number, fert: number): number {
  if (kind === TILE.water) {
    // 표고가 낮을수록(깊을수록) 어두운 남색, 해안에 가까울수록 청록.
    return pack(mix(WATER_DEEP, WATER_SHALLOW, elev / WATER_BAND));
  }
  if (kind === TILE.mountain) {
    // 높을수록·추울수록 눈으로.
    const t = (elev - MOUNTAIN_BAND) / (1 - MOUNTAIN_BAND);
    return pack(mix(ROCK, SNOW, t * 0.7 + cold * 0.5));
  }
  // 육지 계열(트인 육지·수풀·험지) — 바이옴 색이 바탕. 비옥할수록 조금 짙게(생기), 수풀은 더 어둡게(덤불),
  // 험지는 바위 쪽으로 섞어 거칠게. 바이옴이 사막/빙하/우림 등으로 한눈에 갈린다.
  const base = mix(BIOME_COLORS[biome], BIOME_LUSH[biome], fert * 0.5);
  if (kind === TILE.grass) return pack(mix(base, [0, 0, 0], 0.22)); // 수풀 = 덤불(짙게)
  if (kind === TILE.rough) {
    const t = (elev - 0.7) / (MOUNTAIN_BAND - 0.7);
    return pack(mix(base, mix(ROUGH_LO, ROUGH_HI, t), 0.55)); // 험지 = 바위 자갈밭
  }
  return pack(base);
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

// 개체 무늬를 몸통 위에 그린다(줄무늬/반점/얼룩). 개체 룩(look)에 따라 종류·배치가 갈려 같은 종
// 안에서도 한 마리씩 달라 보인다. 좌표는 몸 반길이 len·반너비 wid 안쪽으로 잡아 윤곽선을 안 넘게 한다.
function drawPattern(g: Graphics, look: CreatureLook, len: number, wid: number, color: number): void {
  if (look.pattern === 0) return; // 민무늬
  const pc = look.patternDark ? darken(color, 0.62) : lighten(color, 0.5);
  if (look.pattern === 1) {
    // 줄무늬 — 몸을 가로지르는 세로 줄 몇 개(호랑이 무늬처럼). 앞뒤로 고르게, 몸 곡률 따라 짧게.
    const lw = 1.6 + wid * 0.16;
    for (let s = 0; s < look.stripes; s++) {
      const px = len * (0.42 - ((s + 1) / (look.stripes + 1)) * 1.05);
      const hh = wid * 0.82 * (1 - Math.min(1, Math.abs(px) / (len * 1.02))); // 끝으로 갈수록 짧게
      if (hh < 1) continue;
      g.moveTo(px, -hh).lineTo(px, hh).stroke({ color: pc, width: lw, alpha: 0.92 });
    }
    return;
  }
  // 반점(2) / 얼룩(3) — 등쪽에 흩뿌린 타원.
  for (const sp of look.spots) {
    g.ellipse(sp.x * len, sp.y * wid, sp.r * len * 0.5, sp.r * wid * 0.72).fill({ color: pc });
  }
}

// 게놈에서 한 종의 생물 스프라이트 텍스처를 만든다(앞쪽 = +x). 형질이 형태로 드러난다.
// 아트 방향: "스티커/인디게임" 스타일 — 전체를 감싸는 **굵은 윤곽선** + **불투명 플랫 음영**(반투명
// 겹침으로 탁해지지 않게) + **크고 또렷한 눈**. 사실적으로 그리려다 조잡해지는 대신, 단순하고 개성 있는
// 실루엣으로 "일부러 이런 스타일"로 읽히게 한다. 형질은 여전히 형태로 드러난다(프리셋/빌드 구분).
export function makeCreatureTexture(
  renderer: Renderer,
  genome: Genome,
  color: number,
  look: CreatureLook = DEFAULT_LOOK,
): Texture {
  const t = genome.traits;
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

  // 색: 전부 불투명(alpha 겹침 없음 → 탁하지 않다). 진한 통일 윤곽선 + 배 그림자 + 등 하이라이트.
  const line = darken(color, 0.42); // 굵은 윤곽선(어둡되 색 계열이라 부드럽다)
  const belly = darken(color, 0.72); // 배(아래) 그림자 — 불투명 패치
  const back = lighten(color, 0.44); // 등(위) 하이라이트 — 불투명 패치
  const limb = darken(color, 0.86); // 주둥이·꼬리 등 어두운 부속
  const OW = 2.3; // 윤곽선 두께(굵게 = 스티커 느낌)

  // 몸집(v7) — 스프라이트 크기가 곧 형질이다. **몸집 50 이면 배수 1.0** 이라 기존 종은 크기가 안 변한다.
  // 이 축은 화면에서 즉시 읽히는 게 존재 이유다: 커진 종은 커 보여야 하고, 그래야 "안 잡아먹히는 이유"가
  // 눈에 들어온다(작아진 종은 작아 보이고, 그래서 잘 잡아먹힌다).
  // 폭 0.4 → 0.62: 카드 한 장(「커다란 몸」 +24 → 몸집 74)에 **30% 커져** 한눈에 보인다. 0.4 일 땐
  // 카드 성장 스케일까지 겹쳐 11% 밖에 안 커졌고, 사용자가 "몸집 차이가 나는 애들이 없다"고 했다.
  const sizeScale = 1 + sizeDev(t.size) * 0.62; // 몸집 0 → ×0.38 · 50 → ×1.0 · 100 → ×1.62
  const len = (9 + speed01 * 9) * sizeScale; // 몸 반길이 (빠를수록 길쭉·날렵)
  const wid = (8.5 - speed01 * 3.2) * sizeScale; // 몸 반너비 (느릴수록 통통)

  // === 뒤 레이어(몸통 아래): 날개 / 꼬리지느러미 — 윤곽선 있는 깔끔한 한 쌍 ===
  if (wing01 > 0.05) {
    const wl = wid + 6 + wing01 * 12;
    const wingCol = lighten(color, 0.16);
    for (const s of [-1, 1]) {
      g.moveTo(len * 0.32, s * wid * 0.35)
        .quadraticCurveTo(-len * 0.05, s * wl * 1.05, -len * 0.5, s * wl * 0.72)
        .quadraticCurveTo(-len * 0.62, s * wl * 0.3, -len * 0.15, s * wid * 0.45)
        .closePath()
        .fill({ color: wingCol })
        .stroke({ color: line, width: 1.7 });
    }
  }
  if (swim01 > 0.6) {
    const f = (swim01 - 0.6) / 0.4;
    const tl = 7 + f * 9;
    g.moveTo(-len * 0.72, 0)
      .quadraticCurveTo(-len - tl, -wid - f * 4, -len - tl * 0.55, -wid * 0.2)
      .quadraticCurveTo(-len - tl * 0.9, 0, -len - tl * 0.55, wid * 0.2)
      .quadraticCurveTo(-len - tl, wid + f * 4, -len * 0.72, 0)
      .closePath()
      .fill({ color: limb })
      .stroke({ color: line, width: 1.7 });
  }

  // === 몸통 — 매끈한 물방울형(머리 둥글고 꼬리로 좁아짐) + 굵은 통일 윤곽선 ===
  g.moveTo(len, 0)
    .quadraticCurveTo(len * 0.74, -wid, len * 0.02, -wid)
    .quadraticCurveTo(-len * 0.62, -wid, -len, -wid * 0.34)
    .quadraticCurveTo(-len * 1.04, 0, -len, wid * 0.34)
    .quadraticCurveTo(-len * 0.62, wid, len * 0.02, wid)
    .quadraticCurveTo(len * 0.74, wid, len, 0)
    .closePath()
    .fill({ color })
    .stroke({ color: line, width: OW });

  // 배 그림자 + 등 하이라이트 — 불투명 타원 패치(몸 안에 들어가게 크기 조절 → 윤곽선 안 넘음).
  g.ellipse(-len * 0.04, wid * 0.44, len * 0.6, wid * 0.44).fill({ color: belly });
  g.ellipse(len * 0.06, -wid * 0.5, len * 0.52, wid * 0.28).fill({ color: back });

  // 개체 무늬(줄무늬/반점/얼룩) — 같은 종 안에서 한 마리씩 달라 보이는 핵심. 몸 안쪽에만 그려 윤곽선을
  // 안 넘게 한다(스티커 느낌엔 살짝 걸쳐도 무해). 색은 몸보다 어둡거나 밝게 대비.
  drawPattern(g, look, len, wid, color);

  // === 등가시 능선 (공격력) — "가시 많고 크다 = 사납다"가 한눈에 읽히게 개수·크기를 공격력에 강하게
  // 연동한다. 공격력 낮은 종(초식 등)은 등이 매끈(가시 없음)해 공격형과 확실히 대비된다. 개수는 공격력
  // 정보이므로 종 고정, 각 톱니의 높이·기울기만 개체 룩 시드(spikeJit)로 흔들어 같은 종도 제각각(개성). ===
  if (attack01 > SPIKE_MIN) {
    const a = (attack01 - SPIKE_MIN) / (1 - SPIKE_MIN); // 0~1 (가시 나기 시작~최강)
    const teeth = 1 + Math.round(a * 4); // 1~5개 — 셀수록 많다
    const baseH = 3.5 + a * 10; // 톱니 기본 높이 — 셀수록 크다
    const x0 = len * 0.44;
    const span = len * 1.0; // 능선이 등 앞~뒤로 뻗는 길이
    const step = span / teeth;
    g.moveTo(x0, -wid * 0.76);
    for (let s = 1; s <= teeth; s++) {
      const jit = look.spikeJit[(s - 1) % look.spikeJit.length] ?? 0;
      const h = baseH * (1 + jit * 0.4); // 톱니마다 높이 지터(개성)
      const px = x0 - s * step;
      const tipX = px + step * 0.5 + jit * len * 0.08; // 톱니 끝 좌우 기울기(개성)
      g.lineTo(tipX, -wid - h).lineTo(px, -wid * 0.7);
    }
    g.closePath().fill({ color: limb }).stroke({ color: line, width: 1.3 });
  }

  // === 원거리 창 (ranged) — 앞으로 길게 뻗은 창/부리 + 밝은 촉 ===
  if (ranged01 > 0.1) {
    const horn = 9 + ranged01 * 18;
    g.moveTo(len - 1, -2.6)
      .quadraticCurveTo(len + horn * 0.6, -1.4, len + horn, 0)
      .quadraticCurveTo(len + horn * 0.6, 1.4, len - 1, 2.6)
      .closePath()
      .fill({ color: lighten(line, 0.3) })
      .stroke({ color: line, width: 1.2 });
    g.poly([len + horn * 0.5, -1.3, len + horn, 0, len + horn * 0.5, 1.3]).fill({ color: 0xffffff });
  }

  // === 머리 앞부분 (식성) ===
  if (t.diet > SIM.dietGrazeMax) {
    // 육식 — 뭉툭·힘있는 주둥이 + 흰 이빨(윤곽선으로 또렷)
    const snout = 5 + diet01 * 7;
    g.moveTo(len * 0.5, -wid * 0.52)
      .quadraticCurveTo(len + snout, -wid * 0.16, len + snout, 0)
      .quadraticCurveTo(len + snout, wid * 0.16, len * 0.5, wid * 0.52)
      .closePath()
      .fill({ color: limb })
      .stroke({ color: line, width: 1.2 });
    g.poly([len + snout * 0.5, -1.5, len + snout * 0.98, 0, len + snout * 0.5, 1.5]).fill({ color: 0xffffff });
  } else if (t.diet <= SIM.dietHuntMin) {
    // 초식 — 부드러운 귀 두 개(둥근, 윤곽선)
    for (const dx of [0, 5.4]) {
      g.ellipse(len * 0.26 + dx, -wid * 0.98, 2.6, 4.4).fill({ color }).stroke({ color: line, width: 1.1 });
    }
  }

  // === 초음파 귀 (echo) — 머리 위 큰 뾰족 귀 한 쌍(박쥐, 윤곽선) ===
  if (echo01 > 0.1) {
    const eh = 5 + echo01 * 12;
    for (const s of [0, 1]) {
      const bx = len * 0.24 + s * 5.4;
      g.moveTo(bx - 3, -wid * 0.78)
        .lineTo(bx + 1, -wid * 0.78 - eh)
        .lineTo(bx + 4, -wid * 0.78)
        .closePath()
        .fill({ color })
        .stroke({ color: line, width: 1.1 });
    }
  }

  // === 눈 (시야) — 크고 또렷: 어두운 테 + 흰자 + 동공 + 반짝. 시야 클수록 큰 눈(종 구분).
  // 개체별 눈 크기·위치 미세 변형(look)까지 얹어 같은 종도 인상이 달라진다. ===
  const eye = (2.6 + vision01 * 4) * look.eyeScale;
  const ex = len * 0.5 + look.eyeDx * len;
  const ey = -wid * 0.28 + look.eyeDy * wid;
  g.circle(ex, ey, eye + 0.7).fill({ color: line });
  g.circle(ex, ey, eye).fill({ color: 0xffffff });
  g.circle(ex + eye * 0.24, ey + eye * 0.06, eye * 0.52).fill({ color: 0x14171d });
  g.circle(ex + eye * 0.52, ey - eye * 0.34, eye * 0.28).fill({ color: 0xffffff });

  // === 독침 (venom) = 방어 독 — 몸에 보라 경고 반점(윤곽선으로 또렷) ===
  if (venom01 > 0.1) {
    const vr = 1.6 + venom01 * 2;
    for (const [dx, dy, sc] of [[-0.25, 0.35, 1], [0.3, -0.4, 1], [0.05, 0.5, 0.82]] as const) {
      g.circle(len * dx, wid * dy, vr * sc).fill({ color: 0xc030e0 }).stroke({ color: 0x6a1080, width: 0.8 });
    }
  }

  // 고해상도로 생성(작은 스프라이트가 뭉개지지 않게 슈퍼샘플). resolution 4: 기본 줌이 2.2 로 오르며
  // 핀치/휠 확대(userZoom)나 데스크톱 UI 배율이 겹치면 총배율이 3 을 넘어 3 배 텍스처가 흐려진다.
  // 텍스처는 캐시라 생성 1회 비용만 든다(런타임 프레임 비용 없음).
  const tex = renderer.generateTexture({ target: g, resolution: 4, antialias: true });
  g.destroy();
  return tex;
}
