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

// ===== 二期扩展常量：官道名关工事 / 天时战策 / 44城地域特产 / 名将羁绊宿敌 =====

export function edgeKey(a, b) {
  return [a, b].sort().join(":");
}

export const HISTORICAL_PASSES = {
  "changan:luoyang": "潼关·函谷",
  "luoyang:wan": "伊阙关",
  "changan:tianshui": "陈仓·街亭",
  "nanzheng:zitong": "剑阁·阳平关",
  "jiangling:yufu": "夷陵·三峡",
  "chaisang:jiangxia": "赤壁江津",
  "lujiang:moling": "濡须口",
  "moling:shouchun": "合肥江津",
  "chenliu:puyang": "官渡·白马津",
  "luoyang:ye": "孟津渡",
  "nanzheng:shangyong": "子午道",
  "jiangzhou:yufu": "白帝江关",
  "beiping:xiangping": "山海榆关",
  "guzang:tianshui": "凉州隘口",
};

export function edgeDisplayName(world, aKey, bKey) {
  const eKey = edgeKey(aKey, bKey);
  if (HISTORICAL_PASSES[eKey]) return HISTORICAL_PASSES[eKey];
  const nA = world?.cities?.find((c) => c.key === aKey)?.name || aKey;
  const nB = world?.cities?.find((c) => c.key === bKey)?.name || bKey;
  return `${nA}—${nB}官道`;
}

export const FORT_CATALOG = {
  gate: {
    id: "gate",
    name: "关隘寨堡",
    icon: "🧱",
    cost: 24,
    hpMax: 240,
    blocksTransit: true,
    requiresRiver: false,
    summary: "卡死官道咽喉！敌军行至寨前会被迫强停攻堡，未破寨前绝不可越雷池一步。",
  },
  tower: {
    id: "tower",
    name: "连弩箭楼",
    icon: "🏹",
    cost: 20,
    hpMax: 160,
    arrowDmgPct: 0.085,
    requiresRiver: false,
    summary: "险道射台：每旬自动向途经官道的敌对军团齐射箭雨，损兵折气。",
  },
  depot: {
    id: "depot",
    name: "前哨粮寨",
    icon: "🌾",
    cost: 18,
    hpMax: 150,
    grainBoost: 4,
    requiresRiver: false,
    summary: "延伸随军补给中继点，确保深远征伐不断粮，并为路过己军补粮提振士气。",
  },
  water_fort: {
    id: "water_fort",
    name: "江防水寨",
    icon: "⚓",
    cost: 22,
    hpMax: 200,
    navyBonus: 0.18,
    requiresRiver: true,
    summary: "限江渡官道筑造：大幅增强水师渡江战力(+18%)并截杀涉江陆军。",
  },
};

export const STRATAGEM_CATALOG = {
  fire_attack: {
    id: "fire_attack",
    name: "顺风火攻",
    icon: "🔥",
    cost: 16,
    cooldown: 2,
    summary: "焚烧在途敌军或敌方官道工事（秋风/夏炎威力大增，雨雪减效）。",
  },
  flood_attack: {
    id: "flood_attack",
    name: "决水淹城",
    icon: "🌊",
    cost: 20,
    cooldown: 3,
    summary: "决堤灌冲临江敌城城防或滞留渡河敌军（夏汛威力暴涨）。",
  },
  raid_supply: {
    id: "raid_supply",
    name: "奇袭劫粮",
    icon: "⚡",
    cost: 14,
    cooldown: 2,
    summary: "遣精骑绕后烧毁敌军随军辎重（立刻断粮并大挫士气）。",
  },
};

