// 经略三国 4.0 — 郡国农商基建 / 税率与公共秩序 / 朝堂六卿官职 / 威望晋爵与三足鼎立

import {
  CITY_POLICIES, CITY_SPECIALTIES, DIFFICULTY_MODES, NATIONAL_DECREES_V2,
  cityNameV2, clamp, hashStr, isHostileV2,
} from "./constants.js";

export const CITY_BUILDINGS_V4 = {
  farm: {
    id: "farm",
    name: "农垦田庄",
    icon: "🌾",
    costs: [0, 26, 44, 68, 98, 138],
    grainBonusPerLv: 0.28,
    troopCapPerLv: 420,
    foodRefillPerLv: 4,
    prestigePerLv: 6,
    summary: "兴修水利与开垦官田：每级使本城军粮月产 +28%、兵源上限 +420、余粮补给 +4。",
  },
  market: {
    id: "market",
    name: "市肆盐铁",
    icon: "🏮",
    costs: [0, 28, 48, 72, 104, 145],
    treasuryBonusPerLv: 0.32,
    prestigePerLv: 8,
    summary: "设市聚商并掌盐铁专卖：每级使本城商税银两月产 +32%、国家威望 +8。",
  },
  workshop: {
    id: "workshop",
    name: "军械工坊",
    icon: "⚒️",
    costs: [0, 30, 52, 78, 112, 155],
    recruitPerLv: 0.16,
    combatBonusPerLv: 0.05,
    prestigePerLv: 7,
    summary: "冶铁造弩修造攻城械：每级募兵速度 +16%、守城及由此出征精锐战力 +5%。",
  },
  academy: {
    id: "academy",
    name: "郡学官署",
    icon: "🏛️",
    costs: [0, 24, 42, 64, 92, 130],
    orderPerLv: 5,
    wallPerLv: 65,
    corruptionCutPerLv: 0.03,
    prestigePerLv: 8,
    summary: "兴办太学清查户籍：每级月增治安 +5、城防上限 +65，并削减全国腐败率 3%。",
  },
};

export const CITY_TIERS_V4 = [
  { level: 1, minDev: 0, title: "县城" },
  { level: 2, minDev: 4, title: "郡治" },
  { level: 3, minDev: 8, title: "州府" },
  { level: 4, minDev: 12, title: "重镇" },
  { level: 5, minDev: 16, title: "霸都" },
];

export const TAX_LEVELS_V4 = {
  low: {
    id: "low",
    name: "轻徭薄赋",
    icon: "🕊️",
    treasuryMult: 0.78,
    grainMult: 1.1,
    orderDelta: 8,
    loyaltyDelta: 1,
    summary: "与民休息减免田租：商税 -22%，但军粮增产 +10%、全境治安每月 +8、将领忠义 +1。",
  },
  normal: {
    id: "normal",
    name: "常赋平税",
    icon: "⚖️",
    treasuryMult: 1.0,
    grainMult: 1.0,
    orderDelta: 2,
    loyaltyDelta: 0,
    summary: "依汉制什一而税：钱粮产出均衡，全境治安每月稳步回升 +2。",
  },
  high: {
    id: "high",
    name: "重敛征饷",
    icon: "💰",
    treasuryMult: 1.35,
    grainMult: 0.92,
    orderDelta: -7,
    loyaltyDelta: -1,
    summary: "加征战时军赋：商税急增 +35%，但农产 -8%、全境治安每月 -7，过低将引发流民叛乱。",
  },
};

