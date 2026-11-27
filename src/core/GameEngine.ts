import classesData from '../data/classes.json';
import entitiesData from '../data/entities.json';
import itemsData from '../data/items.json';
import modifiersData from '../data/modifiers.json';
import racesData from '../data/races.json';
import {
  findDoorAt,
  getManhattanDistance,
  getNextPosition,
  getTileType,
  GRID_SIZE,
  type Direction,
  type Position,
} from './grid';
import type {
  AttackTraitId,
  ClassConfig,
  ClassId,
  EntityJsonConfig,
  EntityState,
  GameEvent,
  GameState,
  GateLockReason,
  GroundItem,
  ModifierConfig,
  PlayerAction,
  RaceConfig,
  RaceId,
  TribunalChoice,
} from './types';

export type LuciditySource = 'natural' | 'debug' | 'forced_threshold';

const DEFAULT_RACE_ID: RaceId = 'human';
const DEFAULT_CLASS_ID: ClassId = 'brawler';
const MAX_LUCIDITY = 100;
const FILTER_THRESHOLD_LUCIDITY = 70;
const OUTPOST_ROOM_ID = 'room_outpost';
const DEPOT_ROOM_ID = 'room_depot';
const CHECKPOINT_ROOM_ID = 'room_checkpoint';
const INNER_COURT_ROOM_ID = 'room_inner_court';
const DEPOT_AMBIENT_MAX_X = 3;
const SUMMONER_BLESSING_ID = 'summoner_blessing';
const RELIC_CLARITY_ID = 'relic_clarity';
const WORLD_RELIC_ID = 'world_relic';
const PATROL_01_ENTITY_ID = 'patrol_01';
const COURIER_01_ENTITY_ID = 'courier_01';
const PATROL_02_ENTITY_ID = 'patrol_02';
const CAPTAIN_ENTITY_ID = 'captain_01';
const MERCHANT_ENTITY_ID = 'merchant_01';
const MAGISTRATE_ENTITY_ID = 'magistrate_01';
const SCRIBE_ENTITY_ID = 'scribe_01';
const HEALING_TONIC_ID = 'healing_tonic';
const PATROL_BADGE_ID = 'patrol_badge';
const LUCIDITY_ON_OUTPOST_MILESTONE = 15;
const LUCIDITY_ON_ENTER_DEPOT = 15;
const LUCIDITY_ON_ATTACK_CIVILIAN = 10;
const LUCIDITY_ON_GUARD_INTERVENED = 15;
const LUCIDITY_ON_PICKUP_BY_ITEM: Record<string, number> = {
  warm_bread: 20,
  patrol_badge: 25,
};
const ALL_DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

interface ItemJsonConfig {
  id: string;
  healAmount?: number;
  isWorldRelic?: boolean;
  keepDamage?: number;
  keepHeal?: number;
  breakModifierId?: string;
}

const ITEMS = itemsData as Record<string, ItemJsonConfig>;
const MODIFIERS = modifiersData as Record<string, ModifierConfig>;
const RACES = racesData as Record<RaceId, RaceConfig>;
const CLASSES = classesData as Record<ClassId, ClassConfig>;

function createEntityFromConfig(config: EntityJsonConfig): EntityState {
  return {
    id: config.id,
    hp: config.hp,
    maxHp: config.maxHp,
    attack: config.attack,
    roomId: config.roomId,
    position: { ...config.startPosition },
    faction: config.faction,
    aiBehavior: config.aiBehavior,
    dropItemId: config.dropItemId,
    canTalk: config.canTalk,
    activeModifierIds: config.id === 'player' ? [] : undefined,
    fleeCooldown: 0,
    provoked: false,
    hasSpokenCombatBark: false,
  };
}

export function createInitialState(
  raceId: RaceId = DEFAULT_RACE_ID,
  classId: ClassId = DEFAULT_CLASS_ID,
): GameState {
  const catalog = entitiesData as Record<string, EntityJsonConfig>;
  const player = createEntityFromConfig(catalog.player);
  const race = RACES[raceId];
  const playerClass = CLASSES[classId];

  player.maxHp =
    catalog.player.maxHp + (race?.maxHpBonus ?? 0) + (playerClass?.maxHpBonus ?? 0);
  player.hp = player.maxHp;

  const npcEntities = Object.values(catalog)
    .filter((entry) => entry.id !== 'player')
    .map((entry) => createEntityFromConfig(entry));

  return {
    currentRoomId: player.roomId,
    player,
    entities: npcEntities,
    groundItems: [],
    inventory: [WORLD_RELIC_ID],
    lucidity: 0,
    isGameOver: false,
    filterChoice: 'UNDECIDED',
    pendingFilterChoice: false,
    pendingBossChoice: false,
    pendingTribunalChoice: false,
    checkpointResolution: 'UNRESOLVED',
    imperialRecord: { guardsKilled: 0, civiliansKilled: 0 },
    innerCourtAmbientTriggered: false,
    endingId: null,
    outpostLucidityAwarded: false,
    depotEntryLucidityAwarded: false,
    depotAmbientTriggered: false,
    keenSightTriggeredThisTurn: false,
    selectedRaceId: raceId,
    selectedClassId: classId,
    lastAttackedTargetId: null,
    consecutiveHitsOnTarget: 0,
    isGuardingFromWait: false,
    isRiposteReady: false,
  };
}

export class GameEngine {
  private state: GameState;
  private syncedProvokedByEntity: Record<string, boolean> = {};

  constructor(
    raceId: RaceId = DEFAULT_RACE_ID,
    classId: ClassId = DEFAULT_CLASS_ID,
  ) {
    this.state = createInitialState(raceId, classId);
    this.syncProvokedSnapshot();
  }

  getState(): GameState {
    return this.state;
  }

