// 经略三国 2.0 — 核心常量、兵种相克、时令天气、城池方针与围城战术配置

export const DEKADS_PER_MONTH = 3;
export const MONTHS_PER_YEAR = 12;
export const DEKADS_PER_SEASON = 9;
export const DEKADS_PER_YEAR = 36;
export const DEKAD_NAMES = ["上旬", "中旬", "下旬"];
export const SEASON_KEYS = ["spring", "summer", "autumn", "winter"];
export const SEASON_NAMES = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" };

export function formatCalendar(startYear, turn = 0) {
  const safeTurn = Math.max(0, Math.floor(turn));
  const year = startYear + Math.floor(safeTurn / DEKADS_PER_YEAR);
  const withinYear = safeTurn % DEKADS_PER_YEAR;
  const month = Math.floor(withinYear / DEKADS_PER_MONTH) + 1;
  const dekadIndex = withinYear % DEKADS_PER_MONTH;
  const dekadName = DEKAD_NAMES[dekadIndex];
  const seasonIdx = Math.floor(withinYear / DEKADS_PER_SEASON);
  const seasonKey = SEASON_KEYS[seasonIdx];
  const seasonName = SEASON_NAMES[seasonKey];
  return {
    year,
    month,
    dekadIndex,
    dekadName,
    seasonIdx,
    seasonKey,
    seasonName,
    label: `${year}年${month}月${dekadName}`,
    short: `${year}·${month}月${dekadName[0]}`,
  };
}

export const WEATHER_CATALOG = {
  spring: [
    { key: "clear", name: "春和景明", icon: "☀️", marchMult: 1.0, archerMult: 1.0, fireMult: 1.0, riverMult: 1.0, landRiverMult: 1.0, grainMult: 1.0, summary: "春晴暖风，水陆调度顺畅。" },
    { key: "rain", name: "春雨绵绵", icon: "🌧️", marchMult: 0.9, archerMult: 0.88, fireMult: 0.8, riverMult: 1.04, landRiverMult: 0.95, grainMult: 1.06, summary: "春雨湿弦，强弩与火攻减效，泥泞稍缓行军。" },
  ],
  summer: [
    { key: "clear", name: "盛夏晴炎", icon: "🌤️", marchMult: 1.02, archerMult: 1.0, fireMult: 1.12, riverMult: 1.0, landRiverMult: 1.0, grainMult: 1.02, summary: "日烈风燥，火攻与夜袭颇具奇效。" },
    { key: "flood", name: "江淮夏汛", icon: "🌊", marchMult: 0.92, archerMult: 0.94, fireMult: 0.88, riverMult: 1.2, landRiverMult: 0.8, grainMult: 1.08, summary: "江河暴涨，水师顺汛大捷，陆军强渡受挫。" },
  ],
  autumn: [
    { key: "wind", name: "秋高顺风", icon: "💨", marchMult: 1.05, archerMult: 1.05, fireMult: 1.2, riverMult: 1.02, landRiverMult: 1.0, grainMult: 0.96, summary: "秋风凛冽，火攻、矢石杀伤暴涨。" },
    { key: "clear", name: "秋高气爽", icon: "🍂", marchMult: 1.06, archerMult: 1.02, fireMult: 1.04, riverMult: 1.0, landRiverMult: 1.0, grainMult: 0.94, summary: "秋熟路平，大军长驱粮耗降低。" },
  ],
  winter: [
    { key: "snow", name: "严寒大雪", icon: "❄️", marchMult: 0.8, archerMult: 0.85, fireMult: 0.88, riverMult: 0.92, landRiverMult: 0.86, grainMult: 1.28, summary: "风雪封道，行军迟滞且远征粮耗剧增。" },
    { key: "clear", name: "冬晴寒霜", icon: "🌫️", marchMult: 0.94, archerMult: 0.96, fireMult: 1.0, riverMult: 1.0, landRiverMult: 0.95, grainMult: 1.12, summary: "寒霜凝冻，不宜重兵久围孤城。" },
  ],
};

