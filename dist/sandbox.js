import { createGame, eraByYear, firstCity, previewOrders } from "./engine.js";
import { ensureSaga, MAX_WILD_RECRUITS, recordAnnal } from "./saga.js";
import { officerMeta } from "./traits.js";

export const SANDBOX_HERO_POOL = [
  { id: "sb_zhuge", name: "诸葛亮", governance: 98, command: 93 },
  { id: "sb_lvbu", name: "吕布", governance: 48, command: 97 },
  { id: "sb_guanyu", name: "关羽", governance: 74, command: 96 },
  { id: "sb_zhaoyun", name: "赵云", governance: 76, command: 93 },
  { id: "sb_zhouyu", name: "周瑜", governance: 90, command: 96 },
  { id: "sb_guojia", name: "郭嘉", governance: 84, command: 62 },
  { id: "sb_simayi", name: "司马懿", governance: 95, command: 94 },
  { id: "sb_zhangliao", name: "张辽", governance: 66, command: 94 },
  { id: "sb_luxun", name: "陆逊", governance: 89, command: 94 },
  { id: "sb_machao", name: "马超", governance: 58, command: 95 },
  { id: "sb_xunyu", name: "荀彧", governance: 96, command: 56 },
  { id: "sb_pangtong", name: "庞统", governance: 90, command: 84 },
  { id: "sb_dengai", name: "邓艾", governance: 89, command: 91 },
  { id: "sb_taishici", name: "太史慈", governance: 58, command: 90 },
  { id: "sb_jiangwei", name: "姜维", governance: 82, command: 91 },
  { id: "sb_ganning", name: "甘宁", governance: 54, command: 91 },
];

export function sandboxHeroSummary(hero) {
  const meta = officerMeta(hero);
  return `${hero.name}（统${hero.command}·武${meta.might}·智${meta.intellect}·政${hero.governance}）`;
}

/**
 * Launches a Sandbox / Custom Ruler campaign on any existing scenario & host faction,
 * injecting custom ruler metadata, 0-5 selected dream heroes as saga.wildRecruits,
 * and optional sandbox rule toggles cleanly without breaking save validation.
 */
export function createCustomRulerGame(world, {
  year = 251,
  baseFaction = null,
  rulerName = "新君",
  stateName = "大汉义师",
  heroIds = [],
  difficulty = "hard",
  rules = {},
} = {}) {
  const era = eraByYear(world, year);
  if (!era) throw new Error(`未知剧本年份：${year}`);
  const factionKey = baseFaction && era.factions.some((f) => f.key === baseFaction)
    ? baseFaction
    : era.factions[0].key;

  const state = createGame(world, year, factionKey, {
    century: true,
    difficulty,
    historicalEvents: rules.historicalEvents !== false,
  });
  const saga = ensureSaga(state);
  const cleanRuler = String(rulerName || "新君").trim().slice(0, 12) || "新君";
  const cleanState = String(stateName || era.factions.find((f) => f.key === factionKey)?.name || "义师").trim().slice(0, 12);

  saga.custom = {
    rulerName: cleanRuler,
    stateName: cleanState,
  };
  saga.rules = {
    noPrepTurn: Boolean(rules.noPrepTurn),
    doubleTech: Boolean(rules.doubleTech),
    fierceCoalition: Boolean(rules.fierceCoalition),
  };

  const homeCity = firstCity(world, state);
  const existingNames = new Set(era.officers.filter((o) => o.faction === factionKey).map((o) => o.name));
  const selected = SANDBOX_HERO_POOL.filter((h) => heroIds.includes(h.id) && !existingNames.has(h.name)).slice(0, 5);
  for (const hero of selected) {
    const key = `saga-wild-${hero.id}`;
    saga.wildRecruits.push({
      key,
      faction: factionKey,
      name: hero.name,
      governance: hero.governance,
      command: hero.command,
      turn: 0,
    });
    state.stations[key] = homeCity;
  }
  saga.wildRecruits = saga.wildRecruits.slice(-MAX_WILD_RECRUITS);

  if (rules.bonusResources) {
    state.factions[factionKey].treasury += 80;
    state.factions[factionKey].grain += 80;
    saga.tech.points += 120;
  }

  recordAnnal(state, "创朝", `${cleanRuler}建号「${cleanState}」起兵于${world.cities.find((c) => c.key === homeCity)?.name ?? homeCity}${selected.length ? `，麾下名将${selected.map((h) => h.name).join("、")}齐聚` : ""}！`);
  previewOrders(world, state);
  return state;
}
