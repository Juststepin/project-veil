#!/usr/bin/env node
/**
 * Data integrity & cross-reference validator for Project VEIL (src/data/*.json).
 * Inspired by CCGS validate-assets.sh & validate-registry.sh:
 * emits concrete, path-scoped observations rather than opaque errors.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const dataDir = join(rootDir, 'src', 'data');
const ALLOWED_GRID_SIZES = new Set([8, 10]);

const errors = [];
const warnings = [];

function fail(file, message) {
  errors.push(`[ERROR] src/data/${file}: ${message}`);
}

function warn(file, message) {
  warnings.push(`[WARN]  src/data/${file}: ${message}`);
}

function loadJson(filename) {
  const fullPath = join(dataDir, filename);
  try {
    const raw = readFileSync(fullPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    fail(filename, `Invalid JSON — ${err.message}`);
    return null;
  }
}

function checkKeyIdParity(filename, catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    fail(filename, 'Top-level value must be a JSON object keyed by id.');
    return;
  }
  for (const [key, entry] of Object.entries(catalog)) {
    if (!entry || typeof entry !== 'object') {
      fail(filename, `Entry '${key}' must be an object.`);
      continue;
    }
    if (entry.id !== key) {
      fail(filename, `Key '${key}' does not match entry.id '${entry.id}'.`);
    }
  }
}

function checkDualPerception(filename, key, entry) {
  for (const layer of ['truth', 'illusion']) {
    const block = entry[layer];
    if (!block || typeof block !== 'object') {
      fail(filename, `Entry '${key}' is missing '${layer}' perception block.`);
      continue;
    }
    if (typeof block.name !== 'string' || block.name.trim() === '') {
      fail(filename, `Entry '${key}.${layer}.name' must be a non-empty string.`);
    }
  }
}

function tileAt(room, pos) {
  if (!room || !Array.isArray(room.layout)) return null;
  if (
    !pos ||
    typeof pos.x !== 'number' ||
    typeof pos.y !== 'number' ||
    pos.x < 0 ||
    pos.y < 0 ||
    pos.y >= room.layout.length ||
    pos.x >= room.layout[pos.y].length
  ) {
    return null;
  }
  return room.layout[pos.y][pos.x];
}

const maps = loadJson('maps.json');
const entities = loadJson('entities.json');
const items = loadJson('items.json');
const modifiers = loadJson('modifiers.json');
const races = loadJson('races.json');
const classes = loadJson('classes.json');

if (maps) checkKeyIdParity('maps.json', maps);
if (entities) checkKeyIdParity('entities.json', entities);
if (items) checkKeyIdParity('items.json', items);
if (modifiers) checkKeyIdParity('modifiers.json', modifiers);
if (races) checkKeyIdParity('races.json', races);
if (classes) checkKeyIdParity('classes.json', classes);

const referencedItems = new Set();

// 1. Validate maps.json geometry (8x8 / 10x10), dual perception names, doors & initialGroundItems
if (maps) {
  for (const [roomId, room] of Object.entries(maps)) {
    if (typeof room.name !== 'string' || room.name.trim() === '') {
      fail('maps.json', `Room '${roomId}.name' must be a non-empty string.`);
    }
    if (room.truth !== undefined || room.illusion !== undefined) {
      checkDualPerception('maps.json', roomId, room);
    }
    if (!Array.isArray(room.layout) || !ALLOWED_GRID_SIZES.has(room.layout.length)) {
      fail(
        'maps.json',
        `Room '${roomId}' layout must be square with size in [${[...ALLOWED_GRID_SIZES].join(', ')}] (got ${room.layout?.length}).`,
      );
      continue;
    }
    const gridSize = room.layout.length;
    for (let y = 0; y < gridSize; y++) {
      if (typeof room.layout[y] !== 'string' || room.layout[y].length !== gridSize) {
        fail('maps.json', `Room '${roomId}' row ${y} must be a string of length ${gridSize}.`);
      }
    }
    if (!Array.isArray(room.doors) || room.doors.length === 0) {
      warn('maps.json', `Room '${roomId}' defines no doors.`);
    } else {
      for (const door of room.doors) {
        if (door.isExpeditionGate !== undefined && typeof door.isExpeditionGate !== 'boolean') {
          fail('maps.json', `Room '${roomId}' door has non-boolean isExpeditionGate.`);
        }
        if (
          door.isExpeditionReturnGate !== undefined &&
          typeof door.isExpeditionReturnGate !== 'boolean'
        ) {
          fail('maps.json', `Room '${roomId}' door has non-boolean isExpeditionReturnGate.`);
        }
        const doorTile = tileAt(room, door.position);
        if (doorTile !== 'D') {
          fail(
            'maps.json',
            `Room '${roomId}' door at (${door.position?.x},${door.position?.y}) sits on '${doorTile}' instead of 'D'.`,
          );
        }
        const isDynamicGate =
          door.isExpeditionGate === true || door.isExpeditionReturnGate === true;
        if (isDynamicGate && door.targetRoomId === undefined && door.spawnPosition === undefined) {
          continue;
        }
        const targetRoom = maps[door.targetRoomId];
        if (!targetRoom) {
          fail('maps.json', `Room '${roomId}' door targets unknown room '${door.targetRoomId}'.`);
        } else {
          const spawnTile = tileAt(targetRoom, door.spawnPosition);
          if (spawnTile !== '.') {
            fail(
              'maps.json',
              `Room '${roomId}' door spawnPosition (${door.spawnPosition?.x},${door.spawnPosition?.y}) in '${door.targetRoomId}' is '${spawnTile}' (expected walkable '.').`,
            );
          }
        }
      }
    }

    if (room.initialGroundItems !== undefined) {
      if (!Array.isArray(room.initialGroundItems)) {
        fail('maps.json', `Room '${roomId}.initialGroundItems' must be an array.`);
      } else {
        for (const entry of room.initialGroundItems) {
          if (!entry || typeof entry !== 'object') {
            fail('maps.json', `Room '${roomId}.initialGroundItems' contains non-object entry.`);
            continue;
          }
          if (typeof entry.itemId !== 'string' || entry.itemId.trim() === '') {
            fail('maps.json', `Room '${roomId}.initialGroundItems' entry has invalid itemId.`);
          } else {
            referencedItems.add(entry.itemId);
            if (items && !items[entry.itemId]) {
              fail(
                'maps.json',
                `Room '${roomId}.initialGroundItems' references unknown itemId '${entry.itemId}'.`,
              );
            }
          }
          const itemTile = tileAt(room, entry.position);
          if (itemTile !== '.') {
            fail(
              'maps.json',
              `Room '${roomId}.initialGroundItems' item '${entry.itemId}' at (${entry.position?.x},${entry.position?.y}) sits on '${itemTile}' (expected walkable '.').`,
            );
          }
        }
      }
    }
  }
}

// 2. Validate modifiers.json numeric fields & non-empty text
if (modifiers) {
  for (const [modId, mod] of Object.entries(modifiers)) {
    if (typeof mod.name !== 'string' || mod.name.trim() === '') {
      fail('modifiers.json', `Modifier '${modId}.name' must be a non-empty string.`);
    }
    if (typeof mod.description !== 'string' || mod.description.trim() === '') {
      fail('modifiers.json', `Modifier '${modId}.description' must be a non-empty string.`);
    }
    for (const numField of ['attackBonus', 'maxHpBonus', 'instantHeal']) {
      if (typeof mod[numField] !== 'number' || !Number.isFinite(mod[numField])) {
        fail('modifiers.json', `Modifier '${modId}.${numField}' must be a finite number.`);
      }
    }
  }
}

// 3. Validate items.json dual perception, optional healAmount, buyPrice, isRelicShard & World Relic schema
if (items) {
  for (const [itemId, item] of Object.entries(items)) {
    checkDualPerception('items.json', itemId, item);
    for (const layer of ['truth', 'illusion']) {
      if (
        item[layer] &&
        (typeof item[layer].description !== 'string' || item[layer].description.trim() === '')
      ) {
        fail('items.json', `Item '${itemId}.${layer}.description' must be a non-empty string.`);
      }
    }
    if (item.healAmount !== undefined && (typeof item.healAmount !== 'number' || item.healAmount <= 0)) {
      fail('items.json', `Item '${itemId}' has invalid healAmount (${item.healAmount}).`);
    }
    if (
      item.buyPrice !== undefined &&
      (typeof item.buyPrice !== 'number' || !Number.isFinite(item.buyPrice) || item.buyPrice <= 0)
    ) {
      fail('items.json', `Item '${itemId}' has invalid buyPrice (${item.buyPrice}).`);
    }
    if (item.isRelicShard !== undefined && typeof item.isRelicShard !== 'boolean') {
      fail('items.json', `Item '${itemId}.isRelicShard' must be a boolean.`);
    }

    if (item.isWorldRelic !== undefined && typeof item.isWorldRelic !== 'boolean') {
      fail('items.json', `Item '${itemId}.isWorldRelic' must be a boolean.`);
    }

    const hasRelicFields =
      item.isWorldRelic === true ||
      item.dormant !== undefined ||
      item.keepDamage !== undefined ||
      item.keepHeal !== undefined ||
      item.breakModifierId !== undefined;

    if (hasRelicFields) {
      if (item.isWorldRelic !== true) {
        fail('items.json', `Item '${itemId}' defines World Relic fields without isWorldRelic: true.`);
      }
      if (!item.dormant || typeof item.dormant !== 'object') {
        fail('items.json', `World Relic '${itemId}' must define a 'dormant' perception block.`);
      } else {
        checkDualPerception('items.json', `${itemId}.dormant`, item.dormant);
        for (const layer of ['truth', 'illusion']) {
          if (
            item.dormant[layer] &&
            (typeof item.dormant[layer].description !== 'string' ||
              item.dormant[layer].description.trim() === '')
          ) {
            fail(
              'items.json',
              `Item '${itemId}.dormant.${layer}.description' must be a non-empty string.`,
            );
          }
        }
      }
      if (typeof item.keepDamage !== 'number' || !Number.isFinite(item.keepDamage) || item.keepDamage <= 0) {
        fail('items.json', `World Relic '${itemId}.keepDamage' must be a positive number.`);
      }
      if (typeof item.keepHeal !== 'number' || !Number.isFinite(item.keepHeal) || item.keepHeal <= 0) {
        fail('items.json', `World Relic '${itemId}.keepHeal' must be a positive number.`);
      }
      if (typeof item.breakModifierId !== 'string' || item.breakModifierId.trim() === '') {
        fail('items.json', `World Relic '${itemId}.breakModifierId' must be a non-empty string.`);
      } else if (modifiers && !modifiers[item.breakModifierId]) {
        fail(
          'items.json',
          `World Relic '${itemId}.breakModifierId' references unknown modifier '${item.breakModifierId}'.`,
        );
      }
    }
  }
}

const ALLOWED_FACTIONS = new Set([
  'civilian',
  'empire_guard',
  'sanctum',
  'outlaw_deserter',
  'neutral',
]);
const ALLOWED_AI_BEHAVIORS = new Set([
  'flee_when_hurt',
  'chase_and_attack',
  'guard_civilian',
  'checkpoint_boss',
  'inner_magistrate',
  'border_patrol',
  'hostile_deserter',
]);
const ALLOWED_HUB_ROLES = new Set([
  'market_smith',
  'penal_warden',
  'sewer_broker',
  'sanctum_agent',
]);
const ALLOWED_LEGAL_STATUS_KEYS = new Set(['CITIZEN', 'ENVOY', 'CONVICT', 'OUTLAW']);
const ALLOWED_SUBMIT_SHARD_KEYS = new Set(['truth', 'illusion', 'convict']);

// 4. Validate entities.json cross-references (rooms, tiles, drops, races, AI behaviors, hub NPCs, objects, dual perception)
if (entities) {
  if (!entities.player) {
    fail('entities.json', "Missing required 'player' entity.");
  }
  const occupiedByRoom = new Map();

  for (const [entityId, entity] of Object.entries(entities)) {
    checkDualPerception('entities.json', entityId, entity);
    if (entityId !== 'player') {
      for (const layer of ['truth', 'illusion']) {
        if (
          entity[layer] &&
          (typeof entity[layer].dialogue !== 'string' || entity[layer].dialogue.trim() === '')
        ) {
          fail('entities.json', `Entity '${entityId}.${layer}.dialogue' must be a non-empty string.`);
        }
      }
    }

    if (typeof entity.hp !== 'number' || typeof entity.maxHp !== 'number' || entity.hp <= 0 || entity.hp > entity.maxHp) {
      fail('entities.json', `Entity '${entityId}' has invalid hp/maxHp (${entity.hp}/${entity.maxHp}).`);
    }
    if (typeof entity.attack !== 'number' || entity.attack < 0) {
      fail('entities.json', `Entity '${entityId}' has invalid attack (${entity.attack}).`);
    }
    if (entity.faction !== undefined && !ALLOWED_FACTIONS.has(entity.faction)) {
      fail('entities.json', `Entity '${entityId}' has unsupported faction '${entity.faction}'.`);
    }
    if (entity.aiBehavior !== undefined && !ALLOWED_AI_BEHAVIORS.has(entity.aiBehavior)) {
      fail('entities.json', `Entity '${entityId}' has unsupported aiBehavior '${entity.aiBehavior}'.`);
    }
    if (entity.isHubNpc !== undefined && typeof entity.isHubNpc !== 'boolean') {
      fail('entities.json', `Entity '${entityId}.isHubNpc' must be a boolean.`);
    }
    if (
      entity.isInteractableObject !== undefined &&
      typeof entity.isInteractableObject !== 'boolean'
    ) {
      fail('entities.json', `Entity '${entityId}.isInteractableObject' must be a boolean.`);
    }
    if (entity.hubRole !== undefined) {
      if (!ALLOWED_HUB_ROLES.has(entity.hubRole)) {
        fail('entities.json', `Entity '${entityId}' has unsupported hubRole '${entity.hubRole}'.`);
      }
      if (entity.isHubNpc !== true) {
        fail('entities.json', `Entity '${entityId}' defines hubRole without isHubNpc: true.`);
      }
    }
    if (
      entity.refuseTalkDialogue !== undefined &&
      (typeof entity.refuseTalkDialogue !== 'string' || entity.refuseTalkDialogue.trim() === '')
    ) {
      fail('entities.json', `Entity '${entityId}.refuseTalkDialogue' must be a non-empty string.`);
    }
    if (entity.submitShardDialogue !== undefined) {
      if (
        !entity.submitShardDialogue ||
        typeof entity.submitShardDialogue !== 'object' ||
        Array.isArray(entity.submitShardDialogue)
      ) {
        fail('entities.json', `Entity '${entityId}.submitShardDialogue' must be an object.`);
      } else {
        if (
          typeof entity.submitShardDialogue.truth !== 'string' ||
          entity.submitShardDialogue.truth.trim() === ''
        ) {
          fail(
            'entities.json',
            `Entity '${entityId}.submitShardDialogue.truth' must be a non-empty string.`,
          );
        }
        for (const [key, line] of Object.entries(entity.submitShardDialogue)) {
          if (!ALLOWED_SUBMIT_SHARD_KEYS.has(key)) {
            fail(
              'entities.json',
              `Entity '${entityId}.submitShardDialogue' has unsupported key '${key}'.`,
            );
          }
          if (typeof line !== 'string' || line.trim() === '') {
            fail(
              'entities.json',
              `Entity '${entityId}.submitShardDialogue.${key}' must be a non-empty string.`,
            );
          }
        }
      }
    }

    if (maps) {
      const room = maps[entity.roomId];
      if (!room) {
        fail('entities.json', `Entity '${entityId}' references unknown roomId '${entity.roomId}'.`);
      } else {
        const tile = tileAt(room, entity.startPosition);
        if (tile !== '.') {
          fail(
            'entities.json',
            `Entity '${entityId}' startPosition (${entity.startPosition?.x},${entity.startPosition?.y}) in '${entity.roomId}' is '${tile}' (expected walkable '.').`,
          );
        }
        const posKey = `${entity.roomId}:${entity.startPosition?.x},${entity.startPosition?.y}`;
        if (occupiedByRoom.has(posKey)) {
          fail(
            'entities.json',
            `Entity '${entityId}' overlaps startPosition with '${occupiedByRoom.get(posKey)}' at ${posKey}.`,
          );
        } else {
          occupiedByRoom.set(posKey, entityId);
        }
      }
    }

    if (entity.dropItemId !== undefined) {
      referencedItems.add(entity.dropItemId);
      if (items && !items[entity.dropItemId]) {
        fail('entities.json', `Entity '${entityId}' references unknown dropItemId '${entity.dropItemId}'.`);
      }
    }

    if (entity.raceTalkDialogue && typeof entity.raceTalkDialogue === 'object' && races) {
      for (const raceKey of Object.keys(entity.raceTalkDialogue)) {
        if (!races[raceKey]) {
          fail('entities.json', `Entity '${entityId}' raceTalkDialogue references unknown race '${raceKey}'.`);
        }
      }
    }

    if (entity.statusTalkDialogue !== undefined) {
      if (!entity.statusTalkDialogue || typeof entity.statusTalkDialogue !== 'object' || Array.isArray(entity.statusTalkDialogue)) {
        fail('entities.json', `Entity '${entityId}.statusTalkDialogue' must be an object.`);
      } else {
        for (const [statusKey, line] of Object.entries(entity.statusTalkDialogue)) {
          if (!ALLOWED_LEGAL_STATUS_KEYS.has(statusKey)) {
            fail('entities.json', `Entity '${entityId}.statusTalkDialogue' has unsupported status key '${statusKey}'.`);
          }
          if (typeof line !== 'string' || line.trim() === '') {
            fail('entities.json', `Entity '${entityId}.statusTalkDialogue.${statusKey}' must be a non-empty string.`);
          }
        }
      }
    }
  }
}

// 5. Validate races.json & classes.json trait structure & numeric modifiers
const ALLOWED_TRAIT_KEYS = new Set([
  'id',
  'name',
  'description',
  'healBonus',
  'lucidityGainBonus',
  'maxTriggersPerTurn',
  'flatDamageReduction',
  'comboBonusDamage',
  'waitDamageMultiplier',
  'riposteBonusDamage',
  'fullHpBonusDamage',
]);

const POSITIVE_NUMERIC_TRAIT_KEYS = [
  'healBonus',
  'lucidityGainBonus',
  'flatDamageReduction',
  'comboBonusDamage',
  'riposteBonusDamage',
  'fullHpBonusDamage',
];

for (const [filename, catalog] of [
  ['races.json', races],
  ['classes.json', classes],
]) {
  if (!catalog) continue;
  for (const [id, entry] of Object.entries(catalog)) {
    if (
      !entry.trait ||
      typeof entry.trait !== 'object' ||
      typeof entry.trait.id !== 'string' ||
      !entry.trait.name ||
      typeof entry.trait.description !== 'string' ||
      entry.trait.description.trim() === ''
    ) {
      fail(
        filename,
        `Entry '${id}' must define a valid 'trait' object with id, name, and non-empty description.`,
      );
    } else {
      for (const traitKey of Object.keys(entry.trait)) {
        if (!ALLOWED_TRAIT_KEYS.has(traitKey)) {
          fail(filename, `Entry '${id}.trait' contains unsupported key '${traitKey}'.`);
        }
      }
      for (const numKey of POSITIVE_NUMERIC_TRAIT_KEYS) {
        const val = entry.trait[numKey];
        if (val !== undefined && (typeof val !== 'number' || !Number.isFinite(val) || val <= 0)) {
          fail(filename, `Entry '${id}.trait.${numKey}' must be a positive number (got ${val}).`);
        }
      }
      if (entry.trait.maxTriggersPerTurn !== undefined) {
        const cap = entry.trait.maxTriggersPerTurn;
        if (!Number.isInteger(cap) || cap < 1) {
          fail(
            filename,
            `Entry '${id}.trait.maxTriggersPerTurn' must be an integer >= 1 (got ${cap}).`,
          );
        }
      }
      if (entry.trait.waitDamageMultiplier !== undefined) {
        const mult = entry.trait.waitDamageMultiplier;
        if (typeof mult !== 'number' || !Number.isFinite(mult) || mult <= 0 || mult > 1) {
          fail(
            filename,
            `Entry '${id}.trait.waitDamageMultiplier' must be a number in (0, 1] (got ${mult}).`,
          );
        }
      }
    }
    if (typeof entry.maxHpBonus !== 'number' || typeof entry.attackBonus !== 'number') {
      fail(filename, `Entry '${id}' must define numeric maxHpBonus and attackBonus.`);
    }
  }
}

// 6. Orphan check (observations)
if (items) {
  for (const [itemId, item] of Object.entries(items)) {
    if (!referencedItems.has(itemId) && item.isWorldRelic !== true && item.buyPrice === undefined) {
      warn('items.json', `Item '${itemId}' is not dropped by any entity in entities.json (verify if spawned by code).`);
    }
  }
}

const summary = {
  maps: maps ? Object.keys(maps).length : 0,
  entities: entities ? Object.keys(entities).length : 0,
  items: items ? Object.keys(items).length : 0,
  modifiers: modifiers ? Object.keys(modifiers).length : 0,
  races: races ? Object.keys(races).length : 0,
  classes: classes ? Object.keys(classes).length : 0,
};

const nonPlayerEntries = entities
  ? Object.entries(entities).filter(([id]) => id !== 'player')
  : [];
const objectCount = nonPlayerEntries.filter(
  ([, entry]) => entry && entry.isInteractableObject === true,
).length;
const npcCount = nonPlayerEntries.length - objectCount;
const entityDetail =
  entities && entities.player
    ? objectCount > 0
      ? `${summary.entities} entities (1 player + ${npcCount} NPCs + ${objectCount} object${objectCount > 1 ? 's' : ''})`
      : `${summary.entities} entities (1 player + ${npcCount} NPCs)`
    : `${summary.entities} entities`;

console.log(
  `Data scan: ${summary.maps} maps, ${entityDetail}, ${summary.items} items, ` +
    `${summary.modifiers} modifiers, ${summary.races} races, ${summary.classes} classes.`,
);

for (const w of warnings) console.warn(w);
for (const e of errors) console.error(e);

if (errors.length > 0) {
  console.error(`\nFAILED: ${errors.length} data integrity error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}

console.log(`OK: src/data/*.json valid (${warnings.length} warning(s)).`);
