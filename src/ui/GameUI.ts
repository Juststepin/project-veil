import { GameEngine } from '../core/GameEngine';
import type { Direction } from '../core/grid';
import type { PlayerAction } from '../core/types';
import {
  PerceptionService,
  type DisplayItem,
  type DisplayLogEntry,
} from '../perception/PerceptionService';
import { CanvasRenderer } from './CanvasRenderer';

const MAX_LOG_LINES = 5;
const GLITCH_DURATION_MS = 1400;

interface LogRecord {
  id: number;
  entry: DisplayLogEntry;
  resolved: boolean;
}

export class GameUI {
  private root: HTMLElement;
  private engine: GameEngine;
  private perception: PerceptionService;
  private renderer!: CanvasRenderer;

  private statusBannerEl!: HTMLElement;
  private roomNameEl!: HTMLElement;
  private hpTextEl!: HTMLElement;
  private hpBarFillEl!: HTMLElement;
  private atkBadgeEl!: HTMLElement;
  private lucidityHudEl!: HTMLElement;
  private veilStatusEl!: HTMLElement;
  private gameOverBannerEl!: HTMLElement;
  private dpadPanelEl!: HTMLElement;
  private filterChoicePanelEl!: HTMLElement;
  private filterChoiceTitleEl!: HTMLElement;
  private chooseKeepLabelEl!: HTMLElement;
  private chooseKeepNoteEl!: HTMLElement;
  private chooseBreakLabelEl!: HTMLElement;
  private chooseBreakNoteEl!: HTMLElement;
  private endingPanelEl!: HTMLElement;
  private endingTitleEl!: HTMLElement;
  private endingBodyEl!: HTMLElement;
  private canvasEl!: HTMLCanvasElement;
  private logListEl!: HTMLUListElement;
  private inventoryTitleEl!: HTMLElement;
  private inventoryListEl!: HTMLElement;
  private itemDetailEl!: HTMLElement;
  private lucidityReadoutEl!: HTMLElement;
  private legendTalkableEl!: HTMLElement;
  private debugLucidityBtnEl!: HTMLButtonElement;
  private controlButtons: HTMLButtonElement[] = [];

  private logRecords: LogRecord[] = [];
  private nextLogId = 1;
  private selectedItemId: string | null = null;
  private pendingTimers: number[] = [];
  private recentLucidityGain = 0;
  private lucidityPulseTimerId: number | null = null;

  constructor(root: HTMLElement, engine: GameEngine, perception: PerceptionService) {
    this.root = root;
    this.engine = engine;
    this.perception = perception;
  }

