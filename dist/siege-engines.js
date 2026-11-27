// v24.0 — 军械司：四大攻城重器配发（霹雳车 / 井阑 / 铁冲车 / 诸葛连弩）
// 状态挂在 state.saga.siegeEngines 下，兼容旧存档与非 century 模式。

export const SIEGE_ENGINES = [
  {
    id: "trebuchet",
    name: "投石霹雳车",
    icon: "☄️",
    costTreasury: 55,
    costGrain: 15,
    summary: "远程轰碎城楼女墙：出征攻势 +14%、城防削弱 -35%。",
    atkMult: 1.14,
    wallFactor: 0.65,
    defMult: 1,
    lossMult: 0.94,
  },
  {
    id: "siege_tower",
    name: "井阑箭塔",
    icon: "🗼",
    costTreasury: 50,
    costGrain: 15,
    summary: "居高临下压制守城弓手：敌防 -15%、己方攻城战损 -14%。",
    atkMult: 1.06,
    wallFactor: 0.85,
    enemyDefMult: 0.85,
    defMult: 1,
    lossMult: 0.86,
  },
  {
    id: "battering_ram",
    name: "铁甲冲车",
    icon: "🐏",
    costTreasury: 55,
    costGrain: 20,
    summary: "强撞城门破雄关：出征攻势 +16%、城墙削弱 -25%。",
    atkMult: 1.16,
    wallFactor: 0.75,
    defMult: 1,
    lossMult: 0.96,
  },
  {
    id: "zhuge_crossbow",
    name: "诸葛连弩",
    icon: "🏹",
    costTreasury: 60,
    costGrain: 15,
    summary: "十矢连发攻守兼备：出征攻势 +11%、守城战力 +15%。",
    atkMult: 1.11,
    wallFactor: 0.92,
    defMult: 1.15,
    lossMult: 0.9,
  },
];

function ensureEngines(state) {
  if (!state.saga) state.saga = {};
  if (!state.saga.siegeEngines || typeof state.saga.siegeEngines !== "object") {
    state.saga.siegeEngines = {};
  }
  return state.saga.siegeEngines;
}

export function engineInCity(state, cityKey) {
  const id = state?.saga?.siegeEngines?.[cityKey];
  return id ? SIEGE_ENGINES.find((e) => e.id === id) || null : null;
}

/**
 * 打造并配发攻城重器至指定己方城池
 */
export function craftSiegeEngine(world, state, cityKey, engineId, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可启用军械司打造重器。" };
  const def = SIEGE_ENGINES.find((e) => e.id === engineId);
  if (!def) return { ok: false, reason: "未知的军械型号。" };
  const holding = state.cities?.[cityKey];
  if (!holding || holding.owner !== actor) return { ok: false, reason: "只能为己方城池配发攻城重器。" };

  const fac = state.factions?.[actor];
  if (!fac || fac.treasury < def.costTreasury || fac.grain < def.costGrain) {
    return { ok: false, reason: `打造「${def.name}」需金 ${def.costTreasury}、粮 ${def.costGrain}。` };
  }

  const next = structuredClone(state);
  next.factions[actor].treasury -= def.costTreasury;
  next.factions[actor].grain -= def.costGrain;
  const map = ensureEngines(next);
  map[cityKey] = engineId;
  const cname = world?.cities?.find((c) => c.key === cityKey)?.name || cityKey;
  return {
    ok: true,
    state: next,
    summary: `【军械司】已在${cname}列装「${def.icon}${def.name}」：${def.summary}`,
  };
}

/**
 * 攻城重器战斗修正（接入 engine.js forecastAttack）
 */
export function siegeEngineCombatModifiers(state, { fromKey, toKey }) {
  if (!state?.century) return { attackMult: 1, defenseMult: 1, wallFactor: 1, lossMult: 1, label: "" };
  const attEng = fromKey ? engineInCity(state, fromKey) : null;
  const defEng = toKey ? engineInCity(state, toKey) : null;
  let attackMult = attEng?.atkMult ?? 1;
  let defenseMult = (attEng?.enemyDefMult ?? 1) * (defEng?.defMult ?? 1);
  let wallFactor = attEng?.wallFactor ?? 1;
  let lossMult = attEng?.lossMult ?? 1;
  const tags = [];
  if (attEng) tags.push(`重器·${attEng.name}`);
  if (defEng && defEng.defMult > 1) tags.push(`守城·${defEng.name}`);

  return {
    attackMult: Number(attackMult.toFixed(3)),
    defenseMult: Number(defenseMult.toFixed(3)),
    wallFactor: Number(wallFactor.toFixed(3)),
    lossMult: Number(lossMult.toFixed(3)),
    label: tags.join(" · "),
  };
}