export const COURT_OFFICES_V4 = {
  heir: {
    id: "heir",
    name: "储君 · 副主",
    icon: "👑",
    minRankIdx: 0,
    attr: "governance",
    auraSummary: "稳固社稷传承：依才干提升全势力威望 (+8%~+20%)，并在月末润物安抚全军将领忠义。",
  },
  chancellor: {
    id: "chancellor",
    name: "丞相 · 尚书令",
    icon: "📜",
    minRankIdx: 0,
    attr: "governance",
    auraSummary: "总揽百官庶政：全境基建扩建折扣至高 -25%、削减全国腐败，并加成外交折冲 (+6~+18)。",
  },
  grand_general: {
    id: "grand_general",
    name: "大将军",
    icon: "⚔️",
    minRankIdx: 0,
    attr: "command",
    auraSummary: "节制天下兵马：降低三军月度军饷与粮耗 (至高 -22%)，并提升全军野战与攻城锐气 (+4%~+14%)。",
  },
  grand_minister_agri: {
    id: "grand_minister_agri",
    name: "大司农",
    icon: "🌾",
    minRankIdx: 1,
    attr: "governance",
    auraSummary: "总督天下屯田粮储：全国军粮月产额外 +10%~+28%，优先主持军机处农垦与后勤建言。",
  },
  grand_minister_comm: {
    id: "grand_minister_comm",
    name: "大司徒",
    icon: "🏮",
    minRankIdx: 1,
    attr: "governance",
    auraSummary: "掌市易盐铁赋役：全国商税银两月产额外 +10%~+28%，助建兴商强藩。",
  },
  imperial_censor: {
    id: "imperial_censor",
    name: "御史大夫",
    icon: "⚖️",
    minRankIdx: 2,
    attr: "intellect",
    auraSummary: "整肃吏治监察百官：全境城池每月额外恢复治安 (+3~+9)，进一步削减腐败损耗。",
  },
};

export const PRESTIGE_RANKS_V4 = [
  { id: "prefect", minPrestige: 0, title: "郡守" },
  { id: "governor", minPrestige: 180, title: "州牧" },
  { id: "general", minPrestige: 380, title: "大将军" },
  { id: "chancellor", minPrestige: 650, title: "汉丞相" },
  { id: "king", minPrestige: 980, title: "封王建国" },
  { id: "emperor", minPrestige: 1380, title: "天子御极" },
];

export function defaultCityBuildings(city) {
  const h = hashStr(city?.key || "city");
  return {
    farm: 1,
    market: 1,
    workshop: (h % 3 === 0) ? 1 : 0,
    academy: (h % 4 === 0) ? 1 : 0,
  };
}

export function cityTierInfo(city) {
  const b = city?.buildings || { farm: 1, market: 1, workshop: 0, academy: 0 };
  const totalDev = (b.farm || 0) + (b.market || 0) + (b.workshop || 0) + (b.academy || 0);
  let cur = CITY_TIERS_V4[0];
  let nextAt = CITY_TIERS_V4[1].minDev;
  for (let i = 0; i < CITY_TIERS_V4.length; i += 1) {
    if (totalDev >= CITY_TIERS_V4[i].minDev) {
      cur = CITY_TIERS_V4[i];
      nextAt = CITY_TIERS_V4[i + 1]?.minDev ?? null;
    }
  }
  return { level: cur.level, title: cur.title, totalDev, nextAt };
}

export function ensureCityV4Fields(city) {
  if (!city) return city;
  if (!city.buildings) {
    city.buildings = defaultCityBuildings(city);
  } else {
    for (const tid of Object.keys(CITY_BUILDINGS_V4)) {
      city.buildings[tid] = clamp(Math.floor(Number(city.buildings[tid]) || 0), 0, 5);
    }
  }
  if (!Number.isFinite(city.publicOrder)) city.publicOrder = 78;
  else city.publicOrder = clamp(Math.round(city.publicOrder), 0, 100);
  city.level = Math.max(city.level || 1, cityTierInfo(city).level);
  return city;
}