export const TROOP_TYPES = {
  infantry: {
    id: "infantry",
    name: "重步",
    icon: "🛡️",
    counters: "cavalry",
    counteredBy: "archer",
    speed: 1.0,
    siegeMult: 1.0,
    wallDefBonus: 0.16,
    passBonus: 0.14,
    plainBonus: 0,
    lossMult: 0.94,
    reequipCost: 12,
    short: "稳健扛线，克铁骑",
    detail: "披甲持戟之师：克制「铁骑」(+20%)，守城与扼守关隘稳定；但易遭「强弩」齐射压制。",
  },
  cavalry: {
    id: "cavalry",
    name: "铁骑",
    icon: "🐎",
    counters: "archer",
    counteredBy: "infantry",
    speed: 1.45,
    siegeMult: 0.78,
    wallDefBonus: -0.08,
    passBonus: -0.14,
    plainBonus: 0.18,
    lossMult: 1.05,
    reequipCost: 16,
    short: "疾驰突击，克强弩",
    detail: "西凉北地精骑：行军速度最快(+45%)，平原突袭克「强弩」(+22%)；涉关隘及硬攻坚城略逊。",
  },
  archer: {
    id: "archer",
    name: "强弩",
    icon: "🏹",
    counters: "infantry",
    counteredBy: "cavalry",
    speed: 1.05,
    siegeMult: 0.92,
    wallDefBonus: 0.14,
    passBonus: 0.12,
    plainBonus: 0.02,
    lossMult: 0.82,
    reequipCost: 14,
    short: "远程压制，克重步",
    detail: "连弩劲射营：远程克「重步」(+20%)且自身战损大幅降低(-18%)；遇近身「铁骑」突阵则危，雨雪天效力减弱。",
  },
  navy: {
    id: "navy",
    name: "水师",
    icon: "⛵",
    counters: null,
    counteredBy: null,
    speed: 0.95,
    riverSpeed: 1.38,
    siegeMult: 0.95,
    wallDefBonus: 0.04,
    passBonus: -0.05,
    plainBonus: -0.04,
    riverBonus: 0.32,
    lossMult: 0.9,
    reequipCost: 15,
    short: "称雄江渡，汛期破敌",
    detail: "楼船水师营：大江渡口行军迅捷且战力暴涨(+32%)，夏汛尤佳；离水陆战较弱。",
  },
  siege: {
    id: "siege",
    name: "攻城械",
    icon: "🪨",
    counters: null,
    counteredBy: null,
    speed: 0.75,
    siegeMult: 1.85,
    wallDefBonus: -0.12,
    passBonus: -0.14,
    plainBonus: -0.18,
    lossMult: 1.1,
    reequipCost: 22,
    short: "霹雳破墙，专克坚城",
    detail: "冲车霹雳营：围城破墙效率高达 1.85 倍；但行军笨重，野战遭遇战力削弱 18%。",
  },
};

export function troopCounterEffect(attType = "infantry", defType = "infantry", terrain = "plain", weather = null) {
  const att = TROOP_TYPES[attType] || TROOP_TYPES.infantry;
  const def = TROOP_TYPES[defType] || TROOP_TYPES.infantry;
  let mult = 1;
  const tags = [];
  let relation = "neutral";

  if (att.counters && att.counters === def.id) {
    const bonus = att.id === "cavalry" ? 0.22 : 0.2;
    mult *= 1 + bonus;
    relation = "counter";
    tags.push(`${att.name}克${def.name} +${Math.round(bonus * 100)}%`);
  } else if (att.counteredBy && att.counteredBy === def.id) {
    mult *= 0.84;
    relation = "countered";
    tags.push(`遭${def.name}克制 -16%`);
  }

  if (terrain === "river") {
    if (att.id === "navy") {
      const rBonus = 0.28 + ((weather?.riverMult ?? 1) - 1) * 0.5;
      mult *= 1 + rBonus;
      relation = relation === "countered" ? relation : "terrain";
      tags.push(`水师渡江 +${Math.round(rBonus * 100)}%`);
    } else if (def.id === "navy") {
      mult *= 0.82;
      relation = "countered";
      tags.push("陆军涉江受阻 -18%");
    } else if ((weather?.landRiverMult ?? 1) < 1) {
      mult *= weather.landRiverMult;
      tags.push(`${weather.name}渡河衰减`);
    }
  } else if (terrain === "pass") {
    if (att.passBonus) {
      mult *= 1 + att.passBonus;
      tags.push(att.passBonus > 0 ? `关隘利${att.name}` : `关隘阻${att.name}`);
    }
  } else if (terrain === "plain" && att.plainBonus) {
    mult *= 1 + att.plainBonus;
    if (att.plainBonus > 0) tags.push(`平原驰突 +${Math.round(att.plainBonus * 100)}%`);
  }

  if (att.id === "archer" && weather && weather.archerMult < 1) {
    mult *= weather.archerMult;
    tags.push(`${weather.name}弱弩`);
  }

  return {
    mult: Math.max(0.62, Math.min(1.55, Number(mult.toFixed(3)))),
    label: tags.join(" · "),
    relation,
  };
}

