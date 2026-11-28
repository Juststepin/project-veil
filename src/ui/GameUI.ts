import { GameEngine } from '../core/GameEngine';
import { getRoomGridSize, type Direction } from '../core/grid';
import type { ClassId, GameEvent, PlayerAction, RaceId } from '../core/types';
import {
  GLITCH_DURATION_MS,
  PerceptionService,
  type CodexEntryDefinition,
  type DisplayBuildOptions,
  type DisplayItem,
  type DisplayLogEntry,
} from '../perception/PerceptionService';
import { CanvasRenderer } from './CanvasRenderer';
import { SoundService } from './SoundService';
import { formatBuildCompletionKey, StorageService } from './StorageService';
import { shouldEnableVeilQaHook } from './veilHook';

const MAX_LOG_LINES = 25;
const LOG_SYNC_FLASH_MS = 500;

interface LogRecord {
  id: number;
  entry: DisplayLogEntry;
  resolved: boolean;
  isTurnStart: boolean;
}

function formatStatDelta(hpBonus: number, atkBonus: number): string {
  const hpPart = `${hpBonus >= 0 ? '+' : ''}${hpBonus} Max HP`;
  const atkPart = `${atkBonus >= 0 ? '+' : ''}${atkBonus} ATK`;
  return `${hpPart} · ${atkPart}`;
}

const GUIDE_LIST_HTML = `
  <ul class="guide-list">
    <li><strong>Chỉ số:</strong> <strong>HP</strong> là máu, <strong>ATK</strong> là điểm tấn công. <strong>Độ Tỉnh Táo:</strong> mức nhận thức sự bất thường xung quanh khi khám phá.</li>
    <li><strong>Di chuyển &amp; Tương tác:</strong> Bấm mũi tên, chạm ô sáng liền kề hoặc dùng phím mũi tên / WASD. Bước vào <strong>ô thực thể</strong> để tương tác, bước vào <strong>cửa D</strong> để qua phòng.</li>
    <li><strong>Quan sát &amp; Chờ lượt:</strong> Chạm vào <strong>thực thể ở xa</strong> để xem nhanh chỉ số (không tốn lượt); khi giao chiến gần, chỉ số mục tiêu tự ghim dưới bản đồ. Bấm <strong>Chờ</strong> (hoặc Space / chạm ô của ngươi) để qua 1 lượt hoặc giữ thế thủ.</li>
    <li><strong>Hành trang (tốn 1 lượt):</strong> Bước lên <strong>ô vàng</strong> để nhặt đồ; chạm tên vật phẩm bên dưới để xem mô tả và bấm <strong>Sử dụng</strong> hồi máu (việc dùng vật phẩm <strong>tốn 1 lượt</strong>).</li>
    <li><strong>Mẹo chơi:</strong> Theo dõi kỹ <strong>Nhật ký hành động</strong> ngay dưới bản đồ. Có thể bấm <strong>Đổi Build</strong> trên thanh tiêu đề để thử tổ hợp Chủng tộc &amp; Lớp nghề khác.</li>
  </ul>
`;

export class GameUI {
  private root: HTMLElement;
  private engine: GameEngine;
  private perception: PerceptionService;
  private storage: StorageService;
  private sound: SoundService;
  private readonly isQaDebugEnabled: boolean;
  private renderer!: CanvasRenderer;

  private shellEl!: HTMLElement;
  private buildScreenEl!: HTMLElement;
  private buildAudioBtnEl!: HTMLButtonElement;
  private buildGuideToggleBtnEl!: HTMLButtonElement;
  private buildGuidePanelEl!: HTMLElement;
  private buildTitleEl!: HTMLElement;
  private codexTitleEl!: HTMLElement;
  private codexBuildsEl!: HTMLElement;
  private codexListEl!: HTMLElement;
  private buildRaceLabelEl!: HTMLElement;
  private buildRaceListEl!: HTMLElement;
  private buildClassLabelEl!: HTMLElement;
  private buildClassListEl!: HTMLElement;
  private buildCompletedBadgeEl!: HTMLElement;
  private buildSummaryStatsEl!: HTMLElement;
  private buildStartBtnEl!: HTMLButtonElement;
  private buildCancelBtnEl!: HTMLButtonElement;

  private gameplayViewEl!: HTMLElement;
  private gameplayPhaseTagEl!: HTMLElement;
  private audioToggleBtnEl!: HTMLButtonElement;
  private headerBuildBtnEl!: HTMLButtonElement;
  private guideToggleBtnEl!: HTMLButtonElement;
  private guidePanelEl!: HTMLElement;
  private statusBannerEl!: HTMLElement;
  private roomNameEl!: HTMLElement;
  private hpTextEl!: HTMLElement;
  private hpBarFillEl!: HTMLElement;
  private hudRowSecondaryEl!: HTMLElement;
  private buildHudEl!: HTMLElement;
  private atkBadgeEl!: HTMLElement;
  private riposteBadgeEl!: HTMLElement;
  private lucidityHudEl!: HTMLElement;
  private veilStatusEl!: HTMLElement;

  private boardSectionEl!: HTMLElement;
  private canvasEl!: HTMLCanvasElement;
  private legendRowEl!: HTMLElement;
  private legendEntityEl!: HTMLElement;
  private legendBossEl!: HTMLElement;
  private legendTalkableEl!: HTMLElement;
  private legendObjectEl!: HTMLElement;
  private inspectCardEl!: HTMLElement;
  private inspectTextEl!: HTMLElement;
  private inspectStatusEl!: HTMLElement;
  private inspectCloseBtnEl!: HTMLButtonElement;
  private lastRenderedGridSize = 8;

  private logSectionEl!: HTMLElement;
  private logListEl!: HTMLUListElement;
  private gameOverBannerEl!: HTMLElement;
  private controlsSectionEl!: HTMLElement;
  private dpadPanelEl!: HTMLElement;

  private filterChoicePanelEl!: HTMLElement;
  private filterChoiceTitleEl!: HTMLElement;
  private chooseKeepBtnEl!: HTMLButtonElement;
  private chooseKeepLabelEl!: HTMLElement;
  private chooseKeepNoteEl!: HTMLElement;
  private chooseBreakLabelEl!: HTMLElement;
  private chooseBreakNoteEl!: HTMLElement;

  private bossChoicePanelEl!: HTMLElement;
  private bossChoiceTitleEl!: HTMLElement;
  private bossSurrenderBtnEl!: HTMLButtonElement;
  private bossSurrenderLabelEl!: HTMLElement;
  private bossSurrenderNoteEl!: HTMLElement;
  private bossFightBtnEl!: HTMLButtonElement;
  private bossFightLabelEl!: HTMLElement;
  private bossFightNoteEl!: HTMLElement;

  private tribunalChoicePanelEl!: HTMLElement;
  private tribunalChoiceTitleEl!: HTMLElement;
  private tribunalChoiceActionsEl!: HTMLElement;

  private hubServicePanelEl!: HTMLElement;
  private hubServiceTitleEl!: HTMLElement;
  private hubServiceActionsEl!: HTMLElement;

  private endingPanelEl!: HTMLElement;
  private endingTitleEl!: HTMLElement;
  private endingCodexProgressEl!: HTMLElement;
  private endingBodyEl!: HTMLElement;

  private inventoryTitleEl!: HTMLElement;
  private inventoryListEl!: HTMLElement;
  private itemDetailEl!: HTMLElement;
  private debugBarEl!: HTMLElement;
  private debugLucidityBtnEl!: HTMLButtonElement;
  private resetBtnEl!: HTMLButtonElement;
  private controlButtons: HTMLButtonElement[] = [];

  private buildOptions!: DisplayBuildOptions;
  private codexDefs: CodexEntryDefinition[] = [];
  private isBuildScreenOpen = true;
  private canCancelBuildScreen = false;
  private hasStartedFirstRun = false;
  private draftRaceId: RaceId = 'human';
  private draftClassId: ClassId = 'brawler';

  private logRecords: LogRecord[] = [];
  private nextLogId = 1;
  private selectedItemId: string | null = null;
  private pendingTimers: number[] = [];
  private recentLucidityGain = 0;
  private lucidityPulseTimerId: number | null = null;
  private logSyncFlashTimer: number | null = null;
  private lastGlitchPulseAt = 0;
  private wasFilterChoiceOpen = false;
  private wasBossChoiceOpen = false;
  private wasTribunalChoiceOpen = false;
  private wasHubServiceOpen = false;

  private manualInspectEntityId: string | null;
  private pinnedCombatEntityId: string | null = null;
  private dismissedPinnedEntityForTurn = false;
  private isInspectGlitchFlashing = false;
  private inspectGlitchTimer: number | null = null;

  constructor(
    root: HTMLElement,
    engine: GameEngine,
    perception: PerceptionService,
    storage = new StorageService(),
    sound = new SoundService(storage.isMuted()),
  ) {
    this.root = root;
    this.engine = engine;
    this.perception = perception;
    this.storage = storage;
    this.sound = sound;
    this.isQaDebugEnabled = shouldEnableVeilQaHook();
    this.manualInspectEntityId = null;
  }

