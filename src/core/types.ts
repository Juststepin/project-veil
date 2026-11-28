import type { Direction, Position } from './grid';

export const MAX_INVENTORY_SLOTS = 6;

export type Faction = 'civilian' | 'empire_guard' | 'sanctum' | 'outlaw_deserter';
export type AiBehavior =
  | 'flee_when_hurt'
  | 'chase_and_attack'
  | 'guard_civilian'
  | 'checkpoint_boss'
  | 'inner_magistrate';

export type FilterChoice = 'UNDECIDED' | 'KEEP' | 'BREAK';
export type EndingId = 'SUMMONER_BLADE' | 'AWAKENED' | 'SOVEREIGN_PACT';
export type CheckpointResolution = 'UNRESOLVED' | 'ESCORTED' | 'BREACHED';
export type TribunalChoice = 'ACCEPT_DECREE' | 'PRESENT_RELIC' | 'DEFY_TRIBUNAL';
export type LegalStatus = 'UNREGISTERED' | 'CITIZEN' | 'ENVOY' | 'CONVICT' | 'OUTLAW';
export type HubNpcRole = 'market_smith' | 'penal_warden' | 'sewer_broker' | 'sanctum_agent';
export type HubActionChoice =
  | 'BUY_RATION'
  | 'CLAIM_FREE_SUPPLY'
  | 'REST_HEAL'
  | 'CLOSE_HUB_MENU';
export type TribunalTransitionResolution =
  | 'CITIZEN'
  | 'ENVOY'
  | 'CONVICT'
  | 'OUTLAW_ESCAPE';
export type GateLockReason =
  | 'CHECKPOINT_SEALED'
  | 'TRIBUNAL_IN_SESSION'
  | 'TRIBUNAL_CONCLUDED'
  | 'CONVICT_BARRED'
  | 'OUTLAW_LOCKDOWN'
  | 'EXPEDITION_UNBRIEFED';
export type RaceId = 'human' | 'dark_elf' | 'undead_outsider';
export type ClassId = 'brawler' | 'iron_vanguard' | 'spellblade';

export interface ImperialRecord {
  guardsKilled: number;
  civiliansKilled: number;
}

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
  isHubNpc?: boolean;
  hubRole?: HubNpcRole;
  talkDialogue?: string;
  talkDialogueWithBadge?: string;
}

export type PlayerAction =
  | { type: 'MOVE'; direction: Direction }
  | { type: 'WAIT' }
  | { type: 'USE_ITEM'; itemId: string }
  | { type: 'CHOOSE_FILTER'; choice: 'KEEP' | 'BREAK' }
  | { type: 'CHOOSE_BOSS_ACTION'; choice: 'SURRENDER' | 'FIGHT' }
  | { type: 'CHOOSE_TRIBUNAL_ACTION'; choice: TribunalChoice }
  | { type: 'CHOOSE_HUB_ACTION'; choice: HubActionChoice };

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
  isHubNpc?: boolean;
  hubRole?: HubNpcRole;
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
  silver: number;
  legalStatus: LegalStatus;
  hasAcceptedExpedition: boolean;
  claimedFreeSupplyIds: string[];
  activeHubNpcId: string | null;
  visitedAmbientRoomIds: string[];
  lucidity: number;
  isGameOver: boolean;
  filterChoice: FilterChoice;
  pendingFilterChoice: boolean;
  pendingBossChoice: boolean;
  pendingTribunalChoice: boolean;
  checkpointResolution: CheckpointResolution;
  imperialRecord: ImperialRecord;
  innerCourtAmbientTriggered: boolean;
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
  | {
      type: 'ROOM_AMBIENT_OBSERVED';
      roomId: string;
      position: Position;
      checkpointResolution?: CheckpointResolution;
    }
  | { type: 'GATE_LOCKED'; roomId: string; reason: GateLockReason }
  | { type: 'CHECKPOINT_BREACHED' }
  | { type: 'CHECKPOINT_ESCORTED'; toRoomId: string; to: Position }
  | {
      type: 'TRIBUNAL_TRANSITIONED';
      resolution: TribunalTransitionResolution;
      silverGranted: number;
      toRoomId: string;
      to: Position;
    }
  | {
      type: 'RELIC_ACTIVATED';
      mode: 'KEEP';
      healAmount: number;
      targetId?: string;
      damage?: number;
      targetPosition?: Position;
    }
  | {
      type: 'RELIC_ACTIVATED';
      mode: 'BREAK';
      healAmount: number;
      appliedModifierId: string;
    }
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
      triggeredTraitId?: string;
    }
  | { type: 'GUARD_INTERVENED'; entityId: string }
  | { type: 'DIALOGUE_SPOKEN'; entityId: string }
  | { type: 'AI_FLED'; entityId: string; from: Position; to: Position }
  | { type: 'ENTITY_DIED'; entityId: string }
  | { type: 'PLAYER_DIED' }
  | { type: 'ITEM_DROPPED'; itemId: string; entityId: string; position: Position }
  | { type: 'ITEM_PICKED_UP'; itemId: string }
  | { type: 'INVENTORY_FULL'; maxSlots: number }
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
  | {
      type: 'NPC_TALKED';
      entityId: string;
      hasBadge?: boolean;
      raceId?: RaceId;
      imperialRecord?: ImperialRecord;
      legalStatus?: LegalStatus;
    }
  | { type: 'BOSS_CHOICE_REACHED'; entityId: string }
  | { type: 'TRIBUNAL_CHOICE_REACHED'; entityId: string }
  | { type: 'HUB_SERVICE_OPENED'; entityId: string }
  | { type: 'HUB_SERVICE_CLOSED'; entityId: string }
  | {
      type: 'HUB_RATION_BOUGHT';
      entityId: string;
      itemId: string;
      cost: number;
      remainingSilver: number;
    }
  | {
      type: 'HUB_SUPPLY_CLAIMED';
      entityId: string;
      itemId: string;
    }
  | {
      type: 'HUB_RESTED';
      entityId: string;
      cost: number;
      healAmount: number;
      playerHp: number;
      maxHp: number;
      playerPosition: Position;
      remainingSilver: number;
    }
  | { type: 'EXPEDITION_DEPARTED'; fromRoomId: string; legalStatus: LegalStatus }
  | { type: 'GAME_ENDED'; endingId: EndingId };
