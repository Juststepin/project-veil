import type { Position } from './grid';

export interface EntityState {
  id: string;
  hp: number;
  maxHp: number;
  attack: number;
  position: Position;
  aiBehavior?: 'flee_when_hurt';
  dropItemId?: string;
  fleeCooldown: number;
}

export interface GroundItem {
  itemId: string;
  position: Position;
  fromFleeingEntity: boolean;
}

export interface GameState {
  player: EntityState;
  entities: EntityState[];
  groundItems: GroundItem[];
  inventory: string[];
  lucidity: number;
}

export type GameEvent =
  | { type: 'PLAYER_MOVED'; to: Position }
  | {
      type: 'ATTACKED';
      attackerId: string;
      targetId: string;
      damage: number;
      targetRemainingHp: number;
    }
  | { type: 'DIALOGUE_SPOKEN'; entityId: string }
  | { type: 'AI_FLED'; entityId: string; from: Position; to: Position }
  | { type: 'ENTITY_DIED'; entityId: string }
  | { type: 'ITEM_DROPPED'; itemId: string; entityId: string; position: Position }
  | { type: 'ITEM_PICKED_UP'; itemId: string }
  | { type: 'LUCIDITY_CHANGED'; amount: number; newLucidity: number };