  mount(): void {
    this.buildOptions = this.perception.getBuildOptions();
    this.codexDefs = this.perception.getCodexDefinitions();
    const initialState = this.engine.getState();
    this.draftRaceId = initialState.selectedRaceId;
    this.draftClassId = initialState.selectedClassId;
    this.seedInitialRoomLog();

    this.root.innerHTML = `
      <div class="game-shell" data-mode="illusion">
        <section
          id="build-screen"
          class="build-screen"
          role="dialog"
          aria-label="Khởi tạo Hồ sơ Triệu hồi"
        >
          <header class="build-header">
            <div class="brand-row">
              <div class="brand-heading">
                <h1 class="game-title">Project VEIL</h1>
                <span class="phase-tag">v0.5 · 8×8</span>
              </div>
              <div class="header-actions">
                <button
                  id="btn-build-audio"
                  class="guide-toggle-btn audio-toggle-btn"
                  type="button"
                ></button>
                <button
                  id="btn-build-guide"
                  class="guide-toggle-btn"
                  type="button"
                  aria-expanded="false"
                  aria-controls="build-guide-panel"
                >
                  ? Hướng dẫn
                </button>
              </div>
            </div>
            <section
              id="build-guide-panel"
              class="guide-panel"
              aria-label="Hướng dẫn chơi nhanh"
              hidden
            >
              ${GUIDE_LIST_HTML}
            </section>
            <p id="build-screen-title" class="build-screen-title"></p>
            <p class="build-lucidity-note">
              Độ Tỉnh Táo: mức nhận thức sự bất thường xung quanh khi khám phá.
            </p>
          </header>

          <section
            id="codex-panel"
            class="codex-panel"
            aria-label="Hồ sơ Kết cục"
          >
            <div class="codex-header">
              <strong id="codex-title" class="codex-title"></strong>
              <span id="codex-builds" class="codex-builds"></span>
            </div>
            <div id="codex-list" class="codex-list"></div>
          </section>

          <div class="build-group">
            <h2 id="build-race-label" class="build-group-title"></h2>
            <div id="build-race-list" class="build-option-list"></div>
          </div>

          <div class="build-group build-class-group">
            <h2 id="build-class-label" class="build-group-title"></h2>
            <div id="build-class-list" class="build-option-list"></div>
          </div>

          <footer class="build-footer">
            <div class="build-summary-bar">
              <span class="build-summary-caption">Chỉ số xuất phát</span>
              <div class="build-summary-right">
                <span id="build-completed-badge" class="build-completed-badge" hidden>
                  ✓ Đã vượt màn
                </span>
                <strong id="build-summary-stats" class="build-summary-stats"></strong>
              </div>
            </div>
            <div class="build-footer-actions">
              <button
                id="btn-build-cancel"
                class="action-btn build-cancel-btn"
                type="button"
                hidden
              >
                Quay lại
              </button>
              <button id="btn-build-start" class="build-start-btn" type="button"></button>
            </div>
          </footer>
        </section>

        <div id="gameplay-view" class="gameplay-view" hidden>
          <header class="top-bar">
            <div class="brand-row">
              <div class="brand-heading">
                <span class="game-title">Project VEIL</span>
                <span id="gameplay-phase-tag" class="phase-tag">v0.5 · 8×8</span>
              </div>
              <div class="header-actions">
                <button
                  id="btn-toggle-audio"
                  class="guide-toggle-btn audio-toggle-btn"
                  type="button"
                ></button>
                <button id="btn-header-build" class="guide-toggle-btn" type="button">
                  Đổi Build
                </button>
                <button
                  id="btn-toggle-guide"
                  class="guide-toggle-btn"
                  type="button"
                  aria-expanded="false"
                  aria-controls="guide-panel"
                >
                  ? Hướng dẫn
                </button>
              </div>
            </div>
            <section id="guide-panel" class="guide-panel" aria-label="Hướng dẫn chơi nhanh" hidden>
              ${GUIDE_LIST_HTML}
            </section>
            <p id="status-banner" class="status-banner" role="status"></p>
            <div class="hud-strip" aria-label="Trạng thái phòng, máu, chỉ số và Màn Che">
              <div class="hud-row hud-row-primary">
                <span id="room-name" class="room-name"></span>
                <div class="hp-group">
                  <span id="hp-text" class="hp-text"></span>
                  <div class="hp-track" aria-hidden="true">
                    <div id="hp-bar-fill" class="hp-fill"></div>
                  </div>
                </div>
              </div>
              <div class="hud-row hud-row-build">
                <span id="build-hud" class="hud-build"></span>
              </div>
              <div id="hud-row-secondary" class="hud-row hud-row-secondary">
                <span id="atk-badge" class="hud-pill hud-atk"></span>
                <span id="riposte-badge" class="hud-pill hud-riposte" hidden></span>
                <span id="lucidity-hud" class="hud-pill hud-lucidity"></span>
                <span id="veil-status" class="hud-pill hud-veil"></span>
              </div>
            </div>
          </header>

          <section id="board-section" class="board-section" aria-label="Bản đồ lưới chiến thuật">
            <div class="canvas-frame">
              <canvas id="game-canvas" aria-label="Bản đồ chiến thuật"></canvas>
            </div>
            <div id="board-info-slot" class="board-info-slot">
              <div id="legend-row" class="legend-row" aria-hidden="true">
                <div class="legend-items">
                  <span class="legend-item"><i class="swatch swatch-player"></i>Ngươi</span>
                  <span id="legend-entity" class="legend-item"><i class="swatch swatch-entity"></i>Thực thể</span>
                  <span id="legend-boss" class="legend-item" hidden><i class="swatch swatch-boss"></i>Boss</span>
                  <span id="legend-talkable" class="legend-item" hidden><i class="swatch swatch-talkable"></i>Giao tiếp</span>
                  <span id="legend-object" class="legend-item" hidden><i class="swatch swatch-object"></i>Bia đá</span>
                  <span class="legend-item"><i class="swatch swatch-item"></i>Vật phẩm</span>
                  <span class="legend-item"><i class="swatch swatch-obstacle"></i>Vật cản</span>
                  <span class="legend-item"><i class="swatch swatch-door">D</i>Cửa</span>
                </div>
                <span class="legend-hint">Chạm thực thể ở xa để xem HP/ATK (không tốn lượt)</span>
              </div>
              <div id="inspect-card" class="inspect-card" role="status" aria-live="polite" hidden>
                <div class="inspect-main">
                  <span id="inspect-text" class="inspect-text"></span>
                  <span id="inspect-status" class="inspect-status"></span>
                </div>
                <button
                  id="btn-inspect-close"
                  class="inspect-close-btn"
                  type="button"
                  aria-label="Đóng thẻ quan sát"
                >
                  ×
                </button>
              </div>
            </div>
          </section>

          <section id="log-section" class="log-section" aria-label="Nhật ký hành động">
            <div class="section-header">
              <span>NHẬT KÝ HÀNH ĐỘNG</span>
              <span class="section-meta">Mới nhất ở trên · 25 dòng</span>
            </div>
            <ul id="combat-log" class="combat-log" aria-live="polite"></ul>
          </section>

          <section id="gameover-banner" class="gameover-banner" role="alert" hidden>
            <span class="gameover-title">NGƯƠI ĐÃ GỤC NGÃ</span>
            <div class="panel-dual-actions">
              <button id="btn-gameover-build" class="action-btn" type="button">
                Đổi Build
              </button>
              <button id="btn-gameover-reset" class="action-btn action-danger" type="button">
                Chơi lại
              </button>
            </div>
          </section>

          <section id="controls-section" class="controls-section" aria-label="Điều hướng một tay">
            <div id="dpad-panel" class="dpad">
              <button id="btn-up" class="dpad-btn dpad-up" type="button" data-dir="up" aria-label="Đi lên">▲</button>
              <button id="btn-left" class="dpad-btn dpad-left" type="button" data-dir="left" aria-label="Sang trái">◀</button>
              <button id="btn-wait" class="dpad-btn dpad-wait" type="button" aria-label="Chờ 1 lượt">Chờ</button>
              <button id="btn-right" class="dpad-btn dpad-right" type="button" data-dir="right" aria-label="Sang phải">▶</button>
              <button id="btn-down" class="dpad-btn dpad-down" type="button" data-dir="down" aria-label="Đi xuống">▼</button>
            </div>

            <div
              id="filter-choice-panel"
              class="choice-panel"
              role="dialog"
              tabindex="-1"
              aria-label="Bước ngoặt Nhận thức"
              hidden
            >
              <p id="filter-choice-title" class="choice-title"></p>
              <div class="choice-actions">
                <button id="btn-choose-keep" class="choice-btn choice-keep" type="button">
                  <strong id="choose-keep-label" class="choice-btn-label"></strong>
                  <span id="choose-keep-note" class="choice-btn-note"></span>
                </button>
                <button id="btn-choose-break" class="choice-btn choice-break" type="button">
                  <strong id="choose-break-label" class="choice-btn-label"></strong>
                  <span id="choose-break-note" class="choice-btn-note"></span>
                </button>
              </div>
            </div>

            <div
              id="boss-choice-panel"
              class="choice-panel boss-choice-panel"
              role="dialog"
              tabindex="-1"
              aria-label="Đối đầu Trạm Kiểm Soát"
              hidden
            >
              <p id="boss-choice-title" class="choice-title boss-choice-title"></p>
              <div class="choice-actions">
                <button id="btn-boss-surrender" class="choice-btn choice-break" type="button">
                  <strong id="boss-surrender-label" class="choice-btn-label"></strong>
                  <span id="boss-surrender-note" class="choice-btn-note"></span>
                </button>
                <button id="btn-boss-fight" class="choice-btn choice-fight" type="button">
                  <strong id="boss-fight-label" class="choice-btn-label"></strong>
                  <span id="boss-fight-note" class="choice-btn-note"></span>
                </button>
              </div>
            </div>

            <div
              id="tribunal-choice-panel"
              class="choice-panel tribunal-choice-panel"
              role="dialog"
              tabindex="-1"
              aria-label="Phán quyết Pháp Đình"
              hidden
            >
              <p id="tribunal-choice-title" class="choice-title tribunal-choice-title"></p>
              <div id="tribunal-choice-actions" class="choice-actions"></div>
            </div>

            <div
              id="hub-service-panel"
              class="choice-panel hub-service-panel"
              role="dialog"
              tabindex="-1"
              aria-label="Dịch vụ khu vực"
              hidden
            >
              <p id="hub-service-title" class="choice-title hub-service-title"></p>
              <div id="hub-service-actions" class="choice-actions"></div>
            </div>

            <div id="ending-panel" class="ending-panel" role="region" aria-label="Kết cục" hidden>
              <div class="ending-header">
                <strong id="ending-title" class="ending-title"></strong>
                <div class="panel-dual-actions">
                  <button id="btn-ending-build" class="action-btn action-accent" type="button">
                    Đổi Build
                  </button>
                  <button id="btn-ending-reset" class="action-btn" type="button">
                    Chơi lại
                  </button>
                </div>
              </div>
              <p id="ending-codex-progress" class="ending-codex-progress"></p>
              <p id="ending-body" class="ending-body"></p>
            </div>
          </section>

          <footer class="bottom-panel">
            <div class="inventory-block">
              <div class="section-header">
                <span id="inventory-title">HÀNH TRANG</span>
                <span class="section-meta">Chạm vật phẩm để xem / dùng</span>
              </div>
              <div id="inventory-list" class="inventory-list"></div>
              <div id="item-detail" class="item-detail" hidden></div>
            </div>

            <div id="debug-bar" class="debug-bar">
              <div class="debug-actions">
                <button id="btn-debug-lucidity" class="action-btn action-accent" type="button">
                  +15 Tỉnh táo
                </button>
                <button id="btn-reset" class="action-btn" type="button">
                  Chơi lại
                </button>
              </div>
            </div>
          </footer>
        </div>
      </div>
    `;

    this.shellEl = this.root.querySelector<HTMLElement>('.game-shell')!;
    this.buildScreenEl = this.root.querySelector<HTMLElement>('#build-screen')!;
    this.buildAudioBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-build-audio')!;
    this.buildGuideToggleBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-build-guide')!;
    this.buildGuidePanelEl =
      this.root.querySelector<HTMLElement>('#build-guide-panel')!;
    this.buildTitleEl = this.root.querySelector<HTMLElement>('#build-screen-title')!;
    this.codexTitleEl = this.root.querySelector<HTMLElement>('#codex-title')!;
    this.codexBuildsEl = this.root.querySelector<HTMLElement>('#codex-builds')!;
    this.codexListEl = this.root.querySelector<HTMLElement>('#codex-list')!;
    this.buildRaceLabelEl = this.root.querySelector<HTMLElement>('#build-race-label')!;
    this.buildRaceListEl = this.root.querySelector<HTMLElement>('#build-race-list')!;
    this.buildClassLabelEl = this.root.querySelector<HTMLElement>('#build-class-label')!;
    this.buildClassListEl = this.root.querySelector<HTMLElement>('#build-class-list')!;
    this.buildCompletedBadgeEl =
      this.root.querySelector<HTMLElement>('#build-completed-badge')!;
    this.buildSummaryStatsEl =
      this.root.querySelector<HTMLElement>('#build-summary-stats')!;
    this.buildStartBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-build-start')!;
    this.buildCancelBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-build-cancel')!;

    this.gameplayViewEl = this.root.querySelector<HTMLElement>('#gameplay-view')!;
    this.gameplayPhaseTagEl =
      this.root.querySelector<HTMLElement>('#gameplay-phase-tag')!;
    this.audioToggleBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-toggle-audio')!;
    this.headerBuildBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-header-build')!;
    this.guideToggleBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-toggle-guide')!;
    this.guidePanelEl = this.root.querySelector<HTMLElement>('#guide-panel')!;
    this.statusBannerEl = this.root.querySelector<HTMLElement>('#status-banner')!;
    this.roomNameEl = this.root.querySelector<HTMLElement>('#room-name')!;
    this.hpTextEl = this.root.querySelector<HTMLElement>('#hp-text')!;
    this.hpBarFillEl = this.root.querySelector<HTMLElement>('#hp-bar-fill')!;
    this.hudRowSecondaryEl =
      this.root.querySelector<HTMLElement>('#hud-row-secondary')!;
    this.buildHudEl = this.root.querySelector<HTMLElement>('#build-hud')!;
    this.atkBadgeEl = this.root.querySelector<HTMLElement>('#atk-badge')!;
    this.riposteBadgeEl = this.root.querySelector<HTMLElement>('#riposte-badge')!;
    this.lucidityHudEl = this.root.querySelector<HTMLElement>('#lucidity-hud')!;
    this.veilStatusEl = this.root.querySelector<HTMLElement>('#veil-status')!;

    this.boardSectionEl = this.root.querySelector<HTMLElement>('#board-section')!;
    this.canvasEl = this.root.querySelector<HTMLCanvasElement>('#game-canvas')!;
    this.legendRowEl = this.root.querySelector<HTMLElement>('#legend-row')!;
    this.legendEntityEl = this.root.querySelector<HTMLElement>('#legend-entity')!;
    this.legendBossEl = this.root.querySelector<HTMLElement>('#legend-boss')!;
    this.legendTalkableEl = this.root.querySelector<HTMLElement>('#legend-talkable')!;
    this.legendObjectEl = this.root.querySelector<HTMLElement>('#legend-object')!;
    this.inspectCardEl = this.root.querySelector<HTMLElement>('#inspect-card')!;
    this.inspectTextEl = this.root.querySelector<HTMLElement>('#inspect-text')!;
    this.inspectStatusEl = this.root.querySelector<HTMLElement>('#inspect-status')!;
    this.inspectCloseBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-inspect-close')!;

    this.logSectionEl = this.root.querySelector<HTMLElement>('#log-section')!;
    this.logListEl = this.root.querySelector<HTMLUListElement>('#combat-log')!;
    this.gameOverBannerEl = this.root.querySelector<HTMLElement>('#gameover-banner')!;
    this.controlsSectionEl = this.root.querySelector<HTMLElement>('#controls-section')!;
    this.dpadPanelEl = this.root.querySelector<HTMLElement>('#dpad-panel')!;

    this.filterChoicePanelEl =
      this.root.querySelector<HTMLElement>('#filter-choice-panel')!;
    this.filterChoiceTitleEl =
      this.root.querySelector<HTMLElement>('#filter-choice-title')!;
    this.chooseKeepBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-choose-keep')!;
    this.chooseKeepLabelEl = this.root.querySelector<HTMLElement>('#choose-keep-label')!;
    this.chooseKeepNoteEl = this.root.querySelector<HTMLElement>('#choose-keep-note')!;
    this.chooseBreakLabelEl =
      this.root.querySelector<HTMLElement>('#choose-break-label')!;
    this.chooseBreakNoteEl = this.root.querySelector<HTMLElement>('#choose-break-note')!;

    this.bossChoicePanelEl =
      this.root.querySelector<HTMLElement>('#boss-choice-panel')!;
    this.bossChoiceTitleEl =
      this.root.querySelector<HTMLElement>('#boss-choice-title')!;
    this.bossSurrenderBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-boss-surrender')!;
    this.bossSurrenderLabelEl =
      this.root.querySelector<HTMLElement>('#boss-surrender-label')!;
    this.bossSurrenderNoteEl =
      this.root.querySelector<HTMLElement>('#boss-surrender-note')!;
    this.bossFightBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-boss-fight')!;
    this.bossFightLabelEl =
      this.root.querySelector<HTMLElement>('#boss-fight-label')!;
    this.bossFightNoteEl =
      this.root.querySelector<HTMLElement>('#boss-fight-note')!;

    this.tribunalChoicePanelEl =
      this.root.querySelector<HTMLElement>('#tribunal-choice-panel')!;
    this.tribunalChoiceTitleEl =
      this.root.querySelector<HTMLElement>('#tribunal-choice-title')!;
    this.tribunalChoiceActionsEl =
      this.root.querySelector<HTMLElement>('#tribunal-choice-actions')!;

    this.hubServicePanelEl =
      this.root.querySelector<HTMLElement>('#hub-service-panel')!;
    this.hubServiceTitleEl =
      this.root.querySelector<HTMLElement>('#hub-service-title')!;
    this.hubServiceActionsEl =
      this.root.querySelector<HTMLElement>('#hub-service-actions')!;

    this.endingPanelEl = this.root.querySelector<HTMLElement>('#ending-panel')!;
    this.endingTitleEl = this.root.querySelector<HTMLElement>('#ending-title')!;
    this.endingCodexProgressEl =
      this.root.querySelector<HTMLElement>('#ending-codex-progress')!;
    this.endingBodyEl = this.root.querySelector<HTMLElement>('#ending-body')!;

    this.inventoryTitleEl = this.root.querySelector<HTMLElement>('#inventory-title')!;
    this.inventoryListEl = this.root.querySelector<HTMLElement>('#inventory-list')!;
    this.itemDetailEl = this.root.querySelector<HTMLElement>('#item-detail')!;
    this.debugBarEl = this.root.querySelector<HTMLElement>('#debug-bar')!;
    this.debugLucidityBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-debug-lucidity')!;
    this.debugLucidityBtnEl.hidden = !this.isQaDebugEnabled;
    this.resetBtnEl = this.root.querySelector<HTMLButtonElement>('#btn-reset')!;
    this.controlButtons = Array.from(
      this.root.querySelectorAll<HTMLButtonElement>('.dpad-btn'),
    );

    this.renderer = new CanvasRenderer(this.canvasEl);
    this.updateCanvasSize();
    this.syncAudioButtons();
    this.bindEvents();
    this.renderBuildScreen();
    this.renderAll();
  }