export function computeCourtBonuses(state, factionKey) {
  const map = state?.courtOffices?.[factionKey] || {};
  const officers = state?.officers || {};
  const getValid = (oid) => {
    const k = map[oid];
    const o = k ? officers[k] : null;
    return o && o.faction === factionKey && !o.capturedBy ? o : null;
  };

  const heir = getValid("heir");
  const chan = getValid("chancellor");
  const gen = getValid("grand_general");
  const agri = getValid("grand_minister_agri");
  const comm = getValid("grand_minister_comm");
  const cens = getValid("imperial_censor");

  const chanGov = chan?.governance ?? 0;
  const genCmd = gen?.command ?? 0;
  const agriGov = agri?.governance ?? 0;
  const commGov = comm?.governance ?? 0;
  const censInt = cens ? (cens.intellect || cens.governance || 65) : 0;
  const heirStat = heir ? Math.max(heir.governance || 60, heir.command || 60) : 0;

  return {
    buildDiscount: chan ? clamp(1 - (0.08 + Math.max(0, chanGov - 50) * 0.0034), 0.72, 0.94) : 1,
    corruptionCut: (chan ? clamp(0.04 + Math.max(0, chanGov - 55) * 0.0022, 0.04, 0.14) : 0)
      + (cens ? clamp(0.05 + Math.max(0, censInt - 55) * 0.002, 0.05, 0.13) : 0),
    dealBonus: chan ? clamp(Math.round(6 + Math.max(0, chanGov - 55) * 0.26), 6, 18) : 0,
    combatMult: gen ? clamp(1 + 0.04 + Math.max(0, genCmd - 55) * 0.0022, 1.03, 1.14) : 1,
    upkeepDiscount: gen ? clamp(1 - (0.06 + Math.max(0, genCmd - 55) * 0.0035), 0.78, 0.95) : 1,
    grainMult: agri ? clamp(1 + 0.1 + Math.max(0, agriGov - 55) * 0.004, 1.08, 1.28) : 1,
    treasuryMult: comm ? clamp(1 + 0.1 + Math.max(0, commGov - 55) * 0.004, 1.08, 1.28) : 1,
    recruitMult: gen ? clamp(1 + 0.06 + Math.max(0, genCmd - 60) * 0.0025, 1.04, 1.16) : 1,
    orderBonus: cens ? clamp(Math.round(3 + Math.max(0, censInt - 55) * 0.14), 3, 9) : 0,
    prestigeMult: heir ? clamp(1 + 0.08 + Math.max(0, heirStat - 55) * 0.0026, 1.06, 1.2) : 1,
    heirLoyaltyMonthly: heir ? (heirStat >= 82 ? 2 : 1) : 0,
    holders: { heir, chancellor: chan, grand_general: gen, grand_minister_agri: agri, grand_minister_comm: comm, imperial_censor: cens },
  };
}

export function computeFactionPrestige(state, factionKey) {
  if (!state?.cities) return 0;
  let cityCount = 0;
  let totalDev = 0;
  for (const c of Object.values(state.cities)) {
    if (c.owner === factionKey) {
      cityCount += 1;
      const b = c.buildings || { farm: 1, market: 1, workshop: 0, academy: 0 };
      totalDev += (b.farm || 0) + (b.market || 0) + (b.workshop || 0) + (b.academy || 0);
    }
  }
  let wins = 0;
  for (const o of Object.values(state.officers || {})) {
    if (o.faction === factionKey && !o.capturedBy) wins += o.wins || 0;
  }
  const holdsEmp = Boolean(state.emperorCity && state.cities[state.emperorCity]?.owner === factionKey);
  const holdsSeal = state.sealFaction === factionKey;
  const raw = cityCount * 32 + totalDev * 12 + wins * 18 + (holdsEmp ? 120 : 0) + (holdsSeal ? 90 : 0);
  const mult = computeCourtBonuses(state, factionKey).prestigeMult;
  return Math.round(raw * mult);
}

export function prestigeRankForFaction(state, factionKey) {
  const prestige = computeFactionPrestige(state, factionKey);
  let current = PRESTIGE_RANKS_V4[0];
  let nextRank = PRESTIGE_RANKS_V4[1] || null;
  let rankIndex = 0;
  for (let i = 0; i < PRESTIGE_RANKS_V4.length; i += 1) {
    if (prestige >= PRESTIGE_RANKS_V4[i].minPrestige) {
      current = PRESTIGE_RANKS_V4[i];
      nextRank = PRESTIGE_RANKS_V4[i + 1] || null;
      rankIndex = i;
    }
  }
  return { current, nextRank, prestige, rankIndex };
}

export function autoAssignCourtOffices(state, factionKey) {
  if (!state?.factions?.[factionKey]) return;
  const offices = (state.courtOffices ??= {});
  const curMap = (offices[factionKey] ??= {});
  const { rankIndex } = prestigeRankForFaction(state, factionKey);
  const facName = state.factions[factionKey]?.name;

  const pool = Object.values(state.officers || {})
    .filter((o) => o.faction === factionKey && !o.capturedBy && o.name !== facName);
  const used = new Set(Object.values(curMap).filter(Boolean));

  const seatOrder = ["chancellor", "grand_general", "grand_minister_agri", "grand_minister_comm", "imperial_censor", "heir"];
  for (const oid of seatOrder) {
    const def = COURT_OFFICES_V4[oid];
    if (!def || rankIndex < def.minRankIdx) continue;
    const curK = curMap[oid];
    const curValid = curK && state.officers[curK]?.faction === factionKey && !state.officers[curK]?.capturedBy;
    if (curValid) continue;

    const attr = def.attr;
    const candidate = pool
      .filter((o) => !used.has(o.key))
      .sort((a, b) => ((b[attr] ?? b.governance ?? 60) + (b.command ?? 60) * 0.2)
        - ((a[attr] ?? a.governance ?? 60) + (a.command ?? 60) * 0.2))[0];
    if (candidate) {
      curMap[oid] = candidate.key;
      used.add(candidate.key);
    } else {
      curMap[oid] = null;
    }
  }
}