  reset(raceId?: RaceId, classId?: ClassId): void {
    const nextRaceId = raceId ?? this.state.selectedRaceId;
    const nextClassId = classId ?? this.state.selectedClassId;
    this.state = createInitialState(nextRaceId, nextClassId);
    this.syncProvokedSnapshot();
  }

  setBuildAndReset(raceId: RaceId, classId: ClassId): void {
    this.reset(raceId, classId);
  }

  private syncProvokedSnapshot(): void {
    this.syncedProvokedByEntity = {};
    for (const entity of this.state.entities) {
      this.syncedProvokedByEntity[entity.id] = entity.provoked;
    }
  }

  private syncExternalProvokedChanges(): void {
    for (const entity of this.state.entities) {
      if (this.syncedProvokedByEntity[entity.id] !== entity.provoked) {
        entity.hasSpokenCombatBark = false;
        this.syncedProvokedByEntity[entity.id] = entity.provoked;
      }
    }
  }

  private setEntityProvoked(entity: EntityState, nextProvoked: boolean): void {
    if (entity.provoked !== nextProvoked) {
      entity.provoked = nextProvoked;
      entity.hasSpokenCombatBark = false;
    }
    this.syncedProvokedByEntity[entity.id] = entity.provoked;
  }

  private getSelectedRace(): RaceConfig {
    return RACES[this.state.selectedRaceId];
  }

  private getSelectedClass(): ClassConfig {
    return CLASSES[this.state.selectedClassId];
  }

  public getEffectiveAttack(entity: EntityState): number {
    const modifierIds = entity.activeModifierIds ?? [];
    let attackBonus = 0;

    if (entity.id === this.state.player.id) {
      attackBonus +=
        (this.getSelectedRace()?.attackBonus ?? 0) +
        (this.getSelectedClass()?.attackBonus ?? 0);
    }

    for (const modifierId of modifierIds) {
      const modifier = MODIFIERS[modifierId];
      if (modifier) {
        attackBonus += modifier.attackBonus;
      }
    }

    return entity.attack + attackBonus;
  }

  debugAddLucidity(amount = 15): GameEvent[] {
    if (this.state.isGameOver || this.state.endingId !== null) {
      return [];
    }

    const events: GameEvent[] = [];
    this.addLucidity(amount, 'debug', events);
    this.checkFilterThreshold(events);
    return events;
  }

  handleAction(input: PlayerAction | Direction): GameEvent[] {
    if (
      this.state.isGameOver ||
      this.state.endingId !== null ||
      this.state.player.hp <= 0
    ) {
      return [];
    }

    this.syncExternalProvokedChanges();

    const action: PlayerAction =
      typeof input === 'string' ? { type: 'MOVE', direction: input } : input;

    if (this.state.pendingTribunalChoice) {
      if (action.type !== 'CHOOSE_TRIBUNAL_ACTION') {
        return [];
      }
      const events: GameEvent[] = [];
      this.handleChooseTribunalAction(action.choice, events);
      return events;
    }

    if (action.type === 'CHOOSE_TRIBUNAL_ACTION') {
      return [];
    }

    if (this.state.pendingBossChoice) {
      if (action.type !== 'CHOOSE_BOSS_ACTION') {
        return [];
      }
      const events: GameEvent[] = [];
      this.handleChooseBossAction(action.choice, events);
      return events;
    }

    if (action.type === 'CHOOSE_BOSS_ACTION') {
      return [];
    }

    if (this.state.pendingFilterChoice) {
      if (action.type !== 'CHOOSE_FILTER') {
        return [];
      }
      const events: GameEvent[] = [];
      this.handleChooseFilter(action.choice, events);
      return events;
    }

    if (action.type === 'CHOOSE_FILTER') {
      return [];
    }

    const events: GameEvent[] = [];

    if (action.type === 'WAIT') {
      this.state.keenSightTriggeredThisTurn = false;
      this.state.isGuardingFromWait =
        this.getSelectedClass().trait.waitDamageMultiplier !== undefined;
      events.push({ type: 'PLAYER_WAITED' });
      return this.finishPlayerTurn(events);
    }

    if (action.type === 'USE_ITEM') {
      const used = this.handleUseItem(action.itemId, events);
      if (!used) return [];
      this.state.keenSightTriggeredThisTurn = false;
      this.state.isGuardingFromWait = false;
      return this.finishPlayerTurn(events);
    }

    const roomId = this.state.currentRoomId;
    const nextPos = getNextPosition(this.state.player.position, action.direction);
    const tile = getTileType(roomId, nextPos.x, nextPos.y);

    if (tile === 'WALL' || tile === 'OBSTACLE') {
      return [];
    }

    if (tile === 'DOOR') {
      const door = findDoorAt(roomId, nextPos);
      if (!door) return [];
      const gateLockReason = this.getGateLockReason(roomId, nextPos);
      if (gateLockReason) {
        return [{ type: 'GATE_LOCKED', roomId, reason: gateLockReason }];
      }
      this.state.keenSightTriggeredThisTurn = false;
      const changed = this.handleRoomTransition(nextPos, events);
      if (!changed) return [];
      this.state.isGuardingFromWait = false;
      return this.finishPlayerTurn(events);
    }

    this.state.keenSightTriggeredThisTurn = false;
    this.state.isGuardingFromWait = false;

    const target = this.findEntityAt(roomId, nextPos);
    if (target) {
      if (this.canTalkTo(target)) {
        this.handleTalk(target, events);
      } else {
        this.handleAttack(target, events);
      }
    } else {
      this.handleMoveAndPickup(nextPos, events);
    }

    return this.finishPlayerTurn(events);
  }

