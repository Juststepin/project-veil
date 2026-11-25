import { getTileType, GRID_SIZE, type Position } from '../core/grid';
import type { GameState } from '../core/types';
import type { EntityDisplayFlags } from '../perception/PerceptionService';

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
  adjacentHint: 'rgba(59, 130, 246, 0.11)',
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
};

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private logicalSize = 320;

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

  render(
    state: GameState,
    entityVisuals: Record<string, EntityDisplayFlags> = {},
  ): void {
    const ctx = this.ctx;
    const roomId = state.currentRoomId;
    const tileSize = this.logicalSize / GRID_SIZE;
    const isInputLocked =
      state.isGameOver || state.endingId !== null || state.pendingFilterChoice;

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
          ctx.fillStyle = COLORS.adjacentHint;
          ctx.fillRect(
            tilePos.x * tileSize + 2,
            tilePos.y * tileSize + 2,
            tileSize - 4,
            tileSize - 4,
          );
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

    // 5. Vẽ người chơi (màu xanh dương + thanh HP mảnh)
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
