// 经略三国 5.0 — 军团都督委任 / 地方州牧委任 / 极简一键出征 / 地方直接征兵

import {
  CITY_POLICIES, FORMATIONS_V2, MIN_DISPATCH_TROOPS, MIN_GARRISON_LEAVE,
  activeTreaty, availableOfficersInCity, cityByKey, cityNameV2, clamp,
  createArmyRecord, factionNameV2, findRoadPath, forecastDispatch, isHostileV2,
} from "./constants.js";
import {
  CITY_BUILDINGS_V4, buildingBuildDekads, buildingUpgradeCost, cityTierInfo,
  computeCourtBonuses, computeRegionalGovernorBonus, ensureV4State, upgradeCityBuilding,
} from "./court.js";

export const CORPS_MISSIONS = {
  conquer_city: {
    id: "conquer_city",
    name: "攻略名城",
    icon: "🎯",
    summary: "集结本军团兵马与将领，自动整编出征并围攻指定敌城；克城后自动纳入本军团镇守。",
  },
  conquer_faction: {
    id: "conquer_faction",
    name: "征讨敌藩",
    icon: "⚔️",
    summary: "都督自主研判敌情，择机攻打指定敌对势力的前沿城池并协防反击。",
  },
  defend: {
    id: "defend",
    name: "固守防线",
    icon: "🛡️",
    summary: "专责守御辖区：优先调兵补防前线、自动驰援辖区受围城池，不贸然跨界进攻。",
  },
  logistics: {
    id: "logistics",
    name: "后勤蓄力",
    icon: "🚚",
    summary: "专注休养整备，每月初自动从辖区富余城池向指定重镇或前线输送兵员补给。",
  },
};

export const GOVERNOR_DIRECTIVES = {
  develop: {
    id: "develop",
    name: "劝课农商",
    icon: "🌾",
    summary: "优先扩建农垦田庄、市肆盐铁与郡学，统调农商方针，厚植一州财赋与治安。",
  },
  recruit: {
    id: "recruit",
    name: "练兵蓄锐",
    icon: "⚔️",
    summary: "优先扩建军械工坊与直接募兵，为前线军团源源不断输送强兵。",
  },
  balanced: {
    id: "balanced",
    name: "文武兼修",
    icon: "⚖️",
    summary: "兼顾农商基建、治安维护与稳步征兵，全面壮大州郡根基。",
  },
};

export const AUTO_PAUSE_MODES = {
  major: {
    id: "major",
    name: "重大战报(默认)",
    summary: "仅在我方城池被围、城池易手或历史抉择时自动暂停，野战/战法不打断推演。",
  },
  never: {
    id: "never",
    name: "连续推演",
    summary: "仅在重大抉择弹窗或战局结束时暂停，适合宏观全托管看大势。",
  },
  all: {
    id: "all",
    name: "遇战即停",
    summary: "所有涉及我军的野战、围城、战法与断粮事件均暂停提示。",
  },
};

function clearOfficerCityRole(state, officerKey) {
  for (const c of Object.values(state.cities || {})) {
    if (c.governor === officerKey) c.governor = null;
    if (c.commander === officerKey) c.commander = null;
  }
}

function relocateIdleOfficer(state, officerKey, destCityKey, { makeCommanderIfEmpty = false } = {}) {
  const off = state.officers?.[officerKey];
  const dest = state.cities?.[destCityKey];
  if (!off || !dest || off.armyId || off.capturedBy) return false;
  clearOfficerCityRole(state, officerKey);
  off.transferringTo = null;
  off.transferEta = 0;
  off.city = destCityKey;
  if (makeCommanderIfEmpty && !dest.commander) {
    dest.commander = officerKey;
  }
  return true;
}

/**
 * 预览城池立即征兵的数量、消耗与可行性
 */
export function previewCityRecruit(state, cityKey, actorFaction = state?.player) {
  const city = state?.cities?.[cityKey];
  const goldCost = 22;
  const grainCost = 16;
  if (!city || city.owner !== actorFaction) {
    return { ok: false, reason: "仅可于己方城池征募新兵。", goldCost, grainCost, amount: 0, cap: 0 };
  }
  const b = city.buildings || { farm: 1, market: 1, workshop: 0, academy: 0 };
  const tier = cityTierInfo(city);
  const cap = 2400 + tier.level * 480 + (b.farm || 0) * CITY_BUILDINGS_V4.farm.troopCapPerLv;
  if (state.sieges?.[cityKey]) {
    return { ok: false, reason: "城池正遭敌军围困，无法开营募兵。", goldCost, grainCost, amount: 0, cap };
  }
  const missing = Math.max(0, cap - (city.troops || 0));
  if (missing <= 0) {
    return { ok: false, reason: "本城兵力已达兵源上限（可扩建农垦提升上限）。", goldCost, grainCost, amount: 0, cap };
  }
  const order = Number.isFinite(city.publicOrder) ? city.publicOrder : 78;
  if (order < 30) {
    return { ok: false, reason: "本城治安过低（低于 30），强行征兵恐生民变。", goldCost, grainCost, amount: 0, cap };
  }
  const gov = city.governor ? state.officers?.[city.governor] : null;
  const govBonus = 1 + ((gov?.governance ?? 55) - 55) * 0.004;
  const court = computeCourtBonuses(state, actorFaction);
  const regGov = computeRegionalGovernorBonus(state, city);
  const rawAmt = Math.round(
    (340 + (b.workshop || 0) * 65 + (tier.level - 1) * 45)
    * govBonus * court.recruitMult * regGov.recruitMult,
  );
  const amount = Math.min(missing, Math.max(80, rawAmt));
  const fac = state.factions?.[actorFaction];
  if (!fac || fac.treasury < goldCost || fac.grain < grainCost) {
    return { ok: false, reason: `募兵需国库 ${goldCost} 钱、军粮 ${grainCost} 石。`, goldCost, grainCost, amount, cap };
  }
  return { ok: true, reason: "", goldCost, grainCost, amount, cap };
}