  private getGateLockReason(roomId: string, doorPos: Position): GateLockReason | null {
    if (
      roomId === CHECKPOINT_ROOM_ID &&
      doorPos.x === 7 &&
      doorPos.y === 3 &&
      this.state.checkpointResolution === 'UNRESOLVED'
    ) {
      return 'CHECKPOINT_SEALED';
    }
    if (
      roomId === INNER_COURT_ROOM_ID &&
      doorPos.x === 0 &&
      doorPos.y === 3 &&
      this.state.checkpointResolution === 'ESCORTED'
    ) {
      return 'TRIBUNAL_IN_SESSION';
    }
    return null;
  }

  private finishPlayerTurn(events: GameEvent[]): GameEvent[] {
    this.checkFilterThreshold(events);
    if (
      !this.state.pendingFilterChoice &&
      !this.state.pendingBossChoice &&
      !this.state.pendingTribunalChoice &&
      this.state.endingId === null &&
      !this.state.isGameOver
    ) {
      this.runRoomAi(events);
      this.checkFilterThreshold(events);
    }
    return events;
  }

  private canTalkTo(target: EntityState): boolean {
    if (
      target.aiBehavior === 'inner_magistrate' &&
      this.state.checkpointResolution === 'BREACHED'
    ) {
      return false;
    }
    return (
      this.state.filterChoice === 'BREAK' &&
      target.canTalk === true &&
      target.provoked === false
    );
  }

  private handleTalk(target: EntityState, events: GameEvent[]): void {
    this.state.isGuardingFromWait = false;
    const hasBadge = this.state.inventory.includes(PATROL_BADGE_ID);
    const isCaptain = target.id === CAPTAIN_ENTITY_ID;
    const isMagistrate = target.id === MAGISTRATE_ENTITY_ID;

    events.push({
      type: 'NPC_TALKED',
      entityId: target.id,
      hasBadge,
      ...(isCaptain || isMagistrate ? { raceId: this.state.selectedRaceId } : {}),
      ...(isMagistrate
        ? { imperialRecord: { ...this.state.imperialRecord } }
        : {}),
    });

    if (isCaptain) {
      this.state.pendingBossChoice = true;
      events.push({
        type: 'BOSS_CHOICE_REACHED',
        entityId: target.id,
      });
      return;
    }

    if (isMagistrate) {
      this.state.pendingTribunalChoice = true;
      events.push({
        type: 'TRIBUNAL_CHOICE_REACHED',
        entityId: target.id,
      });
    }
  }

  private handleChooseBossAction(
    choice: 'SURRENDER' | 'FIGHT',
    events: GameEvent[],
  ): void {
    if (
      !this.state.pendingBossChoice ||
      this.state.endingId !== null ||
      this.state.isGameOver ||
      this.state.player.hp <= 0
    ) {
      return;
    }

    this.state.pendingBossChoice = false;

    if (choice === 'SURRENDER') {
      const fromRoomId = this.state.currentRoomId;
      const safePos = this.findSafeSpawnPosition(INNER_COURT_ROOM_ID, { x: 1, y: 3 });

      this.state.checkpointResolution = 'ESCORTED';
      this.state.currentRoomId = INNER_COURT_ROOM_ID;
      this.state.player.roomId = INNER_COURT_ROOM_ID;
      this.state.player.position = { ...safePos };
      this.state.lastAttackedTargetId = null;
      this.state.consecutiveHitsOnTarget = 0;
      this.state.keenSightTriggeredThisTurn = false;
      this.state.isGuardingFromWait = false;
      this.state.isRiposteReady = false;

      for (const entity of this.state.entities) {
        entity.hasSpokenCombatBark = false;
      }

      events.push({
        type: 'CHECKPOINT_ESCORTED',
        toRoomId: INNER_COURT_ROOM_ID,
        to: { ...safePos },
      });
      events.push({
        type: 'ROOM_CHANGED',
        fromRoomId,
        toRoomId: INNER_COURT_ROOM_ID,
        to: { ...safePos },
      });

      this.pickupItemAt(INNER_COURT_ROOM_ID, safePos, events);
      this.tryTriggerInnerCourtAmbient(events);
      return;
    }

    this.state.keenSightTriggeredThisTurn = false;
    this.state.isGuardingFromWait = false;
    const captain = this.state.entities.find(
      (entity) =>
        entity.id === CAPTAIN_ENTITY_ID &&
        entity.roomId === this.state.currentRoomId &&
        entity.hp > 0,
    );
    if (!captain) {
      return;
    }

    this.setEntityProvoked(captain, true);
    this.handleAttack(captain, events);
    this.finishPlayerTurn(events);
  }

  private handleChooseTribunalAction(
    choice: TribunalChoice,
    events: GameEvent[],
  ): void {
    if (
      !this.state.pendingTribunalChoice ||
      this.state.endingId !== null ||
      this.state.isGameOver ||
      this.state.player.hp <= 0
    ) {
      return;
    }

    if (choice === 'PRESENT_RELIC') {
      const relicIndex = this.state.inventory.indexOf(WORLD_RELIC_ID);
      if (this.state.imperialRecord.civiliansKilled > 0 || relicIndex === -1) {
        return;
      }
      this.state.pendingTribunalChoice = false;
      this.state.inventory.splice(relicIndex, 1);
      this.state.endingId = 'SOVEREIGN_PACT';
      events.push({ type: 'GAME_ENDED', endingId: 'SOVEREIGN_PACT' });
      return;
    }

    if (choice === 'ACCEPT_DECREE') {
      this.state.pendingTribunalChoice = false;
      this.state.endingId = 'AWAKENED';
      events.push({ type: 'GAME_ENDED', endingId: 'AWAKENED' });
      return;
    }

    this.state.pendingTribunalChoice = false;
    this.state.keenSightTriggeredThisTurn = false;
    this.state.isGuardingFromWait = false;
    const magistrate = this.state.entities.find(
      (entity) =>
        entity.id === MAGISTRATE_ENTITY_ID &&
        entity.roomId === this.state.currentRoomId &&
        entity.hp > 0,
    );
    if (!magistrate) {
      return;
    }

    this.setEntityProvoked(magistrate, true);
    this.handleAttack(magistrate, events);
    this.finishPlayerTurn(events);
  }

