export const GRID_SIZE = 8;

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Position {
  x: number;
  y: number;
}

export function isWall(x: number, y: number): boolean {
  return (
    x <= 0 ||
    x >= GRID_SIZE - 1 ||
    y <= 0 ||
    y >= GRID_SIZE - 1
  );
}

export function getNextPosition(pos: Position, direction: Direction): Position {
  if (direction === 'up') return { x: pos.x, y: pos.y - 1 };
  if (direction === 'down') return { x: pos.x, y: pos.y + 1 };
  if (direction === 'left') return { x: pos.x - 1, y: pos.y };
  return { x: pos.x + 1, y: pos.y };
}
