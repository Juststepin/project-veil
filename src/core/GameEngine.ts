import classesData from '../data/classes.json';
import entitiesData from '../data/entities.json';
import itemsData from '../data/items.json';
import modifiersData from '../data/modifiers.json';
import racesData from '../data/races.json';
import {
  findDoorAt,
  getAllRooms,
  getManhattanDistance,
  getNextPosition,
  getRoomGridSize,
  getTileType,
  type Direction,
  type DoorDefinition,
  type Position,
} from './grid';
import {
  MAX_INVENTORY_SLOTS,
  type AttackTraitId,
  type ClassConfig,
  type ClassId,
  type EndingId,
  type EntityJsonConfig,
  type EntityState,
  type GameEvent,
  type GameState,
  type GateLockReason,
  type GroundItem,
  type HubActionChoice,
  type ModifierConfig,
  type PlayerAction,
  type RaceConfig,
  type RaceId,
  type TribunalChoice,
  type TribunalTransitionResolution,
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
const MARKET_STREET_ROOM_ID = 'room_market_street';
const PENAL_OUTPOST_ROOM_ID = 'room_penal_outpost';
const OUTER_SEWER_ROOM_ID = 'room_outer_sewer';
const ABANDONED_BORDER_ROOM_ID = 'room_abandoned_border';
const AMBIENT_VISITED_ROOM_IDS = new Set([
  MARKET_STREET_ROOM_ID,
  PENAL_OUTPOST_ROOM_ID,
  OUTER_SEWER_ROOM_ID,
  ABANDONED_BORDER_ROOM_ID,
]);
const BORDER_PATROL_AGGRO_RADIUS = 5;
const HOSTILE_DESERTER_AGGRO_RADIUS = 4;
const DEPOT_AMBIENT_MAX_X = 3;
const SUMMONER_BLESSING_ID = 'summoner_blessing';
const RELIC_CLARITY_ID = 'relic_clarity';
const WORLD_RELIC_ID = 'world_relic';
const SHATTERED_RELIC_SHARD_ID = 'shattered_relic_shard';
const BORDER_RATION_PACK_ID = 'border_ration_pack';
const DEFAULT_RATION_PRICE = 15;
const HUB_REST_COST = 10;
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
  buyPrice?: number;
  isRelicShard?: boolean;
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
    isHubNpc: config.isHubNpc,
    isInteractableObject: config.isInteractableObject,
    hubRole: config.hubRole,
    activeModifierIds: config.id === 'player' ? [] : undefined,
    fleeCooldown: 0,
    provoked: false,
    hasSpokenCombatBark: false,
    hasWarnedPlayer: false,
  };
}

