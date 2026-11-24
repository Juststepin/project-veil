import entitiesData from '../data/entities.json';
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
  AiBehavior,
  EntityState,
  Faction,
  GameEvent,
  GameState,
  PlayerAction,
} from './types';

const MAX_LUCIDITY = 100;
const LUCIDITY_ON_ATTACK_FLEEING = 15;
const LUCIDITY_ON_PICKUP_FLEEING_DROP = 30;
const ALL_DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

interface EntityJsonConfig {
  id: string;
  hp: number;
  maxHp: number;
  attack: number;
  roomId: string;
  startPosition: Position;
  faction?: Faction;
  aiBehavior?: AiBehavior;
  dropItemId?: string;
}

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
    fleeCooldown: 0,
    provoked: false,
  };
}

export function createInitialState(): GameState {
  const catalog = entitiesData as Record<string, EntityJsonConfig>;
  const player = createEntityFromConfig(catalog.player);

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
  };
}

export class GameEngine {
  private state: GameState;

  constructor() {
    this.state = createInitialState();
  }

  getState(): GameState {
    return this.state;
  }

  reset(): void {
    this.state = createInitialState();
  }

  debugAddLucidity(amount = 15): GameEvent[] {
    const events: GameEvent[] = [];
    this.addLucidity(amount, events);
    return events;
  }

  handleAction(input: PlayerAction | Direction): GameEvent[] {
    if (this.state.isGameOver) {
      return [];
    }

    const action: PlayerAction =
      typeof input === 'string' ? { type: 'MOVE', direction: input } : input;

    const events: GameEvent[] = [];

    if (action.type === 'WAIT') {
      events.push({ type: 'PLAYER_WAITED' });
      this.runRoomAi(events);
      return events;
    }

    if (action.type === 'USE_ITEM') {
      // Bước 3 sẽ lắp logic sử dụng vật phẩm hồi máu ở đây
      return [];
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
      this.runRoomAi(events);
      return events;
    }

    const target = this.findEntityAt(roomId, nextPos);
    if (target) {
      this.handleAttack(target, events);
    } else {
      this.handleMoveAndPickup(nextPos, events);
    }

    this.runRoomAi(events);
    return events;
  }

  private handleRoomTransition(doorPos: Position, events: GameEvent[]): boolean {
    const fromRoomId = this.state.currentRoomId;
    const door = findDoorAt(fromRoomId, doorPos);
    if (!door) return false;

    const safePos = this.findSafeSpawnPosition(door.targetRoomId, door.spawnPosition);
    this.state.currentRoomId = door.targetRoomId;
    this.state.player.roomId = door.targetRoomId;
    this.state.player.position = safePos;

    events.push({
      type: 'ROOM_CHANGED',
      fromRoomId,
      toRoomId: door.targetRoomId,
      to: { ...safePos },
    });

    this.pickupItemAt(door.targetRoomId, safePos, events);
    return true;
  }

  private findSafeSpawnPosition(roomId: string, preferred: Position): Position {
    if (
      getTileType(roomId, preferred.x, preferred.y) === 'FLOOR' &&
      !this.findEntityAt(roomId, preferred)
    ) {
      return { ...preferred };
    }

    // Tìm ô FLOOR trống gần nhất theo khoảng cách Manhattan (Spawn Safety)
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
    const damage = this.state.player.attack;
    target.hp = Math.max(0, target.hp - damage);

    events.push({
      type: 'ATTACKED',
      attackerId: this.state.player.id,
      targetId: target.id,
      damage,
      targetRemainingHp: target.hp,
    });

    if (target.aiBehavior === 'chase_and_attack') {
      target.provoked = true;
    }

    let triggeredDirectGuard = false;
    if (target.aiBehavior === 'guard_civilian' && !target.provoked) {
      target.provoked = true;
      triggeredDirectGuard = true;
      events.push({ type: 'GUARD_INTERVENED', entityId: target.id });
    }

    if (target.faction === 'civilian') {
      this.provokeGuardsInRoom(target.roomId, events);
    }

    const isFleeingEntity = target.aiBehavior === 'flee_when_hurt';
    if (isFleeingEntity) {
      this.addLucidity(LUCIDITY_ON_ATTACK_FLEEING, events);
    }

    if (target.hp === 0) {
      events.push({ type: 'ENTITY_DIED', entityId: target.id });

      if (target.dropItemId) {
        this.state.groundItems.push({
          itemId: target.dropItemId,
          roomId: target.roomId,
          position: { ...target.position },
          fromFleeingEntity: isFleeingEntity,
        });
        events.push({
          type: 'ITEM_DROPPED',
          itemId: target.dropItemId,
          entityId: target.id,
          position: { ...target.position },
        });
      }

      this.state.entities = this.state.entities.filter((entity) => entity.id !== target.id);
    } else if (!triggeredDirectGuard) {
      events.push({ type: 'DIALOGUE_SPOKEN', entityId: target.id });
    }
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
      }
    }
  }

  private handleMoveAndPickup(nextPos: Position, events: GameEvent[]): void {
    this.state.player.position = nextPos;
    events.push({ type: 'PLAYER_MOVED', to: { ...nextPos } });
    this.pickupItemAt(this.state.currentRoomId, nextPos, events);
  }

  private pickupItemAt(roomId: string, pos: Position, events: GameEvent[]): void {
    const itemIndex = this.state.groundItems.findIndex(
      (item) =>
        item.roomId === roomId &&
        item.position.x === pos.x &&
        item.position.y === pos.y,
    );

    if (itemIndex === -1) return;

    const [pickedItem] = this.state.groundItems.splice(itemIndex, 1);
    this.state.inventory.push(pickedItem.itemId);
    events.push({ type: 'ITEM_PICKED_UP', itemId: pickedItem.itemId });

    if (pickedItem.fromFleeingEntity) {
      this.addLucidity(LUCIDITY_ON_PICKUP_FLEEING_DROP, events);
    }
  }

  private runRoomAi(events: GameEvent[]): void {
    const roomId = this.state.currentRoomId;
    const roomEntities = this.state.entities.filter(
      (entity) => entity.roomId === roomId && entity.hp > 0,
    );

    for (const entity of roomEntities) {
      if (this.state.isGameOver) break;

      if (entity.aiBehavior === 'flee_when_hurt') {
        this.runFleeingAi(entity, events);
      } else if (
        entity.aiBehavior === 'chase_and_attack' ||
        entity.aiBehavior === 'guard_civilian'
      ) {
        this.runChaseAndAttackAi(entity, events);
      }
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
      const damage = entity.attack;
      this.state.player.hp = Math.max(0, this.state.player.hp - damage);
      events.push({
        type: 'ENEMY_ATTACKED',
        attackerId: entity.id,
        damage,
        playerRemainingHp: this.state.player.hp,
      });

      if (this.state.player.hp === 0) {
        this.state.isGameOver = true;
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

  private emitDialogueIfNotSpoken(entityId: string, events: GameEvent[]): void {
    const alreadySpoke = events.some(
      (event) => event.type === 'DIALOGUE_SPOKEN' && event.entityId === entityId,
    );
    if (!alreadySpoke) {
      events.push({ type: 'DIALOGUE_SPOKEN', entityId });
    }
  }

  private addLucidity(amount: number, events: GameEvent[]): void {
    const newLucidity = Math.min(MAX_LUCIDITY, this.state.lucidity + amount);
    const actualGain = newLucidity - this.state.lucidity;
    this.state.lucidity = newLucidity;

    if (actualGain > 0) {
      events.push({
        type: 'LUCIDITY_CHANGED',
        amount: actualGain,
        newLucidity,
      });
    }
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