export const CITY_SPECIALTIES = {
  horse: { id: "horse", name: "良马牧场", icon: "🐎", troopBoost: "cavalry", atkBonus: 0.12, costMult: 0.6, desc: "铁骑整编减费 40%，由此出征的铁骑野战突击 +12%" },
  shipyard: { id: "shipyard", name: "楼船水坞", icon: "⛵", troopBoost: "navy", atkBonus: 0.12, costMult: 0.6, desc: "水师整编减费 40%，由此出征的水师渡战 +12%" },
  granary: { id: "granary", name: "天府粮仓", icon: "🌾", grainBonus: 0.4, foodLossMult: 0.8, desc: "月度军粮产出 +40%，被围时城内余粮消耗减缓 20%" },
  arsenal: { id: "arsenal", name: "军械名都", icon: "🪨", troopBoost: "siege", siegeBonus: 0.15, costMult: 0.55, desc: "攻城械整编减费 45%，由此造出的攻城械破墙 +15%" },
  trade: { id: "trade", name: "商贸通衢", icon: "💰", treasuryBonus: 0.45, desc: "商贾云集之地，月度国库税收额外 +45%" },
};

const SPECIALTY_GROUPS = {
  horse: ["guzang", "tianshui", "anding", "jinyang", "beiping", "xiangping", "ji", "nanpi"],
  shipyard: ["moling", "wu", "shanyin", "chaisang", "lujiang", "jiangxia", "jiangling", "xiangyang"],
  granary: ["chengdu", "zitong", "nanzheng", "xu", "chenliu", "ye", "pingyuan", "runan", "xinye", "jiangzhou"],
  arsenal: ["luoyang", "changan", "shouchun", "xiapi", "xiaopei", "puyang", "wan", "yufu", "shangyong"],
  trade: ["panyu", "jiaozhi", "beihai", "linxiang", "guiyang", "quanling", "linyuan", "jianning", "yunnan"],
};

const CITY_SPECIALTY_LOOKUP = Object.fromEntries(
  Object.entries(SPECIALTY_GROUPS).flatMap(([specId, keys]) => keys.map((k) => [k, specId])),
);

export function citySpecialtyV2(cityKey) {
  return CITY_SPECIALTY_LOOKUP[cityKey] || "trade";
}

export const OFFICER_BONDS_V2 = [
  { id: "taoyuan", name: "桃园结义", members: ["刘备", "关羽", "张飞"], atkBonus: 0.12, defBonus: 0.08, lossMult: 0.88 },
  { id: "wuhu", name: "五虎上将", members: ["关羽", "张飞", "赵云", "马超", "黄忠"], atkBonus: 0.1, defBonus: 0.06, lossMult: 0.9 },
  { id: "wuzi", name: "五子良将", members: ["张辽", "乐进", "于禁", "张郃", "徐晃"], atkBonus: 0.1, defBonus: 0.09, lossMult: 0.9 },
  { id: "wolong_fengchu", name: "卧龙凤雏", members: ["诸葛亮", "庞统", "徐庶"], atkBonus: 0.11, defBonus: 0.1, lossMult: 0.88 },
  { id: "jiangdong_twins", name: "江东双璧", members: ["孙策", "周瑜", "太史慈"], atkBonus: 0.12, defBonus: 0.06, lossMult: 0.9 },
  { id: "wu_marshals", name: "江东柱石", members: ["周瑜", "鲁肃", "吕蒙", "陆逊"], atkBonus: 0.09, defBonus: 0.11, lossMult: 0.89 },
  { id: "wei_kin", name: "魏氏宗亲", members: ["曹操", "夏侯惇", "夏侯渊", "曹仁", "曹洪"], atkBonus: 0.08, defBonus: 0.1, lossMult: 0.91 },
  { id: "wei_strategists", name: "曹魏谋主", members: ["荀彧", "荀攸", "郭嘉", "贾诩", "程昱"], atkBonus: 0.08, defBonus: 0.11, lossMult: 0.9 },
  { id: "yuan_pillars", name: "河北名将", members: ["颜良", "文丑", "张郃", "高览", "田丰"], atkBonus: 0.09, defBonus: 0.07, lossMult: 0.92 },
  { id: "xiliang", name: "西凉铁骑", members: ["马腾", "马超", "韩遂", "庞德"], atkBonus: 0.11, defBonus: 0.05, lossMult: 0.92 },
  { id: "later_shu", name: "蜀汉后柱", members: ["诸葛亮", "姜维", "魏延", "王平"], atkBonus: 0.09, defBonus: 0.09, lossMult: 0.91 },
  { id: "jin_marshals", name: "晋室中枢", members: ["司马懿", "司马昭", "羊祜", "杜预", "文鸯"], atkBonus: 0.1, defBonus: 0.1, lossMult: 0.9 },
];

