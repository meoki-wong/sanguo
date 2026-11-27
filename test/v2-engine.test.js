import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { enrichWorld } from "../dist/personnel.js";
import { CITY_SPECIALTIES, TROOP_TYPES, edgeKey, formatCalendar, roadTerrain, troopCounterEffect } from "../dist/v2/constants.js";
import {
  advanceDekad, availableOfficersInCity, bribeDefection, buildFort, canBuildFort,
  castStratagem, checkSupplyLine, computeThreats, createGameV2, demolishFort,
  deserializeStateV2, dispatchArmy, dispatchEmergencyReinforce, evaluateDeal,
  executeDiplomacy, isHostileV2, layCityTrap, proposeDeal, redirectArmy, repairFort,
  resolveCaptive, rewardOfficer, serializeStateV2, setCityPolicy, setCitySiegeDefense,
  setCityTroopType, sowDiscord, stratagemCooldownLeft,
} from "../dist/v2/engine.js";
import { evaluateBondBonus } from "../dist/v2/systems.js";

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

test("二期官道工事：关隘寨堡阻敌、连弩箭楼齐射、前哨粮寨延供与江防水寨限制", () => {
  let st = createGameV2(world, 199, "cao");
  st.factions.cao.treasury = 300;
  st.cities.chenliu.troops = 2600;
  st.cities.puyang.owner = "yuan";
  st.cities.puyang.troops = 2400;

  // River-only restriction on inland road
  assert.equal(canBuildFort(world, st, "cao", "xu", "chenliu", "water_fort").ok, false);
  // River road (chenliu <-> puyang is RIVER_EDGE_SET) allows water_fort, inland allows gate/tower/depot
  assert.equal(canBuildFort(world, st, "cao", "chenliu", "puyang", "water_fort").ok, true);

  st = buildFort(world, st, "chenliu", "puyang", "gate");
  const eK = edgeKey("chenliu", "puyang");
  assert.equal(st.forts[eK].kind, "gate");
  assert.equal(st.forts[eK].hp, 240);

  // Inject hostile Yuan army marching across gated road -> blocked at 0.48!
  const yuanOff = Object.values(st.officers).find((o) => o.faction === "yuan" && !o.armyId);
  st.armies.push({
    id: "army-gate-test",
    faction: "yuan",
    officer: yuanOff.key,
    troops: 1100,
    maxTroops: 1100,
    troopType: "infantry",
    morale: 85,
    grain: 20,
    route: ["puyang", "chenliu"],
    step: 0,
    from: "puyang",
    to: "chenliu",
    targetCity: "chenliu",
    depot: "puyang",
    progress: 0.45,
    edgeDekads: 2,
    stance: "attack",
    siegeStance: "storm",
    supplyCut: false,
    reorgDekads: 0,
  });
  st = advanceDekad(world, st, { skipAi: true });
  const enemyArmy = st.armies.find((a) => a.id === "army-gate-test");
  assert.ok(enemyArmy.progress <= 0.48, "关隘寨堡强行将敌军拦截在 0.48 关卡处");
  assert.ok(st.forts[eK].hp < 240, "敌军攻打寨堡造成真实耐久损伤");
  assert.ok(st.lastTurnEvents.some((e) => e.kind === "fort_blocked"));

  // Test repair & demolish
  st = repairFort(world, st, eK);
  assert.equal(st.forts[eK].hp, 240);
  st = demolishFort(st, eK);
  assert.equal(st.forts[eK], undefined);

  // Test depot fort extending supply line even if rear depot was temporarily flipped
  st = buildFort(world, st, "xu", "runan", "depot");
  const caoOff = availableOfficersInCity(st, "xu", "cao")[0];
  st = dispatchArmy(world, st, { from: "xu", to: "runan", officer: caoOff.key, troops: 1000, troopType: "infantry" });
  st.cities.xu.owner = "biao";
  assert.equal(checkSupplyLine(world, st, st.armies.find((a) => a.officer === caoOff.key)), true, "前哨粮寨保障补给线不断绝");
});