  private syncAudioButtons(): void {
    const muted = this.sound.isMuted();
    const icon = muted ? '🔇' : '🔊';
    const ariaLabel = muted ? 'Bật âm thanh' : 'Tắt âm thanh';

    for (const btn of [this.buildAudioBtnEl, this.audioToggleBtnEl]) {
      btn.textContent = icon;
      btn.setAttribute('aria-label', ariaLabel);
      btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
      btn.dataset.muted = muted ? 'true' : 'false';
    }
  }

  private toggleMute(): void {
    const nextMuted = !this.sound.isMuted();
    this.storage.setMuted(nextMuted);
    this.sound.setMuted(nextMuted);
    this.syncAudioButtons();
  }

  private renderCodex(): void {
    const meta = this.storage.loadMeta();
    const unlockedCount = this.codexDefs.filter((def) =>
      meta.unlockedEndings.includes(def.key),
    ).length;

    this.codexTitleEl.textContent = `HỒ SƠ KẾT CỤC (${unlockedCount}/${this.codexDefs.length})`;
    this.codexBuildsEl.textContent = `Build đã vượt màn: ${meta.completedBuilds.length}/9`;

    this.codexListEl.innerHTML = '';
    for (const def of this.codexDefs) {
      const isUnlocked = meta.unlockedEndings.includes(def.key);
      const chip = document.createElement('span');
      chip.className = 'codex-chip';
      chip.dataset.unlocked = isUnlocked ? 'true' : 'false';
      chip.textContent = isUnlocked ? `✓ ${def.title}` : def.lockedLabel;
      this.codexListEl.appendChild(chip);
    }
  }

