// 经略三国 3.0 — 战区后勤自动输血 / 多城协同合围 / 批量治城 / AI 性格分化 / 反霸包围网

import {
  FORMATIONS_V2, CITY_POLICIES, MIN_DISPATCH_TROOPS, MIN_GARRISON_LEAVE,
  activeTreaty, availableOfficersInCity, cityByKey, cityNameV2, clamp,
  createArmyRecord, findRoadPath, forecastDispatch, isHostileV2,
} from "./constants.js";

export const AI_PERSONALITIES_V3 = {
  cao: { name: "魏武善断", formation: "fengshi", preferTroop: "cavalry", aggression: 1.16, preferFort: "tower" },
  wei: { name: "魏武善断", formation: "fengshi", preferTroop: "cavalry", aggression: 1.16, preferFort: "tower" },
  ce: { name: "江东水师", formation: "heyi", preferTroop: "navy", aggression: 1.0, preferFort: "water_fort" },
  wu: { name: "江东水师", formation: "heyi", preferTroop: "navy", aggression: 1.02, preferFort: "water_fort" },
  biao: { name: "荆襄固守", formation: "fangyuan", preferTroop: "navy", aggression: 0.88, preferFort: "water_fort" },
  liu: { name: "仁义合围", formation: "heyi", preferTroop: "archer", aggression: 0.96, preferFort: "gate" },
  shu: { name: "北伐攻势", formation: "chongche", preferTroop: "archer", aggression: 1.06, preferFort: "gate" },
  yuan: { name: "河北重师", formation: "heyi", preferTroop: "infantry", aggression: 1.06, preferFort: "depot" },
  lvbu: { name: "飞将突骑", formation: "changshe", preferTroop: "cavalry", aggression: 1.26, preferFort: "tower" },
  ma: { name: "西凉铁骑", formation: "changshe", preferTroop: "cavalry", aggression: 1.2, preferFort: "tower" },
  gongsun: { name: "幽燕铁骑", formation: "fengshi", preferTroop: "cavalry", aggression: 1.12, preferFort: "tower" },
  default: { name: "群雄逐鹿", formation: "heyi", preferTroop: null, aggression: 1.0, preferFort: "gate" },
};

export function aiPersonalityFor(factionKey) {
  return AI_PERSONALITIES_V3[factionKey] || AI_PERSONALITIES_V3.default;
}

// ===== 1. 腹地「后勤大营」自动向指定前线城池输血 =====

