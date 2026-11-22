import { GameEngine } from '../core/GameEngine';
import type { Direction } from '../core/grid';
import {
  PerceptionService,
  type DisplayItem,
  type DisplayLogEntry,
} from '../perception/PerceptionService';
import { CanvasRenderer } from './CanvasRenderer';

const MAX_LOG_LINES = 5;
const GLITCH_DURATION_MS = 600;

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
  private canvasEl!: HTMLCanvasElement;
  private logListEl!: HTMLUListElement;
  private inventoryListEl!: HTMLElement;
  private itemDetailEl!: HTMLElement;
  private lucidityReadoutEl!: HTMLElement;

  private logRecords: LogRecord[] = [];
  private nextLogId = 1;
  private selectedItemId: string | null = null;
  private pendingTimers: number[] = [];

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
            <h1 class="game-title">Project VEIL</h1>
            <span class="phase-tag">MVP · 8×8</span>
          </div>
          <p id="status-banner" class="status-banner" role="status"></p>
        </header>

        <section class="board-section" aria-label="Bản đồ lưới 8x8">
          <div class="canvas-frame">
            <canvas id="game-canvas" aria-label="Phòng thử nghiệm nhận thức 8x8"></canvas>
          </div>
          <div class="legend-row" aria-hidden="true">
            <span class="legend-item"><i class="swatch swatch-player"></i>Bạn</span>
            <span class="legend-item"><i class="swatch swatch-entity"></i>Thực thể</span>
            <span class="legend-item"><i class="swatch swatch-item"></i>Vật phẩm</span>
            <span class="legend-hint">Chạm ô liền kề hoặc bấm nút</span>
          </div>
        </section>

        <section class="controls-section" aria-label="Điều hướng một tay">
          <div class="dpad">
            <button id="btn-up" class="dpad-btn dpad-up" type="button" data-dir="up" aria-label="Đi lên">▲</button>
            <button id="btn-left" class="dpad-btn dpad-left" type="button" data-dir="left" aria-label="Sang trái">◀</button>
            <div class="dpad-center" aria-hidden="true"></div>
            <button id="btn-right" class="dpad-btn dpad-right" type="button" data-dir="right" aria-label="Sang phải">▶</button>
            <button id="btn-down" class="dpad-btn dpad-down" type="button" data-dir="down" aria-label="Đi xuống">▼</button>
          </div>
        </section>

        <section class="log-section" aria-label="Combat Log">
          <div class="section-header">
            <span>COMBAT LOG</span>
            <span class="section-meta">5 dòng gần nhất</span>
          </div>
          <ul id="combat-log" class="combat-log" aria-live="polite"></ul>
        </section>

        <footer class="bottom-panel">
          <div class="inventory-block">
            <div class="section-header">
              <span>TÚI ĐỒ</span>
              <span class="section-meta">Chạm vật phẩm để xem mô tả</span>
            </div>
            <div id="inventory-list" class="inventory-list"></div>
            <div id="item-detail" class="item-detail" hidden></div>
          </div>

          <div class="debug-bar">
            <span id="lucidity-readout" class="lucidity-readout"></span>
            <div class="debug-actions">
              <button id="btn-debug-lucidity" class="action-btn action-accent" type="button">
                +15 Lucidity
              </button>
              <button id="btn-reset" class="action-btn" type="button">
                Reset Phòng
              </button>
            </div>
          </div>
        </footer>
      </div>
    `;

    this.statusBannerEl = this.root.querySelector<HTMLElement>('#status-banner')!;
    this.canvasEl = this.root.querySelector<HTMLCanvasElement>('#game-canvas')!;
    this.logListEl = this.root.querySelector<HTMLUListElement>('#combat-log')!;
    this.inventoryListEl = this.root.querySelector<HTMLElement>('#inventory-list')!;
    this.itemDetailEl = this.root.querySelector<HTMLElement>('#item-detail')!;
    this.lucidityReadoutEl = this.root.querySelector<HTMLElement>('#lucidity-readout')!;

    this.renderer = new CanvasRenderer(this.canvasEl);
    this.updateCanvasSize();
    this.bindEvents();
    this.pushInitialBootLog();
    this.renderAll();
  }

  private bindEvents(): void {
    // 1. 4 nút điều hướng D-pad
    const dpadButtons = this.root.querySelectorAll<HTMLButtonElement>('.dpad-btn');
    for (const button of dpadButtons) {
      button.addEventListener('click', () => {
        const direction = button.dataset.dir as Direction | undefined;
        if (direction) {
          this.performDirection(direction);
        }
      });
    }

    // 2. Chạm trực tiếp vào ô liền kề trên Canvas
    this.canvasEl.addEventListener('click', (event: MouseEvent) => {
      const tile = this.renderer.getTileAtClientPoint(event.clientX, event.clientY);
      if (!tile) return;

      const playerPos = this.engine.getState().player.position;
      const dx = tile.x - playerPos.x;
      const dy = tile.y - playerPos.y;

      if (Math.abs(dx) + Math.abs(dy) !== 1) return;
      if (dx === 1) this.performDirection('right');
      else if (dx === -1) this.performDirection('left');
      else if (dy === 1) this.performDirection('down');
      else if (dy === -1) this.performDirection('up');
    });

    // 3. Phím mũi tên & WASD trên máy tính
    window.addEventListener('keydown', (event: KeyboardEvent) => {
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
      this.performDirection(direction);
    });

    // 4. Nút debug +15 Lucidity
    const debugLucidityBtn = this.root.querySelector<HTMLButtonElement>('#btn-debug-lucidity');
    debugLucidityBtn?.addEventListener('click', () => {
      const prevMode = this.perception.buildDisplayPacket(this.engine.getState(), []).mode;
      this.engine.debugAddLucidity(15);
      const nextPacket = this.perception.buildDisplayPacket(this.engine.getState(), []);

      if (nextPacket.mode !== prevMode) {
        this.appendLogEntries([
          {
            text: nextPacket.statusBanner,
            isGlitch: false,
            isTruth: nextPacket.mode === 'truth',
          },
        ]);
      }
      this.renderAll();
    });

    // 5. Nút Reset Phòng
    const resetBtn = this.root.querySelector<HTMLButtonElement>('#btn-reset');
    resetBtn?.addEventListener('click', () => {
      this.clearPendingTimers();
      this.engine.reset();
      this.logRecords = [];
      this.selectedItemId = null;
      this.pushInitialBootLog();
      this.renderAll();
    });

    // 6. Tự co giãn Canvas khi xoay điện thoại
    window.addEventListener('resize', () => {
      this.updateCanvasSize();
      this.renderer.render(this.engine.getState());
    });
  }

  private performDirection(direction: Direction): void {
    const events = this.engine.handleAction(direction);
    if (events.length === 0) return;

    const packet = this.perception.buildDisplayPacket(this.engine.getState(), events);
    if (packet.logs.length > 0) {
      this.appendLogEntries(packet.logs);
    }
    this.renderAll();
  }

  private pushInitialBootLog(): void {
    const banner = this.perception.getStatusBanner(this.engine.getState().lucidity);
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

    const shell = this.root.querySelector<HTMLElement>('.game-shell');
    if (shell) {
      shell.dataset.mode = packet.mode;
    }

    this.statusBannerEl.textContent = packet.statusBanner;
    this.lucidityReadoutEl.textContent = `Lucidity (Debug): ${state.lucidity} / 100 · ${packet.mode}`;

    this.renderer.render(state);
    this.renderLogs();
    this.renderInventory(packet.inventory);
  }

  private renderLogs(): void {
    this.logListEl.innerHTML = '';

    for (const record of this.logRecords) {
      const li = document.createElement('li');
      li.className = 'log-line';

      const { entry, resolved } = record;
      if (entry.isGlitch && !resolved) {
        li.classList.add('log-glitch-raw');
        li.textContent = entry.trueText ?? entry.text;
      } else if (entry.isGlitch && resolved) {
        li.classList.add('log-glitch-synced');
        li.textContent = entry.fakeText ?? entry.text;
      } else if (entry.isTruth) {
        li.classList.add('log-truth');
        li.textContent = `[GỐC] ${entry.text}`;
      } else {
        li.textContent = entry.text;
      }

      this.logListEl.appendChild(li);
    }
  }

  private renderInventory(items: DisplayItem[]): void {
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
        this.renderInventory(items);
        if (this.selectedItemId === item.id && item.isGlitch) {
          this.flashGlitchItemDetail(item);
        }
      });
      this.inventoryListEl.appendChild(btn);
    }

    if (selectedItem) {
      this.showItemDetail(selectedItem.name, selectedItem.description, selectedItem.isTruth);
    } else {
      this.itemDetailEl.hidden = true;
    }
  }

  private showItemDetail(name: string, description: string, isTruth: boolean, isGlitchFlash = false): void {
    this.itemDetailEl.hidden = false;
    this.itemDetailEl.className = 'item-detail';
    if (isGlitchFlash) this.itemDetailEl.classList.add('detail-glitch');
    else if (isTruth) this.itemDetailEl.classList.add('detail-truth');

    this.itemDetailEl.innerHTML = '';
    const titleEl = document.createElement('strong');
    titleEl.className = 'detail-title';
    titleEl.textContent = isTruth ? `[GỐC] ${name}` : name;

    const descEl = document.createElement('p');
    descEl.className = 'detail-desc';
    descEl.textContent = description;

    this.itemDetailEl.appendChild(titleEl);
    this.itemDetailEl.appendChild(descEl);
  }

  private flashGlitchItemDetail(item: DisplayItem): void {
    this.showItemDetail(item.trueName, item.trueDescription, false, true);
    const timerId = window.setTimeout(() => {
      if (this.selectedItemId !== item.id) return;
      const latestItems = this.perception.getDisplayInventory(
        this.engine.getState().inventory,
        this.engine.getState().lucidity,
      );
      const current = latestItems.find((entry) => entry.id === item.id);
      if (current) {
        this.showItemDetail(current.name, current.description, current.isTruth);
      }
    }, GLITCH_DURATION_MS);
    this.pendingTimers.push(timerId);
  }

  private updateCanvasSize(): void {
    const maxWidth = Math.min(window.innerWidth - 36, 336);
    const alignedSize = Math.floor(maxWidth / 8) * 8;
    this.renderer.resize(alignedSize);
  }

  private clearPendingTimers(): void {
    for (const timerId of this.pendingTimers) {
      window.clearTimeout(timerId);
    }
    this.pendingTimers = [];
  }
}
