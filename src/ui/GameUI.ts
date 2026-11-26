import { GameEngine } from '../core/GameEngine';
import type { Direction } from '../core/grid';
import type { ClassId, PlayerAction, RaceId } from '../core/types';
import {
  GLITCH_DURATION_MS,
  PerceptionService,
  type DisplayBuildOptions,
  type DisplayItem,
  type DisplayLogEntry,
} from '../perception/PerceptionService';
import { CanvasRenderer } from './CanvasRenderer';

const MAX_LOG_LINES = 25;

interface LogRecord {
  id: number;
  entry: DisplayLogEntry;
  resolved: boolean;
}

function formatStatDelta(hpBonus: number, atkBonus: number): string {
  const hpPart = `${hpBonus >= 0 ? '+' : ''}${hpBonus} Max HP`;
  const atkPart = `${atkBonus >= 0 ? '+' : ''}${atkBonus} ATK`;
  return `${hpPart} · ${atkPart}`;
}

export class GameUI {
  private root: HTMLElement;
  private engine: GameEngine;
  private perception: PerceptionService;
  private renderer!: CanvasRenderer;

  private shellEl!: HTMLElement;
  private buildScreenEl!: HTMLElement;
  private buildTitleEl!: HTMLElement;
  private buildRaceLabelEl!: HTMLElement;
  private buildRaceListEl!: HTMLElement;
  private buildClassLabelEl!: HTMLElement;
  private buildClassListEl!: HTMLElement;
  private buildSummaryStatsEl!: HTMLElement;
  private buildStartBtnEl!: HTMLButtonElement;
  private buildCancelBtnEl!: HTMLButtonElement;

  private gameplayViewEl!: HTMLElement;
  private headerBuildBtnEl!: HTMLButtonElement;
  private guideToggleBtnEl!: HTMLButtonElement;
  private guidePanelEl!: HTMLElement;
  private statusBannerEl!: HTMLElement;
  private roomNameEl!: HTMLElement;
  private hpTextEl!: HTMLElement;
  private hpBarFillEl!: HTMLElement;
  private buildHudEl!: HTMLElement;
  private atkBadgeEl!: HTMLElement;
  private lucidityHudEl!: HTMLElement;
  private veilStatusEl!: HTMLElement;

  private canvasEl!: HTMLCanvasElement;
  private legendRowEl!: HTMLElement;
  private legendEntityEl!: HTMLElement;
  private legendBossEl!: HTMLElement;
  private legendTalkableEl!: HTMLElement;
  private inspectCardEl!: HTMLElement;
  private inspectTextEl!: HTMLElement;
  private inspectStatusEl!: HTMLElement;
  private inspectCloseBtnEl!: HTMLButtonElement;

  private logListEl!: HTMLUListElement;
  private gameOverBannerEl!: HTMLElement;
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

  private endingPanelEl!: HTMLElement;
  private endingTitleEl!: HTMLElement;
  private endingBodyEl!: HTMLElement;

  private inventoryTitleEl!: HTMLElement;
  private inventoryListEl!: HTMLElement;
  private itemDetailEl!: HTMLElement;
  private debugBarEl!: HTMLElement;
  private debugLucidityBtnEl!: HTMLButtonElement;
  private resetBtnEl!: HTMLButtonElement;
  private controlButtons: HTMLButtonElement[] = [];

  private buildOptions!: DisplayBuildOptions;
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
  private wasFilterChoiceOpen = false;
  private wasBossChoiceOpen = false;

  private inspectedEntityId: string | null = null;
  private isInspectGlitchFlashing = false;
  private inspectGlitchTimer: number | null = null;

  constructor(root: HTMLElement, engine: GameEngine, perception: PerceptionService) {
    this.root = root;
    this.engine = engine;
    this.perception = perception;
  }