test("二期天时实战奇计（顺风火攻 / 决水淹城 / 奇袭劫粮）与冷却结算", () => {
  let st = createGameV2(world, 208, "liu");
  st.factions.liu.treasury = 300;
  st.weather = { key: "wind", name: "秋高顺风", icon: "💨", marchMult: 1.05, archerMult: 1.05, fireMult: 1.2, riverMult: 1.02, landRiverMult: 1, grainMult: 0.96 };

  // Find a river-adjacent enemy city using real river edge terrain
  const riverEnemyCity = Object.values(st.cities).find((c) => isHostileV2(st, "liu", c.owner)
    && world.cities.find((w) => w.key === c.key).links.some((nb) => roadTerrain(c.key, nb) === "river"));
  assert.ok(riverEnemyCity);
  const oldWall = riverEnemyCity.wall;
  st = castStratagem(world, st, { kind: "flood_attack", targetType: "city", targetId: riverEnemyCity.key });
  assert.ok(st.cities[riverEnemyCity.key].wall < oldWall, "决水淹城直接削减敌城城防耐久");
  assert.ok(stratagemCooldownLeft(st, "liu", "flood_attack") > 0);

  // Target enemy field army with fire_attack and raid_supply
  const caoOff = Object.values(st.officers).find((o) => o.faction === "cao" && !o.armyId);
  st.armies.push({
    id: "army-strat-test",
    faction: "cao",
    officer: caoOff.key,
    troops: 1400,
    maxTroops: 1400,
    troopType: "infantry",
    morale: 85,
    grain: 15,
    route: ["xiangyang", "jiangling"],
    step: 0,
    from: "xiangyang",
    to: "jiangling",
    targetCity: "jiangling",
    depot: "xiangyang",
    progress: 0.4,
    edgeDekads: 2,
    stance: "attack",
    siegeStance: "storm",
    supplyCut: false,
    reorgDekads: 0,
  });

  st = castStratagem(world, st, { kind: "fire_attack", targetType: "army", targetId: "army-strat-test" });
  const burnt = st.armies.find((a) => a.id === "army-strat-test");
  assert.ok(burnt.troops < 1400 && burnt.grain < 15);

  st = castStratagem(world, st, { kind: "raid_supply", targetType: "army", targetId: "army-strat-test" });
  const raided = st.armies.find((a) => a.id === "army-strat-test");
  assert.equal(raided.grain, 0);
  assert.equal(raided.supplyCut, true);
});

test("二期 44 城地域特产、名将羁绊、细作离间策反、筹码驱虎吞狼与一期存档平滑升级", () => {
  let st = createGameV2(world, 199, "cao");
  st.factions.cao.treasury = 400;
  st.factions.cao.grain = 400;

  // All 44 cities have valid specialties
  assert.equal(Object.values(st.cities).every((c) => CITY_SPECIALTIES[c.specialty]), true);
  assert.equal(st.cities.beiping.specialty, "horse");
  assert.equal(st.cities.xu.specialty, "granary");

  // Reequip discount on horse city (jinyang belongs to yuan; give beiping to cao for test)
  st.cities.beiping.owner = "cao";
  st.cities.beiping.troopType = "infantry";
  const tBefore = st.factions.cao.treasury;
  st = setCityTroopType(st, "beiping", "cavalry");
  const expectedCost = Math.round(TROOP_TYPES.cavalry.reequipCost * CITY_SPECIALTIES.horse.costMult);
  assert.equal(tBefore - st.factions.cao.treasury, expectedCost, "良马牧场整编铁骑减费 40%");

  // Historical bond bonus check on 208 Liu Bei + Guan Yu + Zhang Fei
  const st208 = createGameV2(world, 208, "liu");
  const liubei = Object.values(st208.officers).find((o) => o.faction === "liu" && o.name === "刘备");
  const guanyu = Object.values(st208.officers).find((o) => o.faction === "liu" && o.name === "关羽");
  const bondFx = evaluateBondBonus(st208, liubei.key, [guanyu.key], []);
  assert.ok(bondFx.atkMult >= 1.1 && bondFx.labels.includes("桃园结义"));

  // Subversion: sowDiscord lowers loyalty twice then bribeDefection succeeds
  const yuanCity = Object.values(st.cities).find((c) => c.owner === "yuan");
  const yuanOff = Object.values(st.officers).find((o) => o.faction === "yuan" && o.city === yuanCity.key && o.name !== "袁绍" && !o.armyId);
  assert.ok(yuanOff);
  yuanOff.loyalty = 56;
  st = sowDiscord(world, st, yuanCity.key, yuanOff.key);
  assert.ok(st.officers[yuanOff.key].loyalty <= 44);
  st = bribeDefection(world, st, yuanCity.key, yuanOff.key);
  assert.equal(st.officers[yuanOff.key].faction, "cao", "忠义大跌后重金策反成功倒戈");

  // Bargaining table + 驱虎吞狼 (instigate_war)
  const deal = { type: "instigate_war", thirdFactionKey: "yuan", gold: 60, grain: 30 };
  const evalRes = evaluateDeal(world, st, "gongsun", deal);
  assert.equal(evalRes.accepted, true);
  const beforeArmies = st.armies.length;
  st = proposeDeal(world, st, "gongsun", deal);
  assert.ok(st.armies.length >= beforeArmies, "驱虎吞狼筹码达成");

  // Backward compatibility: strip forts/stratagemCooldowns/specialty like a Phase 1 save
  const legacyPhase1 = JSON.parse(serializeStateV2(st));
  delete legacyPhase1.forts;
  delete legacyPhase1.stratagemCooldowns;
  for (const c of Object.values(legacyPhase1.cities)) delete c.specialty;
  const upgraded = deserializeStateV2(world, JSON.stringify(legacyPhase1));
  assert.deepEqual(upgraded.forts, {});
  assert.deepEqual(upgraded.stratagemCooldowns, {});
  assert.equal(upgraded.cities.xu.specialty, "granary");
});
