// 부트스트랩. PixiJS v8 앱 + scale-to-fit 뷰포트 + 게임 상태기계 + 셸 UI(로비/멈춤/배속).
//
// 코어 시뮬은 동일. 모바일(세로)/데스크톱(가로)은 논리 해상도와 UI 만 다르다(chooseLayout).
// 월드는 스케일 컨테이너(root)에, HUD/UI 는 화면 픽셀 그대로(선명).

import { Application, Container, Graphics } from "pixi.js";
import { chooseLayout, COLORS } from "@/config";
import { DEBUG, DEBUG_ACTIVE, debugLabel } from "@/debug";
import { setupViewport } from "@/render/viewport";
import { WorldView } from "@/render/worldView";
import { Hud } from "@/render/hud";
import { Game, type ExtinctionType } from "@/game/game";
import { BOSS_TYPES, bossName, type BossType } from "@/sim/boss";
import { createDraftPanel } from "@/ui/draftPanel";
import { createPresetPanel } from "@/ui/presetPanel";
import { createResultPanel } from "@/ui/resultPanel";
import { createLobby } from "@/ui/lobby";
import { createControls } from "@/ui/controls";
import { createBuildPanel } from "@/ui/buildPanel";
import { createGlossary } from "@/ui/glossary";
import { createCreatureCard } from "@/ui/creatureCard";
import { creatureName } from "@/ui/creatureName";
import { describeSpecies } from "@/game/runReport";
import { Highlights } from "@/render/highlights";
import { Effects } from "@/render/effects";
import { Minimap } from "@/render/minimap";
import { ThreatBanner } from "@/render/threatBanner";
import { sizeWord } from "@/render/creatureLook";
import { isPredatorBoss } from "@/sim/boss";
import { SIM } from "@/sim/params";
import type { Entity } from "@/sim/entity";

// 맵 배율 — 월드를 화면의 이 배수만큼 크게. 소수 개체(한 무리)를 카메라가 따라가며 탐험. 바이옴(사막·빙하·
// 우림)이 뚜렷한 구역으로 펼쳐지도록 넓게. 개체는 절대 수(소수)라 먹이 밀도·상한만 면적 비례(areaScale).
const MAP_SCALE = 2.0;

