import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { enrichWorld } from "../dist/personnel.js";
import { formatCalendar, troopCounterEffect } from "../dist/v2/constants.js";
import {
  advanceDekad, availableOfficersInCity, checkSupplyLine, computeThreats,
  createGameV2, deserializeStateV2, dispatchArmy, dispatchEmergencyReinforce,
  executeDiplomacy, isHostileV2, layCityTrap, redirectArmy, resolveCaptive, rewardOfficer,
  serializeStateV2, setCityPolicy, setCitySiegeDefense, setCityTroopType,
} from "../dist/v2/engine.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

test("所有 11 个史实剧本均可在 2.0 引擎正常建局并初始化 44 城", () => {
  assert.equal(world.scenarios.length, 11);
  for (const sc of world.scenarios) {
    const f = sc.factions[0].key;
    const st = createGameV2(world, sc.year, f);
    assert.equal(st.version, 2);
    assert.equal(st.turn, 0);
    assert.equal(Object.keys(st.cities).length, 44);
    assert.ok(Object.keys(st.officers).length >= 25);
    assert.equal(st.outcome, "ongoing");
  }
});

test("旬制日历与月度/季度自动结算节奏正确", () => {
  assert.equal(formatCalendar(199, 0).label, "199年1月上旬");
  assert.equal(formatCalendar(199, 1).label, "199年1月中旬");
  assert.equal(formatCalendar(199, 2).label, "199年1月下旬");
  assert.equal(formatCalendar(199, 3).label, "199年2月上旬");
  assert.equal(formatCalendar(199, 36).label, "200年1月上旬");

  let st = createGameV2(world, 199, "cao");
  const baseGold = st.factions.cao.treasury;
  st = setCityPolicy(st, "xu", "commerce");
  st = advanceDekad(world, st, { skipAi: true }); // 1中
  st = advanceDekad(world, st, { skipAi: true }); // 1下
  assert.equal(st.turn, 2);
  assert.equal(st.factions.cao.treasury, baseGold, "非月末不提前结算月度税赋");
  st = advanceDekad(world, st, { skipAi: true }); // 2上 (turn=3 -> monthly tick)
  assert.ok(st.factions.cao.treasury > baseGold, "第3旬自动完成月度钱粮兵源结算");
});

test("在途军团真实沿官道行军，不可一回合瞬移秒攻坚城", () => {
  let st = createGameV2(world, 199, "cao");
  // Find a player border city adjacent to enemy
  const fromKey = "xu";
  const toKey = "runan";
  // Ensure runan belongs to yuan or another enemy for test determinism
  st.cities.runan.owner = "biao";
  st.cities.runan.troops = 1400;
  st.cities.runan.wall = 500;
  st.cities.xu.troops = 2600;
  const off = availableOfficersInCity(st, fromKey, "cao")[0];
  assert.ok(off);

  st = dispatchArmy(world, st, {
    from: fromKey,
    to: toKey,
    officer: off.key,
    troops: 1400,
    troopType: "infantry",
    siegeStance: "storm",
  });
  assert.equal(st.armies.length, 1);
  assert.equal(st.armies[0].stance, "attack");
  assert.ok(st.armies[0].progress < 0.2, "出征瞬间处于起点官道，未抵达目标城");

  st = advanceDekad(world, st, { skipAi: true });
  assert.equal(st.cities.runan.owner, "biao", "行军第一旬不可一回合瞬移攻克");
  assert.ok(st.armies[0].progress > 0.2);

  // Advance until arrival & siege begins
  for (let i = 0; i < 4 && st.armies[0]?.stance === "attack"; i += 1) {
    st = advanceDekad(world, st, { skipAi: true });
  }
  assert.equal(st.armies[0].stance, "besiege", "大军抵城后转入多回合围城状态");
  assert.ok(st.sieges.runan, "建立跨回合围城对峙记录");
  assert.equal(st.cities.runan.owner, "biao", "有城防与守军的城池需经数旬消耗方可攻克");
});