/**
 * 城池直接耗费钱粮立即募兵
 */
export function recruitCityTroops(world, state, cityKey, { actorFaction = state.player, silent = false } = {}) {
  const next = ensureV4State(structuredClone(state));
  const prev = previewCityRecruit(next, cityKey, actorFaction);
  if (!prev.ok) throw new Error(prev.reason);

  const city = next.cities[cityKey];
  const fac = next.factions[actorFaction];
  fac.treasury -= prev.goldCost;
  fac.grain -= prev.grainCost;
  city.troops += prev.amount;
  city.publicOrder = clamp((Number.isFinite(city.publicOrder) ? city.publicOrder : 78) - 3, 0, 100);

  if (!silent && actorFaction === next.player) {
    const ev = {
      turn: next.turn,
      kind: "order",
      faction: actorFaction,
      city: cityKey,
      pos: cityByKey(world, cityKey)?.position,
      text: `⚔️ 地方征兵：「${cityNameV2(world, cityKey)}」募得新兵 +${prev.amount.toLocaleString()} 人（耗 ${prev.goldCost}钱/${prev.grainCost}粮，治安 -3）。`,
    };
    next.events = [...(next.events || []), ev].slice(-80);
    next.lastTurnEvents = [ev];
  }
  return next;
}

/**
 * 预览「极简一键委任出征」自动挑选的主副将、阵型与预测
 */
export function previewSmartDispatch(world, state, { from, to, troopRatio = 0.65 }) {
  const fromCity = state?.cities?.[from];
  const toCity = state?.cities?.[to];
  if (!fromCity || !toCity || fromCity.owner !== state.player || from === to) {
    return { ok: false, reason: "请选择有效出发地与目标城池。" };
  }
  const maxSend = Math.max(0, (fromCity.troops || 0) - MIN_GARRISON_LEAVE);
  if (maxSend < MIN_DISPATCH_TROOPS) {
    return { ok: false, reason: `驻军需至少保留 ${MIN_GARRISON_LEAVE} 留守，当前余兵不足出征。` };
  }
  const avail = availableOfficersInCity(state, from, state.player)
    .slice()
    .sort((a, b) => (b.command * 1.2 + b.might * 0.85) - (a.command * 1.2 + a.might * 0.85));
  if (!avail.length) {
    return { ok: false, reason: "当前城内暂无空闲武将可用，可调将或从军团拨入。" };
  }

  const officer = avail[0];
  const deputy = avail.length >= 2 ? avail[1] : null;
  const friendly = toCity.owner === state.player || activeTreaty(state, state.player, toCity.owner)?.kind === "alliance";
  const formation = friendly ? "changshe"
    : (toCity.wall >= 300 ? "chongche"
      : (officer.command >= 85 ? "fengshi" : "heyi"));
  const siegeStance = (toCity.wall > toCity.wallMax * 0.65 && fromCity.troopType !== "siege") ? "surround" : "storm";
  const troops = clamp(
    Math.round((maxSend * clamp(troopRatio, 0.35, 1)) / 50) * 50,
    MIN_DISPATCH_TROOPS,
    maxSend,
  );

  const fc = forecastDispatch(world, state, {
    from,
    to,
    troops,
    troopType: fromCity.troopType,
    officer: officer.key,
    formation,
  });
  return {
    ok: fc.ok,
    reason: fc.reason,
    officer,
    deputy,
    troops,
    troopType: fromCity.troopType,
    formation,
    siegeStance,
    forecast: fc,
  };
}

/**
 * 极简一键委任出征（自动择将、布阵并进发）
 */
export function smartAutoDispatch(world, state, { from, to, troopRatio = 0.65 }, dispatchFn) {
  const plan = previewSmartDispatch(world, state, { from, to, troopRatio });
  if (!plan.ok) throw new Error(plan.reason || "当前无法一键委任出征。");
  return dispatchFn(world, state, {
    from,
    to,
    officer: plan.officer.key,
    deputy: plan.deputy?.key || null,
    formation: plan.formation,
    troops: plan.troops,
    troopType: plan.troopType,
    siegeStance: plan.siegeStance,
  });
}

/**
 * 查询某座城池归属的委任军团
 */
export function getCorpsForCity(state, cityKey) {
  return (state?.corps || []).find((c) => (c.cities || []).includes(cityKey)) || null;
}

/**
 * 查询某军团当前统辖的在籍将领（城内驻守 + 在途出征）
 */
export function getOfficersInCorps(state, corpsId) {
  const corps = (state?.corps || []).find((c) => c.id === corpsId);
  if (!corps) return { stationed: [], marching: [], all: [] };
  const citySet = new Set(corps.cities || []);
  const activeCorpsArmies = new Set(
    (state.armies || []).filter((a) => a.faction === state.player && a.corpsId === corpsId && a.troops > 0).map((a) => a.id),
  );
  const stationed = [];
  const marching = [];
  for (const o of Object.values(state.officers || {})) {
    if (o.faction !== state.player || o.capturedBy) continue;
    if (o.armyId && activeCorpsArmies.has(o.armyId)) {
      marching.push(o);
    } else if (!o.armyId && !o.transferringTo && citySet.has(o.city)) {
      stationed.push(o);
    }
  }
  const byPower = (a, b) => (b.command + b.might) - (a.command + a.might);
  stationed.sort(byPower);
  marching.sort(byPower);
  return { stationed, marching, all: [...stationed, ...marching] };
}

/**
 * 创建一支新的委任军团
 */
