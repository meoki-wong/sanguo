// v20.0 — 长江水师 & 铁索封江水陆决战体系
// 状态挂在 state.saga.navy 下，兼容旧存档与非 century 模式。

export const NAVAL_SHIP_TYPES = [
  {
    id: "louchuan",
    name: "五牙楼船",
    icon: "🚢",
    costTreasury: 65,
    costGrain: 25,
    power: 3,
    summary: "水上巨舰，临江攻防 +20%，威震大江。",
  },
  {
    id: "mengchong",
    name: "蒙冲斗舰",
    icon: "⛵",
    costTreasury: 50,
    costGrain: 20,
    power: 2,
    summary: "包革蒙冲，水战突击 +14%，渡江耗粮 -20%。",
  },
  {
    id: "zouge",
    name: "走舸快船",
    icon: "🛶",
    costTreasury: 35,
    costGrain: 15,
    power: 1,
    summary: "轻捷快船，适合沿江游击奇袭与协助铁索封江。",
  },
];

// 长江/淮河水系核心渡口重镇（自动按当前地图存在的城池过滤）
export const RIVER_PORT_KEYS = [
  "jianye", "chaisang", "jiangling", "xiangyang", "wu", "kuaiji", "shouchun", "hefei", "jiangxia", "lujiang", "yongan", "jiangzhou",
];

function ensureNavy(state) {
  if (!state.saga) state.saga = {};
  if (!state.saga.navy || typeof state.saga.navy !== "object") {
    state.saga.navy = { fleets: {}, chains: {}, lastRaidTurn: -2 };
  }
  if (!state.saga.navy.fleets) state.saga.navy.fleets = {};
  if (!state.saga.navy.chains) state.saga.navy.chains = {};
  return state.saga.navy;
}

export function getRiverPorts(world, state) {
  const existing = new Set((world?.cities || []).map((c) => c.key));
  return RIVER_PORT_KEYS
    .filter((k) => existing.has(k) && state?.cities?.[k])
    .map((k) => {
      const city = world.cities.find((c) => c.key === k);
      const holding = state.cities[k];
      const fleet = state.saga?.navy?.fleets?.[k] || null;
      const chained = Boolean(state.saga?.navy?.chains?.[k]);
      return {
        key: k,
        name: city?.name || k,
        owner: holding.owner,
        troops: holding.troops,
        fleet,
        chained,
      };
    });
}

/**
 * 在己方沿江重镇建造水师舰队
 */
export function buildNavalFleet(world, state, cityKey, shipTypeId = "louchuan", actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可组建长江水师。" };
  const ship = NAVAL_SHIP_TYPES.find((s) => s.id === shipTypeId);
  if (!ship) return { ok: false, reason: "未知的战舰型号。" };
  const holding = state.cities?.[cityKey];
  if (!holding || holding.owner !== actor) return { ok: false, reason: "只能在己方沿江重镇建造水师。" };
  if (!RIVER_PORT_KEYS.includes(cityKey)) return { ok: false, reason: "此城非沿江水寨重镇，无法停泊大型水师。" };

  const fac = state.factions?.[actor];
  if (!fac || fac.treasury < ship.costTreasury || fac.grain < ship.costGrain) {
    return { ok: false, reason: `建造「${ship.name}」需金 ${ship.costTreasury}、粮 ${ship.costGrain}。` };
  }

  const next = structuredClone(state);
  next.factions[actor].treasury -= ship.costTreasury;
  next.factions[actor].grain -= ship.costGrain;
  const navy = ensureNavy(next);
  navy.fleets[cityKey] = {
    type: ship.id,
    name: ship.name,
    icon: ship.icon,
    power: ship.power,
    builtTurn: next.turn ?? 1,
  };
  const cname = world?.cities?.find((c) => c.key === cityKey)?.name || cityKey;
  return {
    ok: true,
    state: next,
    summary: `【长江水师】已在${cname}下水「${ship.icon}${ship.name}」水师舰队：${ship.summary}`,
  };
}

/**
 * 开启 / 解除「铁索封江」
 */
export function toggleRiverChain(world, state, cityKey, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式启用铁索封江。" };
  const holding = state.cities?.[cityKey];
  if (!holding || holding.owner !== actor) return { ok: false, reason: "只能对己方沿江重镇部署铁索封江。" };
  if (!RIVER_PORT_KEYS.includes(cityKey)) return { ok: false, reason: "仅沿江水寨可部署铁索封江。" };

  const next = structuredClone(state);
  const navy = ensureNavy(next);
  const cname = world?.cities?.find((c) => c.key === cityKey)?.name || cityKey;
  if (navy.chains[cityKey]) {
    delete navy.chains[cityKey];
    return { ok: true, state: next, summary: `已解除${cname}江面铁索，恢复大江通航。` };
  }
  const cost = 30;
  if ((next.factions[actor]?.treasury ?? 0) < cost) {
    return { ok: false, reason: `铸铁锁江需军费金 ${cost}。` };
  }
  next.factions[actor].treasury -= cost;
  navy.chains[cityKey] = true;
  return {
    ok: true,
    state: next,
    summary: `【铁索封江】已在${cname}江面横贯铁索！守御战力 +22%，阻断敌军强渡（需防敌军火攻）。`,
  };
}