export function ensureV4State(state) {
  if (!state) return state;
  state.courtOffices ??= {};
  state.autoGovernance ??= { autoEconomy: false, autoPersonnel: false, autoDefense: false };
  state.dismissedCabinetIds ??= [];
  state.threeKingdoms ??= null;

  if (state.cities) {
    for (const c of Object.values(state.cities)) {
      ensureCityV4Fields(c);
    }
  }
  if (state.factions) {
    for (const fk of Object.keys(state.factions)) {
      state.factions[fk].taxLevel ??= "normal";
      if (!TAX_LEVELS_V4[state.factions[fk].taxLevel]) {
        state.factions[fk].taxLevel = "normal";
      }
      if (!state.courtOffices[fk]) {
        autoAssignCourtOffices(state, fk);
      } else {
        // Prune dead/defected holders from saved office slots without reassigning automatically
        for (const [oid, ok] of Object.entries(state.courtOffices[fk])) {
          if (ok && (!state.officers?.[ok] || state.officers[ok].faction !== fk || state.officers[ok].capturedBy)) {
            state.courtOffices[fk][oid] = null;
          }
        }
      }
    }
  }
  return state;
}

export function buildingUpgradeCost(state, factionKey, trackId, nextLevel) {
  const def = CITY_BUILDINGS_V4[trackId];
  if (!def) return 999;
  const base = def.costs[nextLevel] ?? 999;
  const { buildDiscount } = computeCourtBonuses(state, factionKey);
  return Math.max(12, Math.round(base * buildDiscount));
}

export function upgradeCityBuilding(world, state, cityKey, trackId, { actorFaction = state.player, silent = false } = {}) {
  const def = CITY_BUILDINGS_V4[trackId];
  if (!def) throw new Error("未知郡国基建项目。");
  const next = ensureV4State(structuredClone(state));
  const city = next.cities?.[cityKey];
  if (!city || city.owner !== actorFaction) throw new Error("仅可于己方直辖城池大兴土木。");
  if (next.sieges?.[cityKey]) throw new Error("城池正遭敌军围困，无法兴建大型工事。");

  const curLv = city.buildings?.[trackId] ?? 0;
  if (curLv >= 5) throw new Error(`「${cityNameV2(world, cityKey)}」的${def.name}已臻最高第 5 级。`);

  const nextLv = curLv + 1;
  const cost = buildingUpgradeCost(next, actorFaction, trackId, nextLv);
  const fac = next.factions?.[actorFaction];
  if (!fac || fac.treasury < cost) {
    throw new Error(`扩建「${def.name} Lv.${nextLv}」需国库 ${cost} 钱。`);
  }

  fac.treasury -= cost;
  city.buildings[trackId] = nextLv;
  const tier = cityTierInfo(city);
  city.level = tier.level;
  if (trackId === "academy") {
    city.wallMax += def.wallPerLv;
    city.wall = Math.min(city.wallMax, city.wall + def.wallPerLv);
    city.publicOrder = clamp(city.publicOrder + 6, 0, 100);
  } else {
    city.publicOrder = clamp(city.publicOrder + 2, 0, 100);
  }

  if (!silent && actorFaction === next.player) {
    const ev = {
      turn: next.turn,
      kind: "economy",
      faction: actorFaction,
      city: cityKey,
      text: `🏗️ 兴城固本：「${cityNameV2(world, cityKey)}」落成「${def.icon} ${def.name} Lv.${nextLv}」（耗资 ${cost} 钱 · ${tier.title}）。`,
    };
    next.events = [...(next.events || []), ev].slice(-80);
    next.lastTurnEvents = [ev];
  }
  return next;
}

