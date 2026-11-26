// v18.0 — 一城一貌：城池专属设施 & 地域奇观
// 状态挂在 state.saga.buildings 下，确保旧存档与非 century 模式 100% 兼容。

export const BUILDING_CATALOG = [
  {
    id: "tuntian",
    name: "屯田营",
    icon: "🌾",
    costTreasury: 45,
    costGrain: 10,
    summary: "本城产粮 +28%，显著缓解旱蝗灾损。",
    tag: "农政",
  },
  {
    id: "pasture",
    name: "马政牧场",
    icon: "🐎",
    costTreasury: 55,
    costGrain: 20,
    summary: "出征攻势 +12%（雍凉并幽等牧区 +18%），每季增补精锐 260 人。",
    tag: "骑政",
    preferredRegions: ["雍凉", "西凉", "并州", "幽州", "冀州", "司隶"],
  },
  {
    id: "shipyard",
    name: "水军船坞",
    icon: "⛵",
    costTreasury: 55,
    costGrain: 15,
    summary: "临江渡河水战 +18%，商税 +14%，水路出征减耗。",
    tag: "水师",
    preferredRegions: ["扬州", "荆州", "徐州", "益州", "交州", "江东"],
  },
  {
    id: "foundry",
    name: "锻造坊",
    icon: "⚒️",
    costTreasury: 60,
    costGrain: 10,
    summary: "本城出征与守御战力各 +10%，攻城破壁更利。",
    tag: "军械",
  },
  {
    id: "watchtower",
    name: "连弩箭楼",
    icon: "🏹",
    costTreasury: 50,
    costGrain: 15,
    summary: "守城战力 +18%，抵御敌军围城耗损 -35%。",
    tag: "城防",
  },
  {
    id: "academy",
    name: "太学书院",
    icon: "📜",
    costTreasury: 55,
    costGrain: 10,
    summary: "每季产出 +12 科技点（TP），并提升本城税收 +12%。",
    tag: "文治",
  },
  {
    id: "granary",
    name: "粮仓转运站",
    icon: "🏛️",
    costTreasury: 45,
    costGrain: 25,
    summary: "作为前沿补给枢纽（缩短远征粮道距离），抵御断粮奇袭时间减半。",
    tag: "后勤",
  },
];

export const WONDER_CATALOG = [
  {
    id: "bronze_sparrow",
    name: "铜雀台",
    cities: ["ye", "xuchang"],
    costTreasury: 160,
    costGrain: 60,
    summary: "全势力钱粮收入 +12%，每季额外 +15 TP，威震中原。",
  },
  {
    id: "wooden_ox",
    name: "木牛流马工坊",
    cities: ["chengdu", "hanzhong"],
    costTreasury: 150,
    costGrain: 70,
    summary: "全军跨城远征粮耗 -35%、补给距离 -1，围城效率显著提升。",
  },
  {
    id: "east_armada",
    name: "江东楼船坞",
    cities: ["jianye", "chaisang", "wu"],
    costTreasury: 155,
    costGrain: 60,
    summary: "全军水战攻防 +22%，商业税收 +15%。",
  },
  {
    id: "weiyang_court",
    name: "未央宫阙",
    cities: ["changan", "luoyang"],
    costTreasury: 170,
    costGrain: 60,
    summary: "每季稳增海内声望 +2，全势力钱粮 +10%，守御 +8%。",
  },
  {
    id: "jingzhou_fort",
    name: "荆襄铁壁",
    cities: ["xiangyang", "jiangling"],
    costTreasury: 150,
    costGrain: 65,
    summary: "全势力边境城防 +16%，敌军围城耗损减半。",
  },
  {
    id: "xiliang_stables",
    name: "凉州铁骑营",
    cities: ["wuwei", "tianshui", "anding"],
    costTreasury: 150,
    costGrain: 65,
    summary: "全军野战突击 +12%，每季自动增兵 500。",
  },
];

