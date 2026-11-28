import { GameEngine } from '../src/core/GameEngine';
import {
  getManhattanDistance,
  getRoomGridSize,
  getTileType,
  isWall,
} from '../src/core/grid';
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

      // Finish captain_01 in one strike (24 ATK >= remaining 20 HP) -> opens East gate (BREACHED)
      captain.hp = 20;
      captain.position = { x: 4, y: 4 };
      state.player.position = { x: 3, y: 4 };
      const breachEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });

      assertEqual(state.endingId, null, 'killing captain_01 in v0.4 opens gate instead of ending game');
      assertEqual(state.checkpointResolution, 'BREACHED', 'killing captain_01 sets BREACHED');
      assertEqual(state.imperialRecord.guardsKilled, 1, 'captain_01 increments guardsKilled');
      assert(
        breachEvents.some((e) => e.type === 'ENTITY_DIED' && e.entityId === 'captain_01'),
        'ENTITY_DIED for captain_01 must be emitted',
      );
      assert(
        breachEvents.some(
          (e) =>
            e.type === 'ITEM_DROPPED' &&
            e.itemId === 'imperial_salve' &&
            e.entityId === 'captain_01',
        ),
        'captain_01 must drop imperial_salve',
      );
      assert(
        breachEvents.some((e) => e.type === 'CHECKPOINT_BREACHED'),
        'CHECKPOINT_BREACHED must be emitted when captain_01 falls',
      );

      // Walk through East gate (7, 3) into room_inner_court -> magistrate_01 chases & defeating him ends with SUMMONER_BLADE
      state.player.position = { x: 6, y: 3 };
      const enterCourtEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.currentRoomId, 'room_inner_court', 'entered room_inner_court via East gate');
      assert(
        enterCourtEvents.some(
          (e) => e.type === 'ROOM_AMBIENT_OBSERVED' && e.roomId === 'room_inner_court',
        ),
        'entering room_inner_court emits ROOM_AMBIENT_OBSERVED even in KEEP mode',
      );

      // Hurt scribe_01 so it would flee if runRoomAi accidentally ran after GAME_ENDED
      const scribe = getEntity(engine, 'scribe_01');
      scribe.hp = 20;

      const magistrate = getEntity(engine, 'magistrate_01');
      assertEqual(magistrate.provoked, true, 'magistrate_01 is provoked in KEEP/BREACHED');
      magistrate.hp = 20;
      magistrate.position = { x: 3, y: 3 };
      state.player.position = { x: 2, y: 3 };
      const killEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });

      assertEqual(state.endingId, null, 'killing magistrate_01 in v0.5.0 transitions to Hub instead of ending immediately');
      assertEqual(state.legalStatus, 'OUTLAW', 'killing magistrate_01 sets OUTLAW');
      assertEqual(state.silver, 20, 'OUTLAW escape grants 20 silver');
      assertEqual(state.currentRoomId, 'room_outer_sewer', 'OUTLAW escapes into room_outer_sewer');
      assert(
        killEvents.some((e) => e.type === 'ENTITY_DIED' && e.entityId === 'magistrate_01'),
        'ENTITY_DIED for magistrate_01 must be emitted',
      );
      assert(
        killEvents.some(
          (e) =>
            e.type === 'TRIBUNAL_TRANSITIONED' &&
            e.resolution === 'OUTLAW_ESCAPE' &&
            e.silverGranted === 20 &&
            e.toRoomId === 'room_outer_sewer',
        ),
        'TRIBUNAL_TRANSITIONED (OUTLAW_ESCAPE) must be emitted',
      );
      assert(
        !killEvents.some((e) => e.type === 'AI_FLED' || e.type === 'ENEMY_ATTACKED'),
        'runRoomAi must stop immediately on Room 4 -> Hub transition',
      );

      // Brief with sanctum_agent_01 at (5, 6), close Hub service menu, then depart East gate (7, 3) -> room_abandoned_border
      state.player.position = { x: 5, y: 5 };
      engine.handleAction({ type: 'MOVE', direction: 'down' });
      assertEqual(state.hasAcceptedExpedition, true, 'talking to sanctum_agent_01 accepts expedition');
      engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLOSE_HUB_MENU' });

      state.player.position = { x: 6, y: 3 };
      const departEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.endingId, null, 'East gate in v0.5.1 enters room_abandoned_border instead of ending early');
      assertEqual(state.currentRoomId, 'room_abandoned_border', 'East gate transitions into room_abandoned_border');
      assertEqual(state.lastHubRoomId, 'room_outer_sewer', 'lastHubRoomId records room_outer_sewer');
      assertEqual(JSON.stringify(state.player.position), JSON.stringify({ x: 1, y: 4 }), 'spawns at (1, 4)');
      assert(
        departEvents.some(
          (e) =>
            e.type === 'EXPEDITION_DEPARTED' &&
            e.fromRoomId === 'room_outer_sewer' &&
            e.legalStatus === 'OUTLAW',
        ),
        'EXPEDITION_DEPARTED emitted on East gate',
      );
      assert(
        departEvents.some(
          (e) => e.type === 'ROOM_AMBIENT_OBSERVED' && e.roomId === 'room_abandoned_border',
        ),
        'room_abandoned_border ambient emitted on arrival',
      );

      // Pick up shattered_relic_shard at (8, 8) in KEEP -> RELIC_SHARD_GLITCHED without breaking KEEP
      state.player.position = { x: 7, y: 8 };
      const shardPickup = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assert(state.inventory.includes('shattered_relic_shard'), 'picked up shattered_relic_shard');
      assert(
        shardPickup.some(
          (e) => e.type === 'RELIC_SHARD_GLITCHED' && e.itemId === 'shattered_relic_shard',
        ),
        'KEEP pickup emits RELIC_SHARD_GLITCHED',
      );
      assertEqual(state.filterChoice, 'KEEP', 'KEEP lock preserved after shard glitch');

      // Return via West gate (0, 4) to room_outer_sewer (6, 3) and submit shard to sanctum_agent_01
      state.player.position = { x: 1, y: 4 };
      engine.handleAction({ type: 'MOVE', direction: 'left' });
      assertEqual(state.currentRoomId, 'room_outer_sewer', 'West gate returns to room_outer_sewer');
      assertEqual(JSON.stringify(state.player.position), JSON.stringify({ x: 6, y: 3 }), 'returns at (6, 3)');

      state.player.position = { x: 5, y: 5 };
      engine.handleAction({ type: 'MOVE', direction: 'down' });
      const submitEvents = engine.handleAction({
        type: 'CHOOSE_HUB_ACTION',
        choice: 'SUBMIT_RELIC_SHARD',
      });
      assertEqual(state.endingId, 'SUMMONER_BLADE', 'submitting shard to sanctum_agent_01 sets SUMMONER_BLADE');
      assertEqual(state.silver, 80, 'KEEP sanctum_agent_01 awards +60 silver (20 -> 80)');
      assert(
        submitEvents.some(
          (e) =>
            e.type === 'RELIC_SHARD_SUBMITTED' &&
            e.entityId === 'sanctum_agent_01' &&
            e.silverReward === 60 &&
            e.endingId === 'SUMMONER_BLADE',
        ),
        'RELIC_SHARD_SUBMITTED emitted for sanctum_agent_01',
      );
      assertLastEvent(
        submitEvents,
        { type: 'GAME_ENDED', endingId: 'SUMMONER_BLADE' },
        'shard submission ends with SUMMONER_BLADE',
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
    name: 'BREAK branch: TALK with captain_01 (without and with patrol_badge) emits NPC_TALKED + BOSS_CHOICE_REACHED, pauses AI, and SURRENDER escorts into Room 4',
    run: () => {
      // Case A: without patrol_badge
      const engine = new GameEngine();
      let state = engine.getState();
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });

      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      state.player.position = { x: 4, y: 4 }; // left of captain_01 at (5, 4)
      state.isRiposteReady = true;

      // Make merchant hurt so we confirm runRoomAi does not fire during pendingBossChoice or SURRENDER transition
      getEntity(engine, 'merchant_01').hp = 20;

      const noBadgeTalkEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(getEntity(engine, 'captain_01').hp, 110, 'talking to captain_01 must not deal damage');
      assertEqual(state.pendingBossChoice, true, 'talking to captain_01 opens pendingBossChoice');
      assertEqual(state.endingId, null, 'endingId must remain null until tribunal verdict');
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
      assertEqual(state.checkpointResolution, 'ESCORTED', 'SURRENDER sets ESCORTED');
      assertEqual(state.isRiposteReady, false, 'SURRENDER clears isRiposteReady');
      assertEqual(state.currentRoomId, 'room_inner_court', 'SURRENDER escorts to room_inner_court');
      assertEqual(
        JSON.stringify(state.player.position),
        JSON.stringify({ x: 1, y: 3 }),
        'SURRENDER spawns player at (1, 3) in room_inner_court',
      );
      assert(
        surrenderNoBadge.some(
          (e) =>
            e.type === 'CHECKPOINT_ESCORTED' &&
            e.toRoomId === 'room_inner_court' &&
            e.to.x === 1 &&
            e.to.y === 3,
        ),
        'SURRENDER emits CHECKPOINT_ESCORTED with (1, 3)',
      );
      assert(
        surrenderNoBadge.some(
          (e) => e.type === 'ROOM_CHANGED' && e.toRoomId === 'room_inner_court',
        ),
        'SURRENDER emits ROOM_CHANGED to room_inner_court',
      );
      assertLastEvent(
        surrenderNoBadge,
        {
          type: 'ROOM_AMBIENT_OBSERVED',
          roomId: 'room_inner_court',
          position: { x: 1, y: 3 },
          checkpointResolution: 'ESCORTED',
        },
        'SURRENDER triggers inner court ambient observation without sneaky AI',
      );

      // Step up to magistrate_01 at (6, 3) and accept decree -> CITIZEN in room_market_street -> East gate AWAKENED
      state.player.position = { x: 5, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.pendingTribunalChoice, true, 'talking to magistrate_01 opens tribunal choice');
      const acceptEvents = engine.handleAction({
        type: 'CHOOSE_TRIBUNAL_ACTION',
        choice: 'ACCEPT_DECREE',
      });
      assertEqual(state.endingId, null, 'ACCEPT_DECREE in v0.5.0 transitions to Hub instead of ending immediately');
      assertEqual(state.legalStatus, 'CITIZEN', 'clean ACCEPT_DECREE grants CITIZEN');
      assertEqual(state.silver, 25, 'CITIZEN starts with 25 silver');
      assertEqual(state.currentRoomId, 'room_market_street', 'CITIZEN enters room_market_street');
      assert(
        acceptEvents.some(
          (e) =>
            e.type === 'TRIBUNAL_TRANSITIONED' &&
            e.resolution === 'CITIZEN' &&
            e.silverGranted === 25,
        ),
        'TRIBUNAL_TRANSITIONED (CITIZEN) emitted',
      );
      state.player.position = { x: 4, y: 4 }; // above dwarf_smith_01 at (4, 5)
      engine.handleAction({ type: 'MOVE', direction: 'down' });
      engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLOSE_HUB_MENU' });
      state.player.position = { x: 6, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.currentRoomId, 'room_abandoned_border', 'CITIZEN enters room_abandoned_border');
      assertEqual(state.endingId, null, 'East gate does not end CITIZEN run early');
      state.player.position = { x: 7, y: 8 };
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      state.player.position = { x: 1, y: 4 };
      engine.handleAction({ type: 'MOVE', direction: 'left' });
      assertEqual(state.currentRoomId, 'room_market_street', 'CITIZEN returns to room_market_street');
      state.player.position = { x: 4, y: 4 };
      engine.handleAction({ type: 'MOVE', direction: 'down' });
      const citizenSubmit = engine.handleAction({
        type: 'CHOOSE_HUB_ACTION',
        choice: 'SUBMIT_RELIC_SHARD',
      });
      assertEqual(state.silver, 85, 'CITIZEN earns +60 silver (25 -> 85)');
      assertEqual(state.endingId, 'AWAKENED', 'CITIZEN shard submission sets AWAKENED ending');
      assertLastEvent(
        citizenSubmit,
        { type: 'GAME_ENDED', endingId: 'AWAKENED' },
        'AWAKENED via dwarf_smith_01 shard submission',
      );

      // Post-ending lock check
      assertEqual(engine.handleAction({ type: 'WAIT' }).length, 0, 'WAIT blocked after AWAKENED');
      assertEqual(engine.handleAction({ type: 'MOVE', direction: 'left' }).length, 0, 'MOVE blocked after AWAKENED');

      // Case B: with patrol_badge (and dark_elf raceId check) -> PRESENT_RELIC -> ENVOY (keeps world_relic, removes badge) -> SOVEREIGN_PACT
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

      engine.handleAction({ type: 'CHOOSE_BOSS_ACTION', choice: 'SURRENDER' });
      assertEqual(state.currentRoomId, 'room_inner_court', 'escorted to room_inner_court with badge');
      state.player.position = { x: 5, y: 3 };
      const magTalk = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(
        JSON.stringify(magTalk[0]),
        JSON.stringify({
          type: 'NPC_TALKED',
          entityId: 'magistrate_01',
          hasBadge: true,
          raceId: 'dark_elf',
          imperialRecord: { guardsKilled: 0, civiliansKilled: 0 },
        }),
        'magistrate_01 NPC_TALKED carries hasBadge, raceId, and imperialRecord snapshot',
      );
      const pactEvents = engine.handleAction({
        type: 'CHOOSE_TRIBUNAL_ACTION',
        choice: 'PRESENT_RELIC',
      });
      assertEqual(state.endingId, null, 'PRESENT_RELIC transitions to Hub instead of ending immediately');
      assertEqual(state.legalStatus, 'ENVOY', 'PRESENT_RELIC sets ENVOY');
      assertEqual(state.silver, 40, 'ENVOY receives 40 silver');
      assertEqual(state.currentRoomId, 'room_market_street', 'ENVOY enters room_market_street');
      assert(state.inventory.includes('world_relic'), 'ENVOY retains intact world_relic in inventory');
      assert(!state.inventory.includes('patrol_badge'), 'patrol_badge archived by Tribunal on ENVOY');
      assert(
        pactEvents.some(
          (e) =>
            e.type === 'TRIBUNAL_TRANSITIONED' &&
            e.resolution === 'ENVOY' &&
            e.silverGranted === 40,
        ),
        'TRIBUNAL_TRANSITIONED (ENVOY) emitted',
      );
      state.player.position = { x: 4, y: 4 };
      engine.handleAction({ type: 'MOVE', direction: 'down' });
      engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLOSE_HUB_MENU' });
      state.player.position = { x: 6, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.currentRoomId, 'room_abandoned_border', 'ENVOY enters room_abandoned_border');
      state.player.position = { x: 7, y: 8 };
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      state.player.position = { x: 1, y: 4 };
      engine.handleAction({ type: 'MOVE', direction: 'left' });
      state.player.position = { x: 4, y: 4 };
      engine.handleAction({ type: 'MOVE', direction: 'down' });
      const envoySubmit = engine.handleAction({
        type: 'CHOOSE_HUB_ACTION',
        choice: 'SUBMIT_RELIC_SHARD',
      });
      assertEqual(state.silver, 110, 'ENVOY earns +70 silver (40 -> 110)');
      assert(state.inventory.includes('world_relic'), 'ENVOY still retains world_relic');
      assertEqual(state.endingId, 'SOVEREIGN_PACT', 'ENVOY shard submission sets SOVEREIGN_PACT');
      assertLastEvent(
        envoySubmit,
        { type: 'GAME_ENDED', endingId: 'SOVEREIGN_PACT' },
        'SOVEREIGN_PACT ending event via dwarf_smith_01 shard submission',
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

      // Killing captain_01 in BREAK opens gate (BREACHED) and provokes magistrate_01 for Kẻ Phá Luật in Room 4
      captain.hp = 15;
      const breakKillEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.checkpointResolution, 'BREACHED', 'killing captain_01 in BREAK sets BREACHED');
      assert(
        breakKillEvents.some((e) => e.type === 'CHECKPOINT_BREACHED'),
        'CHECKPOINT_BREACHED emitted in BREAK kill',
      );
      assertEqual(
        getEntity(engine, 'magistrate_01').provoked,
        true,
        'magistrate_01 immediately provoked when checkpoint is BREACHED',
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
      assert(state.inventory.includes('healing_tonic'), 'healing_tonic must NOT be consumed at full HP');
      assertEqual(state.player.hp, 100, 'enemy must NOT attack when USE_ITEM is ignored');

      // Take 10 damage (90/100), then use healing_tonic (35) -> actualHeal must be 10
      state.player.hp = 90;
      patrol1.position = { x: 5, y: 5 }; // keep away so playerHp stays clean for check
      const healEvents = engine.handleAction({ type: 'USE_ITEM', itemId: 'healing_tonic' });
      assert(!state.inventory.includes('healing_tonic'), 'healing_tonic must be consumed when injured');
      assertEqual(
        JSON.stringify(state.inventory),
        JSON.stringify(['world_relic']),
        'starter world_relic remains intact after consuming healing_tonic',
      );
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
      assertEqual(
        state.groundItems.filter((item) => item.roomId === 'room_outpost').length,
        0,
        'all stacked items on the tile must be picked up',
      );
      assertEqual(
        JSON.stringify(state.inventory),
        JSON.stringify(['world_relic', 'healing_tonic', 'warm_bread', 'patrol_badge']),
        'inventory must retain starter world_relic and receive all 3 stacked items',
      );
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
          while (
            eng.getState().checkpointResolution !== 'BREACHED' &&
            !eng.getState().isGameOver &&
            guard < 25
          ) {
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
            eng.getState().checkpointResolution,
            'BREACHED',
            `${raceId} + ${classId} must defeat unbuffed captain_01 and breach gate`,
          );
          assert(
            eng.getState().player.hp > 0,
            `${raceId} + ${classId} must survive with > 0 HP (left: ${eng.getState().player.hp})`,
          );
        }
      }

      // Exact surviving HP anchors for representative builds
      const spellbladeEng = setupBossDuel('dark_elf', 'spellblade'); // 30 + 20*4 = 110 in 5 strikes -> takes 4*16 = 64 -> 21 HP
      while (spellbladeEng.getState().checkpointResolution !== 'BREACHED') {
        spellbladeEng.handleAction({ type: 'MOVE', direction: 'right' });
      }
      assertEqual(spellbladeEng.getState().player.hp, 21, 'dark_elf + spellblade survives at 21 HP');

      const tankEng = setupBossDuel('undead_outsider', 'iron_vanguard'); // 5*(WAIT 6 + Riposte 23), 4 retaliations of 14 -> 135 - 86 = 49 HP
      let step = 0;
      while (tankEng.getState().checkpointResolution !== 'BREACHED') {
        if (step % 2 === 0) tankEng.handleAction({ type: 'WAIT' });
        else tankEng.handleAction({ type: 'MOVE', direction: 'right' });
        step++;
      }
      assertEqual(tankEng.getState().player.hp, 49, 'undead_outsider + iron_vanguard survives at 49 HP');
    },
  },
  {
    name: 'Phase 7A v0.5.0: All 4 endings (SUMMONER_BLADE, Kẻ Phá Luật, AWAKENED, SOVEREIGN_PACT) are naturally reachable end-to-end across Rooms 1 -> 4 -> Hub -> East Gate',
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

      // 1. Ending 1 (KEEP -> breach Room 3 -> kill magistrate_01 -> room_outer_sewer -> sanctum_agent_01 -> East Gate): Lưỡi Gươm Của Kẻ Triệu Hồi
      const keepEng = new GameEngine('human', 'brawler');
      walkNaturallyToCheckpoint(keepEng);
      keepEng.handleAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' });
      keepEng.handleAction({ type: 'MOVE', direction: 'down' }); // (1, 4) same row as captain_01
      let guardCounter = 0;
      while (
        keepEng.getState().checkpointResolution !== 'BREACHED' &&
        !keepEng.getState().isGameOver &&
        guardCounter < 20
      ) {
        keepEng.handleAction({ type: 'MOVE', direction: 'right' });
        guardCounter++;
      }
      assertEqual(keepEng.getState().checkpointResolution, 'BREACHED', 'KEEP breached Room 3');
      // Walk along obstacle-free y=4 to (6, 4) (picking up imperial_salve along the way), then up to (6, 3) & East into Room 4
      guardCounter = 0;
      while (keepEng.getState().player.position.x < 6 && guardCounter < 10) {
        keepEng.handleAction({ type: 'MOVE', direction: 'right' });
        guardCounter++;
      }
      keepEng.handleAction({ type: 'MOVE', direction: 'up' }); // (6, 3) past obstacle at (5, 3)
      keepEng.handleAction({ type: 'MOVE', direction: 'right' }); // (7, 3) -> room_inner_court
      assertEqual(keepEng.getState().currentRoomId, 'room_inner_court', 'KEEP entered Room 4');
      keepEng.handleAction({ type: 'USE_ITEM', itemId: 'imperial_salve' });
      keepEng.handleAction({ type: 'USE_ITEM', itemId: 'world_relic' }); // 35 shockwave + 20 HP!
      guardCounter = 0;
      while (
        keepEng.getState().currentRoomId === 'room_inner_court' &&
        !keepEng.getState().isGameOver &&
        guardCounter < 20
      ) {
        keepEng.handleAction({ type: 'MOVE', direction: 'right' });
        guardCounter++;
      }
      assertEqual(keepEng.getState().filterChoice, 'KEEP', 'KEEP branch preserved');
      assertEqual(keepEng.getState().legalStatus, 'OUTLAW', 'KEEP defeating magistrate_01 sets OUTLAW');
      assertEqual(keepEng.getState().currentRoomId, 'room_outer_sewer', 'OUTLAW transitioned to room_outer_sewer');
      assertEqual(keepEng.getState().silver, 20, 'OUTLAW granted 20 silver');
      // Helper to naturally traverse room_abandoned_border (10x10), pick up shattered_relic_shard at (8, 8), and return through West Gate (0, 4)
      const clearBorderAndReturn = (eng: GameEngine): void => {
        const dirs = [
          { dir: 'up' as const, dx: 0, dy: -1 },
          { dir: 'down' as const, dx: 0, dy: 1 },
          { dir: 'left' as const, dx: -1, dy: 0 },
          { dir: 'right' as const, dx: 1, dy: 0 },
        ];
        const moveStepToward = (targetX: number, targetY: number): void => {
          const st = eng.getState();
          if (st.player.hp <= Math.floor(st.player.maxHp * 0.45)) {
            for (const healId of ['border_ration_pack', 'imperial_salve', 'healing_tonic', 'warm_bread']) {
              if (st.inventory.includes(healId)) {
                eng.handleAction({ type: 'USE_ITEM', itemId: healId });
                return;
              }
            }
          }
          // If an adjacent hostile enemy exists, fight it (using WAIT for iron_vanguard riposte when safe)
          for (const d of dirs) {
            const nx = st.player.position.x + d.dx;
            const ny = st.player.position.y + d.dy;
            const adj = st.entities.find(
              (e) =>
                e.roomId === st.currentRoomId &&
                e.hp > 0 &&
                e.position.x === nx &&
                e.position.y === ny &&
                !e.isInteractableObject &&
                (e.faction === 'outlaw_deserter' ||
                  st.legalStatus === 'OUTLAW' ||
                  st.filterChoice !== 'BREAK' ||
                  e.provoked),
            );
            if (adj) {
              if (
                st.selectedClassId === 'iron_vanguard' &&
                !st.isRiposteReady &&
                adj.hp > eng.getEffectiveAttack(st.player)
              ) {
                eng.handleAction({ type: 'WAIT' });
              } else {
                eng.handleAction({ type: 'MOVE', direction: d.dir });
              }
              return;
            }
          }
          // BFS shortest walkable path on 10x10 avoiding obstacles & stele
          const gridSize = getRoomGridSize(st.currentRoomId);
          const startKey = `${st.player.position.x},${st.player.position.y}`;
          const goalKey = `${targetX},${targetY}`;
          const queue: Array<{ x: number; y: number; firstDir: 'up' | 'down' | 'left' | 'right' }> = [];
          const visited = new Set<string>([startKey]);
          for (const d of dirs) {
            const nx = st.player.position.x + d.dx;
            const ny = st.player.position.y + d.dy;
            if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
            const tile = getTileType(st.currentRoomId, nx, ny);
            const isGoal = `${nx},${ny}` === goalKey;
            if (!isGoal && tile !== 'FLOOR') continue;
            if (isGoal && tile !== 'FLOOR' && tile !== 'DOOR') continue;
            const blocked = st.entities.some(
              (e) =>
                e.roomId === st.currentRoomId &&
                e.hp > 0 &&
                e.position.x === nx &&
                e.position.y === ny &&
                e.isInteractableObject === true,
            );
            if (blocked) continue;
            visited.add(`${nx},${ny}`);
            queue.push({ x: nx, y: ny, firstDir: d.dir });
          }
          while (queue.length > 0) {
            const cur = queue.shift()!;
            if (`${cur.x},${cur.y}` === goalKey) {
              eng.handleAction({ type: 'MOVE', direction: cur.firstDir });
              return;
            }
            for (const d of dirs) {
              const nx = cur.x + d.dx;
              const ny = cur.y + d.dy;
              const key = `${nx},${ny}`;
              if (visited.has(key) || nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
              const tile = getTileType(st.currentRoomId, nx, ny);
              const isGoal = key === goalKey;
              if (!isGoal && tile !== 'FLOOR') continue;
              if (isGoal && tile !== 'FLOOR' && tile !== 'DOOR') continue;
              const blocked = st.entities.some(
                (e) =>
                  e.roomId === st.currentRoomId &&
                  e.hp > 0 &&
                  e.position.x === nx &&
                  e.position.y === ny &&
                  e.isInteractableObject === true,
              );
              if (blocked) continue;
              visited.add(key);
              queue.push({ x: nx, y: ny, firstDir: cur.firstDir });
            }
          }
          eng.handleAction({ type: 'WAIT' });
        };

        let steps = 0;
        while (
          !eng.getState().inventory.includes('shattered_relic_shard') &&
          !eng.getState().isGameOver &&
          steps < 60
        ) {
          moveStepToward(8, 8);
          steps++;
        }
        assert(
          eng.getState().inventory.includes('shattered_relic_shard'),
          'expedition collected shattered_relic_shard naturally',
        );

        steps = 0;
        while (
          eng.getState().currentRoomId === 'room_abandoned_border' &&
          !eng.getState().isGameOver &&
          steps < 60
        ) {
          moveStepToward(0, 4);
          steps++;
        }
        assert(
          eng.getState().currentRoomId !== 'room_abandoned_border',
          'expedition returned to Hub via West Gate (0, 4)',
        );
      };

      // Walk naturally from (1, 3) to sanctum_agent_01 at (5, 6), claim free supply, close menu, walk to East gate (7, 3) -> border -> submit
      for (const dir of ['down', 'right', 'right', 'right', 'right', 'down', 'down'] as const) {
        keepEng.handleAction({ type: 'MOVE', direction: dir });
      }
      assertEqual(keepEng.getState().activeHubNpcId, 'sanctum_agent_01', 'talked to sanctum_agent_01 in KEEP');
      keepEng.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLAIM_FREE_SUPPLY' });
      keepEng.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLOSE_HUB_MENU' });
      for (const dir of ['up', 'up', 'right', 'right'] as const) {
        keepEng.handleAction({ type: 'MOVE', direction: dir });
      }
      assertEqual(keepEng.getState().currentRoomId, 'room_abandoned_border', 'KEEP entered room_abandoned_border');
      clearBorderAndReturn(keepEng);
      assertEqual(keepEng.getState().currentRoomId, 'room_outer_sewer', 'KEEP returned to room_outer_sewer');
      assertEqual(keepEng.getState().filterChoice, 'KEEP', 'KEEP lock held through shard glitch');
      // From (6, 3) walk to sanctum_agent_01 at (5, 6): left -> (5, 3), down x3 -> TALK (5, 6)
      for (const dir of ['left', 'down', 'down', 'down'] as const) {
        keepEng.handleAction({ type: 'MOVE', direction: dir });
      }
      keepEng.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'SUBMIT_RELIC_SHARD' });
      assertEqual(keepEng.getState().endingId, 'SUMMONER_BLADE', 'natural KEEP ending reached via shard submission');

      // 2. Ending 2 (BREAK + FIGHT captain_01 -> breach Room 3 -> kill magistrate_01 -> sewer_broker_01 -> Border -> Submit): Kẻ Phá Luật
      const ruleBreakerEng = new GameEngine('human', 'brawler');
      walkNaturallyToCheckpoint(ruleBreakerEng);
      ruleBreakerEng.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      // Activate Lăng Kính Thực Tại (+5 ATK, +15 Max HP, +30 HP)
      ruleBreakerEng.handleAction({ type: 'USE_ITEM', itemId: 'world_relic' });
      for (const dir of ['down', 'right', 'right', 'right'] as const) {
        ruleBreakerEng.handleAction({ type: 'MOVE', direction: dir });
      }
      const talkEvents = ruleBreakerEng.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(ruleBreakerEng.getState().pendingBossChoice, true, 'boss choice opened in BREAK');
      assert(
        talkEvents.some((e) => e.type === 'BOSS_CHOICE_REACHED' && e.entityId === 'captain_01'),
        'BOSS_CHOICE_REACHED emitted',
      );

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
        ruleBreakerEng.getState().checkpointResolution !== 'BREACHED' &&
        !ruleBreakerEng.getState().isGameOver &&
        guardCounter < 20
      ) {
        ruleBreakerEng.handleAction({ type: 'MOVE', direction: 'right' });
        guardCounter++;
      }
      assertEqual(ruleBreakerEng.getState().checkpointResolution, 'BREACHED', 'Room 3 breached in BREAK');
      // Pick up imperial_salve at (5, 4), heal, then walk up to y=3 and East into Room 4
      ruleBreakerEng.handleAction({ type: 'MOVE', direction: 'right' }); // (5, 4) -> picks up imperial_salve
      ruleBreakerEng.handleAction({ type: 'USE_ITEM', itemId: 'imperial_salve' });
      ruleBreakerEng.handleAction({ type: 'MOVE', direction: 'right' }); // (6, 4)
      ruleBreakerEng.handleAction({ type: 'MOVE', direction: 'up' }); // (6, 3)
      ruleBreakerEng.handleAction({ type: 'MOVE', direction: 'right' }); // (7, 3) -> room_inner_court (1, 3)
      assertEqual(ruleBreakerEng.getState().currentRoomId, 'room_inner_court', 'entered Room 4');

      guardCounter = 0;
      while (
        ruleBreakerEng.getState().currentRoomId === 'room_inner_court' &&
        !ruleBreakerEng.getState().isGameOver &&
        guardCounter < 20
      ) {
        ruleBreakerEng.handleAction({ type: 'MOVE', direction: 'right' });
        guardCounter++;
      }
      assertEqual(ruleBreakerEng.getState().filterChoice, 'BREAK', 'filterChoice remains BREAK');
      assertEqual(ruleBreakerEng.getState().legalStatus, 'OUTLAW', 'BREAK defeating magistrate_01 sets OUTLAW');
      assertEqual(ruleBreakerEng.getState().currentRoomId, 'room_outer_sewer', 'escaped to room_outer_sewer');
      // Walk from (1, 3) to sewer_broker_01 at (2, 2), buy ration, close, then walk East to (7, 3)
      ruleBreakerEng.handleAction({ type: 'MOVE', direction: 'right' }); // (2, 3)
      ruleBreakerEng.handleAction({ type: 'MOVE', direction: 'up' }); // TALK sewer_broker_01 at (2, 2)
      assertEqual(ruleBreakerEng.getState().activeHubNpcId, 'sewer_broker_01', 'talked to sewer_broker_01');
      ruleBreakerEng.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'BUY_RATION' });
      ruleBreakerEng.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLOSE_HUB_MENU' });
      for (let i = 0; i < 5; i++) {
        ruleBreakerEng.handleAction({ type: 'MOVE', direction: 'right' });
      }
      assertEqual(ruleBreakerEng.getState().currentRoomId, 'room_abandoned_border', 'ruleBreaker entered border');
      clearBorderAndReturn(ruleBreakerEng);
      // From (6, 3) walk left x4 -> (2, 3), up -> TALK sewer_broker_01 at (2, 2)
      for (const dir of ['left', 'left', 'left', 'left', 'up'] as const) {
        ruleBreakerEng.handleAction({ type: 'MOVE', direction: dir });
      }
      ruleBreakerEng.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'SUBMIT_RELIC_SHARD' });
      assertEqual(
        ruleBreakerEng.getState().endingId,
        'SUMMONER_BLADE',
        'natural Kẻ Phá Luật ending (SUMMONER_BLADE + BREAK) reached via shard submission',
      );

      // 3. Ending 3 (BREAK + SURRENDER -> Room 4 ACCEPT_DECREE -> room_market_street -> dwarf_smith_01 -> Border -> Submit): Người Xé Màn Sương
      const awakenedEng = new GameEngine('undead_outsider', 'iron_vanguard');
      walkNaturallyToCheckpoint(awakenedEng);
      awakenedEng.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      for (const dir of ['down', 'right', 'right', 'right', 'right'] as const) {
        awakenedEng.handleAction({ type: 'MOVE', direction: dir });
      }
      assertEqual(awakenedEng.getState().pendingBossChoice, true, 'boss choice opened');
      awakenedEng.handleAction({ type: 'CHOOSE_BOSS_ACTION', choice: 'SURRENDER' });
      assertEqual(awakenedEng.getState().currentRoomId, 'room_inner_court', 'escorted to Room 4');
      // Straight y=3 walk from (1, 3) -> (6, 3) TALK magistrate_01
      for (let i = 0; i < 5; i++) {
        awakenedEng.handleAction({ type: 'MOVE', direction: 'right' });
      }
      assertEqual(awakenedEng.getState().pendingTribunalChoice, true, 'tribunal choice opened');
      awakenedEng.handleAction({ type: 'CHOOSE_TRIBUNAL_ACTION', choice: 'ACCEPT_DECREE' });
      assertEqual(awakenedEng.getState().legalStatus, 'CITIZEN', 'CITIZEN status assigned');
      assertEqual(awakenedEng.getState().currentRoomId, 'room_market_street', 'entered room_market_street');
      // Walk from (1, 3) to dwarf_smith_01 at (4, 5): down -> (1,4), right x3 -> (4,4), down -> TALK (4,5)
      for (const dir of ['down', 'right', 'right', 'right', 'down'] as const) {
        awakenedEng.handleAction({ type: 'MOVE', direction: dir });
      }
      assertEqual(awakenedEng.getState().activeHubNpcId, 'dwarf_smith_01', 'talked to dwarf_smith_01');
      awakenedEng.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'BUY_RATION' });
      awakenedEng.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLOSE_HUB_MENU' });
      // Walk from (4, 4) -> up (4, 3) -> right x3 -> East gate (7, 3)
      for (const dir of ['up', 'right', 'right', 'right'] as const) {
        awakenedEng.handleAction({ type: 'MOVE', direction: dir });
      }
      assertEqual(awakenedEng.getState().currentRoomId, 'room_abandoned_border', 'CITIZEN entered border');
      clearBorderAndReturn(awakenedEng);
      // From (6, 3) walk left x2 -> (4, 3), down -> (4, 4), down -> TALK dwarf_smith_01 at (4, 5)
      for (const dir of ['left', 'left', 'down', 'down'] as const) {
        awakenedEng.handleAction({ type: 'MOVE', direction: dir });
      }
      awakenedEng.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'SUBMIT_RELIC_SHARD' });
      assertEqual(awakenedEng.getState().filterChoice, 'BREAK', 'filterChoice is BREAK');
      assertEqual(awakenedEng.getState().endingId, 'AWAKENED', 'natural AWAKENED ending reached via shard submission');

      // 4. Ending 4 (BREAK + SURRENDER + intact world_relic -> PRESENT_RELIC -> ENVOY keeping world_relic -> dwarf_smith_01 -> Border -> Submit): Khế Ước Ngang Hàng
      const pactEng = new GameEngine('human', 'spellblade');
      walkNaturallyToCheckpoint(pactEng);
      pactEng.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      for (const dir of ['down', 'right', 'right', 'right', 'right'] as const) {
        pactEng.handleAction({ type: 'MOVE', direction: dir });
      }
      pactEng.handleAction({ type: 'CHOOSE_BOSS_ACTION', choice: 'SURRENDER' });
      for (let i = 0; i < 5; i++) {
        pactEng.handleAction({ type: 'MOVE', direction: 'right' });
      }
      assertEqual(pactEng.getState().pendingTribunalChoice, true, 'tribunal choice opened for pact');
      pactEng.handleAction({ type: 'CHOOSE_TRIBUNAL_ACTION', choice: 'PRESENT_RELIC' });
      assertEqual(pactEng.getState().legalStatus, 'ENVOY', 'ENVOY status assigned');
      assertEqual(pactEng.getState().silver, 40, 'ENVOY starts with 40 silver');
      assert(pactEng.getState().inventory.includes('world_relic'), 'ENVOY retains intact world_relic');
      for (const dir of ['down', 'right', 'right', 'right', 'down'] as const) {
        pactEng.handleAction({ type: 'MOVE', direction: dir });
      }
      pactEng.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'BUY_RATION' });
      pactEng.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLOSE_HUB_MENU' });
      for (const dir of ['up', 'right', 'right', 'right'] as const) {
        pactEng.handleAction({ type: 'MOVE', direction: dir });
      }
      assertEqual(pactEng.getState().currentRoomId, 'room_abandoned_border', 'ENVOY entered border');
      clearBorderAndReturn(pactEng);
      for (const dir of ['left', 'left', 'down', 'down'] as const) {
        pactEng.handleAction({ type: 'MOVE', direction: dir });
      }
      pactEng.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'SUBMIT_RELIC_SHARD' });
      assertEqual(pactEng.getState().endingId, 'SOVEREIGN_PACT', 'natural SOVEREIGN_PACT ending reached via shard submission');
      assert(pactEng.getState().inventory.includes('world_relic'), 'world_relic still intact after SOVEREIGN_PACT submission');
      assertEqual(pactEng.getState().silver, 95, 'ENVOY ends with 40 - 15 + 70 = 95 silver');
    },
  },
  {
    name: 'Phase 4 Step 3: pendingBossChoice locks, double-tap guard, reset cleanup, spellblade first_strike on FIGHT, and iron_vanguard guard-leak prevention',
    run: () => {
      // 1. Action locks while pendingBossChoice === true, double-tap guard, and reset cleanup
      const engine = new GameEngine('dark_elf', 'spellblade'); // 20 ATK + 10 first_strike = 30
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
      assert(state.inventory.includes('warm_bread'), 'locked USE_ITEM did not consume item');

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

      // Verify reset() clears pendingBossChoice & pendingTribunalChoice if reset mid-dialog
      engine.reset();
      state = engine.getState();
      state.pendingBossChoice = true;
      state.pendingTribunalChoice = true;
      engine.reset();
      assertEqual(engine.getState().pendingBossChoice, false, 'reset() clears pendingBossChoice');
      assertEqual(engine.getState().pendingTribunalChoice, false, 'reset() clears pendingTribunalChoice');

      // Verify lethal opening DEFY_TRIBUNAL strike skips old-room runRoomAi and transitions cleanly to room_outer_sewer
      engine.setBuildAndReset('dark_elf', 'spellblade');
      state = engine.getState();
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      state.currentRoomId = 'room_inner_court';
      state.player.roomId = 'room_inner_court';
      state.checkpointResolution = 'ESCORTED';
      state.player.position = { x: 5, y: 3 };
      getEntity(engine, 'scribe_01').hp = 20; // hurt so it would flee if runRoomAi ran
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // TALK magistrate_01
      getEntity(engine, 'magistrate_01').hp = 20; // lethal on opening strike
      const lethalDefy = engine.handleAction({
        type: 'CHOOSE_TRIBUNAL_ACTION',
        choice: 'DEFY_TRIBUNAL',
      });
      assertEqual(state.endingId, null, 'lethal DEFY_TRIBUNAL transitions to Hub instead of ending immediately');
      assertEqual(state.legalStatus, 'OUTLAW', 'lethal DEFY_TRIBUNAL sets OUTLAW');
      assertEqual(state.currentRoomId, 'room_outer_sewer', 'lethal DEFY_TRIBUNAL transitions to room_outer_sewer');
      assert(!lethalDefy.some((e) => e.type === 'AI_FLED'), 'runRoomAi skipped after lethal DEFY_TRIBUNAL transition');

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
  {
    name: 'Phase 6 v0.4: Starter world_relic, imperialRecord (guardsKilled & civiliansKilled), and clean reset/setBuildAndReset cleanup',
    run: () => {
      const engine = new GameEngine('human', 'brawler');
      let state = engine.getState();

      assertEqual(
        JSON.stringify(state.inventory),
        JSON.stringify(['world_relic']),
        'initial inventory starts with world_relic',
      );
      assertEqual(state.checkpointResolution, 'UNRESOLVED', 'starts UNRESOLVED');
      assertEqual(state.imperialRecord.guardsKilled, 0, 'guardsKilled starts 0');
      assertEqual(state.imperialRecord.civiliansKilled, 0, 'civiliansKilled starts 0');
      assertEqual(state.innerCourtAmbientTriggered, false, 'innerCourtAmbientTriggered starts false');
      assertEqual(state.pendingTribunalChoice, false, 'pendingTribunalChoice starts false');

      // Kill patrol_01 (empire_guard) -> guardsKilled === 1
      const patrol1 = getEntity(engine, 'patrol_01');
      patrol1.hp = 10;
      patrol1.position = { x: 2, y: 3 };
      state.player.position = { x: 1, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.imperialRecord.guardsKilled, 1, 'patrol_01 increments guardsKilled to 1');
      assertEqual(state.imperialRecord.civiliansKilled, 0, 'civiliansKilled stays 0');

      // Kill courier_01 (civilian) -> civiliansKilled === 1
      state.currentRoomId = 'room_depot';
      state.player.roomId = 'room_depot';
      const courier = getEntity(engine, 'courier_01');
      courier.hp = 10;
      courier.position = { x: 4, y: 2 };
      state.player.position = { x: 3, y: 2 };
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.imperialRecord.guardsKilled, 1, 'guardsKilled stays 1');
      assertEqual(state.imperialRecord.civiliansKilled, 1, 'courier_01 increments civiliansKilled to 1');

      // Dirty all v0.4 flags and verify reset() & setBuildAndReset() wipe them cleanly
      state.checkpointResolution = 'ESCORTED';
      state.innerCourtAmbientTriggered = true;
      state.pendingTribunalChoice = true;
      state.inventory = [];

      engine.reset();
      state = engine.getState();
      assertEqual(
        JSON.stringify(state.inventory),
        JSON.stringify(['world_relic']),
        'reset() restores starter world_relic',
      );
      assertEqual(state.checkpointResolution, 'UNRESOLVED', 'reset() resets checkpointResolution');
      assertEqual(state.imperialRecord.guardsKilled, 0, 'reset() clears guardsKilled');
      assertEqual(state.imperialRecord.civiliansKilled, 0, 'reset() clears civiliansKilled');
      assertEqual(state.innerCourtAmbientTriggered, false, 'reset() clears innerCourtAmbientTriggered');
      assertEqual(state.pendingTribunalChoice, false, 'reset() clears pendingTribunalChoice');

      state.imperialRecord.civiliansKilled = 2;
      engine.setBuildAndReset('dark_elf', 'spellblade');
      assertEqual(
        engine.getState().imperialRecord.civiliansKilled,
        0,
        'setBuildAndReset() clears imperialRecord',
      );
    },
  },
  {
    name: 'Phase 6 v0.4: GATE_LOCKED blocks sealed Checkpoint & Tribunal doors without losing turn, clearing isRiposteReady, or running AI; BREACHED allows free retreat',
    run: () => {
      const engine = new GameEngine('human', 'iron_vanguard');
      const state = engine.getState();

      // 1. Room 3 East door (7, 3) when checkpointResolution === 'UNRESOLVED'
      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      state.player.position = { x: 6, y: 3 };
      state.isRiposteReady = true;
      state.isGuardingFromWait = true;
      state.keenSightTriggeredThisTurn = true;

      // Put provoked captain_01 adjacent at (6, 4) to prove runRoomAi does NOT execute on GATE_LOCKED
      const captain = getEntity(engine, 'captain_01');
      captain.provoked = true;
      captain.position = { x: 6, y: 4 };
      const hpBefore = state.player.hp;

      const sealedEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(
        JSON.stringify(sealedEvents),
        JSON.stringify([
          { type: 'GATE_LOCKED', roomId: 'room_checkpoint', reason: 'CHECKPOINT_SEALED' },
        ]),
        'stepping into (7, 3) while UNRESOLVED returns exact GATE_LOCKED CHECKPOINT_SEALED',
      );
      assertEqual(state.currentRoomId, 'room_checkpoint', 'remains in room_checkpoint');
      assertEqual(
        JSON.stringify(state.player.position),
        JSON.stringify({ x: 6, y: 3 }),
        'player position unchanged',
      );
      assertEqual(state.isRiposteReady, true, 'GATE_LOCKED preserves isRiposteReady');
      assertEqual(state.isGuardingFromWait, true, 'GATE_LOCKED preserves isGuardingFromWait');
      assertEqual(state.keenSightTriggeredThisTurn, true, 'GATE_LOCKED preserves keenSightTriggeredThisTurn');
      assertEqual(state.player.hp, hpBefore, 'runRoomAi did not run on GATE_LOCKED');

      // West door (0, 3) back to room_depot remains freely open even when UNRESOLVED
      state.player.position = { x: 1, y: 3 };
      const backToDepot = engine.handleAction({ type: 'MOVE', direction: 'left' });
      assertEqual(state.currentRoomId, 'room_depot', 'West door (0, 3) in Room 3 stays open');
      assert(backToDepot.some((e) => e.type === 'ROOM_CHANGED'), 'transitioned back to room_depot');

      // 2. Room 4 West door (0, 3) when checkpointResolution === 'ESCORTED' -> TRIBUNAL_IN_SESSION
      engine.reset();
      const s2 = engine.getState();
      s2.currentRoomId = 'room_inner_court';
      s2.player.roomId = 'room_inner_court';
      s2.checkpointResolution = 'ESCORTED';
      s2.filterChoice = 'BREAK';
      s2.player.position = { x: 1, y: 3 };
      s2.isRiposteReady = true;
      getEntity(engine, 'scribe_01').hp = 20; // hurt so AI_FLED would fire if runRoomAi ran

      const tribunalLocked = engine.handleAction({ type: 'MOVE', direction: 'left' });
      assertEqual(
        JSON.stringify(tribunalLocked),
        JSON.stringify([
          { type: 'GATE_LOCKED', roomId: 'room_inner_court', reason: 'TRIBUNAL_IN_SESSION' },
        ]),
        'stepping into (0, 3) in Room 4 while ESCORTED returns TRIBUNAL_IN_SESSION',
      );
      assertEqual(s2.currentRoomId, 'room_inner_court', 'remains in room_inner_court');
      assertEqual(s2.isRiposteReady, true, 'TRIBUNAL_IN_SESSION preserves isRiposteReady');

      // 3. BREACHED mode allows retreating through (0, 3) back to room_checkpoint (6, 3) to loot imperial_salve
      s2.checkpointResolution = 'BREACHED';
      s2.groundItems.push({
        itemId: 'imperial_salve',
        roomId: 'room_checkpoint',
        position: { x: 6, y: 3 },
      });
      const retreatEvents = engine.handleAction({ type: 'MOVE', direction: 'left' });
      assertEqual(s2.currentRoomId, 'room_checkpoint', 'BREACHED allows retreating to Room 3');
      assertEqual(
        JSON.stringify(s2.player.position),
        JSON.stringify({ x: 6, y: 3 }),
        'spawned at (6, 3) in room_checkpoint',
      );
      assert(
        retreatEvents.some((e) => e.type === 'ITEM_PICKED_UP' && e.itemId === 'imperial_salve'),
        'picked up imperial_salve on retreat',
      );
    },
  },
  {
    name: 'Phase 6 v0.4: world_relic 3-state activation (UNDECIDED reject, KEEP 35 dmg nearest guard tie-break + fixed 20 heal + cloned pos, BREAK relic_clarity)',
    run: () => {
      // 1. UNDECIDED -> rejected (returns [], item preserved, AI does not run)
      const engine = new GameEngine('human', 'brawler');
      let state = engine.getState();
      const patrol1 = getEntity(engine, 'patrol_01');
      patrol1.provoked = true;
      patrol1.position = { x: 2, y: 3 };
      state.player.position = { x: 1, y: 3 };
      state.player.hp = 60;

      const dormantTry = engine.handleAction({ type: 'USE_ITEM', itemId: 'world_relic' });
      assertEqual(dormantTry.length, 0, 'UNDECIDED world_relic returns empty events');
      assert(state.inventory.includes('world_relic'), 'dormant world_relic is not consumed');
      assertEqual(state.player.hp, 60, 'enemy AI did not run on rejected world_relic');

      // 2. KEEP -> fixed 20 HP heal (NO human +10 adaptability!), nearest living entity with empire_guard tie-breaker
      engine.reset();
      state = engine.getState();
      engine.debugAddLucidity(70);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' }); // maxHp = 120
      state.currentRoomId = 'room_depot';
      state.player.roomId = 'room_depot';
      state.player.position = { x: 3, y: 3 };
      state.player.hp = 70; // 70 + 20 = 90 (NOT 100!)

      // Place courier_01 (civilian) and patrol_02 (empire_guard) at equal Manhattan distance 2 from (3, 3)
      const courier = getEntity(engine, 'courier_01');
      const patrol2 = getEntity(engine, 'patrol_02');
      courier.position = { x: 3, y: 1 }; // dist 2
      patrol2.position = { x: 5, y: 3 }; // dist 2

      const tieEvents = engine.handleAction({ type: 'USE_ITEM', itemId: 'world_relic' });
      const tieRelic = tieEvents.find((e) => e.type === 'RELIC_ACTIVATED');
      assert(!state.inventory.includes('world_relic'), 'KEEP consumes world_relic');
      assert(tieRelic !== undefined && tieRelic.type === 'RELIC_ACTIVATED', 'RELIC_ACTIVATED emitted');
      if (tieRelic && tieRelic.type === 'RELIC_ACTIVATED' && tieRelic.mode === 'KEEP') {
        assertEqual(tieRelic.healAmount, 20, 'human KEEP relic heals fixed 20 HP without +10 adaptability');
        assertEqual(tieRelic.targetId, 'patrol_02', 'tie-breaker prioritizes empire_guard over civilian');
        assertEqual(tieRelic.damage, 35, 'KEEP relic deals 35 shockwave damage');
        assertEqual(
          JSON.stringify(tieRelic.targetPosition),
          JSON.stringify({ x: 5, y: 3 }),
          'targetPosition snapshot matches pre-chase patrol_02 tile',
        );
        assert(
          tieRelic.targetPosition !== patrol2.position,
          'RELIC_ACTIVATED.targetPosition is a cloned snapshot (patrol_02 chased on AI turn)',
        );
      }
      assertEqual(patrol2.hp, 30, 'patrol_02 HP reduced 65 -> 30');
      assertEqual(courier.hp, 45, 'courier_01 untouched');

      // 2b. KEEP hitting nearest civilian triggers guard intervention & cloned position resists AI_FLED; empty room safe
      engine.reset();
      state = engine.getState();
      engine.debugAddLucidity(70);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' });
      state.currentRoomId = 'room_depot';
      state.player.roomId = 'room_depot';
      state.player.position = { x: 3, y: 2 };
      const c2 = getEntity(engine, 'courier_01'); // at (4, 2), dist 1
      const p2 = getEntity(engine, 'patrol_02'); // at (5, 5), dist 5
      const civHitEvents = engine.handleAction({ type: 'USE_ITEM', itemId: 'world_relic' });
      const civRelic = civHitEvents.find((e) => e.type === 'RELIC_ACTIVATED');
      assert(
        civHitEvents.some((e) => e.type === 'GUARD_INTERVENED' && e.entityId === 'patrol_02'),
        'hitting civilian with KEEP relic provokes guard_civilian',
      );
      assert(civHitEvents.some((e) => e.type === 'AI_FLED'), 'hurt civilian fled on same turn');
      if (civRelic && civRelic.type === 'RELIC_ACTIVATED' && civRelic.mode === 'KEEP') {
        assertEqual(
          JSON.stringify(civRelic.targetPosition),
          JSON.stringify({ x: 4, y: 2 }),
          'RELIC_ACTIVATED.targetPosition resisted AI_FLED mutation',
        );
      }

      // Empty room KEEP relic
      engine.reset();
      state = engine.getState();
      engine.debugAddLucidity(70);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' });
      state.entities = [];
      state.player.hp = 100; // maxHp 120 -> heals 20 to 120
      const emptyEvents = engine.handleAction({ type: 'USE_ITEM', itemId: 'world_relic' });
      assertLastEvent(
        emptyEvents,
        { type: 'RELIC_ACTIVATED', mode: 'KEEP', healAmount: 20 },
        'KEEP relic in empty room heals 20 without target fields',
      );

      // 3. BREAK -> activates relic_clarity (+5 ATK, +15 Max HP, instantHeal 30; works even at full HP!)
      engine.setBuildAndReset('dark_elf', 'spellblade'); // 85 HP, 20 ATK
      state = engine.getState();
      getEntity(engine, 'patrol_01').position = { x: 6, y: 6 };
      engine.debugAddLucidity(70);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });

      // Full HP activation (85/85 -> maxHp 100, hp 100, actualHeal 15, ATK 25)
      const breakRelicEvents = engine.handleAction({ type: 'USE_ITEM', itemId: 'world_relic' });
      assert(!state.inventory.includes('world_relic'), 'BREAK consumes world_relic');
      assertEqual(state.player.maxHp, 100, 'relic_clarity adds +15 maxHp (85 -> 100)');
      assertEqual(state.player.hp, 100, 'full-HP player rises to new 100/100 cap');
      assertEqual(engine.getEffectiveAttack(state.player), 25, 'relic_clarity adds +5 ATK (20 -> 25)');
      assertLastEvent(
        breakRelicEvents,
        {
          type: 'RELIC_ACTIVATED',
          mode: 'BREAK',
          healAmount: 15,
          appliedModifierId: 'relic_clarity',
        },
        'BREAK relic at full HP reports exact actualHeal 15',
      );

      // Injured BREAK activation check (50/100 -> maxHp 115, hp 80, actualHeal 30)
      engine.setBuildAndReset('human', 'brawler');
      state = engine.getState();
      getEntity(engine, 'patrol_01').position = { x: 6, y: 6 };
      state.player.hp = 50;
      engine.debugAddLucidity(70);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      const injuredBreakEvents = engine.handleAction({ type: 'USE_ITEM', itemId: 'world_relic' });
      assertEqual(state.player.maxHp, 115, 'human + brawler maxHp 100 -> 115');
      assertEqual(state.player.hp, 80, 'injured player heals full +30 (50 -> 80)');
      assertLastEvent(
        injuredBreakEvents,
        {
          type: 'RELIC_ACTIVATED',
          mode: 'BREAK',
          healAmount: 30,
          appliedModifierId: 'relic_clarity',
        },
        'BREAK relic when injured heals full 30 HP',
      );
    },
  },
  {
    name: 'Phase 6 v0.4: Room 4 inner_magistrate AI, scribe_01 provocation, PRESENT_RELIC eligibility guards, and all 9 builds defeating magistrate_01',
    run: () => {
      // 1. Peaceful scribe_01 TALK vs attacking scribe_01 provokes magistrate_01
      const engine = new GameEngine('human', 'brawler');
      let state = engine.getState();
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      state.currentRoomId = 'room_inner_court';
      state.player.roomId = 'room_inner_court';
      state.checkpointResolution = 'ESCORTED';
      state.player.position = { x: 3, y: 1 }; // left of scribe_01 at (4, 1)

      const scribe = getEntity(engine, 'scribe_01');
      const magistrate = getEntity(engine, 'magistrate_01');
      const scribeTalk = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(scribe.hp, 40, 'peaceful TALK with scribe_01 deals 0 damage');
      assertEqual(magistrate.provoked, false, 'magistrate_01 stays unprovoked in ESCORTED');
      assertEqual(magistrate.position.x, 6, 'magistrate_01 stands still at (6, 3)');
      assertLastEvent(
        scribeTalk,
        { type: 'NPC_TALKED', entityId: 'scribe_01', hasBadge: false },
        'scribe_01 NPC_TALKED omits raceId & imperialRecord',
      );

      // If scribe_01 is provoked and attacked, magistrate_01 immediately turns hostile!
      scribe.provoked = true;
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(magistrate.provoked, true, 'attacking scribe_01 immediately provokes magistrate_01');
      assert(magistrate.position.x < 6, 'provoked magistrate_01 begins chasing player');

      // 2. PRESENT_RELIC eligibility guards (blocks civiliansKilled > 0 OR missing world_relic without closing modal)
      engine.reset();
      state = engine.getState();
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      state.currentRoomId = 'room_inner_court';
      state.player.roomId = 'room_inner_court';
      state.checkpointResolution = 'ESCORTED';
      state.imperialRecord.civiliansKilled = 1;
      state.player.position = { x: 5, y: 3 };

      engine.handleAction({ type: 'MOVE', direction: 'right' }); // TALK magistrate_01
      assertEqual(state.pendingTribunalChoice, true, 'pendingTribunalChoice opened');

      // Non-tribunal actions locked
      assertEqual(engine.handleAction({ type: 'MOVE', direction: 'left' }).length, 0, 'MOVE locked during tribunal');
      assertEqual(engine.handleAction({ type: 'WAIT' }).length, 0, 'WAIT locked during tribunal');
      assertEqual(
        engine.handleAction({ type: 'USE_ITEM', itemId: 'world_relic' }).length,
        0,
        'USE_ITEM locked during tribunal',
      );

      // PRESENT_RELIC rejected when civiliansKilled > 0 -> returns [] and keeps modal open!
      const rejectedByBlood = engine.handleAction({
        type: 'CHOOSE_TRIBUNAL_ACTION',
        choice: 'PRESENT_RELIC',
      });
      assertEqual(rejectedByBlood.length, 0, 'PRESENT_RELIC rejected when civiliansKilled > 0');
      assertEqual(state.pendingTribunalChoice, true, 'modal stays open for valid choice');
      assertEqual(state.endingId, null, 'endingId stays null on rejected PRESENT_RELIC');

      // PRESENT_RELIC also rejected when civiliansKilled === 0 but world_relic was already used
      state.imperialRecord.civiliansKilled = 0;
      state.inventory = [];
      const rejectedNoRelic = engine.handleAction({
        type: 'CHOOSE_TRIBUNAL_ACTION',
        choice: 'PRESENT_RELIC',
      });
      assertEqual(rejectedNoRelic.length, 0, 'PRESENT_RELIC rejected when world_relic missing');
      assertEqual(state.pendingTribunalChoice, true, 'modal stays open when world_relic missing');

      // Valid ACCEPT_DECREE still transitions cleanly into room_market_street as CITIZEN
      engine.handleAction({ type: 'CHOOSE_TRIBUNAL_ACTION', choice: 'ACCEPT_DECREE' });
      assertEqual(state.endingId, null, 'ACCEPT_DECREE transitions to Hub rather than ending');
      assertEqual(state.legalStatus, 'CITIZEN', 'ACCEPT_DECREE grants CITIZEN');
      assertEqual(state.currentRoomId, 'room_market_street', 'CITIZEN enters room_market_street');

      // 3. All 9 Race x Class builds defeat magistrate_01 (130 HP, 17 ATK) with relic_clarity in BREAK and escape to room_outer_sewer
      const races = ['human', 'dark_elf', 'undead_outsider'] as const;
      const classes = ['brawler', 'iron_vanguard', 'spellblade'] as const;
      for (const raceId of races) {
        for (const classId of classes) {
          const eng = new GameEngine(raceId, classId);
          const st = eng.getState();
          eng.debugAddLucidity(75);
          eng.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
          eng.handleAction({ type: 'USE_ITEM', itemId: 'world_relic' }); // +5 ATK, +15 Max HP, +30 HP
          st.currentRoomId = 'room_inner_court';
          st.player.roomId = 'room_inner_court';
          st.checkpointResolution = 'ESCORTED';
          st.player.position = { x: 5, y: 3 };
          eng.handleAction({ type: 'MOVE', direction: 'right' }); // TALK
          eng.handleAction({ type: 'CHOOSE_TRIBUNAL_ACTION', choice: 'DEFY_TRIBUNAL' });

          let guard = 0;
          while (st.legalStatus !== 'OUTLAW' && !st.isGameOver && guard < 25) {
            const mag = st.entities.find((e) => e.id === 'magistrate_01');
            const baseAtk = eng.getEffectiveAttack(st.player);
            if (
              classId === 'iron_vanguard' &&
              !st.isRiposteReady &&
              mag &&
              mag.hp > baseAtk
            ) {
              eng.handleAction({ type: 'WAIT' });
            } else {
              eng.handleAction({ type: 'MOVE', direction: 'right' });
            }
            guard++;
          }
          assertEqual(
            st.legalStatus,
            'OUTLAW',
            `${raceId} + ${classId} must defeat magistrate_01 and transition to OUTLAW`,
          );
          assertEqual(
            st.currentRoomId,
            'room_outer_sewer',
            `${raceId} + ${classId} escapes into room_outer_sewer`,
          );
          assertEqual(st.silver, 20, `${raceId} + ${classId} grabs 20 silver`);
          assert(
            st.player.hp > 0,
            `${raceId} + ${classId} survives magistrate_01 with > 0 HP (left: ${st.player.hp})`,
          );
        }
      }
    },
  },
  {
    name: 'Phase 7A v0.5.0: All 4 legalStatus transitions (CITIZEN, ENVOY keeping world_relic, CONVICT, OUTLAW_ESCAPE) & reset/setBuildAndReset cleanup',
    run: () => {
      // 1. CITIZEN: ACCEPT_DECREE with civiliansKilled === 0 -> +25 silver, removes patrol_badge, clears isRiposteReady, room_market_street (1, 3)
      const engine = new GameEngine('human', 'iron_vanguard');
      let state = engine.getState();
      assertEqual(state.silver, 0, 'silver starts 0');
      assertEqual(state.legalStatus, 'UNREGISTERED', 'legalStatus starts UNREGISTERED');
      assertEqual(state.hasAcceptedExpedition, false, 'hasAcceptedExpedition starts false');
      assertEqual(state.activeHubNpcId, null, 'activeHubNpcId starts null');
      assertEqual(state.claimedFreeSupplyIds.length, 0, 'claimedFreeSupplyIds starts empty');
      assertEqual(state.visitedAmbientRoomIds.length, 0, 'visitedAmbientRoomIds starts empty');

      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      state.currentRoomId = 'room_inner_court';
      state.player.roomId = 'room_inner_court';
      state.checkpointResolution = 'ESCORTED';
      state.inventory.push('patrol_badge');
      state.isRiposteReady = true;
      state.player.position = { x: 5, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' }); // TALK magistrate_01

      const citizenEvents = engine.handleAction({
        type: 'CHOOSE_TRIBUNAL_ACTION',
        choice: 'ACCEPT_DECREE',
      });
      assertEqual(state.legalStatus, 'CITIZEN', 'CITIZEN status');
      assertEqual(state.silver, 25, 'CITIZEN granted 25 silver');
      assertEqual(state.isRiposteReady, false, 'transition clears isRiposteReady');
      assert(!state.inventory.includes('patrol_badge'), 'CITIZEN archives patrol_badge');
      assertEqual(state.currentRoomId, 'room_market_street', 'CITIZEN spawns in room_market_street');
      assertEqual(JSON.stringify(state.player.position), JSON.stringify({ x: 1, y: 3 }), 'CITIZEN spawns at (1, 3)');
      const citizenTrans = citizenEvents.find((e) => e.type === 'TRIBUNAL_TRANSITIONED');
      assert(citizenTrans !== undefined && citizenTrans.type === 'TRIBUNAL_TRANSITIONED', 'TRIBUNAL_TRANSITIONED emitted');
      if (citizenTrans && citizenTrans.type === 'TRIBUNAL_TRANSITIONED') {
        assert(citizenTrans.to !== state.player.position, 'TRIBUNAL_TRANSITIONED.to is cloned');
      }
      assert(
        citizenEvents.some(
          (e) => e.type === 'ROOM_AMBIENT_OBSERVED' && e.roomId === 'room_market_street',
        ),
        'room_market_street ambient observed on arrival',
      );

      // 2. ENVOY: PRESENT_RELIC -> +40 silver, KEEPS world_relic, removes patrol_badge, room_market_street (1, 3)
      engine.reset();
      state = engine.getState();
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      state.currentRoomId = 'room_inner_court';
      state.player.roomId = 'room_inner_court';
      state.checkpointResolution = 'ESCORTED';
      state.inventory.push('patrol_badge');
      state.player.position = { x: 5, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      const envoyEvents = engine.handleAction({
        type: 'CHOOSE_TRIBUNAL_ACTION',
        choice: 'PRESENT_RELIC',
      });
      assertEqual(state.legalStatus, 'ENVOY', 'ENVOY status');
      assertEqual(state.silver, 40, 'ENVOY granted 40 silver');
      assert(state.inventory.includes('world_relic'), 'ENVOY KEEPS intact world_relic');
      assert(!state.inventory.includes('patrol_badge'), 'ENVOY archives patrol_badge');
      assertEqual(state.currentRoomId, 'room_market_street', 'ENVOY spawns in room_market_street');
      assert(
        envoyEvents.some(
          (e) =>
            e.type === 'TRIBUNAL_TRANSITIONED' &&
            e.resolution === 'ENVOY' &&
            e.silverGranted === 40,
        ),
        'TRIBUNAL_TRANSITIONED ENVOY emitted',
      );

      // 3. CONVICT: ACCEPT_DECREE with civiliansKilled > 0 -> +15 silver, room_penal_outpost (1, 3)
      engine.reset();
      state = engine.getState();
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      state.currentRoomId = 'room_inner_court';
      state.player.roomId = 'room_inner_court';
      state.checkpointResolution = 'ESCORTED';
      state.imperialRecord.civiliansKilled = 1;
      state.player.position = { x: 5, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      const convictEvents = engine.handleAction({
        type: 'CHOOSE_TRIBUNAL_ACTION',
        choice: 'ACCEPT_DECREE',
      });
      assertEqual(state.legalStatus, 'CONVICT', 'CONVICT status');
      assertEqual(state.silver, 15, 'CONVICT granted 15 silver');
      assertEqual(state.currentRoomId, 'room_penal_outpost', 'CONVICT escorted to room_penal_outpost');
      assertEqual(JSON.stringify(state.player.position), JSON.stringify({ x: 1, y: 3 }), 'CONVICT spawns at (1, 3)');
      assert(
        convictEvents.some(
          (e) =>
            e.type === 'TRIBUNAL_TRANSITIONED' &&
            e.resolution === 'CONVICT' &&
            e.silverGranted === 15,
        ),
        'TRIBUNAL_TRANSITIONED CONVICT emitted',
      );
      assert(
        convictEvents.some(
          (e) => e.type === 'ROOM_AMBIENT_OBSERVED' && e.roomId === 'room_penal_outpost',
        ),
        'room_penal_outpost ambient observed on arrival',
      );

      // 4. OUTLAW_ESCAPE via KEEP world_relic lethal shockwave on magistrate_01
      engine.reset();
      state = engine.getState();
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' });
      state.currentRoomId = 'room_inner_court';
      state.player.roomId = 'room_inner_court';
      state.checkpointResolution = 'BREACHED';
      state.player.position = { x: 5, y: 3 };
      getEntity(engine, 'scribe_01').hp = 20;
      getEntity(engine, 'magistrate_01').hp = 30;
      const relicKillEvents = engine.handleAction({ type: 'USE_ITEM', itemId: 'world_relic' });
      assertEqual(state.legalStatus, 'OUTLAW', 'KEEP relic kill sets OUTLAW');
      assertEqual(state.silver, 20, 'OUTLAW granted 20 silver');
      assertEqual(state.currentRoomId, 'room_outer_sewer', 'OUTLAW escapes to room_outer_sewer');
      assert(
        !relicKillEvents.some((e) => e.type === 'AI_FLED'),
        'old-room AI stopped immediately after KEEP relic kill transition',
      );

      // 5. Dirty all 7A fields and confirm reset() & setBuildAndReset() wipe cleanly
      state.hasAcceptedExpedition = true;
      state.claimedFreeSupplyIds.push('sanctum_agent_01');
      state.activeHubNpcId = 'sanctum_agent_01';
      engine.reset();
      state = engine.getState();
      assertEqual(state.silver, 0, 'reset() clears silver');
      assertEqual(state.legalStatus, 'UNREGISTERED', 'reset() clears legalStatus');
      assertEqual(state.hasAcceptedExpedition, false, 'reset() clears hasAcceptedExpedition');
      assertEqual(state.claimedFreeSupplyIds.length, 0, 'reset() clears claimedFreeSupplyIds');
      assertEqual(state.activeHubNpcId, null, 'reset() clears activeHubNpcId');
      assertEqual(state.visitedAmbientRoomIds.length, 0, 'reset() clears visitedAmbientRoomIds');

      state.silver = 99;
      state.legalStatus = 'ENVOY';
      engine.setBuildAndReset('dark_elf', 'spellblade');
      assertEqual(engine.getState().silver, 0, 'setBuildAndReset() clears silver');
      assertEqual(engine.getState().legalStatus, 'UNREGISTERED', 'setBuildAndReset() clears legalStatus');
    },
  },
  {
    name: 'Phase 7A v0.5.0: Hub triangle gate locks (TRIBUNAL_CONCLUDED, CONVICT_BARRED, OUTLAW_LOCKDOWN, EXPEDITION_UNBRIEFED) & East gate ending mapping',
    run: () => {
      const engine = new GameEngine('human', 'iron_vanguard');
      let state = engine.getState();

      // 1. CITIZEN: blocked at (0, 3) TRIBUNAL_CONCLUDED & East (7, 3) EXPEDITION_UNBRIEFED (no turn lost / preserves isRiposteReady), free across all 3 Hub rooms
      state.filterChoice = 'BREAK';
      state.legalStatus = 'CITIZEN';
      state.currentRoomId = 'room_market_street';
      state.player.roomId = 'room_market_street';
      state.isRiposteReady = true;
      state.isGuardingFromWait = true;

      state.player.position = { x: 1, y: 3 };
      const backCourt = engine.handleAction({ type: 'MOVE', direction: 'left' });
      assertEqual(
        JSON.stringify(backCourt),
        JSON.stringify([
          { type: 'GATE_LOCKED', roomId: 'room_market_street', reason: 'TRIBUNAL_CONCLUDED' },
        ]),
        '(0, 3) in room_market_street emits TRIBUNAL_CONCLUDED',
      );
      assertEqual(state.isRiposteReady, true, 'TRIBUNAL_CONCLUDED preserves isRiposteReady');
      assertEqual(state.isGuardingFromWait, true, 'TRIBUNAL_CONCLUDED preserves isGuardingFromWait');

      state.player.position = { x: 6, y: 3 };
      const unbriefed = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(
        JSON.stringify(unbriefed),
        JSON.stringify([
          { type: 'GATE_LOCKED', roomId: 'room_market_street', reason: 'EXPEDITION_UNBRIEFED' },
        ]),
        'East gate (7, 3) before briefing emits EXPEDITION_UNBRIEFED',
      );
      assertEqual(state.endingId, null, 'EXPEDITION_UNBRIEFED does not end run');

      // Talking to non-role market_guard_01 does NOT brief expedition or open service menu
      state.player.position = { x: 5, y: 1 };
      const guardTalk = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.hasAcceptedExpedition, false, 'market_guard_01 does not set hasAcceptedExpedition');
      assertEqual(state.activeHubNpcId, null, 'market_guard_01 does not open Hub menu');
      assert(
        guardTalk.some(
          (e) =>
            e.type === 'NPC_TALKED' &&
            e.entityId === 'market_guard_01' &&
            e.legalStatus === 'CITIZEN',
        ),
        'market_guard_01 emits NPC_TALKED with legalStatus',
      );

      // Triangle walk for CITIZEN: market -> penal (4, 0) -> sewer (0, 5) -> market (2, 0), ambient fires once per room
      state.player.position = { x: 4, y: 1 };
      const toPenal = engine.handleAction({ type: 'MOVE', direction: 'up' });
      assertEqual(state.currentRoomId, 'room_penal_outpost', 'CITIZEN walks market -> penal');
      assertEqual(JSON.stringify(state.player.position), JSON.stringify({ x: 4, y: 6 }), 'spawns at (4, 6)');
      assert(
        toPenal.some((e) => e.type === 'ROOM_AMBIENT_OBSERVED' && e.roomId === 'room_penal_outpost'),
        'penal ambient fires on first visit',
      );

      state.player.position = { x: 1, y: 5 };
      const toSewer = engine.handleAction({ type: 'MOVE', direction: 'left' });
      assertEqual(state.currentRoomId, 'room_outer_sewer', 'CITIZEN walks penal -> sewer');
      assertEqual(JSON.stringify(state.player.position), JSON.stringify({ x: 6, y: 5 }), 'spawns at (6, 5)');
      assert(
        toSewer.some((e) => e.type === 'ROOM_AMBIENT_OBSERVED' && e.roomId === 'room_outer_sewer'),
        'sewer ambient fires on first visit',
      );

      state.player.position = { x: 2, y: 1 };
      engine.handleAction({ type: 'MOVE', direction: 'up' });
      assertEqual(state.currentRoomId, 'room_market_street', 'CITIZEN walks sewer -> market');
      assertEqual(JSON.stringify(state.player.position), JSON.stringify({ x: 4, y: 6 }), 'spawns at (4, 6)');

      // Re-entering penal does NOT duplicate ROOM_AMBIENT_OBSERVED
      state.player.position = { x: 4, y: 1 };
      const revisitPenal = engine.handleAction({ type: 'MOVE', direction: 'up' });
      assert(
        !revisitPenal.some((e) => e.type === 'ROOM_AMBIENT_OBSERVED'),
        'Hub ambient does not duplicate on revisit',
      );

      // 2. CONVICT: blocked entering room_market_street from BOTH penal (4, 7) and sewer (2, 0), allowed penal <-> sewer, East gate -> AWAKENED
      engine.reset();
      state = engine.getState();
      state.filterChoice = 'BREAK';
      state.legalStatus = 'CONVICT';
      state.currentRoomId = 'room_penal_outpost';
      state.player.roomId = 'room_penal_outpost';

      state.player.position = { x: 4, y: 6 };
      const penalBlocked = engine.handleAction({ type: 'MOVE', direction: 'down' });
      assertEqual(
        JSON.stringify(penalBlocked),
        JSON.stringify([
          { type: 'GATE_LOCKED', roomId: 'room_penal_outpost', reason: 'CONVICT_BARRED' },
        ]),
        'CONVICT blocked from market via penal (4, 7)',
      );

      state.player.position = { x: 1, y: 5 };
      engine.handleAction({ type: 'MOVE', direction: 'left' });
      assertEqual(state.currentRoomId, 'room_outer_sewer', 'CONVICT can move penal -> sewer');

      state.player.position = { x: 2, y: 1 };
      const sewerBlocked = engine.handleAction({ type: 'MOVE', direction: 'up' });
      assertEqual(
        JSON.stringify(sewerBlocked),
        JSON.stringify([
          { type: 'GATE_LOCKED', roomId: 'room_outer_sewer', reason: 'CONVICT_BARRED' },
        ]),
        'CONVICT blocked from market via sewer (2, 0)',
      );

      state.player.position = { x: 6, y: 5 };
      engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.currentRoomId, 'room_penal_outpost', 'CONVICT can move sewer -> penal');

      // Talk to beast_warden_01 -> brief -> depart East gate -> room_abandoned_border -> West gate returns to room_penal_outpost
      state.player.position = { x: 4, y: 3 };
      engine.handleAction({ type: 'MOVE', direction: 'down' });
      engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLOSE_HUB_MENU' });
      state.player.position = { x: 6, y: 3 };
      const convictDepart = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.endingId, null, 'CONVICT East gate enters border instead of ending early');
      assertEqual(state.currentRoomId, 'room_abandoned_border', 'CONVICT enters room_abandoned_border');
      assertEqual(state.lastHubRoomId, 'room_penal_outpost', 'lastHubRoomId saved as room_penal_outpost');
      assert(
        convictDepart.some(
          (e) => e.type === 'EXPEDITION_DEPARTED' && e.legalStatus === 'CONVICT',
        ),
        'EXPEDITION_DEPARTED carries CONVICT legalStatus',
      );
      state.player.position = { x: 1, y: 4 };
      engine.handleAction({ type: 'MOVE', direction: 'left' });
      assertEqual(state.currentRoomId, 'room_penal_outpost', 'West gate returns CONVICT to room_penal_outpost');
      assertEqual(JSON.stringify(state.player.position), JSON.stringify({ x: 6, y: 3 }), 'returns at (6, 3)');

      // 3. OUTLAW: locked out of BOTH market (2, 0) and penal (7, 5) via OUTLAW_LOCKDOWN
      engine.reset();
      state = engine.getState();
      state.filterChoice = 'KEEP';
      state.legalStatus = 'OUTLAW';
      state.currentRoomId = 'room_outer_sewer';
      state.player.roomId = 'room_outer_sewer';

      state.player.position = { x: 2, y: 1 };
      const outlawMarketLock = engine.handleAction({ type: 'MOVE', direction: 'up' });
      assertEqual(
        JSON.stringify(outlawMarketLock),
        JSON.stringify([
          { type: 'GATE_LOCKED', roomId: 'room_outer_sewer', reason: 'OUTLAW_LOCKDOWN' },
        ]),
        'OUTLAW blocked from market with OUTLAW_LOCKDOWN',
      );

      state.player.position = { x: 6, y: 5 };
      const outlawPenalLock = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(
        JSON.stringify(outlawPenalLock),
        JSON.stringify([
          { type: 'GATE_LOCKED', roomId: 'room_outer_sewer', reason: 'OUTLAW_LOCKDOWN' },
        ]),
        'OUTLAW blocked from penal outpost with OUTLAW_LOCKDOWN',
      );
    },
  },
  {
    name: 'Phase 7A v0.5.0: 6/6 inventory cap (INVENTORY_FULL), Silver services (BUY_RATION, CLAIM_FREE_SUPPLY, REST_HEAL, CLOSE_HUB_MENU), and Hub NPC invulnerability across KEEP/UNDECIDED/BREAK',
    run: () => {
      // 1. Ground item pickup cap at MAX_INVENTORY_SLOTS = 6 leaves overflow on ground and emits INVENTORY_FULL
      const engine = new GameEngine('human', 'brawler');
      let state = engine.getState();
      state.inventory = ['world_relic', 'warm_bread', 'warm_bread', 'warm_bread', 'warm_bread']; // 5/6
      state.groundItems.push(
        { itemId: 'healing_tonic', roomId: 'room_outpost', position: { x: 2, y: 3 } },
        { itemId: 'patrol_badge', roomId: 'room_outpost', position: { x: 2, y: 3 } },
      );
      const pickupEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.inventory.length, 6, 'inventory capped at 6/6');
      assert(state.inventory.includes('healing_tonic'), 'first ground item fits in 6th slot');
      assert(!state.inventory.includes('patrol_badge'), 'overflow item stays out of inventory');
      const outpostGround = state.groundItems.filter((item) => item.roomId === 'room_outpost');
      assertEqual(outpostGround.length, 1, '1 overflow item remains on ground in room_outpost');
      assertEqual(outpostGround[0].itemId, 'patrol_badge', 'patrol_badge remained on ground');
      assert(
        pickupEvents.some((e) => e.type === 'INVENTORY_FULL' && e.maxSlots === 6),
        'INVENTORY_FULL (maxSlots: 6) emitted on overflow',
      );

      // 2. Hub NPC invulnerability in UNDECIDED & KEEP + KEEP world_relic skips Hub NPCs
      engine.reset();
      state = engine.getState();
      state.filterChoice = 'UNDECIDED';
      state.legalStatus = 'OUTLAW';
      state.currentRoomId = 'room_outer_sewer';
      state.player.roomId = 'room_outer_sewer';
      state.player.position = { x: 2, y: 3 }; // below sewer_broker_01 at (2, 2)
      const broker = getEntity(engine, 'sewer_broker_01');
      const undecidedTalk = engine.handleAction({ type: 'MOVE', direction: 'up' });
      assertEqual(broker.hp, 60, 'UNDECIDED step into Hub NPC deals 0 damage');
      assertEqual(state.activeHubNpcId, 'sewer_broker_01', 'UNDECIDED opens Hub service panel');
      assert(
        undecidedTalk.some((e) => e.type === 'HUB_SERVICE_OPENED' && e.entityId === 'sewer_broker_01'),
        'HUB_SERVICE_OPENED emitted',
      );
      // Action lock while menu open
      assertEqual(engine.handleAction({ type: 'MOVE', direction: 'right' }).length, 0, 'MOVE locked during Hub menu');
      assertEqual(engine.handleAction({ type: 'WAIT' }).length, 0, 'WAIT locked during Hub menu');
      engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLOSE_HUB_MENU' });
      assertEqual(state.activeHubNpcId, null, 'CLOSE_HUB_MENU clears activeHubNpcId');
      assertEqual(
        engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'BUY_RATION' }).length,
        0,
        'CHOOSE_HUB_ACTION rejected when no Hub menu open',
      );

      // KEEP mode + KEEP world_relic must NEVER harm Hub NPCs
      state.filterChoice = 'KEEP';
      state.player.hp = 60;
      const relicInHub = engine.handleAction({ type: 'USE_ITEM', itemId: 'world_relic' });
      assertEqual(broker.hp, 60, 'KEEP world_relic must skip Hub NPC sewer_broker_01');
      assertEqual(getEntity(engine, 'sanctum_agent_01').hp, 65, 'KEEP world_relic must skip sanctum_agent_01');
      assert(
        relicInHub.some(
          (e) => e.type === 'RELIC_ACTIVATED' && e.mode === 'KEEP' && e.targetId === undefined,
        ),
        'KEEP world_relic in Hub treats room as empty of hostiles',
      );

      // 3. BUY_RATION, REST_HEAL (with cloned playerPosition), and CLAIM_FREE_SUPPLY guards
      engine.setBuildAndReset('human', 'brawler');
      state = engine.getState();
      state.filterChoice = 'BREAK';
      state.legalStatus = 'CONVICT';
      state.silver = 25;
      state.player.hp = 60;
      state.currentRoomId = 'room_penal_outpost';
      state.player.roomId = 'room_penal_outpost';
      state.player.position = { x: 4, y: 3 }; // above beast_warden_01 at (4, 4)

      engine.handleAction({ type: 'MOVE', direction: 'down' }); // opens beast_warden_01
      assertEqual(state.activeHubNpcId, 'beast_warden_01', 'opened beast_warden_01');

      // CLAIM_FREE_SUPPLY allowed once for CONVICT at beast_warden_01
      const claim1 = engine.handleAction({
        type: 'CHOOSE_HUB_ACTION',
        choice: 'CLAIM_FREE_SUPPLY',
      });
      assertEqual(state.silver, 25, 'free supply costs 0 silver');
      assertEqual(state.inventory.filter((id) => id === 'border_ration_pack').length, 1, 'received 1 border_ration_pack');
      assert(
        claim1.some(
          (e) =>
            e.type === 'HUB_SUPPLY_CLAIMED' &&
            e.entityId === 'beast_warden_01' &&
            e.itemId === 'border_ration_pack',
        ),
        'HUB_SUPPLY_CLAIMED emitted',
      );
      assertEqual(
        engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLAIM_FREE_SUPPLY' }).length,
        0,
        'second CLAIM_FREE_SUPPLY at same NPC rejected',
      );

      // BUY_RATION: 25 -> 10 silver, +1 border_ration_pack
      const buy1 = engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'BUY_RATION' });
      assertEqual(state.silver, 10, 'BUY_RATION deducts 15 silver (25 -> 10)');
      assertEqual(state.inventory.filter((id) => id === 'border_ration_pack').length, 2, 'now holds 2 border_ration_pack');
      assert(
        buy1.some(
          (e) =>
            e.type === 'HUB_RATION_BOUGHT' &&
            e.cost === 15 &&
            e.remainingSilver === 10,
        ),
        'HUB_RATION_BOUGHT emitted',
      );

      // Insufficient silver for second BUY_RATION (10 < 15) -> rejected
      assertEqual(
        engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'BUY_RATION' }).length,
        0,
        'BUY_RATION rejected when silver < 15',
      );

      // REST_HEAL: 10 -> 0 silver, restores full maxHp, clones playerPosition
      const restEvents = engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'REST_HEAL' });
      assertEqual(state.silver, 0, 'REST_HEAL deducts 10 silver');
      assertEqual(state.player.hp, state.player.maxHp, 'REST_HEAL restores full HP');
      const restEvent = restEvents.find((e) => e.type === 'HUB_RESTED');
      assert(restEvent !== undefined && restEvent.type === 'HUB_RESTED', 'HUB_RESTED emitted');
      if (restEvent && restEvent.type === 'HUB_RESTED') {
        assertEqual(restEvent.healAmount, 40, 'actual healAmount is 40');
        assert(restEvent.playerPosition !== state.player.position, 'HUB_RESTED.playerPosition is cloned');
      }

      // REST_HEAL at full HP rejected even with silver
      state.silver = 50;
      assertEqual(
        engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'REST_HEAL' }).length,
        0,
        'REST_HEAL rejected when already at full HP',
      );

      // BUY_RATION rejected when bag is 6/6
      state.inventory = ['world_relic', 'warm_bread', 'warm_bread', 'warm_bread', 'warm_bread', 'warm_bread'];
      assertEqual(
        engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'BUY_RATION' }).length,
        0,
        'BUY_RATION rejected when inventory is 6/6',
      );
      engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLOSE_HUB_MENU' });

      // CITIZEN at beast_warden_01 CANNOT claim free convict supply, but CAN claim free supply at sanctum_agent_01 (which rejects BUY_RATION & REST_HEAL)
      state.legalStatus = 'CITIZEN';
      state.claimedFreeSupplyIds = [];
      state.inventory = ['world_relic'];
      state.player.hp = 50;
      state.silver = 50;
      engine.handleAction({ type: 'MOVE', direction: 'down' }); // beast_warden_01
      assertEqual(
        engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLAIM_FREE_SUPPLY' }).length,
        0,
        'CITIZEN cannot claim CONVICT free supply at beast_warden_01',
      );
      engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLOSE_HUB_MENU' });

      state.currentRoomId = 'room_outer_sewer';
      state.player.roomId = 'room_outer_sewer';
      state.player.position = { x: 5, y: 5 }; // above sanctum_agent_01 at (5, 6)
      engine.handleAction({ type: 'MOVE', direction: 'down' });
      assertEqual(state.activeHubNpcId, 'sanctum_agent_01', 'opened sanctum_agent_01');
      assertEqual(
        engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'BUY_RATION' }).length,
        0,
        'sanctum_agent_01 does not offer BUY_RATION',
      );
      assertEqual(
        engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'REST_HEAL' }).length,
        0,
        'sanctum_agent_01 does not offer REST_HEAL',
      );
      const sanctumClaim = engine.handleAction({
        type: 'CHOOSE_HUB_ACTION',
        choice: 'CLAIM_FREE_SUPPLY',
      });
      assertEqual(sanctumClaim.length, 1, 'CITIZEN can claim 1x free supply at sanctum_agent_01');
      engine.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'CLOSE_HUB_MENU' });

      // 4. border_ration_pack healing: 35 + 10 = 45 HP for human, 35 HP for non-human
      const humanRationHeal = engine.handleAction({
        type: 'USE_ITEM',
        itemId: 'border_ration_pack',
      });
      const usedHuman = humanRationHeal.find((e) => e.type === 'ITEM_USED');
      assert(usedHuman !== undefined && usedHuman.type === 'ITEM_USED', 'human used border_ration_pack');
      if (usedHuman && usedHuman.type === 'ITEM_USED') {
        assertEqual(usedHuman.healAmount, 45, 'human heals 35 + 10 adaptability = 45 HP');
        assertEqual(usedHuman.triggeredTraitId, 'adaptability', 'tags adaptability');
      }

      engine.setBuildAndReset('undead_outsider', 'brawler');
      state = engine.getState();
      getEntity(engine, 'patrol_01').position = { x: 6, y: 6 };
      state.player.hp = 50;
      state.inventory.push('border_ration_pack');
      const undeadRationHeal = engine.handleAction({
        type: 'USE_ITEM',
        itemId: 'border_ration_pack',
      });
      const usedUndead = undeadRationHeal.find((e) => e.type === 'ITEM_USED');
      if (usedUndead && usedUndead.type === 'ITEM_USED') {
        assertEqual(usedUndead.healAmount, 35, 'undead_outsider heals base 35 HP');
        assertEqual(usedUndead.triggeredTraitId, undefined, 'no adaptability for undead_outsider');
      }
    },
  },
  {
    name: 'Phase 7B v0.5.1: Dynamic grid 8x8/10x10, two-way Hub <-> room_abandoned_border (lastHubRoomId & fallback), initialGroundItems, and reset cleanup',
    run: () => {
      // 1. Dynamic grid helpers support both 8x8 and 10x10 rooms
      assertEqual(getRoomGridSize('room_outpost'), 8, '8x8 room returns 8');
      assertEqual(getRoomGridSize('room_market_street'), 8, 'Hub room returns 8');
      assertEqual(getRoomGridSize('room_abandoned_border'), 10, 'room_abandoned_border returns 10');
      assertEqual(getTileType('room_abandoned_border', 0, 4), 'DOOR', '(0, 4) is West return DOOR');
      assertEqual(getTileType('room_abandoned_border', 8, 8), 'FLOOR', '(8, 8) is valid 10x10 FLOOR');
      assertEqual(getTileType('room_abandoned_border', 6, 7), 'OBSTACLE', '(6, 7) is OBSTACLE');
      assertEqual(getTileType('room_abandoned_border', 9, 9), 'WALL', '(9, 9) is outer WALL');
      assertEqual(getTileType('room_abandoned_border', 10, 4), 'WALL', 'out-of-bounds x=10 is WALL');
      assertEqual(isWall(9, 9, 10), true, 'isWall(9, 9, 10) is true');
      assertEqual(isWall(8, 8, 10), false, 'isWall(8, 8, 10) is false');

      // 2. Initial ground items contain shattered_relic_shard at (8, 8) in room_abandoned_border
      const engine = new GameEngine('human', 'brawler');
      let state = engine.getState();
      assertEqual(state.lastHubRoomId, null, 'lastHubRoomId starts null');
      assertEqual(state.convictCleared, false, 'convictCleared starts false');
      assertEqual(state.relicShardGlitchTriggered, false, 'relicShardGlitchTriggered starts false');
      assertEqual(state.submittedShardNpcId, null, 'submittedShardNpcId starts null');
      const initialShard = state.groundItems.find(
        (item) =>
          item.roomId === 'room_abandoned_border' &&
          item.itemId === 'shattered_relic_shard',
      );
      assert(initialShard !== undefined, 'shattered_relic_shard seeded in room_abandoned_border');
      if (initialShard) {
        assertEqual(
          JSON.stringify(initialShard.position),
          JSON.stringify({ x: 8, y: 8 }),
          'shattered_relic_shard placed at (8, 8)',
        );
      }

      // 3. Two-way transition Hub -> Border -> Hub remembers exact lastHubRoomId (even when CITIZEN leaves via sewer!) & safe spawn on 10x10
      state.filterChoice = 'BREAK';
      state.legalStatus = 'CITIZEN';
      state.hasAcceptedExpedition = true;
      state.currentRoomId = 'room_outer_sewer';
      state.player.roomId = 'room_outer_sewer';
      state.player.position = { x: 6, y: 3 };
      // Block preferred spawn (1, 4) in room_abandoned_border to verify 10x10 findSafeSpawnPosition
      getEntity(engine, 'border_patrol_01').position = { x: 1, y: 4 };
      const departEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(state.currentRoomId, 'room_abandoned_border', 'entered room_abandoned_border');
      assertEqual(state.lastHubRoomId, 'room_outer_sewer', 'saved lastHubRoomId = room_outer_sewer');
      assert(
        state.player.position.x !== 1 || state.player.position.y !== 4,
        '10x10 findSafeSpawnPosition avoided occupied (1, 4)',
      );
      assertEqual(
        getTileType('room_abandoned_border', state.player.position.x, state.player.position.y),
        'FLOOR',
        'safe spawn landed on valid 10x10 FLOOR',
      );
      assert(
        departEvents.some(
          (e) => e.type === 'ROOM_AMBIENT_OBSERVED' && e.roomId === 'room_abandoned_border',
        ),
        'first entry emits room_abandoned_border ROOM_AMBIENT_OBSERVED',
      );

      // Return through West Gate (0, 4) -> returns to room_outer_sewer at (6, 3)
      getEntity(engine, 'border_patrol_01').position = { x: 4, y: 1 };
      state.player.position = { x: 1, y: 4 };
      const returnEvents = engine.handleAction({ type: 'MOVE', direction: 'left' });
      assertEqual(state.currentRoomId, 'room_outer_sewer', 'West gate returned to exact lastHubRoomId');
      assertEqual(JSON.stringify(state.player.position), JSON.stringify({ x: 6, y: 3 }), 'returned at (6, 3)');
      const returnRoomEvent = returnEvents.find((e) => e.type === 'ROOM_CHANGED');
      assert(returnRoomEvent !== undefined && returnRoomEvent.type === 'ROOM_CHANGED', 'ROOM_CHANGED emitted on return');
      if (returnRoomEvent && returnRoomEvent.type === 'ROOM_CHANGED') {
        assert(returnRoomEvent.to !== state.player.position, 'ROOM_CHANGED.to is cloned');
      }

      // Re-entering room_abandoned_border does NOT duplicate ambient observation
      state.player.position = { x: 6, y: 3 };
      const reenterEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assert(
        !reenterEvents.some((e) => e.type === 'ROOM_AMBIENT_OBSERVED'),
        'room_abandoned_border ambient does not duplicate on revisit',
      );

      // Fallback when lastHubRoomId === null maps cleanly by legalStatus
      const fallbackCases: Array<{ legalStatus: 'CITIZEN' | 'ENVOY' | 'CONVICT' | 'OUTLAW'; expectedRoom: string }> = [
        { legalStatus: 'CITIZEN', expectedRoom: 'room_market_street' },
        { legalStatus: 'ENVOY', expectedRoom: 'room_market_street' },
        { legalStatus: 'CONVICT', expectedRoom: 'room_penal_outpost' },
        { legalStatus: 'OUTLAW', expectedRoom: 'room_outer_sewer' },
      ];
      for (const tc of fallbackCases) {
        engine.reset();
        state = engine.getState();
        state.filterChoice = 'BREAK';
        state.legalStatus = tc.legalStatus;
        state.lastHubRoomId = null;
        state.currentRoomId = 'room_abandoned_border';
        state.player.roomId = 'room_abandoned_border';
        state.player.position = { x: 1, y: 4 };
        engine.handleAction({ type: 'MOVE', direction: 'left' });
        assertEqual(
          state.currentRoomId,
          tc.expectedRoom,
          `West gate fallback for ${tc.legalStatus} -> ${tc.expectedRoom}`,
        );
      }

      // 4. Dirty all 7B fields and pick up shard -> verify reset() & setBuildAndReset() wipe & re-seed cleanly
      state.lastHubRoomId = 'room_market_street';
      state.convictCleared = true;
      state.relicShardGlitchTriggered = true;
      state.submittedShardNpcId = 'dwarf_smith_01';
      state.groundItems = [];
      engine.reset();
      state = engine.getState();
      assertEqual(state.lastHubRoomId, null, 'reset() clears lastHubRoomId');
      assertEqual(state.convictCleared, false, 'reset() clears convictCleared');
      assertEqual(state.relicShardGlitchTriggered, false, 'reset() clears relicShardGlitchTriggered');
      assertEqual(state.submittedShardNpcId, null, 'reset() clears submittedShardNpcId');
      assert(
        state.groundItems.some(
          (g) => g.roomId === 'room_abandoned_border' && g.itemId === 'shattered_relic_shard',
        ),
        'reset() restores initialGroundItems',
      );

      state.convictCleared = true;
      state.lastHubRoomId = 'room_penal_outpost';
      engine.setBuildAndReset('dark_elf', 'spellblade');
      assertEqual(engine.getState().convictCleared, false, 'setBuildAndReset() clears convictCleared');
      assertEqual(engine.getState().lastHubRoomId, null, 'setBuildAndReset() clears lastHubRoomId');
      assert(
        engine.getState().groundItems.some(
          (g) => g.roomId === 'room_abandoned_border' && g.itemId === 'shattered_relic_shard',
        ),
        'setBuildAndReset() restores initialGroundItems',
      );
    },
  },
  {
    name: 'Phase 7B v0.5.1: border_stele_200 0-turn OBJECT_INSPECTED, absolute invulnerability, and shattered_relic_shard 6/6 cap + KEEP RELIC_SHARD_GLITCHED',
    run: () => {
      // 1. border_stele_200: 0-turn OBJECT_INSPECTED (preserves guard/riposte, does not run AI, clones position)
      const engine = new GameEngine('human', 'iron_vanguard');
      let state = engine.getState();
      state.filterChoice = 'BREAK';
      state.legalStatus = 'CITIZEN';
      state.currentRoomId = 'room_abandoned_border';
      state.player.roomId = 'room_abandoned_border';
      state.player.position = { x: 2, y: 4 }; // left of border_stele_200 at (3, 4)
      state.isGuardingFromWait = true;
      state.isRiposteReady = true;

      const stele = getEntity(engine, 'border_stele_200');
      const patrol = getEntity(engine, 'border_patrol_01');
      const patrolBefore = { ...patrol.position };
      const deserter1 = getEntity(engine, 'ruin_deserter_01');
      const deserter1Before = { ...deserter1.position };

      const steleEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assertEqual(steleEvents.length, 1, 'touching stele emits exactly 1 OBJECT_INSPECTED event');
      assertEqual(steleEvents[0].type, 'OBJECT_INSPECTED', 'event type is OBJECT_INSPECTED');
      if (steleEvents[0].type === 'OBJECT_INSPECTED') {
        assertEqual(steleEvents[0].entityId, 'border_stele_200', 'entityId is border_stele_200');
        assertEqual(steleEvents[0].roomId, 'room_abandoned_border', 'roomId matches');
        assertEqual(JSON.stringify(steleEvents[0].position), JSON.stringify({ x: 3, y: 4 }), 'position is (3, 4)');
        assert(steleEvents[0].position !== stele.position, 'OBJECT_INSPECTED.position is cloned');
      }
      assertEqual(JSON.stringify(state.player.position), JSON.stringify({ x: 2, y: 4 }), 'player stays at (2, 4)');
      assertEqual(stele.hp, 999, 'stele takes 0 damage');
      assertEqual(state.isGuardingFromWait, true, '0-turn inspect preserves isGuardingFromWait');
      assertEqual(state.isRiposteReady, true, '0-turn inspect preserves isRiposteReady');
      assertEqual(JSON.stringify(patrol.position), JSON.stringify(patrolBefore), 'AI did not move on 0-turn stele inspect');
      assertEqual(JSON.stringify(deserter1.position), JSON.stringify(deserter1Before), 'deserter AI did not move');

      // 2. Stele invulnerable to KEEP world_relic shockwave and ignored by AI
      state.filterChoice = 'KEEP';
      state.entities = state.entities.filter(
        (e) => e.roomId !== 'room_abandoned_border' || e.id === 'border_stele_200',
      );
      state.player.hp = 80;
      const keepRelicStele = engine.handleAction({ type: 'USE_ITEM', itemId: 'world_relic' });
      assertEqual(stele.hp, 999, 'KEEP world_relic must never hit border_stele_200');
      assert(
        keepRelicStele.some(
          (e) => e.type === 'RELIC_ACTIVATED' && e.mode === 'KEEP' && e.targetId === undefined,
        ),
        'KEEP world_relic treats room with only stele as empty of targets',
      );

      // 3. shattered_relic_shard respects 6/6 bag cap (INVENTORY_FULL leaves shard on ground)
      engine.reset();
      state = engine.getState();
      state.filterChoice = 'KEEP';
      state.lucidity = 70;
      state.currentRoomId = 'room_abandoned_border';
      state.player.roomId = 'room_abandoned_border';
      state.entities = state.entities.filter((e) => e.roomId !== 'room_abandoned_border');
      state.inventory = ['world_relic', 'warm_bread', 'warm_bread', 'warm_bread', 'warm_bread', 'warm_bread']; // 6/6
      state.player.position = { x: 7, y: 8 };
      const fullEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assert(!state.inventory.includes('shattered_relic_shard'), '6/6 full bag blocks shard pickup');
      assert(
        fullEvents.some((e) => e.type === 'INVENTORY_FULL' && e.maxSlots === 6),
        'INVENTORY_FULL emitted when bag full on shard tile',
      );
      assert(
        !fullEvents.some((e) => e.type === 'RELIC_SHARD_GLITCHED'),
        'RELIC_SHARD_GLITCHED does not fire if shard was not picked up',
      );

      // 4. Free 1 slot -> KEEP pickup emits RELIC_SHARD_GLITCHED once, preserves KEEP & lucidity
      state.inventory.pop();
      state.player.position = { x: 7, y: 8 };
      const glitchPickup = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assert(state.inventory.includes('shattered_relic_shard'), 'shard picked up into 6th slot');
      assertEqual(state.relicShardGlitchTriggered, true, 'relicShardGlitchTriggered flagged true');
      assert(
        glitchPickup.some(
          (e) => e.type === 'RELIC_SHARD_GLITCHED' && e.itemId === 'shattered_relic_shard',
        ),
        'RELIC_SHARD_GLITCHED emitted on KEEP pickup',
      );
      assertEqual(state.filterChoice, 'KEEP', 'KEEP choice remains locked');
      assertEqual(state.lucidity, 70, 'KEEP pickup does not increase lucidity');

      // 5. BREAK pickup does NOT emit RELIC_SHARD_GLITCHED
      engine.reset();
      state = engine.getState();
      state.filterChoice = 'BREAK';
      state.currentRoomId = 'room_abandoned_border';
      state.player.roomId = 'room_abandoned_border';
      state.entities = state.entities.filter((e) => e.roomId !== 'room_abandoned_border');
      state.player.position = { x: 7, y: 8 };
      const breakPickup = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assert(state.inventory.includes('shattered_relic_shard'), 'BREAK picks up shard normally');
      assert(
        !breakPickup.some((e) => e.type === 'RELIC_SHARD_GLITCHED'),
        'BREAK pickup does not emit RELIC_SHARD_GLITCHED',
      );
    },
  },
  {
    name: 'Phase 7B v0.5.1: Multi-faction AI (border_patrol vs hostile_deserter), 2-beat Tier 7 dialogue, NPC_ATTACKED_NPC, and imperialRecord preservation',
    run: () => {
      // 1. border_patrol_01 TALK works for CITIZEN/ENVOY/CONVICT, hostile for OUTLAW/KEEP
      const engine = new GameEngine('human', 'brawler');
      let state = engine.getState();
      state.filterChoice = 'BREAK';
      state.currentRoomId = 'room_abandoned_border';
      state.player.roomId = 'room_abandoned_border';
      // Isolate border_patrol_01 from deserters for TALK check
      state.entities = state.entities.filter(
        (e) => e.roomId !== 'room_abandoned_border' || e.id === 'border_patrol_01',
      );
      for (const status of ['CITIZEN', 'ENVOY', 'CONVICT'] as const) {
        state.legalStatus = status;
        state.player.position = { x: 3, y: 1 };
        const patrol = getEntity(engine, 'border_patrol_01');
        patrol.position = { x: 4, y: 1 };
        patrol.hp = 80;
        patrol.provoked = false;
        const talkEv = engine.handleAction({ type: 'MOVE', direction: 'right' });
        assertEqual(patrol.hp, 80, `border_patrol_01 takes 0 damage on TALK for ${status}`);
        assert(
          talkEv.some((e) => e.type === 'NPC_TALKED' && e.entityId === 'border_patrol_01'),
          `NPC_TALKED emitted for ${status}`,
        );
      }

      // OUTLAW cannot TALK to border_patrol_01 -> attacks instead, and patrol is hostile to OUTLAW
      state.legalStatus = 'OUTLAW';
      state.player.position = { x: 3, y: 1 };
      const outlawClash = engine.handleAction({ type: 'MOVE', direction: 'right' });
      assert(
        outlawClash.some((e) => e.type === 'ATTACKED' && e.targetId === 'border_patrol_01'),
        'OUTLAW bumping border_patrol_01 attacks instead of TALK',
      );
      assert(
        outlawClash.some((e) => e.type === 'ENEMY_ATTACKED' && e.attackerId === 'border_patrol_01'),
        'border_patrol_01 retaliates against OUTLAW',
      );

      // 2. Tie-break prefers outlaw_deserter over OUTLAW player; natural AI clash drops loot without incrementing imperialRecord!
      engine.reset();
      state = engine.getState();
      state.filterChoice = 'BREAK';
      state.legalStatus = 'OUTLAW';
      state.currentRoomId = 'room_abandoned_border';
      state.player.roomId = 'room_abandoned_border';
      const patrol = getEntity(engine, 'border_patrol_01');
      const d1 = getEntity(engine, 'ruin_deserter_01');
      // Place player and d1 equidistant (dist 1) from patrol at (5, 2)
      patrol.position = { x: 5, y: 2 };
      d1.position = { x: 6, y: 2 };
      state.player.position = { x: 4, y: 2 };
      const tieTurn = engine.handleAction({ type: 'WAIT' });
      const npcHit = tieTurn.find(
        (e) =>
          e.type === 'NPC_ATTACKED_NPC' &&
          e.attackerId === 'border_patrol_01' &&
          e.targetId === 'ruin_deserter_01',
      );
      assert(npcHit !== undefined && npcHit.type === 'NPC_ATTACKED_NPC', 'border_patrol_01 prioritizes outlaw_deserter on distance tie');
      if (npcHit && npcHit.type === 'NPC_ATTACKED_NPC') {
        assertEqual(npcHit.damage, 15, 'border_patrol_01 deals 15 ATK');
        assert(npcHit.attackerPosition !== patrol.position, 'attackerPosition is cloned');
        assert(npcHit.targetPosition !== d1.position, 'targetPosition is cloned');
      }

      // Let patrol finish off d1 -> drops tax_penalty_writ, imperialRecord remains 0/0
      d1.hp = 10;
      const killTurn = engine.handleAction({ type: 'WAIT' });
      assert(
        killTurn.some((e) => e.type === 'ENTITY_DIED' && e.entityId === 'ruin_deserter_01'),
        'ruin_deserter_01 defeated by border_patrol_01',
      );
      assert(
        killTurn.some(
          (e) =>
            e.type === 'ITEM_DROPPED' &&
            e.itemId === 'tax_penalty_writ' &&
            e.entityId === 'ruin_deserter_01',
        ),
        'AI kill still drops tax_penalty_writ',
      );
      assertEqual(state.imperialRecord.guardsKilled, 0, 'AI kill does not increment guardsKilled');
      assertEqual(state.imperialRecord.civiliansKilled, 0, 'AI kill does not increment civiliansKilled');

      // Reverse case: deserter killing border_patrol_01 must NOT increment imperialRecord.guardsKilled!
      engine.reset();
      state = engine.getState();
      state.filterChoice = 'BREAK';
      state.legalStatus = 'CITIZEN';
      state.currentRoomId = 'room_abandoned_border';
      state.player.roomId = 'room_abandoned_border';
      state.player.position = { x: 1, y: 8 };
      const p2 = getEntity(engine, 'border_patrol_01');
      const deserterA = getEntity(engine, 'ruin_deserter_01');
      p2.position = { x: 5, y: 2 };
      p2.hp = 10;
      deserterA.position = { x: 6, y: 2 };
      deserterA.hp = 55;
      const guardKilledByAi = engine.handleAction({ type: 'WAIT' });
      assert(
        guardKilledByAi.some((e) => e.type === 'ENTITY_DIED' && e.entityId === 'border_patrol_01'),
        'deserter defeated low-HP border_patrol_01',
      );
      assertEqual(
        state.imperialRecord.guardsKilled,
        0,
        'border_patrol_01 killed by AI does NOT increment imperialRecord.guardsKilled',
      );

      // 3. hostile_deserter 2-beat Tier 7 dialogue (isRefuseTalk beat 1 -> contextual CONVICT/undead beat 2) + player killing outlaw_deserter leaves imperialRecord untouched
      engine.setBuildAndReset('undead_outsider', 'brawler');
      state = engine.getState();
      state.filterChoice = 'BREAK';
      state.legalStatus = 'CONVICT';
      state.currentRoomId = 'room_abandoned_border';
      state.player.roomId = 'room_abandoned_border';
      // Isolate ruin_deserter_02 at (7, 6)
      state.entities = state.entities.filter(
        (e) => e.roomId !== 'room_abandoned_border' || e.id === 'ruin_deserter_02',
      );
      state.player.position = { x: 3, y: 6 }; // dist 4 to (7, 6) -> move to (4, 6) dist 3 triggers beat 1
      const beat1Events = engine.handleAction({ type: 'MOVE', direction: 'right' });
      const warnEvent = beat1Events.find(
        (e) => e.type === 'DIALOGUE_SPOKEN' && e.entityId === 'ruin_deserter_02' && e.isRefuseTalk === true,
      );
      assert(warnEvent !== undefined && warnEvent.type === 'DIALOGUE_SPOKEN', 'Beat 1 emits isRefuseTalk warning at dist <= 4');
      if (warnEvent && warnEvent.type === 'DIALOGUE_SPOKEN') {
        assertEqual(warnEvent.legalStatus, 'CONVICT', 'Beat 1 carries legalStatus');
        assertEqual(warnEvent.raceId, 'undead_outsider', 'Beat 1 carries raceId');
      }
      assertEqual(getEntity(engine, 'ruin_deserter_02').hasWarnedPlayer, true, 'hasWarnedPlayer set true');

      // Step into melee clash -> Beat 2 emits contextual combat bark without isRefuseTalk!
      let beat2Found = false;
      for (let i = 0; i < 6 && !beat2Found; i++) {
        const evs = engine.handleAction({ type: 'MOVE', direction: 'right' });
        const bark = evs.find(
          (e) =>
            e.type === 'DIALOGUE_SPOKEN' &&
            e.entityId === 'ruin_deserter_02' &&
            e.isRefuseTalk !== true,
        );
        if (bark && bark.type === 'DIALOGUE_SPOKEN') {
          assertEqual(bark.legalStatus, 'CONVICT', 'Beat 2 carries CONVICT status');
          assertEqual(bark.raceId, 'undead_outsider', 'Beat 2 carries undead_outsider race');
          beat2Found = true;
        }
      }
      assert(beat2Found, 'Beat 2 contextual combat bark fired on clash without being swallowed by Beat 1');

      // Finish off ruin_deserter_02 -> drops border_ration_pack, imperialRecord still 0/0
      let finishGuard = 0;
      while (
        state.entities.some((e) => e.id === 'ruin_deserter_02') &&
        finishGuard < 10
      ) {
        engine.handleAction({ type: 'MOVE', direction: 'right' });
        finishGuard++;
      }
      assert(
        state.groundItems.some(
          (g) => g.roomId === 'room_abandoned_border' && g.itemId === 'border_ration_pack',
        ),
        'ruin_deserter_02 dropped border_ration_pack',
      );
      assertEqual(state.imperialRecord.guardsKilled, 0, 'killing outlaw_deserter does not increment guardsKilled');
      assertEqual(state.imperialRecord.civiliansKilled, 0, 'killing outlaw_deserter does not increment civiliansKilled');
    },
  },
  {
    name: 'Phase 7B v0.5.1: SUBMIT_RELIC_SHARD across all 4 Hub reps (6 branches + CONVICT exoneration) and all 9 Race x Class builds clearing room_abandoned_border & 4 Codex branches',
    run: () => {
      // 1. Verify all 6 rows of CURRENT_SPEC Section 3.4 + missing-shard guard
      const runSubmitCase = (cfg: {
        npcId: string;
        roomId: string;
        approachPos: { x: number; y: number };
        approachDir: 'up' | 'down' | 'left' | 'right';
        filterChoice: 'BREAK' | 'KEEP';
        legalStatus: 'CITIZEN' | 'ENVOY' | 'CONVICT' | 'OUTLAW';
        keepWorldRelic: boolean;
        expectedSilverReward: number;
        expectedEndingId: 'AWAKENED' | 'SOVEREIGN_PACT' | 'SUMMONER_BLADE';
        expectedClearedConvict: boolean;
      }): void => {
        const eng = new GameEngine('human', 'brawler');
        const st = eng.getState();
        st.filterChoice = cfg.filterChoice;
        st.legalStatus = cfg.legalStatus;
        st.silver = 10;
        st.currentRoomId = cfg.roomId;
        st.player.roomId = cfg.roomId;
        st.player.position = { ...cfg.approachPos };
        st.inventory = cfg.keepWorldRelic ? ['world_relic'] : [];

        // Open Hub menu WITHOUT shard -> SUBMIT_RELIC_SHARD must be rejected
        eng.handleAction({ type: 'MOVE', direction: cfg.approachDir });
        assertEqual(st.activeHubNpcId, cfg.npcId, `opened ${cfg.npcId}`);
        assertEqual(
          eng.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'SUBMIT_RELIC_SHARD' }).length,
          0,
          `${cfg.npcId} rejects SUBMIT_RELIC_SHARD without shard`,
        );

        // Give shard and submit
        st.inventory.push('shattered_relic_shard');
        const events = eng.handleAction({
          type: 'CHOOSE_HUB_ACTION',
          choice: 'SUBMIT_RELIC_SHARD',
        });
        assert(!st.inventory.includes('shattered_relic_shard'), `${cfg.npcId} consumes shattered_relic_shard`);
        assertEqual(st.activeHubNpcId, null, `${cfg.npcId} closes Hub menu on submit`);
        assertEqual(st.submittedShardNpcId, cfg.npcId, `submittedShardNpcId = ${cfg.npcId}`);
        assertEqual(st.silver, 10 + cfg.expectedSilverReward, `${cfg.npcId} awards +${cfg.expectedSilverReward} silver`);
        assertEqual(st.endingId, cfg.expectedEndingId, `${cfg.npcId} sets ending ${cfg.expectedEndingId}`);
        assertEqual(st.convictCleared, cfg.expectedClearedConvict, `${cfg.npcId} convictCleared=${cfg.expectedClearedConvict}`);
        if (cfg.expectedClearedConvict) {
          assertEqual(st.legalStatus, 'CITIZEN', 'CONVICT exonerated to CITIZEN');
        }
        assert(
          events.some(
            (e) =>
              e.type === 'RELIC_SHARD_SUBMITTED' &&
              e.entityId === cfg.npcId &&
              e.silverReward === cfg.expectedSilverReward &&
              e.remainingSilver === 10 + cfg.expectedSilverReward &&
              e.clearedConvictStatus === cfg.expectedClearedConvict &&
              e.endingId === cfg.expectedEndingId,
          ),
          `RELIC_SHARD_SUBMITTED payload matches for ${cfg.npcId}`,
        );
        assertLastEvent(
          events,
          { type: 'GAME_ENDED', endingId: cfg.expectedEndingId },
          `${cfg.npcId} emits GAME_ENDED last`,
        );
      };

      // Row 1: dwarf_smith_01 + ENVOY + world_relic -> +70, SOVEREIGN_PACT
      runSubmitCase({
        npcId: 'dwarf_smith_01',
        roomId: 'room_market_street',
        approachPos: { x: 4, y: 4 },
        approachDir: 'down',
        filterChoice: 'BREAK',
        legalStatus: 'ENVOY',
        keepWorldRelic: true,
        expectedSilverReward: 70,
        expectedEndingId: 'SOVEREIGN_PACT',
        expectedClearedConvict: false,
      });
      // Row 2a: dwarf_smith_01 + CITIZEN -> +60, AWAKENED
      runSubmitCase({
        npcId: 'dwarf_smith_01',
        roomId: 'room_market_street',
        approachPos: { x: 4, y: 4 },
        approachDir: 'down',
        filterChoice: 'BREAK',
        legalStatus: 'CITIZEN',
        keepWorldRelic: false,
        expectedSilverReward: 60,
        expectedEndingId: 'AWAKENED',
        expectedClearedConvict: false,
      });
      // Row 2b: dwarf_smith_01 + ENVOY without world_relic -> +60, AWAKENED
      runSubmitCase({
        npcId: 'dwarf_smith_01',
        roomId: 'room_market_street',
        approachPos: { x: 4, y: 4 },
        approachDir: 'down',
        filterChoice: 'BREAK',
        legalStatus: 'ENVOY',
        keepWorldRelic: false,
        expectedSilverReward: 60,
        expectedEndingId: 'AWAKENED',
        expectedClearedConvict: false,
      });
      // Row 3: beast_warden_01 + CONVICT -> 0 silver, convictCleared=true, CITIZEN, AWAKENED
      runSubmitCase({
        npcId: 'beast_warden_01',
        roomId: 'room_penal_outpost',
        approachPos: { x: 4, y: 3 },
        approachDir: 'down',
        filterChoice: 'BREAK',
        legalStatus: 'CONVICT',
        keepWorldRelic: false,
        expectedSilverReward: 0,
        expectedEndingId: 'AWAKENED',
        expectedClearedConvict: true,
      });
      // Row 4a: beast_warden_01 + CITIZEN -> +60, AWAKENED
      runSubmitCase({
        npcId: 'beast_warden_01',
        roomId: 'room_penal_outpost',
        approachPos: { x: 4, y: 3 },
        approachDir: 'down',
        filterChoice: 'BREAK',
        legalStatus: 'CITIZEN',
        keepWorldRelic: true,
        expectedSilverReward: 60,
        expectedEndingId: 'AWAKENED',
        expectedClearedConvict: false,
      });
      // Row 4b: beast_warden_01 + ENVOY + world_relic -> +70, SOVEREIGN_PACT
      runSubmitCase({
        npcId: 'beast_warden_01',
        roomId: 'room_penal_outpost',
        approachPos: { x: 4, y: 3 },
        approachDir: 'down',
        filterChoice: 'BREAK',
        legalStatus: 'ENVOY',
        keepWorldRelic: true,
        expectedSilverReward: 70,
        expectedEndingId: 'SOVEREIGN_PACT',
        expectedClearedConvict: false,
      });
      // Row 5a & 5b: sewer_broker_01 BREAK (+70) & KEEP (+60) -> SUMMONER_BLADE
      runSubmitCase({
        npcId: 'sewer_broker_01',
        roomId: 'room_outer_sewer',
        approachPos: { x: 2, y: 3 },
        approachDir: 'up',
        filterChoice: 'BREAK',
        legalStatus: 'OUTLAW',
        keepWorldRelic: false,
        expectedSilverReward: 70,
        expectedEndingId: 'SUMMONER_BLADE',
        expectedClearedConvict: false,
      });
      runSubmitCase({
        npcId: 'sewer_broker_01',
        roomId: 'room_outer_sewer',
        approachPos: { x: 2, y: 3 },
        approachDir: 'up',
        filterChoice: 'KEEP',
        legalStatus: 'OUTLAW',
        keepWorldRelic: false,
        expectedSilverReward: 60,
        expectedEndingId: 'SUMMONER_BLADE',
        expectedClearedConvict: false,
      });
      // Row 6a & 6b: sanctum_agent_01 BREAK (+70) & KEEP (+60) -> SUMMONER_BLADE
      runSubmitCase({
        npcId: 'sanctum_agent_01',
        roomId: 'room_outer_sewer',
        approachPos: { x: 5, y: 5 },
        approachDir: 'down',
        filterChoice: 'BREAK',
        legalStatus: 'OUTLAW',
        keepWorldRelic: false,
        expectedSilverReward: 70,
        expectedEndingId: 'SUMMONER_BLADE',
        expectedClearedConvict: false,
      });
      runSubmitCase({
        npcId: 'sanctum_agent_01',
        roomId: 'room_outer_sewer',
        approachPos: { x: 5, y: 5 },
        approachDir: 'down',
        filterChoice: 'KEEP',
        legalStatus: 'OUTLAW',
        keepWorldRelic: false,
        expectedSilverReward: 60,
        expectedEndingId: 'SUMMONER_BLADE',
        expectedClearedConvict: false,
      });

      // 2. All 9 Race x Class builds defeat ruin_deserter_02 in room_abandoned_border, collect shattered_relic_shard, return, and unlock all 4 Codex branches
      const races = ['human', 'dark_elf', 'undead_outsider'] as const;
      const classes = ['brawler', 'iron_vanguard', 'spellblade'] as const;
      const codexBranches: Array<{
        codexKey: string;
        filterChoice: 'BREAK' | 'KEEP';
        legalStatus: 'CITIZEN' | 'ENVOY' | 'OUTLAW';
        hubRoomId: string;
        npcPos: { x: number; y: number };
        npcDir: 'up' | 'down';
        expectedEnding: 'AWAKENED' | 'SOVEREIGN_PACT' | 'SUMMONER_BLADE';
      }> = [
        {
          codexKey: 'SUMMONER_BLADE',
          filterChoice: 'KEEP',
          legalStatus: 'OUTLAW',
          hubRoomId: 'room_outer_sewer',
          npcPos: { x: 5, y: 5 },
          npcDir: 'down',
          expectedEnding: 'SUMMONER_BLADE',
        },
        {
          codexKey: 'RULE_BREAKER',
          filterChoice: 'BREAK',
          legalStatus: 'OUTLAW',
          hubRoomId: 'room_outer_sewer',
          npcPos: { x: 2, y: 3 },
          npcDir: 'up',
          expectedEnding: 'SUMMONER_BLADE',
        },
        {
          codexKey: 'AWAKENED',
          filterChoice: 'BREAK',
          legalStatus: 'CITIZEN',
          hubRoomId: 'room_market_street',
          npcPos: { x: 4, y: 4 },
          npcDir: 'down',
          expectedEnding: 'AWAKENED',
        },
        {
          codexKey: 'SOVEREIGN_PACT',
          filterChoice: 'BREAK',
          legalStatus: 'ENVOY',
          hubRoomId: 'room_market_street',
          npcPos: { x: 4, y: 4 },
          npcDir: 'down',
          expectedEnding: 'SOVEREIGN_PACT',
        },
      ];

      const unlockedCodex = new Set<string>();
      let buildIndex = 0;
      for (const raceId of races) {
        for (const classId of classes) {
          const branch = codexBranches[buildIndex % codexBranches.length];
          buildIndex++;
          const eng = new GameEngine(raceId, classId);
          const st = eng.getState();
          st.filterChoice = branch.filterChoice;
          st.legalStatus = branch.legalStatus;
          st.hasAcceptedExpedition = true;
          st.currentRoomId = branch.hubRoomId;
          st.player.roomId = branch.hubRoomId;
          st.player.position = { x: 6, y: 3 };
          st.inventory = ['world_relic', 'border_ration_pack'];

          // Enter room_abandoned_border via East gate
          eng.handleAction({ type: 'MOVE', direction: 'right' });
          assertEqual(st.currentRoomId, 'room_abandoned_border', `${raceId}+${classId} entered border`);

          // Walk along safe southern route (1,4)->(1,8)->(8,8), engage and defeat ruin_deserter_02, pick up shard
          const dirs = [
            { dir: 'up' as const, dx: 0, dy: -1 },
            { dir: 'down' as const, dx: 0, dy: 1 },
            { dir: 'left' as const, dx: -1, dy: 0 },
            { dir: 'right' as const, dx: 1, dy: 0 },
          ];
          const stepToward = (tx: number, ty: number): void => {
            if (st.player.hp <= Math.floor(st.player.maxHp * 0.45) && st.inventory.includes('border_ration_pack')) {
              eng.handleAction({ type: 'USE_ITEM', itemId: 'border_ration_pack' });
              return;
            }
            for (const d of dirs) {
              const adj = st.entities.find(
                (e) =>
                  e.roomId === st.currentRoomId &&
                  e.hp > 0 &&
                  !e.isInteractableObject &&
                  e.position.x === st.player.position.x + d.dx &&
                  e.position.y === st.player.position.y + d.dy &&
                  (e.faction === 'outlaw_deserter' ||
                    st.legalStatus === 'OUTLAW' ||
                    st.filterChoice !== 'BREAK' ||
                    e.provoked),
              );
              if (adj) {
                if (
                  classId === 'iron_vanguard' &&
                  !st.isRiposteReady &&
                  adj.hp > eng.getEffectiveAttack(st.player)
                ) {
                  eng.handleAction({ type: 'WAIT' });
                } else {
                  eng.handleAction({ type: 'MOVE', direction: d.dir });
                }
                return;
              }
            }
            const gridSize = getRoomGridSize(st.currentRoomId);
            const goalKey = `${tx},${ty}`;
            const visited = new Set<string>([`${st.player.position.x},${st.player.position.y}`]);
            const queue: Array<{ x: number; y: number; firstDir: 'up' | 'down' | 'left' | 'right' }> = [];
            for (const d of dirs) {
              const nx = st.player.position.x + d.dx;
              const ny = st.player.position.y + d.dy;
              if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
              const key = `${nx},${ny}`;
              const tile = getTileType(st.currentRoomId, nx, ny);
              if (key !== goalKey && tile !== 'FLOOR') continue;
              if (key === goalKey && tile !== 'FLOOR' && tile !== 'DOOR') continue;
              if (
                st.entities.some(
                  (e) =>
                    e.roomId === st.currentRoomId &&
                    e.hp > 0 &&
                    e.isInteractableObject &&
                    e.position.x === nx &&
                    e.position.y === ny,
                )
              ) {
                continue;
              }
              visited.add(key);
              queue.push({ x: nx, y: ny, firstDir: d.dir });
            }
            while (queue.length > 0) {
              const cur = queue.shift()!;
              if (`${cur.x},${cur.y}` === goalKey) {
                eng.handleAction({ type: 'MOVE', direction: cur.firstDir });
                return;
              }
              for (const d of dirs) {
                const nx = cur.x + d.dx;
                const ny = cur.y + d.dy;
                const key = `${nx},${ny}`;
                if (visited.has(key) || nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
                const tile = getTileType(st.currentRoomId, nx, ny);
                if (key !== goalKey && tile !== 'FLOOR') continue;
                if (key === goalKey && tile !== 'FLOOR' && tile !== 'DOOR') continue;
                if (
                  st.entities.some(
                    (e) =>
                      e.roomId === st.currentRoomId &&
                      e.hp > 0 &&
                      e.isInteractableObject &&
                      e.position.x === nx &&
                      e.position.y === ny,
                  )
                ) {
                  continue;
                }
                visited.add(key);
                queue.push({ x: nx, y: ny, firstDir: cur.firstDir });
              }
            }
            eng.handleAction({ type: 'WAIT' });
          };

          let guard = 0;
          while (!st.inventory.includes('shattered_relic_shard') && !st.isGameOver && guard < 60) {
            stepToward(8, 8);
            guard++;
          }
          assert(
            st.inventory.includes('shattered_relic_shard'),
            `${raceId}+${classId} collected shattered_relic_shard`,
          );
          guard = 0;
          while (st.currentRoomId === 'room_abandoned_border' && !st.isGameOver && guard < 60) {
            stepToward(0, 4);
            guard++;
          }
          assertEqual(st.currentRoomId, branch.hubRoomId, `${raceId}+${classId} returned to ${branch.hubRoomId}`);
          assert(st.player.hp > 0, `${raceId}+${classId} survived border (HP: ${st.player.hp})`);

          st.player.position = { ...branch.npcPos };
          eng.handleAction({ type: 'MOVE', direction: branch.npcDir });
          eng.handleAction({ type: 'CHOOSE_HUB_ACTION', choice: 'SUBMIT_RELIC_SHARD' });
          assertEqual(st.endingId, branch.expectedEnding, `${raceId}+${classId} unlocked ${branch.codexKey}`);
          const resolvedCodex =
            st.endingId === 'SUMMONER_BLADE' && st.filterChoice === 'BREAK'
              ? 'RULE_BREAKER'
              : st.endingId;
          if (resolvedCodex) {
            unlockedCodex.add(resolvedCodex);
          }
        }
      }
      assertEqual(unlockedCodex.size, 4, 'all 4 Codex branches unlocked across the 9 builds');
    },
  },
];

for (const test of tests) {
  test.run();
  console.log(`PASS: ${test.name}`);
}

console.log(`\nALL ${tests.length} GAME ENGINE TEST SUITES PASSED`);