  private handleChooseFilter(choice: 'KEEP' | 'BREAK', events: GameEvent[]): void {
    if (!this.state.pendingFilterChoice || this.state.filterChoice !== 'UNDECIDED') {
      return;
    }

    this.state.filterChoice = choice;
    this.state.pendingFilterChoice = false;

    if (choice === 'KEEP') {
      const modifier = MODIFIERS[SUMMONER_BLESSING_ID];
      if (modifier) {
        const activeModifiers = this.state.player.activeModifierIds ?? [];
        if (!activeModifiers.includes(modifier.id)) {
          activeModifiers.push(modifier.id);
        }
        this.state.player.activeModifierIds = activeModifiers;
        this.state.player.maxHp += modifier.maxHpBonus;
        this.state.player.hp = Math.min(
          this.state.player.maxHp,
          this.state.player.hp + modifier.instantHeal,
        );
      }

      for (const bossId of [CAPTAIN_ENTITY_ID, MAGISTRATE_ENTITY_ID]) {
        const boss = this.state.entities.find(
          (entity) => entity.id === bossId && entity.hp > 0,
        );
        if (boss) {
          this.setEntityProvoked(boss, true);
        }
      }

      events.push({
        type: 'FILTER_CHOICE_MADE',
        choice: 'KEEP',
        appliedModifierId: SUMMONER_BLESSING_ID,
      });
      return;
    }

    const patrol01 = this.state.entities.find(
      (entity) =>
        entity.id === PATROL_01_ENTITY_ID &&
        entity.hp > 0 &&
        entity.hp === entity.maxHp,
    );
    if (patrol01) {
      this.setEntityProvoked(patrol01, false);
    }

    events.push({
      type: 'FILTER_CHOICE_MADE',
      choice: 'BREAK',
    });
  }

  private checkFilterThreshold(events: GameEvent[]): void {
    if (
      this.state.lucidity >= FILTER_THRESHOLD_LUCIDITY &&
      this.state.filterChoice === 'UNDECIDED' &&
      !this.state.pendingFilterChoice &&
      !this.state.isGameOver &&
      this.state.endingId === null
    ) {
      this.state.pendingFilterChoice = true;
      events.push({
        type: 'FILTER_THRESHOLD_REACHED',
        lucidity: this.state.lucidity,
      });
    }
  }

  private handleUseItem(itemId: string, events: GameEvent[]): boolean {
    const index = this.state.inventory.indexOf(itemId);
    const itemConfig = ITEMS[itemId];
    if (index === -1 || !itemConfig) {
      return false;
    }

    if (itemConfig.isWorldRelic) {
      return this.handleUseWorldRelic(index, itemConfig, events);
    }

    if (!itemConfig.healAmount || itemConfig.healAmount <= 0) {
      return false;
    }
    if (this.state.player.hp >= this.state.player.maxHp) {
      return false;
    }

    const raceTrait = this.getSelectedRace().trait;
    const healBonus = raceTrait.healBonus ?? 0;
    const oldHp = this.state.player.hp;
    const newHp = Math.min(
      this.state.player.maxHp,
      oldHp + itemConfig.healAmount + healBonus,
    );
    const actualHeal = newHp - oldHp;

    this.state.inventory.splice(index, 1);
    this.state.player.hp = newHp;

    events.push({
      type: 'ITEM_USED',
      itemId,
      healAmount: actualHeal,
      playerHp: this.state.player.hp,
      playerPosition: { ...this.state.player.position },
      ...(healBonus > 0 && actualHeal > 0 ? { triggeredTraitId: raceTrait.id } : {}),
    });
    return true;
  }

  private handleUseWorldRelic(
    inventoryIndex: number,
    itemConfig: ItemJsonConfig,
    events: GameEvent[],
  ): boolean {
    if (this.state.filterChoice === 'UNDECIDED') {
      return false;
    }

    this.state.inventory.splice(inventoryIndex, 1);

    if (this.state.filterChoice === 'KEEP') {
      const keepHeal = itemConfig.keepHeal ?? 20;
      const oldHp = this.state.player.hp;
      this.state.player.hp = Math.min(this.state.player.maxHp, oldHp + keepHeal);
      const actualHeal = this.state.player.hp - oldHp;

      const target = this.findNearestRelicTarget(this.state.currentRoomId);
      if (!target) {
        events.push({
          type: 'RELIC_ACTIVATED',
          mode: 'KEEP',
          healAmount: actualHeal,
        });
        return true;
      }

      const damage = itemConfig.keepDamage ?? 35;
      const targetPosition: Position = { ...target.position };
      target.hp = Math.max(0, target.hp - damage);

      events.push({
        type: 'RELIC_ACTIVATED',
        mode: 'KEEP',
        healAmount: actualHeal,
        targetId: target.id,
        damage,
        targetPosition,
      });

      this.applyAttackConsequences(target, events);
      return true;
    }

    const modifierId = itemConfig.breakModifierId ?? RELIC_CLARITY_ID;
    const modifier = MODIFIERS[modifierId];
    const oldHp = this.state.player.hp;
    if (modifier) {
      const activeModifiers = this.state.player.activeModifierIds ?? [];
      if (!activeModifiers.includes(modifier.id)) {
        activeModifiers.push(modifier.id);
      }
      this.state.player.activeModifierIds = activeModifiers;
      this.state.player.maxHp += modifier.maxHpBonus;
      this.state.player.hp = Math.min(
        this.state.player.maxHp,
        oldHp + modifier.instantHeal,
      );
    }
    const actualHeal = this.state.player.hp - oldHp;

    events.push({
      type: 'RELIC_ACTIVATED',
      mode: 'BREAK',
      healAmount: actualHeal,
      appliedModifierId: modifierId,
    });
    return true;
  }

