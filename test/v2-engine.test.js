import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { enrichWorld } from "../dist/personnel.js";
import {
  CITY_SPECIALTIES, FORMATIONS_V2, NATIONAL_DECREES_V2, TROOP_TYPES,
  edgeKey, formatCalendar, imperialRankForCities, roadTerrain, troopCounterEffect,
} from "../dist/v2/constants.js";
import {
  CITY_BUILDINGS_V4, COURT_OFFICES_V4, EMPEROR_EDICTS_V3, OPENING_DEV_DEKADS,
  PRESTIGE_RANKS_V4, TAX_LEVELS_V4, WANDERING_HEROES_V3, activeTreaty, advanceDekad,
  aiPersonalityFor, appointCourtOffice, approveAllCabinet, approveCabinetProposal,
  availableOfficersInCity, batchSetCityPolicy, bribeDefection, buildCabinetBriefings, buildFort,
  buildingUpgradeCost, canBuildFort, castStratagem, checkSupplyLine, cityTierInfo,
  clearSupplyLink, computeCourtBonuses, computeFactionPrestige, computeThreats, createGameV2,
  demolishFort, deserializeStateV2, dismissCabinetProposal, dispatchArmy,
  dispatchEmergencyReinforce, enactDecree, estimateFactionEconomy, evaluateDeal, executeDiplomacy,
  findRoadPath, hasDecree, isHostileV2, issueImperialEdict, launchCoordinatedAttack, layCityTrap,
  officerBattleArt, planCoordinatedAttack, prestigeRankForFaction, proposeDeal,
  rankProgressForFaction, recruitWanderingOfficer, redirectArmy, renderDiploMatrixHtml,
  renderPowerChartSvg, renderReplayMapSvg, repairFort, resolveCaptive, resolveEventChoice,
  rewardOfficer, serializeStateV2, setAutoGovernance, setCityPolicy, setCitySiegeDefense,
  setCityTroopType, setSupplyLink, setTaxLevel, sowDiscord, stratagemCooldownLeft,
  transferOfficer, triggerArmyArt, upgradeCityBuilding,
} from "../dist/v2/engine.js";
import { spawnWanderingHeroes } from "../dist/v2/arts.js";
import { maybeTriggerEvent } from "../dist/v2/events.js";
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

