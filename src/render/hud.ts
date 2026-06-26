// 최소 HUD — 정보 박스(내 종/야생 수 · 단계·시간·환경, 죽을 때만 사망 알림) + 종/먹이 색 범례(접이식).
// 모바일은 꼭 필요한 것만 보이게: 추이 그래프는 뺐고, 범례·형질 패널은 기본 접힘(작은 칩).

import { Container, Graphics, Rectangle, Text, TextStyle } from "pixi.js";
import type { World } from "@/sim/world";
import type { DeathCause, DeathTally } from "@/sim/world";
import type { Species } from "@/sim/species";
import { COLORS } from "@/config";

const DEATH_INTERVAL = 48; // 사망 알림 갱신 주기(프레임)

// 종/먹이 색 범례 — 정보 박스 아래에 고정(HUD 는 화면 픽셀 공간이라 좌측 고정 좌표). 기본 접힘.
const LEGEND_X = 16;
const LEGEND_Y = 116;
const LEGEND_W = 150;
const LEGEND_PAD = 7;
const LEGEND_ROW = 18;
const LEGEND_SWATCH = 6; // 색 동그라미 반지름

// worldView.ts 의 FOOD_COLORS 와 동기화 유지(먹이 종류별 색: 연두 / 청록 / 노랑풀).
const FOOD_LEGEND_COLORS: readonly number[] = [0x9bee5a, 0x5ad6b0, 0xd8de5a];

// 정보 박스 — 내 종/야생 수 + 단계·시간·환경(+ 죽을 때만 사망 알림 한 줄). 꼭 필요한 것만 슬림하게.
const PANEL_X = 8;
const PANEL_Y = 8;
const PANEL_W = 232;
const PANEL_H = 80; // 기본(내 종 + 상태 2줄)
const PANEL_H_DEATH = 100; // 사망 알림 한 줄이 더 있을 때

const CAUSE_LABEL: Record<DeathCause, string> = {
  starve: "굶음",
  cold: "추위",
  heat: "더위",
  age: "노화",
  boss: "보스",
  predation: "잡아먹힘",
  plague: "역병",
};

export class Hud {
  readonly container = new Container();
  private readonly stat: Text;
  private readonly notice: Text;
  private readonly deathFeed: Text;
  private readonly panelBg = new Graphics();
  private frame = 0;
  private prevDeaths: DeathTally | null = null;

  // 종/먹이 색 범례(거의 정적 — 종 구성이 바뀔 때만 다시 그린다).
  private readonly legend = new Container();
  private readonly legendBgG = new Graphics();
  private readonly legendG = new Graphics();
  private legendSig = "";
  // 레이아웃별 기본값: 데스크톱은 펼침(공간 여유), 모바일은 접힘(클러터 최소화). 탭으로 토글.
  private legendOpen =
    typeof document !== "undefined" && document.body?.dataset.layout === "desktop";
  private readonly legendTitleStyle = new TextStyle({
    fill: COLORS.textDim,
    fontSize: 13,
    fontWeight: "600",
  });
  private readonly legendItemStyle = new TextStyle({ fill: COLORS.text, fontSize: 14 });
  // 종별 실시간 개체 수(행 우측). 행은 구성이 바뀔 때만 다시 그리고, 수 텍스트만 매 프레임 갱신한다.
  private readonly legendCountStyle = new TextStyle({ fill: 0xbcc6d4, fontSize: 13, fontWeight: "600" });
  private legendCounts: { id: number; text: Text }[] = [];