  private findNearestRelicTarget(roomId: string): EntityState | undefined {
    const playerPos = this.state.player.position;
    let bestTarget: EntityState | undefined;
    let bestDist = Infinity;

    for (const entity of this.state.entities) {
      if (entity.roomId !== roomId || entity.hp <= 0) continue;
      const dist = getManhattanDistance(playerPos, entity.position);
      if (
        dist < bestDist ||
        (dist === bestDist &&
          entity.faction === 'empire_guard' &&
          bestTarget?.faction !== 'empire_guard')
      ) {
        bestDist = dist;
        bestTarget = entity;
      }
    }

    return bestTarget;
  }

  private handleRoomTransition(doorPos: Position, events: GameEvent[]): boolean {
    const fromRoomId = this.state.currentRoomId;
    const door = findDoorAt(fromRoomId, doorPos);
    if (!door) return false;

    const safePos = this.findSafeSpawnPosition(door.targetRoomId, door.spawnPosition);
    this.state.currentRoomId = door.targetRoomId;
    this.state.player.roomId = door.targetRoomId;
    this.state.player.position = safePos;
    this.state.lastAttackedTargetId = null;
    this.state.consecutiveHitsOnTarget = 0;
    this.state.isRiposteReady = false;

    for (const entity of this.state.entities) {
      entity.hasSpokenCombatBark = false;
    }

    events.push({
      type: 'ROOM_CHANGED',
      fromRoomId,
      toRoomId: door.targetRoomId,
      to: { ...safePos },
    });

    this.pickupItemAt(door.targetRoomId, safePos, events);

    if (door.targetRoomId === DEPOT_ROOM_ID) {
      this.awardDepotEntryLucidityOnce(events);
      this.tryTriggerDepotAmbient(events);
    }

    if (
      door.targetRoomId === CHECKPOINT_ROOM_ID &&
      this.state.filterChoice === 'UNDECIDED' &&
      this.state.lucidity < FILTER_THRESHOLD_LUCIDITY
    ) {
      this.addLucidity(
        FILTER_THRESHOLD_LUCIDITY - this.state.lucidity,
        'forced_threshold',
        events,
      );
    }

    if (door.targetRoomId === INNER_COURT_ROOM_ID) {
      this.tryTriggerInnerCourtAmbient(events);
    }

    return true;
  }

  private awardDepotEntryLucidityOnce(events: GameEvent[]): void {
    if (this.state.depotEntryLucidityAwarded) return;
    this.state.depotEntryLucidityAwarded = true;
    this.addLucidity(LUCIDITY_ON_ENTER_DEPOT, 'natural', events);
  }

  private tryTriggerDepotAmbient(events: GameEvent[]): void {
    if (
      this.state.currentRoomId !== DEPOT_ROOM_ID ||
      this.state.player.position.x > DEPOT_AMBIENT_MAX_X ||
      this.state.depotAmbientTriggered ||
      this.state.filterChoice === 'KEEP'
    ) {
      return;
    }

    const courierAlive = this.state.entities.some(
      (entity) =>
        entity.id === COURIER_01_ENTITY_ID &&
        entity.roomId === DEPOT_ROOM_ID &&
        entity.hp > 0,
    );
    const patrol2Alive = this.state.entities.some(
      (entity) =>
        entity.id === PATROL_02_ENTITY_ID &&
        entity.roomId === DEPOT_ROOM_ID &&
        entity.hp > 0,
    );

    if (!courierAlive || !patrol2Alive) {
      return;
    }

    this.awardDepotEntryLucidityOnce(events);
    this.state.depotAmbientTriggered = true;
    events.push({
      type: 'ROOM_AMBIENT_OBSERVED',
      roomId: DEPOT_ROOM_ID,
      position: { ...this.state.player.position },
    });
  }

  private tryTriggerInnerCourtAmbient(events: GameEvent[]): void {
    if (
      this.state.currentRoomId !== INNER_COURT_ROOM_ID ||
      this.state.innerCourtAmbientTriggered
    ) {
      return;
    }

    const magistrateAlive = this.state.entities.some(
      (entity) =>
        entity.id === MAGISTRATE_ENTITY_ID &&
        entity.roomId === INNER_COURT_ROOM_ID &&
        entity.hp > 0,
    );
    const scribeAlive = this.state.entities.some(
      (entity) =>
        entity.id === SCRIBE_ENTITY_ID &&
        entity.roomId === INNER_COURT_ROOM_ID &&
        entity.hp > 0,
    );

    if (!magistrateAlive || !scribeAlive) {
      return;
    }

    this.state.innerCourtAmbientTriggered = true;
    events.push({
      type: 'ROOM_AMBIENT_OBSERVED',
      roomId: INNER_COURT_ROOM_ID,
      position: { ...this.state.player.position },
      checkpointResolution: this.state.checkpointResolution,
    });
  }

  private findSafeSpawnPosition(roomId: string, preferred: Position): Position {
    if (
      getTileType(roomId, preferred.x, preferred.y) === 'FLOOR' &&
      !this.findEntityAt(roomId, preferred)
    ) {
      return { ...preferred };
    }

    let bestPos: Position = { ...preferred };
    let bestDistance = Infinity;

    for (let y = 1; y < GRID_SIZE - 1; y++) {
      for (let x = 1; x < GRID_SIZE - 1; x++) {
        if (getTileType(roomId, x, y) !== 'FLOOR') continue;
        const candidate = { x, y };
        if (this.findEntityAt(roomId, candidate)) continue;

        const dist = getManhattanDistance(preferred, candidate);
        if (dist < bestDistance) {
          bestDistance = dist;
          bestPos = candidate;
        }
      }
    }

    return bestPos;
  }

