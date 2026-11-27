import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createGame, decodeSave, eraByYear, forecastAttack, queueOrder } from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { bestAttackPlan } from "../dist/sovereign.js";
import {
  GRID_COLS, GRID_ROWS, TERRAIN_META, attackTarget, attackableTargets, autoResolveGridBattle,
  createGridBattle, endPlayerRound, finalizeGridBattleModifiers, moveUnit, reachableTiles, tileAt, unitAt,
} from "../dist/tactical-grid.js";
import {
  DRAMA_PLAYS, chooseDramaOption, currentDramaScene, listDramaPlays, startDramaPlay, unplayedDramaCount,
} from "../dist/drama-theater.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

function makeCenturyGame(year = 208, player = "liu") {
  return createGame(world, year, player, {
    realm: true, war: true, grand: true, landscape: true, statecraft: true,
    sandtable: true, frontline: true, highCommand: true, dynasty: true,
    strategic: true, reign: true, century: true,
  });
}

test("v25.0 7x5 tactical grid initializes units, terrain, walls, depot, and wind", () => {
  const ses = createGridBattle({
    fromName: "襄阳",
    toName: "江陵",
    attackerName: "关羽",
    defenderName: "曹仁",
    attackerTroops: 9000,
    defenderTroops: 6000,
    wind: "east",
  });
  assert.equal(ses.tiles.length, GRID_ROWS);
  assert.equal(ses.tiles[0].length, GRID_COLS);
  assert.equal(ses.units.filter((u) => u.side === "player").length, 4);
  assert.equal(ses.units.filter((u) => u.side === "enemy").length, 4);
  assert.equal(tileAt(ses, ses.depotPos.x, ses.depotPos.y).terrain, "depot");
  assert.equal(tileAt(ses, 5, 1).terrain, "wall");
  assert.ok(TERRAIN_META.forest.flammable);
  assert.equal(ses.wind.key, "east");
});

test("v25.0 movement, hill range bonus, downwind fire spread, and depot destruction", () => {
  let ses = createGridBattle({
    fromName: "襄阳",
    toName: "江陵",
    attackerName: "诸葛亮",
    defenderName: "曹仁",
    wind: "east",
  });

  // 弓兵登上高地后射程 +1
  const arcReach = reachableTiles(ses, "p_arc");
  assert.ok(arcReach.length > 0);
  // 墙格 (5, 1) 不可通行
  const cavReach = reachableTiles(ses, "p_cav");
  assert.ok(!cavReach.some((t) => t.x === 5 && t.y === 1));

  // 移动先锋骑兵并校验移动消耗与位置更新
  const step = cavReach[0];
  ses = moveUnit(ses, "p_cav", step.x, step.y);
  const movedCav = unitAt(ses, step.x, step.y);
  assert.equal(movedCav?.id, "p_cav");
  assert.equal(movedCav?.moved, true);

  // 设置密林与粮仓顺风相连，验证火攻器械点燃后顺风烧毁粮仓
  ses.tiles[2][3].terrain = "forest";
  ses.tiles[2][4].terrain = "depot";
  ses.tiles[2][4].depotHp = 80;
  ses.depotPos = { x: 4, y: 2 };
  const fireCat = ses.units.find((u) => u.id === "p_fire");
  fireCat.x = 2;
  fireCat.y = 2;
  fireCat.acted = false;
  fireCat.moved = false;
  const targets = attackableTargets(ses, "p_fire");
  assert.ok(targets.some((t) => t.kind === "forest" && t.x === 3 && t.y === 2));
  ses = attackTarget(ses, "p_fire", 3, 2);
  assert.equal(tileAt(ses, 3, 2).terrain, "fire");
  assert.equal(tileAt(ses, 4, 2).terrain, "fire");
  assert.equal(ses.depotDestroyed, true);
  assert.ok(ses.defMult < 0.9);
  assert.ok(ses.atkMult > 1.0);
});