// 核心大城可开放 3 个设施槽，普通城池 2 个设施槽
const MAJOR_CITIES = new Set([
  "luoyang", "changan", "xuchang", "ye", "chengdu", "jianye", "xiangyang", "jiangling", "shouchun", "hanzhong", "pingyuan", "nanpi",
]);

export function citySlotLimit(cityKey) {
  return MAJOR_CITIES.has(cityKey) ? 3 : 2;
}

export function getBuildingsState(state) {
  const b = state?.saga?.buildings;
  return {
    cities: b?.cities && typeof b.cities === "object" ? b.cities : {},
    wonders: b?.wonders && typeof b.wonders === "object" ? b.wonders : {},
  };
}

function ensureBuildingsState(state) {
  if (!state.saga) state.saga = {};
  if (!state.saga.buildings || typeof state.saga.buildings !== "object") {
    state.saga.buildings = { cities: {}, wonders: {} };
  }
  if (!state.saga.buildings.cities) state.saga.buildings.cities = {};
  if (!state.saga.buildings.wonders) state.saga.buildings.wonders = {};
  return state.saga.buildings;
}

export function cityBuildings(state, cityKey) {
  const slots = state?.saga?.buildings?.cities?.[cityKey]?.slots;
  return Array.isArray(slots) ? slots : [];
}

export function wonderForCity(cityKey) {
  return WONDER_CATALOG.find((w) => w.cities.includes(cityKey)) || null;
}

export function builtWonderInCity(state, cityKey) {
  const wid = state?.saga?.buildings?.wonders?.[cityKey];
  return wid ? WONDER_CATALOG.find((w) => w.id === wid) || null : null;
}

export function factionOwnedWonders(state, factionId) {
  const wonders = state?.saga?.buildings?.wonders || {};
  const list = [];
  for (const [ck, wid] of Object.entries(wonders)) {
    if (state?.cities?.[ck]?.owner === factionId) {
      const w = WONDER_CATALOG.find((x) => x.id === wid);
      if (w) list.push({ ...w, cityKey: ck });
    }
  }
  return list;
}

/**
 * 建造城池常规设施
 */
export function constructBuilding(world, state, cityKey, buildingId, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可修筑城池设施。" };
  const city = state.cities?.[cityKey];
  if (!city || city.owner !== actor) return { ok: false, reason: "只能在己方城池修筑设施。" };
  const def = BUILDING_CATALOG.find((b) => b.id === buildingId);
  if (!def) return { ok: false, reason: "未知的设施类型。" };

  const current = cityBuildings(state, cityKey);
  if (current.includes(buildingId)) return { ok: false, reason: `该城已建有「${def.name}」。` };
  const limit = citySlotLimit(cityKey);
  if (current.length >= limit) return { ok: false, reason: `该城设施槽位已满（上限 ${limit} 处）。` };

  const faction = state.factions?.[actor];
  if (!faction || faction.treasury < def.costTreasury || faction.grain < def.costGrain) {
    return { ok: false, reason: `修筑「${def.name}」需要金 ${def.costTreasury}、粮 ${def.costGrain}。` };
  }

  const next = structuredClone(state);
  next.factions[actor].treasury -= def.costTreasury;
  next.factions[actor].grain -= def.costGrain;
  const bState = ensureBuildingsState(next);
  if (!bState.cities[cityKey]) bState.cities[cityKey] = { slots: [] };
  bState.cities[cityKey].slots.push(buildingId);

  const cname = world?.cities?.find((c) => c.key === cityKey)?.name || cityKey;
  return {
    ok: true,
    state: next,
    summary: `已在${cname}建成「${def.icon} ${def.name}」：${def.summary}`,
  };
}

/**
 * 修筑地域奇观
 */