  private handleAttack(target: EntityState, events: GameEvent[]): void {
    if (this.state.lastAttackedTargetId === target.id) {
      this.state.consecutiveHitsOnTarget += 1;
    } else {
      this.state.lastAttackedTargetId = target.id;
      this.state.consecutiveHitsOnTarget = 1;
    }

    const classTrait = this.getSelectedClass().trait;
    let bonusDamage = 0;
    let triggeredTraitId: AttackTraitId | undefined;

    if (this.state.isRiposteReady) {
      this.state.isRiposteReady = false;
      const riposteBonus = classTrait.riposteBonusDamage ?? 10;
      if (riposteBonus > 0) {
        bonusDamage = riposteBonus;
        triggeredTraitId = 'riposte_strike';
      }
    } else if (classTrait.fullHpBonusDamage && target.hp === target.maxHp) {
      bonusDamage = classTrait.fullHpBonusDamage;
      triggeredTraitId = 'first_strike';
    } else if (
      classTrait.comboBonusDamage &&
      this.state.consecutiveHitsOnTarget > 0 &&
      this.state.consecutiveHitsOnTarget % 2 === 0
    ) {
      bonusDamage = classTrait.comboBonusDamage;
      triggeredTraitId = 'combo_strike';
    }

    const damage = this.getEffectiveAttack(this.state.player) + bonusDamage;
    const targetPosition: Position = { ...target.position };
    target.hp = Math.max(0, target.hp - damage);

    events.push({
      type: 'ATTACKED',
      attackerId: this.state.player.id,
      targetId: target.id,
      damage,
      targetRemainingHp: target.hp,
      targetPosition,
      ...(triggeredTraitId ? { triggeredTraitId, bonusDamage } : {}),
    });

    this.applyAttackConsequences(target, events);
  }

  private applyAttackConsequences(target: EntityState, events: GameEvent[]): void {
    let triggeredDirectGuard = false;
    if (target.aiBehavior === 'guard_civilian' && !target.provoked) {
      triggeredDirectGuard = true;
      this.setEntityProvoked(target, true);
      target.hasSpokenCombatBark = true;
      events.push({ type: 'GUARD_INTERVENED', entityId: target.id });
      this.addLucidity(LUCIDITY_ON_GUARD_INTERVENED, 'natural', events);
    } else {
      this.setEntityProvoked(target, true);
    }

    if (
      target.roomId === CHECKPOINT_ROOM_ID &&
      (target.id === MERCHANT_ENTITY_ID || target.id === CAPTAIN_ENTITY_ID)
    ) {
      const captain = this.state.entities.find(
        (entity) => entity.id === CAPTAIN_ENTITY_ID && entity.hp > 0,
      );
      if (captain) {
        this.setEntityProvoked(captain, true);
      }
    }

    if (
      target.roomId === INNER_COURT_ROOM_ID &&
      (target.id === SCRIBE_ENTITY_ID || target.id === MAGISTRATE_ENTITY_ID)
    ) {
      const magistrate = this.state.entities.find(
        (entity) => entity.id === MAGISTRATE_ENTITY_ID && entity.hp > 0,
      );
      if (magistrate) {
        this.setEntityProvoked(magistrate, true);
      }
    }

    if (target.faction === 'civilian') {
      this.addLucidity(LUCIDITY_ON_ATTACK_CIVILIAN, 'natural', events);
      this.provokeGuardsInRoom(target.roomId, events);
    }

    if (target.hp === 0) {
      this.handleEntityDefeat(target, events);
    } else if (!triggeredDirectGuard) {
      this.emitCombatBarkOnce(target, events);
    }
  }

  private handleEntityDefeat(target: EntityState, events: GameEvent[]): void {
    events.push({ type: 'ENTITY_DIED', entityId: target.id });

    if (target.dropItemId) {
      this.state.groundItems.push({
        itemId: target.dropItemId,
        roomId: target.roomId,
        position: { ...target.position },
      });
      events.push({
        type: 'ITEM_DROPPED',
        itemId: target.dropItemId,
        entityId: target.id,
        position: { ...target.position },
      });
    }

    this.state.entities = this.state.entities.filter((entity) => entity.id !== target.id);

    if (target.faction === 'empire_guard') {
      this.state.imperialRecord.guardsKilled += 1;
    } else if (target.faction === 'civilian') {
      this.state.imperialRecord.civiliansKilled += 1;
    }

    if (target.id === PATROL_01_ENTITY_ID) {
      this.awardOutpostLucidityOnce(events);
    }

    if (target.id === CAPTAIN_ENTITY_ID) {
      this.state.checkpointResolution = 'BREACHED';
      const magistrate = this.state.entities.find(
        (entity) => entity.id === MAGISTRATE_ENTITY_ID && entity.hp > 0,
      );
      if (magistrate) {
        this.setEntityProvoked(magistrate, true);
      }
      events.push({ type: 'CHECKPOINT_BREACHED' });
      return;
    }

    if (target.id === MAGISTRATE_ENTITY_ID) {
      this.state.endingId = 'SUMMONER_BLADE';
      events.push({ type: 'GAME_ENDED', endingId: 'SUMMONER_BLADE' });
    }
  }

  private awardOutpostLucidityOnce(events: GameEvent[]): void {
    if (this.state.outpostLucidityAwarded) return;
    this.state.outpostLucidityAwarded = true;
    this.addLucidity(LUCIDITY_ON_OUTPOST_MILESTONE, 'natural', events);
  }

  private provokeGuardsInRoom(roomId: string, events: GameEvent[]): void {
    for (const entity of this.state.entities) {
      if (
        entity.roomId === roomId &&
        entity.hp > 0 &&
        entity.aiBehavior === 'guard_civilian' &&
        !entity.provoked
      ) {
        this.setEntityProvoked(entity, true);
        entity.hasSpokenCombatBark = true;
        events.push({ type: 'GUARD_INTERVENED', entityId: entity.id });
        this.addLucidity(LUCIDITY_ON_GUARD_INTERVENED, 'natural', events);
      }
    }
  }