test("五大兵种相克、地形加权及野战官道截击有效", () => {
  const cCavVsArch = troopCounterEffect("cavalry", "archer", "plain", null);
  const cInfVsCav = troopCounterEffect("infantry", "cavalry", "plain", null);
  const cArchVsInf = troopCounterEffect("archer", "infantry", "plain", null);
  const cNavyRiver = troopCounterEffect("navy", "infantry", "river", { riverMult: 1.2 });
  assert.ok(cCavVsArch.mult > 1.3 && cCavVsArch.relation === "counter");
  assert.ok(cInfVsCav.mult >= 1.2 && cInfVsCav.relation === "counter");
  assert.ok(cArchVsInf.mult >= 1.2 && cArchVsInf.relation === "counter");
  assert.ok(cNavyRiver.mult >= 1.35);

  // Road clash: two opposing armies marching on xu <-> runan
  let st = createGameV2(world, 199, "cao");
  st.cities.runan.owner = "biao";
  st.cities.xu.troops = 3000;
  st.cities.runan.troops = 2600;
  const caoOff = availableOfficersInCity(st, "xu", "cao")[0];
  let biaoOff = availableOfficersInCity(st, "runan", "biao")[0];
  if (!biaoOff) {
    // Move one biao officer into runan for test
    const anyBiao = Object.values(st.officers).find((o) => o.faction === "biao" && !o.armyId);
    anyBiao.city = "runan";
    biaoOff = anyBiao;
  }

  st = dispatchArmy(world, st, { from: "xu", to: "runan", officer: caoOff.key, troops: 1500, troopType: "cavalry" });
  // Manually inject hostile army marching opposite way on runan -> xu
  st.armies.push({
    id: "army-test-enemy",
    faction: "biao",
    officer: biaoOff.key,
    troops: 1200,
    maxTroops: 1200,
    troopType: "archer",
    morale: 80,
    grain: 20,
    route: ["runan", "xu"],
    step: 0,
    from: "runan",
    to: "xu",
    targetCity: "xu",
    depot: "runan",
    progress: 0.45,
    edgeDekads: 2,
    stance: "attack",
    siegeStance: "storm",
    supplyCut: false,
    reorgDekads: 0,
  });
  biaoOff.armyId = "army-test-enemy";

  let clashed = false;
  for (let i = 0; i < 3; i += 1) {
    st = advanceDekad(world, st, { skipAi: true });
    if (st.lastTurnEvents.some((e) => e.kind === "field_battle")) {
      clashed = true;
      break;
    }
  }
  assert.ok(clashed, "迎面行军的两支敌对军团在官道中途爆发野战截击");
});

test("粮道切断判定、城外陷阱触发、解围战与攻城破城闭环", () => {
  let st = createGameV2(world, 199, "cao");
  st.cities.chenliu.troops = 2500;
  st.cities.luoyang.owner = "yuan";
  st.cities.luoyang.troops = 1100;
  st.cities.luoyang.wall = 220;
  st.cities.luoyang.foodReserve = 60;

  // Test supply line severing when depot falls to enemy
  const caoOff = availableOfficersInCity(st, "chenliu", "cao")[0];
  st = dispatchArmy(world, st, { from: "chenliu", to: "luoyang", officer: caoOff.key, troops: 1600, troopType: "siege" });
  assert.equal(checkSupplyLine(world, st, st.armies[0]), true);
  st.cities.chenliu.owner = "yuan"; // Simulate depot behind captured!
  assert.equal(checkSupplyLine(world, st, st.armies[0]), false, "后方粮仓失陷后立刻判定粮道断绝");
  st.cities.chenliu.owner = "cao";

  // Test trap triggering on player's defended city
  st = layCityTrap(st, "xu", "fire_pit");
  assert.equal(st.cities.xu.trap.id, "fire_pit");
  st.armies.push({
    id: "army-test-raider",
    faction: "biao",
    officer: Object.values(st.officers).find((o) => o.faction === "biao" && !o.armyId).key,
    troops: 1000,
    maxTroops: 1000,
    troopType: "infantry",
    morale: 85,
    grain: 20,
    route: ["xinye", "xu"],
    step: 0,
    from: "xinye",
    to: "xu",
    targetCity: "xu",
    depot: "xinye",
    progress: 0.85,
    edgeDekads: 2,
    stance: "attack",
    siegeStance: "storm",
    supplyCut: false,
    reorgDekads: 0,
  });

  st = setCitySiegeDefense(st, "xu", "hold");
  let trapFired = false;
  let capturedLuoyang = false;
  for (let i = 0; i < 10; i += 1) {
    st = advanceDekad(world, st, { skipAi: true });
    if (st.lastTurnEvents.some((e) => e.kind === "trap")) trapFired = true;
    if (st.cities.luoyang.owner === "cao") capturedLuoyang = true;
  }
  assert.ok(trapFired, "火油陷坑在敌军临城时真实引爆");
  assert.ok(capturedLuoyang, "攻城械经过多旬围攻成功摧毁城防并占领洛阳");
});

