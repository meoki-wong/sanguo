import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cityRevenues, createGame, decodeSave, eraByYear, forecastAttack } from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { coordinatedCombatModifiers, executeCoordinatedAttack, findCoordinatedAttackPlan } from "../dist/multi-siege.js";
import { formationCombatModifiers, getActiveFormation, setActiveFormation, trainOfficerSpecialty } from "../dist/formations.js";
import { courtFactionModifiers, currentCourtDebate, getCourtFactionsState, resolveCourtDebate } from "../dist/court-factions.js";
import { listActiveAdventures, spawnAdventures, visitAdventure } from "../dist/adventures.js";
import { shouldPauseAutoSim } from "../dist/auto-sim.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

function makeCenturyGame(year = 208, player = "cao") {
  return createGame(world, year, player, {
    realm: true, war: true, grand: true, landscape: true, statecraft: true,
    sandtable: true, frontline: true, highCommand: true, dynasty: true,
    strategic: true, reign: true, century: true,
  });
}

test("v21.0 multi-city coordinated siege finds multi-way flank and boosts forecastAttack", () => {
  const state = makeCenturyGame(208, "cao");
  state.turn = 2; // 跳过首季整军期
  state.factions.cao.grain = 400;
  const era = eraByYear(world, state);

  // 找一个至少有 2 座曹操相邻城的敌城
  const target = world.cities.find((c) => {
    if (state.cities[c.key]?.owner === "cao") return false;
    const adjCao = (c.links || []).filter((n) => state.cities[n]?.owner === "cao");
    return adjCao.length >= 2;
  });
  assert.ok(target);
  for (const n of target.links) {
    if (state.cities[n]?.owner === "cao") state.cities[n].troops = Math.max(state.cities[n].troops, 6000);
  }

  const plan = findCoordinatedAttackPlan(world, era, state, target.key, "cao");
  assert.equal(plan.ok, true);
  assert.ok(plan.ways >= 2);

  const res = executeCoordinatedAttack(world, era, state, plan);
  assert.equal(res.ok, true);
  assert.ok(coordinatedCombatModifiers(res.state, target.key).attackMult >= 1.12);
  assert.ok(coordinatedCombatModifiers(res.state, target.key).defenseMult <= 0.82);

  const leg = plan.legs[0];
  const withoutCoord = structuredClone(res.state);
  withoutCoord.saga.coordinatedTargets = {};
  const baseFc = forecastAttack(era, withoutCoord, { from: leg.from, to: target.key, officer: leg.officer.key, troops: leg.troops }, "cao");
  const coordFc = forecastAttack(era, res.state, { from: leg.from, to: target.key, officer: leg.officer.key, troops: leg.troops }, "cao");
  assert.ok(coordFc.offense > baseFc.offense);
  assert.ok(coordFc.defense < baseFc.defense);
});

test("v21.0 ancient formations counter-cycle and officer specialty training", () => {
  const state = makeCenturyGame(208, "cao");
  state.factions.cao.treasury = 300;
  state.factions.cao.grain = 300;
  const era = eraByYear(world, state);

  // 锋矢阵克制鹤翼阵，鱼鳞阵克制锋矢阵
  const s1 = setActiveFormation(state, "yulin", "cao");
  assert.equal(s1.ok, true);
  assert.equal(getActiveFormation(s1.state, "cao"), "yulin");
  const s2 = setActiveFormation(s1.state, "fengshi", "liu");
  assert.equal(s2.ok, true);

  const mod = formationCombatModifiers(s2.state, { attackerFaction: "cao", defenderFaction: "liu" });
  assert.ok(mod.attackMult >= 1.2);
  assert.ok(mod.label.includes("鱼鳞阵克制锋矢阵"));

  const officer = era.officers.find((o) => o.faction === "cao");
  const tr = trainOfficerSpecialty(era, s2.state, officer.key, "cavalry");
  assert.equal(tr.ok, true);
  assert.equal(tr.newGrade, "A");
});

test("v21.0 court factions balance, harmony bonus and imperial debate", () => {
  const state = makeCenturyGame(208, "cao");
  const xuchang = Object.keys(state.cities).find((k) => state.cities[k].owner === "cao");
  const revBefore = cityRevenues(state, xuchang);

  const debate = currentCourtDebate(state);
  const res = resolveCourtDebate(state, debate.id, debate.choices[debate.choices.length - 1].id);
  assert.equal(res.ok, true);
  const cf = getCourtFactionsState(res.state);
  assert.ok(cf.scores.warriors >= 0 && cf.scores.gentry >= 0 && cf.scores.kinsmen >= 0);

  // 强制进入上下同心态检验产出加成
  res.state.saga.courtFactions.scores = { warriors: 75, gentry: 75, kinsmen: 75 };
  assert.equal(getCourtFactionsState(res.state).harmony, true);
  assert.ok(courtFactionModifiers(res.state, "cao").ecoMult >= 1.1);
  assert.ok(cityRevenues(res.state, xuchang).treasury >= revBefore.treasury);
});

test("v21.0 Kyushu adventures spawn/visit and smart auto-sim pause checks", () => {
  const state = makeCenturyGame(208, "cao");
  state.factions.cao.treasury = 300;
  const seeded = spawnAdventures(world, state);
  const advs = listActiveAdventures(seeded);
  assert.ok(advs.length >= 2);

  const visited = visitAdventure(world, seeded, advs[0].id);
  assert.equal(visited.ok, true);
  assert.equal(listActiveAdventures(visited.state).length, advs.length - 1);
  assert.equal(decodeSave(world, JSON.stringify(visited.state)).year, 208);

  // 智能推演遇粮草告急自动暂停
  const lowGrain = structuredClone(visited.state);
  lowGrain.factions.cao.grain = 30;
  const pauseChk = shouldPauseAutoSim(world, lowGrain, visited.state);
  assert.equal(pauseChk.pause, true);
  assert.ok(pauseChk.reason.includes("军资告急"));
});
