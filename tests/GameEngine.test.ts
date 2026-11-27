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
    name: 'BREAK branch: TALK with captain_01 (without and with patrol_badge) emits NPC_TALKED + BOSS_CHOICE_REACHED, pauses AI, and SURRENDER ends with AWAKENED',
    run: () => {
      // Case A: without patrol_badge
      const engine = new GameEngine();
      let state = engine.getState();
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });

      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      state.player.position = { x: 4, y: 4 }; // left of captain_01 at (5, 4)

      // Make merchant hurt so we confirm runRoomAi does not fire during pendingBossChoice or after AWAKENED
      getEntity(engine, 'merchant_01').hp = 20;

      const noBadgeTalkEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(getEntity(engine, 'captain_01').hp, 110, 'talking to captain_01 must not deal damage');
      assertEqual(state.pendingBossChoice, true, 'talking to captain_01 opens pendingBossChoice');
      assertEqual(state.endingId, null, 'endingId must remain null until boss choice is made');
      assertEqual(noBadgeTalkEvents.length, 2, 'only NPC_TALKED and BOSS_CHOICE_REACHED should fire');
      assertEqual(
        JSON.stringify(noBadgeTalkEvents[0]),
        JSON.stringify({
          type: 'NPC_TALKED',
          entityId: 'captain_01',
          hasBadge: false,
          raceId: 'human',
        }),
        'NPC_TALKED without badge includes raceId',
      );
      assertLastEvent(
        noBadgeTalkEvents,
        { type: 'BOSS_CHOICE_REACHED', entityId: 'captain_01' },
        'BOSS_CHOICE_REACHED without badge',
      );

      const surrenderNoBadge = engine.handleAction({
        type: 'CHOOSE_BOSS_ACTION',
        choice: 'SURRENDER',
      });
      assertEqual(state.pendingBossChoice, false, 'SURRENDER clears pendingBossChoice');
      assertEqual(state.endingId, 'AWAKENED', 'SURRENDER sets AWAKENED ending');
      assertLastEvent(
        surrenderNoBadge,
        { type: 'GAME_ENDED', endingId: 'AWAKENED' },
        'AWAKENED without badge',
      );

      // Post-ending lock check
      assertEqual(engine.handleAction({ type: 'WAIT' }).length, 0, 'WAIT blocked after AWAKENED');
      assertEqual(engine.handleAction({ type: 'MOVE', direction: 'left' }).length, 0, 'MOVE blocked after AWAKENED');

      // Case B: with patrol_badge (and dark_elf raceId check)
      engine.setBuildAndReset('dark_elf', 'brawler');
      state = engine.getState();
      state.inventory.push('patrol_badge');
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });

      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      state.player.position = { x: 4, y: 4 };

      const withBadgeTalkEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.pendingBossChoice, true, 'pendingBossChoice opens with badge');
      assertEqual(withBadgeTalkEvents.length, 2, 'only NPC_TALKED and BOSS_CHOICE_REACHED should fire');
      assertEqual(
        JSON.stringify(withBadgeTalkEvents[0]),
        JSON.stringify({
          type: 'NPC_TALKED',
          entityId: 'captain_01',
          hasBadge: true,
          raceId: 'dark_elf',
        }),
        'NPC_TALKED with badge includes accurate hasBadge and raceId',
      );
      assertLastEvent(
        withBadgeTalkEvents,
        { type: 'BOSS_CHOICE_REACHED', entityId: 'captain_01' },
        'BOSS_CHOICE_REACHED with badge',
      );

      const surrenderWithBadge = engine.handleAction({
        type: 'CHOOSE_BOSS_ACTION',
        choice: 'SURRENDER',
      });
      assertEqual(state.endingId, 'AWAKENED', 'SURRENDER with badge sets AWAKENED');
      assertLastEvent(
        surrenderWithBadge,
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
      state.isRiposteReady = true;
      state.depotAmbientTriggered = true;
      state.keenSightTriggeredThisTurn = true;

      engine.reset();
      state = engine.getState();
      assertEqual(state.selectedRaceId, 'undead_outsider', 'parameterless reset() preserves selectedRaceId');
      assertEqual(state.selectedClassId, 'iron_vanguard', 'parameterless reset() preserves selectedClassId');
      assertEqual(state.player.maxHp, 135, 'preserved build keeps 135 maxHp');
      assertEqual(state.lastAttackedTargetId, null, 'reset() clears lastAttackedTargetId');
      assertEqual(state.consecutiveHitsOnTarget, 0, 'reset() clears consecutiveHitsOnTarget');
      assertEqual(state.isGuardingFromWait, false, 'reset() clears isGuardingFromWait');
      assertEqual(state.isRiposteReady, false, 'reset() clears isRiposteReady');
      assertEqual(state.depotAmbientTriggered, false, 'reset() clears depotAmbientTriggered');
      assertEqual(state.keenSightTriggeredThisTurn, false, 'reset() clears keenSightTriggeredThisTurn');
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
    name: 'Phase 5 v0.3: keen_sight (dark_elf) +3 max 1/turn on natural lucidity, blocks <= 0, ignores debug/forced_threshold, and obeys KEEP lock',
    run: () => {
      const engine = new GameEngine('dark_elf', 'brawler');
      const state = engine.getState();

      // 1. Guard: addLucidity(0, 'natural') and negative values must NOT add +3 or consume turn trigger
      const zeroEvents = engine.addLucidity(0, 'natural');
      const negEvents = engine.addLucidity(-10, 'natural');
      assertEqual(state.lucidity, 0, 'addLucidity(<=0, natural) must not grant keen_sight +3');
      assertEqual(state.keenSightTriggeredThisTurn, false, '<=0 must not consume keenSightTriggeredThisTurn');
      assertEqual(zeroEvents.length + negEvents.length, 0, 'no LUCIDITY_CHANGED on <= 0');

      // 2. debugAddLucidity ('debug' source) adds exact 15, NOT 18
      engine.debugAddLucidity(15);
      assertEqual(state.lucidity, 15, 'debug source must bypass keen_sight (+15 only)');
      assertEqual(state.keenSightTriggeredThisTurn, false, 'debug source must not consume keenSightTriggeredThisTurn');

      // 3. Natural sources add +3 once per turn: outpost kill (+15+3=18 -> 33) + depot entry (+15+3=18 -> 51)
      const patrol1 = getEntity(engine, 'patrol_01');
      patrol1.hp = 10;
      patrol1.position = { x: 2, y: 3 };
      state.player.position = { x: 1, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.lucidity, 33, 'killing patrol_01 awards 15 + 3 = 18 (-> 33)');

      state.player.position = { x: 6, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // enter room_depot
      assertEqual(state.lucidity, 51, 'entering room_depot awards 15 + 3 = 18 (-> 51)');

      // 4. Forced checkpoint shock ('forced_threshold') raises 51 -> exact 70, NOT 73
      state.player.position = { x: 6, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // enter room_checkpoint
      assertEqual(state.lucidity, 70, 'forced_threshold shock stops at exact 70 without +3');
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
    name: 'Phase 5 v0.3: first_strike (spellblade) +10 opening hit on full-HP target & dark_elf + spellblade 2-turn patrol_01 kill',
    run: () => {
      // 1. human + spellblade (18 ATK, +10 on full HP -> 28, then 18)
      const engine = new GameEngine('human', 'spellblade');
      const state = engine.getState();
      const patrol1 = getEntity(engine, 'patrol_01'); // 50/50 HP
      patrol1.position = { x: 2, y: 3 };
      state.player.position = { x: 1, y: 3 };

      const openEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      const firstHit = openEvents.find((e) => e.type === 'ATTACKED');
      if (firstHit && firstHit.type === 'ATTACKED') {
        assertEqual(firstHit.damage, 28, 'first_strike deals 18 + 10 = 28 on full-HP target');
        assertEqual(firstHit.triggeredTraitId, 'first_strike', 'tags first_strike');
        assertEqual(firstHit.bonusDamage, 10, 'bonusDamage is 10');
      }

      const secondEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      const secondHit = secondEvents.find((e) => e.type === 'ATTACKED');
      if (secondHit && secondHit.type === 'ATTACKED') {
        assertEqual(secondHit.damage, 18, 'subsequent hit on injured target deals base 18');
        assertEqual(secondHit.triggeredTraitId, undefined, 'no first_strike when target < maxHp');
        assertEqual(secondHit.bonusDamage, undefined, 'no bonusDamage on injured target');
      }

      // 2. Breakpoint check: dark_elf + spellblade (20 ATK) defeats patrol_01 (50 HP) in exact 2 turns (30 + 20 = 50)
      engine.setBuildAndReset('dark_elf', 'spellblade');
      const elfState = engine.getState();
      const elfPatrol = getEntity(engine, 'patrol_01');
      elfPatrol.position = { x: 2, y: 3 };
      elfState.player.position = { x: 1, y: 3 };

      const turn1 = engine.handleAction({ type: 'MOVE', direction: 'right' });
      const t1Hit = turn1.find((e) => e.type === 'ATTACKED');
      assert(t1Hit !== undefined && t1Hit.type === 'ATTACKED', 'turn 1 attack emitted');
      if (t1Hit && t1Hit.type === 'ATTACKED') {
        assertEqual(t1Hit.damage, 30, 'dark_elf + spellblade turn 1 deals 20 + 10 = 30');
        assertEqual(t1Hit.targetRemainingHp, 20, 'patrol_01 has 20 HP left after turn 1');
      }
      assertEqual(elfState.player.hp, 73, 'dark_elf takes only 1 hit (85 - 12 = 73) before lethal turn 2');

      const turn2 = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assert(
        turn2.some((e) => e.type === 'ENTITY_DIED' && e.entityId === 'patrol_01'),
        'dark_elf + spellblade finishes patrol_01 on turn 2 (30 + 20 = 50)',
      );
      assert(
        !turn2.some((e) => e.type === 'ENEMY_ATTACKED'),
        'dead patrol_01 does not retaliate on turn 2',
      );
      assertEqual(elfState.player.hp, 73, 'dark_elf finishes Room 1 fight at 73/85 HP');
    },
  },
  {
    name: 'Phase 5 v0.3: 2-step iron_stance (isRiposteReady + riposte_strike +10) & undying_frame (flatDamageReduced)',
    run: () => {
      // 1. Guard retention when bumping WALL, OBSTACLE, or full-HP USE_ITEM; cleared on valid floor MOVE
      const engine = new GameEngine('human', 'iron_vanguard'); // 115 HP, 14 ATK
      let state = engine.getState();
      const patrol1 = getEntity(engine, 'patrol_01');
      patrol1.position = { x: 6, y: 6 };
      state.inventory.push('warm_bread');

      engine.handleAction({ type: 'WAIT' });
      assertEqual(state.isGuardingFromWait, true, 'WAIT enables isGuardingFromWait');
      assertEqual(state.isRiposteReady, false, 'WAIT alone does not arm isRiposteReady without taking a hit');

      assertEqual(engine.handleAction({ type: 'MOVE', direction: 'left' }).length, 0, 'wall move rejected');
      assertEqual(state.isGuardingFromWait, true, 'wall bump must NOT clear isGuardingFromWait');
      assertEqual(
        engine.handleAction({ type: 'USE_ITEM', itemId: 'warm_bread' }).length,
        0,
        'full-HP item rejected',
      );
      assertEqual(state.isGuardingFromWait, true, 'rejected USE_ITEM must NOT clear isGuardingFromWait');

      state.player.position = { x: 2, y: 2 };
      engine.handleAction({ type: 'WAIT' });
      assertEqual(engine.handleAction({ type: 'MOVE', direction: 'right' }).length, 0, 'obstacle move rejected');
      assertEqual(state.isGuardingFromWait, true, 'obstacle bump must NOT clear isGuardingFromWait');

      engine.handleAction({ type: 'MOVE', direction: 'down' });
      assertEqual(state.isGuardingFromWait, false, 'valid MOVE clears isGuardingFromWait');

      // 2. Guarded hit halves damage, deals 0 passive counter damage, arms isRiposteReady, persists across USE_ITEM/MOVE/WAIT, and consumes on ATTACK (+10 riposte_strike)
      patrol1.provoked = true;
      patrol1.hp = 50;
      patrol1.position = { x: 3, y: 3 };
      state.player.position = { x: 2, y: 3 };
      const guardTurn = engine.handleAction({ type: 'WAIT' });
      const guardedHit = guardTurn.find((e) => e.type === 'ENEMY_ATTACKED');
      assertEqual(patrol1.hp, 50, 'iron_stance must NOT deal passive counter damage on block');
      assertEqual(state.isGuardingFromWait, false, 'guarded hit consumes isGuardingFromWait');
      assertEqual(state.isRiposteReady, true, 'guarded hit arms isRiposteReady when player survives');
      if (guardedHit && guardedHit.type === 'ENEMY_ATTACKED') {
        assertEqual(guardedHit.damage, 6, 'patrol_01 12 ATK halved to 6');
        assertEqual(guardedHit.damageReduced, 6, 'damageReduced is 6');
        assertEqual(guardedHit.riposteArmed, true, 'riposteArmed is true on ENEMY_ATTACKED');
        assertEqual(guardedHit.triggeredTraitId, 'iron_stance', 'triggeredTraitId is iron_stance');
      }

      // Drink warm_bread, step away, and WAIT again -> isRiposteReady MUST stay true!
      engine.handleAction({ type: 'USE_ITEM', itemId: 'warm_bread' });
      assertEqual(state.isRiposteReady, true, 'USE_ITEM preserves isRiposteReady');
      engine.handleAction({ type: 'MOVE', direction: 'left' }); // (1, 3), patrol_01 chases to (2, 3)
      assertEqual(state.isRiposteReady, true, 'floor MOVE preserves isRiposteReady');
      engine.handleAction({ type: 'WAIT' }); // patrol_01 hits again -> stays true (no double +20 stacking)
      assertEqual(state.isRiposteReady, true, 'subsequent WAIT/block keeps boolean isRiposteReady true');

      // Strike patrol_01 -> consumes isRiposteReady = false and deals 14 + 10 = 24 (riposte_strike)!
      const riposteTurn = engine.handleAction({ type: 'MOVE', direction: 'right' });
      const riposteHit = riposteTurn.find((e) => e.type === 'ATTACKED');
      assertEqual(state.isRiposteReady, false, 'attack consumes isRiposteReady');
      if (riposteHit && riposteHit.type === 'ATTACKED') {
        assertEqual(riposteHit.damage, 24, 'human + iron_vanguard riposte deals 14 + 10 = 24');
        assertEqual(riposteHit.triggeredTraitId, 'riposte_strike', 'tags riposte_strike');
        assertEqual(riposteHit.bonusDamage, 10, 'bonusDamage is 10');
      }

      // Immediate follow-up strike without re-guarding deals base 14 only
      const normalTurn = engine.handleAction({ type: 'MOVE', direction: 'right' });
      const normalHit = normalTurn.find((e) => e.type === 'ATTACKED');
      if (normalHit && normalHit.type === 'ATTACKED') {
        assertEqual(normalHit.damage, 14, 'follow-up unguarded strike deals base 14');
        assertEqual(normalHit.triggeredTraitId, undefined, 'no riposte_strike once consumed');
      }

      // Room transition clears unspent isRiposteReady
      state.isRiposteReady = true;
      state.player.position = { x: 6, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // door to room_depot
      assertEqual(state.currentRoomId, 'room_depot', 'entered room_depot');
      assertEqual(state.isRiposteReady, false, 'ROOM_CHANGED clears isRiposteReady');

      // 3. Dead player does NOT arm isRiposteReady or riposteArmed when killed through iron_stance
      engine.setBuildAndReset('human', 'iron_vanguard');
      state = engine.getState();
      const lethalPatrol = getEntity(engine, 'patrol_01'); // 12 ATK -> 6 dmg
      lethalPatrol.provoked = true;
      lethalPatrol.position = { x: 2, y: 3 };
      state.player.position = { x: 1, y: 3 };
      state.player.hp = 5; // 5 - 6 -> 0 HP
      const deathEvents = engine.handleAction({ type: 'WAIT' });
      const lethalHit = deathEvents.find((e) => e.type === 'ENEMY_ATTACKED');
      assertEqual(state.isGameOver, true, 'player dies when finalDamage >= hp');
      assertEqual(state.isRiposteReady, false, 'dead player must NOT have isRiposteReady === true');
      if (lethalHit && lethalHit.type === 'ENEMY_ATTACKED') {
        assertEqual(lethalHit.damage, 6, 'iron_stance still halved 12 -> 6');
        assertEqual(lethalHit.riposteArmed, undefined, 'riposteArmed omitted when player dies');
      }

      // 4. Combined undead_outsider + iron_vanguard: flatDamageReduced recorded on BOTH guarded and unguarded hits
      engine.setBuildAndReset('undead_outsider', 'iron_vanguard');
      state = engine.getState();
      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      state.lucidity = 70;
      state.filterChoice = 'KEEP';
      state.player.position = { x: 4, y: 4 };

      const captain = getEntity(engine, 'captain_01'); // 16 ATK at (5, 4)
      captain.provoked = true;
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
        // patrol_02 (14 ATK): floor(14 * 0.5) - 2 = 7 - 2 = 5 (damageReduced 9, flatDamageReduced 2, riposteArmed true)
        assertEqual(firstDefHit.attackerId, 'patrol_02', 'patrol_02 attacks first');
        assertEqual(firstDefHit.damage, 5, 'floor(14*0.5) - 2 = 5');
        assertEqual(firstDefHit.damageReduced, 9, '14 - 5 = 9 total reduced');
        assertEqual(firstDefHit.flatDamageReduced, 2, 'flatDamageReduced is 2 even alongside iron_stance');
        assertEqual(firstDefHit.riposteArmed, true, 'riposteArmed true on first guarded hit');
        assertEqual(firstDefHit.triggeredTraitId, 'iron_stance', 'iron_stance prioritized on triggeredTraitId');

        // captain_01 (16 ATK) hits second: 16 - 2 = 14 (damageReduced 2, flatDamageReduced 2, riposteArmed undefined)
        assertEqual(secondDefHit.attackerId, 'captain_01', 'captain_01 attacks second');
        assertEqual(secondDefHit.damage, 14, '16 - 2 = 14 via undying_frame only');
        assertEqual(secondDefHit.damageReduced, 2, 'damageReduced is 2');
        assertEqual(secondDefHit.flatDamageReduced, 2, 'flatDamageReduced is 2');
        assertEqual(secondDefHit.riposteArmed, undefined, 'guard already consumed on first hit');
        assertEqual(secondDefHit.triggeredTraitId, 'undying_frame', 'falls back to undying_frame');
      }
      assertEqual(state.isRiposteReady, true, 'isRiposteReady stays armed after surviving second hit');

      // Minimum 1 damage clamp check
      patrol2.roomId = 'room_depot';
      captain.attack = 2; // floor(2 * 0.5) = 1 -> max(1, 1 - 2) = 1
      const clampTurn = engine.handleAction({ type: 'WAIT' });
      const clampHit = clampTurn.find((e) => e.type === 'ENEMY_ATTACKED');
      if (clampHit && clampHit.type === 'ENEMY_ATTACKED') {
        assertEqual(clampHit.damage, 1, 'minimum incoming damage clamped to 1');
      }
    },
  },
  {
    name: 'Phase 5 v0.3: All 9 Race x Class builds defeat unbuffed captain_01 (110 HP, 16 ATK) cleanly',
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
        st.filterChoice = 'BREAK';
        st.player.position = { x: 4, y: 4 };
        const cap = getEntity(eng, 'captain_01');
        cap.provoked = true;
        cap.position = { x: 5, y: 4 };
        return eng;
      }

      const races = ['human', 'dark_elf', 'undead_outsider'] as const;
      const classes = ['brawler', 'iron_vanguard', 'spellblade'] as const;

      for (const raceId of races) {
        for (const classId of classes) {
          const eng = setupBossDuel(raceId, classId);
          let guard = 0;
          while (eng.getState().endingId === null && !eng.getState().isGameOver && guard < 25) {
            const cap = eng.getState().entities.find((e) => e.id === 'captain_01');
            const baseAtk = eng.getEffectiveAttack(eng.getState().player);
            if (
              classId === 'iron_vanguard' &&
              !eng.getState().isRiposteReady &&
              cap &&
              cap.hp > baseAtk
            ) {
              eng.handleAction({ type: 'WAIT' });
            } else {
              eng.handleAction({ type: 'MOVE', direction: 'right' });
            }
            guard++;
          }
          assertEqual(
            eng.getState().endingId,
            'SUMMONER_BLADE',
            `${raceId} + ${classId} must defeat unbuffed captain_01`,
          );
          assert(
            eng.getState().player.hp > 0,
            `${raceId} + ${classId} must survive with > 0 HP (left: ${eng.getState().player.hp})`,
          );
        }
      }

      // Exact surviving HP anchors for 3 representative builds
      const spellbladeEng = setupBossDuel('dark_elf', 'spellblade'); // 30 + 20*4 = 110 in 5 strikes -> takes 4*16 = 64 -> 21 HP
      while (spellbladeEng.getState().endingId === null) {
        spellbladeEng.handleAction({ type: 'MOVE', direction: 'right' });
      }
      assertEqual(spellbladeEng.getState().player.hp, 21, 'dark_elf + spellblade survives at 21 HP');

      const tankEng = setupBossDuel('undead_outsider', 'iron_vanguard'); // 5*(WAIT 6 + Riposte 23), 4 retaliations of 14 -> 135 - 86 = 49 HP
      let step = 0;
      while (tankEng.getState().endingId === null) {
        if (step % 2 === 0) tankEng.handleAction({ type: 'WAIT' });
        else tankEng.handleAction({ type: 'MOVE', direction: 'right' });
        step++;
      }
      assertEqual(tankEng.getState().player.hp, 49, 'undead_outsider + iron_vanguard survives at 49 HP');
    },
  },
  {
    name: 'Phase 4 Step 3: All 3 endings (SUMMONER_BLADE via KEEP, Kẻ Phá Luật via BREAK + FIGHT, AWAKENED via BREAK + SURRENDER) are naturally reachable end-to-end',
    run: () => {
      function walkNaturallyToCheckpoint(eng: GameEngine): void {
        const bypassRoom = [
          'up',
          'up',
          'right',
          'right',
          'right',
          'right',
          'right',
          'down',
          'down',
          'right',
        ] as const;
        // Room 1 -> Room 2
        for (const dir of bypassRoom) {
          eng.handleAction({ type: 'MOVE', direction: dir });
        }
        assertEqual(eng.getState().currentRoomId, 'room_depot', 'entered room_depot naturally');
        // Room 2 -> Room 3
        for (const dir of bypassRoom) {
          eng.handleAction({ type: 'MOVE', direction: dir });
        }
        assertEqual(eng.getState().currentRoomId, 'room_checkpoint', 'entered room_checkpoint naturally');
        assertEqual(eng.getState().pendingFilterChoice, true, 'filter choice reached naturally');
      }

      // 1. Ending 1 (KEEP): Lưỡi Gươm Của Kẻ Triệu Hồi
      const keepEng = new GameEngine('human', 'brawler');
      walkNaturallyToCheckpoint(keepEng);
      keepEng.handleAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' });
      keepEng.handleAction({ type: 'MOVE', direction: 'down' }); // (1, 4) same row as captain_01
      let guardCounter = 0;
      while (keepEng.getState().endingId === null && !keepEng.getState().isGameOver && guardCounter < 20) {
        keepEng.handleAction({ type: 'MOVE', direction: 'right' });
        guardCounter++;
      }
      assertEqual(keepEng.getState().filterChoice, 'KEEP', 'KEEP branch preserved');
      assertEqual(keepEng.getState().endingId, 'SUMMONER_BLADE', 'natural KEEP ending reached');

      // 2. Ending 1 Variant (BREAK + FIGHT): Kẻ Phá Luật — without ever touching civilians!
      const ruleBreakerEng = new GameEngine('human', 'brawler');
      walkNaturallyToCheckpoint(ruleBreakerEng);
      ruleBreakerEng.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      // Walk from (1, 3) -> (4, 4), then step right into captain_01 at (5, 4)
      for (const dir of ['down', 'right', 'right', 'right'] as const) {
        ruleBreakerEng.handleAction({ type: 'MOVE', direction: dir });
      }
      const talkEvents = ruleBreakerEng.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(ruleBreakerEng.getState().pendingBossChoice, true, 'boss choice opened in BREAK');
      assert(
        talkEvents.some((e) => e.type === 'BOSS_CHOICE_REACHED' && e.entityId === 'captain_01'),
        'BOSS_CHOICE_REACHED emitted',
      );

      // Choose FIGHT -> immediate opening strike + captain retaliates -> finish duel naturally
      const fightOpenEvents = ruleBreakerEng.handleAction({
        type: 'CHOOSE_BOSS_ACTION',
        choice: 'FIGHT',
      });
      assertEqual(ruleBreakerEng.getState().pendingBossChoice, false, 'FIGHT clears pendingBossChoice');
      assertEqual(getEntity(ruleBreakerEng, 'captain_01').provoked, true, 'FIGHT provokes captain_01');
      assert(
        fightOpenEvents.some((e) => e.type === 'ATTACKED' && e.targetId === 'captain_01'),
        'FIGHT immediately executes opening attack',
      );
      assert(
        fightOpenEvents.some((e) => e.type === 'ENEMY_ATTACKED' && e.attackerId === 'captain_01'),
        'captain_01 retaliates on the same FIGHT turn',
      );

      guardCounter = 0;
      while (
        ruleBreakerEng.getState().endingId === null &&
        !ruleBreakerEng.getState().isGameOver &&
        guardCounter < 20
      ) {
        ruleBreakerEng.handleAction({ type: 'MOVE', direction: 'right' });
        guardCounter++;
      }
      assertEqual(ruleBreakerEng.getState().filterChoice, 'BREAK', 'filterChoice remains BREAK');
      assertEqual(
        ruleBreakerEng.getState().endingId,
        'SUMMONER_BLADE',
        'natural Kẻ Phá Luật ending (SUMMONER_BLADE + BREAK) reached',
      );

      // 3. Ending 2 (BREAK + SURRENDER): Người Xé Màn Sương
      const awakenedEng = new GameEngine('undead_outsider', 'iron_vanguard');
      walkNaturallyToCheckpoint(awakenedEng);
      awakenedEng.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      for (const dir of ['down', 'right', 'right', 'right', 'right'] as const) {
        awakenedEng.handleAction({ type: 'MOVE', direction: dir });
      }
      assertEqual(awakenedEng.getState().pendingBossChoice, true, 'boss choice opened');
      awakenedEng.handleAction({ type: 'CHOOSE_BOSS_ACTION', choice: 'SURRENDER' });
      assertEqual(awakenedEng.getState().filterChoice, 'BREAK', 'filterChoice is BREAK');
      assertEqual(awakenedEng.getState().endingId, 'AWAKENED', 'natural AWAKENED ending reached');
    },
  },
  {
    name: 'Phase 4 Step 3: pendingBossChoice locks, double-tap guard, reset cleanup, spellblade first_strike on FIGHT, and iron_vanguard guard-leak prevention',
    run: () => {
      // 1. Action locks while pendingBossChoice === true, double-tap guard, and reset cleanup
      const engine = new GameEngine('dark_elf', 'spellblade'); // 20 ATK + 8 first_strike = 28
      let state = engine.getState();
      state.inventory.push('warm_bread');
      state.player.hp = 60;

      // Out-of-turn CHOOSE_BOSS_ACTION when pendingBossChoice is false -> ignored
      assertEqual(
        engine.handleAction({ type: 'CHOOSE_BOSS_ACTION', choice: 'FIGHT' }).length,
        0,
        'CHOOSE_BOSS_ACTION ignored when pendingBossChoice is false',
      );

      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      state.player.position = { x: 4, y: 4 };

      engine.handleAction({ type: 'MOVE', direction: 'right' }); // TALK with captain_01
      assertEqual(state.pendingBossChoice, true, 'pendingBossChoice active');

      // All non-boss actions must be locked and return []
      assertEqual(engine.handleAction({ type: 'MOVE', direction: 'left' }).length, 0, 'MOVE locked');
      assertEqual(engine.handleAction({ type: 'WAIT' }).length, 0, 'WAIT locked');
      assertEqual(
        engine.handleAction({ type: 'USE_ITEM', itemId: 'warm_bread' }).length,
        0,
        'USE_ITEM locked',
      );
      assertEqual(
        engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' }).length,
        0,
        'CHOOSE_FILTER locked',
      );
      assertEqual(state.inventory.length, 1, 'locked USE_ITEM did not consume item');

      // 2. Spellblade FIGHT triggers first_strike (+10 -> 30 dmg) on full-HP captain_01!
      const fightEvents = engine.handleAction({ type: 'CHOOSE_BOSS_ACTION', choice: 'FIGHT' });
      const openingHit = fightEvents.find((e) => e.type === 'ATTACKED');
      assert(openingHit !== undefined && openingHit.type === 'ATTACKED', 'opening hit emitted');
      if (openingHit && openingHit.type === 'ATTACKED') {
        assertEqual(openingHit.damage, 30, 'spellblade FIGHT triggers 20 + 10 = 30 damage');
        assertEqual(openingHit.triggeredTraitId, 'first_strike', 'opening hit tags first_strike');
        assertEqual(openingHit.bonusDamage, 10, 'opening hit bonusDamage is 10');
      }

      // Double-tap CHOOSE_BOSS_ACTION immediately after FIGHT -> ignored
      assertEqual(
        engine.handleAction({ type: 'CHOOSE_BOSS_ACTION', choice: 'FIGHT' }).length,
        0,
        'double-tap CHOOSE_BOSS_ACTION ignored',
      );

      // Verify reset() clears pendingBossChoice if reset mid-dialog
      engine.reset();
      state = engine.getState();
      state.pendingBossChoice = true;
      engine.reset();
      assertEqual(engine.getState().pendingBossChoice, false, 'reset() clears pendingBossChoice');

      // Verify lethal opening FIGHT strike skips runRoomAi when endingId becomes non-null
      engine.setBuildAndReset('dark_elf', 'spellblade');
      state = engine.getState();
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      state.player.position = { x: 4, y: 4 };
      getEntity(engine, 'merchant_01').hp = 20; // hurt so it would flee if runRoomAi ran
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // TALK
      getEntity(engine, 'captain_01').hp = 20; // lethal on opening strike
      const lethalFight = engine.handleAction({ type: 'CHOOSE_BOSS_ACTION', choice: 'FIGHT' });
      assertEqual(state.endingId, 'SUMMONER_BLADE', 'lethal opening FIGHT sets SUMMONER_BLADE');
      assert(!lethalFight.some((e) => e.type === 'AI_FLED'), 'runRoomAi skipped after lethal opening FIGHT');

      // 3. Iron Vanguard pressing WAIT before TALK then choosing FIGHT must NOT leak isGuardingFromWait
      engine.setBuildAndReset('human', 'iron_vanguard');
      state = engine.getState();
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      state.player.position = { x: 4, y: 4 };

      engine.handleAction({ type: 'WAIT' });
      assertEqual(state.isGuardingFromWait, true, 'guard armed from WAIT');

      engine.handleAction({ type: 'MOVE', direction: 'right' }); // TALK with captain_01
      assertEqual(state.isGuardingFromWait, false, 'TALK clears isGuardingFromWait');

      // Even if manually forced true before CHOOSE_BOSS_ACTION, FIGHT still clears it
      state.isGuardingFromWait = true;
      const vanguardFight = engine.handleAction({ type: 'CHOOSE_BOSS_ACTION', choice: 'FIGHT' });
      const bossRetaliation = vanguardFight.find((e) => e.type === 'ENEMY_ATTACKED');
      if (bossRetaliation && bossRetaliation.type === 'ENEMY_ATTACKED') {
        assertEqual(bossRetaliation.damage, 16, 'captain_01 deals full 16 without leaked guard');
        assertEqual(bossRetaliation.riposteArmed, undefined, 'no leaked riposteArmed');
        assertEqual(bossRetaliation.triggeredTraitId, undefined, 'no leaked iron_stance');
      }
    },
  },
  {
    name: 'Phase 4 Step 3: Cloned position snapshots on ATTACKED, ENEMY_ATTACKED, and ITEM_USED resist AI_FLED/movement mutation, and regular NPCs omit raceId',
    run: () => {
      const engine = new GameEngine('human', 'brawler');
      const state = engine.getState();

      // 1. Attack courier_01 at (4, 2) -> courier_01 flees in AI_FLED, ATTACKED.targetPosition stays { x: 4, y: 2 }
      state.currentRoomId = 'room_depot';
      state.player.roomId = 'room_depot';
      state.player.position = { x: 3, y: 2 };
      const courier = getEntity(engine, 'courier_01');
      assertEqual(courier.position.x, 4, 'courier_01 starts at x=4');
      assertEqual(courier.position.y, 2, 'courier_01 starts at y=2');

      const hitCourierEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      const attackedEvent = hitCourierEvents.find((e) => e.type === 'ATTACKED');
      const fledEvent = hitCourierEvents.find((e) => e.type === 'AI_FLED');
      assert(fledEvent !== undefined, 'courier_01 fled on the same turn after being attacked');
      assert(
        courier.position.x !== 4 || courier.position.y !== 2,
        'courier_01 live position changed after fleeing',
      );
      if (attackedEvent && attackedEvent.type === 'ATTACKED') {
        assertEqual(
          JSON.stringify(attackedEvent.targetPosition),
          JSON.stringify({ x: 4, y: 2 }),
          'ATTACKED.targetPosition preserved pre-flee snapshot { x: 4, y: 2 }',
        );
        assert(
          attackedEvent.targetPosition !== courier.position,
          'ATTACKED.targetPosition is a distinct cloned object',
        );
      }

      // 2. ENEMY_ATTACKED & ITEM_USED clone positions independently from subsequent state mutations
      const patrol2 = getEntity(engine, 'patrol_02'); // provoked via attacking courier_01!
      patrol2.position = { x: 3, y: 3 };
      const waitEvents = engine.handleAction({ type: 'WAIT' });
      const enemyHit = waitEvents.find((e) => e.type === 'ENEMY_ATTACKED');
      if (enemyHit && enemyHit.type === 'ENEMY_ATTACKED') {
        assertEqual(
          JSON.stringify(enemyHit.attackerPosition),
          JSON.stringify({ x: 3, y: 3 }),
          'ENEMY_ATTACKED.attackerPosition matches attacker tile',
        );
        assertEqual(
          JSON.stringify(enemyHit.playerPosition),
          JSON.stringify({ x: 3, y: 2 }),
          'ENEMY_ATTACKED.playerPosition matches player tile',
        );
        assert(enemyHit.attackerPosition !== patrol2.position, 'attackerPosition is cloned');
        assert(enemyHit.playerPosition !== state.player.position, 'playerPosition is cloned');
      }

      state.inventory.push('warm_bread');
      const itemEvents = engine.handleAction({ type: 'USE_ITEM', itemId: 'warm_bread' });
      const itemUsed = itemEvents.find((e) => e.type === 'ITEM_USED');
      state.player.position.x = 1; // mutate live player position afterwards
      if (itemUsed && itemUsed.type === 'ITEM_USED') {
        assertEqual(
          JSON.stringify(itemUsed.playerPosition),
          JSON.stringify({ x: 3, y: 2 }),
          'ITEM_USED.playerPosition resisted subsequent player.position mutation',
        );
      }

      // 3. Regular NPCs omit raceId on NPC_TALKED
      engine.setBuildAndReset('undead_outsider', 'brawler');
      const breakState = engine.getState();
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      breakState.player.position = { x: 4, y: 4 }; // adjacent to patrol_01 at (5, 4)
      const patrolTalk = engine
        .handleAction({ type: 'MOVE', direction: 'right' })
        .find((e) => e.type === 'NPC_TALKED');
      if (patrolTalk && patrolTalk.type === 'NPC_TALKED') {
        assertEqual('raceId' in patrolTalk, false, 'regular NPC must not include raceId on NPC_TALKED');
      }
    },
  },
  {
    name: 'Hotfix v0.2.1: hasSpokenCombatBark prevents courier_01 & enemy bark spam across multiple turns, and resets on provoked change or room transition',
    run: () => {
      // 1. Attacking courier_01 emits DIALOGUE_SPOKEN once, and walking around for 7 turns emits 0 repeats
      const engine = new GameEngine('human', 'brawler');
      const state = engine.getState();
      state.currentRoomId = 'room_depot';
      state.player.roomId = 'room_depot';
      state.player.position = { x: 3, y: 2 }; // adjacent to courier_01 at (4, 2)
      state.player.hp = 500;
      state.player.maxHp = 500;

      const courier = getEntity(engine, 'courier_01');
      assertEqual(courier.hasSpokenCombatBark, false, 'starts with hasSpokenCombatBark === false');

      const firstHitEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      const courierBarksOnHit = firstHitEvents.filter(
        (e) => e.type === 'DIALOGUE_SPOKEN' && e.entityId === 'courier_01',
      );
      assertEqual(courierBarksOnHit.length, 1, 'courier_01 speaks once when first attacked');
      assertEqual(courier.hasSpokenCombatBark, true, 'courier_01 marks hasSpokenCombatBark = true');

      let repeatedCourierBarks = 0;
      let repeatedPatrol2Barks = 0;
      const walkPlan: Array<'WAIT' | 'left' | 'right' | 'down' | 'up'> = [
        'left',
        'WAIT',
        'down',
        'WAIT',
        'up',
        'WAIT',
        'right',
      ];
      for (const step of walkPlan) {
        const turnEvents =
          step === 'WAIT'
            ? engine.handleAction({ type: 'WAIT' })
            : engine.handleAction({ type: 'MOVE', direction: step });
        repeatedCourierBarks += turnEvents.filter(
          (e) => e.type === 'DIALOGUE_SPOKEN' && e.entityId === 'courier_01',
        ).length;
        repeatedPatrol2Barks += turnEvents.filter(
          (e) =>
            (e.type === 'DIALOGUE_SPOKEN' || e.type === 'GUARD_INTERVENED') &&
            e.entityId === 'patrol_02',
        ).length;
      }
      assertEqual(
        repeatedCourierBarks,
        0,
        'courier_01 must not spam DIALOGUE_SPOKEN across subsequent turns',
      );
      assertEqual(
        repeatedPatrol2Barks,
        0,
        'patrol_02 must not repeat bark after initial GUARD_INTERVENED',
      );

      // 2. Leaving Room 2 -> Room 1 and re-entering Room 2 resets hasSpokenCombatBark so hurt courier_01 speaks once again
      state.player.position = { x: 1, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'left' }); // door at (0, 3) -> room_outpost
      assertEqual(state.currentRoomId, 'room_outpost', 'transitioned back to room_outpost');
      assertEqual(
        courier.hasSpokenCombatBark,
        false,
        'room transition resets courier_01.hasSpokenCombatBark to false',
      );

      const reenterEvents = engine.handleAction({ type: 'MOVE', direction: 'right' }); // door at (7, 3) -> room_depot
      assertEqual(state.currentRoomId, 'room_depot', 're-entered room_depot');
      const barksOnReenter = reenterEvents.filter(
        (e) => e.type === 'DIALOGUE_SPOKEN' && e.entityId === 'courier_01',
      );
      assertEqual(barksOnReenter.length, 1, 'hurt courier_01 speaks once again after room transition');

      const postReenterWait = engine.handleAction({ type: 'WAIT' });
      assertEqual(
        postReenterWait.filter(
          (e) => e.type === 'DIALOGUE_SPOKEN' && e.entityId === 'courier_01',
        ).length,
        0,
        'courier_01 stays quiet again on subsequent turns after re-entry',
      );

      // 3. Changing provoked state (patrol_01 radius aggro -> BREAK reset -> re-provoke on attack) resets bark
      engine.reset();
      const s2 = engine.getState();
      const patrol1 = getEntity(engine, 'patrol_01');
      s2.player.position = { x: 2, y: 3 };
      // Step right to (3, 3): Manhattan dist to patrol_01 (5, 4) is 3 -> aggros & speaks once
      const aggroEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(patrol1.provoked, true, 'patrol_01 aggroed at dist <= 3');
      assertEqual(
        aggroEvents.filter((e) => e.type === 'DIALOGUE_SPOKEN' && e.entityId === 'patrol_01').length,
        1,
        'patrol_01 barks once on first aggro encounter',
      );
      assertEqual(patrol1.hasSpokenCombatBark, true, 'patrol_01 hasSpokenCombatBark is true');

      // Next WAIT while patrol_01 chases/attacks must NOT emit another bark
      const chaseEvents = engine.handleAction({ type: 'WAIT' });
      assertEqual(
        chaseEvents.filter((e) => e.type === 'DIALOGUE_SPOKEN' && e.entityId === 'patrol_01').length,
        0,
        'patrol_01 does not bark again on subsequent chase/attack turn',
      );

      // Trigger BREAK while patrol_01 is still full HP -> provoked flips true -> false, resetting bark
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      assertEqual(patrol1.provoked, false, 'BREAK calmed undamaged patrol_01');
      assertEqual(
        patrol1.hasSpokenCombatBark,
        false,
        'provoked true -> false reset patrol_01.hasSpokenCombatBark',
      );

      // Force provoked = true and attack patrol_01 -> speaks once again under new provoked state
      patrol1.provoked = true;
      s2.player.position = { x: patrol1.position.x - 1, y: patrol1.position.y };
      const reAttackEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(
        reAttackEvents.filter((e) => e.type === 'DIALOGUE_SPOKEN' && e.entityId === 'patrol_01')
          .length,
        1,
        'patrol_01 speaks once again after provoked state changed',
      );
    },
  },
  {
    name: 'Phase 5 v0.3: dark_elf full lucidity budget arc (18 -> 36 -> 64 < 70 -> 70+), Room 1 single-pack cap, and 1/turn keen_sight lock',
    run: () => {
      const engine = new GameEngine('dark_elf', 'brawler');
      let state = engine.getState();

      // Step 1: Room 1 — defeat patrol_01 (+15 + 3 = 18), then pick up healing_tonic (+0, shared outpostLucidityAwarded)
      const patrol1 = getEntity(engine, 'patrol_01');
      patrol1.hp = 10;
      patrol1.position = { x: 2, y: 3 };
      state.player.position = { x: 1, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // kills patrol_01, drops healing_tonic at (2, 3)
      assertEqual(state.lucidity, 18, 'Room 1 patrol_01 kill grants 15 + 3 = 18');
      assertEqual(state.outpostLucidityAwarded, true, 'outpostLucidityAwarded set');

      const tonicPickupEvents = engine.handleAction({ type: 'MOVE', direction: 'right' }); // steps onto (2, 3)
      assert(
        tonicPickupEvents.some((e) => e.type === 'ITEM_PICKED_UP' && e.itemId === 'healing_tonic'),
        'picked up healing_tonic in Room 1',
      );
      assertEqual(
        state.lucidity,
        18,
        'picking up healing_tonic after patrol_01 kill must NOT double-award Room 1 lucidity',
      );

      // Step 2: Enter Room 2 (room_depot) — shared depotEntryLucidityAwarded (+15 + 3 = 18 -> 36) + ROOM_AMBIENT_OBSERVED without double +15
      state.player.position = { x: 6, y: 3 };
      const depotEntryEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.currentRoomId, 'room_depot', 'entered room_depot');
      assertEqual(state.lucidity, 36, 'Room 2 entry + Ambient reaches exact 36 (enters Glitch phase >= 30)');
      assert(
        depotEntryEvents.some((e) => e.type === 'ROOM_AMBIENT_OBSERVED' && e.roomId === 'room_depot'),
        'ROOM_AMBIENT_OBSERVED emitted alongside depot entry',
      );

      // Rejected wall bump must NOT reset keenSightTriggeredThisTurn if manually checked
      state.keenSightTriggeredThisTurn = true;
      assertEqual(engine.handleAction({ type: 'MOVE', direction: 'left' }).length > 0, true, 'door left is valid; reset first');
      // Let's re-enter Room 2 cleanly (already awarded, stays 36)
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.lucidity, 36, 're-entering Room 2 stays at 36');
      state.player.position = { x: 1, y: 1 };
      state.keenSightTriggeredThisTurn = true;
      assertEqual(engine.handleAction({ type: 'MOVE', direction: 'up' }).length, 0, 'wall bump rejected');
      assertEqual(
        state.keenSightTriggeredThisTurn,
        true,
        'rejected wall bump must not reset keenSightTriggeredThisTurn',
      );

      // Step 3: Turn 1 attack on courier_01 (+10 civilian + 3 keen_sight once + 15 patrol_02 intervene = +28 -> 64 < 70!)
      const courier = getEntity(engine, 'courier_01'); // at (4, 2)
      state.player.position = { x: 3, y: 2 };
      const hitCourierTurn = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assert(
        hitCourierTurn.some((e) => e.type === 'GUARD_INTERVENED' && e.entityId === 'patrol_02'),
        'patrol_02 intervened on same turn',
      );
      assertEqual(
        state.lucidity,
        64,
        'dark_elf hits exact 64 < 70 (36 + 10 + 3 + 15 = 64) so Glitch combat plays out before threshold!',
      );
      assertEqual(state.pendingFilterChoice, false, 'pendingFilterChoice remains false at 64');

      // Step 4: Next turn hit on courier_01 resets keenSightTriggeredThisTurn and adds +10 + 3 = 13 (-> 77 >= 70!)
      state.player.position = { x: courier.position.x - 1, y: courier.position.y };
      const secondHitTurn = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.lucidity, 77, 'next turn keen_sight resets and adds 10 + 3 = 13 (-> 77)');
      assertEqual(state.pendingFilterChoice, true, 'dark_elf fractures Veil in Room 2 (1 room earlier)');
      assert(
        secondHitTurn.some((e) => e.type === 'FILTER_THRESHOLD_REACHED'),
        'FILTER_THRESHOLD_REACHED emitted at >= 70 in Room 2',
      );

      // Reverse Room 1 order check for dark_elf: pick up healing_tonic first (+18), then kill patrol_01 (+0)
      engine.reset();
      state = engine.getState();
      state.groundItems.push({ itemId: 'healing_tonic', roomId: 'room_outpost', position: { x: 2, y: 3 } });
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.lucidity, 18, 'healing_tonic first in Room 1 grants 15 + 3 = 18');
      const p1 = getEntity(engine, 'patrol_01');
      p1.hp = 10;
      p1.position = { x: 3, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.lucidity, 18, 'killing patrol_01 afterwards grants +0');
    },
  },
  {
    name: 'Phase 5 v0.3: Room 2 Ambient Encounter (ROOM_AMBIENT_OBSERVED) — cloned position, once/run, KEEP/BREAK/alive guards, and open Door D sandbox',
    run: () => {
      // 1. Standard entry: emits ROOM_AMBIENT_OBSERVED once with cloned position, shares +15 depotEntryLucidityAwarded, Door D open
      const engine = new GameEngine('human', 'brawler');
      let state = engine.getState();
      state.player.position = { x: 6, y: 3 };

      const enterDepot = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.currentRoomId, 'room_depot', 'entered room_depot');
      assertEqual(state.depotEntryLucidityAwarded, true, 'depotEntryLucidityAwarded true');
      assertEqual(state.depotAmbientTriggered, true, 'depotAmbientTriggered true');
      assertEqual(state.lucidity, 15, 'shared +15 lucidity (never +30)');

      const ambientEvents = enterDepot.filter((e) => e.type === 'ROOM_AMBIENT_OBSERVED');
      assertEqual(ambientEvents.length, 1, 'emits exactly 1 ROOM_AMBIENT_OBSERVED');
      const ambient = ambientEvents[0];
      if (ambient && ambient.type === 'ROOM_AMBIENT_OBSERVED') {
        assertEqual(ambient.roomId, 'room_depot', 'ambient roomId is room_depot');
        assertEqual(
          JSON.stringify(ambient.position),
          JSON.stringify({ x: 1, y: 3 }),
          'ambient position matches spawn (1, 3)',
        );
        assert(ambient.position !== state.player.position, 'ambient position is a cloned snapshot');
        // Mutate player position by walking and confirm snapshot does not mutate
        engine.handleAction({ type: 'MOVE', direction: 'up' });
        assertEqual(
          JSON.stringify(ambient.position),
          JSON.stringify({ x: 1, y: 3 }),
          'ambient position snapshot resisted player movement mutation',
        );
      }

      // Walking further in first half or leaving & re-entering must NOT re-trigger ROOM_AMBIENT_OBSERVED
      const stepEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assert(
        !stepEvents.some((e) => e.type === 'ROOM_AMBIENT_OBSERVED'),
        'walking inside room_depot does not duplicate ROOM_AMBIENT_OBSERVED',
      );

      // Sandbox check: Door D at (7, 3) to Room 3 is completely open without engaging Room 2 NPCs
      state.player.position = { x: 6, y: 3 };
      const toRoom3 = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.currentRoomId, 'room_checkpoint', 'Door D to Room 3 remains freely open (Sandbox)');
      assert(toRoom3.some((e) => e.type === 'ROOM_CHANGED'), 'transitioned cleanly to room_checkpoint');

      // 2. KEEP mode suppresses ROOM_AMBIENT_OBSERVED
      engine.reset();
      state = engine.getState();
      engine.debugAddLucidity(70);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' });
      state.player.position = { x: 6, y: 3 };
      const keepEnter = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.currentRoomId, 'room_depot', 'entered room_depot under KEEP');
      assertEqual(state.depotAmbientTriggered, false, 'depotAmbientTriggered remains false under KEEP');
      assert(
        !keepEnter.some((e) => e.type === 'ROOM_AMBIENT_OBSERVED'),
        'ROOM_AMBIENT_OBSERVED must NOT fire when filterChoice === KEEP',
      );

      // 3. BREAK mode before Room 2 still observes truth ambient scene
      engine.reset();
      state = engine.getState();
      engine.debugAddLucidity(70);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      state.player.position = { x: 6, y: 3 };
      const breakEnter = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.depotAmbientTriggered, true, 'depotAmbientTriggered true under BREAK');
      assert(
        breakEnter.some((e) => e.type === 'ROOM_AMBIENT_OBSERVED'),
        'ROOM_AMBIENT_OBSERVED fires under BREAK for truth ambient log',
      );

      // 4. Dead courier_01 or patrol_02 prevents ambient scene
      engine.reset();
      state = engine.getState();
      getEntity(engine, 'courier_01').hp = 0;
      state.player.position = { x: 6, y: 3 };
      const deadCourierEnter = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.depotEntryLucidityAwarded, true, 'depot entry +15 still awarded');
      assertEqual(state.depotAmbientTriggered, false, 'ambient suppressed when courier_01 is dead');
      assert(
        !deadCourierEnter.some((e) => e.type === 'ROOM_AMBIENT_OBSERVED'),
        'no ROOM_AMBIENT_OBSERVED when courier_01 is dead',
      );
    },
  },
];

for (const test of tests) {
  test.run();
  console.log(`PASS: ${test.name}`);
}

console.log(`\nALL ${tests.length} GAME ENGINE TEST SUITES PASSED`);
