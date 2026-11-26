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
  ClassConfig,
  ClassId,
  EntityJsonConfig,
  EntityState,
  GameEvent,
  GameState,
  GroundItem,
  ModifierConfig,
  PlayerAction,
  RaceConfig,
  RaceId,
} from './types';

export type LuciditySource = 'natural' | 'debug' | 'forced_threshold';

const DEFAULT_RACE_ID: RaceId = 'human';
const DEFAULT_CLASS_ID: ClassId = 'brawler';
const MAX_LUCIDITY = 100;
const FILTER_THRESHOLD_LUCIDITY = 70;
const DEPOT_ROOM_ID = 'room_depot';
const CHECKPOINT_ROOM_ID = 'room_checkpoint';
const SUMMONER_BLESSING_ID = 'summoner_blessing';
const PATROL_01_ENTITY_ID = 'patrol_01';
const CAPTAIN_ENTITY_ID = 'captain_01';
const MERCHANT_ENTITY_ID = 'merchant_01';
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
    inventory: [],
    lucidity: 0,
    isGameOver: false,
    filterChoice: 'UNDECIDED',
    pendingFilterChoice: false,
    endingId: null,
    outpostLucidityAwarded: false,
    depotEntryLucidityAwarded: false,
    selectedRaceId: raceId,
    selectedClassId: classId,
    lastAttackedTargetId: null,
    consecutiveHitsOnTarget: 0,
    isGuardingFromWait: false,
  };
}

export class GameEngine {
  private state: GameState;

  constructor(
    raceId: RaceId = DEFAULT_RACE_ID,
    classId: ClassId = DEFAULT_CLASS_ID,
  ) {
    this.state = createInitialState(raceId, classId);
  }

  getState(): GameState {
    return this.state;
  }

  reset(raceId?: RaceId, classId?: ClassId): void {
    const nextRaceId = raceId ?? this.state.selectedRaceId;
    const nextClassId = classId ?? this.state.selectedClassId;
    this.state = createInitialState(nextRaceId, nextClassId);
  }

  setBuildAndReset(raceId: RaceId, classId: ClassId): void {
    this.reset(raceId, classId);
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
    if (this.state.isGameOver || this.state.endingId !== null) {
      return [];
    }

    const action: PlayerAction =
      typeof input === 'string' ? { type: 'MOVE', direction: input } : input;

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
      this.state.isGuardingFromWait =
        this.getSelectedClass().trait.waitDamageMultiplier !== undefined;
      events.push({ type: 'PLAYER_WAITED' });
      return this.finishPlayerTurn(events);
    }

    if (action.type === 'USE_ITEM') {
      const used = this.handleUseItem(action.itemId, events);
      if (!used) return [];
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
      const changed = this.handleRoomTransition(nextPos, events);
      if (!changed) return [];
      this.state.isGuardingFromWait = false;
      return this.finishPlayerTurn(events);
    }

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

  private finishPlayerTurn(events: GameEvent[]): GameEvent[] {
    this.checkFilterThreshold(events);
    if (
      !this.state.pendingFilterChoice &&
      this.state.endingId === null &&
      !this.state.isGameOver
    ) {
      this.runRoomAi(events);
      this.checkFilterThreshold(events);
    }
    return events;
  }

  private canTalkTo(target: EntityState): boolean {
    return (
      this.state.filterChoice === 'BREAK' &&
      target.canTalk === true &&
      target.provoked === false
    );
  }