test("多回合流动活战（阵前绞杀、撤军脱离与增援夹击）运行正常", () => {
  let st = createGameV2(world, 199, "cao");
  st.cities.runan.owner = "biao";
  st.cities.xu.troops = 3200;
  st.cities.runan.troops = 2800;
  const caoOff = availableOfficersInCity(st, "xu", "cao")[0];
  let biaoOff = availableOfficersInCity(st, "runan", "biao")[0];
  if (!biaoOff) {
    const anyBiao = Object.values(st.officers).find((o) => o.faction === "biao" && !o.armyId);
    anyBiao.city = "runan";
    biaoOff = anyBiao;
  }
  // Equalize officer baselines for deterministic close clash (< 2.2 ratio)
  caoOff.command = 75;
  caoOff.might = 75;
  biaoOff.command = 75;
  biaoOff.might = 75;

  st = dispatchArmy(world, st, {
    from: "xu",
    to: "runan",
    officer: caoOff.key,
    troops: 1400,
    troopType: "infantry",
    formation: "heyi",
  });
  const caoArmyId = st.armies[0].id;
  st.armies.push({
    id: "army-biao-clash",
    faction: "biao",
    officer: biaoOff.key,
    deputy: null,
    formation: "heyi",
    troops: 1400,
    maxTroops: 1400,
    troopType: "infantry",
    morale: 85,
    grain: 20,
    route: ["runan", "xu"],
    step: 0,
    from: "runan",
    to: "xu",
    targetCity: "xu",
    depot: "runan",
    progress: 0.52,
    edgeDekads: 2,
    stance: "attack",
    siegeStance: "storm",
    engagedWith: null,
    engageRounds: 0,
    supplyCut: false,
    reorgDekads: 0,
  });
  biaoOff.armyId = "army-biao-clash";

  let locked = false;
  for (let i = 0; i < 3; i += 1) {
    st = advanceDekad(world, st, { skipAi: true });
    if (st.lastTurnEvents.some((e) => e.kind === "field_battle" && e.engaged)) {
      locked = true;
      break;
    }
  }
  assert.equal(locked, true, "势均力敌的大军在官道交锋首回合锁定为阵前绞杀状态");
  const a1 = st.armies.find((a) => a.id === caoArmyId);
  const b1 = st.armies.find((a) => a.id === "army-biao-clash");
  assert.equal(a1.stance, "engaged");
  assert.equal(b1.stance, "engaged");
  assert.equal(a1.engagedWith, b1.id);
  assert.equal(a1.engageRounds, 1);

  // Branch A: retreat disengages cleanly and unlocks enemy on next dekad
  const retreated = redirectArmy(world, st, caoArmyId, { stance: "retreat" });
  const rCao = retreated.armies.find((a) => a.id === caoArmyId);
  assert.equal(rCao.stance, "retreat");
  assert.equal(rCao.engagedWith, null);
  const afterRetreat = advanceDekad(world, retreated, { skipAi: true });
  const unlockedEnemy = afterRetreat.armies.find((a) => a.id === "army-biao-clash");
  if (unlockedEnemy) {
    assert.notEqual(unlockedEnemy.stance, "engaged");
  }

  // Branch B: advance up to 3 rounds resolves the engaged clash cleanly
  let resolved = st;
  for (let i = 0; i < 4; i += 1) {
    resolved = advanceDekad(world, resolved, { skipAi: true });
  }
  assert.equal(resolved.armies.some((a) => a.stance === "engaged"), false, "绞杀超过 3 合后分出胜负并脱离锁定");
});

test("副将出征、五大阵型速度与破城差异及双将归建正确", () => {
  let st = createGameV2(world, 208, "liu");
  const liubei = Object.values(st.officers).find((o) => o.faction === "liu" && o.name === "刘备");
  const guanyu = Object.values(st.officers).find((o) => o.faction === "liu" && o.name === "关羽");
  const baseCity = Object.values(st.cities).find((c) => c.owner === "liu").key;
  const links = world.cities.find((c) => c.key === baseCity).links;
  const allyDest = links[0];
  st.cities[allyDest].owner = "liu";
  st.cities[baseCity].troops = 5000;
  liubei.city = baseCity;
  liubei.armyId = null;
  guanyu.city = baseCity;
  guanyu.armyId = null;

  assert.ok(FORMATIONS_V2.changshe.speedMult > FORMATIONS_V2.heyi.speedMult);
  assert.ok(FORMATIONS_V2.chongche.siegeMult > FORMATIONS_V2.heyi.siegeMult);

  st = dispatchArmy(world, st, {
    from: baseCity,
    to: allyDest,
    officer: liubei.key,
    deputy: guanyu.key,
    troops: 1200,
    troopType: "siege",
    formation: "changshe",
  });
  const army = st.armies[0];
  assert.equal(army.deputy, guanyu.key);
  assert.equal(army.formation, "changshe");
  assert.equal(st.officers[liubei.key].armyId, army.id);
  assert.equal(st.officers[guanyu.key].armyId, army.id);
  const fastDekads = army.edgeDekads;

  let cmp = createGameV2(world, 208, "liu");
  cmp.cities[allyDest].owner = "liu";
  cmp.cities[baseCity].troops = 5000;
  const oCmp = availableOfficersInCity(cmp, baseCity, "liu")[0];
  cmp = dispatchArmy(world, cmp, {
    from: baseCity,
    to: allyDest,
    officer: oCmp.key,
    troops: 1200,
    troopType: "siege",
    formation: "chongche",
  });
  assert.ok(fastDekads < cmp.armies[0].edgeDekads, "长蛇阵行军耗时严格短于冲车阵");

  for (let i = 0; i < 6 && st.armies.length > 0; i += 1) {
    st = advanceDekad(world, st, { skipAi: true });
  }
  assert.equal(st.officers[liubei.key].armyId, null);
  assert.equal(st.officers[guanyu.key].armyId, null);
  assert.equal(st.officers[liubei.key].city, allyDest);
  assert.equal(st.officers[guanyu.key].city, allyDest);

  // Siege wall damage check: chongche vs heyi
  function oneSiegeTickWall(formId) {
    let s = createGameV2(world, 199, "cao");
    s.cities.runan.owner = "biao";
    s.cities.runan.troops = 1400;
    s.cities.runan.wall = 500;
    s.cities.xu.troops = 3000;
    const o = availableOfficersInCity(s, "xu", "cao")[0];
    o.command = 80;
    s = dispatchArmy(world, s, { from: "xu", to: "runan", officer: o.key, troops: 1500, troopType: "siege", formation: formId });
    for (let i = 0; i < 6; i += 1) {
      s = advanceDekad(world, s, { skipAi: true });
      if (s.lastTurnEvents.some((e) => e.kind === "siege_tick")) break;
    }
    return 500 - s.cities.runan.wall;
  }
  assert.ok(oneSiegeTickWall("chongche") > oneSiegeTickWall("heyi"), "冲车阵单旬破墙伤害显著高于鹤翼阵");
});