function createInitialGroundItems(): GroundItem[] {
  const groundItems: GroundItem[] = [];
  for (const room of getAllRooms()) {
    if (!room.initialGroundItems) continue;
    for (const entry of room.initialGroundItems) {
      groundItems.push({
        itemId: entry.itemId,
        roomId: room.id,
        position: { ...entry.position },
      });
    }
  }
  return groundItems;
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
    groundItems: createInitialGroundItems(),
    inventory: [WORLD_RELIC_ID],
    silver: 0,
    legalStatus: 'UNREGISTERED',
    hasAcceptedExpedition: false,
    claimedFreeSupplyIds: [],
    activeHubNpcId: null,
    visitedAmbientRoomIds: [],
    lastHubRoomId: null,
    convictCleared: false,
    relicShardGlitchTriggered: false,
    submittedShardNpcId: null,
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

    if (this.state.activeHubNpcId !== null) {
      if (action.type !== 'CHOOSE_HUB_ACTION') {
        return [];
      }
      const events: GameEvent[] = [];
      this.handleChooseHubAction(action.choice, events);
      return events;
    }

    if (action.type === 'CHOOSE_HUB_ACTION') {
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
      const gateLockReason = this.getGateLockReason(roomId, door);
      if (gateLockReason) {
        return [{ type: 'GATE_LOCKED', roomId, reason: gateLockReason }];
      }
      this.state.keenSightTriggeredThisTurn = false;
      if (door.isExpeditionGate === true) {
        this.state.isGuardingFromWait = false;
        this.handleExpeditionDeparture(roomId, events);
        return this.finishPlayerTurn(events);
      }
      const changed = this.handleRoomTransition(nextPos, events);
      if (!changed) return [];
      this.state.isGuardingFromWait = false;
      return this.finishPlayerTurn(events);
    }

    const target = this.findEntityAt(roomId, nextPos);
    if (target?.isInteractableObject === true) {
      return [
        {
          type: 'OBJECT_INSPECTED',
          entityId: target.id,
          roomId,
          position: { ...target.position },
        },
      ];
    }

    this.state.keenSightTriggeredThisTurn = false;
    this.state.isGuardingFromWait = false;

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

  private getGateLockReason(
    roomId: string,
    door: DoorDefinition,
  ): GateLockReason | null {
    const doorPos = door.position;
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
    if (
      roomId === MARKET_STREET_ROOM_ID &&
      doorPos.x === 0 &&
      doorPos.y === 3
    ) {
      return 'TRIBUNAL_CONCLUDED';
    }
    if (door.isExpeditionGate === true && !this.state.hasAcceptedExpedition) {
      return 'EXPEDITION_UNBRIEFED';
    }
    if (door.targetRoomId === MARKET_STREET_ROOM_ID) {
      if (this.state.legalStatus === 'CONVICT') {
        return 'CONVICT_BARRED';
      }
      if (this.state.legalStatus === 'OUTLAW') {
        return 'OUTLAW_LOCKDOWN';
      }
    }
    if (
      door.targetRoomId === PENAL_OUTPOST_ROOM_ID &&
      this.state.legalStatus === 'OUTLAW'
    ) {
      return 'OUTLAW_LOCKDOWN';
    }
    return null;
  }

  private handleExpeditionDeparture(fromRoomId: string, events: GameEvent[]): void {
    const safePos = this.findSafeSpawnPosition(ABANDONED_BORDER_ROOM_ID, {
      x: 1,
      y: 4,
    });

    this.state.lastHubRoomId = fromRoomId;
    this.state.currentRoomId = ABANDONED_BORDER_ROOM_ID;
    this.state.player.roomId = ABANDONED_BORDER_ROOM_ID;
    this.state.player.position = { ...safePos };
    this.state.lastAttackedTargetId = null;
    this.state.consecutiveHitsOnTarget = 0;
    this.state.isGuardingFromWait = false;
    this.state.isRiposteReady = false;

    for (const entity of this.state.entities) {
      entity.hasSpokenCombatBark = false;
    }

    events.push({
      type: 'EXPEDITION_DEPARTED',
      fromRoomId,
      legalStatus: this.state.legalStatus,
    });
    events.push({
      type: 'ROOM_CHANGED',
      fromRoomId,
      toRoomId: ABANDONED_BORDER_ROOM_ID,
      to: { ...safePos },
    });

    this.pickupItemAt(ABANDONED_BORDER_ROOM_ID, safePos, events);
    this.tryTriggerVisitedAmbient(ABANDONED_BORDER_ROOM_ID, events);
  }

  private finishPlayerTurn(events: GameEvent[]): GameEvent[] {
    this.checkFilterThreshold(events);
    const transitionedOutOfTribunal = events.some(
      (event) => event.type === 'TRIBUNAL_TRANSITIONED',
    );
    if (
      !transitionedOutOfTribunal &&
      !this.state.pendingFilterChoice &&
      !this.state.pendingBossChoice &&
      !this.state.pendingTribunalChoice &&
      this.state.activeHubNpcId === null &&
      this.state.endingId === null &&
      !this.state.isGameOver
    ) {
      this.runRoomAi(events);
      this.checkFilterThreshold(events);
    }
    return events;
  }

  private canTalkTo(target: EntityState): boolean {
    if (target.isInteractableObject === true) {
      return false;
    }
    if (target.isHubNpc === true) {
      return true;
    }
    if (
      target.aiBehavior === 'inner_magistrate' &&
      this.state.checkpointResolution === 'BREACHED'
    ) {
      return false;
    }
    if (
      target.aiBehavior === 'border_patrol' &&
      this.state.legalStatus === 'OUTLAW'
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
    const isHubNpc = target.isHubNpc === true;

    events.push({
      type: 'NPC_TALKED',
      entityId: target.id,
      hasBadge,
      ...(isCaptain || isMagistrate || isHubNpc
        ? { raceId: this.state.selectedRaceId }
        : {}),
      ...(isMagistrate
        ? { imperialRecord: { ...this.state.imperialRecord } }
        : {}),
      ...(isHubNpc ? { legalStatus: this.state.legalStatus } : {}),
    });

    if (isHubNpc && target.hubRole) {
      this.state.hasAcceptedExpedition = true;
      this.state.activeHubNpcId = target.id;
      events.push({
        type: 'HUB_SERVICE_OPENED',
        entityId: target.id,
      });
      return;
    }

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

  private handleChooseHubAction(choice: HubActionChoice, events: GameEvent[]): void {
    const activeId = this.state.activeHubNpcId;
    if (!activeId) return;

    if (choice === 'CLOSE_HUB_MENU') {
      this.state.activeHubNpcId = null;
      events.push({ type: 'HUB_SERVICE_CLOSED', entityId: activeId });
      return;
    }

    const npc = this.state.entities.find(
      (entity) =>
        entity.id === activeId &&
        entity.roomId === this.state.currentRoomId &&
        entity.hp > 0 &&
        entity.isHubNpc === true,
    );
    if (!npc || !npc.hubRole) {
      this.state.activeHubNpcId = null;
      return;
    }

    const role = npc.hubRole;

    if (choice === 'SUBMIT_RELIC_SHARD') {
      const shardIdx = this.state.inventory.indexOf(SHATTERED_RELIC_SHARD_ID);
      if (shardIdx === -1) return;

      this.state.inventory.splice(shardIdx, 1);
      this.state.activeHubNpcId = null;
      this.state.submittedShardNpcId = npc.id;

      const hasWorldRelic = this.state.inventory.includes(WORLD_RELIC_ID);
      let silverReward = 60;
      let clearedConvictStatus = false;
      let endingId: EndingId = 'AWAKENED';

      if (role === 'market_smith') {
        if (this.state.legalStatus === 'ENVOY' && hasWorldRelic) {
          silverReward = 70;
          endingId = 'SOVEREIGN_PACT';
        } else {
          silverReward = 60;
          endingId = 'AWAKENED';
        }
      } else if (role === 'penal_warden') {
        if (this.state.legalStatus === 'CONVICT') {
          silverReward = 0;
          this.state.legalStatus = 'CITIZEN';
          this.state.convictCleared = true;
          clearedConvictStatus = true;
          endingId = 'AWAKENED';
        } else if (this.state.legalStatus === 'ENVOY' && hasWorldRelic) {
          silverReward = 70;
          endingId = 'SOVEREIGN_PACT';
        } else {
          silverReward = 60;
          endingId = 'AWAKENED';
        }
      } else {
        silverReward = this.state.filterChoice === 'BREAK' ? 70 : 60;
        endingId = 'SUMMONER_BLADE';
      }

      this.state.silver += silverReward;
      this.state.endingId = endingId;

      events.push({
        type: 'RELIC_SHARD_SUBMITTED',
        entityId: npc.id,
        silverReward,
        remainingSilver: this.state.silver,
        clearedConvictStatus,
        endingId,
      });
      events.push({
        type: 'GAME_ENDED',
        endingId,
      });
      return;
    }

    const isMerchantRole =
      role === 'market_smith' || role === 'penal_warden' || role === 'sewer_broker';

    if (choice === 'BUY_RATION') {
      if (!isMerchantRole) return;
      const cost = ITEMS[BORDER_RATION_PACK_ID]?.buyPrice ?? DEFAULT_RATION_PRICE;
      if (this.state.silver < cost || this.state.inventory.length >= MAX_INVENTORY_SLOTS) {
        return;
      }
      this.state.silver -= cost;
      this.state.inventory.push(BORDER_RATION_PACK_ID);
      events.push({
        type: 'HUB_RATION_BOUGHT',
        entityId: npc.id,
        itemId: BORDER_RATION_PACK_ID,
        cost,
        remainingSilver: this.state.silver,
      });
      return;
    }

    if (choice === 'CLAIM_FREE_SUPPLY') {
      const isEligible =
        role === 'sanctum_agent' ||
        (role === 'penal_warden' && this.state.legalStatus === 'CONVICT');
      if (!isEligible) return;
      if (
        this.state.claimedFreeSupplyIds.includes(npc.id) ||
        this.state.inventory.length >= MAX_INVENTORY_SLOTS
      ) {
        return;
      }
      this.state.claimedFreeSupplyIds.push(npc.id);
      this.state.inventory.push(BORDER_RATION_PACK_ID);
      events.push({
        type: 'HUB_SUPPLY_CLAIMED',
        entityId: npc.id,
        itemId: BORDER_RATION_PACK_ID,
      });
      return;
    }

    if (choice === 'REST_HEAL') {
      if (!isMerchantRole) return;
      if (
        this.state.silver < HUB_REST_COST ||
        this.state.player.hp >= this.state.player.maxHp
      ) {
        return;
      }
      const oldHp = this.state.player.hp;
      this.state.silver -= HUB_REST_COST;
      this.state.player.hp = this.state.player.maxHp;
      const actualHeal = this.state.player.hp - oldHp;
      events.push({
        type: 'HUB_RESTED',
        entityId: npc.id,
        cost: HUB_REST_COST,
        healAmount: actualHeal,
        playerHp: this.state.player.hp,
        maxHp: this.state.player.maxHp,
        playerPosition: { ...this.state.player.position },
        remainingSilver: this.state.silver,
      });
    }
  }

  private transitionFromTribunalToHub(
    resolution: TribunalTransitionResolution,
    targetRoomId: string,
    silverGranted: number,
    events: GameEvent[],
  ): void {
    const fromRoomId = this.state.currentRoomId;
    const safePos = this.findSafeSpawnPosition(targetRoomId, { x: 1, y: 3 });

    this.state.silver += silverGranted;
    this.state.currentRoomId = targetRoomId;
    this.state.player.roomId = targetRoomId;
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
      type: 'TRIBUNAL_TRANSITIONED',
      resolution,
      silverGranted,
      toRoomId: targetRoomId,
      to: { ...safePos },
    });
    events.push({
      type: 'ROOM_CHANGED',
      fromRoomId,
      toRoomId: targetRoomId,
      to: { ...safePos },
    });

    this.pickupItemAt(targetRoomId, safePos, events);
    this.tryTriggerVisitedAmbient(targetRoomId, events);
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
      if (
        this.state.imperialRecord.civiliansKilled > 0 ||
        !this.state.inventory.includes(WORLD_RELIC_ID)
      ) {
        return;
      }
      this.state.pendingTribunalChoice = false;
      this.state.legalStatus = 'ENVOY';
      this.state.inventory = this.state.inventory.filter(
        (itemId) => itemId !== PATROL_BADGE_ID,
      );
      this.transitionFromTribunalToHub('ENVOY', MARKET_STREET_ROOM_ID, 40, events);
      return;
    }

    if (choice === 'ACCEPT_DECREE') {
      this.state.pendingTribunalChoice = false;
      if (this.state.imperialRecord.civiliansKilled > 0) {
        this.state.legalStatus = 'CONVICT';
        this.transitionFromTribunalToHub('CONVICT', PENAL_OUTPOST_ROOM_ID, 15, events);
        return;
      }
      this.state.legalStatus = 'CITIZEN';
      this.state.inventory = this.state.inventory.filter(
        (itemId) => itemId !== PATROL_BADGE_ID,
      );
      this.transitionFromTribunalToHub('CITIZEN', MARKET_STREET_ROOM_ID, 25, events);
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
      if (
        entity.roomId !== roomId ||
        entity.hp <= 0 ||
        entity.isHubNpc === true ||
        entity.isInteractableObject === true
      ) {
        continue;
      }
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

  private getFallbackHubRoomId(): string {
    if (
      this.state.legalStatus === 'CITIZEN' ||
      this.state.legalStatus === 'ENVOY'
    ) {
      return MARKET_STREET_ROOM_ID;
    }
    if (this.state.legalStatus === 'CONVICT') {
      return PENAL_OUTPOST_ROOM_ID;
    }
    return OUTER_SEWER_ROOM_ID;
  }

  private handleRoomTransition(doorPos: Position, events: GameEvent[]): boolean {
    const fromRoomId = this.state.currentRoomId;
    const door = findDoorAt(fromRoomId, doorPos);
    if (!door) return false;

    const targetRoomId =
      door.isExpeditionReturnGate === true
        ? this.state.lastHubRoomId ?? this.getFallbackHubRoomId()
        : door.targetRoomId;
    const spawnPosition =
      door.isExpeditionReturnGate === true ? { x: 6, y: 3 } : door.spawnPosition;

    if (!targetRoomId || !spawnPosition) return false;

    const safePos = this.findSafeSpawnPosition(targetRoomId, spawnPosition);
    this.state.currentRoomId = targetRoomId;
    this.state.player.roomId = targetRoomId;
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
      toRoomId: targetRoomId,
      to: { ...safePos },
    });

    this.pickupItemAt(targetRoomId, safePos, events);

    if (targetRoomId === DEPOT_ROOM_ID) {
      this.awardDepotEntryLucidityOnce(events);
      this.tryTriggerDepotAmbient(events);
    }

    if (
      targetRoomId === CHECKPOINT_ROOM_ID &&
      this.state.filterChoice === 'UNDECIDED' &&
      this.state.lucidity < FILTER_THRESHOLD_LUCIDITY
    ) {
      this.addLucidity(
        FILTER_THRESHOLD_LUCIDITY - this.state.lucidity,
        'forced_threshold',
        events,
      );
    }

    if (targetRoomId === INNER_COURT_ROOM_ID) {
      this.tryTriggerInnerCourtAmbient(events);
    }

    if (AMBIENT_VISITED_ROOM_IDS.has(targetRoomId)) {
      this.tryTriggerVisitedAmbient(targetRoomId, events);
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

  private tryTriggerVisitedAmbient(roomId: string, events: GameEvent[]): void {
    if (
      !AMBIENT_VISITED_ROOM_IDS.has(roomId) ||
      this.state.visitedAmbientRoomIds.includes(roomId)
    ) {
      return;
    }

    this.state.visitedAmbientRoomIds.push(roomId);
    events.push({
      type: 'ROOM_AMBIENT_OBSERVED',
      roomId,
      position: { ...this.state.player.position },
    });
  }

  private findSafeSpawnPosition(roomId: string, preferred: Position): Position {
    if (
      getTileType(roomId, preferred.x, preferred.y) === 'FLOOR' &&
      !this.findEntityAt(roomId, preferred)
    ) {
      return { ...preferred };
    }

    const gridSize = getRoomGridSize(roomId);
    let bestPos: Position = { ...preferred };
    let bestDistance = Infinity;

    for (let y = 1; y < gridSize - 1; y++) {
      for (let x = 1; x < gridSize - 1; x++) {
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
      this.handleEntityDefeat(target, events, true);
    } else if (!triggeredDirectGuard) {
      this.emitCombatBarkOnce(target, events);
    }
  }

  private handleEntityDefeat(
    target: EntityState,
    events: GameEvent[],
    killedByPlayer = true,
  ): void {
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

    if (killedByPlayer) {
      if (target.faction === 'empire_guard') {
        this.state.imperialRecord.guardsKilled += 1;
      } else if (target.faction === 'civilian') {
        this.state.imperialRecord.civiliansKilled += 1;
      }
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
      this.state.legalStatus = 'OUTLAW';
      this.transitionFromTribunalToHub('OUTLAW_ESCAPE', OUTER_SEWER_ROOM_ID, 20, events);
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
    const candidateItems: GroundItem[] = [];

    for (const item of this.state.groundItems) {
      if (
        item.roomId === roomId &&
        item.position.x === pos.x &&
        item.position.y === pos.y
      ) {
        candidateItems.push(item);
      } else {
        remainingItems.push(item);
      }
    }

    if (candidateItems.length === 0) return;

    let hitInventoryFull = false;
    const pickedItems: GroundItem[] = [];
    for (const candidate of candidateItems) {
      if (this.state.inventory.length + pickedItems.length < MAX_INVENTORY_SLOTS) {
        pickedItems.push(candidate);
      } else {
        remainingItems.push(candidate);
        hitInventoryFull = true;
      }
    }

    this.state.groundItems = remainingItems;

    for (const pickedItem of pickedItems) {
      this.state.inventory.push(pickedItem.itemId);
      events.push({ type: 'ITEM_PICKED_UP', itemId: pickedItem.itemId });

      if (
        pickedItem.itemId === SHATTERED_RELIC_SHARD_ID &&
        this.state.filterChoice === 'KEEP' &&
        !this.state.relicShardGlitchTriggered
      ) {
        this.state.relicShardGlitchTriggered = true;
        events.push({
          type: 'RELIC_SHARD_GLITCHED',
          itemId: SHATTERED_RELIC_SHARD_ID,
        });
      }

      if (pickedItem.itemId === HEALING_TONIC_ID && roomId === OUTPOST_ROOM_ID) {
        this.awardOutpostLucidityOnce(events);
      }

      const lucidityGain = LUCIDITY_ON_PICKUP_BY_ITEM[pickedItem.itemId] ?? 0;
      if (lucidityGain > 0) {
        this.addLucidity(lucidityGain, 'natural', events);
      }
    }

    if (hitInventoryFull) {
      events.push({ type: 'INVENTORY_FULL', maxSlots: MAX_INVENTORY_SLOTS });
    }
  }

  private runRoomAi(events: GameEvent[]): void {
    if (this.state.isGameOver || this.state.endingId !== null) {
      return;
    }

    const roomId = this.state.currentRoomId;
    const roomEntities = this.state.entities.filter(
      (entity) =>
        entity.roomId === roomId &&
        entity.hp > 0 &&
        entity.isInteractableObject !== true,
    );

    for (const entity of roomEntities) {
      if (
        this.state.isGameOver ||
        this.state.endingId !== null ||
        this.state.currentRoomId !== roomId
      ) {
        break;
      }

      if (entity.hp <= 0) {
        continue;
      }

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
      } else if (entity.aiBehavior === 'border_patrol') {
        this.runBorderPatrolAi(entity, events);
      } else if (entity.aiBehavior === 'hostile_deserter') {
        this.runHostileDeserterAi(entity, events);
      }

      if (
        this.state.isGameOver ||
        this.state.endingId !== null ||
        this.state.currentRoomId !== roomId
      ) {
        break;
      }
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
      this.executeEnemyAttackOnPlayer(entity, events);
      return;
    }

    this.moveEntityToward(entity, playerPos);
  }

  private runBorderPatrolAi(entity: EntityState, events: GameEvent[]): void {
    const roomId = entity.roomId;
    const isHostileToPlayer =
      this.state.legalStatus === 'OUTLAW' ||
      entity.provoked ||
      this.state.filterChoice !== 'BREAK';

    let bestTarget: { kind: 'player' } | { kind: 'npc'; entity: EntityState } | null = null;
    let bestDist = Infinity;

    for (const other of this.state.entities) {
      if (
        other.id === entity.id ||
        other.roomId !== roomId ||
        other.hp <= 0 ||
        other.isInteractableObject === true ||
        other.faction !== 'outlaw_deserter'
      ) {
        continue;
      }
      const dist = getManhattanDistance(entity.position, other.position);
      if (!entity.provoked && dist > BORDER_PATROL_AGGRO_RADIUS) {
        continue;
      }
      if (dist < bestDist) {
        bestDist = dist;
        bestTarget = { kind: 'npc', entity: other };
      }
    }

    if (isHostileToPlayer) {
      const playerDist = getManhattanDistance(entity.position, this.state.player.position);
      if (entity.provoked || playerDist <= BORDER_PATROL_AGGRO_RADIUS) {
        // Tie-break strictly prefers outlaw_deserter over player
        if (playerDist < bestDist) {
          bestDist = playerDist;
          bestTarget = { kind: 'player' };
        }
      }
    }

    if (!bestTarget) {
      entity.lastPos = undefined;
      return;
    }

    if (bestTarget.kind === 'player') {
      if (bestDist === 1) {
        this.executeEnemyAttackOnPlayer(entity, events);
      } else {
        this.moveEntityToward(entity, this.state.player.position);
      }
      return;
    }

    const npcTarget = bestTarget.entity;
    if (bestDist === 1) {
      entity.lastPos = undefined;
      this.emitCombatBarkOnce(entity, events);
      const damage = entity.attack;
      npcTarget.hp = Math.max(0, npcTarget.hp - damage);
      events.push({
        type: 'NPC_ATTACKED_NPC',
        attackerId: entity.id,
        targetId: npcTarget.id,
        damage,
        targetRemainingHp: npcTarget.hp,
        attackerPosition: { ...entity.position },
        targetPosition: { ...npcTarget.position },
      });
      if (npcTarget.hp === 0) {
        this.handleEntityDefeat(npcTarget, events, false);
      }
      return;
    }

    this.moveEntityToward(entity, npcTarget.position);
  }

  private runHostileDeserterAi(entity: EntityState, events: GameEvent[]): void {
    const roomId = entity.roomId;
    const playerDist = getManhattanDistance(entity.position, this.state.player.position);

    if (
      this.state.filterChoice === 'BREAK' &&
      !entity.provoked &&
      !entity.hasWarnedPlayer &&
      playerDist <= HOSTILE_DESERTER_AGGRO_RADIUS
    ) {
      entity.hasWarnedPlayer = true;
      this.setEntityProvoked(entity, true);
      events.push({
        type: 'DIALOGUE_SPOKEN',
        entityId: entity.id,
        legalStatus: this.state.legalStatus,
        raceId: this.state.selectedRaceId,
        isRefuseTalk: true,
      });
    }

    let bestNpc: EntityState | null = null;
    let bestNpcDist = Infinity;

    for (const other of this.state.entities) {
      if (
        other.id === entity.id ||
        other.roomId !== roomId ||
        other.hp <= 0 ||
        other.isInteractableObject === true ||
        other.faction !== 'empire_guard'
      ) {
        continue;
      }
      const dist = getManhattanDistance(entity.position, other.position);
      if (!entity.provoked && dist > HOSTILE_DESERTER_AGGRO_RADIUS) {
        continue;
      }
      if (dist < bestNpcDist) {
        bestNpcDist = dist;
        bestNpc = other;
      }
    }

    const playerInRange = entity.provoked || playerDist <= HOSTILE_DESERTER_AGGRO_RADIUS;

    let chosenTarget: { kind: 'player'; dist: number } | { kind: 'npc'; entity: EntityState; dist: number } | null = null;

    if (bestNpc && playerInRange) {
      if (bestNpcDist < playerDist) {
        chosenTarget = { kind: 'npc', entity: bestNpc, dist: bestNpcDist };
      } else if (playerDist < bestNpcDist) {
        chosenTarget = { kind: 'player', dist: playerDist };
      } else {
        // Equal distance: prefer empire_guard if adjacent (dist === 1), else prefer player
        chosenTarget =
          bestNpcDist === 1
            ? { kind: 'npc', entity: bestNpc, dist: bestNpcDist }
            : { kind: 'player', dist: playerDist };
      }
    } else if (bestNpc) {
      chosenTarget = { kind: 'npc', entity: bestNpc, dist: bestNpcDist };
    } else if (playerInRange) {
      chosenTarget = { kind: 'player', dist: playerDist };
    }

    if (!chosenTarget) {
      entity.lastPos = undefined;
      return;
    }

    if (chosenTarget.kind === 'player') {
      if (chosenTarget.dist === 1) {
        this.executeEnemyAttackOnPlayer(entity, events);
      } else {
        this.moveEntityToward(entity, this.state.player.position);
      }
      return;
    }

    const npcTarget = chosenTarget.entity;
    if (chosenTarget.dist === 1) {
      entity.lastPos = undefined;
      const damage = entity.attack;
      npcTarget.hp = Math.max(0, npcTarget.hp - damage);
      events.push({
        type: 'NPC_ATTACKED_NPC',
        attackerId: entity.id,
        targetId: npcTarget.id,
        damage,
        targetRemainingHp: npcTarget.hp,
        attackerPosition: { ...entity.position },
        targetPosition: { ...npcTarget.position },
      });
      if (npcTarget.hp === 0) {
        this.handleEntityDefeat(npcTarget, events, false);
      }
      return;
    }

    this.moveEntityToward(entity, npcTarget.position);
  }

  private executeEnemyAttackOnPlayer(entity: EntityState, events: GameEvent[]): void {
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
  }

  private moveEntityToward(entity: EntityState, targetPos: Position): void {
    const currentDist = getManhattanDistance(entity.position, targetPos);
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
      const manhattan = getManhattanDistance(candidate, targetPos);
      if (manhattan > currentDist + 1) continue;

      const chebyshev = Math.max(
        Math.abs(candidate.x - targetPos.x),
        Math.abs(candidate.y - targetPos.y),
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
    const alreadySpokeThisTurn = events.some(
      (event) =>
        (event.type === 'DIALOGUE_SPOKEN' || event.type === 'GUARD_INTERVENED') &&
        event.entityId === entity.id,
    );
    if (alreadySpokeThisTurn) return;

    entity.hasSpokenCombatBark = true;
    events.push({
      type: 'DIALOGUE_SPOKEN',
      entityId: entity.id,
      ...(entity.aiBehavior === 'hostile_deserter'
        ? {
            legalStatus: this.state.legalStatus,
            raceId: this.state.selectedRaceId,
          }
        : {}),
    });
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