export const OFFICER_RIVALS_V2 = [
  ["曹操", "刘备"],
  ["诸葛亮", "司马懿"],
  ["周瑜", "诸葛亮"],
  ["关羽", "吕蒙"],
  ["关羽", "曹仁"],
  ["张飞", "吕布"],
  ["曹操", "吕布"],
  ["张辽", "孙权"],
];

// ===== 三期扩展常量：古战五大阵型 / 官爵阶梯 / 国家方略国策 =====

export const FORMATIONS_V2 = {
  heyi: {
    id: "heyi",
    name: "鹤翼阵",
    icon: "🦅",
    atkMult: 1.08,
    defMult: 1.06,
    speedMult: 1.0,
    siegeMult: 1.0,
    lossMult: 0.88,
    summary: "两翼张开合围：攻守均衡且显著降低己方战损(-12%)。",
  },
  fengshi: {
    id: "fengshi",
    name: "锋矢阵",
    icon: "⚡",
    atkMult: 1.15,
    defMult: 0.92,
    speedMult: 1.1,
    siegeMult: 1.0,
    lossMult: 1.06,
    summary: "尖锋突击直插敌阵：野战爆发 +15%、行军略快(+10%)。",
  },
  fangyuan: {
    id: "fangyuan",
    name: "方圆阵",
    icon: "🛡️",
    atkMult: 0.94,
    defMult: 1.18,
    speedMult: 0.88,
    siegeMult: 0.9,
    lossMult: 0.82,
    summary: "四面重盾结阵死守：守势 +18% 且战损极低(-18%)。",
  },
  changshe: {
    id: "changshe",
    name: "长蛇阵",
    icon: "🐍",
    atkMult: 0.98,
    defMult: 0.96,
    speedMult: 1.34,
    siegeMult: 0.86,
    lossMult: 1.0,
    summary: "轻装纵队昼夜疾行：行军提速 +34%，专抢关隘与星夜解围。",
  },
  chongche: {
    id: "chongche",
    name: "冲车阵",
    icon: "🪵",
    atkMult: 0.92,
    defMult: 0.96,
    speedMult: 0.84,
    siegeMult: 1.45,
    lossMult: 0.95,
    summary: "掩护云梯冲车抵近：破城墙与拔关隘威力暴涨 +45%。",
  },
};

export const IMPERIAL_RANKS_V2 = [
  { id: "prefect", minCities: 1, title: "郡守" },
  { id: "governor", minCities: 5, title: "州牧" },
  { id: "general", minCities: 10, title: "大将军" },
  { id: "chancellor", minCities: 16, title: "汉丞相" },
  { id: "king", minCities: 24, title: "封王建国" },
  { id: "emperor", minCities: 34, title: "天子御极" },
];

export function imperialRankForCities(count = 1) {
  let current = IMPERIAL_RANKS_V2[0];
  let nextRank = IMPERIAL_RANKS_V2[1] || null;
  for (let i = 0; i < IMPERIAL_RANKS_V2.length; i += 1) {
    if (count >= IMPERIAL_RANKS_V2[i].minCities) {
      current = IMPERIAL_RANKS_V2[i];
      nextRank = IMPERIAL_RANKS_V2[i + 1] || null;
    }
  }
  return { current, nextRank };
}