  private bindEvents(): void {
    // 0. Nút Âm thanh 🔊 / 🔇 đồng bộ StorageService trên cả 2 thanh tiêu đề
    this.buildAudioBtnEl.addEventListener('click', () => {
      this.toggleMute();
    });
    this.audioToggleBtnEl.addEventListener('click', () => {
      this.toggleMute();
    });

    // 1. Màn hình Khởi tạo Hồ sơ Triệu hồi (Khởi hành, Quay lại & ? Hướng dẫn)
    this.buildStartBtnEl.addEventListener('click', () => {
      this.startRunWithSelectedBuild();
    });
    this.buildCancelBtnEl.addEventListener('click', () => {
      if (this.canCancelBuildScreen) {
        this.closeBuildScreenWithoutReset();
      }
    });
    this.buildGuideToggleBtnEl.addEventListener('click', () => {
      this.setBuildGuideOpen(this.buildGuidePanelEl.hidden);
    });

    // 2. Nút Đổi Build (thanh tiêu đề, màn hình Tử trận & khung Kết cục)
    this.headerBuildBtnEl.addEventListener('click', () => {
      this.openBuildScreen();
    });
    this.root
      .querySelector<HTMLButtonElement>('#btn-gameover-build')
      ?.addEventListener('click', () => {
        this.openBuildScreen();
      });
    this.root
      .querySelector<HTMLButtonElement>('#btn-ending-build')
      ?.addEventListener('click', () => {
        this.openBuildScreen();
      });

    // 3. 4 nút điều hướng + nút Chờ ở giữa D-pad 3x3
    for (const button of this.controlButtons) {
      button.addEventListener('click', () => {
        if (button.id === 'btn-wait') {
          this.performAction({ type: 'WAIT' });
          return;
        }
        const direction = button.dataset.dir as Direction | undefined;
        if (direction) {
          this.performAction({ type: 'MOVE', direction });
        }
      });
    }

    // 4. Hai nút Bước ngoặt Nhận thức (Giữ Màn Che / Xé Màn Che)
    this.chooseKeepBtnEl.addEventListener('click', () => {
      this.performAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' });
    });
    this.root
      .querySelector<HTMLButtonElement>('#btn-choose-break')
      ?.addEventListener('click', () => {
        this.performAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      });

    // 5. Hai nút Hộp thoại đối đầu Boss (Hạ tay chịu áp giải / Ra đòn mở đường)
    this.bossSurrenderBtnEl.addEventListener('click', () => {
      this.performAction({ type: 'CHOOSE_BOSS_ACTION', choice: 'SURRENDER' });
    });
    this.bossFightBtnEl.addEventListener('click', () => {
      this.performAction({ type: 'CHOOSE_BOSS_ACTION', choice: 'FIGHT' });
    });

    // 6. Chạm Canvas: liền kề (=== 1) -> đi/đánh/nói, bản thân (=== 0) -> Chờ, xa (> 1) -> Inspect
    this.renderer.bindBoardClick({
      isInputLocked: () => this.isControlLocked(),
      getState: () => this.engine.getState(),
      onMove: (direction) => this.performAction({ type: 'MOVE', direction }),
      onWait: () => this.performAction({ type: 'WAIT' }),
      onTileInspect: (_pos, entityId) => this.handleTileInspect(entityId),
    });

    this.inspectCloseBtnEl.addEventListener('click', () => {
      this.dismissInspectBar();
      this.renderInspectAndLegend();
    });

    // 7. Phím toàn cục: chặn 100% phím chơi game khi mở màn chọn Build; hỗ trợ Escape
    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (this.isBuildScreenOpen) {
        if (event.key === 'Escape') {
          if (!this.buildGuidePanelEl.hidden) {
            event.preventDefault();
            this.setBuildGuideOpen(false);
            this.buildGuideToggleBtnEl.focus();
            return;
          }
          if (this.canCancelBuildScreen) {
            event.preventDefault();
            this.closeBuildScreenWithoutReset();
          }
        }
        return;
      }

      if (event.key === 'Escape') {
        if (!this.guidePanelEl.hidden) {
          event.preventDefault();
          this.setGuideOpen(false);
          this.guideToggleBtnEl.focus();
          return;
        }
        if (this.engine.getState().activeHubNpcId !== null) {
          event.preventDefault();
          this.performAction({
            type: 'CHOOSE_HUB_ACTION',
            choice: 'CLOSE_HUB_MENU',
          });
          return;
        }
        if (this.getActiveInspectEntityId() !== null) {
          event.preventDefault();
          this.dismissInspectBar();
          this.renderInspectAndLegend();
          return;
        }
      }

      if (this.isControlLocked()) return;

      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        this.performAction({ type: 'WAIT' });
        return;
      }