async function boot(): Promise<void> {
  const layout = chooseLayout();
  document.body.dataset.layout = layout.isDesktop ? "desktop" : "mobile";

  const app = new Application();
  await app.init({
    resizeTo: window, // 창 실제 픽셀로 렌더 → 선명
    background: COLORS.bg,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  const mount = document.getElementById("app");
  if (!mount) throw new Error("#app 마운트 지점을 찾을 수 없습니다.");
  mount.appendChild(app.canvas);

  // 월드는 비율 맞춰 스케일·중앙배치(레터박스). HUD 는 스케일 밖(화면 픽셀)이라 글자가 선명.
  const root = new Container();
  app.stage.addChild(root);
  setupViewport(app, root, layout.width, layout.height);

  const view = new WorldView(app.renderer);
  const effects = new Effects();
  view.container.addChild(effects.container); // 사건 연출(월드 좌표 → 카메라와 함께 움직임)
  const hud = new Hud();
  const highlights = new Highlights();
  root.addChild(view.container);
  // 월드를 논리 사각형으로 클리핑 — 가장자리 생물이 레터박스 밖으로 삐져나오지 않게.
  const worldMask = new Graphics().rect(0, 0, layout.width, layout.height).fill(0xffffff);
  root.addChild(worldMask);
  view.container.mask = worldMask;
  app.stage.addChild(hud.container); // ← root(스케일) 밖 = 네이티브 해상도
  app.stage.addChild(highlights.container);
  const minimap = new Minimap(); // 큰 맵 조망 — 화면 픽셀 좌표(카메라 변환 밖, 모서리 고정)
  app.stage.addChild(minimap.container);
  const threatBanner = new ThreatBanner(); // 위협 예고 전광판(최상단)
  app.stage.addChild(threatBanner.container);

  // 소수 개체 게임: 월드를 약간 크게(MAP_SCALE) + 개체는 절대 수(소수)지만 먹이 밀도·상한은 면적 비례
  // (areaScale=면적배율) → 큰 맵일수록 개체당 먹이가 넉넉해 굶지 않는다. 카메라가 한 무리를 따라다닌다.
  const game = new Game(layout.width * MAP_SCALE, layout.height * MAP_SCALE, MAP_SCALE * MAP_SCALE);

  // 디버그: URL 에 ?seed=… 가 있으면 그 시드로 고정(맵·카드·보스 완전 재현). 없으면 런마다 랜덤.
  const seedParam = new URLSearchParams(window.location.search).get("seed");
  if (seedParam) game.fixedSeed = seedParam;

  // 개인 카메라(방향 전환 2단계) — 탭으로 고른 한 개체를 따라가며 클로즈업한다(소수 개체 애착의 핵심).
  let selectedId: number | null = null; // 따라가는 개체 id(없으면 무리 추적)
  let currentSelected: Entity | null = null; // 이번 프레임의 선택 개체(카메라가 읽음)
  const INDIVIDUAL_ZOOM = 2.6; // 개체 추적 시 줌 배율(클로즈업)

  // 미니맵 드래그 카메라 — 미니맵을 누르거나 끌면 그 지점으로 카메라를 수동 이동(맵 탐색·조망).
  let manualCam: { x: number; y: number } | null = null;
  minimap.onPan = (wx, wy) => {
    manualCam = { x: wx, y: wy };
    selectedId = null; // 수동 조망 중엔 개체 추적 해제
  };

  const buildPanel = createBuildPanel();
  const refreshBuild = (): void => {
    buildPanel.setData({
      headline: describeSpecies(game.genome),
      traits: game.genome.traits,
      cards: game.pickedCardNames,
    });
  };
  refreshBuild();

  const glossary = createGlossary(); // 용어 사전(로비·일시정지에서 열기)

  const draft = createDraftPanel((i) => {
    game.pickCard(i);
    refreshBuild(); // 방금 고른 카드를 빌드 패널(설계도=최신 게놈)에 반영
    // 세대별 형질: 텍스처를 새로 만들지 않는다 — 이미 태어난 개체는 옛 모습을 유지하고, 이후 태어난
    // 개체가 새 게놈 서명으로 lazy 생성된다(worldView.textureFor). refreshSpecies(전체 교체)는 안 부른다.
    draft.hide();
  });
  // 시작 프리셋은 캐릭터 선택 창으로(외형 미리보기 + 화살표로 페이지 넘기며 선택).
  const presetPanel = createPresetPanel(app.renderer, (i) => {
    game.pickCard(i);
    refreshBuild();
    presetPanel.hide();
  });
  const result = createResultPanel(
    () => {
      // 새 종으로 다시 시작(완전 리셋).
      result.hide();
      game.beginRun();
      refreshBuild();
      view.refreshSpecies(game.world);
      controls.setVisible(true);
    },
    () => {
      // 승리 후 "다음 시대로" — 성장 유지, 위협 강화. 새 월드는 continueToNextEra 가 만든다.
      result.hide();
      game.continueToNextEra();
      refreshBuild();
      controls.setVisible(true);
    },
  );
  const lobby = createLobby(() => {
    lobby.hide();
    game.beginRun();
    refreshBuild();
    view.refreshSpecies(game.world);
    controls.setVisible(true);
  }, () => glossary.show());
  const controls = createControls({
    onPauseToggle: () => {
      game.paused = !game.paused;
      controls.setPaused(game.paused);
    },
    onSpeedCycle: () => {
      game.speed = game.speed >= 3 ? 1 : game.speed + 1;
      controls.setSpeed(game.speed);
    },
    onResume: () => {
      game.paused = false;
      controls.setPaused(false);
    },
    onRestart: () => {
      game.paused = false;
      controls.setPaused(false);
      game.beginRun();
      view.refreshSpecies(game.world);
    },
    onLobby: () => {
      game.paused = false;
      controls.setPaused(false);
      controls.setVisible(false);
      game.toLobby();
      lobby.show();
    },
    onGlossary: () => glossary.show(),
  });

  game.onDraft = (cards, preview) => {
    // 시작 프리셋 선택은 캐릭터 선택 창, 레벨업 형질은 일반 카드 창.
    if (game.isChoosingPreset) presetPanel.show(cards, preview);
    else draft.show(cards, preview);
  };
  game.onResult = (res, summary, canContinue, newUnlocks) => {
    controls.setVisible(false);
    result.show(res === "win", summary, canContinue, newUnlocks);
  };
  game.onWorldChanged = (world) => {
    view.drawEnvironment(world);
    view.refreshSpecies(world);
    hud.reset();
    effects.clear();
    selectedId = null; // 새 월드 → 옛 선택(개체 id)은 무효
    currentSelected = null;
    manualCam = null; // 수동 조망도 초기화
    // 재현용: 이 맵의 시드를 콘솔에 남긴다(?seed=… 로 다시 불러올 수 있음).
    console.info(`[seed] ${game.seed}  (재현: ?seed=${game.seed})`);
  };

  game.start(); // 로비 진입
  lobby.show();

  // 떨림 진단 배지 — 디버그 파라미터(?norot/?nointerp/?showalpha/?dz/?rotk)가 있을 때만 표시.
  // HTML 오버레이로 좌하단·높은 z-index 에 둬서, 우상단 패널들에 가리지 않고 dz 값이 보이게 한다.
  let debugBadge: HTMLDivElement | null = null;
  if (DEBUG_ACTIVE) {
    debugBadge = document.createElement("div");
    debugBadge.style.cssText =
      "position:fixed; left:8px; bottom:8px; z-index:30; padding:6px 9px;" +
      "background:rgba(11,14,20,0.9); border:1px solid #4a4030; border-radius:8px;" +
      "color:#ffe08a; font-family:system-ui,-apple-system,sans-serif; font-size:13px;" +
      "font-weight:700; pointer-events:none; user-select:none;";
    document.body.appendChild(debugBadge);
  }

  // ?dev — 위협 소환 패널(접이식). 관전 중 아무 보스/시련/대멸종을 즉시 띄워 반복 플레이 없이 확인.
  // 평소엔 우하단 "dev" 토글만 작게 두고, 탭하면 버튼 그리드가 펼쳐진다(모바일 화면을 안 가리게).
  if (DEBUG.devSummon) {
    const panel = document.createElement("div");
    panel.style.cssText =
      "position:fixed; right:6px; bottom:52px; z-index:31; display:flex; flex-direction:column;" +
      "align-items:flex-end; gap:4px; pointer-events:none;";
    const grid = document.createElement("div");
    grid.style.cssText =
      "display:none; flex-wrap:wrap; gap:4px; justify-content:flex-end; max-width:80vw;";
    const threats: { kind: BossType | ExtinctionType; label: string }[] = [
      ...BOSS_TYPES.map((t) => ({ kind: t as BossType | ExtinctionType, label: bossName(t) })),
      { kind: "cold", label: "한파" },
      { kind: "famine", label: "가뭄" },
      { kind: "heat", label: "폭염" },
      { kind: "plague", label: "역병" },
    ];
    for (const th of threats) {
      const btn = document.createElement("button");
      btn.textContent = th.label;
      btn.style.cssText =
        "pointer-events:auto; padding:6px 9px; background:rgba(11,14,20,0.92); border:1px solid" +
        " #4a4030; border-radius:7px; color:#ffe08a; font:700 12px system-ui,-apple-system;";
      btn.addEventListener("click", () => game.debugSummon(th.kind));
      grid.appendChild(btn);
    }
    const toggle = document.createElement("button");
    toggle.textContent = "dev ▾";
    toggle.style.cssText =
      "pointer-events:auto; padding:5px 11px; background:rgba(11,14,20,0.92); border:1px solid" +
      " #4a4030; border-radius:7px; color:#ffe08a; font:700 12px system-ui,-apple-system;";
    toggle.addEventListener("click", () => {
      const open = grid.style.display === "none";
      grid.style.display = open ? "flex" : "none";
      toggle.textContent = open ? "dev ▴" : "dev ▾";
    });
    panel.appendChild(grid);
    panel.appendChild(toggle);
    document.body.appendChild(panel);
  }

  // 카메라(평상시 내 무리 추적, 보스 땐 보스 추적 줌) + 하이라이트 이벤트 감지 상태
  let camX = game.width / 2;
  let camY = game.height / 2;
  let camZoom = 1;
  let prevBoss = false;
  let prevExt = "";
  let prevLowWarn = false;
  let prevLevel = game.level;
  let prevThreat: string | null = null;

  // 선택 개체 정보 카드(좌하단). 닫기(✕)=선택 해제, ‹ ›=같은 무리의 다른 개체로 포커스 이동.
  const creatureCard = createCreatureCard({
    onClose: () => {
      selectedId = null;
    },
    onPrev: () => cycleSelection(-1),
    onNext: () => cycleSelection(1),
  });

  // 월드 탭 → 가장 가까운 개체를 골라 따라간다. 같은 개체를 다시 탭하거나 빈 곳을 탭하면 선택 해제.
  // 월드 레이어는 hit-test 에서 빼(none) 탭이 stage 까지 통과하게 한다 → 개체는 좌표로 직접 찾는다
  // (스프라이트는 풀 재사용이라 개체와 1:1 이 아니므로 스프라이트 이벤트 대신 좌표 + 최근접 탐색).
  view.container.eventMode = "none";
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  app.stage.on("pointertap", (e) => {
    if (game.phase !== "watch" && game.phase !== "draft") return;
    // 빈 월드 탭만 처리 — 범례 등 누를 수 있는 UI 가 잡은 탭(target≠stage)은 그 UI 몫이라 건너뛴다.
    if (e.target !== app.stage) return;
    // 미니맵 위 탭은 조망 조작이라 개체 선택에서 제외(뒤의 개체가 잡히지 않게).
    if (minimap.container.visible && minimap.containsScreenPoint(e.global.x, e.global.y)) return;
    // 화면 좌표 → 월드 좌표(카메라/뷰포트 변환을 toLocal 이 한 번에 풀어 준다).
    const p = view.container.toLocal(e.global);
    const picked = pickEntity(p.x, p.y);
    manualCam = null; // 화면 탭 = 수동 조망 종료(개체 추적 또는 빈 곳이면 무리 복귀)
    selectedId = !picked || picked.id === selectedId ? null : picked.id;
  });

  app.ticker.add((ticker) => {
    game.update(ticker.deltaMS);
    // 개인 카메라: 선택 개체를 해석(죽었으면 작별, 관전 아니면 해제) → 강조 고리·카드·카메라에 반영.
    resolveSelection();
    view.sync(game.world, game.interpAlpha, ticker.deltaMS);
    // 사건 연출: sim 이 이번 프레임에 emit 한 사건(탄생/죽음/잡아먹힘)을 효과로 옮기고 비운다.
    for (const ev of game.world.events) effects.spawn(ev.kind, ev.x, ev.y);
    game.world.events.length = 0;
    effects.update(ticker.deltaMS);
    hud.sync(game.world, statusLine(), game.level, game.xpProgress, game.timeline, app.screen.width);
    buildPanel.setVisible(game.phase === "draft" || game.phase === "watch");

    updateCamera(ticker.deltaMS);
    // 미니맵 — 관전/드래프트 중에만(로비 제외). 카메라 뷰포트는 화면(layout)/줌 기준.
    minimap.container.visible = game.phase !== "lobby";
    if (minimap.container.visible) {
      minimap.sync(game.world, camX, camY, camZoom, layout.width, layout.height);
      minimap.place(app.screen.width, app.screen.height);
    }
    detectEvents();
    highlights.update(ticker.deltaMS, app.screen.width);
    threatBanner.update(ticker.deltaMS, app.screen.width, app.screen.height);

    if (debugBadge) {
      let txt = `디버그: ${debugLabel()}`;
      if (DEBUG.showAlpha) txt += `  α=${game.interpAlpha.toFixed(2)}`;
      debugBadge.textContent = txt;
    }
  });

  function updateCamera(dtMS: number): void {
    const boss = game.world.boss;
    const focusBoss = game.phase === "watch" && boss !== null;
    // 우선순위: 고른 개체(클로즈업) > 보스 관전(줌인) > 평상시 내 무리 무게중심.
    let tx: number;
    let ty: number;
    let tz: number;
    if (currentSelected) {
      // 개체의 부드러운 렌더 위치를 따라가 떨림 없이 클로즈업한다(sim 위치는 고주파 진동이 있다).
      const dp = view.getDisplayPos(currentSelected.id);
      tx = dp ? dp.x : currentSelected.x;
      ty = dp ? dp.y : currentSelected.y;
      tz = INDIVIDUAL_ZOOM;
    } else if (manualCam) {
      // 미니맵으로 옮긴 수동 조망 위치(넓게 보도록 줌 1). 개체·빈 곳 탭으로 해제된다.
      tx = manualCam.x;
      ty = manualCam.y;
      tz = 1;
    } else if (focusBoss && boss) {
      tx = boss.x;
      ty = boss.y;
      tz = 1.35;
    } else {
      const centroid = game.world.playerCentroid();
      tx = centroid.x;
      ty = centroid.y;
      tz = 1;
    }
    const k = Math.min(1, (dtMS / 1000) * 3.5); // 시간 기반 이징
    camX += (tx - camX) * k;
    camY += (ty - camY) * k;
    camZoom += (tz - camZoom) * k;
    // 월드(game.width/height)와 화면(layout) 분리 — 큰 월드의 일부만 화면에 보여준다.
    view.setCamera(camX, camY, camZoom, game.width, game.height, layout.width, layout.height);
  }

  // 월드 좌표에서 가장 가까운 개체를 고른다(화면상 일정한 탭 반경). 닿는 개체가 없으면 null.
  function pickEntity(wx: number, wy: number): Entity | null {
    // 줌이 클수록 더 좁은 월드 반경 = 화면상 탭 반경 일정. 폰 손가락 기준 넉넉히, 최소 바닥값 유지.
    const r = Math.max(16, 38 / Math.max(0.6, camZoom));
    let best: Entity | null = null;
    let bestSq = r * r;
    for (const en of game.world.entities) {
      const dx = en.x - wx;
      const dy = en.y - wy;
      const d = dx * dx + dy * dy;
      if (d < bestSq) {
        bestSq = d;
        best = en;
      }
    }
    return best;
  }

  // 카드의 ‹ › — 현재 선택 개체와 같은 무리(종) 안에서 이전/다음 개체로 포커스를 옮긴다(id 순환).
  function cycleSelection(dir: number): void {
    if (selectedId === null) return;
    const cur = game.world.entities.find((en) => en.id === selectedId);
    if (!cur) return;
    const same = game.world.entities
      .filter((en) => en.species.id === cur.species.id)
      .sort((a, b) => a.id - b.id);
    const idx = same.findIndex((en) => en.id === selectedId);
    if (idx < 0) return;
    const next = same[(idx + dir + same.length) % same.length];
    if (next) {
      selectedId = next.id;
      manualCam = null; // 개체 추적으로 전환(수동 조망 해제)
    }
  }

  // 선택 개체를 매 프레임 해석한다 — 죽었으면 작별 인사 후 해제, 관전 단계가 아니면 해제.
  // 그 결과를 강조 고리(view) · 정보 카드 · 카메라(currentSelected)에 일관되게 반영한다.
  function resolveSelection(): void {
    if (game.phase !== "watch" && game.phase !== "draft") {
      selectedId = null;
      manualCam = null;
    }
    currentSelected = null;
    if (selectedId !== null) {
      const found = game.world.entities.find((en) => en.id === selectedId) ?? null;
      if (!found) {
        // 따라가던 아이가 죽었다 — 작별 인사 한 번 띄우고 무리 시점으로 돌아간다(애착의 무게).
        highlights.flash(`${creatureName(selectedId)} 떠남`, 0xffd089);
        selectedId = null;
      } else {
        currentSelected = found;
      }
    }
    view.setSelected(selectedId);
    if (currentSelected) {
      const en = currentSelected;
      creatureCard.update({
        name: creatureName(en.id),
        speciesName: en.species.name,
        isPlayer: en.species.isPlayer,
        color: en.species.color,
        energy: en.energy / SIM.maxEnergy,
        ageSeconds: en.age / SIM.stepsPerSecond,
        sizeText: sizeWord(en.id),
        activity: en.targetPrey ? "사냥하는 중" : en.targetFood ? "먹이로 가는 중" : "돌아다니는 중",
        descriptor: describeSpecies(en.genome),
        traits: en.genome.traits,
      });
    } else {
      creatureCard.update(null);
    }
  }

  function detectEvents(): void {
    const w = game.world;
    const bossNow = w.boss !== null;
    if (bossNow && !prevBoss && w.boss) {
      // 개체형=보스, 전역 재난=시련으로 알린다(시각·용어 일치).
      const kind = isPredatorBoss(w.boss.type) ? "보스" : "시련";
      highlights.flash(`${kind} · ${w.boss.name}`, 0xff6a4a);
    }
    // 위협(보스/시련)이 사라진 순간 = 넘긴 것(단계 전환에 드래프트가 없으니 phase 대신 boss 유무로).
    if (prevBoss && !bossNow) highlights.flash("위협을 넘겼습니다", 0x6cc24a);
    prevBoss = bossNow;

    const ext = w.globalCold > 0 ? "한파" : w.heat > 0 ? "폭염" : w.foodRegrowMultiplier > 1 ? "대가뭄" : "";
    if (ext && ext !== prevExt) highlights.flash(`대멸종 — ${ext}`, 0x8ab4ff);
    prevExt = ext;

    const pop = w.playerPopulation;
    if (game.phase === "watch" && pop > 0 && pop <= 5) {
      if (!prevLowWarn) highlights.flash("멸종 위기!", 0xffba3a);
      prevLowWarn = true;
    } else if (pop > 9) {
      prevLowWarn = false;
    }

    // 레벨업 — 경험치가 차 새 형질을 고르는 순간(드래프트 팝업과 함께 눈에 띄게).
    if (game.level > prevLevel) highlights.flash(`레벨 ${game.level} 달성!`, 0xffd24a);
    prevLevel = game.level;

    // 위협 예고 전광판 — 위협 직전에 종류·대응 힌트를 크게 띄운다(같은 예고는 중복 표시 안 함).
    const threat = game.upcomingThreat;
    const threatKey = threat ? threat.title : null;
    if (threat && threatKey !== prevThreat) threatBanner.show(threat.title, threat.sub);
    prevThreat = threatKey;
  }

  function statusLine(): string {
    if (game.phase === "lobby") return "";
    const env = game.environmentSummary();
    const s = `${game.stageNumber}/${game.totalStages}`;
    // 모바일에서 한 줄이 길어 잘리던 문제 → 2줄(단계·시간 / 환경)로 나눈다.
    if (game.phase === "draft") return `단계 ${s} · 카드 선택\n${env}`;
    // 관전 첫 줄은 무슨 단계인지(시련/보스 이름)만 둔다 — 단계 번호(N/M)는 타임라인 막대가 대신
    // 보여줘 중복이고, 긴 시련 이름(그림자 매복자 등)이 우상단 낮밤 타이머와 겹치지 않게 짧게 유지한다.
    if (game.phase === "watch") {
      // 시대(era>0)면 "시대 N ·" 접두어로 지금 몇 번째 시대인지 보인다(첫 시대는 빈 문자열이라 변화 없음).
      const eraPre = game.eraLabel ? `${game.eraLabel} · ` : "";
      return `${eraPre}${game.stageLabel}\n${game.secondsLeft}초${game.paused ? " (멈춤)" : ""} · ${env}`;
    }
    return env;
  }
}

boot().catch((err: unknown) => {
  console.error("부트 실패:", err);
});