test("汉室官爵晋升、国家国策颁行加成及旧档平滑升级有效", () => {
  assert.equal(imperialRankForCities(1).current.title, "郡守");
  assert.equal(imperialRankForCities(16).current.title, "汉丞相");
  assert.equal(imperialRankForCities(34).current.title, "天子御极");
  assert.equal(Object.keys(NATIONAL_DECREES_V2).length, 8);

  let st = createGameV2(world, 199, "cao");
  const keys = Object.keys(st.cities);
  for (let i = 0; i < 16; i += 1) st.cities[keys[i]].owner = "cao";
  st.factions.cao.treasury = 400;
  st.factions.cao.morale = 60;

  assert.equal(rankProgressForFaction(st, "cao").current.title, "汉丞相");

  st = enactDecree(world, st, "tuntian");
  st = enactDecree(world, st, "repeating_crossbow");
  st = enactDecree(world, st, "imperial_edict");
  assert.equal(hasDecree(st, "cao", "tuntian"), true);
  assert.equal(hasDecree(st, "cao", "imperial_edict"), true);
  assert.ok(st.factions.cao.morale >= 75, "挟天子令使国力士气保底不低于 75");

  const rivalCity = Object.values(st.cities).find((c) => c.owner && c.owner !== "cao");
  assert.ok(rivalCity);
  const dealEval = evaluateDeal(world, st, rivalCity.owner, { type: "truce", gold: 0, grain: 0 });
  assert.ok(dealEval.reasons.some((r) => r.includes("挟天子令")));

  // Grain bonus check at monthly turn 3
  let plain = createGameV2(world, 199, "cao");
  for (let i = 0; i < 16; i += 1) plain.cities[keys[i]].owner = "cao";
  const gBase0 = plain.factions.cao.grain;
  for (let i = 0; i < 3; i += 1) plain = advanceDekad(world, plain, { skipAi: true });
  const gTuntian0 = st.factions.cao.grain;
  let decSt = st;
  for (let i = 0; i < 3; i += 1) decSt = advanceDekad(world, decSt, { skipAi: true });
  assert.ok((decSt.factions.cao.grain - gTuntian0) > (plain.factions.cao.grain - gBase0), "许都屯田国策显着提升月度军粮产额");

  // Legacy upgrade clears missing decrees & army fields
  const raw = JSON.parse(serializeStateV2(st));
  delete raw.decrees;
  const restored = deserializeStateV2(world, JSON.stringify(raw));
  assert.deepEqual(restored.decrees, {});
});