  private handleMoveAndPickup(nextPos: Position, events: GameEvent[]): void {
    this.state.player.position = nextPos;
    events.push({ type: 'PLAYER_MOVED', to: { ...nextPos } });
    this.pickupItemAt(this.state.currentRoomId, nextPos, events);
    this.tryTriggerDepotAmbient(events);
  }

  private pickupItemAt(roomId: string, pos: Position, events: GameEvent[]): void {
    const remainingItems: GroundItem[] = [];
    const pickedItems: GroundItem[] = [];

    for (const item of this.state.groundItems) {
      if (
        item.roomId === roomId &&
        item.position.x === pos.x &&
        item.position.y === pos.y
      ) {
        pickedItems.push(item);
      } else {
        remainingItems.push(item);
      }
    }

    if (pickedItems.length === 0) return;

    this.state.groundItems = remainingItems;

    for (const pickedItem of pickedItems) {
      this.state.inventory.push(pickedItem.itemId);
      events.push({ type: 'ITEM_PICKED_UP', itemId: pickedItem.itemId });

      if (pickedItem.itemId === HEALING_TONIC_ID && roomId === OUTPOST_ROOM_ID) {
        this.awardOutpostLucidityOnce(events);
      }

      const lucidityGain = LUCIDITY_ON_PICKUP_BY_ITEM[pickedItem.itemId] ?? 0;
      if (lucidityGain > 0) {
        this.addLucidity(lucidityGain, 'natural', events);
      }
    }
  }

  private runRoomAi(events: GameEvent[]): void {
    if (this.state.isGameOver || this.state.endingId !== null) {
      return;
    }

    const roomId = this.state.currentRoomId;
    const roomEntities = this.state.entities.filter(
      (entity) => entity.roomId === roomId && entity.hp > 0,
    );

    for (const entity of roomEntities) {
      if (this.state.isGameOver || this.state.endingId !== null) break;

      if (entity.aiBehavior === 'flee_when_hurt') {
        this.runFleeingAi(entity, events);
      } else if (entity.aiBehavior === 'chase_and_attack') {
        if (this.state.filterChoice === 'BREAK' && !entity.provoked) {
          continue;
        }
        this.runChaseAndAttackAi(entity, events);
      } else if (entity.aiBehavior === 'guard_civilian') {
        this.runChaseAndAttackAi(entity, events);
      } else if (
        entity.aiBehavior === 'checkpoint_boss' &&
        roomId === CHECKPOINT_ROOM_ID
      ) {
        if (this.state.filterChoice === 'KEEP') {
          this.setEntityProvoked(entity, true);
        }
        this.runChaseAndAttackAi(entity, events);
      } else if (
        entity.aiBehavior === 'inner_magistrate' &&
        roomId === INNER_COURT_ROOM_ID
      ) {
        if (
          this.state.checkpointResolution === 'BREACHED' ||
          this.state.filterChoice === 'KEEP' ||
          entity.provoked
        ) {
          this.setEntityProvoked(entity, true);
        }
        this.runChaseAndAttackAi(entity, events);
      }

      if (this.state.isGameOver || this.state.endingId !== null) break;
    }
  }

  private runFleeingAi(entity: EntityState, events: GameEvent[]): void {
    const isAliveAndHurt = entity.hp > 0 && entity.hp < entity.maxHp;
    if (!isAliveAndHurt) return;

    if (entity.fleeCooldown > 0) {
      entity.fleeCooldown = 0;
      entity.lastPos = undefined;
      this.emitCombatBarkOnce(entity, events);
      return;
    }

    let bestPosition = entity.position;
    let maxDistance = getManhattanDistance(entity.position, this.state.player.position);

    for (const direction of ALL_DIRECTIONS) {
      const candidate = getNextPosition(entity.position, direction);
      if (!this.canEntityEnter(entity.roomId, candidate)) continue;

      const distance = getManhattanDistance(candidate, this.state.player.position);
      if (distance > maxDistance) {
        maxDistance = distance;
        bestPosition = candidate;
      }
    }

    const canMoveFurther =
      bestPosition.x !== entity.position.x || bestPosition.y !== entity.position.y;

    if (canMoveFurther) {
      const from = { ...entity.position };
      entity.lastPos = from;
      entity.position = bestPosition;
      entity.fleeCooldown = 1;
      this.emitCombatBarkOnce(entity, events);
      events.push({
        type: 'AI_FLED',
        entityId: entity.id,
        from,
        to: { ...bestPosition },
      });
    } else {
      entity.lastPos = undefined;
      this.emitCombatBarkOnce(entity, events);
    }
  }