export const NATIONAL_DECREES_V2 = {
  tuntian: {
    id: "tuntian",
    name: "许都屯田",
    icon: "🌾",
    cost: 60,
    minCities: 4,
    grainMult: 0.25,
    summary: "全国军粮月产永久 +25%，稳固大军后勤。",
  },
  standing_army: {
    id: "standing_army",
    name: "募兵常备",
    icon: "⚔️",
    cost: 70,
    minCities: 6,
    recruitMult: 0.3,
    summary: "全国各城月度兵员补充永久 +30%。",
  },
  repeating_crossbow: {
    id: "repeating_crossbow",
    name: "诸葛连弩",
    icon: "🏹",
    cost: 85,
    minCities: 8,
    archerTowerMult: 0.18,
    summary: "全国「强弩」兵种战力与官道「连弩箭楼」齐射伤害 +18%。",
  },
  grand_fleet: {
    id: "grand_fleet",
    name: "楼船造舰",
    icon: "⛵",
    cost: 85,
    minCities: 8,
    navyMult: 0.2,
    summary: "全国「水师」战力与江渡作战威力永久 +20%。",
  },
  thunder_siege: {
    id: "thunder_siege",
    name: "霹雳军工",
    icon: "🪨",
    cost: 95,
    minCities: 10,
    siegeMult: 0.22,
    summary: "围城破墙效率及「攻城械」摧毁关隘寨堡威力 +22%。",
  },
  iron_walls: {
    id: "iron_walls",
    name: "坚壁清野",
    icon: "🧱",
    cost: 90,
    minCities: 10,
    wallRepairMult: 0.35,
    wallMitigation: 0.88,
    summary: "城防月修 +35%，且遭敌军围城时城防耐久掉血减免 12%。",
  },
  nine_ranks: {
    id: "nine_ranks",
    name: "九品招贤",
    icon: "📜",
    cost: 100,
    minCities: 12,
    monthlyLoyalty: 2,
    summary: "每月自动提升全军将领忠义 +2，稳固海内名士。",
  },
  imperial_edict: {
    id: "imperial_edict",
    name: "挟天子令",
    icon: "👑",
    cost: 130,
    minCities: 16,
    dealBonus: 18,
    moraleFloor: 75,
    summary: "外交筹码谈判初始威望 +18，全军城池与国力士气保底不低于 75。",
  },
};

// ===== 公共推演原语（多模块无环共享） =====

export const MIN_DISPATCH_TROOPS = 300;
export const MIN_GARRISON_LEAVE = 300;

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function hashStr(str = "") {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function initialEmperorCity(year = 199) {
  const y = Number(year) || 199;
  if (y <= 191) return "luoyang";
  if (y <= 195) return "changan";
  if (y <= 219) return "xu";
  return null;
}

export function eraByYearV2(world, year) {
  return world?.scenarios?.find((s) => s.year === year) || world?.scenarios?.[0] || { year, title: "三国群雄", factions: [], ownership: {}, officers: [] };
}

export function cityByKey(world, key) {
  return world?.cities?.find((c) => c.key === key) || null;
}

export function cityNameV2(world, key) {
  return cityByKey(world, key)?.name || key;
}

export function factionNameV2(world, state, key) {
  return state?.factions?.[key]?.name || eraByYearV2(world, state?.year)?.factions?.find((f) => f.key === key)?.name || key;
}

export function edgeDistance(world, aKey, bKey) {
  const a = cityByKey(world, aKey);
  const b = cityByKey(world, bKey);
  if (!a || !b) return 55;
  return Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]);
}

export function activeTreaty(state, f1, f2) {
  if (!f1 || !f2 || f1 === f2) return null;
  return (state?.treaties || []).find(
    (t) => t.expires > state.turn && t.sides.includes(f1) && t.sides.includes(f2),
  ) || null;
}

export function isHostileV2(state, f1, f2) {
  return Boolean(f1 && f2 && f1 !== f2 && !activeTreaty(state, f1, f2));
}

export function canTransitCity(state, faction, cityKey) {
  const city = state?.cities?.[cityKey];
  if (!city) return false;
  if (city.owner === faction) return true;
  const treaty = activeTreaty(state, faction, city.owner);
  return treaty?.kind === "alliance";
}