      const keyMap: Record<string, Direction> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        W: 'up',
        s: 'down',
        S: 'down',
        a: 'left',
        A: 'left',
        d: 'right',
        D: 'right',
      };
      const direction = keyMap[event.key];
      if (!direction) return;

      event.preventDefault();
      this.performAction({ type: 'MOVE', direction });
    });

    // 8. Nút debug +15 Tỉnh táo (chỉ hoạt động khi bật DEV hoặc ?qa=1)
    this.debugLucidityBtnEl.addEventListener('click', () => {
      if (!this.isQaDebugEnabled) return;
      const prevState = this.engine.getState();
      if (this.isControlLocked() || prevState.filterChoice !== 'UNDECIDED') return;

      const prevLucidity = prevState.lucidity;
      const prevMode = this.perception.buildDisplayPacket(prevState, []).mode;
      const events = this.engine.debugAddLucidity(15);
      if (events.length === 0) return;

      this.sound.playForEvents(events);

      const nextState = this.engine.getState();
      if (nextState.pendingFilterChoice) {
        this.resetInspectState();
      }

      const nextPacket = this.perception.buildDisplayPacket(nextState, events);
      if (nextPacket.logs.length > 0) {
        this.appendLogEntries(nextPacket.logs);
      }

      const activeInspectId = this.getActiveInspectEntityId();
      if (
        activeInspectId !== null &&
        prevMode !== 'glitch' &&
        nextPacket.mode === 'glitch'
      ) {
        this.startInspectGlitchIfNeeded(activeInspectId);
      }

      const lucidityGain = nextState.lucidity - prevLucidity;
      if (lucidityGain > 0) {
        this.triggerLucidityPulse(lucidityGain);
      }
      this.renderAll();
    });

    // 9. Nút Chơi lại (thanh dưới, dải Tử trận & khung Kết cục — giữ nguyên Build hiện tại)
    const resetHandler = () => {
      this.resetRunKeepingCurrentBuild();
    };
    this.resetBtnEl.addEventListener('click', resetHandler);
    this.root
      .querySelector<HTMLButtonElement>('#btn-gameover-reset')
      ?.addEventListener('click', resetHandler);
    this.root
      .querySelector<HTMLButtonElement>('#btn-ending-reset')
      ?.addEventListener('click', resetHandler);

    // 10. Bật/tắt bảng Hướng dẫn chơi nhanh
    this.guideToggleBtnEl.addEventListener('click', () => {
      this.setGuideOpen(this.guidePanelEl.hidden);
    });

    // 11. Tự co giãn Canvas khi xoay điện thoại / đổi kích thước cửa sổ
    window.addEventListener('resize', () => {
      if (this.isBuildScreenOpen) return;
      this.updateCanvasSize();
      const state = this.engine.getState();
      const packet = this.perception.buildDisplayPacket(state, []);
      this.renderer.render(state, packet);
    });
  }

  private seedInitialRoomLog(): void {
    const state = this.engine.getState();
    const roomName = this.perception.buildDisplayPacket(state, []).roomName;
    this.logRecords = [
      {
        id: this.nextLogId++,
        entry: {
          text: `Bước vào: ${roomName}.`,
          isGlitch: false,
          isTruth: false,
        },
        resolved: true,
        isTurnStart: true,
      },
    ];
  }

  private openBuildScreen(): void {
    const state = this.engine.getState();
    this.draftRaceId = state.selectedRaceId;
    this.draftClassId = state.selectedClassId;
    this.canCancelBuildScreen =
      this.hasStartedFirstRun && !state.isGameOver && state.endingId === null;
    this.isBuildScreenOpen = true;
    this.setGuideOpen(false);
    this.setBuildGuideOpen(false);
    this.dismissInspectBar();
    this.renderBuildScreen();
    this.renderAll();
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }

  private closeBuildScreenWithoutReset(): void {
    this.isBuildScreenOpen = false;
    this.canCancelBuildScreen = false;
    this.setBuildGuideOpen(false);
    this.renderAll();
    this.updateCanvasSize();
    const state = this.engine.getState();
    const packet = this.perception.buildDisplayPacket(state, []);
    this.renderer.render(state, packet);
    this.headerBuildBtnEl.focus();
  }

  private startRunWithSelectedBuild(): void {
    this.hasStartedFirstRun = true;
    this.isBuildScreenOpen = false;
    this.canCancelBuildScreen = false;
    this.clearPendingTimers();
    this.resetInspectState();
    this.renderer.clearEffects();
    this.recentLucidityGain = 0;
    this.wasFilterChoiceOpen = false;
    this.wasBossChoiceOpen = false;
    this.wasTribunalChoiceOpen = false;
    this.wasHubServiceOpen = false;
    this.selectedItemId = null;
    this.setGuideOpen(false);
    this.setBuildGuideOpen(false);

    this.engine.setBuildAndReset(this.draftRaceId, this.draftClassId);
    this.seedInitialRoomLog();
    this.boardSectionEl.hidden = false;
    this.updateCanvasSize();
    this.renderAll();
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }

  private resetRunKeepingCurrentBuild(): void {
    this.clearPendingTimers();
    this.resetInspectState();
    this.renderer.clearEffects();
    this.recentLucidityGain = 0;
    this.wasFilterChoiceOpen = false;
    this.wasBossChoiceOpen = false;
    this.wasTribunalChoiceOpen = false;
    this.wasHubServiceOpen = false;
    this.selectedItemId = null;

    this.engine.reset();
    this.seedInitialRoomLog();
    this.boardSectionEl.hidden = false;
    this.updateCanvasSize();
    this.renderAll();
  }

  private renderBuildScreen(): void {
    this.syncAudioButtons();
    this.renderCodex();
    this.buildTitleEl.textContent = this.buildOptions.title;
    this.buildRaceLabelEl.textContent = this.buildOptions.raceGroupLabel;
    this.buildClassLabelEl.textContent = this.buildOptions.classGroupLabel;
    this.buildStartBtnEl.textContent = this.canCancelBuildScreen
      ? 'Đổi & Chơi từ đầu'
      : this.buildOptions.startButtonLabel;
    this.buildCancelBtnEl.hidden = !this.canCancelBuildScreen;

    this.buildRaceListEl.innerHTML = '';
    for (const race of this.buildOptions.races) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'build-card';
      card.dataset.raceId = race.id;
      const isSelected = race.id === this.draftRaceId;
      if (isSelected) card.classList.add('build-card-selected');
      card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

      const topRow = document.createElement('div');
      topRow.className = 'build-card-header';

      const nameEl = document.createElement('strong');
      nameEl.className = 'build-card-name';
      nameEl.textContent = race.systemHeader;

      const statsEl = document.createElement('span');
      statsEl.className = 'build-card-stats';
      statsEl.textContent = formatStatDelta(race.maxHpBonus, race.attackBonus);

      topRow.appendChild(nameEl);
      topRow.appendChild(statsEl);
      card.appendChild(topRow);

      const traitEl = document.createElement('p');
      traitEl.className = 'build-card-trait';
      const traitTitle = document.createElement('span');
      traitTitle.className = 'build-trait-tag';
      traitTitle.textContent = `${race.traitName}: `;
      traitEl.appendChild(traitTitle);
      traitEl.appendChild(document.createTextNode(race.traitDescription));
      card.appendChild(traitEl);

      if (race.systemNote) {
        const noteEl = document.createElement('p');
        noteEl.className = 'build-card-warning';
        noteEl.textContent = race.systemNote;
        card.appendChild(noteEl);
      }

      card.addEventListener('click', () => {
        this.draftRaceId = race.id;
        this.renderBuildScreen();
      });

      this.buildRaceListEl.appendChild(card);
    }

    this.buildClassListEl.innerHTML = '';
    for (const cls of this.buildOptions.classes) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'build-card';
      card.dataset.classId = cls.id;
      const isSelected = cls.id === this.draftClassId;
      if (isSelected) card.classList.add('build-card-selected');
      card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

      const topRow = document.createElement('div');
      topRow.className = 'build-card-header';

      const nameEl = document.createElement('strong');
      nameEl.className = 'build-card-name';
      nameEl.textContent = cls.displayName;

      const statsEl = document.createElement('span');
      statsEl.className = 'build-card-stats';
      statsEl.textContent = formatStatDelta(cls.maxHpBonus, cls.attackBonus);

      topRow.appendChild(nameEl);
      topRow.appendChild(statsEl);
      card.appendChild(topRow);

      const traitEl = document.createElement('p');
      traitEl.className = 'build-card-trait';
      const traitTitle = document.createElement('span');
      traitTitle.className = 'build-trait-tag';
      traitTitle.textContent = `${cls.traitName}: `;
      traitEl.appendChild(traitTitle);
      traitEl.appendChild(document.createTextNode(cls.traitDescription));
      card.appendChild(traitEl);

      card.addEventListener('click', () => {
        this.draftClassId = cls.id;
        this.renderBuildScreen();
      });

      this.buildClassListEl.appendChild(card);
    }

    const selectedRace = this.buildOptions.races.find((r) => r.id === this.draftRaceId);
    const selectedClass = this.buildOptions.classes.find((c) => c.id === this.draftClassId);
    const startHp =
      this.buildOptions.baseMaxHp +
      (selectedRace?.maxHpBonus ?? 0) +
      (selectedClass?.maxHpBonus ?? 0);
    const startAtk =
      this.buildOptions.baseAttack +
      (selectedRace?.attackBonus ?? 0) +
      (selectedClass?.attackBonus ?? 0);

    const meta = this.storage.loadMeta();
    this.buildCompletedBadgeEl.hidden = !meta.completedBuilds.includes(
      formatBuildCompletionKey(this.draftRaceId, this.draftClassId),
    );
    this.buildSummaryStatsEl.textContent = `HP ${startHp} · ATK ${startAtk}`;
  }

  private getActiveInspectEntityId(): string | null {
    if (this.manualInspectEntityId !== null) {
      return this.manualInspectEntityId;
    }
    if (!this.dismissedPinnedEntityForTurn && this.pinnedCombatEntityId !== null) {
      return this.pinnedCombatEntityId;
    }
    return null;
  }

  private startInspectGlitchIfNeeded(entityId: string): void {
    this.clearInspectGlitchTimer();
    const state = this.engine.getState();
    const info = this.perception.inspectEntity(state, entityId);
    if (info && info.isGlitching && info.glitchTruthName) {
      this.isInspectGlitchFlashing = true;
      this.inspectGlitchTimer = window.setTimeout(() => {
        this.inspectGlitchTimer = null;
        this.isInspectGlitchFlashing = false;
        this.renderInspectAndLegend();
      }, GLITCH_DURATION_MS);
    } else {
      this.isInspectGlitchFlashing = false;
    }
  }

  private handleTileInspect(entityId: string | null): void {
    if (this.isControlLocked()) return;

    if (!entityId) {
      this.dismissInspectBar();
      this.renderInspectAndLegend();
      return;
    }

    const state = this.engine.getState();
    const info = this.perception.inspectEntity(state, entityId);
    if (!info) {
      this.dismissInspectBar();
      this.renderInspectAndLegend();
      return;
    }

    this.manualInspectEntityId = info.entityId;
    this.dismissedPinnedEntityForTurn = false;
    this.startInspectGlitchIfNeeded(info.entityId);
    this.renderInspectAndLegend();
  }

  private syncPinnedCombatTarget(events: GameEvent[]): void {
    const state = this.engine.getState();
    const prevPinned = this.pinnedCombatEntityId;

    if (events.some((ev) => ev.type === 'ROOM_CHANGED')) {
      this.resetInspectState();
      return;
    }

    const isAliveInRoom = (id: string | null | undefined): id is string =>
      Boolean(
        id &&
          state.entities.some(
            (entity) =>
              entity.id === id &&
              entity.roomId === state.currentRoomId &&
              entity.hp > 0,
          ),
      );

    let nextPinned: string | null = null;
    if (isAliveInRoom(state.lastAttackedTargetId)) {
      nextPinned = state.lastAttackedTargetId;
    } else {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.type === 'ENEMY_ATTACKED' && isAliveInRoom(ev.attackerId)) {
          nextPinned = ev.attackerId;
          break;
        }
        if (
          ev.type === 'RELIC_ACTIVATED' &&
          ev.mode === 'KEEP' &&
          isAliveInRoom(ev.targetId)
        ) {
          nextPinned = ev.targetId;
          break;
        }
      }
    }

    this.pinnedCombatEntityId = nextPinned;
    if (nextPinned !== prevPinned) {
      if (nextPinned) {
        this.startInspectGlitchIfNeeded(nextPinned);
      } else {
        this.clearInspectGlitchTimer();
        this.isInspectGlitchFlashing = false;
      }
    }
  }

  private clearInspectGlitchTimer(): void {
    if (this.inspectGlitchTimer !== null) {
      window.clearTimeout(this.inspectGlitchTimer);
      this.inspectGlitchTimer = null;
    }
  }

  private dismissInspectBar(): void {
    this.clearInspectGlitchTimer();
    this.isInspectGlitchFlashing = false;
    this.manualInspectEntityId = null;
    this.dismissedPinnedEntityForTurn = true;
    this.renderer?.setInspectedEntity(null);
  }

  private resetInspectState(): void {
    this.clearInspectGlitchTimer();
    this.isInspectGlitchFlashing = false;
    this.manualInspectEntityId = null;
    this.pinnedCombatEntityId = null;
    this.dismissedPinnedEntityForTurn = false;
    this.renderer?.setInspectedEntity(null);
  }

  private renderInspectAndLegend(): void {
    const activeId = this.getActiveInspectEntityId();

    if (activeId === null || this.isControlLocked()) {
      if (activeId !== null && this.isControlLocked()) {
        this.resetInspectState();
      } else {
        this.renderer?.setInspectedEntity(null);
      }
      this.inspectCardEl.hidden = true;
      this.legendRowEl.hidden = false;
      return;
    }

    const state = this.engine.getState();
    const stillInRoom = state.entities.some(
      (entity) =>
        entity.id === activeId &&
        entity.roomId === state.currentRoomId &&
        entity.hp > 0,
    );
    const info = stillInRoom ? this.perception.inspectEntity(state, activeId) : null;

    if (!info) {
      if (this.manualInspectEntityId === activeId) {
        this.manualInspectEntityId = null;
      }
      if (this.pinnedCombatEntityId === activeId) {
        this.pinnedCombatEntityId = null;
      }
      this.clearInspectGlitchTimer();
      this.isInspectGlitchFlashing = false;
      this.renderer?.setInspectedEntity(null);
      this.inspectCardEl.hidden = true;
      this.legendRowEl.hidden = false;
      return;
    }

    this.renderer?.setInspectedEntity(info.entityId);

    const activeName =
      this.isInspectGlitchFlashing && info.glitchTruthName
        ? info.glitchTruthName
        : info.displayName;

    this.legendRowEl.hidden = true;
    this.inspectCardEl.hidden = false;
    this.inspectCardEl.dataset.glitch = this.isInspectGlitchFlashing ? 'true' : 'false';
    this.inspectCardEl.dataset.peaceful = info.isPeacefulTalkable ? 'true' : 'false';
    this.inspectCardEl.dataset.object = info.isInteractableObject ? 'true' : 'false';

    this.inspectTextEl.textContent = info.isInteractableObject
      ? activeName
      : `${activeName} · HP ${info.hp}/${info.maxHp} · ATK ${info.attack}`;
    this.inspectStatusEl.textContent = info.statusLabel;
  }

  private setGuideOpen(open: boolean): void {
    this.guidePanelEl.hidden = !open;
    this.guideToggleBtnEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.guideToggleBtnEl.textContent = open ? '✕ Đóng' : '? Hướng dẫn';
  }

  private setBuildGuideOpen(open: boolean): void {
    this.buildGuidePanelEl.hidden = !open;
    this.buildGuideToggleBtnEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.buildGuideToggleBtnEl.textContent = open ? '✕ Đóng' : '? Hướng dẫn';
  }

  private isControlLocked(): boolean {
    const state = this.engine.getState();
    return (
      this.isBuildScreenOpen ||
      state.isGameOver ||
      state.endingId !== null ||
      state.pendingFilterChoice ||
      state.pendingBossChoice ||
      state.pendingTribunalChoice ||
      state.activeHubNpcId !== null
    );
  }

  private performAction(action: PlayerAction): void {
    const prevState = this.engine.getState();
    const prevChoice = prevState.filterChoice;
    const prevLucidity = prevState.lucidity;
    const prevMode = this.perception.buildDisplayPacket(prevState, []).mode;
    const events = this.engine.handleAction(action);
    if (events.length === 0) return;

    this.sound.playForEvents(events);

    if (this.manualInspectEntityId !== null) {
      this.manualInspectEntityId = null;
      this.clearInspectGlitchTimer();
      this.isInspectGlitchFlashing = false;
    }
    this.dismissedPinnedEntityForTurn = false;
    this.syncPinnedCombatTarget(events);

    const state = this.engine.getState();
    if (prevChoice !== state.filterChoice) {
      this.clearPendingTimers();
      this.recentLucidityGain = 0;
      this.settlePendingGlitchLogs(state.filterChoice === 'BREAK');
    }

    const lucidityGain = state.lucidity - prevLucidity;
    if (lucidityGain > 0) {
      this.triggerLucidityPulse(lucidityGain);
    }

    if (this.selectedItemId && !state.inventory.includes(this.selectedItemId)) {
      this.selectedItemId = null;
    }

    const packet = this.perception.buildDisplayPacket(state, events);
    if (packet.codexEndingKey) {
      this.storage.recordEnding(
        packet.codexEndingKey,
        state.selectedRaceId,
        state.selectedClassId,
      );
    }

    if (packet.logs.length > 0) {
      this.appendLogEntries(packet.logs);
    }

    const activeInspectId = this.getActiveInspectEntityId();
    if (
      activeInspectId !== null &&
      prevMode !== 'glitch' &&
      packet.mode === 'glitch'
    ) {
      this.startInspectGlitchIfNeeded(activeInspectId);
    }

    this.renderAll();
    this.renderer.triggerEffects(events);
  }

  private triggerLucidityPulse(gain: number): void {
    if (this.lucidityPulseTimerId !== null) {
      window.clearTimeout(this.lucidityPulseTimerId);
    }
    this.recentLucidityGain = gain;
    this.lucidityPulseTimerId = window.setTimeout(() => {
      this.lucidityPulseTimerId = null;
      this.recentLucidityGain = 0;
      this.updateLucidityHudText();
    }, GLITCH_DURATION_MS);
  }

  private triggerLogSyncFlash(): void {
    const now = performance.now();
    if (now - this.lastGlitchPulseAt > 50) {
      this.lastGlitchPulseAt = now;
      this.sound.playGlitchPulse();
    }

    if (this.logSyncFlashTimer !== null) {
      window.clearTimeout(this.logSyncFlashTimer);
    }
    this.logSectionEl.classList.remove('log-sync-flash');
    void this.logSectionEl.offsetWidth;
    this.logSectionEl.classList.add('log-sync-flash');
    this.logSyncFlashTimer = window.setTimeout(() => {
      this.logSyncFlashTimer = null;
      this.logSectionEl.classList.remove('log-sync-flash');
    }, LOG_SYNC_FLASH_MS);
  }

  private updateLucidityHudText(): void {
    const state = this.engine.getState();
    this.lucidityHudEl.textContent =
      this.recentLucidityGain > 0
        ? `Tỉnh táo: ${state.lucidity}/100 (+${this.recentLucidityGain})`
        : `Tỉnh táo: ${state.lucidity}/100`;
    this.lucidityHudEl.dataset.pulsing = this.recentLucidityGain > 0 ? 'true' : 'false';
  }

  private settlePendingGlitchLogs(revealTruth: boolean): void {
    for (const record of this.logRecords) {
      if (record.entry.isGlitch && !record.resolved) {
        if (revealTruth) {
          record.entry = {
            ...record.entry,
            text: record.entry.trueText ?? record.entry.text,
            isGlitch: false,
            isTruth: true,
          };
        }
        record.resolved = true;
      }
    }
  }

  private appendLogEntries(entries: DisplayLogEntry[]): void {
    const batchRecords: LogRecord[] = [];

    entries.forEach((entry, idx) => {
      const record: LogRecord = {
        id: this.nextLogId++,
        entry,
        resolved: !entry.isGlitch,
        isTurnStart: idx === 0,
      };
      batchRecords.push(record);

      if (entry.isGlitch) {
        const timerId = window.setTimeout(() => {
          this.pendingTimers = this.pendingTimers.filter((id) => id !== timerId);
          record.resolved = true;
          this.renderLogs();
          this.triggerLogSyncFlash();
        }, GLITCH_DURATION_MS);
        this.pendingTimers.push(timerId);
      }
    });

    // Chèn nguyên khối sự kiện của lượt mới lên đầu để giữ đúng chiều thời gian trong cùng 1 lượt
    this.logRecords = [...batchRecords, ...this.logRecords].slice(0, MAX_LOG_LINES);
  }

  private renderAll(): void {
    this.buildScreenEl.hidden = !this.isBuildScreenOpen;
    this.gameplayViewEl.hidden = this.isBuildScreenOpen;

    const state = this.engine.getState();
    const packet = this.perception.buildDisplayPacket(state, []);
    const isLocked = this.isControlLocked();

    this.shellEl.dataset.mode = this.isBuildScreenOpen ? 'illusion' : packet.mode;

    if (this.isBuildScreenOpen) {
      return;
    }

    this.gameplayPhaseTagEl.textContent = `v0.5 · ${packet.roomGridSize}×${packet.roomGridSize}`;
    this.statusBannerEl.textContent = packet.statusBanner;
    this.roomNameEl.textContent = packet.roomName;

    const hpRatio = Math.max(0, Math.min(1, state.player.hp / state.player.maxHp));
    this.hpTextEl.textContent = `HP: ${state.player.hp}/${state.player.maxHp}`;
    this.hpBarFillEl.style.width = `${Math.round(hpRatio * 100)}%`;
    this.hpBarFillEl.dataset.level =
      hpRatio > 0.55 ? 'high' : hpRatio > 0.25 ? 'mid' : 'low';

    this.buildHudEl.textContent = packet.buildDisplayLabel;
    this.buildHudEl.title = packet.buildDisplayLabel;
    this.buildHudEl.dataset.revealed =
      state.filterChoice === 'BREAK' && state.selectedRaceId === 'undead_outsider'
        ? 'true'
        : 'false';

    const effectiveAtk = this.engine.getEffectiveAttack(state.player);
    this.atkBadgeEl.textContent = `ATK: ${effectiveAtk}`;
    this.atkBadgeEl.dataset.buffed =
      (state.player.activeModifierIds?.length ?? 0) > 0 ? 'true' : 'false';

    this.riposteBadgeEl.hidden = !packet.isRiposteReady;
    this.riposteBadgeEl.textContent = packet.riposteLabel;
    this.hudRowSecondaryEl.dataset.riposte = packet.isRiposteReady ? 'true' : 'false';

    this.updateLucidityHudText();
    this.veilStatusEl.textContent = `Màn Che: ${packet.veilStatusLabel}`;
    this.veilStatusEl.dataset.veil =
      state.filterChoice !== 'UNDECIDED' ? state.filterChoice.toLowerCase() : packet.mode;

    this.gameOverBannerEl.hidden = !state.isGameOver;

    // Khu vực điều khiển: luân phiên D-pad / Bước ngoặt Màn Che / Đối đầu Boss / Pháp Đình / Dịch vụ Hub / Khung Kết cục; ẩn D-pad khi Game Over
    const showFilterChoice =
      packet.filterPrompt !== null && !state.isGameOver && !packet.ending;
    const showBossChoice =
      packet.bossPrompt !== null &&
      !showFilterChoice &&
      !state.isGameOver &&
      !packet.ending;
    const showTribunalChoice =
      packet.tribunalPrompt !== null &&
      !showFilterChoice &&
      !showBossChoice &&
      !state.isGameOver &&
      !packet.ending;
    const showHubService =
      packet.hubPrompt !== null &&
      !showFilterChoice &&
      !showBossChoice &&
      !showTribunalChoice &&
      !state.isGameOver &&
      !packet.ending;
    const showEnding = packet.ending !== null && !state.isGameOver;

    // Ẩn bàn cờ Canvas khi hiển thị khung Kết cục để đọc trọn câu kết cuối cùng trên 390x844 & 375x667
    const wasBoardHidden = this.boardSectionEl.hidden;
    this.boardSectionEl.hidden = showEnding;
    if (
      !showEnding &&
      (wasBoardHidden || packet.roomGridSize !== this.lastRenderedGridSize)
    ) {
      this.updateCanvasSize();
    }

    this.controlsSectionEl.hidden = state.isGameOver;
    this.dpadPanelEl.hidden =
      state.isGameOver ||
      showFilterChoice ||
      showBossChoice ||
      showTribunalChoice ||
      showHubService ||
      showEnding;
    this.filterChoicePanelEl.hidden = !showFilterChoice;
    this.bossChoicePanelEl.hidden = !showBossChoice;
    this.tribunalChoicePanelEl.hidden = !showTribunalChoice;
    this.hubServicePanelEl.hidden = !showHubService;
    this.endingPanelEl.hidden = !showEnding;

    if (packet.filterPrompt) {
      this.filterChoiceTitleEl.textContent = packet.filterPrompt.title;
      this.chooseKeepLabelEl.textContent = packet.filterPrompt.keepLabel;
      this.chooseKeepNoteEl.textContent = packet.filterPrompt.keepNote;
      this.chooseBreakLabelEl.textContent = packet.filterPrompt.breakLabel;
      this.chooseBreakNoteEl.textContent = packet.filterPrompt.breakNote;
    }

    if (showFilterChoice && !this.wasFilterChoiceOpen) {
      this.filterChoicePanelEl.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        this.scrollElementNearest(this.filterChoicePanelEl);
      });
    }
    this.wasFilterChoiceOpen = showFilterChoice;

    if (packet.bossPrompt) {
      this.bossChoiceTitleEl.textContent = packet.bossPrompt.title;
      this.bossSurrenderLabelEl.textContent = packet.bossPrompt.surrenderLabel;
      this.bossSurrenderNoteEl.textContent = packet.bossPrompt.surrenderNote;
      this.bossFightLabelEl.textContent = packet.bossPrompt.fightLabel;
      this.bossFightNoteEl.textContent = packet.bossPrompt.fightNote;
    }

    if (showBossChoice && !this.wasBossChoiceOpen) {
      this.bossChoicePanelEl.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        this.scrollElementNearest(this.bossChoicePanelEl);
      });
    }
    this.wasBossChoiceOpen = showBossChoice;

    if (packet.tribunalPrompt) {
      this.tribunalChoiceTitleEl.textContent = packet.tribunalPrompt.title;
      this.tribunalChoiceActionsEl.innerHTML = '';
      for (const option of packet.tribunalPrompt.options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.tribunalChoice = option.choice;
        if (option.choice === 'ACCEPT_DECREE') {
          btn.id = 'btn-tribunal-accept';
          btn.className = 'choice-btn choice-break';
        } else if (option.choice === 'PRESENT_RELIC') {
          btn.id = 'btn-tribunal-relic';
          btn.className = 'choice-btn choice-pact';
        } else {
          btn.id = 'btn-tribunal-defy';
          btn.className = 'choice-btn choice-fight';
        }

        const labelEl = document.createElement('strong');
        labelEl.className = 'choice-btn-label';
        labelEl.textContent = option.label;

        const noteEl = document.createElement('span');
        noteEl.className = 'choice-btn-note';
        noteEl.textContent = option.note;

        btn.appendChild(labelEl);
        btn.appendChild(noteEl);
        btn.addEventListener('click', () => {
          this.performAction({
            type: 'CHOOSE_TRIBUNAL_ACTION',
            choice: option.choice,
          });
        });
        this.tribunalChoiceActionsEl.appendChild(btn);
      }
    }

    if (showTribunalChoice && !this.wasTribunalChoiceOpen) {
      this.tribunalChoicePanelEl.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        this.scrollElementNearest(this.tribunalChoicePanelEl);
      });
    }
    this.wasTribunalChoiceOpen = showTribunalChoice;

    if (packet.hubPrompt) {
      this.hubServiceTitleEl.textContent = packet.hubPrompt.title;
      this.hubServiceActionsEl.innerHTML = '';
      for (const option of packet.hubPrompt.options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.hubChoice = option.choice;
        btn.disabled = option.disabled;
        if (option.choice === 'SUBMIT_RELIC_SHARD') {
          btn.id = 'btn-hub-submit';
          btn.className = 'choice-btn choice-hub-submit';
        } else if (option.choice === 'BUY_RATION') {
          btn.id = 'btn-hub-buy';
          btn.className = 'choice-btn choice-hub-buy';
        } else if (option.choice === 'CLAIM_FREE_SUPPLY') {
          btn.id = 'btn-hub-claim';
          btn.className = 'choice-btn choice-hub-claim';
        } else if (option.choice === 'REST_HEAL') {
          btn.id = 'btn-hub-rest';
          btn.className = 'choice-btn choice-hub-rest';
        } else {
          btn.id = 'btn-hub-close';
          btn.className = 'choice-btn choice-hub-close';
        }

        const labelEl = document.createElement('strong');
        labelEl.className = 'choice-btn-label';
        labelEl.textContent = option.label;
        btn.appendChild(labelEl);

        if (option.disabled && option.disabledReason) {
          const reasonEl = document.createElement('span');
          reasonEl.className = 'choice-btn-note choice-btn-disabled-reason';
          reasonEl.textContent = option.disabledReason;
          btn.appendChild(reasonEl);
        }

        btn.addEventListener('click', () => {
          if (option.disabled) return;
          this.performAction({
            type: 'CHOOSE_HUB_ACTION',
            choice: option.choice,
          });
        });
        this.hubServiceActionsEl.appendChild(btn);
      }
    }

    if (showHubService && !this.wasHubServiceOpen) {
      this.hubServicePanelEl.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        this.scrollElementNearest(this.hubServicePanelEl);
      });
    }
    this.wasHubServiceOpen = showHubService;

    if (packet.ending) {
      const meta = this.storage.loadMeta();
      const unlockedCount = this.codexDefs.filter((def) =>
        meta.unlockedEndings.includes(def.key),
      ).length;
      this.endingPanelEl.dataset.ending = packet.ending.isTruthEnding ? 'truth' : 'keep';
      this.endingTitleEl.textContent = packet.ending.title;
      this.endingCodexProgressEl.textContent = `HỒ SƠ KẾT CỤC (${unlockedCount}/${this.codexDefs.length}) · Build đã vượt màn: ${meta.completedBuilds.length}/9`;
      this.endingBodyEl.textContent = packet.ending.body;
    }

    for (const button of this.controlButtons) {
      button.disabled = isLocked;
    }
    this.debugLucidityBtnEl.hidden = !this.isQaDebugEnabled;
    this.debugLucidityBtnEl.disabled = isLocked || state.filterChoice !== 'UNDECIDED';
    const isEndedOrOver = state.isGameOver || state.endingId !== null;
    this.resetBtnEl.hidden = isEndedOrOver;
    this.debugBarEl.hidden = isEndedOrOver;

    this.inventoryTitleEl.textContent = packet.inventoryHeaderLabel;

    this.legendEntityEl.hidden = !packet.roomVisualSummary.hasRegularEntity;
    this.legendBossEl.hidden = !packet.roomVisualSummary.hasHostileBoss;
    this.legendTalkableEl.hidden = !packet.roomVisualSummary.hasPeacefulTalkable;
    this.legendObjectEl.hidden = !packet.roomVisualSummary.hasInteractableObject;

    this.renderInspectAndLegend();
    if (!showEnding) {
      this.renderer.render(state, packet);
    }
    this.renderLogs();
    this.renderInventory(packet.inventory, isLocked);
  }

  private renderLogs(): void {
    this.logListEl.innerHTML = '';

    for (const record of this.logRecords) {
      const li = document.createElement('li');
      li.className = 'log-line';
      if (record.isTurnStart) {
        li.classList.add('log-turn-start');
      }

      const { entry, resolved } = record;
      if (entry.isDanger) {
        li.classList.add('log-danger');
        li.textContent = entry.text;
      } else if (entry.isWarning) {
        li.classList.add('log-warning');
        li.textContent = entry.text;
      } else if (entry.isTalk) {
        li.classList.add('log-talk');
        li.textContent = entry.text;
      } else if (entry.isSystem) {
        li.classList.add('log-system');
        li.textContent = entry.text;
      } else if (entry.isGlitch && !resolved) {
        li.classList.add('log-glitch-raw');
        li.textContent = entry.trueText ?? entry.text;
      } else if (entry.isGlitch && resolved) {
        li.classList.add('log-glitch-synced');
        li.textContent = entry.fakeText ?? entry.text;
      } else if (entry.isTruth) {
        li.classList.add('log-truth');
        li.textContent = entry.noPrefix ? entry.text : `[SỰ THẬT] ${entry.text}`;
      } else {
        li.textContent = entry.text;
      }

      this.logListEl.appendChild(li);
    }

    this.logListEl.scrollTop = 0;
  }

  private renderInventory(items: DisplayItem[], isLocked: boolean): void {
    this.inventoryListEl.innerHTML = '';

    if (items.length === 0) {
      const emptyEl = document.createElement('span');
      emptyEl.className = 'inventory-empty';
      emptyEl.textContent = '(Trống)';
      this.inventoryListEl.appendChild(emptyEl);
      this.selectedItemId = null;
      this.itemDetailEl.hidden = true;
      return;
    }

    let selectedItem: DisplayItem | undefined;
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'inventory-chip';
      if (item.isTruth) btn.classList.add('chip-truth');
      if (this.selectedItemId === item.id) {
        btn.classList.add('chip-active');
        selectedItem = item;
      }
      btn.textContent = item.name;
      btn.addEventListener('click', () => {
        this.selectedItemId = this.selectedItemId === item.id ? null : item.id;
        this.renderInventory(items, isLocked);
        if (this.selectedItemId === item.id) {
          if (item.isGlitch) {
            this.flashGlitchItemDetail(item);
          }
          requestAnimationFrame(() => {
            this.scrollElementNearest(this.itemDetailEl);
          });
        }
      });
      this.inventoryListEl.appendChild(btn);
    }

    if (selectedItem) {
      this.showItemDetail(
        selectedItem,
        selectedItem.name,
        selectedItem.description,
        selectedItem.isTruth,
        isLocked,
      );
    } else {
      this.itemDetailEl.hidden = true;
    }
  }

  private showItemDetail(
    item: DisplayItem,
    name: string,
    description: string,
    isTruth: boolean,
    isLocked: boolean,
    isGlitchFlash = false,
  ): void {
    this.itemDetailEl.hidden = false;
    this.itemDetailEl.className = 'item-detail';
    if (isGlitchFlash) this.itemDetailEl.classList.add('detail-glitch');
    else if (isTruth) this.itemDetailEl.classList.add('detail-truth');

    this.itemDetailEl.innerHTML = '';
    const titleEl = document.createElement('strong');
    titleEl.className = 'detail-title';
    titleEl.textContent = isTruth ? `[SỰ THẬT] ${name}` : name;

    const descEl = document.createElement('p');
    descEl.className = 'detail-desc';
    descEl.textContent = description;

    this.itemDetailEl.appendChild(titleEl);
    this.itemDetailEl.appendChild(descEl);

    if (item.isWorldRelic === true && !isLocked) {
      const relicBtn = document.createElement('button');
      relicBtn.id = `btn-use-${item.id}`;
      relicBtn.type = 'button';
      relicBtn.className = item.canUse ? 'action-btn action-accent' : 'action-btn';
      relicBtn.disabled = !item.canUse;
      relicBtn.textContent = item.actionLabel;
      relicBtn.addEventListener('click', () => {
        if (!item.canUse) return;
        this.performAction({ type: 'USE_ITEM', itemId: item.id });
      });
      this.itemDetailEl.appendChild(relicBtn);
      return;
    }

    const displayHeal = item.effectiveHealAmount ?? item.healAmount;
    if (displayHeal && displayHeal > 0 && !isLocked) {
      const player = this.engine.getState().player;
      const isFullHp = player.hp >= player.maxHp;

      const useBtn = document.createElement('button');
      useBtn.id = `btn-use-${item.id}`;
      useBtn.type = 'button';
      useBtn.className = 'action-btn action-heal';
      useBtn.disabled = !item.canUse || isFullHp;
      useBtn.textContent = isFullHp
        ? `Sử dụng (+${displayHeal} HP · 1 lượt · HP đầy)`
        : item.actionLabel || `Sử dụng (+${displayHeal} HP · 1 lượt)`;
      useBtn.addEventListener('click', () => {
        this.performAction({ type: 'USE_ITEM', itemId: item.id });
      });
      this.itemDetailEl.appendChild(useBtn);
    }
  }

  private flashGlitchItemDetail(item: DisplayItem): void {
    const isLocked = this.isControlLocked();
    this.showItemDetail(item, item.trueName, item.trueDescription, false, isLocked, true);
    const timerId = window.setTimeout(() => {
      this.pendingTimers = this.pendingTimers.filter((id) => id !== timerId);
      if (this.selectedItemId !== item.id) return;
      const latestState = this.engine.getState();
      const latestItems = this.perception.getDisplayInventory(
        latestState.inventory,
        latestState.lucidity,
        latestState.filterChoice,
        latestState.selectedRaceId,
      );
      const current = latestItems.find((entry) => entry.id === item.id);
      if (current) {
        this.showItemDetail(
          current,
          current.name,
          current.description,
          current.isTruth,
          this.isControlLocked(),
        );
      }
    }, GLITCH_DURATION_MS);
    this.pendingTimers.push(timerId);
  }

  private scrollElementNearest(el: HTMLElement | null | undefined): void {
    try {
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    } catch {
      // Safe no-op in non-scrolling environments
    }
  }

  private updateCanvasSize(): void {
    const isTallViewport = window.innerHeight >= 740;
    const isShortViewport = window.innerHeight <= 700;
    const widthCap = isTallViewport ? 320 : 304;
    const maxByWidth = Math.min(window.innerWidth - 28, widthCap);
    const heightRatio = isShortViewport ? 0.34 : isTallViewport ? 0.38 : 0.35;
    const maxByHeight = Math.floor(window.innerHeight * heightRatio);
    const targetSize = Math.max(192, Math.min(maxByWidth, maxByHeight));
    const gridSize = getRoomGridSize(this.engine.getState().currentRoomId);
    const alignedSize = Math.floor(targetSize / gridSize) * gridSize;
    this.lastRenderedGridSize = gridSize;
    this.renderer.resize(alignedSize);
  }

  private clearPendingTimers(): void {
    for (const timerId of this.pendingTimers) {
      window.clearTimeout(timerId);
    }
    this.pendingTimers = [];
    if (this.lucidityPulseTimerId !== null) {
      window.clearTimeout(this.lucidityPulseTimerId);
    }
    this.lucidityPulseTimerId = null;
    if (this.logSyncFlashTimer !== null) {
      window.clearTimeout(this.logSyncFlashTimer);
      this.logSyncFlashTimer = null;
      this.logSectionEl?.classList.remove('log-sync-flash');
    }
    this.clearInspectGlitchTimer();
  }

  /** Read-only UI snapshot used by the Run & Observe QA hook (window.__veil). */
  getQaSnapshot(): {
    scene:
      | 'build'
      | 'play'
      | 'filter_choice'
      | 'boss_choice'
      | 'tribunal_choice'
      | 'hub_service'
      | 'ending'
      | 'game_over';
    mode: string;
    inspectedEntityId: string | null;
  } {
    const state = this.engine.getState();
    const packet = this.perception.buildDisplayPacket(state, []);
    let scene:
      | 'build'
      | 'play'
      | 'filter_choice'
      | 'boss_choice'
      | 'tribunal_choice'
      | 'hub_service'
      | 'ending'
      | 'game_over' = 'play';
    if (this.isBuildScreenOpen) {
      scene = 'build';
    } else if (state.endingId !== null) {
      scene = 'ending';
    } else if (state.isGameOver) {
      scene = 'game_over';
    } else if (state.pendingFilterChoice) {
      scene = 'filter_choice';
    } else if (state.pendingBossChoice) {
      scene = 'boss_choice';
    } else if (state.pendingTribunalChoice) {
      scene = 'tribunal_choice';
    } else if (state.activeHubNpcId !== null) {
      scene = 'hub_service';
    }
    return {
      scene,
      mode: packet.mode,
      inspectedEntityId: this.getActiveInspectEntityId(),
    };
  }
}