/**
 * 沿江水师奇袭：从己方拥有水师的江城跨城突袭任意敌方沿江重镇
 */
export function launchNavalRaid(world, state, fromCityKey, targetCityKey, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式启用沿江水师奇袭。" };
  const from = state.cities?.[fromCityKey];
  const target = state.cities?.[targetCityKey];
  if (!from || from.owner !== actor) return { ok: false, reason: "请选择己方沿江水师基地出击。" };
  if (!target || target.owner === actor || !RIVER_PORT_KEYS.includes(targetCityKey)) {
    return { ok: false, reason: "目标须为敌方沿江重镇。" };
  }
  const fleet = state.saga?.navy?.fleets?.[fromCityKey];
  if (!fleet) return { ok: false, reason: "该城尚未建造水师舰队，请先下水战舰。" };

  const lastTurn = state.saga?.navy?.lastRaidTurn ?? -2;
  if ((state.turn ?? 1) - lastTurn < 1) {
    return { ok: false, reason: "水师本季已出击，待下季整补后再战。" };
  }
  const costGrain = 30;
  if ((state.factions[actor]?.grain ?? 0) < costGrain) {
    return { ok: false, reason: `水师顺江奇袭需备军粮 ${costGrain}。` };
  }

  const next = structuredClone(state);
  next.factions[actor].grain -= costGrain;
  const navy = ensureNavy(next);
  navy.lastRaidTurn = next.turn ?? 1;

  const targetChained = Boolean(navy.chains[targetCityKey]);
  const dmgRatio = (0.14 + (fleet.power ?? 1) * 0.04) * (targetChained ? 0.65 : 1);
  const enemyLoss = Math.min(Math.max(600, Math.floor(next.cities[targetCityKey].troops * dmgRatio)), 3400);
  next.cities[targetCityKey].troops = Math.max(500, next.cities[targetCityKey].troops - enemyLoss);
  next.cities[targetCityKey].defense = Math.max(8, (next.cities[targetCityKey].defense ?? 20) - 2);
  const plunderGold = 25 + (fleet.power ?? 1) * 8;
  next.factions[actor].treasury += plunderGold;

  const fname = world?.cities?.find((c) => c.key === fromCityKey)?.name || fromCityKey;
  const tname = world?.cities?.find((c) => c.key === targetCityKey)?.name || targetCityKey;
  return {
    ok: true,
    state: next,
    enemyLoss,
    plunderGold,
    summary: `【顺江水师奇袭】${fname}「${fleet.icon}${fleet.name}」顺流突袭${tname}，歼敌 ${enemyLoss}、毁城防 2、缴获金 +${plunderGold}！`,
  };
}

/**
 * 水师与铁索封江战斗修正（接入 engine.js forecastAttack）
 */
export function navyCombatModifiers(state, { fromKey, toKey, terrain = "land", tacticId = "assault" }) {
  if (!state?.century) return { attackMult: 1, defenseMult: 1, grainMult: 1, notes: [] };
  const navy = state.saga?.navy;
  if (!navy) return { attackMult: 1, defenseMult: 1, grainMult: 1, notes: [] };
  const attFleet = fromKey ? navy.fleets?.[fromKey] : null;
  const defFleet = toKey ? navy.fleets?.[toKey] : null;
  const defChained = Boolean(toKey && navy.chains?.[toKey]);

  let attackMult = 1;
  let defenseMult = 1;
  let grainMult = 1;
  const notes = [];

  const isWaterTheatre = terrain === "river" || RIVER_PORT_KEYS.includes(toKey) || RIVER_PORT_KEYS.includes(fromKey);
  if (isWaterTheatre && attFleet) {
    if (attFleet.type === "louchuan") attackMult += 0.2;
    else if (attFleet.type === "mengchong") {
      attackMult += 0.14;
      grainMult *= 0.8;
    } else attackMult += 0.08;
    notes.push(`水师${attFleet.name}`);
  }
  if (isWaterTheatre && defFleet) {
    defenseMult += attFleet ? 0.1 : 0.18;
    notes.push(`敌水师${defFleet.name}`);
  }
  if (defChained) {
    if (tacticId === "fire" || tacticId === "fire_attack") {
      // 火攻克制铁索连环！
      defenseMult *= 0.82;
      notes.push("火烧铁索连环");
    } else {
      defenseMult *= 1.22;
      notes.push("铁索封江");
    }
  }

  return {
    attackMult: Number(attackMult.toFixed(3)),
    defenseMult: Number(defenseMult.toFixed(3)),
    grainMult: Number(grainMult.toFixed(3)),
    notes,
  };
}