export const CITY_POLICIES = {
  balanced: { id: "balanced", name: "休养生息", icon: "⚖️", treasuryMult: 1.0, grainMult: 1.0, recruitRate: 1.0, wallRepair: 12, foodRefill: 12, desc: "钱粮兵源均衡稳步积累。" },
  granary: { id: "granary", name: "屯田积粮", icon: "🌾", treasuryMult: 0.78, grainMult: 1.48, recruitRate: 0.7, wallRepair: 8, foodRefill: 22, desc: "大幅增产军粮与守城余粮，前线大军后盾。" },
  fortress: { id: "fortress", name: "固城备战", icon: "🧱", treasuryMult: 0.85, grainMult: 0.9, recruitRate: 0.85, wallRepair: 34, foodRefill: 15, desc: "每旬/月快速修缮城防并储备守城余粮。" },
  barracks: { id: "barracks", name: "整军经武", icon: "⚔️", treasuryMult: 0.82, grainMult: 0.85, recruitRate: 1.55, wallRepair: 10, foodRefill: 10, desc: "征召练兵提速，快速充实前线可用兵力。" },
  commerce: { id: "commerce", name: "通商聚财", icon: "💰", treasuryMult: 1.5, grainMult: 0.88, recruitRate: 0.75, wallRepair: 8, foodRefill: 10, desc: "兴市通商充盈国库，支撑攻城械与外交筹码。" },
};

export const SIEGE_STANCES = {
  storm: { id: "storm", name: "强攻云梯", icon: "🪜", wallDmgMult: 1.65, foodDrain: 14, attLossMult: 1.42, defLossMult: 1.35, moraleDrain: 7, cost: 0, summary: "冒矢猛攻城头，破城防极快，攻方伤亡亦高。" },
  surround: { id: "surround", name: "长围绝粮", icon: "⛓️", wallDmgMult: 0.42, foodDrain: 30, attLossMult: 0.42, defLossMult: 0.62, moraleDrain: 11, cost: 0, summary: "掘壕围困断水粮，己方损伤极低，持续压垮城内军心余粮。" },
  bombard: { id: "bombard", name: "炮石掘道", icon: "💣", wallDmgMult: 1.48, foodDrain: 18, attLossMult: 0.72, defLossMult: 1.08, moraleDrain: 9, cost: 8, summary: "每旬消耗 8 钱以霹雳车凿洞轰城，兼顾高破墙与低战损。" },
  persuade: { id: "persuade", name: "攻心劝降", icon: "📜", wallDmgMult: 0.25, foodDrain: 20, attLossMult: 0.34, defLossMult: 0.35, moraleDrain: 17, surrenderBonus: 18, cost: 4, summary: "箭书传檄动摇守军，士气或余粮见底时最易兵不血刃下城。" },
};

export const SIEGE_DEFENSE_MODES = {
  hold: { id: "hold", name: "闭门固守", icon: "🛡️", wallMitigation: 0.72, lossMitigation: 0.74, summary: "深沟高垒死守城垛，大幅减少城防与守军损耗，静待援军。" },
  sally: { id: "sally", name: "出城突击", icon: "⚔️", wallMitigation: 1.08, lossMitigation: 1.12, sallyMult: 1.26, summary: "趁围城兵疲出城冲阵，额外杀伤围城敌军并延长城池守期。" },
  fire_raid: { id: "fire_raid", name: "夜袭烧营", icon: "🔥", wallMitigation: 0.9, lossMitigation: 0.92, summary: "寻隙夜间纵火劫营，重创围军兵粮并挫其锐气（围城期间可触发奇袭）。" },
};

export const DEFENSE_TRAPS = {
  fire_pit: { id: "fire_pit", name: "火油陷坑", icon: "🔥", cost: 14, troopDmgPct: 0.19, moraleDmg: 15, summary: "敌军临城时引爆烈焰陷坑，烧折敌军 19% 兵力并大挫士气。" },
  abatis: { id: "abatis", name: "鹿角拒马", icon: "🪵", cost: 12, extraWall: 95, attSlow: true, summary: "城外深设拒马木栅，敌军临城先撞阻滞阵型并临时稳固城防(+95)。" },
  ambush: { id: "ambush", name: "城外伏兵", icon: "🌿", cost: 16, troopDmgPct: 0.14, captureBonus: 0.35, summary: "预伏精兵于城侧山林，敌军扑城时两翼截杀并大幅提升生擒敌将几率。" },
};