export function findRoadPath(world, state, faction, fromKey, toKey, { allowEnemyEnd = true, maxHops = 8 } = {}) {
  if (!fromKey || !toKey || fromKey === toKey) return null;
  const targetCity = state?.cities?.[toKey];
  if (!targetCity) return null;
  if (!allowEnemyEnd && !canTransitCity(state, faction, toKey)) return null;
  if (!canTransitCity(state, faction, fromKey)) return null;

  const adj = new Map(world.cities.map((c) => [c.key, c.links]));
  const bestCost = new Map([[fromKey, 0]]);
  const prev = new Map();
  const queue = [{ key: fromKey, cost: 0, hops: 0 }];

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift();
    if (cur.key === toKey) break;
    if (cur.hops >= maxHops) continue;
    for (const nb of adj.get(cur.key) || []) {
      const isDest = nb === toKey;
      if (!isDest && !canTransitCity(state, faction, nb)) continue;
      if (isDest && !allowEnemyEnd && !canTransitCity(state, faction, nb)) continue;
      if (isDest && state.cities[nb].owner !== faction) {
        const tr = activeTreaty(state, faction, state.cities[nb].owner);
        if (tr?.kind === "truce" && !allowEnemyEnd) continue;
      }
      const nextCost = cur.cost + edgeDistance(world, cur.key, nb);
      if (nextCost < (bestCost.get(nb) ?? Infinity)) {
        bestCost.set(nb, nextCost);
        prev.set(nb, cur.key);
        queue.push({ key: nb, cost: nextCost, hops: cur.hops + 1 });
      }
    }
  }

  if (!prev.has(toKey)) return null;
  const path = [toKey];
  let step = toKey;
  while (step !== fromKey) {
    step = prev.get(step);
    if (!step) return null;
    path.unshift(step);
  }
  return path;
}

export function edgeDekadsRequired(world, fromKey, toKey, troopType = "infantry", weather = null, officer = null, formation = "heyi") {
  const dist = edgeDistance(world, fromKey, toKey);
  const typeDef = TROOP_TYPES[troopType] || TROOP_TYPES.infantry;
  const formDef = FORMATIONS_V2[formation] || FORMATIONS_V2.heyi;
  const terrain = roadTerrain(fromKey, toKey);
  let speed = typeDef.speed * (formDef.speedMult ?? 1);
  if (troopType === "navy") speed = (terrain === "river" ? typeDef.riverSpeed : 0.9) * (formDef.speedMult ?? 1);
  if (terrain === "river" && troopType !== "navy") speed *= 0.85;
  if (terrain === "pass" && troopType === "cavalry") speed *= 0.82;
  const hasLogistics = officer?.traits?.includes("logistics");
  const wMarch = weather?.marchMult ?? 1;
  if (hasLogistics && wMarch < 1) speed *= 1.05;
  else speed *= wMarch;
  const raw = Math.round(dist / 28 / Math.max(0.55, speed));
  return clamp(raw, 2, 5);
}

export function computeMarchDekads(world, route, troopType = "infantry", weather = null, officer = null, formation = "heyi") {
  if (!route || route.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < route.length - 1; i += 1) {
    total += edgeDekadsRequired(world, route[i], route[i + 1], troopType, weather, officer, formation);
  }
  return total;
}