test("3.0 历史大事件分支抉择与汉帝奉迎 / 传国玉玺诏令系统", () => {
  assert.equal(Object.keys(EMPEROR_EDICTS_V3).length, 3);

  const biao = createGameV2(world, 199, "biao");
  assert.throws(() => issueImperialEdict(world, biao, "edict_levy"), /汉帝驻跸|传国玉玺/);

  let st = createGameV2(world, 199, "cao");
  st.factions.cao.treasury = 300;
  st.factions.cao.grain = 300;
  for (let i = 0; i < 3; i += 1) {
    st = advanceDekad(world, st, { skipAi: true });
    if (st.pendingEvent) break;
  }
  if (!st.pendingEvent) maybeTriggerEvent(world, st);
  assert.ok(st.pendingEvent && Array.isArray(st.pendingEvent.choices) && st.pendingEvent.choices.length >= 2);
  st = resolveEventChoice(world, st, 0);
  assert.equal(st.pendingEvent, null);

  assert.equal(st.cities[st.emperorCity]?.owner, "cao");
  const rivalKey = Object.values(st.cities).find((c) => c.owner && c.owner !== "cao").owner;
  st.edictCooldown = 0;
  st = issueImperialEdict(world, st, "edict_truce", rivalKey);
  assert.equal(activeTreaty(st, "cao", rivalKey)?.kind, "truce");
  assert.equal(st.edictCooldown, 9);
  assert.throws(() => issueImperialEdict(world, st, "edict_levy"), /冷却中/);

  st.edictCooldown = 0;
  st = issueImperialEdict(world, st, "edict_crusade", rivalKey);
  assert.equal(activeTreaty(st, "cao", rivalKey), null);

  st.edictCooldown = 0;
  const troopsBefore = st.cities[st.emperorCity].troops;
  st = issueImperialEdict(world, st, "edict_levy");
  assert.equal(st.cities[st.emperorCity].troops, troopsBefore + 600);
});

test("3.0 名将专属战法蓄怒施放、在野贤才寻访与驿传调防", () => {
  assert.equal(officerBattleArt({ name: "吕布", traits: [] }).id, "unrivaled");
  assert.equal(officerBattleArt({ name: "诸葛亮", traits: ["fire"] }).id, "eight_trigrams");
  assert.equal(officerBattleArt({ name: "关羽", traits: [] }).id, "flood_seven");
  assert.ok(WANDERING_HEROES_V3.length >= 18);

  let st = createGameV2(world, 208, "liu");
  spawnWanderingHeroes(world, st);
  assert.ok(st.wanderingOfficers.length > 0);
  const hero = st.wanderingOfficers[0];
  st.cities[hero.city].owner = "liu";
  delete st.sieges[hero.city];
  st.factions.liu.treasury = 100;
  st = recruitWanderingOfficer(world, st, hero.id);
  assert.equal(st.factions.liu.treasury, 76);
  assert.equal(st.wanderingOfficers.some((w) => w.id === hero.id), false);
  assert.ok(Object.values(st.officers).some((o) => o.name === hero.name && o.faction === "liu"));

  let trSt = createGameV2(world, 199, "cao");
  const caoCities = Object.values(trSt.cities).filter((c) => c.owner === "cao");
  const cFrom = caoCities.find((c) => availableOfficersInCity(trSt, c.key, "cao").length > 0).key;
  const cTo = caoCities.find((c) => c.key !== cFrom).key;
  const off = availableOfficersInCity(trSt, cFrom, "cao")[0];

  trSt = transferOfficer(world, trSt, off.key, cTo);
  assert.equal(trSt.officers[off.key].transferringTo, cTo);
  assert.equal(trSt.officers[off.key].city, null);
  for (let i = 0; i < 3; i += 1) {
    trSt = advanceDekad(world, trSt, { skipAi: true });
    if (!trSt.officers[off.key].transferringTo) break;
  }
  assert.equal(trSt.officers[off.key].transferringTo, null);
  assert.equal(trSt.officers[off.key].city, cTo);

  const sendMeta = world.cities.find((c) => c.key === cTo);
  const nb = sendMeta.links[0];
  trSt.cities[cTo].troops = 2000;
  trSt = dispatchArmy(world, trSt, { from: cTo, to: nb, officer: off.key, troops: 900, troopType: "cavalry" });
  trSt.armies[0].rage = 100;
  trSt = triggerArmyArt(world, trSt, trSt.armies[0].id, [], { manual: true });
  assert.equal(trSt.armies[0].rage, 0);
  assert.equal(trSt.lastTurnEvents[0].kind, "battle_art");
});