export function constructWonder(world, state, cityKey, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可修筑地域奇观。" };
  const city = state.cities?.[cityKey];
  if (!city || city.owner !== actor) return { ok: false, reason: "只能在己方名城修筑奇观。" };
  const wonder = wonderForCity(cityKey);
  if (!wonder) return { ok: false, reason: "此城暂无可修筑的专属地域奇观。" };
  if (state?.saga?.buildings?.wonders?.[cityKey]) return { ok: false, reason: `此城已矗立「${wonder.name}」。` };

  // 同类奇观全图仅限一座
  const alreadyExists = Object.values(state?.saga?.buildings?.wonders || {}).includes(wonder.id);
  if (alreadyExists) return { ok: false, reason: `「${wonder.name}」已被天下豪杰筑成。` };

  const faction = state.factions?.[actor];
  if (!faction || faction.treasury < wonder.costTreasury || faction.grain < wonder.costGrain) {
    return { ok: false, reason: `修筑「${wonder.name}」需要金 ${wonder.costTreasury}、粮 ${wonder.costGrain}。` };
  }

  const next = structuredClone(state);
  next.factions[actor].treasury -= wonder.costTreasury;
  next.factions[actor].grain -= wonder.costGrain;
  const bState = ensureBuildingsState(next);
  bState.wonders[cityKey] = wonder.id;
  if (next.saga) {
    next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + 6);
  }

  const cname = world?.cities?.find((c) => c.key === cityKey)?.name || cityKey;
  return {
    ok: true,
    state: next,
    summary: `举国兴工，在${cname}落成奇观「${wonder.name}」！海内声望 +6。`,
  };
}

/**
 * 城池产出修正（供 engine.js cityRevenues 调用）
 */
export function buildingEconomyModifiers(state, cityKey) {
  if (!state?.century) return { treasuryMult: 1, grainMult: 1, tpBonus: 0 };
  const slots = cityBuildings(state, cityKey);
  const owner = state.cities?.[cityKey]?.owner;
  const wonders = owner ? factionOwnedWonders(state, owner) : [];

  let treasuryMult = 1;
  let grainMult = 1;
  let tpBonus = 0;

  if (slots.includes("tuntian")) grainMult += 0.28;
  if (slots.includes("shipyard")) treasuryMult += 0.14;
  if (slots.includes("academy")) {
    treasuryMult += 0.12;
    tpBonus += 12;
  }

  for (const w of wonders) {
    if (w.id === "bronze_sparrow") {
      treasuryMult += 0.12;
      grainMult += 0.12;
    } else if (w.id === "east_armada") {
      treasuryMult += 0.15;
    } else if (w.id === "weiyang_court") {
      treasuryMult += 0.1;
      grainMult += 0.1;
    }
  }

  return {
    treasuryMult: Number(treasuryMult.toFixed(3)),
    grainMult: Number(grainMult.toFixed(3)),
    tpBonus,
  };
}

/**
 * 城池与奇观战斗修正
 */