export function setSupplyLink(world, state, rearCityKey, frontCityKey) {
  const next = structuredClone(state);
  const rear = next.cities[rearCityKey];
  const front = next.cities[frontCityKey];
  if (!rear || !front || rear.owner !== next.player || front.owner !== next.player) {
    throw new Error("补给源与受援前线须均为我方掌控之城池。");
  }
  if (rearCityKey === frontCityKey) throw new Error("不可将同一座城池设为自给补给线。");
  const route = findRoadPath(world, next, next.player, rearCityKey, frontCityKey, { allowEnemyEnd: false });
  if (!route) throw new Error("两城之间暂无安全己方/盟友官道相连。");

  (next.supplyLinks ??= {})[rearCityKey] = frontCityKey;
  const ev = {
    turn: next.turn,
    kind: "order",
    faction: next.player,
    text: `🚚 后勤委任：每逢月初结算，「${cityNameV2(world, rearCityKey)}」若兵力充沛将自动沿官道输血「${cityNameV2(world, frontCityKey)}」。`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

export function clearSupplyLink(state, rearCityKey) {
  const next = structuredClone(state);
  if (next.supplyLinks) delete next.supplyLinks[rearCityKey];
  return next;
}

export function processSupplyLinksMonthly(world, state, events = []) {
  const links = state.supplyLinks || {};
  for (const [rearKey, frontKey] of Object.entries(links)) {
    const rear = state.cities[rearKey];
    const front = state.cities[frontKey];
    if (!rear || !front || rear.owner !== state.player || front.owner !== state.player) {
      delete links[rearKey];
      continue;
    }
    if (state.sieges?.[rearKey] || rear.troops < 1650) continue;
    const fac = state.factions[state.player];
    if (!fac || fac.grain < 12) continue;

    const alreadyEnRoute = (state.armies || []).filter(
      (a) => a.faction === state.player && a.from === rearKey && a.targetCity === frontKey && a.escortName,
    ).length;
    if (alreadyEnRoute >= 1) continue;

    const route = findRoadPath(world, state, state.player, rearKey, frontKey, { allowEnemyEnd: false });
    if (!route || route.length < 2) continue;

    const sendAmt = clamp(Math.min(650, rear.troops - 1000), 300, 650);
    const grainCost = Math.max(4, Math.ceil(sendAmt / 220) * 2);
    if (fac.grain < grainCost) continue;

    rear.troops -= sendAmt;
    fac.grain -= grainCost;
    const convoy = createArmyRecord(world, state, {
      faction: state.player,
      from: rearKey,
      route,
      officerKey: null,
      escortName: "辎重偏将",
      troops: sendAmt,
      troopType: rear.troopType,
      stance: "reinforce",
      formation: "changshe",
    });
    state.armies.push(convoy);
    events.push({
      turn: state.turn,
      kind: "order",
      faction: state.player,
      city: frontKey,
      pos: cityByKey(world, rearKey)?.position,
      text: `🚚 后勤自动输血：「${cityNameV2(world, rearKey)}」发兵 ${sendAmt.toLocaleString()} 人星夜增援「${cityNameV2(world, frontKey)}」。`,
    });
  }
}

// ===== 2. 多城一键协同合围（同步计算迟延以齐至敌城） =====

export function planCoordinatedAttack(world, state, {
  targetCity,
  originKeys = [],
  formation = "heyi",
  troopRatio = 0.65,
  syncArrival = true,
} = {}) {
  const target = state.cities[targetCity];
  if (!target) return { ok: false, reason: "目标城池无效。", columns: [] };
  if (!isHostileV2(state, state.player, target.owner)) {
    return { ok: false, reason: "协同合围目标须为敌对势力城池。", columns: [] };
  }

  const columns = [];
  for (const okKey of originKeys.slice(0, 4)) {
    const city = state.cities[okKey];
    if (!city || city.owner !== state.player) continue;
    const avail = availableOfficersInCity(state, okKey, state.player);
    if (!avail.length) continue;
    const maxSend = Math.max(0, city.troops - MIN_GARRISON_LEAVE);
    const troops = Math.min(maxSend, Math.max(MIN_DISPATCH_TROOPS, Math.round(maxSend * clamp(troopRatio, 0.35, 0.9))));
    if (troops < MIN_DISPATCH_TROOPS || maxSend < MIN_DISPATCH_TROOPS) continue;

    const off = avail[0];
    const fc = forecastDispatch(world, state, {
      from: okKey,
      to: targetCity,
      troops,
      troopType: city.troopType,
      officer: off.key,
      formation,
    });
    if (!fc.ok) continue;
    columns.push({
      from: okKey,
      fromName: cityNameV2(world, okKey),
      officerKey: off.key,
      officerName: off.name,
      troopType: city.troopType,
      troops,
      route: fc.route,
      dekads: fc.dekads,
      grainCost: fc.grainCost,
      delayDekads: 0,
    });
  }

  if (!columns.length) {
    return { ok: false, reason: "所选起点城池暂无充足可用兵马或闲置主将。", columns: [] };
  }

  const maxDekads = Math.max(...columns.map((c) => c.dekads));
  let totalTroops = 0;
  let totalGrain = 0;
  for (const col of columns) {
    col.delayDekads = syncArrival ? Math.max(0, maxDekads - col.dekads) : 0;
    totalTroops += col.troops;
    totalGrain += col.grainCost;
  }

  return {
    ok: true,
    targetCity,
    formation: FORMATIONS_V2[formation] ? formation : "heyi",
    syncArrival: Boolean(syncArrival),
    columns,
    maxDekads,
    totalTroops,
    totalGrain,
  };
}

export function launchCoordinatedAttack(world, state, opts) {
  const plan = planCoordinatedAttack(world, state, opts);
  if (!plan.ok) throw new Error(plan.reason || "当前无法发起多城协同合围。");

  const next = structuredClone(state);
  const fac = next.factions[next.player];
  if ((fac?.grain ?? 0) < plan.totalGrain) {
    throw new Error(`此协同出兵共需军粮 ${plan.totalGrain} 石，当前储备不足。`);
  }

  const launchedNames = [];
  for (const col of plan.columns) {
    const city = next.cities[col.from];
    const off = next.officers[col.officerKey];
    if (!city || !off || city.troops - col.troops < MIN_GARRISON_LEAVE || off.armyId) continue;

    city.troops -= col.troops;
    fac.grain -= col.grainCost;
    if (city.governor === off.key) city.governor = null;
    if (city.commander === off.key) city.commander = null;
    off.city = null;

    const army = createArmyRecord(world, next, {
      faction: next.player,
      from: col.from,
      route: col.route,
      officerKey: off.key,
      troops: col.troops,
      troopType: col.troopType,
      stance: "attack",
      siegeStance: "storm",
      formation: plan.formation,
      delayDekads: col.delayDekads,
    });
    off.armyId = army.id;
    next.armies.push(army);
    launchedNames.push(`${col.fromName}(${off.name})`);
  }

  if (!launchedNames.length) throw new Error("出征调度失败，请确认前线余粮及将领状态。");

  const ev = {
    turn: next.turn,
    kind: "dispatch",
    faction: next.player,
    city: plan.targetCity,
    pos: cityByKey(world, plan.targetCity)?.position,
    text: `🎺 多城协同合围！${launchedNames.join("、")}共 ${launchedNames.length} 路 ${plan.totalTroops.toLocaleString()} 人直扑「${cityNameV2(world, plan.targetCity)}」（${plan.syncArrival ? `同旬齐至 · ${plan.maxDekads} 旬` : "各速进发"}）！`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

// ===== 3. 批量城政调整 =====

export function batchSetCityPolicy(state, cityKeys = [], policyId) {
  if (!CITY_POLICIES[policyId]) throw new Error("未知治城方针。");
  const next = structuredClone(state);
  let count = 0;
  for (const ck of cityKeys) {
    const c = next.cities[ck];
    if (c && c.owner === next.player) {
      c.policy = policyId;
      count += 1;
    }
  }
  if (!count) throw new Error("未选中任何己方城池。");
  const ev = {
    turn: next.turn,
    kind: "system",
    faction: next.player,
    text: `🏛️ 统一布政：已将 ${count} 座城池治城方针批量定为「${CITY_POLICIES[policyId].name}」。`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

// ===== 4. 反霸包围网（阻止后期单调平推） =====

export function updateAntiHegemonCoalition(world, state, events = []) {
  const playerCount = Object.values(state.cities).filter((c) => c.owner === state.player).length;
  const stage = playerCount >= 26 ? 2 : playerCount >= 16 ? 1 : 0;
  if (stage <= (state.coalitionAlertLevel || 0)) return;

  state.coalitionAlertLevel = stage;
  const rivals = Object.keys(state.factions || {}).filter((fk) => fk !== state.player
    && Object.values(state.cities).some((c) => c.owner === fk));
  if (rivals.length < 2) return;

  for (let i = 0; i < rivals.length; i += 1) {
    for (let j = i + 1; j < rivals.length; j += 1) {
      const a = rivals[i];
      const b = rivals[j];
      const existing = activeTreaty(state, a, b);
      if (stage === 2 || !existing) {
        state.treaties = (state.treaties || []).filter((t) => !(t.sides.includes(a) && t.sides.includes(b)));
        state.treaties.push({
          kind: stage === 2 ? "alliance" : "truce",
          sides: [a, b].sort(),
          expires: state.turn + 27,
        });
      }
    }
  }

  for (const fk of rivals) {
    state.factions[fk].morale = clamp(state.factions[fk].morale + (stage === 2 ? 10 : 6), 40, 100);
  }

  events.push({
    turn: state.turn,
    kind: "diplomacy",
    text: stage === 2
      ? `🔥 【天下反霸大同盟】我军雄跨二十六城震动九州！剩余诸侯尽释前嫌缔结死盟，正四方合兵反扑！`
      : `⚠️ 【诸侯合纵警戒】我朝领地扩至十六城以上，周边群雄纷纷密约停战共抗我师！`,
  });
}