  mount(): void {
    this.buildOptions = this.perception.getBuildOptions();
    const initialState = this.engine.getState();
    this.draftRaceId = initialState.selectedRaceId;
    this.draftClassId = initialState.selectedClassId;

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
                <span class="phase-tag">Giai đoạn 4 · 8×8</span>
              </div>
            </div>
            <p id="build-screen-title" class="build-screen-title"></p>
          </header>

          <div class="build-group">
            <h2 id="build-race-label" class="build-group-title"></h2>
            <div id="build-race-list" class="build-option-list"></div>
          </div>

          <div class="build-group">
            <h2 id="build-class-label" class="build-group-title"></h2>
            <div id="build-class-list" class="build-option-list"></div>
          </div>

          <footer class="build-footer">
            <div class="build-summary-bar">
              <span class="build-summary-caption">Chỉ số xuất phát</span>
              <strong id="build-summary-stats" class="build-summary-stats"></strong>
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
                <span class="phase-tag">Giai đoạn 4 · 8×8</span>
              </div>
              <div class="header-actions">
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
              <ul class="guide-list">
                <li><strong>Chỉ số:</strong> <strong>HP</strong> là máu, <strong>ATK</strong> là điểm tấn công, <strong>Tỉnh táo</strong> là mức nhận thức hiện tại.</li>
                <li><strong>Di chuyển &amp; Tương tác:</strong> Bấm mũi tên, chạm ô liền kề hoặc dùng phím mũi tên / WASD. Bước vào <strong>ô thực thể</strong> để tương tác, bước vào <strong>cửa D</strong> để qua phòng.</li>
                <li><strong>Quan sát &amp; Chờ lượt:</strong> Chạm vào <strong>thực thể ở xa</strong> để xem nhanh chỉ số (không tốn lượt). Bấm <strong>Chờ</strong> (hoặc Space / chạm ô của ngươi) để qua 1 lượt hoặc giữ thế thủ.</li>
                <li><strong>Hành trang:</strong> Bước lên <strong>ô vàng</strong> để nhặt đồ; chạm tên vật phẩm bên dưới để đọc mô tả và bấm <strong>Sử dụng</strong> hồi máu.</li>
                <li><strong>Mẹo chơi:</strong> Theo dõi kỹ <strong>Nhật ký hành động</strong> ngay dưới bản đồ. Bấm <strong>Đổi Build</strong> trên thanh tiêu đề nếu muốn thử Chủng tộc &amp; Lớp nghề khác.</li>
              </ul>
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
              <div class="hud-row hud-row-secondary">
                <span id="build-hud" class="hud-pill hud-build"></span>
                <span id="atk-badge" class="hud-pill hud-atk"></span>
                <span id="lucidity-hud" class="hud-pill hud-lucidity"></span>
                <span id="veil-status" class="hud-pill hud-veil"></span>
              </div>
            </div>
          </header>

          <section class="board-section" aria-label="Bản đồ lưới 8x8">
            <div class="canvas-frame">
              <canvas id="game-canvas" aria-label="Bản đồ chiến thuật 8x8"></canvas>
            </div>
            <div id="legend-row" class="legend-row" aria-hidden="true">
              <span class="legend-item"><i class="swatch swatch-player"></i>Ngươi</span>
              <span id="legend-entity" class="legend-item"><i class="swatch swatch-entity"></i>Thực thể</span>
              <span id="legend-boss" class="legend-item" hidden><i class="swatch swatch-boss"></i>Boss</span>
              <span id="legend-talkable" class="legend-item" hidden><i class="swatch swatch-talkable"></i>Giao tiếp</span>
              <span class="legend-item"><i class="swatch swatch-item"></i>Vật phẩm</span>
              <span class="legend-item"><i class="swatch swatch-obstacle"></i>Vật cản</span>
              <span class="legend-item"><i class="swatch swatch-door">D</i>Cửa</span>
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
          </section>

          <section class="log-section" aria-label="Nhật ký hành động">
            <div class="section-header">
              <span>NHẬT KÝ HÀNH ĐỘNG</span>
              <span class="section-meta">Cuộn để xem · 25 dòng</span>
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

          <section class="controls-section" aria-label="Điều hướng một tay">
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

            <div id="ending-panel" class="ending-panel" role="region" aria-label="Kết cục" hidden>
              <div class="ending-header">
                <strong id="ending-title" class="ending-title"></strong>
                <div class="panel-dual-actions">
                  <button id="btn-ending-build" class="action-btn" type="button">
                    Đổi Build
                  </button>
                  <button id="btn-ending-reset" class="action-btn action-accent" type="button">
                    Chơi lại
                  </button>
                </div>
              </div>
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
    this.buildTitleEl = this.root.querySelector<HTMLElement>('#build-screen-title')!;
    this.buildRaceLabelEl = this.root.querySelector<HTMLElement>('#build-race-label')!;
    this.buildRaceListEl = this.root.querySelector<HTMLElement>('#build-race-list')!;
    this.buildClassLabelEl = this.root.querySelector<HTMLElement>('#build-class-label')!;
    this.buildClassListEl = this.root.querySelector<HTMLElement>('#build-class-list')!;
    this.buildSummaryStatsEl =
      this.root.querySelector<HTMLElement>('#build-summary-stats')!;
    this.buildStartBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-build-start')!;
    this.buildCancelBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-build-cancel')!;

    this.gameplayViewEl = this.root.querySelector<HTMLElement>('#gameplay-view')!;
    this.headerBuildBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-header-build')!;
    this.guideToggleBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-toggle-guide')!;
    this.guidePanelEl = this.root.querySelector<HTMLElement>('#guide-panel')!;
    this.statusBannerEl = this.root.querySelector<HTMLElement>('#status-banner')!;
    this.roomNameEl = this.root.querySelector<HTMLElement>('#room-name')!;
    this.hpTextEl = this.root.querySelector<HTMLElement>('#hp-text')!;
    this.hpBarFillEl = this.root.querySelector<HTMLElement>('#hp-bar-fill')!;
    this.buildHudEl = this.root.querySelector<HTMLElement>('#build-hud')!;
    this.atkBadgeEl = this.root.querySelector<HTMLElement>('#atk-badge')!;
    this.lucidityHudEl = this.root.querySelector<HTMLElement>('#lucidity-hud')!;
    this.veilStatusEl = this.root.querySelector<HTMLElement>('#veil-status')!;

    this.canvasEl = this.root.querySelector<HTMLCanvasElement>('#game-canvas')!;
    this.legendRowEl = this.root.querySelector<HTMLElement>('#legend-row')!;
    this.legendEntityEl = this.root.querySelector<HTMLElement>('#legend-entity')!;
    this.legendBossEl = this.root.querySelector<HTMLElement>('#legend-boss')!;
    this.legendTalkableEl = this.root.querySelector<HTMLElement>('#legend-talkable')!;
    this.inspectCardEl = this.root.querySelector<HTMLElement>('#inspect-card')!;
    this.inspectTextEl = this.root.querySelector<HTMLElement>('#inspect-text')!;
    this.inspectStatusEl = this.root.querySelector<HTMLElement>('#inspect-status')!;
    this.inspectCloseBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-inspect-close')!;

    this.logListEl = this.root.querySelector<HTMLUListElement>('#combat-log')!;
    this.gameOverBannerEl = this.root.querySelector<HTMLElement>('#gameover-banner')!;
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

    this.endingPanelEl = this.root.querySelector<HTMLElement>('#ending-panel')!;
    this.endingTitleEl = this.root.querySelector<HTMLElement>('#ending-title')!;
    this.endingBodyEl = this.root.querySelector<HTMLElement>('#ending-body')!;

    this.inventoryTitleEl = this.root.querySelector<HTMLElement>('#inventory-title')!;
    this.inventoryListEl = this.root.querySelector<HTMLElement>('#inventory-list')!;
    this.itemDetailEl = this.root.querySelector<HTMLElement>('#item-detail')!;
    this.debugBarEl = this.root.querySelector<HTMLElement>('#debug-bar')!;
    this.debugLucidityBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-debug-lucidity')!;
    this.resetBtnEl = this.root.querySelector<HTMLButtonElement>('#btn-reset')!;
    this.controlButtons = Array.from(
      this.root.querySelectorAll<HTMLButtonElement>('.dpad-btn'),
    );

    this.renderer = new CanvasRenderer(this.canvasEl);
    this.updateCanvasSize();
    this.bindEvents();
    this.renderBuildScreen();
    this.renderAll();
  }