  mount(): void {
    this.root.innerHTML = `
      <div class="game-shell" data-mode="illusion">
        <header class="top-bar">
          <div class="brand-row">
            <div class="brand-heading">
              <h1 class="game-title">Project VEIL</h1>
              <span class="phase-tag">Giai đoạn 3 · 8×8</span>
            </div>
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
          <section id="guide-panel" class="guide-panel" aria-label="Hướng dẫn chơi nhanh" hidden>
            <ul class="guide-list">
              <li><strong>Chỉ số:</strong> <strong>HP</strong> là máu, <strong>ATK</strong> là điểm tấn công, <strong>Tỉnh táo</strong> là mức nhận thức hiện tại.</li>
              <li><strong>Di chuyển &amp; Tương tác:</strong> Bấm mũi tên, chạm ô liền kề hoặc dùng phím mũi tên / WASD. Bước vào <strong>ô thực thể</strong> để tương tác, bước vào <strong>cửa D</strong> để qua phòng.</li>
              <li><strong>Chờ lượt:</strong> Bấm <strong>Chờ</strong> (hoặc phím Space / chạm vào ô của ngươi) để đứng yên 1 lượt, quan sát tình thế hoặc lách cột đá.</li>
              <li><strong>Hành trang:</strong> Bước lên <strong>ô vàng</strong> để nhặt đồ; chạm tên vật phẩm bên dưới để đọc mô tả và bấm <strong>Sử dụng</strong> hồi máu.</li>
              <li><strong>Mẹo chơi:</strong> Theo dõi kỹ <strong>Nhật ký hành động</strong> ngay dưới bản đồ và mô tả vật phẩm khi khám phá. Nút <strong>+15 Tỉnh táo</strong> ở cuối dùng để kiểm thử nhanh nếu cần.</li>
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
          <div class="legend-row" aria-hidden="true">
            <span class="legend-item"><i class="swatch swatch-player"></i>Ngươi</span>
            <span class="legend-item"><i class="swatch swatch-entity"></i>Thực thể</span>
            <span id="legend-talkable" class="legend-item" hidden><i class="swatch swatch-talkable"></i>Giao tiếp</span>
            <span class="legend-item"><i class="swatch swatch-item"></i>Vật phẩm</span>
            <span class="legend-item"><i class="swatch swatch-obstacle"></i>Vật cản</span>
            <span class="legend-item"><i class="swatch swatch-door">D</i>Cửa</span>
          </div>
        </section>

        <section class="log-section" aria-label="Nhật ký hành động">
          <div class="section-header">
            <span>NHẬT KÝ HÀNH ĐỘNG</span>
            <span class="section-meta">Mới nhất ở trên</span>
          </div>
          <ul id="combat-log" class="combat-log" aria-live="polite"></ul>
        </section>

        <section id="gameover-banner" class="gameover-banner" role="alert" hidden>
          <span class="gameover-title">NGƯƠI ĐÃ GỤC NGÃ</span>
          <button id="btn-gameover-reset" class="action-btn action-danger" type="button">
            Chơi lại
          </button>
        </section>

        <section class="controls-section" aria-label="Điều hướng một tay">
          <div id="dpad-panel" class="dpad">
            <button id="btn-up" class="dpad-btn dpad-up" type="button" data-dir="up" aria-label="Đi lên">▲</button>
            <button id="btn-left" class="dpad-btn dpad-left" type="button" data-dir="left" aria-label="Sang trái">◀</button>
            <button id="btn-wait" class="dpad-btn dpad-wait" type="button" aria-label="Chờ 1 lượt">Chờ</button>
            <button id="btn-right" class="dpad-btn dpad-right" type="button" data-dir="right" aria-label="Sang phải">▶</button>
            <button id="btn-down" class="dpad-btn dpad-down" type="button" data-dir="down" aria-label="Đi xuống">▼</button>
          </div>

          <div id="filter-choice-panel" class="choice-panel" role="dialog" aria-label="Bước ngoặt Nhận thức" hidden>
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

          <div id="ending-panel" class="ending-panel" role="region" aria-label="Kết cục" hidden>
            <div class="ending-header">
              <strong id="ending-title" class="ending-title"></strong>
              <button id="btn-ending-reset" class="action-btn action-accent" type="button">
                Chơi lại
              </button>
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

          <div class="debug-bar">
            <span id="lucidity-readout" class="lucidity-readout"></span>
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
    `;

    this.statusBannerEl = this.root.querySelector<HTMLElement>('#status-banner')!;
    this.roomNameEl = this.root.querySelector<HTMLElement>('#room-name')!;
    this.hpTextEl = this.root.querySelector<HTMLElement>('#hp-text')!;
    this.hpBarFillEl = this.root.querySelector<HTMLElement>('#hp-bar-fill')!;
    this.atkBadgeEl = this.root.querySelector<HTMLElement>('#atk-badge')!;
    this.lucidityHudEl = this.root.querySelector<HTMLElement>('#lucidity-hud')!;
    this.veilStatusEl = this.root.querySelector<HTMLElement>('#veil-status')!;
    this.gameOverBannerEl = this.root.querySelector<HTMLElement>('#gameover-banner')!;
    this.dpadPanelEl = this.root.querySelector<HTMLElement>('#dpad-panel')!;
    this.filterChoicePanelEl =
      this.root.querySelector<HTMLElement>('#filter-choice-panel')!;
    this.filterChoiceTitleEl =
      this.root.querySelector<HTMLElement>('#filter-choice-title')!;
    this.chooseKeepLabelEl = this.root.querySelector<HTMLElement>('#choose-keep-label')!;
    this.chooseKeepNoteEl = this.root.querySelector<HTMLElement>('#choose-keep-note')!;
    this.chooseBreakLabelEl =
      this.root.querySelector<HTMLElement>('#choose-break-label')!;
    this.chooseBreakNoteEl = this.root.querySelector<HTMLElement>('#choose-break-note')!;
    this.endingPanelEl = this.root.querySelector<HTMLElement>('#ending-panel')!;
    this.endingTitleEl = this.root.querySelector<HTMLElement>('#ending-title')!;
    this.endingBodyEl = this.root.querySelector<HTMLElement>('#ending-body')!;
    this.canvasEl = this.root.querySelector<HTMLCanvasElement>('#game-canvas')!;
    this.logListEl = this.root.querySelector<HTMLUListElement>('#combat-log')!;
    this.inventoryTitleEl = this.root.querySelector<HTMLElement>('#inventory-title')!;
    this.inventoryListEl = this.root.querySelector<HTMLElement>('#inventory-list')!;
    this.itemDetailEl = this.root.querySelector<HTMLElement>('#item-detail')!;
    this.lucidityReadoutEl = this.root.querySelector<HTMLElement>('#lucidity-readout')!;
    this.legendTalkableEl = this.root.querySelector<HTMLElement>('#legend-talkable')!;
    this.debugLucidityBtnEl =
      this.root.querySelector<HTMLButtonElement>('#btn-debug-lucidity')!;
    this.controlButtons = Array.from(
      this.root.querySelectorAll<HTMLButtonElement>('.dpad-btn'),
    );

    this.renderer = new CanvasRenderer(this.canvasEl);
    this.updateCanvasSize();
    this.bindEvents();
    this.pushInitialBootLog();
    this.renderAll();
  }