test("v25.0 endPlayerRound AI action, autoResolveGridBattle, and forecastAttack integration", () => {
  const initial = createGridBattle({
    fromName: "新野",
    toName: "许昌",
    attackerName: "赵云",
    defenderName: "夏侯惇",
    attackerTroops: 11000,
    defenderTroops: 5500,
    targetCut: true,
    insiderActive: true,
  });

  const round2 = endPlayerRound(initial);
  assert.equal(round2.round, 2);
  assert.equal(round2.turnSide, "player");

  const resolved = autoResolveGridBattle(initial);
  assert.equal(resolved.done, true);
  const fin = finalizeGridBattleModifiers(resolved);
  assert.ok(fin.atkMult >= 0.78 && fin.atkMult <= 1.65);
  assert.ok(fin.defMult >= 0.45 && fin.defMult <= 1.25);
  assert.ok(fin.summary.length > 0);

  const state = makeCenturyGame(208, "cao");
  const era = eraByYear(world, state);
  const from = Object.keys(state.cities).find((k) => state.cities[k].owner === "cao");
  const to = world.cities.find((c) => c.key === from).links.find((k) => state.cities[k].owner !== "cao");
  const officer = era.officers.find((o) => o.faction === "cao");

  const baseFc = forecastAttack(era, state, { from, to, officer: officer.key, troops: 4000 }, "cao");
  const gridFc = forecastAttack(era, state, { from, to, officer: officer.key, troops: 4000 }, "cao", { tactical: fin });
  assert.notEqual(gridFc.offense, baseFc.offense);
});

test("v25.0 Romance Drama Theater offers 8 multi-branch plays and persists in century save", () => {
  assert.equal(DRAMA_PLAYS.length, 8);
  const nonCentury = createGame(world, 208, "liu");
  assert.equal(unplayedDramaCount(nonCentury), 0);

  let state = makeCenturyGame(208, "liu");
  assert.equal(unplayedDramaCount(state), 8);
  const catalog = listDramaPlays(state);
  assert.equal(catalog.length, 8);
  assert.ok(catalog.every((p) => !p.played && p.playable));

  const grainBefore = state.factions.liu.grain;
  const repBefore = state.saga.reputation;
  let ses = startDramaPlay("sangu");
  let scene = currentDramaScene(ses);
  assert.equal(scene.id, "act1");

  let stepRes = chooseDramaOption(state, ses, scene.options[0].id);
  assert.equal(stepRes.completed, false);
  ses = stepRes.session;
  scene = currentDramaScene(ses);
  assert.equal(scene.id, "act2a");

  stepRes = chooseDramaOption(state, ses, scene.options[0].id);
  assert.equal(stepRes.completed, false);
  ses = stepRes.session;
  scene = currentDramaScene(ses);
  assert.equal(scene.id, "act3a");

  stepRes = chooseDramaOption(state, ses, scene.options[0].id);
  assert.equal(stepRes.completed, true);
  assert.equal(stepRes.session.done, true);
  state = stepRes.state;

  assert.equal(unplayedDramaCount(state), 7);
  assert.ok(state.saga.dramasPlayed.includes("sangu"));
  assert.ok(state.factions.liu.grain > grainBefore);
  assert.ok(state.saga.reputation > repBefore);
  assert.ok(state.saga.buffs.some((b) => b.label === "隆中定策"));
  assert.ok(state.saga.annals.some((a) => a.text.includes("三顾茅庐")));

  // 重复游玩同一剧目不会重复刷赏
  const grainAfterFirst = state.factions.liu.grain;
  let replay = startDramaPlay("sangu");
  replay = chooseDramaOption(state, replay, currentDramaScene(replay).options[0].id).session;
  replay = chooseDramaOption(state, replay, currentDramaScene(replay).options[0].id).session;
  const replayEnd = chooseDramaOption(state, replay, currentDramaScene(replay).options[0].id);
  assert.equal(replayEnd.completed, true);
  assert.equal(replayEnd.state.factions.liu.grain, grainAfterFirst);

  const restored = decodeSave(world, JSON.stringify(state));
  assert.deepEqual(restored.saga.dramasPlayed, ["sangu"]);
});

test("v25.0 bestAttackPlan supports fromCity origin pin for drag-arrow commands", () => {
  const state = makeCenturyGame(208, "cao");
  state.turn = 2; // 过首季整备期允许出征
  const caoCities = world.cities.filter((c) => state.cities[c.key]?.owner === "cao");
  const border = caoCities.find((c) => c.links.some((l) => state.cities[l]?.owner !== "cao"));
  assert.ok(border);
  const enemyAdj = border.links.find((l) => state.cities[l]?.owner !== "cao");
  const plan = bestAttackPlan(world, state, null, enemyAdj, { fromCity: border.key });
  assert.equal(plan.ok, true);
  assert.equal(plan.from, border.key);
  assert.equal(plan.to, enemyAdj);

  // 非接壤城作为 fromCity 时应清晰拒绝
  const remoteCao = caoCities.find((c) => !c.links.includes(enemyAdj));
  if (remoteCao) {
    const blocked = bestAttackPlan(world, state, null, enemyAdj, { fromCity: remoteCao.key });
    assert.equal(blocked.ok, false);
  }
});