  constructor() {
    this.stat = new Text({
      text: "",
      style: new TextStyle({ fill: 0xffffff, fontSize: 22, fontWeight: "700" }),
    });
    this.stat.position.set(16, 14);

    this.notice = new Text({
      text: "",
      style: new TextStyle({ fill: 0xccd3df, fontSize: 17, lineHeight: 20 }),
    });
    this.notice.position.set(16, 44);

    this.deathFeed = new Text({
      text: "",
      style: new TextStyle({ fill: 0xffba8a, fontSize: 13 }),
    });
    this.deathFeed.position.set(16, 86);

    // 정보 박스(맨 뒤) — 글자의 공용 배경. 사망 알림 유무에 따라 높이만 다시 그린다(drawPanel).
    this.container.addChild(this.panelBg);
    this.container.addChild(this.stat);
    this.container.addChild(this.notice);
    this.container.addChild(this.deathFeed);
    this.drawPanel();

    // 범례: 배경(맨 뒤) → 색 동그라미/구분선 → 이름 텍스트(updateLegend 에서 추가) 순.
    this.legend.position.set(LEGEND_X, LEGEND_Y);
    this.legend.addChild(this.legendBgG);
    this.legend.addChild(this.legendG);
    this.container.addChild(this.legend);

    // 범례를 탭하면 접기/펴기. (HUD 컨테이너는 자식 이벤트 통과용 passive)
    this.container.eventMode = "passive";
    this.legend.eventMode = "static";
    this.legend.cursor = "pointer";
    this.legend.on("pointertap", () => {
      this.legendOpen = !this.legendOpen;
    });
  }

  /** 런이 바뀌면 추이·사망 피드를 리셋한다. */
  reset(): void {
    this.frame = 0;
    this.prevDeaths = null;
    this.deathFeed.text = "";
    this.drawPanel();
    this.legendSig = ""; // 새 런에서 종 구성이 바뀌면 다시 그리도록
  }

  sync(world: World, statusText: string): void {
    const mine = world.playerPopulation;
    this.stat.text = `내 종 ${mine}   야생 ${world.population - mine}`;
    this.notice.text = statusText;

    this.frame += 1;
    if (this.frame % DEATH_INTERVAL === 0) this.updateDeathFeed(world.deaths);
    this.updateLegend(world.species);
    if (this.frame % 6 === 0) this.updateLegendCounts(world); // 종별 실시간 수(가볍게 6프레임마다)

    // 로비(빈 상태줄)에선 정보 박스도 숨김. 범례는 관전 중에만(드래프트="카드 선택" 제외).
    const notLobby = statusText !== "";
    const onWatch = notLobby && !statusText.includes("카드 선택");
    this.panelBg.visible = notLobby;
    this.stat.visible = notLobby;
    this.notice.visible = notLobby;
    this.deathFeed.visible = notLobby;
    this.legend.visible = onWatch;
  }

  /** 최근 구간에 내 종이 어떤 원인으로 죽었는지 한 줄로(죽을 때만 잠깐). */
  private updateDeathFeed(deaths: DeathTally): void {
    if (!this.prevDeaths) {
      this.prevDeaths = { ...deaths };
      this.deathFeed.text = "";
      this.drawPanel();
      return;
    }
    const parts: string[] = [];
    for (const cause of Object.keys(deaths) as DeathCause[]) {
      const delta = deaths[cause] - this.prevDeaths[cause];
      if (delta > 0) parts.push(`${CAUSE_LABEL[cause]} ${delta}`);
    }
    this.prevDeaths = { ...deaths };
    parts.sort((a, b) => Number(b.split(" ")[1]) - Number(a.split(" ")[1]));
    // 박스가 좁으니 상위 2개 원인만(가독성). 사망 알림이 있으면 박스가 한 줄 늘어난다.
    this.deathFeed.text = parts.length ? `사망  ${parts.slice(0, 2).join("  ·  ")}` : "";
    this.drawPanel();
  }

  /** 정보 박스 배경 — 사망 알림 한 줄 유무에 따라 높이가 달라진다. */
  private drawPanel(): void {
    const h = this.deathFeed.text ? PANEL_H_DEATH : PANEL_H;
    this.panelBg.clear();
    this.panelBg
      .roundRect(PANEL_X, PANEL_Y, PANEL_W, h, 10)
      .fill({ color: 0x0c1018, alpha: 0.88 })
      .stroke({ color: 0x3b465c, width: 1, alpha: 0.95 });
  }

  /** 종별 실시간 개체 수를 행 우측에 갱신(텍스트만 — 행 재생성 없이 가볍게). */
  private updateLegendCounts(world: World): void {
    if (this.legendCounts.length === 0) return;
    const counts = new Map<number, number>();
    for (const e of world.entities) counts.set(e.species.id, (counts.get(e.species.id) ?? 0) + 1);
    for (const lc of this.legendCounts) {
      const next = String(counts.get(lc.id) ?? 0);
      if (lc.text.text !== next) lc.text.text = next; // 바뀔 때만 재렌더
    }
  }