test("3.0 后勤自动输血、多城协同合围延迟齐抵、批量治城与反霸包围网", () => {
  let st = createGameV2(world, 199, "cao");
  st.cities.puyang.owner = "cao";
  st.cities.chenliu.owner = "cao";
  st.cities.xu.owner = "cao";
  st.cities.puyang.troops = 2200;
  st.cities.xu.troops = 900;
  st.factions.cao.grain = 450;

  assert.ok(findRoadPath(world, st, "cao", "puyang", "xu", { allowEnemyEnd: false }));
  st = setSupplyLink(world, st, "puyang", "xu");
  for (let i = 0; i < 5; i += 1) st = advanceDekad(world, st, { skipAi: true });
  assert.ok(
    st.events.some((e) => e.text.includes("后勤自动输血"))
      || st.armies.some((a) => a.escortName === "辎重偏将"),
    "腹地后勤大营在月初结算安全发兵输血且无主将空指针错误",
  );
  st = clearSupplyLink(st, "puyang");
  assert.equal(st.supplyLinks.puyang, undefined);

  let coordSt = createGameV2(world, 199, "cao");
  coordSt.cities.runan.owner = "biao";
  coordSt.cities.xu.owner = "cao";
  coordSt.cities.xu.troops = 2200;
  coordSt.cities.puyang.owner = "cao";
  coordSt.cities.puyang.troops = 2200;
  coordSt.factions.cao.grain = 600;
  for (const ck of ["xu", "puyang"]) {
    if (availableOfficersInCity(coordSt, ck, "cao").length === 0) {
      const spare = Object.values(coordSt.officers).find((o) => o.faction === "cao" && !o.armyId && o.city !== "xu" && o.city !== "puyang");
      if (spare) {
        if (spare.city && coordSt.cities[spare.city]) {
          if (coordSt.cities[spare.city].governor === spare.key) coordSt.cities[spare.city].governor = null;
          if (coordSt.cities[spare.city].commander === spare.key) coordSt.cities[spare.city].commander = null;
        }
        spare.city = ck;
      }
    }
  }
  const plan = planCoordinatedAttack(world, coordSt, {
    targetCity: "runan",
    originKeys: ["xu", "puyang"],
    syncArrival: true,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.columns.length, 2);
  assert.ok(plan.columns.some((c) => c.delayDekads > 0), "同步合围会为近路军团自动计算整备延迟以齐抵敌城");
  coordSt = launchCoordinatedAttack(world, coordSt, {
    targetCity: "runan",
    originKeys: ["xu", "puyang"],
    syncArrival: true,
  });
  assert.equal(coordSt.armies.filter((a) => a.targetCity === "runan").length, 2);

  coordSt = batchSetCityPolicy(coordSt, ["xu", "puyang"], "granary");
  assert.equal(coordSt.cities.xu.policy, "granary");
  assert.equal(coordSt.cities.puyang.policy, "granary");

  assert.notEqual(aiPersonalityFor("cao").preferTroop, aiPersonalityFor("ce").preferTroop);

  let coalSt = createGameV2(world, 199, "cao");
  const rivals = Object.keys(coalSt.factions).filter((fk) => fk !== "cao");
  const nonCaoKeys = Object.keys(coalSt.cities).filter((ck) => coalSt.cities[ck].owner !== "cao");
  let given = Object.values(coalSt.cities).filter((c) => c.owner === "cao").length;
  for (const ck of nonCaoKeys) {
    if (given >= 17) break;
    coalSt.cities[ck].owner = "cao";
    given += 1;
  }
  // Ensure at least two rivals still hold territory
  const remainingKeys = Object.keys(coalSt.cities).filter((ck) => coalSt.cities[ck].owner !== "cao");
  if (rivals.length >= 2 && remainingKeys.length >= 2) {
    coalSt.cities[remainingKeys[0]].owner = rivals[0];
    coalSt.cities[remainingKeys[1]].owner = rivals[1];
  }
  for (let i = 0; i < 3; i += 1) coalSt = advanceDekad(world, coalSt, { skipAi: true });
  assert.ok(coalSt.coalitionAlertLevel >= 1);
  assert.ok(coalSt.events.some((e) => e.text.includes("合纵") || e.text.includes("反霸")));
});

test("3.0 战役明细战报、历史态势图表/外交矩阵/疆域回放及 2.0 存档向下兼容", () => {
  let st = createGameV2(world, 199, "cao");
  st.cities.runan.owner = "biao";
  st.cities.xu.troops = 3000;
  st.cities.runan.troops = 2600;
  const caoOff = availableOfficersInCity(st, "xu", "cao")[0];
  let biaoOff = availableOfficersInCity(st, "runan", "biao")[0];
  if (!biaoOff) {
    biaoOff = Object.values(st.officers).find((o) => o.faction === "biao" && !o.armyId);
    biaoOff.city = "runan";
  }
  st = dispatchArmy(world, st, { from: "xu", to: "runan", officer: caoOff.key, troops: 1500, troopType: "cavalry" });
  st.armies.push({
    id: "army-test-v3-clash",
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
    rage: 0,
    delayDekads: 0,
  });
  biaoOff.armyId = "army-test-v3-clash";

  for (let i = 0; i < 4; i += 1) {
    st = advanceDekad(world, st, { skipAi: true });
    if (st.battleReports.length > 0 && st.historySnapshots.length >= 2) break;
  }
  assert.ok(st.battleReports.length > 0, "战阵交锋自动记录详细胜负复盘战报");
  assert.ok(Array.isArray(st.battleReports[0].factors));
  assert.ok(st.battleReports[0].losses);
  assert.ok(st.historySnapshots.length >= 2);

  const svg = renderPowerChartSvg(world, st, "cities");
  assert.ok(svg.includes("<svg") && svg.includes("<polyline"));
  const matrix = renderDiploMatrixHtml(world, st);
  assert.ok(matrix.includes('class="v2-matrix-table"'));
  const replay = renderReplayMapSvg(world, st, 0);
  assert.ok(replay.includes("<svg") && replay.includes('viewBox="40 20 710 460"'));

  const raw = JSON.parse(serializeStateV2(st));
  for (const k of [
    "emperorCity", "sealFaction", "wanderingOfficers", "triggeredWanderingIds",
    "pendingEvent", "triggeredEvents", "eventCooldowns", "supplyLinks",
    "officerTransfers", "battleReports", "historySnapshots", "edictCooldown", "coalitionAlertLevel",
  ]) {
    delete raw[k];
  }
  const restored = deserializeStateV2(world, JSON.stringify(raw));
  assert.ok(restored.emperorCity);
  assert.ok(Array.isArray(restored.wanderingOfficers));
  assert.ok(Array.isArray(restored.battleReports));
  assert.equal(typeof restored.supplyLinks, "object");
});

test("4.0 郡国农商基建、城市规模晋升、国家税率与维持腐败经济闭环", () => {
  assert.equal(Object.keys(CITY_BUILDINGS_V4).length, 4);
  assert.equal(Object.keys(TAX_LEVELS_V4).length, 3);

  let st = createGameV2(world, 199, "cao");
  st.factions.cao.treasury = 500;
  const xu = st.cities.xu;
  assert.ok(xu.buildings.farm >= 1 && xu.buildings.market >= 1);
  assert.equal(xu.publicOrder, 78);

  const farmCost = buildingUpgradeCost(st, "cao", "farm", xu.buildings.farm + 1);
  const goldBefore = st.factions.cao.treasury;
  const farmBefore = xu.buildings.farm;
  st = upgradeCityBuilding(world, st, "xu", "farm");
  assert.equal(st.cities.xu.buildings.farm, farmBefore + 1);
  assert.equal(st.factions.cao.treasury, goldBefore - farmCost);

  const wallMaxBefore = st.cities.xu.wallMax;
  st = upgradeCityBuilding(world, st, "xu", "academy");
  assert.equal(st.cities.xu.wallMax, wallMaxBefore + CITY_BUILDINGS_V4.academy.wallPerLv);
  assert.ok(cityTierInfo(st.cities.xu).totalDev >= 4);

  const lowTax = estimateFactionEconomy(setTaxLevel(st, "low"), "cao");
  const normTax = estimateFactionEconomy(setTaxLevel(st, "normal"), "cao");
  const highTax = estimateFactionEconomy(setTaxLevel(st, "high"), "cao");
  assert.ok(highTax.grossTreasury > normTax.grossTreasury && normTax.grossTreasury > lowTax.grossTreasury);
  assert.ok(normTax.upkeepTreasury > 0 && normTax.upkeepGrain > 0);

  // Public order unrest trigger when dropping below 25
  let unrestSt = setTaxLevel(st, "high");
  unrestSt.cities.xu.publicOrder = 22;
  unrestSt.cities.xu.buildings.academy = 0;
  unrestSt.cities.xu.troops = 1600;
  for (let i = 0; i < 3; i += 1) unrestSt = advanceDekad(world, unrestSt, { skipAi: true });
  assert.ok(unrestSt.events.some((e) => e.text.includes("治安告急") || e.text.includes("骚乱")));
  assert.ok(unrestSt.cities.xu.troops < 1600);
});

test("4.0 朝堂六卿官职任免光环、威望晋爵与三足鼎立终局", () => {
  assert.equal(Object.keys(COURT_OFFICES_V4).length, 6);
  assert.equal(PRESTIGE_RANKS_V4.length, 6);

  const small = createGameV2(world, 199, "lu");
  assert.throws(() => appointCourtOffice(small, "imperial_censor", Object.values(small.officers).find((o) => o.faction === "lu")?.key), /威望晋升/);

  let st = createGameV2(world, 199, "cao");
  const pool = Object.values(st.officers).filter((o) => o.faction === "cao" && o.name !== "曹操");
  const bestGov = pool.slice().sort((a, b) => b.governance - a.governance)[0];
  const bestCmd = pool.filter((o) => o.key !== bestGov.key).sort((a, b) => b.command - a.command)[0];

  const loyBefore = bestGov.loyalty;
  st = appointCourtOffice(st, "chancellor", bestGov.key);
  st = appointCourtOffice(st, "grand_general", bestCmd.key);
  assert.equal(st.courtOffices.cao.chancellor, bestGov.key);
  assert.equal(st.courtOffices.cao.grand_general, bestCmd.key);
  assert.ok(st.officers[bestGov.key].loyalty >= loyBefore);

  const bonuses = computeCourtBonuses(st, "cao");
  assert.ok(bonuses.buildDiscount < 1);
  assert.ok(bonuses.dealBonus >= 6);
  assert.ok(bonuses.upkeepDiscount < 1);
  assert.ok(bonuses.combatMult > 1);
  assert.ok(computeFactionPrestige(st, "cao") > 0);
  assert.ok(prestigeRankForFaction(st, "cao").prestige > 0);

  // Trigger Three Kingdoms climax after turn 18 with >= 22 cities & >= 3 active powers
  const nonCaoKeys = Object.keys(st.cities).filter((ck) => !["cao", "yuan", "ce"].includes(st.cities[ck].owner));
  let given = Object.values(st.cities).filter((c) => c.owner === "cao").length;
  for (const ck of nonCaoKeys) {
    if (given >= 22) break;
    st.cities[ck].owner = "cao";
    given += 1;
  }
  st.turn = 20;
  st.treaties.push({ kind: "alliance", sides: ["cao", "yuan"].sort(), expires: 60 });
  st = advanceDekad(world, st, { skipAi: true });
  assert.equal(st.threeKingdoms?.triggered, true);
  assert.equal(st.threeKingdoms.emperors.length, 3);
  const [e0, e1] = st.threeKingdoms.emperors;
  assert.equal(activeTreaty(st, e0.faction, e1.faction), null);
});

test("4.0 军机处中枢奏折建议、朱批准奏/留中/一键全批与重臣自动托管", () => {
  let st = createGameV2(world, 199, "cao");
  st.factions.cao.treasury = 350;
  const briefings = buildCabinetBriefings(world, st);
  assert.ok(briefings.length >= 2);
  for (let i = 1; i < briefings.length; i += 1) {
    assert.ok(briefings[i - 1].priority >= briefings[i].priority);
  }

  const firstId = briefings[0].id;
  const afterDismiss = dismissCabinetProposal(st, firstId);
  assert.equal(buildCabinetBriefings(world, afterDismiss).some((p) => p.id === firstId), false);

  const buildProp = briefings.find((p) => p.action.kind === "build");
  assert.ok(buildProp);
  const prevLv = st.cities[buildProp.action.payload.cityKey].buildings[buildProp.action.payload.trackId];
  const afterOne = approveCabinetProposal(world, st, buildProp.id);
  assert.equal(afterOne.cities[buildProp.action.payload.cityKey].buildings[buildProp.action.payload.trackId], prevLv + 1);

  const afterAll = approveAllCabinet(world, st);
  assert.ok(afterAll.events.some((e) => e.text.includes("军机总批")));

  // Test autonomous governance on monthly tick
  let autoSt = setAutoGovernance(st, "autoEconomy", true);
  autoSt = setAutoGovernance(autoSt, "autoPersonnel", true);
  autoSt.factions.cao.treasury = 300;
  for (let i = 0; i < 3; i += 1) autoSt = advanceDekad(world, autoSt, { skipAi: true });
  assert.ok(autoSt.events.some((e) => e.text.includes("军机自动")));
});

test("4.0 开局 9 旬农商休养蓄势期 AI 行为与 2.0/3.0 旧档向上兼容", () => {
  assert.equal(OPENING_DEV_DEKADS, 9);
  let st = createGameV2(world, 199, "cao");
  const initialAiDev = Object.values(st.cities)
    .filter((c) => c.owner !== "cao")
    .reduce((sum, c) => sum + c.buildings.farm + c.buildings.market + c.buildings.workshop + c.buildings.academy, 0);

  for (let i = 0; i < OPENING_DEV_DEKADS; i += 1) {
    st = advanceDekad(world, st);
  }
  const aiOffensiveInOpening = st.armies.filter((a) => a.faction !== "cao" && a.stance === "attack");
  assert.equal(aiOffensiveInOpening.length, 0, "开局 9 旬休养蓄势期内 AI 不主动发起跨境进攻");

  const devAfter9 = Object.values(st.cities)
    .filter((c) => c.owner !== "cao")
    .reduce((sum, c) => sum + c.buildings.farm + c.buildings.market + c.buildings.workshop + c.buildings.academy, 0);
  assert.ok(devAfter9 > initialAiDev, "休养蓄势期内 AI 真实花钱兴建郡国农商基建");

  // Advance after turn 9 so AI resumes normal campaign tempo cleanly
  for (let i = 0; i < 6; i += 1) {
    st = advanceDekad(world, st);
  }
  assert.equal(st.turn, 15);

  // Strip v4 fields from save JSON & verify smooth upgrade via deserializeStateV2
  const raw = JSON.parse(serializeStateV2(st));
  delete raw.courtOffices;
  delete raw.autoGovernance;
  delete raw.dismissedCabinetIds;
  delete raw.threeKingdoms;
  for (const c of Object.values(raw.cities)) {
    delete c.buildings;
    delete c.publicOrder;
  }
  for (const f of Object.values(raw.factions)) {
    delete f.taxLevel;
  }
  const restored = deserializeStateV2(world, JSON.stringify(raw));
  assert.ok(restored.courtOffices?.cao);
  assert.equal(restored.factions.cao.taxLevel, "normal");
  assert.ok(restored.cities.xu.buildings.farm >= 1);
  assert.equal(restored.cities.xu.publicOrder, 78);
});