  private bindEvents(): void {
    // 1. 4 nút điều hướng + nút Chờ ở giữa D-pad 3x3
    const dpadButtons = this.root.querySelectorAll<HTMLButtonElement>('.dpad-btn');
    for (const button of dpadButtons) {
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

    // 2. Hai nút Bước ngoặt Nhận thức (Giữ Màn Che / Xé Màn Che)
    this.root
      .querySelector<HTMLButtonElement>('#btn-choose-keep')
      ?.addEventListener('click', () => {
        this.performAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' });
      });
    this.root
      .querySelector<HTMLButtonElement>('#btn-choose-break')
      ?.addEventListener('click', () => {
        this.performAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      });

    // 3. Chạm ô liền kề để đi/đánh/nói chuyện, chạm chính ô người chơi để WAIT
    this.canvasEl.addEventListener('click', (event: MouseEvent) => {
      if (this.isControlLocked()) return;

      const tile = this.renderer.getTileAtClientPoint(event.clientX, event.clientY);
      if (!tile) return;

      const playerPos = this.engine.getState().player.position;
      const dx = tile.x - playerPos.x;
      const dy = tile.y - playerPos.y;

      if (dx === 0 && dy === 0) {
        this.performAction({ type: 'WAIT' });
        return;
      }

      if (Math.abs(dx) + Math.abs(dy) !== 1) return;
      if (dx === 1) this.performAction({ type: 'MOVE', direction: 'right' });
      else if (dx === -1) this.performAction({ type: 'MOVE', direction: 'left' });
      else if (dy === 1) this.performAction({ type: 'MOVE', direction: 'down' });
      else if (dy === -1) this.performAction({ type: 'MOVE', direction: 'up' });
    });

    // 4. Phím mũi tên, WASD và Space (Chờ 1 lượt) trên máy tính
    window.addEventListener('keydown', (event: KeyboardEvent) => {
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

    // 5. Nút debug +15 Tỉnh táo
    this.debugLucidityBtnEl.addEventListener('click', () => {
      if (this.isControlLocked()) return;

      const prevState = this.engine.getState();
      const prevMode = this.perception.buildDisplayPacket(prevState, []).mode;
      const events = this.engine.debugAddLucidity(15);
      if (events.length === 0) return;

      const nextState = this.engine.getState();
      const nextPacket = this.perception.buildDisplayPacket(nextState, events);
      const hasThresholdEvent = events.some(
        (event) => event.type === 'FILTER_THRESHOLD_REACHED',
      );

      if (nextPacket.mode !== prevMode && !hasThresholdEvent) {
        this.appendLogEntries([
          {
            text: nextPacket.statusBanner,
            isGlitch: false,
            isTruth: nextPacket.mode === 'truth',
            noPrefix: true,
          },
        ]);
      }

      if (nextPacket.logs.length > 0) {
        this.appendLogEntries(nextPacket.logs);
      }
      const lucidityGain = nextState.lucidity - prevState.lucidity;
      if (lucidityGain > 0) {
        this.triggerLucidityPulse(lucidityGain);
      }
      this.renderAll();
    });

    // 6. Nút Chơi lại (thanh dưới, dải Tử trận & khung Kết cục)
    const resetHandler = () => {
      this.clearPendingTimers();
      this.recentLucidityGain = 0;
      this.engine.reset();
      this.logRecords = [];
      this.selectedItemId = null;
      this.pushInitialBootLog();
      this.renderAll();
    };
    this.root
      .querySelector<HTMLButtonElement>('#btn-reset')
      ?.addEventListener('click', resetHandler);
    this.root
      .querySelector<HTMLButtonElement>('#btn-gameover-reset')
      ?.addEventListener('click', resetHandler);
    this.root
      .querySelector<HTMLButtonElement>('#btn-ending-reset')
      ?.addEventListener('click', resetHandler);

    // 7. Bật/tắt bảng Hướng dẫn chơi nhanh cho người test
    const guideBtn = this.root.querySelector<HTMLButtonElement>('#btn-toggle-guide');
    const guidePanel = this.root.querySelector<HTMLElement>('#guide-panel');
    guideBtn?.addEventListener('click', () => {
      if (!guidePanel) return;
      const willOpen = guidePanel.hidden;
      guidePanel.hidden = !willOpen;
      guideBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      guideBtn.textContent = willOpen ? '✕ Đóng' : '? Hướng dẫn';
    });

    // 8. Tự co giãn Canvas khi xoay điện thoại
    window.addEventListener('resize', () => {
      this.updateCanvasSize();
      const state = this.engine.getState();
      const packet = this.perception.buildDisplayPacket(state, []);
      this.renderer.render(state, packet.entityVisuals);
    });
  }

  private isControlLocked(): boolean {
    const state = this.engine.getState();
    return state.isGameOver || state.endingId !== null || state.pendingFilterChoice;
  }

  private performAction(action: PlayerAction): void {
    const prevState = this.engine.getState();
    const prevChoice = prevState.filterChoice;
    const prevLucidity = prevState.lucidity;
    const events = this.engine.handleAction(action);
    if (events.length === 0) return;

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

  private pushInitialBootLog(): void {
    const state = this.engine.getState();
    const banner = this.perception.getStatusBanner(state.lucidity, state.filterChoice);
    this.logRecords = [
      {
        id: this.nextLogId++,
        entry: { text: banner, isGlitch: false, isTruth: false },
        resolved: true,
      },
    ];
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
    const state = this.engine.getState();
    const packet = this.perception.buildDisplayPacket(state, []);
    const isLocked = this.isControlLocked();

    const shell = this.root.querySelector<HTMLElement>('.game-shell');
    if (shell) {
      shell.dataset.mode = packet.mode;
    }

    this.statusBannerEl.textContent = packet.statusBanner;
    this.roomNameEl.textContent = packet.roomName;

    const hpRatio = Math.max(0, Math.min(1, state.player.hp / state.player.maxHp));
    this.hpTextEl.textContent = `HP: ${state.player.hp}/${state.player.maxHp}`;
    this.hpBarFillEl.style.width = `${Math.round(hpRatio * 100)}%`;
    this.hpBarFillEl.dataset.level =
      hpRatio > 0.55 ? 'high' : hpRatio > 0.25 ? 'mid' : 'low';

    const effectiveAtk = this.engine.getEffectiveAttack(state.player);
    this.atkBadgeEl.textContent = `ATK: ${effectiveAtk}`;
    this.atkBadgeEl.dataset.buffed = effectiveAtk > state.player.attack ? 'true' : 'false';

    this.updateLucidityHudText();
    this.veilStatusEl.textContent = `Màn Che: ${packet.veilStatusLabel}`;
    this.veilStatusEl.dataset.veil = state.filterChoice !== 'UNDECIDED'
      ? state.filterChoice.toLowerCase()
      : packet.mode;

    this.gameOverBannerEl.hidden = !state.isGameOver;

    // Khu vực điều khiển: luân phiên D-pad / Bảng chọn Bước ngoặt / Khung Kết cục
    const showChoice = packet.filterPrompt !== null && !state.isGameOver && !packet.ending;
    const showEnding = packet.ending !== null && !state.isGameOver;

    this.dpadPanelEl.hidden = showChoice || showEnding;
    this.filterChoicePanelEl.hidden = !showChoice;
    this.endingPanelEl.hidden = !showEnding;

    if (packet.filterPrompt) {
      this.filterChoiceTitleEl.textContent = packet.filterPrompt.title;
      this.chooseKeepLabelEl.textContent = packet.filterPrompt.keepLabel;
      this.chooseKeepNoteEl.textContent = packet.filterPrompt.keepNote;
      this.chooseBreakLabelEl.textContent = packet.filterPrompt.breakLabel;
      this.chooseBreakNoteEl.textContent = packet.filterPrompt.breakNote;
    }

    if (packet.ending) {
      this.endingPanelEl.dataset.ending = packet.ending.isTruthEnding ? 'truth' : 'keep';
      this.endingTitleEl.textContent = packet.ending.title;
      this.endingBodyEl.textContent = packet.ending.body;
    }

    for (const button of this.controlButtons) {
      button.disabled = isLocked;
    }
    this.debugLucidityBtnEl.disabled = isLocked;

    this.inventoryTitleEl.textContent =
      packet.inventory.length > 0 ? `HÀNH TRANG (${packet.inventory.length})` : 'HÀNH TRANG';

    this.lucidityReadoutEl.textContent = `Tỉnh táo: ${state.lucidity}/100 · ${packet.veilStatusLabel}`;
    this.legendTalkableEl.hidden = !Object.values(packet.entityVisuals).some(
      (visual) => visual.isPeacefulTalkable,
    );

    this.renderer.render(state, packet.entityVisuals);
    this.renderLogs();
    this.renderInventory(packet.inventory, isLocked);
  }

  private renderLogs(): void {
    this.logListEl.innerHTML = '';

    for (const record of this.logRecords) {
      const li = document.createElement('li');
      li.className = 'log-line';

      const { entry, resolved } = record;
      if (entry.isDanger) {
        li.classList.add('log-danger');
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

    if (item.healAmount && item.healAmount > 0 && !isLocked) {
      const useBtn = document.createElement('button');
      useBtn.id = `btn-use-${item.id}`;
      useBtn.type = 'button';
      useBtn.className = 'action-btn action-heal';
      useBtn.textContent = `Sử dụng (+${item.healAmount} HP)`;
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
  }
}