  private runChaseAndAttackAi(entity: EntityState, events: GameEvent[]): void {
    const playerPos = this.state.player.position;
    const currentDist = getManhattanDistance(entity.position, playerPos);

    if (entity.aiBehavior === 'chase_and_attack' && currentDist <= 3) {
      if (!entity.provoked) {
        this.setEntityProvoked(entity, true);
        this.emitCombatBarkOnce(entity, events);
      }
    }

    if (!entity.provoked) {
      return;
    }

    if (currentDist === 1) {
      entity.lastPos = undefined;
      const rawDamage = entity.attack;
      let finalDamage = rawDamage;
      const classTrait = this.getSelectedClass().trait;
      const raceTrait = this.getSelectedRace().trait;

      let ironStanceTriggered = false;
      if (
        this.state.isGuardingFromWait &&
        classTrait.waitDamageMultiplier !== undefined
      ) {
        ironStanceTriggered = true;
        this.state.isGuardingFromWait = false;
        finalDamage = Math.floor(finalDamage * classTrait.waitDamageMultiplier);
      }

      let undyingFrameTriggered = false;
      let flatDamageReduced = 0;
      if (
        raceTrait.flatDamageReduction !== undefined &&
        raceTrait.flatDamageReduction > 0
      ) {
        const preFlatDamage = finalDamage;
        finalDamage = Math.max(1, finalDamage - raceTrait.flatDamageReduction);
        flatDamageReduced = Math.max(0, preFlatDamage - finalDamage);
        undyingFrameTriggered = flatDamageReduced > 0;
      }

      const damageReduced = Math.max(0, rawDamage - finalDamage);
      const triggeredTraitId = ironStanceTriggered
        ? classTrait.id
        : undyingFrameTriggered
          ? raceTrait.id
          : undefined;

      this.state.player.hp = Math.max(0, this.state.player.hp - finalDamage);
      const riposteArmed =
        ironStanceTriggered &&
        (classTrait.riposteBonusDamage ?? 0) > 0 &&
        this.state.player.hp > 0;
      if (riposteArmed) {
        this.state.isRiposteReady = true;
      }

      const attackerPosition: Position = { ...entity.position };
      const playerPosition: Position = { ...this.state.player.position };

      this.emitCombatBarkOnce(entity, events);

      events.push({
        type: 'ENEMY_ATTACKED',
        attackerId: entity.id,
        damage: finalDamage,
        playerRemainingHp: this.state.player.hp,
        attackerPosition,
        playerPosition,
        ...(damageReduced > 0 ? { damageReduced } : {}),
        ...(flatDamageReduced > 0 ? { flatDamageReduced } : {}),
        ...(riposteArmed ? { riposteArmed: true } : {}),
        ...(triggeredTraitId ? { triggeredTraitId } : {}),
      });

      if (this.state.player.hp === 0) {
        this.state.isGameOver = true;
        this.state.isRiposteReady = false;
        events.push({ type: 'PLAYER_DIED' });
      }
      return;
    }

    const validCandidates: Position[] = [];
    for (const direction of ALL_DIRECTIONS) {
      const candidate = getNextPosition(entity.position, direction);
      if (this.canEntityEnter(entity.roomId, candidate)) {
        validCandidates.push(candidate);
      }
    }

    if (validCandidates.length === 0) {
      entity.lastPos = undefined;
      return;
    }

    const withoutLastPos = validCandidates.filter(
      (pos) => !entity.lastPos || pos.x !== entity.lastPos.x || pos.y !== entity.lastPos.y,
    );
    const pool = withoutLastPos.length > 0 ? withoutLastPos : validCandidates;

    let bestPos: Position | null = null;
    let bestScore = Infinity;

    for (const candidate of pool) {
      const manhattan = getManhattanDistance(candidate, playerPos);
      if (manhattan > currentDist + 1) continue;

      const chebyshev = Math.max(
        Math.abs(candidate.x - playerPos.x),
        Math.abs(candidate.y - playerPos.y),
      );
      const score = manhattan * 10 + chebyshev;
      if (score < bestScore) {
        bestScore = score;
        bestPos = candidate;
      }
    }

    if (bestPos) {
      entity.lastPos = { ...entity.position };
      entity.position = bestPos;
    } else {
      entity.lastPos = undefined;
    }
  }

  private emitCombatBarkOnce(entity: EntityState, events: GameEvent[]): void {
    if (entity.hasSpokenCombatBark) return;
    entity.hasSpokenCombatBark = true;
    const alreadySpokeThisTurn = events.some(
      (event) =>
        (event.type === 'DIALOGUE_SPOKEN' || event.type === 'GUARD_INTERVENED') &&
        event.entityId === entity.id,
    );
    if (!alreadySpokeThisTurn) {
      events.push({ type: 'DIALOGUE_SPOKEN', entityId: entity.id });
    }
  }

  public addLucidity(
    amount: number,
    source: LuciditySource = 'natural',
    events: GameEvent[] = [],
  ): GameEvent[] {
    if (amount <= 0 || this.state.filterChoice === 'KEEP') {
      return events;
    }

    const raceTrait = this.getSelectedRace()?.trait;
    let lucidityBonus = 0;
    if (
      source === 'natural' &&
      raceTrait?.lucidityGainBonus &&
      raceTrait.lucidityGainBonus > 0
    ) {
      const hasPerTurnCap =
        raceTrait.maxTriggersPerTurn !== undefined &&
        raceTrait.maxTriggersPerTurn <= 1;
      if (!hasPerTurnCap || !this.state.keenSightTriggeredThisTurn) {
        lucidityBonus = raceTrait.lucidityGainBonus;
        if (hasPerTurnCap) {
          this.state.keenSightTriggeredThisTurn = true;
        }
      }
    }

    const newLucidity = Math.min(
      MAX_LUCIDITY,
      this.state.lucidity + amount + lucidityBonus,
    );
    const actualGain = newLucidity - this.state.lucidity;
    this.state.lucidity = newLucidity;

    if (actualGain > 0) {
      events.push({
        type: 'LUCIDITY_CHANGED',
        amount: actualGain,
        newLucidity,
      });
    }

    return events;
  }

  private canEntityEnter(roomId: string, pos: Position): boolean {
    if (getTileType(roomId, pos.x, pos.y) !== 'FLOOR') {
      return false;
    }
    if (
      this.state.player.roomId === roomId &&
      this.state.player.position.x === pos.x &&
      this.state.player.position.y === pos.y
    ) {
      return false;
    }
    return this.findEntityAt(roomId, pos) === undefined;
  }

  private findEntityAt(roomId: string, pos: Position): EntityState | undefined {
    return this.state.entities.find(
      (entity) =>
        entity.roomId === roomId &&
        entity.hp > 0 &&
        entity.position.x === pos.x &&
        entity.position.y === pos.y,
    );
  }
}
