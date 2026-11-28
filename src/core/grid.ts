import mapsData from '../data/maps.json';

export const GRID_SIZE = 8;

export type Direction = 'up' | 'down' | 'left' | 'right';
export type TileType = 'FLOOR' | 'WALL' | 'OBSTACLE' | 'DOOR';

export interface Position {
  x: number;
  y: number;
}

export interface DoorDefinition {
  position: Position;
  targetRoomId?: string;
  spawnPosition?: Position;
  isExpeditionGate?: boolean;
}

export interface RoomDefinition {
  id: string;
  name: string;
  truth?: { name: string };
  illusion?: { name: string };
  layout: string[];
  doors: DoorDefinition[];
}

const MAPS = mapsData as Record<string, RoomDefinition>;

export function getRoom(roomId: string): RoomDefinition | undefined {
  return MAPS[roomId];
}

export function getTileType(roomId: string, x: number, y: number): TileType {
  const room = MAPS[roomId];
  if (!room || x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
    return 'WALL';
  }
  const symbol = room.layout[y][x];
  if (symbol === '#') return 'WALL';
  if (symbol === 'X') return 'OBSTACLE';
  if (symbol === 'D') return 'DOOR';
  return 'FLOOR';
}

export function isWall(x: number, y: number): boolean {
  return x <= 0 || x >= GRID_SIZE - 1 || y <= 0 || y >= GRID_SIZE - 1;
}

export function isBlockedTile(roomId: string, x: number, y: number): boolean {
  const tile = getTileType(roomId, x, y);
  return tile === 'WALL' || tile === 'OBSTACLE';
}

export function findDoorAt(roomId: string, pos: Position): DoorDefinition | undefined {
  const room = MAPS[roomId];
  if (!room) return undefined;
  return room.doors.find(
    (door) => door.position.x === pos.x && door.position.y === pos.y,
  );
}

export function getNextPosition(pos: Position, direction: Direction): Position {
  if (direction === 'up') return { x: pos.x, y: pos.y - 1 };
  if (direction === 'down') return { x: pos.x, y: pos.y + 1 };
  if (direction === 'left') return { x: pos.x - 1, y: pos.y };
  return { x: pos.x + 1, y: pos.y };
}

export function getManhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
