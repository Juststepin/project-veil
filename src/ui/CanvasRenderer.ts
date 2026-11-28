import { getTileType, GRID_SIZE, type Direction, type Position } from '../core/grid';
import type { GameEvent, GameState } from '../core/types';
import type {
  DisplayPacket,
  EntityDisplayFlags,
} from '../perception/PerceptionService';

const HIT_FLASH_DURATION_MS = 150;
const FLOATING_TEXT_DURATION_MS = 700;

const COLORS = {
  wall: '#262d2a',
  wallBorder: '#1a201e',
  floor: '#111614',
  gridLine: 'rgba(232, 240, 235, 0.065)',
  obstacleFill: '#5d5347',
  obstacleTop: '#7a6e5f',
  obstacleBorder: '#3b342c',
  doorFill: '#3b2c16',
  doorBorder: '#e5a93b',
  doorText: '#fde68a',
  adjacentHintFill: 'rgba(96, 165, 250, 0.24)',
  adjacentHintBorder: 'rgba(147, 197, 253, 0.52)',
  inspectRing: '#38bdf8',
  riposteRing: '#facc15',
  riposteGlowFill: 'rgba(250, 204, 21, 0.14)',
  player: '#3b82f6',
  playerDead: '#475569',
  playerInner: '#93c5fd',
  entity: '#ef4444',
  talkableFill: '#14b8a6',
  talkableBorder: '#99f6e4',
  talkableGlyph: '#f0fdfa',
  bossFill: '#dc2626',
  bossInner: '#7f1d1d',
  bossBorder: '#f59e0b',
  hpBg: 'rgba(0, 0, 0, 0.65)',
  hpPlayerHigh: '#5ed49a',
  hpPlayerMid: '#f59e0b',
  hpPlayerLow: '#ef4444',
  hpEntity: '#fca5a5',
  hpTalkable: '#99f6e4',
  item: '#eab308',
  itemInner: '#fef08a',
  floatAttack: '#fff1f2',
  floatEnemyHit: '#f87171',
  floatTraitGold: '#fde047',
  floatHeal: '#4ade80',
  floatHealAdaptability: '#86efac',
  textOutline: 'rgba(10, 14, 13, 0.92)',
};

interface HitFlashEffect {
  position: Position;
  startTime: number;
  isPlayerTile: boolean;
}

interface FloatingTextEffect {
  position: Position;
  text: string;
  color: string;
  startTime: number;
  initialYOffset: number;
  emphasized: boolean;
  customFontSize?: number;
}

export interface CanvasBoardHandlers {
  isInputLocked: () => boolean;
  getState: () => GameState;
  onMove: (direction: Direction) => void;
  onWait: () => void;
  onTileInspect: (pos: Position, entityId: string | null) => void;
}