test("一键邻城解围、外交合击、封赏名将、俘将处置与存档序列化", () => {
  let st = createGameV2(world, 199, "cao");
  st.factions.cao.treasury = 300;
  st.factions.cao.grain = 400;

  // Test set troop type & emergency reinforce
  st = setCityTroopType(st, "puyang", "cavalry");
  assert.equal(st.cities.puyang.troopType, "cavalry");
  st.cities.chenliu.troops = 2600;
  st.cities.xu.troops = 900;
  st = dispatchEmergencyReinforce(world, st, "xu");
  assert.ok(st.armies.some((a) => a.stance === "reinforce" && a.targetCity === "xu"));

  // Test alliance + joint attack spawning ally road army!
  st = executeDiplomacy(world, st, "biao", "alliance");
  const biaoBorderTarget = world.cities.find((c) => isHostileV2(st, "biao", st.cities[c.key].owner)
    && c.links.some((nb) => st.cities[nb].owner === "biao" && st.cities[nb].troops >= 1000))?.key;
  if (biaoBorderTarget) {
    const beforeCount = st.armies.length;
    st = executeDiplomacy(world, st, "biao", "joint_attack", { targetCityKey: biaoBorderTarget });
    assert.ok(st.armies.some((a) => a.faction === "biao" && a.targetCity === biaoBorderTarget), "盟约合击立即生成盟友真实行军军团");
    assert.equal(st.armies.length, beforeCount + 1);
  }

  // Test officer reward & captive release
  const anyCao = Object.values(st.officers).find((o) => o.faction === "cao");
  anyCao.loyalty = 70;
  st = rewardOfficer(st, anyCao.key);
  assert.equal(st.officers[anyCao.key].loyalty, 84);

  const biaoCap = Object.values(st.officers).find((o) => o.faction === "biao" && !o.armyId);
  biaoCap.capturedBy = "cao";
  st.captives.push({ officer: biaoCap.key, origFaction: "biao", turn: st.turn, city: "wan" });
  st = resolveCaptive(st, biaoCap.key, "recruit");
  assert.equal(st.officers[biaoCap.key].faction, "cao");
  assert.equal(st.captives.length, 0);

  // Test redirect army to retreat & computeThreats
  const myArmy = st.armies.find((a) => a.faction === "cao");
  st = redirectArmy(world, st, myArmy.id, { stance: "retreat" });
  assert.equal(st.armies.find((a) => a.id === myArmy.id).stance, "retreat");
  assert.ok(Array.isArray(computeThreats(world, st)));

  // Save/load round-trip
  const restored = deserializeStateV2(world, serializeStateV2(st));
  assert.deepEqual(restored, st);
});

test("AI 活跃推演 12 旬（含围城、解围、季度天时转换）零异常", () => {
  let st = createGameV2(world, 208, "liu", { difficulty: "hard" });
  for (let i = 0; i < 12; i += 1) {
    st = advanceDekad(world, st);
    assert.equal(Object.keys(st.cities).length, 44);
    assert.ok(Number.isFinite(st.factions.liu.treasury));
    assert.ok(Number.isFinite(st.factions.liu.grain));
  }
  assert.equal(st.turn, 12);
});
