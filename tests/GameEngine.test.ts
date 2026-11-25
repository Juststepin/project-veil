import { GameEngine } from '../src/core/GameEngine';
import { getManhattanDistance } from '../src/core/grid';
import type { EntityState, GameEvent } from '../src/core/types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed: ${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    );
  }
}

function getEntity(engine: GameEngine, id: string): EntityState {
  const entity = engine.getState().entities.find((entry) => entry.id === id);
  if (!entity) {
    throw new Error(`Expected entity '${id}' to exist`);
  }
  return entity;
}

function assertLastEvent(events: GameEvent[], expected: GameEvent, label: string): void {
  assert(events.length > 0, `${label}: expected non-empty events`);
  const last = events[events.length - 1];
  assertEqual(
    JSON.stringify(last),
    JSON.stringify(expected),
    `${label}: last event mismatch`,
  );
}

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: 'KEEP branch: entering Room 3 activates checkpoint_boss chase, navigates obstacles, and defeating captain_01 ends with SUMMONER_BLADE as last event',
    run: () => {
      const engine = new GameEngine();
      const state = engine.getState();

      // Move to Room 2 door toward Room 3 and trigger checkpoint shock
      state.currentRoomId = 'room_depot';
      state.player.roomId = 'room_depot';
      state.player.position = { x: 6, y: 3 };

      const enterEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.currentRoomId, 'room_checkpoint', 'should enter room_checkpoint');
      assertEqual(state.lucidity, 70, 'checkpoint shock should raise lucidity to 70');
      assertEqual(state.pendingFilterChoice, true, 'should pause for filter choice');
      assertLastEvent(
        enterEvents,
        { type: 'FILTER_THRESHOLD_REACHED', lucidity: 70 },
        'checkpoint entry',
      );

      // Choose KEEP -> buff + captain provoked
      const chooseEvents = engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' });
      assertEqual(state.filterChoice, 'KEEP', 'filterChoice should be KEEP');
      assertEqual(engine.getEffectiveAttack(state.player), 23, 'ATK should be 23 with summoner_blessing');
      assertEqual(state.player.maxHp, 120, 'maxHp should increase by 20');
      assertLastEvent(
        chooseEvents,
        { type: 'FILTER_CHOICE_MADE', choice: 'KEEP', appliedModifierId: 'summoner_blessing' },
        'choose KEEP',
      );

      const captain = getEntity(engine, 'captain_01');
      assertEqual(captain.provoked, true, 'captain_01 should be provoked on KEEP');

      // WAIT in Room 3 -> captain_01 actively chases player across Room 3
      const initialDist = getManhattanDistance(captain.position, state.player.position);
      engine.handleAction({ type: 'WAIT' });
      const nextDist = getManhattanDistance(captain.position, state.player.position);
      assert(nextDist < initialDist, 'captain_01 should move closer to player in KEEP mode');
      assert(captain.lastPos !== undefined, 'captain_01 should record lastPos while chasing');

      // Keep waiting until captain closes in and attacks player (16 damage)
      let enemyAttacked = false;
      for (let i = 0; i < 6; i++) {
        const turnEvents = engine.handleAction({ type: 'WAIT' });
        const hit = turnEvents.find((e) => e.type === 'ENEMY_ATTACKED');
        if (hit && hit.type === 'ENEMY_ATTACKED') {
          assertEqual(hit.attackerId, 'captain_01', 'captain_01 should deal the attack');
          assertEqual(hit.damage, 16, 'captain_01 should deal 16 damage');
          enemyAttacked = true;
          break;
        }
      }
      assert(enemyAttacked, 'captain_01 should reach and attack player');

      // Hurt merchant_01 so it would flee if runRoomAi accidentally ran after GAME_ENDED
      const merchant = getEntity(engine, 'merchant_01');
      merchant.hp = 20;

      // Finish captain_01 in one strike (23 ATK >= remaining 20 HP)
      captain.hp = 20;
      captain.position = { x: 4, y: 4 };
      state.player.position = { x: 3, y: 4 };
      const killEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });

      assertEqual(state.endingId, 'SUMMONER_BLADE', 'killing captain_01 should set SUMMONER_BLADE');
      assert(
        killEvents.some((e) => e.type === 'ENTITY_DIED' && e.entityId === 'captain_01'),
        'ENTITY_DIED for captain_01 must be emitted',
      );
      assertLastEvent(
        killEvents,
        { type: 'GAME_ENDED', endingId: 'SUMMONER_BLADE' },
        'captain_01 defeated',
      );
      assert(
        !killEvents.some((e) => e.type === 'AI_FLED' || e.type === 'ENEMY_ATTACKED'),
        'runRoomAi must not run after GAME_ENDED',
      );

      // Post-ending lock check
      assertEqual(engine.handleAction({ type: 'MOVE', direction: 'left' }).length, 0, 'MOVE blocked after ending');
      assertEqual(engine.handleAction({ type: 'WAIT' }).length, 0, 'WAIT blocked after ending');
      state.inventory.push('healing_tonic');
      assertEqual(
        engine.handleAction({ type: 'USE_ITEM', itemId: 'healing_tonic' }).length,
        0,
        'USE_ITEM blocked after ending',
      );
    },
  },
  {
    name: 'BREAK branch: TALK with Room 2 NPCs (courier_01, patrol_02) and Room 3 merchant_01 deals no damage and emits NPC_TALKED',
    run: () => {
      const engine = new GameEngine();
      const state = engine.getState();

      // Reach threshold and choose BREAK
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      assertEqual(state.filterChoice, 'BREAK', 'filterChoice should be BREAK');

      // Room 2: TALK with courier_01 at (4, 2)
      state.currentRoomId = 'room_depot';
      state.player.roomId = 'room_depot';
      state.player.position = { x: 3, y: 2 };
      const courier = getEntity(engine, 'courier_01');
      const courierEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });

      assertEqual(courier.hp, 45, 'talking to courier_01 must not deal damage');
      assertEqual(courier.provoked, false, 'talking to courier_01 must not provoke');
      assertLastEvent(
        courierEvents,
        { type: 'NPC_TALKED', entityId: 'courier_01', hasBadge: false },
        'talk to courier_01',
      );

      // Room 2: TALK with patrol_02 at (5, 5)
      state.player.position = { x: 5, y: 4 };
      const patrol2 = getEntity(engine, 'patrol_02');
      const patrol2Events = engine.handleAction({ type: 'MOVE', direction: 'down' });

      assertEqual(patrol2.hp, 65, 'talking to patrol_02 must not deal damage');
      assertEqual(patrol2.provoked, false, 'talking to patrol_02 must not provoke');
      assertLastEvent(
        patrol2Events,
        { type: 'NPC_TALKED', entityId: 'patrol_02', hasBadge: false },
        'talk to patrol_02',
      );

      // Room 3: captain_01 stays stationary in BREAK when unprovoked; TALK with merchant_01 at (6, 2)
      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      state.player.position = { x: 6, y: 1 };
      const merchant = getEntity(engine, 'merchant_01');
      const captain = getEntity(engine, 'captain_01');
      const merchantEvents = engine.handleAction({ type: 'MOVE', direction: 'down' });

      assertEqual(merchant.hp, 40, 'talking to merchant_01 must not deal damage');
      assertEqual(merchant.provoked, false, 'talking to merchant_01 must not provoke');
      assertEqual(captain.position.x, 5, 'captain_01 must remain at x=5 in BREAK mode');
      assertEqual(captain.position.y, 4, 'captain_01 must remain at y=4 in BREAK mode');
      assertEqual(captain.provoked, false, 'captain_01 must stay unprovoked');
      assertLastEvent(
        merchantEvents,
        { type: 'NPC_TALKED', entityId: 'merchant_01', hasBadge: false },
        'talk to merchant_01',
      );
      assertEqual(state.endingId, null, 'talking to merchant_01 must not end game');
    },
  },
  {
    name: 'BREAK branch: TALK with captain_01 (without and with patrol_badge) emits NPC_TALKED with accurate hasBadge and ends with AWAKENED',
    run: () => {
      // Case A: without patrol_badge
      const engine = new GameEngine();
      let state = engine.getState();
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });

      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      state.player.position = { x: 4, y: 4 }; // left of captain_01 at (5, 4)

      // Make merchant hurt so we confirm runRoomAi does not fire after AWAKENED
      getEntity(engine, 'merchant_01').hp = 20;

      const noBadgeEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(getEntity(engine, 'captain_01').hp, 110, 'talking to captain_01 must not deal damage');
      assertEqual(state.endingId, 'AWAKENED', 'talking to captain_01 should set AWAKENED ending');
      assertEqual(noBadgeEvents.length, 2, 'only NPC_TALKED and GAME_ENDED should fire');
      assertEqual(
        JSON.stringify(noBadgeEvents[0]),
        JSON.stringify({ type: 'NPC_TALKED', entityId: 'captain_01', hasBadge: false }),
        'NPC_TALKED without badge',
      );
      assertLastEvent(
        noBadgeEvents,
        { type: 'GAME_ENDED', endingId: 'AWAKENED' },
        'AWAKENED without badge',
      );

      // Post-ending lock check
      assertEqual(engine.handleAction({ type: 'WAIT' }).length, 0, 'WAIT blocked after AWAKENED');
      assertEqual(engine.handleAction({ type: 'MOVE', direction: 'left' }).length, 0, 'MOVE blocked after AWAKENED');

      // Case B: with patrol_badge
      engine.reset();
      state = engine.getState();
      state.inventory.push('patrol_badge');
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });

      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      state.player.position = { x: 4, y: 4 };

      const withBadgeEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.endingId, 'AWAKENED', 'talking to captain_01 with badge should set AWAKENED');
      assertEqual(withBadgeEvents.length, 2, 'only NPC_TALKED and GAME_ENDED should fire');
      assertEqual(
        JSON.stringify(withBadgeEvents[0]),
        JSON.stringify({ type: 'NPC_TALKED', entityId: 'captain_01', hasBadge: true }),
        'NPC_TALKED with badge',
      );
      assertLastEvent(
        withBadgeEvents,
        { type: 'GAME_ENDED', endingId: 'AWAKENED' },
        'AWAKENED with badge',
      );
    },
  },
  {
    name: 'Provoked rules: attacking flee_when_hurt or Room 3 NPCs blocks peaceful TALK after BREAK and provokes captain_01',
    run: () => {
      // Part A: Attack courier_01 before BREAK -> courier_01.provoked === true -> no TALK after BREAK
      const engine = new GameEngine();
      let state = engine.getState();
      state.currentRoomId = 'room_depot';
      state.player.roomId = 'room_depot';
      state.player.position = { x: 3, y: 2 };

      const courier = getEntity(engine, 'courier_01');
      const patrol2 = getEntity(engine, 'patrol_02');
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(courier.provoked, true, 'attacked courier_01 must become provoked');
      assertEqual(patrol2.provoked, true, 'attacking courier_01 must provoke patrol_02');

      // Switch to BREAK
      engine.debugAddLucidity(70);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });

      // Stepping into provoked courier_01 must ATTACK, not TALK
      state.player.position = { x: courier.position.x - 1, y: courier.position.y };
      const retryCourierEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assert(
        retryCourierEvents.some((e) => e.type === 'ATTACKED' && e.targetId === 'courier_01'),
        'provoked courier_01 must be attacked instead of talked to',
      );
      assert(
        !retryCourierEvents.some((e) => e.type === 'NPC_TALKED'),
        'provoked courier_01 must never trigger NPC_TALKED',
      );

      // Part B: Attacking merchant_01 in Room 3 provokes both merchant_01 and captain_01
      engine.reset();
      state = engine.getState();
      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      state.player.position = { x: 6, y: 1 }; // above merchant_01 at (6, 2)

      const merchant = getEntity(engine, 'merchant_01');
      const captain = getEntity(engine, 'captain_01');
      assertEqual(captain.provoked, false, 'captain_01 starts unprovoked');

      engine.handleAction({ type: 'MOVE', direction: 'down' }); // hits merchant_01 while UNDECIDED
      assertEqual(merchant.provoked, true, 'attacked merchant_01 must become provoked');
      assertEqual(captain.provoked, true, 'attacking merchant_01 in Room 3 must provoke captain_01');

      // Even if player subsequently chooses BREAK, provoked captain_01 fights back and cannot be TALKed to
      engine.debugAddLucidity(70);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });

      captain.position = { x: 4, y: 4 };
      state.player.position = { x: 3, y: 4 };
      const fightCaptainEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assert(
        fightCaptainEvents.some((e) => e.type === 'ATTACKED' && e.targetId === 'captain_01'),
        'provoked captain_01 in BREAK must be attacked, not talked to',
      );
      assert(
        fightCaptainEvents.some((e) => e.type === 'ENEMY_ATTACKED' && e.attackerId === 'captain_01'),
        'provoked captain_01 in BREAK must retaliate',
      );
      assert(
        !fightCaptainEvents.some((e) => e.type === 'NPC_TALKED'),
        'provoked captain_01 must not emit NPC_TALKED',
      );

      // Killing captain_01 in BREAK still triggers SUMMONER_BLADE (for Kẻ Phá Luật variant in Step 4)
      captain.hp = 15;
      const breakKillEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.endingId, 'SUMMONER_BLADE', 'killing captain_01 in BREAK still sets SUMMONER_BLADE');
      assertLastEvent(
        breakKillEvents,
        { type: 'GAME_ENDED', endingId: 'SUMMONER_BLADE' },
        'BREAK kill captain_01',
      );
    },
  },
];

for (const test of tests) {
  test.run();
  console.log(`PASS: ${test.name}`);
}

console.log(`\nALL ${tests.length} STEP 3 TEST SUITES PASSED`);