export function armyWorldPosition(world, army) {
  if (army.stance === "besiege") {
    const pos = cityByKey(world, army.targetCity || army.to)?.position || [390, 250];
    const seed = hashStr(army.id || army.officer || army.escortName || "");
    const ang = ((seed % 360) * Math.PI) / 180;
    return [pos[0] + Math.cos(ang) * 14, pos[1] + Math.sin(ang) * 14];
  }
  const a = cityByKey(world, army.from)?.position;
  const b = cityByKey(world, army.to)?.position;
  if (!a || !b) return a || b || [390, 250];
  const t = clamp(army.progress ?? 0, 0, 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function returnOfficerHome(state, offKey, preferredCityKey) {
  if (!offKey) return;
  const off = state?.officers?.[offKey];
  if (!off) return;
  off.armyId = null;
  off.transferringTo = null;
  if (preferredCityKey && state.cities[preferredCityKey]?.owner === off.faction) {
    off.city = preferredCityKey;
    return;
  }
  const fallback = Object.values(state.cities).find((c) => c.owner === off.faction);
  off.city = fallback?.key || null;
}

export function availableOfficersInCity(state, cityKey, faction = null) {
  const city = state?.cities?.[cityKey];
  if (!city) return [];
  const f = faction || city.owner;
  return Object.values(state.officers).filter(
    (o) => o.faction === f && o.city === cityKey && !o.armyId && !o.capturedBy && !o.transferringTo && (o.injuredDekads || 0) <= 0,
  ).sort((a, b) => (b.command + b.might * 0.4) - (a.command + a.might * 0.4));
}

export function forecastDispatch(world, state, { from, to, troops, troopType, officer, formation = "heyi" }) {
  const fromCity = state.cities[from];
  const toCity = state.cities[to];
  if (!fromCity || !toCity) return { ok: false, reason: "请选择有效的出发城池与目标城池。" };
  const faction = fromCity.owner;
  const route = findRoadPath(world, state, faction, from, to, { allowEnemyEnd: true });
  if (!route) return { ok: false, reason: "两城之间暂无我方/盟友可通行的道路。" };
  const isFriendlyDest = canTransitCity(state, faction, to);
  if (!isFriendlyDest && activeTreaty(state, faction, toCity.owner)) {
    return { ok: false, reason: "与目标势力尚在停战/同盟期内，不可进攻。" };
  }
  const type = troopType || fromCity.troopType || "infantry";
  const resolvedForm = FORMATIONS_V2[formation] ? formation : "heyi";
  const offObj = typeof officer === "string" ? state.officers[officer] : officer;
  const dekads = computeMarchDekads(world, route, type, state.weather, offObj, resolvedForm);
  const grainCost = Math.max(4, Math.ceil((troops || MIN_DISPATCH_TROOPS) / 220) * 2);
  const terrain = roadTerrain(route[route.length - 2], to);
  const counter = isFriendlyDest
    ? { mult: 1, label: "增援己方", relation: "neutral" }
    : troopCounterEffect(type, toCity.troopType, terrain, state.weather);

  return {
    ok: true,
    route,
    dekads,
    grainCost,
    terrain,
    counter,
    isFriendlyDest,
    targetWall: toCity.wall,
    targetTroops: toCity.troops,
    targetTroopType: toCity.troopType,
  };
}

export function createArmyRecord(world, state, {
  faction, from, route, officerKey = null, deputyKey = null, escortName = null,
  troops, troopType, stance, siegeStance = "storm", formation = "heyi", delayDekads = 0,
}) {
  const id = `army-${state.nextArmySeq++}`;
  const to = route[1];
  const resolvedForm = FORMATIONS_V2[formation] ? formation : "heyi";
  const reqDekads = edgeDekadsRequired(world, from, to, troopType, state.weather, officerKey ? state.officers[officerKey] : null, resolvedForm);
  return {
    id,
    faction,
    officer: officerKey || null,
    deputy: deputyKey || null,
    escortName: escortName || null,
    formation: resolvedForm,
    troops,
    maxTroops: troops,
    troopType,
    morale: clamp(state.factions[faction]?.morale ?? 80, 50, 100),
    grain: Math.max(8, Math.ceil(troops / 180) * 3),
    route,
    step: 0,
    from,
    to,
    targetCity: route[route.length - 1],
    depot: from,
    progress: delayDekads > 0 ? 0.02 : 0.08,
    edgeDekads: reqDekads,
    delayDekads: Math.max(0, Math.round(delayDekads || 0)),
    stance,
    siegeStance,
    engagedWith: null,
    engageRounds: 0,
    rage: 0,
    supplyCut: false,
    reorgDekads: 0,
    fireRaidHit: false,
    lastPos: cityByKey(world, from)?.position || [390, 250],
  };
}