export function setTaxLevel(state, taxId) {
  const spec = TAX_LEVELS_V4[taxId];
  if (!spec) throw new Error("未知国家税率档位。");
  const next = ensureV4State(structuredClone(state));
  const fac = next.factions[next.player];
  if (!fac) throw new Error("玩家势力无效。");
  fac.taxLevel = taxId;
  const ev = {
    turn: next.turn,
    kind: "economy",
    faction: next.player,
    text: `⚖️ 颁定税制：全国赋税已调整为「${spec.icon} ${spec.name}」— ${spec.summary}`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

export function appointCourtOffice(state, officeId, officerKey) {
  const def = COURT_OFFICES_V4[officeId];
  if (!def) throw new Error("未知朝堂官职席位。");
  const next = ensureV4State(structuredClone(state));
  const player = next.player;
  const { rankIndex } = prestigeRankForFaction(next, player);
  if (rankIndex < def.minRankIdx) {
    const reqRank = PRESTIGE_RANKS_V4[def.minRankIdx]?.title || "高爵";
    throw new Error(`任命「${def.name}」需威望晋升至「${reqRank}」方可开启该官署。`);
  }

  const map = (next.courtOffices[player] ??= {});
  const oldHolderKey = map[officeId];
  if (!officerKey) {
    map[officeId] = null;
    return next;
  }

  const off = next.officers?.[officerKey];
  if (!off || off.faction !== player || off.capturedBy) {
    throw new Error("仅可任命麾下在籍将领担任中枢重臣。");
  }

  // Vacate any prior office held by the same officer
  for (const [k, v] of Object.entries(map)) {
    if (v === officerKey && k !== officeId) map[k] = null;
  }
  if (oldHolderKey && oldHolderKey !== officerKey && next.officers[oldHolderKey]) {
    const oldOff = next.officers[oldHolderKey];
    if (oldOff.name !== next.factions[player]?.name) {
      oldOff.loyalty = clamp(oldOff.loyalty - 4, 0, 100);
    }
  }

  map[officeId] = officerKey;
  off.loyalty = clamp(off.loyalty + 8, 0, 100);

  const ev = {
    turn: next.turn,
    kind: "officer",
    faction: player,
    text: `👑 朝堂拜官：擢升「${off.name}」领【${def.icon} ${def.name}】！${def.auraSummary}`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

export function estimateFactionEconomy(state, factionKey) {
  const fac = state?.factions?.[factionKey];
  if (!fac) {
    return {
      grossTreasury: 0, upkeepTreasury: 0, corruptionLoss: 0, netTreasury: 0,
      grossGrain: 0, upkeepGrain: 0, netGrain: 0, avgOrder: 80,
      totalDev: 0, cityCount: 0, garrisonTroops: 0, fieldTroops: 0, corruptionRate: 0, prestige: 0,
    };
  }

  const tax = TAX_LEVELS_V4[fac.taxLevel || "normal"] || TAX_LEVELS_V4.normal;
  const court = computeCourtBonuses(state, factionKey);
  const ecoMult = factionKey === state.player
    ? (DIFFICULTY_MODES[state.difficulty || "standard"]?.playerEconomy ?? 1)
    : 1.02;
  const hasTuntian = Boolean(state.decrees?.[factionKey]?.includes("tuntian"));
  const tuntianMult = hasTuntian ? (1 + (NATIONAL_DECREES_V2.tuntian?.grainMult ?? 0.25)) : 1;

  let grossTreasury = 0;
  let grossGrain = 0;
  let cityCount = 0;
  let totalDev = 0;
  let totalAcademy = 0;
  let orderSum = 0;
  let garrisonTroops = 0;

  for (const city of Object.values(state.cities || {})) {
    if (city.owner !== factionKey) continue;
    cityCount += 1;
    garrisonTroops += city.troops || 0;
    const b = city.buildings || { farm: 1, market: 1, workshop: 0, academy: 0 };
    const tier = cityTierInfo(city);
    totalDev += tier.totalDev;
    totalAcademy += b.academy || 0;
    orderSum += Number.isFinite(city.publicOrder) ? city.publicOrder : 78;

    if (state.sieges?.[city.key]) continue;
    const pol = CITY_POLICIES[city.policy || "balanced"] || CITY_POLICIES.balanced;
    const gov = city.governor ? state.officers?.[city.governor] : null;
    const govBonus = 1 + ((gov?.governance ?? 55) - 55) * 0.004 + (gov?.traits?.includes("farming") ? 0.08 : 0);
    const cSpec = CITY_SPECIALTIES[city.specialty];
    const specTM = 1 + (cSpec?.treasuryBonus ?? 0);
    const specGM = 1 + (cSpec?.grainBonus ?? 0);

    const farmMult = 1 + (b.farm || 0) * CITY_BUILDINGS_V4.farm.grainBonusPerLv;
    const marketMult = 1 + (b.market || 0) * CITY_BUILDINGS_V4.market.treasuryBonusPerLv;

    const cT = Math.round((8 + tier.level * 2.5) * marketMult * pol.treasuryMult * govBonus * ecoMult * specTM * tax.treasuryMult * court.treasuryMult);
    const cG = Math.round((9 + tier.level * 2.8) * farmMult * pol.grainMult * govBonus * ecoMult * specGM * tax.grainMult * tuntianMult * court.grainMult);
    grossTreasury += cT;
    grossGrain += cG;
  }

  let fieldTroops = 0;
  for (const a of state.armies || []) {
    if (a.faction === factionKey && a.troops > 0) fieldTroops += a.troops;
  }

  const rawCorruption = Math.max(0, (cityCount - 8) * 0.018);
  const academyCut = totalAcademy * 0.012;
  const corruptionRate = clamp(rawCorruption - court.corruptionCut - academyCut, 0, 0.35);
  const corruptionLoss = Math.round(grossTreasury * corruptionRate);

  const upkeepTreasury = Math.round(((garrisonTroops * 1.9 + fieldTroops * 3.6) / 1000) * court.upkeepDiscount);
  const upkeepGrain = Math.round(((garrisonTroops * 2.1 + fieldTroops * 3.9) / 1000) * court.upkeepDiscount);

  const netTreasury = grossTreasury - corruptionLoss - upkeepTreasury;
  const netGrain = grossGrain - upkeepGrain;
  const avgOrder = cityCount ? Math.round(orderSum / cityCount) : 80;
  const prestige = computeFactionPrestige(state, factionKey);

  return {
    grossTreasury,
    upkeepTreasury,
    corruptionLoss,
    netTreasury,
    grossGrain,
    upkeepGrain,
    netGrain,
    avgOrder,
    totalDev,
    cityCount,
    garrisonTroops,
    fieldTroops,
    corruptionRate,
    prestige,
  };
}

export function checkThreeKingdomsClimax(world, state, events = []) {
  if (!state || state.threeKingdoms?.triggered || (state.turn || 0) < 18 || state.outcome !== "ongoing") return;
  const ranked = Object.keys(state.factions || {})
    .map((fk) => ({
      fk,
      name: state.factions[fk]?.name || fk,
      cities: Object.values(state.cities).filter((c) => c.owner === fk).length,
      prestige: computeFactionPrestige(state, fk),
    }))
    .filter((f) => f.cities > 0)
    .sort((a, b) => b.prestige - a.prestige || b.cities - a.cities);

  if (ranked.length < 3) return;
  const leader = ranked[0];
  if (leader.prestige < 1380 && leader.cities < 22) return;

  const emperors = ranked.slice(0, 3).map((r) => {
    const cap = Object.values(state.cities).find((c) => c.owner === r.fk);
    return {
      faction: r.fk,
      name: r.name,
      capital: cap?.key || null,
      capitalName: cap ? cityNameV2(world, cap.key) : "",
      prestige: r.prestige,
    };
  });

  state.threeKingdoms = { triggered: true, turn: state.turn, emperors };

  const empSet = new Set(emperors.map((e) => e.faction));
  state.treaties = (state.treaties || []).filter(
    (t) => !(empSet.has(t.sides[0]) && empSet.has(t.sides[1])),
  );

  for (const e of emperors) {
    if (state.factions[e.faction]) {
      state.factions[e.faction].morale = clamp(state.factions[e.faction].morale + 12, 40, 100);
    }
  }

  events.push({
    turn: state.turn,
    kind: "diplomacy",
    text: `👑 【三足鼎立 · 天下三分】「${emperors.map((e) => e.name).join("、")}」威望并世称尊，各自建都称帝！三强旧约尽废，终极逐鹿开启！`,
  });
}
