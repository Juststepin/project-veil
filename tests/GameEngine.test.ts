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
      assertEqual(
        engine.getEffectiveAttack(state.player),
        24,
        'ATK should be 24 with default human + brawler and summoner_blessing',
      );
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

      // Finish captain_01 in one strike (24 ATK >= remaining 20 HP)
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
  {
    name: 'Hotfix v0.1.1: Room 1 (+15 once on patrol_01 kill or healing_tonic) + Room 2 first entry (+15) naturally hits 30/100 and resets cleanly',
    run: () => {
      // Order A: kill patrol_01 (+15), pick up healing_tonic (+0), enter room_depot (+15 => 30)
      const engine = new GameEngine();
      let state = engine.getState();
      const patrol1 = getEntity(engine, 'patrol_01');
      patrol1.hp = 15;
      patrol1.position = { x: 4, y: 3 };
      state.player.position = { x: 3, y: 3 };

      engine.handleAction({ type: 'MOVE', direction: 'right' }); // kills patrol_01, drops healing_tonic at (4, 3)
      assertEqual(state.lucidity, 15, 'killing patrol_01 must award +15 lucidity');
      assertEqual(state.outpostLucidityAwarded, true, 'outpost milestone flag must be set');

      engine.handleAction({ type: 'MOVE', direction: 'right' }); // steps onto (4, 3) and picks up healing_tonic
      assertEqual(state.lucidity, 15, 'picking up healing_tonic after patrol_01 kill must NOT double-award');

      // Enter room_depot via door (7, 3)
      state.player.position = { x: 6, y: 3 };
      const depotEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.currentRoomId, 'room_depot', 'should enter room_depot');
      assertEqual(state.lucidity, 30, 'first entry to room_depot must bring lucidity to 30');
      assertEqual(state.depotEntryLucidityAwarded, true, 'depot entry milestone flag must be set');
      assert(
        depotEvents.some((e) => e.type === 'LUCIDITY_CHANGED' && e.amount === 15 && e.newLucidity === 30),
        'LUCIDITY_CHANGED (+15 -> 30) must be emitted on first depot entry',
      );

      // Re-entering room_depot must NOT double-award
      engine.handleAction({ type: 'MOVE', direction: 'left' }); // back to room_outpost (6, 3)
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // back to room_depot
      assertEqual(state.lucidity, 30, 're-entering room_depot must not re-award +15');

      // Order B: reset clears flags; pick up healing_tonic first (+15), then kill patrol_01 (+0)
      engine.reset();
      state = engine.getState();
      assertEqual(state.outpostLucidityAwarded, false, 'reset must clear outpostLucidityAwarded');
      assertEqual(state.depotEntryLucidityAwarded, false, 'reset must clear depotEntryLucidityAwarded');
      state.groundItems.push({ itemId: 'healing_tonic', roomId: 'room_outpost', position: { x: 2, y: 3 } });
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // pick up healing_tonic at (2, 3)
      assertEqual(state.lucidity, 15, 'picking up healing_tonic first must award +15 lucidity');

      const patrol1Reset = getEntity(engine, 'patrol_01');
      patrol1Reset.hp = 15;
      patrol1Reset.position = { x: 3, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // kill patrol_01
      assertEqual(state.lucidity, 15, 'killing patrol_01 after healing_tonic pickup must NOT double-award');
    },
  },
  {
    name: 'Hotfix v0.1.1: unprovoked patrol_01 does not chase in BREAK mode and supports peaceful TALK',
    run: () => {
      const engine = new GameEngine();
      let state = engine.getState();
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });

      const patrol1 = getEntity(engine, 'patrol_01');
      assertEqual(patrol1.provoked, false, 'patrol_01 starts unprovoked');

      // Stand right next to patrol_01 at (4, 4) and WAIT -> must NOT aggro or attack
      state.player.position = { x: 4, y: 4 };
      const waitEvents = engine.handleAction({ type: 'WAIT' });
      assertEqual(patrol1.provoked, false, 'patrol_01 must remain unprovoked in BREAK');
      assertEqual(patrol1.position.x, 5, 'patrol_01 must stay at x=5');
      assertEqual(patrol1.position.y, 4, 'patrol_01 must stay at y=4');
      assert(!waitEvents.some((e) => e.type === 'ENEMY_ATTACKED'), 'patrol_01 must not attack in BREAK');

      // Step into patrol_01 -> triggers NPC_TALKED without damage
      const talkEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(patrol1.hp, 50, 'talking to patrol_01 must deal 0 damage');
      assertLastEvent(
        talkEvents,
        { type: 'NPC_TALKED', entityId: 'patrol_01', hasBadge: false },
        'talk to patrol_01 in BREAK',
      );

      // If patrol_01 was already damaged and provoked before BREAK, it remains hostile
      engine.reset();
      state = engine.getState();
      const patrolHostile = getEntity(engine, 'patrol_01');
      patrolHostile.provoked = true;
      patrolHostile.hp = patrolHostile.maxHp - 15;
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      state.player.position = { x: 4, y: 4 };
      const fightEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assert(
        fightEvents.some((e) => e.type === 'ATTACKED' && e.targetId === 'patrol_01'),
        'damaged & provoked patrol_01 must be attacked even in BREAK',
      );
      assert(
        fightEvents.some((e) => e.type === 'ENEMY_ATTACKED' && e.attackerId === 'patrol_01'),
        'damaged & provoked patrol_01 must retaliate even in BREAK',
      );
    },
  },
  {
    name: 'Hotfix v0.1.1: USE_ITEM is ignored at full HP (no turn/item lost) and reports exact actualHeal',
    run: () => {
      const engine = new GameEngine();
      const state = engine.getState();
      state.inventory.push('healing_tonic');

      // Put provoked patrol_01 next to player to verify enemy AI does NOT run on blocked USE_ITEM
      const patrol1 = getEntity(engine, 'patrol_01');
      patrol1.provoked = true;
      patrol1.position = { x: 2, y: 3 };
      state.player.position = { x: 1, y: 3 };
      state.player.hp = 100;

      const blockedEvents = engine.handleAction({ type: 'USE_ITEM', itemId: 'healing_tonic' });
      assertEqual(blockedEvents.length, 0, 'USE_ITEM at full HP must return empty events');
      assertEqual(state.inventory.length, 1, 'healing_tonic must NOT be consumed at full HP');
      assertEqual(state.player.hp, 100, 'enemy must NOT attack when USE_ITEM is ignored');

      // Take 10 damage (90/100), then use healing_tonic (35) -> actualHeal must be 10
      state.player.hp = 90;
      patrol1.position = { x: 5, y: 5 }; // keep away so playerHp stays clean for check
      const healEvents = engine.handleAction({ type: 'USE_ITEM', itemId: 'healing_tonic' });
      assertEqual(state.inventory.length, 0, 'healing_tonic must be consumed when injured');
      const usedEvent = healEvents.find((e) => e.type === 'ITEM_USED');
      assert(usedEvent !== undefined && usedEvent.type === 'ITEM_USED', 'ITEM_USED must be emitted');
      if (usedEvent && usedEvent.type === 'ITEM_USED') {
        assertEqual(usedEvent.healAmount, 10, 'actualHeal must be 10 (clamped from 90 to 100)');
        assertEqual(usedEvent.playerHp, 100, 'playerHp after heal must be 100');
      }
    },
  },
  {
    name: 'Hotfix v0.1.1: stepping onto stacked items picks up all items on that tile in a single turn',
    run: () => {
      const engine = new GameEngine();
      const state = engine.getState();
      state.groundItems.push(
        { itemId: 'healing_tonic', roomId: 'room_outpost', position: { x: 2, y: 3 } },
        { itemId: 'warm_bread', roomId: 'room_outpost', position: { x: 2, y: 3 } },
        { itemId: 'patrol_badge', roomId: 'room_outpost', position: { x: 2, y: 3 } },
      );

      const moveEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.groundItems.length, 0, 'all stacked items on the tile must be picked up');
      assertEqual(state.inventory.length, 3, 'inventory must receive all 3 stacked items');
      const pickedUpIds = moveEvents
        .filter((e) => e.type === 'ITEM_PICKED_UP')
        .map((e) => (e.type === 'ITEM_PICKED_UP' ? e.itemId : ''));
      assertEqual(
        JSON.stringify(pickedUpIds),
        JSON.stringify(['healing_tonic', 'warm_bread', 'patrol_badge']),
        'must emit ITEM_PICKED_UP for every stacked item',
      );
      assertEqual(state.lucidity, 60, 'lucidity must accumulate +15 (outpost) +20 (bread) +25 (badge) = 60');
    },
  },
  {
    name: 'Quick-fix v0.1.2: dodging patrol_01 (radius-3 aggro at full HP) resets provoked on BREAK, while patrol_02 & captain_01 keep provoked',
    run: () => {
      const engine = new GameEngine();
      let state = engine.getState();
      const patrol1 = getEntity(engine, 'patrol_01');

      // Step into Manhattan distance 3 of patrol_01 (5, 4) without attacking -> radius aggro sets provoked=true
      state.player.position = { x: 2, y: 4 };
      engine.handleAction({ type: 'WAIT' });
      assertEqual(patrol1.provoked, true, 'entering radius 3 must provoke patrol_01 before BREAK');
      assertEqual(patrol1.hp, patrol1.maxHp, 'patrol_01 must still be at full HP');

      // Escape into Room 2, reach threshold, and choose BREAK
      state.player.position = { x: 6, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // enter room_depot
      assertEqual(state.currentRoomId, 'room_depot', 'player should be in room_depot');
      engine.debugAddLucidity(60); // 15 + 60 = 75 -> pendingFilterChoice
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      assertEqual(patrol1.provoked, false, 'BREAK must reset provoked on undamaged patrol_01');

      // Return to Room 1, stand adjacent to patrol_01, and TALK
      engine.handleAction({ type: 'MOVE', direction: 'left' }); // back to room_outpost
      assertEqual(state.currentRoomId, 'room_outpost', 'player should be back in room_outpost');
      state.player.position = { x: patrol1.position.x - 1, y: patrol1.position.y };
      const waitEvents = engine.handleAction({ type: 'WAIT' });
      assertEqual(patrol1.provoked, false, 'patrol_01 must not re-aggro in BREAK');
      assert(!waitEvents.some((e) => e.type === 'ENEMY_ATTACKED'), 'patrol_01 must not attack after BREAK reset');

      const talkEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(patrol1.hp, patrol1.maxHp, 'TALK with patrol_01 must deal 0 damage');
      assertLastEvent(
        talkEvents,
        { type: 'NPC_TALKED', entityId: 'patrol_01', hasBadge: false },
        'must TALK with patrol_01 after dodging him and choosing BREAK',
      );

      // Verify provoked patrol_02 (full HP, provoked via attacking courier_01) is NOT reset on BREAK
      engine.reset();
      state = engine.getState();
      state.currentRoomId = 'room_depot';
      state.player.roomId = 'room_depot';
      const courier = getEntity(engine, 'courier_01');
      const patrol2 = getEntity(engine, 'patrol_02');
      state.player.position = { x: courier.position.x - 1, y: courier.position.y };
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // hit courier_01 -> provokes patrol_02
      assertEqual(patrol2.provoked, true, 'attacking courier_01 must provoke patrol_02');
      assertEqual(patrol2.hp, patrol2.maxHp, 'patrol_02 is untouched at full HP');
      engine.debugAddLucidity(60);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      assertEqual(patrol2.provoked, true, 'BREAK must NOT reset provoked on patrol_02');

      // Verify provoked captain_01 (full HP, provoked via attacking merchant_01) is NOT reset on BREAK
      engine.reset();
      state = engine.getState();
      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      const merchant = getEntity(engine, 'merchant_01');
      const captain = getEntity(engine, 'captain_01');
      state.player.position = { x: merchant.position.x - 1, y: merchant.position.y };
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // hit merchant_01 -> provokes captain_01
      assertEqual(captain.provoked, true, 'attacking merchant_01 must provoke captain_01');
      assertEqual(captain.hp, captain.maxHp, 'captain_01 is untouched at full HP');
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      assertEqual(captain.provoked, true, 'BREAK must NOT reset provoked on captain_01');
    },
  },
  {
    name: 'Quick-fix v0.1.2: choosing KEEP locks lucidity against all subsequent lucidity sources',
    run: () => {
      const engine = new GameEngine();
      const state = engine.getState();

      // Reach 70 and lock filterChoice = KEEP
      engine.debugAddLucidity(70);
      assertEqual(state.lucidity, 70, 'lucidity should start at 70 before KEEP');
      assertEqual(state.pendingFilterChoice, true, 'threshold prompt must open at 70');
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' });
      assertEqual(state.filterChoice, 'KEEP', 'filterChoice must be KEEP');

      // 1. Debug lucidity button / call must not increase lucidity
      const debugEvents = engine.debugAddLucidity(15);
      assertEqual(state.lucidity, 70, 'debugAddLucidity must not change lucidity after KEEP');
      assert(
        !debugEvents.some((e) => e.type === 'LUCIDITY_CHANGED'),
        'no LUCIDITY_CHANGED from debugAddLucidity after KEEP',
      );

      // 2. Killing patrol_01 (+15 outpost milestone) must not increase lucidity
      const patrol1 = getEntity(engine, 'patrol_01');
      patrol1.hp = 10;
      patrol1.position = { x: 2, y: 3 };
      state.player.position = { x: 1, y: 3 };
      const killEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(patrol1.hp, 0, 'patrol_01 should be defeated');
      assertEqual(state.lucidity, 70, 'killing patrol_01 must not increase lucidity after KEEP');
      assert(
        !killEvents.some((e) => e.type === 'LUCIDITY_CHANGED'),
        'no LUCIDITY_CHANGED on outpost kill after KEEP',
      );

      // 3. Picking up warm_bread (+20) & patrol_badge (+25) must not increase lucidity
      state.groundItems.push(
        { itemId: 'warm_bread', roomId: 'room_outpost', position: { x: 2, y: 3 } },
        { itemId: 'patrol_badge', roomId: 'room_outpost', position: { x: 2, y: 3 } },
      );
      const pickupEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.lucidity, 70, 'item pickups must not increase lucidity after KEEP');
      assert(
        !pickupEvents.some((e) => e.type === 'LUCIDITY_CHANGED'),
        'no LUCIDITY_CHANGED on item pickups after KEEP',
      );

      // 4. First entry to room_depot (+15) must not increase lucidity
      state.player.position = { x: 6, y: 3 };
      const depotEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.currentRoomId, 'room_depot', 'should enter room_depot');
      assertEqual(state.lucidity, 70, 'entering room_depot must not increase lucidity after KEEP');
      assert(
        !depotEvents.some((e) => e.type === 'LUCIDITY_CHANGED'),
        'no LUCIDITY_CHANGED on room_depot entry after KEEP',
      );

      // 5. Attacking civilian courier_01 (+10 hit +15 provoke patrol_02) must not increase lucidity
      const courier = getEntity(engine, 'courier_01');
      state.player.position = { x: courier.position.x - 1, y: courier.position.y };
      const attackEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.lucidity, 70, 'attacking courier_01 must not increase lucidity after KEEP');
      assert(
        !attackEvents.some((e) => e.type === 'LUCIDITY_CHANGED'),
        'no LUCIDITY_CHANGED when attacking civilian after KEEP',
      );
    },
  },
  {
    name: 'Phase 4 Step 2: Build stats, setBuildAndReset(), parameterless reset() preserves build & clears trait flags, and summoner_blessing stacks dynamically',
    run: () => {
      // Default build: human + brawler -> 100 HP, 16 ATK
      const engine = new GameEngine();
      let state = engine.getState();
      assertEqual(state.selectedRaceId, 'human', 'default race is human');
      assertEqual(state.selectedClassId, 'brawler', 'default class is brawler');
      assertEqual(state.player.maxHp, 100, 'human + brawler maxHp is 100');
      assertEqual(state.player.hp, 100, 'human + brawler hp starts full at 100');
      assertEqual(engine.getEffectiveAttack(state.player), 16, 'human + brawler ATK is 16');

      // Switch to dark_elf + spellblade -> 85 HP, 20 ATK
      engine.setBuildAndReset('dark_elf', 'spellblade');
      state = engine.getState();
      assertEqual(state.selectedRaceId, 'dark_elf', 'race updated to dark_elf');
      assertEqual(state.selectedClassId, 'spellblade', 'class updated to spellblade');
      assertEqual(state.player.maxHp, 85, 'dark_elf + spellblade maxHp is 85');
      assertEqual(state.player.hp, 85, 'dark_elf + spellblade hp starts at 85');
      assertEqual(engine.getEffectiveAttack(state.player), 20, 'dark_elf + spellblade ATK is 20');

      // Activate summoner_blessing (KEEP): +20 Max HP (85 -> 105), +8 ATK (20 -> 28)
      state.player.hp = 50;
      engine.debugAddLucidity(70);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' });
      assertEqual(state.player.maxHp, 105, 'summoner_blessing adds +20 maxHp onto 85 -> 105');
      assertEqual(state.player.hp, 75, 'summoner_blessing heals +25 HP (50 -> 75)');
      assertEqual(engine.getEffectiveAttack(state.player), 28, 'summoner_blessing adds +8 ATK -> 28');

      // Switch to undead_outsider + iron_vanguard -> 135 HP, 13 ATK; dirty trait state then reset() with NO args
      engine.setBuildAndReset('undead_outsider', 'iron_vanguard');
      state = engine.getState();
      assertEqual(state.player.maxHp, 135, 'undead_outsider + iron_vanguard maxHp is 135');
      assertEqual(engine.getEffectiveAttack(state.player), 13, 'undead_outsider + iron_vanguard ATK is 13');

      state.lastAttackedTargetId = 'patrol_01';
      state.consecutiveHitsOnTarget = 3;
      state.isGuardingFromWait = true;

      engine.reset();
      state = engine.getState();
      assertEqual(state.selectedRaceId, 'undead_outsider', 'parameterless reset() preserves selectedRaceId');
      assertEqual(state.selectedClassId, 'iron_vanguard', 'parameterless reset() preserves selectedClassId');
      assertEqual(state.player.maxHp, 135, 'preserved build keeps 135 maxHp');
      assertEqual(state.lastAttackedTargetId, null, 'reset() clears lastAttackedTargetId');
      assertEqual(state.consecutiveHitsOnTarget, 0, 'reset() clears consecutiveHitsOnTarget');
      assertEqual(state.isGuardingFromWait, false, 'reset() clears isGuardingFromWait');
    },
  },
  {
    name: 'Phase 4 Step 2: adaptability (human) +10 heal bonus, actualHeal clamping, triggeredTraitId, and non-human control',
    run: () => {
      // Human uses warm_bread (25 + 10 = 35 HP)
      const engine = new GameEngine('human', 'brawler');
      let state = engine.getState();
      const patrol1 = getEntity(engine, 'patrol_01');
      patrol1.position = { x: 6, y: 6 }; // keep out of aggro range

      state.player.hp = 50;
      state.inventory.push('warm_bread', 'healing_tonic');
      const breadEvents = engine.handleAction({ type: 'USE_ITEM', itemId: 'warm_bread' });
      const breadUsed = breadEvents.find((e) => e.type === 'ITEM_USED');
      assert(breadUsed !== undefined && breadUsed.type === 'ITEM_USED', 'ITEM_USED emitted for warm_bread');
      if (breadUsed && breadUsed.type === 'ITEM_USED') {
        assertEqual(breadUsed.healAmount, 35, 'human adaptability heals 25 + 10 = 35 HP');
        assertEqual(breadUsed.playerHp, 85, 'player HP becomes 85');
        assertEqual(breadUsed.triggeredTraitId, 'adaptability', 'triggeredTraitId is adaptability');
      }

      // Clamped heal (85 + 45 -> 100, actualHeal = 15) still marks adaptability
      const tonicEvents = engine.handleAction({ type: 'USE_ITEM', itemId: 'healing_tonic' });
      const tonicUsed = tonicEvents.find((e) => e.type === 'ITEM_USED');
      if (tonicUsed && tonicUsed.type === 'ITEM_USED') {
        assertEqual(tonicUsed.healAmount, 15, 'clamped actualHeal is 15');
        assertEqual(tonicUsed.playerHp, 100, 'player HP capped at 100');
        assertEqual(tonicUsed.triggeredTraitId, 'adaptability', 'clamped heal still tags adaptability');
      }

      // Non-human (dark_elf) uses warm_bread -> exact 25 HP, no triggeredTraitId
      engine.setBuildAndReset('dark_elf', 'brawler');
      state = engine.getState();
      getEntity(engine, 'patrol_01').position = { x: 6, y: 6 };
      state.player.hp = 40;
      state.inventory.push('warm_bread');
      const elfHealEvents = engine.handleAction({ type: 'USE_ITEM', itemId: 'warm_bread' });
      const elfUsed = elfHealEvents.find((e) => e.type === 'ITEM_USED');
      if (elfUsed && elfUsed.type === 'ITEM_USED') {
        assertEqual(elfUsed.healAmount, 25, 'dark_elf heals base 25 HP without adaptability');
        assertEqual(elfUsed.triggeredTraitId, undefined, 'dark_elf ITEM_USED has no triggeredTraitId');
      }
    },
  },
  {
    name: 'Phase 4 Step 2: keen_sight (dark_elf) +5 on natural lucidity only, blocks <= 0, ignores debug/forced_threshold, and obeys KEEP lock',
    run: () => {
      const engine = new GameEngine('dark_elf', 'brawler');
      let state = engine.getState();

      // 1. Guard: addLucidity(0, 'natural') and negative values must NOT add +5
      const zeroEvents = engine.addLucidity(0, 'natural');
      const negEvents = engine.addLucidity(-10, 'natural');
      assertEqual(state.lucidity, 0, 'addLucidity(<=0, natural) must not grant keen_sight +5');
      assertEqual(zeroEvents.length + negEvents.length, 0, 'no LUCIDITY_CHANGED on <= 0');

      // 2. debugAddLucidity ('debug' source) adds exact 15, NOT 20
      engine.debugAddLucidity(15);
      assertEqual(state.lucidity, 15, 'debug source must bypass keen_sight (+15 only)');

      // 3. Natural sources add +5 each: outpost kill (+15+5=20 -> 35) + depot entry (+15+5=20 -> 55)
      const patrol1 = getEntity(engine, 'patrol_01');
      patrol1.hp = 10;
      patrol1.position = { x: 2, y: 3 };
      state.player.position = { x: 1, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.lucidity, 35, 'killing patrol_01 awards 15 + 5 = 20 (-> 35)');

      state.player.position = { x: 6, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // enter room_depot
      assertEqual(state.lucidity, 55, 'entering room_depot awards 15 + 5 = 20 (-> 55)');

      // 4. Forced checkpoint shock ('forced_threshold') raises 55 -> exact 70, NOT 75
      state.player.position = { x: 6, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // enter room_checkpoint
      assertEqual(state.lucidity, 70, 'forced_threshold shock stops at exact 70 without +5');
      assertEqual(state.pendingFilterChoice, true, 'filter choice opens at 70');

      // 5. Choosing KEEP locks keen_sight completely against subsequent natural sources
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' });
      state.groundItems.push({
        itemId: 'patrol_badge',
        roomId: 'room_checkpoint',
        position: { x: 2, y: 3 },
      });
      state.player.position = { x: 1, y: 3 };
      const lockedPickup = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.lucidity, 70, 'KEEP must lock dark_elf lucidity at 70');
      assert(
        !lockedPickup.some((e) => e.type === 'LUCIDITY_CHANGED'),
        'no LUCIDITY_CHANGED on natural pickup after KEEP',
      );
    },
  },
  {
    name: 'Phase 4 Step 2: combo_strike (brawler) +6 on even consecutive hits, persists across USE_ITEM/WAIT/MOVE, resets on target switch or room transition',
    run: () => {
      const engine = new GameEngine('human', 'brawler'); // 16 ATK, +6 on even hits -> 22
      const state = engine.getState();
      const captain = getEntity(engine, 'captain_01');
      const merchant = getEntity(engine, 'merchant_01');

      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      state.lucidity = 70;
      state.filterChoice = 'BREAK';
      captain.provoked = true;
      captain.hp = 200;
      captain.maxHp = 200;
      captain.position = { x: 4, y: 4 };
      merchant.position = { x: 6, y: 2 };
      state.player.position = { x: 3, y: 4 };
      state.inventory.push('warm_bread');

      // Hit 1 on captain_01: 16 damage (odd hit -> no combo)
      const hit1 = engine
        .handleAction({ type: 'MOVE', direction: 'right' })
        .find((e) => e.type === 'ATTACKED');
      assert(hit1 !== undefined && hit1.type === 'ATTACKED', 'hit 1 emitted');
      if (hit1 && hit1.type === 'ATTACKED') {
        assertEqual(hit1.damage, 16, 'hit 1 deals base 16 damage');
        assertEqual(hit1.triggeredTraitId, undefined, 'hit 1 has no combo trait');
      }

      // Interleave USE_ITEM, WAIT, and floor MOVE -> must NOT reset combo counter on captain_01
      engine.handleAction({ type: 'USE_ITEM', itemId: 'warm_bread' });
      engine.handleAction({ type: 'WAIT' });
      engine.handleAction({ type: 'MOVE', direction: 'up' }); // (3, 3)
      captain.position = { x: 4, y: 3 };

      // Hit 2 on captain_01: 16 + 6 = 22 damage with combo_strike!
      const hit2 = engine
        .handleAction({ type: 'MOVE', direction: 'right' })
        .find((e) => e.type === 'ATTACKED');
      if (hit2 && hit2.type === 'ATTACKED') {
        assertEqual(hit2.damage, 22, 'hit 2 after USE_ITEM/WAIT/MOVE still triggers 16 + 6 = 22');
        assertEqual(hit2.triggeredTraitId, 'combo_strike', 'hit 2 tags combo_strike');
        assertEqual(hit2.bonusDamage, 6, 'hit 2 bonusDamage is 6');
      }

      // Hit 3 on captain_01: back to 16; then switch target to merchant_01 -> resets streak to 1 (16 dmg, not 22!)
      const hit3 = engine
        .handleAction({ type: 'MOVE', direction: 'right' })
        .find((e) => e.type === 'ATTACKED');
      if (hit3 && hit3.type === 'ATTACKED') {
        assertEqual(hit3.damage, 16, 'hit 3 deals 16 damage');
      }

      merchant.provoked = true;
      merchant.position = { x: 3, y: 2 };
      const switchHit = engine
        .handleAction({ type: 'MOVE', direction: 'up' })
        .find((e) => e.type === 'ATTACKED');
      if (switchHit && switchHit.type === 'ATTACKED') {
        assertEqual(switchHit.targetId, 'merchant_01', 'switched target to merchant_01');
        assertEqual(switchHit.damage, 16, 'switching target resets streak to 1 (no +6 bonus on hit 4)');
        assertEqual(switchHit.triggeredTraitId, undefined, 'no combo_strike when switching target');
      }

      // Room transition via door resets combo state completely
      state.player.position = { x: 1, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'left' }); // door to room_depot
      assertEqual(state.currentRoomId, 'room_depot', 'moved to room_depot');
      assertEqual(state.lastAttackedTargetId, null, 'room transition clears lastAttackedTargetId');
      assertEqual(state.consecutiveHitsOnTarget, 0, 'room transition clears consecutiveHitsOnTarget');
    },
  },
  {
    name: 'Phase 4 Step 2: first_strike (spellblade) +8 opening hit on full-HP target only',
    run: () => {
      const engine = new GameEngine('human', 'spellblade'); // 18 ATK, +8 on full HP -> 26
      const state = engine.getState();
      const patrol1 = getEntity(engine, 'patrol_01'); // 50/50 HP
      patrol1.position = { x: 2, y: 3 };
      state.player.position = { x: 1, y: 3 };

      // First hit while patrol_01 is 50/50 -> 18 + 8 = 26
      const openEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      const firstHit = openEvents.find((e) => e.type === 'ATTACKED');
      if (firstHit && firstHit.type === 'ATTACKED') {
        assertEqual(firstHit.damage, 26, 'first_strike deals 18 + 8 = 26 on full-HP target');
        assertEqual(firstHit.triggeredTraitId, 'first_strike', 'tags first_strike');
        assertEqual(firstHit.bonusDamage, 8, 'bonusDamage is 8');
      }

      // Second hit when patrol_01 is 24/50 -> base 18 only
      const secondEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      const secondHit = secondEvents.find((e) => e.type === 'ATTACKED');
      if (secondHit && secondHit.type === 'ATTACKED') {
        assertEqual(secondHit.damage, 18, 'subsequent hit on injured target deals base 18');
        assertEqual(secondHit.triggeredTraitId, undefined, 'no first_strike when target < maxHp');
        assertEqual(secondHit.bonusDamage, undefined, 'no bonusDamage on injured target');
      }
    },
  },
  {
    name: 'Phase 4 Step 2: iron_stance & undying_frame — guard retention on rejected actions, reduction order, priority, patrol_01/captain_01 counter-kill, and no dead-player counter',
    run: () => {
      // 1. Guard retention when bumping WALL, OBSTACLE, or full-HP USE_ITEM; cleared on valid floor MOVE
      const engine = new GameEngine('human', 'iron_vanguard');
      let state = engine.getState();
      const patrol1 = getEntity(engine, 'patrol_01');
      patrol1.position = { x: 6, y: 6 }; // far away so WAIT does not get consumed immediately
      state.inventory.push('warm_bread');

      engine.handleAction({ type: 'WAIT' });
      assertEqual(state.isGuardingFromWait, true, 'WAIT enables isGuardingFromWait');
      engine.handleAction({ type: 'WAIT' });
      assertEqual(state.isGuardingFromWait, true, 'consecutive WAIT keeps isGuardingFromWait true');

      // Player is at (1, 3): left is WALL (0, 3)
      assertEqual(engine.handleAction({ type: 'MOVE', direction: 'left' }).length, 0, 'wall move rejected');
      assertEqual(state.isGuardingFromWait, true, 'wall bump must NOT clear isGuardingFromWait');

      // Full-HP USE_ITEM is rejected
      assertEqual(
        engine.handleAction({ type: 'USE_ITEM', itemId: 'warm_bread' }).length,
        0,
        'full-HP item rejected',
      );
      assertEqual(state.isGuardingFromWait, true, 'rejected USE_ITEM must NOT clear isGuardingFromWait');

      // Move next to obstacle (3, 2) -> player at (2, 2), bump right into OBSTACLE 'X' at (3, 2)
      state.player.position = { x: 2, y: 2 };
      engine.handleAction({ type: 'WAIT' });
      assertEqual(engine.handleAction({ type: 'MOVE', direction: 'right' }).length, 0, 'obstacle move rejected');
      assertEqual(state.isGuardingFromWait, true, 'obstacle bump must NOT clear isGuardingFromWait');

      // Valid floor MOVE consumes turn and clears guard
      engine.handleAction({ type: 'MOVE', direction: 'down' });
      assertEqual(state.isGuardingFromWait, false, 'valid MOVE clears isGuardingFromWait');

      // 2. Counter-kill patrol_01 (6 HP left) -> drops healing_tonic & awards +15 outpost lucidity
      patrol1.provoked = true;
      patrol1.hp = 6;
      patrol1.position = { x: 3, y: 3 };
      state.player.position = { x: 2, y: 3 };
      const counterKillPatrol = engine.handleAction({ type: 'WAIT' });
      assertEqual(patrol1.hp, 0, 'counter-attack reduces patrol_01 HP to 0');
      assert(
        counterKillPatrol.some((e) => e.type === 'ENTITY_DIED' && e.entityId === 'patrol_01'),
        'counter-kill emits ENTITY_DIED',
      );
      assert(
        counterKillPatrol.some((e) => e.type === 'ITEM_DROPPED' && e.itemId === 'healing_tonic'),
        'counter-kill drops healing_tonic',
      );
      assertEqual(state.lucidity, 15, 'counter-killing patrol_01 awards +15 outpost lucidity');

      // 3. Dead player does NOT counter-attack when killed through iron_stance
      engine.setBuildAndReset('human', 'iron_vanguard');
      state = engine.getState();
      const lethalPatrol = getEntity(engine, 'patrol_01'); // 12 ATK -> 6 dmg through iron_stance
      lethalPatrol.provoked = true;
      lethalPatrol.hp = 6;
      lethalPatrol.position = { x: 2, y: 3 };
      state.player.position = { x: 1, y: 3 };
      state.player.hp = 5; // 5 - 6 -> 0 HP (player dies)
      const deathEvents = engine.handleAction({ type: 'WAIT' });
      const lethalHit = deathEvents.find((e) => e.type === 'ENEMY_ATTACKED');
      assertEqual(state.isGameOver, true, 'player dies when finalDamage >= hp');
      assertEqual(lethalPatrol.hp, 6, 'dead player must NOT counter-damage attacker');
      if (lethalHit && lethalHit.type === 'ENEMY_ATTACKED') {
        assertEqual(lethalHit.damage, 6, 'iron_stance still halved 12 -> 6');
        assertEqual(lethalHit.counterDamage, undefined, 'counterDamage omitted when player dies');
      }

      // 4. Combined undead_outsider + iron_vanguard: order Math.floor(16*0.5) - 2 = 6, priority iron_stance,
      //    second attacker in same turn gets undying_frame only, and min-1 damage clamp works
      engine.setBuildAndReset('undead_outsider', 'iron_vanguard');
      state = engine.getState();
      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      state.lucidity = 70;
      state.filterChoice = 'KEEP';
      state.player.position = { x: 4, y: 4 };

      const captain = getEntity(engine, 'captain_01'); // 16 ATK at (5, 4)
      captain.provoked = true;
      // Bring patrol_02 into room_checkpoint adjacent to player at (4, 5) to test 2nd hit in same turn
      const patrol2 = getEntity(engine, 'patrol_02'); // 14 ATK
      patrol2.roomId = 'room_checkpoint';
      patrol2.provoked = true;
      patrol2.position = { x: 4, y: 5 };

      const comboDefEvents = engine.handleAction({ type: 'WAIT' });
      const enemyHits = comboDefEvents.filter((e) => e.type === 'ENEMY_ATTACKED');
      assertEqual(enemyHits.length, 2, 'two adjacent enemies attack in same turn');
      const firstDefHit = enemyHits[0];
      const secondDefHit = enemyHits[1];
      if (firstDefHit.type === 'ENEMY_ATTACKED' && secondDefHit.type === 'ENEMY_ATTACKED') {
        // Note: patrol_02 appears before captain_01 in entities.json!
        // patrol_02 (14 ATK): floor(14 * 0.5) - 2 = 7 - 2 = 5 (reduced by 9), counter 6, priority iron_stance
        assertEqual(firstDefHit.attackerId, 'patrol_02', 'patrol_02 attacks first');
        assertEqual(firstDefHit.damage, 5, 'floor(14*0.5) - 2 = 5');
        assertEqual(firstDefHit.damageReduced, 9, '14 - 5 = 9 reduced');
        assertEqual(firstDefHit.counterDamage, 6, '6 counter damage on first hit');
        assertEqual(firstDefHit.triggeredTraitId, 'iron_stance', 'iron_stance prioritized over undying_frame');

        // captain_01 (16 ATK) hits second after guard flag was consumed: 16 - 2 = 14, undying_frame only
        assertEqual(secondDefHit.attackerId, 'captain_01', 'captain_01 attacks second');
        assertEqual(secondDefHit.damage, 14, '16 - 2 = 14 via undying_frame only');
        assertEqual(secondDefHit.damageReduced, 2, 'damageReduced is 2');
        assertEqual(secondDefHit.counterDamage, undefined, 'guard already consumed on first hit');
        assertEqual(secondDefHit.triggeredTraitId, 'undying_frame', 'falls back to undying_frame');
      }

      // Minimum 1 damage clamp & counter-killing captain_01 halts runRoomAi immediately before merchant_01 flees
      patrol2.roomId = 'room_depot'; // move patrol_02 back out
      const merchant = getEntity(engine, 'merchant_01');
      merchant.hp = 20; // hurt so merchant_01 would flee if loop didn't break after captain_01 dies
      captain.attack = 2; // floor(2 * 0.5) = 1 -> max(1, 1 - 2) = 1 (min 1 clamp!)
      captain.hp = 6;
      const bossCounterKill = engine.handleAction({ type: 'WAIT' });
      const clampHit = bossCounterKill.find((e) => e.type === 'ENEMY_ATTACKED');
      if (clampHit && clampHit.type === 'ENEMY_ATTACKED') {
        assertEqual(clampHit.damage, 1, 'minimum incoming damage clamped to 1');
      }
      assertEqual(state.endingId, 'SUMMONER_BLADE', 'counter-killing captain_01 sets SUMMONER_BLADE');
      assertLastEvent(
        bossCounterKill,
        { type: 'GAME_ENDED', endingId: 'SUMMONER_BLADE' },
        'counter-kill captain_01 ends game immediately',
      );
      assert(
        !bossCounterKill.some((e) => e.type === 'AI_FLED'),
        'runRoomAi must break immediately after counter-killing captain_01',
      );
    },
  },
  {
    name: 'Phase 4 Step 2: 3 representative builds defeat unbuffed captain_01 (110 HP, 16 ATK) cleanly',
    run: () => {
      function setupBossDuel(
        raceId: 'human' | 'dark_elf' | 'undead_outsider',
        classId: 'brawler' | 'iron_vanguard' | 'spellblade',
      ): GameEngine {
        const eng = new GameEngine(raceId, classId);
        const st = eng.getState();
        st.currentRoomId = 'room_checkpoint';
        st.player.roomId = 'room_checkpoint';
        st.lucidity = 70;
        st.filterChoice = 'BREAK'; // unbuffed Kẻ Phá Luật combat conditions
        st.player.position = { x: 4, y: 4 };
        const cap = getEntity(eng, 'captain_01');
        cap.provoked = true;
        cap.position = { x: 5, y: 4 };
        return eng;
      }

      // Build 1: human + brawler (100 HP, 16 ATK) -> 6 strikes (16+22+16+22+16+22 = 114), takes 5 hits (80) -> 20 HP left
      const brawlerEng = setupBossDuel('human', 'brawler');
      while (brawlerEng.getState().endingId === null && !brawlerEng.getState().isGameOver) {
        brawlerEng.handleAction({ type: 'MOVE', direction: 'right' });
      }
      assertEqual(brawlerEng.getState().endingId, 'SUMMONER_BLADE', 'human + brawler defeats captain_01');
      assertEqual(brawlerEng.getState().player.hp, 20, 'human + brawler survives with 20 HP');

      // Build 2: dark_elf + spellblade (85 HP, 20 ATK) -> 28 + 20*5 = 128 in 6 strikes, takes 5 hits (80) -> 5 HP left
      const spellbladeEng = setupBossDuel('dark_elf', 'spellblade');
      while (spellbladeEng.getState().endingId === null && !spellbladeEng.getState().isGameOver) {
        spellbladeEng.handleAction({ type: 'MOVE', direction: 'right' });
      }
      assertEqual(spellbladeEng.getState().endingId, 'SUMMONER_BLADE', 'dark_elf + spellblade defeats captain_01');
      assertEqual(spellbladeEng.getState().player.hp, 5, 'dark_elf + spellblade survives at 5 HP');

      // Build 3: undead_outsider + iron_vanguard (135 HP, 13 ATK) -> alternate WAIT (take 6, counter 6) & strike (13)
      const tankEng = setupBossDuel('undead_outsider', 'iron_vanguard');
      let turnIndex = 0;
      while (tankEng.getState().endingId === null && !tankEng.getState().isGameOver) {
        if (turnIndex % 2 === 0) {
          tankEng.handleAction({ type: 'WAIT' });
        } else {
          tankEng.handleAction({ type: 'MOVE', direction: 'right' });
        }
        turnIndex++;
      }
      assertEqual(tankEng.getState().endingId, 'SUMMONER_BLADE', 'undead_outsider + iron_vanguard defeats captain_01');
      assertEqual(
        tankEng.getState().player.hp,
        29,
        'undead_outsider + iron_vanguard alternating WAIT + ATTACK survives with 29 HP',
      );
    },
  },
];

for (const test of tests) {
  test.run();
  console.log(`PASS: ${test.name}`);
}

console.log(`\nALL ${tests.length} GAME ENGINE TEST SUITES PASSED`);
