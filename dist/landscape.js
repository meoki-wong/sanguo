import { cityName, gameOutcome } from "./engine.js";
import { adjustCredit } from "./accords.js";
import { plain } from "./polities-data.js";
import { initialEquipment, settleEconomy, validEconomy } from "./landscape-economy.js";
import { settleCongresses, validCongresses } from "./landscape-treaty.js";
import { seasonWeather } from "./landscape-terrain.js";
import { townIntel } from "./war-intel.js";

export const openingDifficulties = { normal: "均衡", calm: "从容", hard: "艰险" };
export const openingGoals = { historic: "史实目标", relief: "恢复民生", ports: "繁荣商埠", defense: "稳固城防" };
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const pair = () => ({ treasury: 0, grain: 0 });

export function openingRules(state, opening) {
  if (!opening) return null;
  const { difficulty = "normal", goal = "historic", relations = {} } = opening;
  if (!Object.hasOwn(openingDifficulties, difficulty) || !Object.hasOwn(openingGoals, goal) || !plain(relations)
    || !Object.entries(relations).every(([key, value]) => key !== state.player && Object.hasOwn(state.factions, key)
      && integer(value, -30, 40))) throw new Error("自定义剧本的难度、目标或初始关系无效。");
  return { difficulty, goal, relations: { ...relations } };
}

export function enableLandscape(world, state, opening = null) {
  if (state.landscape) return state;
  if (!state.grand || gameOutcome(state) !== "ongoing") throw new Error("请选择进行中的天下大势战局。");
  const next = structuredClone(state);
  const custom = openingRules(next, opening);
  next.landscape = { since: state.turn, sequence: 1, custom, bridges: {}, repairs: [], equipment: initialEquipment(world, state),
    policies: {}, convoys: [], congresses: [], replay: [] };
  if (custom) {
    for (const [side, credit] of Object.entries(custom.relations)) adjustCredit(next, next.player, side, credit);
    if (custom.difficulty !== "normal") {
      for (const [side, stock] of Object.entries(next.factions)) {
        if (side === next.player && custom.difficulty === "calm" || side !== next.player && custom.difficulty === "hard") {
          stock.treasury += 45;
          stock.grain += 60;
        }
      }
    }
  }
  return next;
}

export function customObjective(world, state) {
  const goal = state.landscape?.custom?.goal;
  const metrics = {
    relief: ["使辖城民生提升到 75。", (key) => state.realm.cities[key].welfare >= 75],
    ports: ["使辖城商贸达到 3 级。", (key) => state.cities[key].commerce >= 3],
    defense: ["使辖城城防达到 3 级并留守至少 1,800 人。", (key) => state.cities[key].defense >= 3 && state.cities[key].troops >= 1800],
  };
  if (!Object.hasOwn(metrics, goal)) return null;
  const [description, metric] = metrics[goal];
  const rows = world.cities.filter(({ key }) => state.cities[key].owner === state.player).map((city) =>
    ({ city, holding: state.cities[city.key], met: !state.cities[city.key].occupation && metric(city.key) }));
  return { title: openingGoals[goal], description, required: 2, rows, progress: rows.filter(({ met }) => met).length };
}

export function observerReport(world, state, faction) {
  if (!state.landscape) return null;
  const { name } = seasonWeather(state);
  const cities = world.cities.flatMap(({ key, links }) => {
    if (state.cities[key].owner === faction || !links.some((link) => state.cities[link].owner === faction)) return [];
    const intel = townIntel(state, faction, key);
    const age = intel.seen === undefined ? null : Math.max(0, state.turn - intel.seen);
    const confidence = age === null ? "未知" : age > 2 ? "低" : intel.source === "scout" ? "高" : "中";
    return [{ city: cityName(world, key), source: intel.source, age, confidence, troops: intel.troops }];
  }).slice(0, 18);
  const politics = Object.values(state.landscape.congresses).filter(({ parties }) => parties.includes(faction)).slice(-4)
    .map(({ host, status, target, delivered, contributions }) => ({ host, status, target: cityName(world, target), delivered,
      ownContribution: contributions[faction] ?? 0 }));
  const equipment = Object.entries(state.landscape.equipment).filter(([key]) => state.cities[key].owner === faction)
    .reduce((sum, [, value]) => sum + value, 0);
  return { weather: name, cities, politics, equipment };
}

export function settleLandscape(world, state, proposals, entries, forecast = false) {
  if (!state.landscape) return null;
  const ledger = { budget: pair(), in: pair(), out: pair() };
  const account = (faction, type, amount) => {
    const stock = state.factions[faction];
    if (type !== "in" && (stock.treasury < amount.treasury || stock.grain < amount.grain)) return false;
    for (const resource of ["treasury", "grain"]) {
      stock[resource] += (type === "in" ? 1 : -1) * amount[resource];
      if (faction === state.player) ledger[type][resource] += amount[resource];
    }
    return true;
  };
  settleEconomy(world, state, account, entries);
  settleCongresses(world, state, forecast ? {} : proposals, account, entries);
  if (!forecast) {
    const stages = entries.filter((row) => row.faction === state.player
      && (["army", "war", "capture", "battle"].includes(row.type) || row.orderType === "mobilize" && row.type === "order"))
      .slice(-12).map((row) => ({
        city: row.operationTarget ?? row.city,
        phase: row.operationTarget ? "muster" : row.type,
        event: row.event ?? row.reason ?? null,
        text: row.text.slice(0, 160),
        ...(row.battle ? { from: row.battle.from, strength: [row.battle.attacker.strength, row.battle.defender.strength],
          losses: [row.battle.attacker.casualties, row.battle.defender.casualties] } : row.operationTarget ? { from: row.city } : {}),
      }));
    state.landscape.replay = [...state.landscape.replay, { turn: state.turn, weather: seasonWeather(state).name, stages }].slice(-12);
  }
  return ledger;
}

export function validLandscape(world, state) {
  const data = state.landscape;
  if (data === undefined) return true;
  if (!state.grand || !plain(data) || !integer(data.since, state.grand.since, state.turn)
    || !integer(data.sequence, 1, 15000000) || !validEconomy(world, state, data) || !validCongresses(state, data)
    || !Array.isArray(data.replay) || data.replay.length > 12 || !data.replay.every((row) => row
      && integer(row.turn, data.since, state.turn - 1) && ["春雨", "夏汛", "秋晴", "冬雪"].includes(row.weather)
      && Array.isArray(row.stages) && row.stages.length <= 12 && row.stages.every((stage) => stage
        && Object.hasOwn(state.cities, stage.city) && ["army", "war", "capture", "battle", "muster"].includes(stage.phase)
        && (stage.from === undefined || Object.hasOwn(state.cities, stage.from))
        && [stage.strength, stage.losses].every((pair) => pair === undefined || Array.isArray(pair) && pair.length === 2
          && pair.every((count) => integer(count, 0, Number.MAX_SAFE_INTEGER)))
        && typeof stage.text === "string" && stage.text.length <= 160))) return false;
  if (new Set([...data.convoys, ...data.congresses].map(({ id }) => id)).size !== data.convoys.length + data.congresses.length) return false;
  if (data.custom === null) return true;
  if (!plain(data.custom) || !state.grand.custom) return false;
  try { openingRules(state, data.custom); } catch { return false; }
  return true;
}