  private handleTalk(target: EntityState, events: GameEvent[]): void {
    const hasBadge = this.state.inventory.includes(PATROL_BADGE_ID);
    events.push({
      type: 'NPC_TALKED',
      entityId: target.id,
      hasBadge,
    });

    if (target.id === CAPTAIN_ENTITY_ID) {
      this.state.endingId = 'AWAKENED';
      events.push({ type: 'GAME_ENDED', endingId: 'AWAKENED' });
    }
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

      const captain = this.state.entities.find(
        (entity) => entity.id === CAPTAIN_ENTITY_ID && entity.hp > 0,
      );
      if (captain) {
        captain.provoked = true;
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
      patrol01.provoked = false;
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
    if (index === -1 || !itemConfig?.healAmount || itemConfig.healAmount <= 0) {
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
      ...(healBonus > 0 && actualHeal > 0 ? { triggeredTraitId: raceTrait.id } : {}),
    });
    return true;
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

    events.push({
      type: 'ROOM_CHANGED',
      fromRoomId,
      toRoomId: door.targetRoomId,
      to: { ...safePos },
    });

    this.pickupItemAt(door.targetRoomId, safePos, events);

    if (
      door.targetRoomId === DEPOT_ROOM_ID &&
      !this.state.depotEntryLucidityAwarded
    ) {
      this.state.depotEntryLucidityAwarded = true;
      this.addLucidity(LUCIDITY_ON_ENTER_DEPOT, 'natural', events);
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

    return true;
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
    let triggeredTraitId: string | undefined;

    if (classTrait.fullHpBonusDamage && target.hp === target.maxHp) {
      bonusDamage = classTrait.fullHpBonusDamage;
      triggeredTraitId = classTrait.id;
    } else if (
      classTrait.comboBonusDamage &&
      this.state.consecutiveHitsOnTarget > 0 &&
      this.state.consecutiveHitsOnTarget % 2 === 0
    ) {
      bonusDamage = classTrait.comboBonusDamage;
      triggeredTraitId = classTrait.id;
    }

    const damage = this.getEffectiveAttack(this.state.player) + bonusDamage;
    target.hp = Math.max(0, target.hp - damage);

    events.push({
      type: 'ATTACKED',
      attackerId: this.state.player.id,
      targetId: target.id,
      damage,
      targetRemainingHp: target.hp,
      ...(triggeredTraitId ? { triggeredTraitId, bonusDamage } : {}),
    });

    let triggeredDirectGuard = false;
    if (target.aiBehavior === 'guard_civilian' && !target.provoked) {
      triggeredDirectGuard = true;
      events.push({ type: 'GUARD_INTERVENED', entityId: target.id });
      this.addLucidity(LUCIDITY_ON_GUARD_INTERVENED, 'natural', events);
    }

    target.provoked = true;

    if (
      target.roomId === CHECKPOINT_ROOM_ID &&
      (target.id === MERCHANT_ENTITY_ID || target.id === CAPTAIN_ENTITY_ID)
    ) {
      const captain = this.state.entities.find(
        (entity) => entity.id === CAPTAIN_ENTITY_ID && entity.hp > 0,
      );
      if (captain) {
        captain.provoked = true;
      }
    }

    if (target.faction === 'civilian') {
      this.addLucidity(LUCIDITY_ON_ATTACK_CIVILIAN, 'natural', events);
      this.provokeGuardsInRoom(target.roomId, events);
    }

    if (target.hp === 0) {
      this.handleEntityDefeat(target, events);
    } else if (!triggeredDirectGuard) {
      events.push({ type: 'DIALOGUE_SPOKEN', entityId: target.id });
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

    if (target.id === PATROL_01_ENTITY_ID) {
      this.awardOutpostLucidityOnce(events);
    }

    if (target.id === CAPTAIN_ENTITY_ID) {
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
        entity.provoked = true;
        events.push({ type: 'GUARD_INTERVENED', entityId: entity.id });
        this.addLucidity(LUCIDITY_ON_GUARD_INTERVENED, 'natural', events);
      }
    }
  }

  private handleMoveAndPickup(nextPos: Position, events: GameEvent[]): void {
    this.state.player.position = nextPos;
    events.push({ type: 'PLAYER_MOVED', to: { ...nextPos } });
    this.pickupItemAt(this.state.currentRoomId, nextPos, events);
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

      if (pickedItem.itemId === HEALING_TONIC_ID) {
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
          entity.provoked = true;
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
      this.emitDialogueIfNotSpoken(entity.id, events);
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
      events.push({
        type: 'AI_FLED',
        entityId: entity.id,
        from,
        to: { ...bestPosition },
      });
    } else {
      entity.lastPos = undefined;
      this.emitDialogueIfNotSpoken(entity.id, events);
    }
  }

  private runChaseAndAttackAi(entity: EntityState, events: GameEvent[]): void {
    const playerPos = this.state.player.position;
    const currentDist = getManhattanDistance(entity.position, playerPos);

    if (entity.aiBehavior === 'chase_and_attack' && currentDist <= 3) {
      entity.provoked = true;
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
      let pendingCounterDamage = 0;

      if (
        this.state.isGuardingFromWait &&
        classTrait.waitDamageMultiplier !== undefined
      ) {
        ironStanceTriggered = true;
        this.state.isGuardingFromWait = false;
        finalDamage = Math.floor(finalDamage * classTrait.waitDamageMultiplier);
        pendingCounterDamage = classTrait.waitCounterDamage ?? 0;
      }

      let undyingFrameTriggered = false;
      if (
        raceTrait.flatDamageReduction !== undefined &&
        raceTrait.flatDamageReduction > 0
      ) {
        undyingFrameTriggered = true;
        finalDamage = Math.max(1, finalDamage - raceTrait.flatDamageReduction);
      }

      const damageReduced = Math.max(0, rawDamage - finalDamage);
      const triggeredTraitId = ironStanceTriggered
        ? classTrait.id
        : undyingFrameTriggered
          ? raceTrait.id
          : undefined;

      this.state.player.hp = Math.max(0, this.state.player.hp - finalDamage);
      const counterDamage =
        this.state.player.hp > 0 && pendingCounterDamage > 0
          ? pendingCounterDamage
          : 0;

      events.push({
        type: 'ENEMY_ATTACKED',
        attackerId: entity.id,
        damage: finalDamage,
        playerRemainingHp: this.state.player.hp,
        ...(damageReduced > 0 ? { damageReduced } : {}),
        ...(counterDamage > 0 ? { counterDamage } : {}),
        ...(triggeredTraitId ? { triggeredTraitId } : {}),
      });

      if (this.state.player.hp === 0) {
        this.state.isGameOver = true;
        events.push({ type: 'PLAYER_DIED' });
        return;
      }

      if (counterDamage > 0) {
        entity.hp = Math.max(0, entity.hp - counterDamage);
        if (entity.hp === 0) {
          this.handleEntityDefeat(entity, events);
        }
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

  private emitDialogueIfNotSpoken(entityId: string, events: GameEvent[]): void {
    const alreadySpoke = events.some(
      (event) => event.type === 'DIALOGUE_SPOKEN' && event.entityId === entityId,
    );
    if (!alreadySpoke) {
      events.push({ type: 'DIALOGUE_SPOKEN', entityId });
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

    const lucidityBonus =
      source === 'natural'
        ? (this.getSelectedRace()?.trait.lucidityGainBonus ?? 0)
        : 0;
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
