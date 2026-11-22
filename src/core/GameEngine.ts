import entitiesData from '../data/entities.json';
import { getNextPosition, isWall, type Direction, type Position } from './grid';
import type { EntityState, GameEvent, GameState } from './types';

const MAX_LUCIDITY = 100;
const LUCIDITY_ON_ATTACK_FLEEING = 15;
const LUCIDITY_ON_PICKUP_FLEEING_DROP = 30;
const ALL_DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

export function createInitialState(): GameState {
  const playerData = entitiesData.player;
  const courierData = entitiesData.courier_01;

  const player: EntityState = {
    id: playerData.id,
    hp: playerData.hp,
    maxHp: playerData.maxHp,
    attack: playerData.attack,
    position: { ...playerData.startPosition },
    fleeCooldown: 0,
  };

  const courier: EntityState = {
    id: courierData.id,
    hp: courierData.hp,
    maxHp: courierData.maxHp,
    attack: courierData.attack,
    position: { ...courierData.startPosition },
    aiBehavior: courierData.aiBehavior as 'flee_when_hurt',
    dropItemId: courierData.dropItemId,
    fleeCooldown: 0,
  };

  return {
    player,
    entities: [courier],
    groundItems: [],
    inventory: [],
    lucidity: 0,
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

  handleAction(direction: Direction): GameEvent[] {
    const nextPos = getNextPosition(this.state.player.position, direction);

    if (isWall(nextPos.x, nextPos.y)) {
      return [];
    }

    const events: GameEvent[] = [];
    const target = this.findEntityAt(nextPos);

    if (target) {
      this.handleAttack(target, events);
    } else {
      this.handleMoveAndPickup(nextPos, events);
    }

    this.runFleeingAi(events);

    return events;
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

    const isFleeingEntity = target.aiBehavior === 'flee_when_hurt';
    if (isFleeingEntity) {
      this.addLucidity(LUCIDITY_ON_ATTACK_FLEEING, events);
    }

    if (target.hp === 0) {
      events.push({ type: 'ENTITY_DIED', entityId: target.id });

      if (target.dropItemId) {
        this.state.groundItems.push({
          itemId: target.dropItemId,
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
    } else {
      events.push({ type: 'DIALOGUE_SPOKEN', entityId: target.id });
    }
  }

  private handleMoveAndPickup(nextPos: Position, events: GameEvent[]): void {
    this.state.player.position = nextPos;
    events.push({ type: 'PLAYER_MOVED', to: { ...nextPos } });

    const itemIndex = this.state.groundItems.findIndex(
      (item) => item.position.x === nextPos.x && item.position.y === nextPos.y,
    );

    if (itemIndex !== -1) {
      const [pickedItem] = this.state.groundItems.splice(itemIndex, 1);
      this.state.inventory.push(pickedItem.itemId);
      events.push({ type: 'ITEM_PICKED_UP', itemId: pickedItem.itemId });

      if (pickedItem.fromFleeingEntity) {
        this.addLucidity(LUCIDITY_ON_PICKUP_FLEEING_DROP, events);
      }
    }
  }

  private runFleeingAi(events: GameEvent[]): void {
    for (const entity of this.state.entities) {
      const isAliveAndHurt = entity.hp > 0 && entity.hp < entity.maxHp;
      if (entity.aiBehavior !== 'flee_when_hurt' || !isAliveAndHurt) {
        continue;
      }

      if (entity.fleeCooldown > 0) {
        entity.fleeCooldown = 0;
        this.emitDialogueIfNotSpoken(entity.id, events);
        continue;
      }

      let bestPosition = entity.position;
      let maxDistance = this.getDistance(entity.position, this.state.player.position);

      for (const direction of ALL_DIRECTIONS) {
        const candidate = getNextPosition(entity.position, direction);
        if (isWall(candidate.x, candidate.y)) continue;
        if (this.isOccupied(candidate)) continue;

        const distance = this.getDistance(candidate, this.state.player.position);
        if (distance > maxDistance) {
          maxDistance = distance;
          bestPosition = candidate;
        }
      }

      const canMoveFurther =
        bestPosition.x !== entity.position.x || bestPosition.y !== entity.position.y;

      if (canMoveFurther) {
        const from = { ...entity.position };
        entity.position = bestPosition;
        entity.fleeCooldown = 1;
        events.push({
          type: 'AI_FLED',
          entityId: entity.id,
          from,
          to: { ...bestPosition },
        });
      } else {
        this.emitDialogueIfNotSpoken(entity.id, events);
      }
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

  private getDistance(a: Position, b: Position): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  private isOccupied(pos: Position): boolean {
    const playerPos = this.state.player.position;
    if (playerPos.x === pos.x && playerPos.y === pos.y) {
      return true;
    }
    return this.findEntityAt(pos) !== undefined;
  }

  private findEntityAt(pos: Position): EntityState | undefined {
    return this.state.entities.find(
      (entity) => entity.position.x === pos.x && entity.position.y === pos.y,
    );
  }
}
