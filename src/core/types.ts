import type { Direction, Position } from './grid';

export type Faction = 'civilian' | 'empire_guard';
export type AiBehavior =
  | 'flee_when_hurt'
  | 'chase_and_attack'
  | 'guard_civilian'
  | 'checkpoint_boss';

export type FilterChoice = 'UNDECIDED' | 'KEEP' | 'BREAK';
export type EndingId = 'SUMMONER_BLADE' | 'AWAKENED';
export type RaceId = 'human' | 'dark_elf' | 'undead_outsider';
export type ClassId = 'brawler' | 'iron_vanguard' | 'spellblade';

export interface TraitConfig {
  id: string;
  name: string;
  description: string;
  healBonus?: number;
  lucidityGainBonus?: number;
  maxTriggersPerTurn?: number;
  flatDamageReduction?: number;
  comboBonusDamage?: number;
  waitDamageMultiplier?: number;
  riposteBonusDamage?: number;
  fullHpBonusDamage?: number;
}

export interface RaceConfig {
  id: RaceId;
  name: string;
  systemLabel: string;
  systemNote?: string;
  description: string;
  maxHpBonus: number;
  attackBonus: number;
  trait: TraitConfig;
}

export interface ClassConfig {
  id: ClassId;
  name: string;
  description: string;
  maxHpBonus: number;
  attackBonus: number;
  trait: TraitConfig;
}

export interface ModifierConfig {
  id: string;
  name: string;
  description: string;
  attackBonus: number;
  maxHpBonus: number;
  instantHeal: number;
}

export interface EntityJsonConfig {
  id: string;
  hp: number;
  maxHp: number;
  attack: number;
  roomId: string;
  startPosition: Position;
  faction?: Faction;
  aiBehavior?: AiBehavior;
  dropItemId?: string;
  canTalk?: boolean;
  talkDialogue?: string;
  talkDialogueWithBadge?: string;
}

export type PlayerAction =
  | { type: 'MOVE'; direction: Direction }
  | { type: 'WAIT' }
  | { type: 'USE_ITEM'; itemId: string }
  | { type: 'CHOOSE_FILTER'; choice: 'KEEP' | 'BREAK' }
  | { type: 'CHOOSE_BOSS_ACTION'; choice: 'SURRENDER' | 'FIGHT' };

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
  canTalk?: boolean;
  activeModifierIds?: string[];
  fleeCooldown: number;
  provoked: boolean;
  hasSpokenCombatBark?: boolean;
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
  filterChoice: FilterChoice;
  pendingFilterChoice: boolean;
  pendingBossChoice: boolean;
  endingId: EndingId | null;
  outpostLucidityAwarded: boolean;
  depotEntryLucidityAwarded: boolean;
  depotAmbientTriggered: boolean;
  keenSightTriggeredThisTurn: boolean;
  selectedRaceId: RaceId;
  selectedClassId: ClassId;
  lastAttackedTargetId: string | null;
  consecutiveHitsOnTarget: number;
  isGuardingFromWait: boolean;
  isRiposteReady: boolean;
}

export type AttackTraitId = 'combo_strike' | 'first_strike' | 'riposte_strike';

export type GameEvent =
  | { type: 'PLAYER_MOVED'; to: Position }
  | { type: 'PLAYER_WAITED' }
  | { type: 'ROOM_CHANGED'; fromRoomId: string; toRoomId: string; to: Position }
  | { type: 'ROOM_AMBIENT_OBSERVED'; roomId: string; position: Position }
  | {
      type: 'ATTACKED';
      attackerId: string;
      targetId: string;
      damage: number;
      targetRemainingHp: number;
      targetPosition?: Position;
      triggeredTraitId?: AttackTraitId;
      bonusDamage?: number;
    }
  | {
      type: 'ENEMY_ATTACKED';
      attackerId: string;
      damage: number;
      playerRemainingHp: number;
      attackerPosition?: Position;
      playerPosition?: Position;
      damageReduced?: number;
      flatDamageReduced?: number;
      riposteArmed?: boolean;
      /** @deprecated Temporary Step 1 compatibility; removed in Step 3. */
      counterDamage?: number;
      triggeredTraitId?: string;
    }
  | { type: 'GUARD_INTERVENED'; entityId: string }
  | { type: 'DIALOGUE_SPOKEN'; entityId: string }
  | { type: 'AI_FLED'; entityId: string; from: Position; to: Position }
  | { type: 'ENTITY_DIED'; entityId: string }
  | { type: 'PLAYER_DIED' }
  | { type: 'ITEM_DROPPED'; itemId: string; entityId: string; position: Position }
  | { type: 'ITEM_PICKED_UP'; itemId: string }
  | {
      type: 'ITEM_USED';
      itemId: string;
      healAmount: number;
      playerHp: number;
      playerPosition?: Position;
      triggeredTraitId?: string;
    }
  | { type: 'LUCIDITY_CHANGED'; amount: number; newLucidity: number }
  | { type: 'FILTER_THRESHOLD_REACHED'; lucidity: number }
  | { type: 'FILTER_CHOICE_MADE'; choice: 'KEEP' | 'BREAK'; appliedModifierId?: string }
  | { type: 'NPC_TALKED'; entityId: string; hasBadge?: boolean; raceId?: RaceId }
  | { type: 'BOSS_CHOICE_REACHED'; entityId: string }
  | { type: 'GAME_ENDED'; endingId: EndingId };