export function buildingCombatModifiers(world, state, { fromKey, toKey, attackerFaction, defenderFaction, terrain = "land" }) {
  if (!state?.century) return { attackMult: 1, defenseMult: 1, wallFactor: 1, notes: [] };
  const attSlots = fromKey ? cityBuildings(state, fromKey) : [];
  const defSlots = toKey ? cityBuildings(state, toKey) : [];
  const attWonders = attackerFaction ? factionOwnedWonders(state, attackerFaction) : [];
  const defWonders = defenderFaction ? factionOwnedWonders(state, defenderFaction) : [];

  let attackMult = 1;
  let defenseMult = 1;
  let wallFactor = 1;
  const notes = [];

  const fromRegion = world?.cities?.find((c) => c.key === fromKey)?.region || "";
  if (attSlots.includes("pasture")) {
    const isHorseRegion = BUILDING_CATALOG.find((b) => b.id === "pasture").preferredRegions.some((r) => fromRegion.includes(r));
    attackMult += isHorseRegion ? 0.18 : 0.12;
    notes.push(isHorseRegion ? "良马牧场精骑" : "马政牧场");
  }
  if (attSlots.includes("foundry")) {
    attackMult += 0.1;
    wallFactor *= 0.9;
    notes.push("锻造军械");
  }
  if (attSlots.includes("shipyard") && terrain === "river") {
    attackMult += 0.18;
    notes.push("楼船水师");
  }

  if (defSlots.includes("watchtower")) {
    defenseMult += 0.18;
    notes.push("连弩箭楼");
  }
  if (defSlots.includes("foundry")) {
    defenseMult += 0.1;
  }

  for (const w of attWonders) {
    if (w.id === "xiliang_stables") {
      attackMult += 0.12;
      notes.push("凉州铁骑营");
    }
    if (w.id === "east_armada" && terrain === "river") {
      attackMult += 0.22;
      notes.push("江东楼船坞");
    }
  }
  for (const w of defWonders) {
    if (w.id === "jingzhou_fort") {
      defenseMult += 0.16;
      notes.push("荆襄铁壁");
    }
    if (w.id === "weiyang_court") defenseMult += 0.08;
    if (w.id === "east_armada" && terrain === "river") defenseMult += 0.22;
  }

  return {
    attackMult: Number(attackMult.toFixed(3)),
    defenseMult: Number(defenseMult.toFixed(3)),
    wallFactor: Number(wallFactor.toFixed(3)),
    notes,
  };
}

/**
 * 季度结算：书院 TP 产出、牧场/铁骑营增兵、未央宫声望、以及 AI 适度自建
 */
export function settleBuildingsTurn(world, state) {
  if (!state?.century) return { state, notes: [] };
  const next = structuredClone(state);
  const notes = [];

  // 1. 结算玩家城池特殊设施季度收益
  const player = next.player;
  let extraTp = 0;
  for (const [ck, city] of Object.entries(next.cities || {})) {
    const slots = cityBuildings(next, ck);
    if (slots.includes("pasture")) {
      city.troops = Math.min(38000, city.troops + 260);
    }
    if (city.owner === player && slots.includes("academy")) {
      extraTp += 12;
    }
  }
  const playerWonders = factionOwnedWonders(next, player);
  for (const w of playerWonders) {
    if (w.id === "bronze_sparrow") extraTp += 15;
    if (w.id === "weiyang_court" && next.saga) next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + 2);
    if (w.id === "xiliang_stables") {
      const cap = next.cities?.[w.cityKey];
      if (cap) cap.troops = Math.min(42000, cap.troops + 500);
    }
  }
  if (extraTp > 0 && next.saga?.tech) {
    next.saga.tech.points = (next.saga.tech.points ?? 0) + extraTp;
    notes.push(`书院与奇观本季提供兵技点 +${extraTp} TP。`);
  }

  // 2. AI 势力每隔 2 季在富裕城池自建 1 项设施（保持生态鲜活）
  if ((next.turn ?? 1) % 2 === 0) {
    const bState = ensureBuildingsState(next);
    for (const [fid, fac] of Object.entries(next.factions || {})) {
      if (fid === player || (fac.treasury ?? 0) < 110 || (fac.grain ?? 0) < 60) continue;
      const owned = Object.entries(next.cities || {}).filter(([, c]) => c.owner === fid).map(([k]) => k);
      const targetKey = owned.find((k) => cityBuildings(next, k).length < citySlotLimit(k));
      if (!targetKey) continue;
      const existing = cityBuildings(next, targetKey);
      const pref = existing.length === 0 ? "tuntian" : !existing.includes("watchtower") ? "watchtower" : "foundry";
      const def = BUILDING_CATALOG.find((b) => b.id === pref);
      if (!def || existing.includes(def.id)) continue;
      fac.treasury -= def.costTreasury;
      fac.grain -= def.costGrain;
      if (!bState.cities[targetKey]) bState.cities[targetKey] = { slots: [] };
      bState.cities[targetKey].slots.push(def.id);
    }
  }

  return { state: next, notes };
}
