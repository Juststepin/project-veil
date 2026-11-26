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
const GRID_SIZE = 8;

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

// 1. Validate maps.json geometry & door targets
if (maps) {
  for (const [roomId, room] of Object.entries(maps)) {
    if (!Array.isArray(room.layout) || room.layout.length !== GRID_SIZE) {
      fail('maps.json', `Room '${roomId}' layout must have exactly ${GRID_SIZE} rows.`);
      continue;
    }
    for (let y = 0; y < room.layout.length; y++) {
      if (typeof room.layout[y] !== 'string' || room.layout[y].length !== GRID_SIZE) {
        fail('maps.json', `Room '${roomId}' row ${y} must be a string of length ${GRID_SIZE}.`);
      }
    }
    if (!Array.isArray(room.doors) || room.doors.length === 0) {
      warn('maps.json', `Room '${roomId}' defines no doors.`);
      continue;
    }
    for (const door of room.doors) {
      const doorTile = tileAt(room, door.position);
      if (doorTile !== 'D') {
        fail(
          'maps.json',
          `Room '${roomId}' door at (${door.position?.x},${door.position?.y}) sits on '${doorTile}' instead of 'D'.`,
        );
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
}

// 2. Validate items.json dual perception & optional healAmount
const referencedItems = new Set();
if (items) {
  for (const [itemId, item] of Object.entries(items)) {
    checkDualPerception('items.json', itemId, item);
    if (item.healAmount !== undefined && (typeof item.healAmount !== 'number' || item.healAmount <= 0)) {
      fail('items.json', `Item '${itemId}' has invalid healAmount (${item.healAmount}).`);
    }
  }
}

// 3. Validate entities.json cross-references (rooms, tiles, drops, races, dual perception)
if (entities) {
  if (!entities.player) {
    fail('entities.json', "Missing required 'player' entity.");
  }
  const occupiedByRoom = new Map();

  for (const [entityId, entity] of Object.entries(entities)) {
    checkDualPerception('entities.json', entityId, entity);

    if (typeof entity.hp !== 'number' || typeof entity.maxHp !== 'number' || entity.hp <= 0 || entity.hp > entity.maxHp) {
      fail('entities.json', `Entity '${entityId}' has invalid hp/maxHp (${entity.hp}/${entity.maxHp}).`);
    }
    if (typeof entity.attack !== 'number' || entity.attack < 0) {
      fail('entities.json', `Entity '${entityId}' has invalid attack (${entity.attack}).`);
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
  }
}

// 4. Validate races.json & classes.json trait structure
for (const [filename, catalog] of [
  ['races.json', races],
  ['classes.json', classes],
]) {
  if (!catalog) continue;
  for (const [id, entry] of Object.entries(catalog)) {
    if (!entry.trait || typeof entry.trait.id !== 'string' || !entry.trait.name) {
      fail(filename, `Entry '${id}' must define a valid 'trait' object with id and name.`);
    }
    if (typeof entry.maxHpBonus !== 'number' || typeof entry.attackBonus !== 'number') {
      fail(filename, `Entry '${id}' must define numeric maxHpBonus and attackBonus.`);
    }
  }
}

// 5. Orphan check (observations)
if (items) {
  for (const itemId of Object.keys(items)) {
    if (!referencedItems.has(itemId)) {
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

console.log(
  `Data scan: ${summary.maps} maps, ${summary.entities} entities, ${summary.items} items, ` +
    `${summary.modifiers} modifiers, ${summary.races} races, ${summary.classes} classes.`,
);

for (const w of warnings) console.warn(w);
for (const e of errors) console.error(e);

if (errors.length > 0) {
  console.error(`\nFAILED: ${errors.length} data integrity error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}

console.log(`OK: src/data/*.json valid (${warnings.length} warning(s)).`);
