import type { Direction, Position } from './grid';

export type Faction = 'civilian' | 'empire_guard';
export type AiBehavior = 'flee_when_hurt' | 'chase_and_attack' | 'guard_civilian';

export type PlayerAction =
  | { type: 'MOVE'; direction: Direction }
  | { type: 'WAIT' }
  | { type: 'USE_ITEM'; itemId: string };

export interface EntityState {
  id: string;
  hp: number;
  maxHp: number;
  attack: number;
  roomId: string;
  position: Position;
  faction?: Faction;
  aiBehavior?: AiBehavior;
  dropItemId?: string;
  fleeCooldown: number;
  provoked: boolean;
  lastPos?: Position;
}

export interface GroundItem {
  itemId: string;
  roomId: string;
  position: Position;
}

export interface GameState {
  currentRoomId: string;
  player: EntityState;
  entities: EntityState[];
  groundItems: GroundItem[];
  inventory: string[];
  lucidity: number;
  isGameOver: boolean;
}

export type GameEvent =
  | { type: 'PLAYER_MOVED'; to: Position }
  | { type: 'PLAYER_WAITED' }
  | { type: 'ROOM_CHANGED'; fromRoomId: string; toRoomId: string; to: Position }
  | {
      type: 'ATTACKED';
      attackerId: string;
      targetId: string;
      damage: number;
      targetRemainingHp: number;
    }
  | {
      type: 'ENEMY_ATTACKED';
      attackerId: string;
      damage: number;
      playerRemainingHp: number;
    }
  | { type: 'GUARD_INTERVENED'; entityId: string }
  | { type: 'DIALOGUE_SPOKEN'; entityId: string }
  | { type: 'AI_FLED'; entityId: string; from: Position; to: Position }
  | { type: 'ENTITY_DIED'; entityId: string }
  | { type: 'PLAYER_DIED' }
  | { type: 'ITEM_DROPPED'; itemId: string; entityId: string; position: Position }
  | { type: 'ITEM_PICKED_UP'; itemId: string }
  | { type: 'ITEM_USED'; itemId: string; healAmount: number; playerHp: number }
  | { type: 'LUCIDITY_CHANGED'; amount: number; newLucidity: number };