  private bindEvents(): void {
    // 1. Màn hình Khởi tạo Hồ sơ Triệu hồi (Khởi hành & Quay lại)
    this.buildStartBtnEl.addEventListener('click', () => {
      this.startRunWithSelectedBuild();
    });
    this.buildCancelBtnEl.addEventListener('click', () => {
      if (this.canCancelBuildScreen) {
        this.closeBuildScreenWithoutReset();
      }
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
      this.clearInspectState();
      this.renderInspectAndLegend();
    });

    // 7. Phím toàn cục: chặn 100% phím chơi game khi mở màn chọn Build; hỗ trợ Escape
    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (this.isBuildScreenOpen) {
        if (event.key === 'Escape' && this.canCancelBuildScreen) {
          event.preventDefault();
          this.closeBuildScreenWithoutReset();
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
        if (this.inspectedEntityId !== null) {
          event.preventDefault();
          this.clearInspectState();
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

    // 8. Nút debug +15 Tỉnh táo
    this.debugLucidityBtnEl.addEventListener('click', () => {
      const prevState = this.engine.getState();
      if (this.isControlLocked() || prevState.filterChoice !== 'UNDECIDED') return;

      const prevLucidity = prevState.lucidity;
      const events = this.engine.debugAddLucidity(15);
      if (events.length === 0) return;

      const nextState = this.engine.getState();
      if (nextState.pendingFilterChoice) {
        this.clearInspectState();
      }

      const nextPacket = this.perception.buildDisplayPacket(nextState, events);
      if (nextPacket.logs.length > 0) {
        this.appendLogEntries(nextPacket.logs);
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

  private openBuildScreen(): void {
    const state = this.engine.getState();
    this.draftRaceId = state.selectedRaceId;
    this.draftClassId = state.selectedClassId;
    this.canCancelBuildScreen =
      this.hasStartedFirstRun && !state.isGameOver && state.endingId === null;
    this.isBuildScreenOpen = true;
    this.setGuideOpen(false);
    this.clearInspectState();
    this.renderBuildScreen();
    this.renderAll();
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }

  private closeBuildScreenWithoutReset(): void {
    this.isBuildScreenOpen = false;
    this.canCancelBuildScreen = false;
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
    this.clearInspectState();
    this.renderer.clearEffects();
    this.recentLucidityGain = 0;
    this.wasFilterChoiceOpen = false;
    this.wasBossChoiceOpen = false;
    this.logRecords = [];
    this.selectedItemId = null;
    this.setGuideOpen(false);

    this.engine.setBuildAndReset(this.draftRaceId, this.draftClassId);
    this.updateCanvasSize();
    this.renderAll();
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }

  private resetRunKeepingCurrentBuild(): void {
    this.clearPendingTimers();
    this.clearInspectState();
    this.renderer.clearEffects();
    this.recentLucidityGain = 0;
    this.wasFilterChoiceOpen = false;
    this.wasBossChoiceOpen = false;
    this.logRecords = [];
    this.selectedItemId = null;

    this.engine.reset();
    this.renderAll();
  }

  private renderBuildScreen(): void {
    this.buildTitleEl.textContent = this.buildOptions.title;
    this.buildRaceLabelEl.textContent = this.buildOptions.raceGroupLabel;
    this.buildClassLabelEl.textContent = this.buildOptions.classGroupLabel;
    this.buildStartBtnEl.textContent = this.buildOptions.startButtonLabel;
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

    this.buildSummaryStatsEl.textContent = `HP ${startHp} · ATK ${startAtk}`;
  }

  private handleTileInspect(entityId: string | null): void {
    if (this.isControlLocked()) return;

    if (!entityId) {
      this.clearInspectState();
      this.renderInspectAndLegend();
      return;
    }

    // Luôn hủy inspectGlitchTimer cũ trước khi Inspect mục tiêu mới
    this.clearInspectGlitchTimer();

    const state = this.engine.getState();
    const info = this.perception.inspectEntity(state, entityId);
    if (!info) {
      this.clearInspectState();
      this.renderInspectAndLegend();
      return;
    }

    this.inspectedEntityId = info.entityId;
    this.renderer.setInspectedEntity(info.entityId);

    if (info.isGlitching && info.glitchTruthName) {
      this.isInspectGlitchFlashing = true;
      this.inspectGlitchTimer = window.setTimeout(() => {
        this.inspectGlitchTimer = null;
        this.isInspectGlitchFlashing = false;
        this.renderInspectAndLegend();
      }, GLITCH_DURATION_MS);
    } else {
      this.isInspectGlitchFlashing = false;
    }

    this.renderInspectAndLegend();
  }

  private clearInspectGlitchTimer(): void {
    if (this.inspectGlitchTimer !== null) {
      window.clearTimeout(this.inspectGlitchTimer);
      this.inspectGlitchTimer = null;
    }
  }

  private clearInspectState(): void {
    this.clearInspectGlitchTimer();
    this.isInspectGlitchFlashing = false;
    if (this.inspectedEntityId !== null) {
      this.inspectedEntityId = null;
      this.renderer?.setInspectedEntity(null);
    }
  }

  private renderInspectAndLegend(): void {
    if (this.inspectedEntityId === null || this.isControlLocked()) {
      if (this.inspectedEntityId !== null && this.isControlLocked()) {
        this.clearInspectState();
      }
      this.inspectCardEl.hidden = true;
      this.legendRowEl.hidden = false;
      return;
    }

    const state = this.engine.getState();
    const stillInRoom = state.entities.some(
      (entity) =>
        entity.id === this.inspectedEntityId &&
        entity.roomId === state.currentRoomId &&
        entity.hp > 0,
    );
    const info = stillInRoom
      ? this.perception.inspectEntity(state, this.inspectedEntityId)
      : null;

    if (!info) {
      this.clearInspectState();
      this.inspectCardEl.hidden = true;
      this.legendRowEl.hidden = false;
      return;
    }

    const activeName =
      this.isInspectGlitchFlashing && info.glitchTruthName
        ? info.glitchTruthName
        : info.displayName;

    this.legendRowEl.hidden = true;
    this.inspectCardEl.hidden = false;
    this.inspectCardEl.dataset.glitch = this.isInspectGlitchFlashing ? 'true' : 'false';
    this.inspectCardEl.dataset.peaceful = info.isPeacefulTalkable ? 'true' : 'false';

    this.inspectTextEl.textContent = `${activeName} · HP ${info.hp}/${info.maxHp} · ATK ${info.attack}`;
    this.inspectStatusEl.textContent = info.statusLabel;
  }

  private setGuideOpen(open: boolean): void {
    this.guidePanelEl.hidden = !open;
    this.guideToggleBtnEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.guideToggleBtnEl.textContent = open ? '✕ Đóng' : '? Hướng dẫn';
  }

  private isControlLocked(): boolean {
    const state = this.engine.getState();
    return (
      this.isBuildScreenOpen ||
      state.isGameOver ||
      state.endingId !== null ||
      state.pendingFilterChoice ||
      state.pendingBossChoice
    );
  }

  private performAction(action: PlayerAction): void {
    const prevState = this.engine.getState();
    const prevChoice = prevState.filterChoice;
    const prevLucidity = prevState.lucidity;
    const events = this.engine.handleAction(action);
    if (events.length === 0) return;

    this.clearInspectState();

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
    if (packet.logs.length > 0) {
      this.appendLogEntries(packet.logs);
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
    for (const entry of entries) {
      const record: LogRecord = {
        id: this.nextLogId++,
        entry,
        resolved: !entry.isGlitch,
      };
      this.logRecords.unshift(record);

      if (entry.isGlitch) {
        const timerId = window.setTimeout(() => {
          this.pendingTimers = this.pendingTimers.filter((id) => id !== timerId);
          record.resolved = true;
          this.renderLogs();
        }, GLITCH_DURATION_MS);
        this.pendingTimers.push(timerId);
      }
    }

    if (this.logRecords.length > MAX_LOG_LINES) {
      this.logRecords = this.logRecords.slice(0, MAX_LOG_LINES);
    }
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

    this.statusBannerEl.textContent = packet.statusBanner;
    this.roomNameEl.textContent = packet.roomName;

    const hpRatio = Math.max(0, Math.min(1, state.player.hp / state.player.maxHp));
    this.hpTextEl.textContent = `HP: ${state.player.hp}/${state.player.maxHp}`;
    this.hpBarFillEl.style.width = `${Math.round(hpRatio * 100)}%`;
    this.hpBarFillEl.dataset.level =
      hpRatio > 0.55 ? 'high' : hpRatio > 0.25 ? 'mid' : 'low';

    this.buildHudEl.textContent = packet.buildDisplayLabel;
    this.buildHudEl.dataset.revealed =
      state.filterChoice === 'BREAK' && state.selectedRaceId === 'undead_outsider'
        ? 'true'
        : 'false';

    const effectiveAtk = this.engine.getEffectiveAttack(state.player);
    this.atkBadgeEl.textContent = `ATK: ${effectiveAtk}`;
    this.atkBadgeEl.dataset.buffed =
      (state.player.activeModifierIds?.length ?? 0) > 0 ? 'true' : 'false';

    this.updateLucidityHudText();
    this.veilStatusEl.textContent = `Màn Che: ${packet.veilStatusLabel}`;
    this.veilStatusEl.dataset.veil =
      state.filterChoice !== 'UNDECIDED' ? state.filterChoice.toLowerCase() : packet.mode;

    this.gameOverBannerEl.hidden = !state.isGameOver;

    // Khu vực điều khiển: luân phiên D-pad / Bước ngoặt Màn Che / Đối đầu Boss / Khung Kết cục
    const showFilterChoice =
      packet.filterPrompt !== null && !state.isGameOver && !packet.ending;
    const showBossChoice =
      packet.bossPrompt !== null &&
      !showFilterChoice &&
      !state.isGameOver &&
      !packet.ending;
    const showEnding = packet.ending !== null && !state.isGameOver;

    this.dpadPanelEl.hidden = showFilterChoice || showBossChoice || showEnding;
    this.filterChoicePanelEl.hidden = !showFilterChoice;
    this.bossChoicePanelEl.hidden = !showBossChoice;
    this.endingPanelEl.hidden = !showEnding;

    if (packet.filterPrompt) {
      this.filterChoiceTitleEl.textContent = packet.filterPrompt.title;
      this.chooseKeepLabelEl.textContent = packet.filterPrompt.keepLabel;
      this.chooseKeepNoteEl.textContent = packet.filterPrompt.keepNote;
      this.chooseBreakLabelEl.textContent = packet.filterPrompt.breakLabel;
      this.chooseBreakNoteEl.textContent = packet.filterPrompt.breakNote;
    }

    if (showFilterChoice && !this.wasFilterChoiceOpen) {
      this.filterChoicePanelEl.focus();
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
      this.bossChoicePanelEl.focus();
    }
    this.wasBossChoiceOpen = showBossChoice;

    if (packet.ending) {
      this.endingPanelEl.dataset.ending = packet.ending.isTruthEnding ? 'truth' : 'keep';
      this.endingTitleEl.textContent = packet.ending.title;
      this.endingBodyEl.textContent = packet.ending.body;
    }

    for (const button of this.controlButtons) {
      button.disabled = isLocked;
    }
    this.debugLucidityBtnEl.disabled = isLocked || state.filterChoice !== 'UNDECIDED';
    const isEndedOrOver = state.isGameOver || state.endingId !== null;
    this.resetBtnEl.hidden = isEndedOrOver;
    this.debugBarEl.hidden = isEndedOrOver;

    this.inventoryTitleEl.textContent =
      packet.inventory.length > 0 ? `HÀNH TRANG (${packet.inventory.length})` : 'HÀNH TRANG';

    this.legendEntityEl.hidden = !packet.roomVisualSummary.hasRegularEntity;
    this.legendBossEl.hidden = !packet.roomVisualSummary.hasHostileBoss;
    this.legendTalkableEl.hidden = !packet.roomVisualSummary.hasPeacefulTalkable;

    this.renderInspectAndLegend();
    this.renderer.render(state, packet);
    this.renderLogs();
    this.renderInventory(packet.inventory, isLocked);
  }

  private renderLogs(): void {
    this.logListEl.innerHTML = '';

    if (this.logRecords.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'log-empty';
      emptyLi.textContent = 'Di chuyển để bắt đầu khám phá...';
      this.logListEl.appendChild(emptyLi);
      return;
    }

    for (const record of this.logRecords) {
      const li = document.createElement('li');
      li.className = 'log-line';

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
        if (this.selectedItemId === item.id && item.isGlitch) {
          this.flashGlitchItemDetail(item);
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

    const displayHeal = item.effectiveHealAmount ?? item.healAmount;
    if (displayHeal && displayHeal > 0 && !isLocked) {
      const player = this.engine.getState().player;
      const isFullHp = player.hp >= player.maxHp;

      const useBtn = document.createElement('button');
      useBtn.id = `btn-use-${item.id}`;
      useBtn.type = 'button';
      useBtn.className = 'action-btn action-heal';
      useBtn.disabled = isFullHp;
      useBtn.textContent = isFullHp
        ? `Sử dụng (+${displayHeal} HP · HP đầy)`
        : `Sử dụng (+${displayHeal} HP)`;
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

  private updateCanvasSize(): void {
    const maxByWidth = Math.min(window.innerWidth - 32, 312);
    const maxByHeight = Math.floor(window.innerHeight * 0.36);
    const targetSize = Math.max(192, Math.min(maxByWidth, maxByHeight));
    const alignedSize = Math.floor(targetSize / 8) * 8;
    this.renderer.resize(alignedSize);
  }

  private clearPendingTimers(): void {
    for (const timerId of this.pendingTimers) {
      window.clearTimeout(timerId);
    }
    this.pendingTimers = [];
    if (this.lucidityPulseTimerId !== null) {
      window.clearTimeout(this.lucidityPulseTimerId);
      this.lucidityPulseTimerId = null;
    }
    this.clearInspectGlitchTimer();
  }
}