export const DIFFICULTY_MODES = {
  casual: { id: "casual", name: "轻松演义", aiAtkMult: 0.85, aiAggression: 0.65, playerEconomy: 1.25, summary: "我方钱粮丰沛，诸侯攻势温和，适合从容统一九州。" },
  standard: { id: "standard", name: "正统战略", aiAtkMult: 1.0, aiAggression: 1.0, playerEconomy: 1.0, summary: "势力均衡、战守互有往来，推荐初次游玩本版本选用。" },
  hard: { id: "hard", name: "虎狼天下", aiAtkMult: 1.15, aiAggression: 1.28, playerEconomy: 0.92, summary: "群雄积极调兵解围与联合夹击，步步惊心的硬核博弈。" },
};

export const AWAKENED_TITLES = [
  { id: "vanguard", name: "破阵先锋", minWins: 3, atkBonus: 0.1, desc: "连破强敌三次：领兵攻击力 +10%" },
  { id: "bulwark", name: "铁壁干城", minDefenses: 2, defBonus: 0.12, desc: "坚守危城两度退敌：守城与野战防线 +12%" },
  { id: "conqueror", name: "灭国柱石", minCaptures: 3, siegeBonus: 0.15, desc: "亲率大军拔城三座：攻城破墙效率 +15%" },
  { id: "grand_marshal", name: "天下大都督", minMerit: 180, atkBonus: 0.14, siegeBonus: 0.12, desc: "战功赫赫位极人臣：全军攻伐威压群雄" },
];

export const FACTION_COLORS = {
  cao: "#416a91", wei: "#416a91", yuan: "#9c7524", zhang: "#b55d43", shu: "#b04d38",
  biao: "#7d5b96", lu: "#a04f6b", ce: "#39826a", wu: "#39826a", ma: "#6a8042",
  gongsun: "#3f8791", shi: "#966949", jin: "#7d5796", liu: "#b04d38", han: "#766191",
  dong: "#82404f", jiu: "#9e7b44", jian: "#38755c", yan: "#966546", yellow: "#b8962e",
  frontier: "#4e7a77", lvbu: "#ba3b49", sima: "#575c96",
};

export function factionColor(key) {
  return FACTION_COLORS[key] || "#7b705a";
}

const RIVER_EDGE_SET = new Set([
  "chaisang:jiangxia", "chaisang:linxiang", "jiangling:jiangxia", "jiangling:linxiang",
  "moling:shouchun", "lujiang:moling", "chaisang:lujiang", "jiangxia:lujiang",
  "chaisang:shanyin", "jiangxia:runan", "pingyuan:puyang", "chenliu:puyang",
  "jiangling:xiangyang", "jiangxia:xiangyang",
]);

const PASS_EDGE_SET = new Set([
  "jiangling:yufu", "jiangzhou:yufu", "changan:tianshui", "nanzheng:shangyong",
  "nanzheng:zitong", "changan:luoyang", "luoyang:wan", "changan:wan",
  "changan:jinyang", "guzang:tianshui", "anding:guzang", "shangyong:yufu",
  "chengdu:jianning", "linyuan:yufu",
]);

export function roadTerrain(fromKey, toKey) {
  const pair = [fromKey, toKey].sort().join(":");
  if (RIVER_EDGE_SET.has(pair)) return "river";
  if (PASS_EDGE_SET.has(pair)) return "pass";
  return "plain";
}

export const TERRAIN_LABELS = {
  plain: "平野",
  river: "江渡",
  pass: "险关",
};

export const REGIONAL_DEFAULT_TROOP = {
  "河北与辽东": "cavalry",
  "关陇": "cavalry",
  "中原与淮北": "infantry",
  "荆襄": "archer",
  "巴蜀与南中": "archer",
  "江东与江淮": "navy",
  "交州与岭南": "navy",
};

export const FACTION_PREFERRED_TROOP = {
  ma: "cavalry",
  gongsun: "cavalry",
  lvbu: "cavalry",
  ce: "navy",
  wu: "navy",
  biao: "navy",
  shi: "navy",
  shu: "archer",
  zhang: "archer",
};