  /** 종(색+이름)·먹이 색 범례를 그린다. 종 구성이 바뀔 때만 다시 그려 가볍다. */
  private updateLegend(species: readonly Species[]): void {
    // 접힘 상태도 시그니처에 포함 → 토글 시 다시 그린다.
    const sig = `${this.legendOpen ? 1 : 0}|${species.map((s) => `${s.id}:${s.color}`).join(",")}`;
    if (sig === this.legendSig) return;
    this.legendSig = sig;

    // 이전 이름 텍스트만 정리하고 배경/동그라미 그래픽은 재사용한다.
    for (const child of this.legend.removeChildren()) {
      if (child !== this.legendBgG && child !== this.legendG) child.destroy();
    }
    this.legend.addChild(this.legendBgG);
    this.legend.addChild(this.legendG);
    this.legendBgG.clear();
    this.legendG.clear();
    this.legendCounts = []; // 이전 수 텍스트는 위 removeChildren 에서 파괴됨 → 새로 모은다
    if (species.length === 0) {
      this.legend.hitArea = new Rectangle(0, 0, 0, 0);
      return;
    }

    // 헤더(탭으로 접기/펴기 — 화살표로 상태 표시).
    let y = LEGEND_PAD;
    const header = new Text({
      text: this.legendOpen ? "종 안내 ▾" : "종 안내 ▸",
      style: this.legendTitleStyle,
    });
    header.position.set(LEGEND_PAD, y);
    this.legend.addChild(header);
    y += 18;

    if (this.legendOpen) {
      for (const sp of species) {
        const cx = LEGEND_PAD + LEGEND_SWATCH;
        const cy = y + LEGEND_ROW / 2;
        this.legendG.circle(cx, cy, LEGEND_SWATCH).fill({ color: sp.color });
        if (sp.isPlayer) {
          // 화면 속 내 종 초록 고리와 맞춰 범례에서도 내 종임을 표시.
          this.legendG.circle(cx, cy, LEGEND_SWATCH + 2).stroke({ color: 0xaaffb0, width: 1.5 });
        }
        const label = new Text({ text: sp.name, style: this.legendItemStyle });
        label.position.set(LEGEND_PAD + LEGEND_SWATCH * 2 + 6, y);
        this.legend.addChild(label);
        // 행 우측에 실시간 개체 수(우측 정렬). updateLegendCounts 가 매 프레임 .text 만 갱신.
        const countText = new Text({ text: "", style: this.legendCountStyle });
        countText.anchor.set(1, 0);
        countText.position.set(LEGEND_W - LEGEND_PAD, y);
        this.legend.addChild(countText);
        this.legendCounts.push({ id: sp.id, text: countText });
        y += LEGEND_ROW;
      }

      // 구분선 + 먹이 색(흩어진 색점들이 먹이임을 한눈에).
      y += 4;
      this.legendG
        .moveTo(LEGEND_PAD, y)
        .lineTo(LEGEND_W - LEGEND_PAD, y)
        .stroke({ color: 0x3a4150, width: 1 });
      y += 8;
      const foodLabel = new Text({ text: "먹이", style: this.legendTitleStyle });
      foodLabel.position.set(LEGEND_PAD, y);
      this.legend.addChild(foodLabel);
      let fx = LEGEND_PAD + 44;
      for (const col of FOOD_LEGEND_COLORS) {
        this.legendG.circle(fx, y + 7, 5).fill({ color: col });
        fx += 22;
      }
      y += LEGEND_ROW;
    }

    // 배경 패널 — 접힘이면 헤더만(좁은 칩). legendBgG 는 첫 자식이라 항상 뒤에 렌더된다.
    // 어두운 월드에 묻히지 않게 불투명도↑ + 옅은 테두리로 또렷하게.
    const w = this.legendOpen ? LEGEND_W : 96;
    const h = y + 2;
    this.legendBgG
      .roundRect(0, 0, w, h, 8)
      .fill({ color: 0x0c1018, alpha: 0.88 })
      .stroke({ color: 0x3b465c, width: 1, alpha: 0.95 });
    this.legend.hitArea = new Rectangle(0, 0, w, h);
  }
}