export function createCorps(world, state, {
  name,
  commanderKey,
  cityKeys = [],
  mission = "defend",
  targetCity = null,
  targetFaction = null,
  supplyToCity = null,
  allowRecruit = true,
}) {
  if (!CORPS_MISSIONS[mission]) throw new Error("未知军团战略任务。");
  const next = ensureV4State(structuredClone(state));
  const player = next.player;

  const cmd = next.officers?.[commanderKey];
  if (!cmd || cmd.faction !== player || cmd.capturedBy) {
    throw new Error("须择定麾下在籍将领担任军团都督。");
  }
  if (next.corps.some((c) => c.commanderKey === commanderKey)) {
    throw new Error(`「${cmd.name}」已统领另一支军团，不可兼任两军团都督。`);
  }

  const cleanCities = [...new Set(cityKeys)].filter((ck) => next.cities?.[ck]?.owner === player);
  if (!cleanCities.length) {
    throw new Error("请至少为该军团划定 1 座己方城池作为辖区。");
  }

  const assignedSet = new Set(cleanCities);
  for (const existing of next.corps) {
    existing.cities = (existing.cities || []).filter((ck) => !assignedSet.has(ck));
  }

  if (!cmd.armyId && !assignedSet.has(cmd.city)) {
    relocateIdleOfficer(next, commanderKey, cleanCities[0], { makeCommanderIfEmpty: true });
  }

  const id = `corps-${next.nextCorpsSeq++}`;
  const resolvedName = String(name || "").trim() || `${cityNameV2(world, cleanCities[0])}军团`;
  const corps = {
    id,
    name: resolvedName,
    commanderKey,
    cities: cleanCities,
    mission,
    targetCity: mission === "conquer_city" ? (targetCity || null) : null,
    targetFaction: mission === "conquer_faction" ? (targetFaction || null) : null,
    supplyToCity: mission === "logistics" ? (supplyToCity || null) : null,
    allowRecruit: allowRecruit !== false,
  };
  next.corps.push(corps);

  const mSpec = CORPS_MISSIONS[mission];
  const ev = {
    turn: next.turn,
    kind: "system",
    faction: player,
    text: `🚩 设立军团：拜「${cmd.name}」为【${resolvedName}】都督（${mSpec.icon}${mSpec.name}，辖 ${cleanCities.map((k) => cityNameV2(world, k)).join("、")}）。`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

/**
 * 修改既有军团的都督、使命或辖区配置
 */
export function updateCorps(world, state, corpsId, patch = {}) {
  const next = ensureV4State(structuredClone(state));
  const corps = next.corps.find((c) => c.id === corpsId);
  if (!corps) throw new Error("未找到指定军团。");
  const player = next.player;

  if (patch.name !== undefined) {
    const trimmed = String(patch.name).trim();
    if (trimmed) corps.name = trimmed;
  }
  if (patch.mission !== undefined) {
    if (!CORPS_MISSIONS[patch.mission]) throw new Error("未知军团任务类型。");
    corps.mission = patch.mission;
  }
  if (patch.targetCity !== undefined) corps.targetCity = patch.targetCity || null;
  if (patch.targetFaction !== undefined) corps.targetFaction = patch.targetFaction || null;
  if (patch.supplyToCity !== undefined) corps.supplyToCity = patch.supplyToCity || null;
  if (patch.allowRecruit !== undefined) corps.allowRecruit = Boolean(patch.allowRecruit);

  if (patch.cityKeys !== undefined) {
    const cleanCities = [...new Set(patch.cityKeys)].filter((ck) => next.cities?.[ck]?.owner === player);
    if (!cleanCities.length) throw new Error("军团须至少保留 1 座己方城池。");
    const assignedSet = new Set(cleanCities);
    for (const other of next.corps) {
      if (other.id !== corpsId) {
        other.cities = (other.cities || []).filter((ck) => !assignedSet.has(ck));
      }
    }
    corps.cities = cleanCities;
  }

  if (patch.commanderKey !== undefined && patch.commanderKey !== corps.commanderKey) {
    const cmd = next.officers?.[patch.commanderKey];
    if (!cmd || cmd.faction !== player || cmd.capturedBy) {
      throw new Error("须择定麾下在籍将领担任军团都督。");
    }
    if (next.corps.some((c) => c.id !== corpsId && c.commanderKey === patch.commanderKey)) {
      throw new Error(`「${cmd.name}」已统领另一支军团。`);
    }
    corps.commanderKey = patch.commanderKey;
    if (!cmd.armyId && corps.cities.length && !corps.cities.includes(cmd.city)) {
      relocateIdleOfficer(next, patch.commanderKey, corps.cities[0], { makeCommanderIfEmpty: true });
    }
  }

  const mSpec = CORPS_MISSIONS[corps.mission];
  const ev = {
    turn: next.turn,
    kind: "system",
    faction: player,
    text: `🚩 军团方略调整：【${corps.name}】方针已定为「${mSpec.icon}${mSpec.name}」。`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

/**
 * 将单座城池划归指定军团或收回直辖
 */
export function assignCityToCorps(world, state, cityKey, corpsIdOrNull) {
  const next = ensureV4State(structuredClone(state));
  const city = next.cities?.[cityKey];
  if (!city || city.owner !== next.player) throw new Error("仅可调整己方城池归属。");

  for (const c of next.corps) {
    c.cities = (c.cities || []).filter((ck) => ck !== cityKey);
  }
  let targetCorps = null;
  if (corpsIdOrNull) {
    targetCorps = next.corps.find((c) => c.id === corpsIdOrNull);
    if (!targetCorps) throw new Error("指定军团不存在。");
    targetCorps.cities.push(cityKey);
  }

  const ev = {
    turn: next.turn,
    kind: "system",
    faction: next.player,
    text: targetCorps
      ? `🚩 城池归建：已将「${cityNameV2(world, cityKey)}」划入【${targetCorps.name}】统辖。`
      : `👑 收归直辖：「${cityNameV2(world, cityKey)}」已归主公直接调度。`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

/**
 * 解散委任军团（辖下城池自动归主公直辖）
 */
export function disbandCorps(state, corpsId) {
  const next = ensureV4State(structuredClone(state));
  const target = next.corps.find((c) => c.id === corpsId);
  if (!target) throw new Error("未找到指定军团。");
  next.corps = next.corps.filter((c) => c.id !== corpsId);
  for (const a of next.armies || []) {
    if (a.corpsId === corpsId) a.corpsId = null;
  }
  const ev = {
    turn: next.turn,
    kind: "system",
    faction: next.player,
    text: `👑 裁撤军团：【${target.name}】兵符收回中枢，所部城池回归主公直辖。`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

/**
 * 将空闲武将直接输送划拨给指定军团辖区驻防
 */
export function sendOfficerToCorps(world, state, officerKey, corpsId, preferredCityKey = null) {
  const next = ensureV4State(structuredClone(state));
  const corps = next.corps.find((c) => c.id === corpsId);
  if (!corps || !corps.cities.length) throw new Error("该军团暂无有效辖区城池。");

  const off = next.officers?.[officerKey];
  if (!off || off.faction !== next.player || off.capturedBy || off.armyId) {
    throw new Error("所选武将须处于在籍空闲状态（不可正在行军或被俘）。");
  }

  let destKey = preferredCityKey && corps.cities.includes(preferredCityKey) ? preferredCityKey : null;
  if (!destKey) {
    const scored = corps.cities
      .map((ck) => {
        const idleHere = availableOfficersInCity(next, ck, next.player).length;
        const border = (cityByKey(world, ck)?.links || []).some(
          (nb) => next.cities[nb] && isHostileV2(next, next.player, next.cities[nb].owner),
        );
        return { ck, idleHere, border, troops: next.cities[ck]?.troops ?? 0 };
      })
      .sort((a, b) => a.idleHere - b.idleHere || Number(b.border) - Number(a.border) || b.troops - a.troops);
    destKey = scored[0].ck;
  }

  relocateIdleOfficer(next, officerKey, destKey, { makeCommanderIfEmpty: true });
  const ev = {
    turn: next.turn,
    kind: "order",
    faction: next.player,
    city: destKey,
    text: `🚀 输送武将：已将「${off.name}」拨入【${corps.name}】驻防「${cityNameV2(world, destKey)}」，听候都督调遣。`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

/**
 * 从军团召回一名空闲武将至中枢直辖城池
 */
export function recallOfficerFromCorps(world, state, officerKey, destCityKey = null) {
  const next = ensureV4State(structuredClone(state));
  const off = next.officers?.[officerKey];
  if (!off || off.faction !== next.player || off.capturedBy || off.armyId) {
    throw new Error("所选武将当前无法调回中枢。");
  }
  const curCorps = getCorpsForCity(next, off.city);
  const curSet = new Set(curCorps?.cities || []);
  const ownCities = Object.values(next.cities || {}).filter((c) => c.owner === next.player);
  let targetKey = destCityKey && next.cities[destCityKey]?.owner === next.player ? destCityKey : null;
  if (!targetKey) {
    targetKey = ownCities.find((c) => !curSet.has(c.key))?.key || ownCities[0]?.key;
  }
  if (!targetKey) throw new Error("暂无可供调回的己方城池。");

  relocateIdleOfficer(next, officerKey, targetKey, { makeCommanderIfEmpty: false });
  const ev = {
    turn: next.turn,
    kind: "order",
    faction: next.player,
    text: `📜 召回中枢：「${off.name}」已调回直辖城池「${cityNameV2(world, targetKey)}」。`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

export function setAutoPauseMode(state, mode) {
  if (!AUTO_PAUSE_MODES[mode]) throw new Error("未知推演暂停策略。");
  const next = ensureV4State(structuredClone(state));
  next.autoPauseMode = mode;
  return next;
}

/**
 * 按九州地域汇总玩家掌控的州郡信息与当前州牧委任状态
 */
export function getPlayerRegions(world, state) {
  const groups = new Map();
  for (const c of Object.values(state?.cities || {})) {
    if (c.owner !== state.player) continue;
    const reg = c.region || cityByKey(world, c.key)?.region || "中原与淮北";
    if (!groups.has(reg)) groups.set(reg, []);
    groups.get(reg).push(c);
  }
  const result = [];
  for (const [region, cities] of groups.entries()) {
    const sorted = cities.slice().sort((a, b) => b.troops - a.troops);
    const totalTroops = sorted.reduce((s, c) => s + (c.troops || 0), 0);
    const avgOrder = Math.round(sorted.reduce((s, c) => s + (Number.isFinite(c.publicOrder) ? c.publicOrder : 78), 0) / sorted.length);
    const govRec = state.governors?.[region] || null;
    const bonus = computeRegionalGovernorBonus(state, { ...sorted[0], region });
    result.push({
      region,
      cities: sorted,
      totalTroops,
      avgOrder,
      governorRec: bonus.officer ? govRec : null,
      officerObj: bonus.officer,
      bonus,
    });
  }
  return result.sort((a, b) => b.cities.length - a.cities.length || b.totalTroops - a.totalTroops);
}

/**
 * 任免地方州牧及州郡宏观施政方针
 */
export function appointRegionalGovernor(world, state, region, officerKey, directive = "balanced", budgetReserve = 60) {
  if (!GOVERNOR_DIRECTIVES[directive]) throw new Error("未知州牧施政方针。");
  const next = ensureV4State(structuredClone(state));
  const player = next.player;
  const hasRegionCity = Object.values(next.cities || {}).some(
    (c) => c.owner === player && (c.region || cityByKey(world, c.key)?.region) === region,
  );
  if (!hasRegionCity) throw new Error(`我朝当前在「${region}」尚未领有城池。`);

  if (!officerKey) {
    delete next.governors[region];
    const ev = {
      turn: next.turn,
      kind: "system",
      faction: player,
      text: `🏛️ 罢免州牧：「${region}」州牧印绶已收回，改由中枢直理。`,
    };
    next.events = [...(next.events || []), ev].slice(-80);
    next.lastTurnEvents = [ev];
    return next;
  }

  const off = next.officers?.[officerKey];
  if (!off || off.faction !== player || off.capturedBy) {
    throw new Error("须择定麾下在籍将领出任地方州牧。");
  }

  for (const [reg, rec] of Object.entries(next.governors)) {
    if (rec?.officer === officerKey && reg !== region) {
      delete next.governors[reg];
    }
  }

  next.governors[region] = {
    region,
    officer: officerKey,
    directive,
    budgetReserve: clamp(Math.round(Number(budgetReserve) || 60), 0, 500),
  };
  const dSpec = GOVERNOR_DIRECTIVES[directive];
  const ev = {
    turn: next.turn,
    kind: "system",
    faction: player,
    text: `🏛️ 州牧受印：拜「${off.name}」领「${region}」州牧（方针：${dSpec.icon}${dSpec.name}）。`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

function launchCorpsArmy(world, state, corps, fromCity, toCityKey, stance, route, grainCost, events, { allowDeputy = true, customText = null } = {}) {
  const player = state.player;
  const avail = availableOfficersInCity(state, fromCity.key, player)
    .slice()
    .sort((a, b) => (b.command * 1.2 + b.might * 0.85) - (a.command * 1.2 + a.might * 0.85));
  const off = avail[0];
  if (!off) return null;
  const deputy = (allowDeputy && avail.length >= 2) ? avail[1] : null;
  const maxSend = Math.max(0, (fromCity.troops || 0) - MIN_GARRISON_LEAVE);
  const troops = clamp(Math.round(maxSend * (stance === "reinforce" ? 0.6 : 0.72)), MIN_DISPATCH_TROOPS, Math.min(2400, maxSend));
  if (troops < MIN_DISPATCH_TROOPS || (state.factions[player]?.grain ?? 0) < grainCost) return null;

  fromCity.troops -= troops;
  state.factions[player].grain -= grainCost;
  clearOfficerCityRole(state, off.key);
  off.city = null;
  if (deputy) {
    clearOfficerCityRole(state, deputy.key);
    deputy.city = null;
  }
  const toCity = state.cities[toCityKey];
  const formation = stance === "reinforce" ? "changshe" : (toCity?.wall >= 300 ? "chongche" : "heyi");
  const siegeStance = (toCity && toCity.wall > toCity.wallMax * 0.65 && fromCity.troopType !== "siege") ? "surround" : "storm";
  const army = createArmyRecord(world, state, {
    faction: player,
    corpsId: corps.id,
    from: fromCity.key,
    route,
    officerKey: off.key,
    deputyKey: deputy?.key || null,
    troops,
    troopType: fromCity.troopType,
    stance,
    siegeStance,
    formation,
  });
  off.armyId = army.id;
  if (deputy) deputy.armyId = army.id;
  state.armies.push(army);

  events.push({
    turn: state.turn,
    kind: stance === "reinforce" ? "order" : "dispatch",
    faction: player,
    city: toCityKey,
    pos: cityByKey(world, fromCity.key)?.position,
    text: customText || `🚩【${corps.name}】都督号令：「${off.name}」自「${cityNameV2(world, fromCity.key)}」率 ${troops.toLocaleString()} 人${stance === "reinforce" ? "驰援" : "进剿"}「${cityNameV2(world, toCityKey)}」！`,
  });
  return army;
}

/**
 * 玩家委任军团每旬自主推演：统筹将领调度、受围驰援、攻城克敌与后勤输血
 */
export function runPlayerCorpsDekad(world, state, events = []) {
  const player = state?.player;
  const fac = state?.factions?.[player];
  if (!player || !fac || state.outcome !== "ongoing" || !Array.isArray(state.corps) || !state.corps.length) return;

  for (const corps of state.corps) {
    corps.cities = (corps.cities || []).filter((ck) => state.cities?.[ck]?.owner === player);
    if (!corps.cities.length) continue;

    // A. Intra-corps officer balancing (move surplus combat officer to officer-starved frontline city)
    const starvedFront = corps.cities.find((ck) => {
      const c = state.cities[ck];
      const urgent = state.sieges?.[ck] || (cityByKey(world, ck)?.links || []).some(
        (nb) => state.cities[nb] && isHostileV2(state, player, state.cities[nb].owner),
      );
      return urgent && c && c.troops >= 1100 && availableOfficersInCity(state, ck, player).length === 0;
    });
    if (starvedFront) {
      const donorPool = corps.cities
        .filter((ck) => ck !== starvedFront && !state.sieges?.[ck])
        .map((ck) => {
          const isRear = !(cityByKey(world, ck)?.links || []).some(
            (nb) => state.cities[nb] && isHostileV2(state, player, state.cities[nb].owner),
          );
          const avail = availableOfficersInCity(state, ck, player);
          return { ck, isRear, avail };
        })
        .find((d) => d.avail.length >= (d.isRear ? 1 : 2));
      if (donorPool) {
        const pick = donorPool.avail.slice().sort((a, b) => (b.command + b.might) - (a.command + a.might))[0];
        if (pick && relocateIdleOfficer(state, pick.key, starvedFront, { makeCommanderIfEmpty: true })) {
          events.push({
            turn: state.turn,
            kind: "order",
            faction: player,
            city: starvedFront,
            text: `🚩【${corps.name}】调将补防：都督拨派「${pick.name}」自「${cityNameV2(world, donorPool.ck)}」前赴「${cityNameV2(world, starvedFront)}」统兵！`,
          });
        }
      }
    }

    // B. Manage active corps field & siege armies
    const corpsArmies = (state.armies || []).filter((a) => a.faction === player && a.corpsId === corps.id && a.troops > 0);
    for (const a of corpsArmies) {
      if (a.stance !== "besiege") continue;
      const target = state.cities[a.targetCity];
      if (!target) continue;
      if (a.troops < 320 || a.morale < 25) {
        const safe = findRoadPath(world, state, player, a.targetCity, corps.cities[0], { allowEnemyEnd: false });
        if (safe && safe.length >= 2) {
          if (state.sieges?.[a.targetCity]) {
            state.sieges[a.targetCity].attackerArmyIds = state.sieges[a.targetCity].attackerArmyIds.filter((id) => id !== a.id);
          }
          a.stance = "retreat";
          a.route = safe;
          a.step = 0;
          a.from = safe[0];
          a.to = safe[1];
          a.targetCity = safe[safe.length - 1];
          a.progress = 0.08;
        }
      } else if (target.wall > target.wallMax * 0.55 && a.troopType !== "siege") {
        a.siegeStance = target.foodReserve > 40 ? "surround" : "storm";
      } else {
        a.siegeStance = "storm";
      }
    }

    const maxCorpsArmies = clamp(corps.cities.length, 1, 3);
    let dispatchedThisTurn = false;

    // C. Priority 1: Rescue any besieged city inside this corps
    if (corpsArmies.length < maxCorpsArmies) {
      const besiegedInCorps = corps.cities.filter((ck) => state.sieges?.[ck]);
      for (const cryKey of besiegedInCorps) {
        const already = (state.armies || []).some((a) => a.faction === player && a.targetCity === cryKey && a.stance === "reinforce");
        if (already) continue;
        const helper = corps.cities
          .map((ck) => state.cities[ck])
          .filter((c) => c && c.key !== cryKey && !state.sieges?.[c.key] && c.troops >= 1150 && availableOfficersInCity(state, c.key, player).length > 0)
          .sort((a, b) => b.troops - a.troops)
          .find((c) => findRoadPath(world, state, player, c.key, cryKey, { allowEnemyEnd: false, maxHops: 4 }));
        if (helper && fac.grain >= 12) {
          const route = findRoadPath(world, state, player, helper.key, cryKey, { allowEnemyEnd: false, maxHops: 4 });
          if (route && launchCorpsArmy(world, state, corps, helper, cryKey, "reinforce", route, 10, events)) {
            dispatchedThisTurn = true;
            break;
          }
        }
      }
    }

    // D. Priority 2: Execute corps strategic mission
    if (!dispatchedThisTurn && corpsArmies.length < maxCorpsArmies) {
      if (corps.mission === "conquer_city") {
        const tKey = corps.targetCity;
        const target = tKey ? state.cities[tKey] : null;
        if (!target) {
          corps.mission = "defend";
          corps.targetCity = null;
        } else if (target.owner === player) {
          for (const other of state.corps) {
            if (other.id !== corps.id) other.cities = (other.cities || []).filter((ck) => ck !== tKey);
          }
          if (!corps.cities.includes(tKey)) corps.cities.push(tKey);
          corps.mission = "defend";
          corps.targetCity = null;
          events.push({
            turn: state.turn,
            kind: "system",
            faction: player,
            city: tKey,
            text: `🎉【${corps.name}】克复「${cityNameV2(world, tKey)}」，攻略使命告捷并已转入固守防线！`,
          });
        } else if (isHostileV2(state, player, target.owner)) {
          const ongoingAtk = corpsArmies.filter((a) => a.targetCity === tKey && (a.stance === "attack" || a.stance === "besiege"));
          const ongoingTroops = ongoingAtk.reduce((s, a) => s + a.troops, 0);
          const allowExtraColumn = ongoingAtk.length === 0 || (ongoingAtk.length < 2 && target.troops >= 1800);
          if (allowExtraColumn && fac.grain >= 18) {
            let bestLaunch = null;
            for (const ck of corps.cities) {
              const c = state.cities[ck];
              if (!c || state.sieges?.[ck] || c.troops < 1300) continue;
              if (!availableOfficersInCity(state, ck, player).length) continue;
              const route = findRoadPath(world, state, player, ck, tKey, { allowEnemyEnd: true, maxHops: 4 });
              if (!route) continue;
              const sendAmt = Math.min(2400, Math.round((c.troops - MIN_GARRISON_LEAVE) * 0.72));
              if (sendAmt + ongoingTroops < target.troops * 0.72) continue;
              if (!bestLaunch || route.length < bestLaunch.route.length || sendAmt > bestLaunch.sendAmt) {
                bestLaunch = { city: c, route, sendAmt };
              }
            }
            if (bestLaunch) {
              const grainCost = Math.max(8, Math.ceil(bestLaunch.sendAmt / 220) * 2 * Math.max(1, bestLaunch.route.length - 1));
              if (fac.grain >= grainCost && launchCorpsArmy(world, state, corps, bestLaunch.city, tKey, "attack", bestLaunch.route, grainCost, events)) {
                dispatchedThisTurn = true;
              }
            } else if (state.turn % 3 === 0) {
              // Concentrate troops from rear corps city to closest spearhead inside corps
              const spearhead = corps.cities
                .map((ck) => ({ ck, route: findRoadPath(world, state, player, ck, tKey, { allowEnemyEnd: true, maxHops: 4 }) }))
                .filter((x) => x.route)
                .sort((a, b) => a.route.length - b.route.length)[0]?.ck;
              if (spearhead) {
                const donor = corps.cities
                  .map((ck) => state.cities[ck])
                  .filter((c) => c && c.key !== spearhead && !state.sieges?.[c.key] && c.troops >= 1550)
                  .sort((a, b) => b.troops - a.troops)
                  .find((c) => findRoadPath(world, state, player, c.key, spearhead, { allowEnemyEnd: false }));
                if (donor && fac.grain >= 10) {
                  const route = findRoadPath(world, state, player, donor.key, spearhead, { allowEnemyEnd: false });
                  const amt = clamp(donor.troops - 1000, 400, 700);
                  donor.troops -= amt;
                  fac.grain -= 6;
                  const convoy = createArmyRecord(world, state, {
                    faction: player,
                    corpsId: corps.id,
                    from: donor.key,
                    route,
                    officerKey: null,
                    escortName: `${corps.name}调兵`,
                    troops: amt,
                    troopType: donor.troopType,
                    stance: "reinforce",
                    formation: "changshe",
                  });
                  state.armies.push(convoy);
                  events.push({
                    turn: state.turn,
                    kind: "order",
                    faction: player,
                    text: `🚩【${corps.name}】前线集结：「${cityNameV2(world, donor.key)}」调拨 ${amt.toLocaleString()} 兵力赶赴「${cityNameV2(world, spearhead)}」准备攻城。`,
                  });
                }
              }
            }
          }
        }
      } else if (corps.mission === "conquer_faction") {
        const tf = corps.targetFaction;
        const rivalAlive = tf && Object.values(state.cities).some((c) => c.owner === tf);
        if (!rivalAlive) {
          corps.mission = "defend";
          corps.targetFaction = null;
          events.push({
            turn: state.turn,
            kind: "system",
            faction: player,
            text: `🎉【${corps.name}】所讨敌藩已灭，军团顺利转入固守防线！`,
          });
        } else if (isHostileV2(state, player, tf) && fac.grain >= 20) {
          let best = null;
          for (const ck of corps.cities) {
            const c = state.cities[ck];
            if (!c || state.sieges?.[ck] || c.troops < 1450) continue;
            if (!availableOfficersInCity(state, ck, player).length) continue;
            for (const target of Object.values(state.cities)) {
              if (target.owner !== tf) continue;
              const route = findRoadPath(world, state, player, ck, target.key, { allowEnemyEnd: true, maxHops: 2 });
              if (!route) continue;
              const alreadyAtk = corpsArmies.some((a) => a.targetCity === target.key);
              if (alreadyAtk) continue;
              const sendAmt = Math.min(2400, Math.round((c.troops - MIN_GARRISON_LEAVE) * 0.72));
              if (sendAmt < target.troops * 0.82) continue;
              const score = sendAmt - target.troops - route.length * 120;
              if (!best || score > best.score) best = { city: c, target, route, sendAmt, score };
            }
          }
          if (best) {
            const grainCost = Math.max(8, Math.ceil(best.sendAmt / 220) * 2 * Math.max(1, best.route.length - 1));
            if (fac.grain >= grainCost) {
              launchCorpsArmy(world, state, corps, best.city, best.target.key, "attack", best.route, grainCost, events);
              dispatchedThisTurn = true;
            }
          }
        }
      } else if (corps.mission === "defend" && state.turn % 3 === 0) {
        const weakBorder = corps.cities
          .map((ck) => state.cities[ck])
          .filter((c) => c && c.troops < 1300 && (cityByKey(world, c.key)?.links || []).some(
            (nb) => state.cities[nb] && isHostileV2(state, player, state.cities[nb].owner),
          ))
          .sort((a, b) => a.troops - b.troops)[0];
        if (weakBorder) {
          const donor = corps.cities
            .map((ck) => state.cities[ck])
            .filter((c) => c && c.key !== weakBorder.key && !state.sieges?.[c.key] && c.troops >= 1700)
            .sort((a, b) => b.troops - a.troops)
            .find((c) => !(cityByKey(world, c.key)?.links || []).some((nb) => state.cities[nb] && isHostileV2(state, player, state.cities[nb].owner))
              && findRoadPath(world, state, player, c.key, weakBorder.key, { allowEnemyEnd: false }));
          if (donor && fac.grain >= 10) {
            const route = findRoadPath(world, state, player, donor.key, weakBorder.key, { allowEnemyEnd: false });
            const amt = clamp(donor.troops - 1100, 450, 650);
            donor.troops -= amt;
            fac.grain -= 6;
            const convoy = createArmyRecord(world, state, {
              faction: player,
              corpsId: corps.id,
              from: donor.key,
              route,
              officerKey: null,
              escortName: `${corps.name}固防`,
              troops: amt,
              troopType: donor.troopType,
              stance: "reinforce",
              formation: "changshe",
            });
            state.armies.push(convoy);
            events.push({
              turn: state.turn,
              kind: "order",
              faction: player,
              text: `🛡️【${corps.name}】巩固防线：「${cityNameV2(world, donor.key)}」发兵 ${amt.toLocaleString()} 人补防前线「${cityNameV2(world, weakBorder.key)}」。`,
            });
          }
        }
      } else if (corps.mission === "logistics" && state.turn % 3 === 0) {
        let destKey = (corps.supplyToCity && state.cities[corps.supplyToCity]?.owner === player) ? corps.supplyToCity : null;
        if (!destKey) {
          destKey = Object.values(state.cities)
            .filter((c) => c.owner === player && (cityByKey(world, c.key)?.links || []).some((nb) => state.cities[nb] && isHostileV2(state, player, state.cities[nb].owner)))
            .sort((a, b) => a.troops - b.troops)[0]?.key;
        }
        if (destKey) {
          const donor = corps.cities
            .map((ck) => state.cities[ck])
            .filter((c) => c && c.key !== destKey && !state.sieges?.[c.key] && c.troops >= 1500)
            .sort((a, b) => b.troops - a.troops)
            .find((c) => findRoadPath(world, state, player, c.key, destKey, { allowEnemyEnd: false }));
          if (donor && fac.grain >= 10) {
            const route = findRoadPath(world, state, player, donor.key, destKey, { allowEnemyEnd: false });
            const amt = clamp(donor.troops - 950, 450, 700);
            donor.troops -= amt;
            fac.grain -= 6;
            const convoy = createArmyRecord(world, state, {
              faction: player,
              corpsId: corps.id,
              from: donor.key,
              route,
              officerKey: null,
              escortName: `${corps.name}辎重`,
              troops: amt,
              troopType: donor.troopType,
              stance: "reinforce",
              formation: "changshe",
            });
            state.armies.push(convoy);
            events.push({
              turn: state.turn,
              kind: "order",
              faction: player,
              text: `🚚【${corps.name}】后勤输血：「${cityNameV2(world, donor.key)}」运送 ${amt.toLocaleString()} 名精兵驰援「${cityNameV2(world, destKey)}」。`,
            });
          }
        }
      }
    }

    // E. Optional corps autonomous recruitment on monthly boundary
    if (corps.allowRecruit !== false && state.turn % 3 === 0 && fac.treasury >= 90 && fac.grain >= 60) {
      const recTarget = corps.cities
        .map((ck) => state.cities[ck])
        .filter((c) => c && !state.sieges?.[c.key] && c.troops < 1300)
        .sort((a, b) => a.troops - b.troops)[0];
      if (recTarget && previewCityRecruit(state, recTarget.key, player).ok) {
        try {
          const recNext = recruitCityTroops(world, state, recTarget.key, { actorFaction: player, silent: true });
          const gained = recNext.cities[recTarget.key].troops - recTarget.troops;
          state.cities[recTarget.key] = recNext.cities[recTarget.key];
          fac.treasury = recNext.factions[player].treasury;
          fac.grain = recNext.factions[player].grain;
          events.push({
            turn: state.turn,
            kind: "order",
            faction: player,
            city: recTarget.key,
            text: `⚔️【${corps.name}】募兵补员：「${cityNameV2(world, recTarget.key)}」自募新兵 +${gained.toLocaleString()} 人。`,
          });
        } catch {
          // Ignore recruit failure
        }
      }
    }
  }
}

/**
 * 地方州牧每月依施政方针自动推进州郡基建、政策统筹与征兵
 */
export function runRegionalGovernorsMonthly(world, state, events = []) {
  const player = state?.player;
  const fac = state?.factions?.[player];
  if (!player || !fac || !state.governors) return;

  for (const [region, govRec] of Object.entries(state.governors)) {
    const off = govRec?.officer ? state.officers?.[govRec.officer] : null;
    if (!off || off.faction !== player || off.capturedBy) {
      delete state.governors[region];
      continue;
    }

    const regionCities = Object.values(state.cities || {}).filter(
      (c) => c.owner === player && (c.region || cityByKey(world, c.key)?.region) === region,
    );
    if (!regionCities.length) {
      delete state.governors[region];
      continue;
    }

    const directive = govRec.directive || "balanced";
    const reserve = govRec.budgetReserve ?? 60;

    // Gentle policy alignment for cities left on balanced
    for (const c of regionCities) {
      if (c.policy === "balanced" && directive === "develop") c.policy = "economy";
      else if (c.policy === "balanced" && directive === "recruit") c.policy = "recruit";
    }

    // 1. Auto-start 1 building construction in the region above budget reserve
    const trackOrder = directive === "develop"
      ? ["farm", "market", "academy", "workshop"]
      : directive === "recruit"
        ? ["workshop", "farm", "academy", "market"]
        : ["farm", "market", "workshop", "academy"];

    const buildCandidate = regionCities
      .filter((c) => !state.sieges?.[c.key] && !c.construction)
      .map((c) => {
        const b = c.buildings || { farm: 1, market: 1, workshop: 0, academy: 0 };
        const track = (c.publicOrder ?? 78) < 58 && (b.academy ?? 0) < 5
          ? "academy"
          : trackOrder.slice().sort((tA, tB) => (b[tA] ?? 0) - (b[tB] ?? 0))[0];
        const lv = b[track] ?? 0;
        if (lv >= 5) return null;
        const cost = buildingUpgradeCost(state, player, track, lv + 1);
        return { city: c, track, nextLv: lv + 1, cost };
      })
      .filter(Boolean)
      .sort((a, b) => a.cost - b.cost)[0];

    if (buildCandidate && fac.treasury >= reserve + buildCandidate.cost) {
      try {
        const built = upgradeCityBuilding(world, state, buildCandidate.city.key, buildCandidate.track, { actorFaction: player, silent: true });
        state.cities[buildCandidate.city.key] = built.cities[buildCandidate.city.key];
        fac.treasury = built.factions[player].treasury;
        const def = CITY_BUILDINGS_V4[buildCandidate.track];
        const dur = buildingBuildDekads(buildCandidate.nextLv);
        events.push({
          turn: state.turn,
          kind: "economy",
          faction: player,
          city: buildCandidate.city.key,
          text: `🏛️【${region}州牧·${off.name}】动工扩建「${cityNameV2(world, buildCandidate.city.key)}」${def.icon}${def.name} Lv.${buildCandidate.nextLv}（${dur}旬）。`,
        });
      } catch {
        // Ignore invalid build
      }
    }

    // 2. Auto-recruit if directive permits and treasury/grain comfortably above reserve
    if ((directive === "recruit" || directive === "balanced") && fac.treasury >= reserve + 30 && fac.grain >= 60) {
      const recPick = regionCities
        .filter((c) => {
          if (state.sieges?.[c.key] || (c.publicOrder ?? 78) < 45) return false;
          const prev = previewCityRecruit(state, c.key, player);
          return prev.ok && c.troops < prev.cap * 0.78;
        })
        .sort((a, b) => a.troops - b.troops)[0];

      if (recPick) {
        try {
          const recNext = recruitCityTroops(world, state, recPick.key, { actorFaction: player, silent: true });
          const gained = recNext.cities[recPick.key].troops - recPick.troops;
          state.cities[recPick.key] = recNext.cities[recPick.key];
          fac.treasury = recNext.factions[player].treasury;
          fac.grain = recNext.factions[player].grain;
          events.push({
            turn: state.turn,
            kind: "order",
            faction: player,
            city: recPick.key,
            text: `⚔️【${region}州牧·${off.name}】州郡募兵：「${cityNameV2(world, recPick.key)}」补兵 +${gained.toLocaleString()} 人。`,
          });
        } catch {
          // Ignore recruit error
        }
      }
    }
  }
}