function isDisplayPacket(
  value: DisplayPacket | Record<string, EntityDisplayFlags>,
): value is DisplayPacket {
  return 'entityVisuals' in value && 'mode' in value;
}

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private logicalSize = 320;

  private lastState: GameState | null = null;
  private lastPacket: DisplayPacket | null = null;
  private lastEntityVisuals: Record<string, EntityDisplayFlags> = {};
  private inspectedEntityId: string | null = null;

  private hitFlashes: HitFlashEffect[] = [];
  private floatingTexts: FloatingTextEffect[] = [];
  private rafId: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not initialize 2D canvas context');
    }
    this.canvas = canvas;
    this.ctx = context;
    this.resize(320);
  }

  resize(cssSize: number): void {
    const safeSize = Math.max(192, Math.floor(cssSize));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.logicalSize = safeSize;

    this.canvas.width = Math.floor(safeSize * dpr);
    this.canvas.height = Math.floor(safeSize * dpr);
    this.canvas.style.width = `${safeSize}px`;
    this.canvas.style.height = `${safeSize}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setInspectedEntity(entityId: string | null): void {
    if (this.inspectedEntityId === entityId) return;
    this.inspectedEntityId = entityId;
    if (this.lastState) {
      this.drawFrame(performance.now());
    }
  }

  bindBoardClick(handlers: CanvasBoardHandlers): void {
    this.canvas.addEventListener('click', (event: MouseEvent) => {
      if (handlers.isInputLocked()) return;

      const tile = this.getTileAtClientPoint(event.clientX, event.clientY);
      if (!tile) return;

      const state = handlers.getState();
      const playerPos = state.player.position;
      const dx = tile.x - playerPos.x;
      const dy = tile.y - playerPos.y;
      const manhattan = Math.abs(dx) + Math.abs(dy);

      if (manhattan === 0) {
        handlers.onWait();
        return;
      }

      if (manhattan === 1) {
        if (dx === 1) handlers.onMove('right');
        else if (dx === -1) handlers.onMove('left');
        else if (dy === 1) handlers.onMove('down');
        else if (dy === -1) handlers.onMove('up');
        return;
      }

      // Khoảng cách Manhattan > 1: gọi Inspect 1 chạm, KHÔNG di chuyển, KHÔNG tốn lượt
      const targetEntity = state.entities.find(
        (entity) =>
          entity.roomId === state.currentRoomId &&
          entity.hp > 0 &&
          entity.position.x === tile.x &&
          entity.position.y === tile.y,
      );
      handlers.onTileInspect(tile, targetEntity?.id ?? null);
    });
  }

  getTileAtClientPoint(clientX: number, clientY: number): Position | null {
    const rect = this.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localX < 0 || localY < 0 || localX >= rect.width || localY >= rect.height) {
      return null;
    }

    const tileSize = rect.width / GRID_SIZE;
    const x = Math.floor(localX / tileSize);
    const y = Math.floor(localY / tileSize);
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
      return null;
    }
    return { x, y };
  }

  clearEffects(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.hitFlashes = [];
    this.floatingTexts = [];
    if (this.lastState) {
      this.drawFrame(performance.now());
    }
  }

  triggerEffects(events: GameEvent[]): void {
    if (events.length === 0) return;

    const now = performance.now();

    for (const event of events) {
      if (event.type === 'ROOM_CHANGED') {
        this.clearEffects();
        continue;
      }

      if (event.type === 'ATTACKED' && event.targetPosition) {
        const isTraitHit = Boolean(event.triggeredTraitId);
        this.hitFlashes.push({
          position: { ...event.targetPosition },
          startTime: now,
          isPlayerTile: false,
        });
        this.spawnFloatingText(
          event.targetPosition,
          isTraitHit ? `-${event.damage}!` : `-${event.damage}`,
          isTraitHit ? COLORS.floatTraitGold : COLORS.floatAttack,
          now,
          isTraitHit,
        );
      } else if (event.type === 'ENEMY_ATTACKED') {
        if (event.playerPosition) {
          this.hitFlashes.push({
            position: { ...event.playerPosition },
            startTime: now,
            isPlayerTile: true,
          });
          this.spawnFloatingText(
            event.playerPosition,
            `-${event.damage}`,
            COLORS.floatEnemyHit,
            now,
            false,
          );
        }
      } else if (
        event.type === 'ITEM_USED' &&
        event.healAmount > 0 &&
        event.playerPosition
      ) {
        const isAdaptability = event.triggeredTraitId === 'adaptability';
        this.spawnFloatingText(
          event.playerPosition,
          `+${event.healAmount}`,
          isAdaptability ? COLORS.floatHealAdaptability : COLORS.floatHeal,
          now,
          isAdaptability,
        );
      } else if (event.type === 'RELIC_ACTIVATED') {
        if (event.mode === 'KEEP' && event.targetPosition && event.damage) {
          this.hitFlashes.push({
            position: { ...event.targetPosition },
            startTime: now,
            isPlayerTile: false,
          });
          this.spawnFloatingText(
            event.targetPosition,
            `-${event.damage}!`,
            COLORS.floatTraitGold,
            now,
            true,
          );
        }
        if (event.healAmount > 0 && this.lastState) {
          this.spawnFloatingText(
            this.lastState.player.position,
            `+${event.healAmount}`,
            COLORS.floatHeal,
            now,
            true,
          );
        }
      } else if (
        event.type === 'HUB_RESTED' &&
        event.healAmount > 0 &&
        event.playerPosition
      ) {
        this.spawnFloatingText(
          event.playerPosition,
          `+${event.healAmount}`,
          COLORS.floatHeal,
          now,
          true,
        );
      }
    }

    if (
      (this.hitFlashes.length > 0 || this.floatingTexts.length > 0) &&
      this.rafId === null
    ) {
      this.rafId = window.requestAnimationFrame(this.tickAnimation);
    }
  }

  private spawnFloatingText(
    position: Position,
    text: string,
    color: string,
    now: number,
    emphasized: boolean,
    baseYOffset = 0,
    customFontSize?: number,
  ): void {
    const tileSize = this.logicalSize / GRID_SIZE;
    const maxFloatLift = tileSize * 0.48;
    // Quy ước trục Y màn hình: dương (+8px) dịch xuống dưới, âm (-12px) dịch lên trên
    let yOffset = baseYOffset;

    // Tự dịch lên trên (-14px) nếu cùng ô đã có chữ nổi xuất hiện sát vị trí dọc hiện tại
    const sameTileEffects = this.floatingTexts.filter(
      (ft) => ft.position.x === position.x && ft.position.y === position.y,
    );
    while (
      sameTileEffects.some((ft) => {
        const progress = Math.max(
          0,
          Math.min(1, (now - ft.startTime) / FLOATING_TEXT_DURATION_MS),
        );
        const existingDeltaY = ft.initialYOffset - progress * maxFloatLift;
        return Math.abs(existingDeltaY - yOffset) < 13;
      })
    ) {
      yOffset -= 14;
    }

    this.floatingTexts.push({
      position: { ...position },
      text,
      color,
      startTime: now,
      initialYOffset: yOffset,
      emphasized,
      customFontSize,
    });
  }

  private tickAnimation = (now: number): void => {
    this.hitFlashes = this.hitFlashes.filter(
      (flash) => now - flash.startTime < HIT_FLASH_DURATION_MS,
    );
    this.floatingTexts = this.floatingTexts.filter(
      (ft) => now - ft.startTime < FLOATING_TEXT_DURATION_MS,
    );

    if (this.lastState) {
      this.drawFrame(now);
    }

    if (this.hitFlashes.length > 0 || this.floatingTexts.length > 0) {
      this.rafId = window.requestAnimationFrame(this.tickAnimation);
    } else {
      this.rafId = null;
    }
  };

  render(
    state: GameState,
    packetOrVisuals: DisplayPacket | Record<string, EntityDisplayFlags> = {},
  ): void {
    this.lastState = state;
    if (isDisplayPacket(packetOrVisuals)) {
      this.lastPacket = packetOrVisuals;
      this.lastEntityVisuals = packetOrVisuals.entityVisuals;
    } else {
      this.lastEntityVisuals = packetOrVisuals;
    }

    this.drawFrame(performance.now());
  }

  private drawFrame(now: number): void {
    const state = this.lastState;
    if (!state) return;

    const entityVisuals = this.lastPacket?.entityVisuals ?? this.lastEntityVisuals;
    const ctx = this.ctx;
    const roomId = state.currentRoomId;
    const tileSize = this.logicalSize / GRID_SIZE;
    const isInputLocked =
      state.isGameOver ||
      state.endingId !== null ||
      state.pendingFilterChoice ||
      state.pendingBossChoice ||
      state.pendingTribunalChoice ||
      state.activeHubNpcId !== null;

    ctx.clearRect(0, 0, this.logicalSize, this.logicalSize);

    // 1. Vẽ 4 loại ô lưới 8x8 của phòng hiện tại (WALL, FLOOR, OBSTACLE, DOOR)
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const px = x * tileSize;
        const py = y * tileSize;
        const tile = getTileType(roomId, x, y);

        if (tile === 'WALL') {
          ctx.fillStyle = COLORS.wall;
          ctx.fillRect(px, py, tileSize, tileSize);
          ctx.strokeStyle = COLORS.wallBorder;
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);
        } else if (tile === 'OBSTACLE') {
          ctx.fillStyle = COLORS.floor;
          ctx.fillRect(px, py, tileSize, tileSize);

          const pad = Math.max(3, tileSize * 0.1);
          const size = tileSize - pad * 2;
          ctx.fillStyle = COLORS.obstacleFill;
          ctx.fillRect(px + pad, py + pad, size, size);
          ctx.fillStyle = COLORS.obstacleTop;
          ctx.fillRect(px + pad + 2, py + pad + 2, size - 4, size * 0.35);
          ctx.strokeStyle = COLORS.obstacleBorder;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px + pad + 0.5, py + pad + 0.5, size - 1, size - 1);
        } else if (tile === 'DOOR') {
          ctx.fillStyle = COLORS.doorFill;
          ctx.fillRect(px, py, tileSize, tileSize);
          ctx.strokeStyle = COLORS.doorBorder;
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 2, py + 2, tileSize - 4, tileSize - 4);

          ctx.fillStyle = COLORS.doorText;
          ctx.font = `700 ${Math.round(tileSize * 0.44)}px "JetBrains Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('D', px + tileSize / 2, py + tileSize / 2 + 1);
        } else {
          ctx.fillStyle = COLORS.floor;
          ctx.fillRect(px, py, tileSize, tileSize);
          ctx.strokeStyle = COLORS.gridLine;
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);
        }
      }
    }

    // 2. Gợi ý nhẹ 4 ô liền kề có thể đi/mở cửa khi chưa khóa điều khiển
    const p = state.player.position;
    if (!isInputLocked) {
      const adjacentTiles: Position[] = [
        { x: p.x, y: p.y - 1 },
        { x: p.x, y: p.y + 1 },
        { x: p.x - 1, y: p.y },
        { x: p.x + 1, y: p.y },
      ];
      for (const tilePos of adjacentTiles) {
        const tile = getTileType(roomId, tilePos.x, tilePos.y);
        if (tile === 'FLOOR' || tile === 'DOOR') {
          const hx = tilePos.x * tileSize + 2;
          const hy = tilePos.y * tileSize + 2;
          const hs = tileSize - 4;
          ctx.fillStyle = COLORS.adjacentHintFill;
          ctx.fillRect(hx, hy, hs, hs);
          ctx.strokeStyle = COLORS.adjacentHintBorder;
          ctx.lineWidth = 1.25;
          ctx.strokeRect(hx + 0.5, hy + 0.5, hs - 1, hs - 1);
        }
      }
    }

    // 3. Vẽ vật phẩm rơi trong phòng hiện tại (màu vàng)
    const roomItems = state.groundItems.filter((item) => item.roomId === roomId);
    for (const item of roomItems) {
      const pad = tileSize * 0.25;
      const px = item.position.x * tileSize + pad;
      const py = item.position.y * tileSize + pad;
      const size = tileSize - pad * 2;

      ctx.fillStyle = COLORS.item;
      ctx.fillRect(px, py, size, size);
      ctx.fillStyle = COLORS.itemInner;
      ctx.fillRect(px + size * 0.25, py + size * 0.25, size * 0.5, size * 0.5);
    }

    // 4. Vẽ các thực thể sống trong phòng hiện tại (phân biệt Giao tiếp / Boss / Địch thường)
    const roomEntities = state.entities.filter(
      (entity) => entity.roomId === roomId && entity.hp > 0,
    );
    for (const entity of roomEntities) {
      const visual = entityVisuals[entity.id];
      const isPeacefulTalkable = visual?.isPeacefulTalkable === true;
      const isHostileBoss = visual?.isHostileBoss === true;

      if (this.inspectedEntityId === entity.id) {
        ctx.strokeStyle = COLORS.inspectRing;
        ctx.lineWidth = 2;
        ctx.strokeRect(
          entity.position.x * tileSize + 2,
          entity.position.y * tileSize + 2,
          tileSize - 4,
          tileSize - 4,
        );
      }

      const pad = isHostileBoss ? tileSize * 0.1 : tileSize * 0.14;
      const px = entity.position.x * tileSize + pad;
      const py = entity.position.y * tileSize + pad;
      const size = tileSize - pad * 2;

      if (isPeacefulTalkable) {
        ctx.fillStyle = COLORS.talkableFill;
        ctx.fillRect(px, py, size, size);
        ctx.strokeStyle = COLORS.talkableBorder;
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, size - 2, size - 2);

        // Ký hiệu 3 chấm hội thoại nhỏ để nhận biết bước vào là TALK
        const dotRadius = Math.max(1.4, tileSize * 0.045);
        const dotY = py + size * 0.42;
        const centerX = px + size / 2;
        const spacing = dotRadius * 3.1;
        ctx.fillStyle = COLORS.talkableGlyph;
        for (const offset of [-spacing, 0, spacing]) {
          ctx.beginPath();
          ctx.arc(centerX + offset, dotY, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (isHostileBoss) {
        ctx.fillStyle = COLORS.bossFill;
        ctx.fillRect(px, py, size, size);
        ctx.fillStyle = COLORS.bossInner;
        ctx.fillRect(
          px + size * 0.22,
          py + size * 0.2,
          size * 0.56,
          size * 0.44,
        );
        ctx.strokeStyle = COLORS.bossBorder;
        ctx.lineWidth = 3;
        ctx.strokeRect(px + 1.5, py + 1.5, size - 3, size - 3);
      } else {
        ctx.fillStyle = COLORS.entity;
        ctx.fillRect(px, py, size, size);
      }

      this.drawMiniHpBar(
        entity.position.x,
        entity.position.y,
        tileSize,
        entity.hp / entity.maxHp,
        isPeacefulTalkable ? COLORS.hpTalkable : COLORS.hpEntity,
      );
    }

    // 5. Vẽ người chơi (viền sáng vàng nhẹ khi nạp Thế Phản Công + ô xanh dương + thanh HP mảnh)
    const isRiposteReady =
      (this.lastPacket?.isRiposteReady ?? state.isRiposteReady) && !state.isGameOver;
    if (isRiposteReady) {
      const ringX = p.x * tileSize + 2;
      const ringY = p.y * tileSize + 2;
      const ringSize = tileSize - 4;
      ctx.fillStyle = COLORS.riposteGlowFill;
      ctx.fillRect(ringX, ringY, ringSize, ringSize);
      ctx.strokeStyle = COLORS.riposteRing;
      ctx.lineWidth = 2;
      ctx.strokeRect(ringX + 0.5, ringY + 0.5, ringSize - 1, ringSize - 1);
    }

    const playerPad = tileSize * 0.14;
    const playerPx = p.x * tileSize + playerPad;
    const playerPy = p.y * tileSize + playerPad;
    const playerSize = tileSize - playerPad * 2;

    ctx.fillStyle = state.isGameOver ? COLORS.playerDead : COLORS.player;
    ctx.fillRect(playerPx, playerPy, playerSize, playerSize);
    if (!state.isGameOver) {
      ctx.fillStyle = COLORS.playerInner;
      ctx.fillRect(
        playerPx + playerSize * 0.3,
        playerPy + playerSize * 0.3,
        playerSize * 0.4,
        playerSize * 0.4,
      );
    }

    const playerHpRatio = state.player.hp / state.player.maxHp;
    const playerHpColor =
      playerHpRatio > 0.55
        ? COLORS.hpPlayerHigh
        : playerHpRatio > 0.25
          ? COLORS.hpPlayerMid
          : COLORS.hpPlayerLow;

    this.drawMiniHpBar(p.x, p.y, tileSize, playerHpRatio, playerHpColor);

    // 6. Vẽ hiệu ứng phản hồi chiến đấu (Hit Flash ~150ms & Floating Text ~700ms)
    this.drawEffects(now, tileSize);
  }

  private drawEffects(now: number, tileSize: number): void {
    const ctx = this.ctx;

    for (const flash of this.hitFlashes) {
      const progress = Math.max(
        0,
        Math.min(1, (now - flash.startTime) / HIT_FLASH_DURATION_MS),
      );
      const alpha = (1 - progress) * 0.56;
      const borderAlpha = Math.min(1, alpha * 1.45);
      const px = flash.position.x * tileSize;
      const py = flash.position.y * tileSize;

      ctx.save();
      if (flash.isPlayerTile) {
        ctx.fillStyle = `rgba(254, 202, 202, ${alpha})`;
        ctx.strokeStyle = `rgba(239, 68, 68, ${borderAlpha})`;
      } else {
        ctx.fillStyle = `rgba(255, 236, 238, ${alpha})`;
        ctx.strokeStyle = `rgba(248, 113, 113, ${borderAlpha})`;
      }
      ctx.fillRect(px + 1, py + 1, tileSize - 2, tileSize - 2);
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1.5, py + 1.5, tileSize - 3, tileSize - 3);
      ctx.restore();
    }

    for (const ft of this.floatingTexts) {
      const progress = Math.max(
        0,
        Math.min(1, (now - ft.startTime) / FLOATING_TEXT_DURATION_MS),
      );
      const alpha = progress < 0.68 ? 1 : 1 - (progress - 0.68) / 0.32;
      const floatUpPx = progress * (tileSize * 0.48);
      const rawCenterX = ft.position.x * tileSize + tileSize / 2;
      const rawCenterY =
        ft.position.y * tileSize + tileSize * 0.34 + ft.initialYOffset - floatUpPx;

      const fontSize =
        ft.customFontSize ??
        Math.max(11, Math.round(tileSize * (ft.emphasized ? 0.36 : 0.31)));

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.font = `700 ${fontSize}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const halfWidth = ctx.measureText(ft.text).width / 2 + 4;
      const clampedX = Math.max(
        halfWidth,
        Math.min(this.logicalSize - halfWidth, rawCenterX),
      );
      const clampedY = Math.max(
        fontSize * 0.75,
        Math.min(this.logicalSize - fontSize * 0.75, rawCenterY),
      );

      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = COLORS.textOutline;
      ctx.strokeText(ft.text, clampedX, clampedY);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, clampedX, clampedY);
      ctx.restore();
    }
  }

  private drawMiniHpBar(
    tileX: number,
    tileY: number,
    tileSize: number,
    ratio: number,
    fillColor: string,
  ): void {
    const ctx = this.ctx;
    const clamped = Math.max(0, Math.min(1, ratio));
    const barHeight = Math.max(3, Math.floor(tileSize * 0.1));
    const barX = tileX * tileSize + 3;
    const barY = tileY * tileSize + tileSize - barHeight - 2;
    const barWidth = tileSize - 6;

    ctx.fillStyle = COLORS.hpBg;
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = fillColor;
    ctx.fillRect(barX, barY, barWidth * clamped, barHeight);
  }
}
