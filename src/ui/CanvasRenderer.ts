import { GRID_SIZE, isWall, type Position } from '../core/grid';
import type { GameState } from '../core/types';

const COLORS = {
  wall: '#2b3330',
  wallBorder: '#1d2321',
  floor: '#121715',
  gridLine: 'rgba(232, 240, 235, 0.07)',
  adjacentHint: 'rgba(59, 130, 246, 0.1)',
  player: '#3b82f6',
  playerInner: '#93c5fd',
  entity: '#ef4444',
  entityHpBg: 'rgba(0, 0, 0, 0.55)',
  entityHpFill: '#fca5a5',
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
    const safeSize = Math.max(240, Math.floor(cssSize));
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

  render(state: GameState): void {
    const ctx = this.ctx;
    const tileSize = this.logicalSize / GRID_SIZE;

    ctx.clearRect(0, 0, this.logicalSize, this.logicalSize);

    // 1. Vẽ nền sàn & tường 8x8
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const px = x * tileSize;
        const py = y * tileSize;

        if (isWall(x, y)) {
          ctx.fillStyle = COLORS.wall;
          ctx.fillRect(px, py, tileSize, tileSize);
          ctx.strokeStyle = COLORS.wallBorder;
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);
        } else {
          ctx.fillStyle = COLORS.floor;
          ctx.fillRect(px, py, tileSize, tileSize);
          ctx.strokeStyle = COLORS.gridLine;
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);
        }
      }
    }

    // 2. Đánh dấu nhẹ 4 ô liền kề người chơi để dễ chạm trên điện thoại
    const p = state.player.position;
    const adjacentTiles: Position[] = [
      { x: p.x, y: p.y - 1 },
      { x: p.x, y: p.y + 1 },
      { x: p.x - 1, y: p.y },
      { x: p.x + 1, y: p.y },
    ];
    for (const tile of adjacentTiles) {
      if (!isWall(tile.x, tile.y)) {
        ctx.fillStyle = COLORS.adjacentHint;
        ctx.fillRect(tile.x * tileSize + 2, tile.y * tileSize + 2, tileSize - 4, tileSize - 4);
      }
    }

    // 3. Vẽ vật phẩm rơi dưới sàn (màu vàng)
    for (const item of state.groundItems) {
      const pad = tileSize * 0.24;
      const px = item.position.x * tileSize + pad;
      const py = item.position.y * tileSize + pad;
      const size = tileSize - pad * 2;

      ctx.fillStyle = COLORS.item;
      ctx.fillRect(px, py, size, size);
      ctx.fillStyle = COLORS.itemInner;
      ctx.fillRect(px + size * 0.25, py + size * 0.25, size * 0.5, size * 0.5);
    }

    // 4. Vẽ thực thể (màu đỏ + thanh HP nhỏ)
    for (const entity of state.entities) {
      const pad = tileSize * 0.14;
      const px = entity.position.x * tileSize + pad;
      const py = entity.position.y * tileSize + pad;
      const size = tileSize - pad * 2;

      ctx.fillStyle = COLORS.entity;
      ctx.fillRect(px, py, size, size);

      // Thanh máu nhỏ ở mép dưới ô
      const hpRatio = Math.max(0, entity.hp / entity.maxHp);
      const barHeight = Math.max(3, Math.floor(tileSize * 0.1));
      const barY = entity.position.y * tileSize + tileSize - barHeight - 2;
      const barX = entity.position.x * tileSize + 4;
      const barWidth = tileSize - 8;

      ctx.fillStyle = COLORS.entityHpBg;
      ctx.fillRect(barX, barY, barWidth, barHeight);
      ctx.fillStyle = COLORS.entityHpFill;
      ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);
    }

    // 5. Vẽ người chơi (màu xanh dương)
    const playerPad = tileSize * 0.14;
    const playerPx = p.x * tileSize + playerPad;
    const playerPy = p.y * tileSize + playerPad;
    const playerSize = tileSize - playerPad * 2;

    ctx.fillStyle = COLORS.player;
    ctx.fillRect(playerPx, playerPy, playerSize, playerSize);
    ctx.fillStyle = COLORS.playerInner;
    ctx.fillRect(
      playerPx + playerSize * 0.3,
      playerPy + playerSize * 0.3,
      playerSize * 0.4,
      playerSize * 0.4,
    );
  }
}
