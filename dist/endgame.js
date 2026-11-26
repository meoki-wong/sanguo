import { eraByYear, forceTotals, gameOutcome } from "./engine.js";
import { campaignRoute } from "./campaign.js";
import { coalitionCriteria } from "./accords.js";
import { formerlyServed } from "./polities-data.js";
import { peaceCriteria } from "./polity.js";

const endings = {
  184: { name: "安民定乱", stock: "grain", wealth: "储粮", margin: 95 },
  190: { name: "关东定势", stock: "treasury", wealth: "国库", margin: 90 },
  199: { name: "立业中原", stock: "treasury", wealth: "国库", margin: 85 },
  208: { name: "定江保境", stock: "grain", wealth: "储粮", margin: 90 },
  219: { name: "荆汉定局", stock: "grain", wealth: "储粮", margin: 110 },
  234: { name: "持重定策", stock: "grain", wealth: "储粮", margin: 125 },
  251: { name: "英雄定鼎", stock: "grain", wealth: "储粮", margin: 120 },
  262: { name: "山河相持", stock: "grain", wealth: "储粮", margin: 110 },
  265: { name: "安定州郡", stock: "treasury", wealth: "国库", margin: 95 },
};

export function scenarioEndingCriteria(world, state) {
  const era = eraByYear(world, state);
  const rule = endings[state.year];
  const starting = Object.values(era.ownership).filter((owner) => owner === state.player).length;
  const core = Math.ceil(starting * .8);
  const owned = Object.values(state.cities).filter(({ owner }) => owner === state.player);
  const peaceful = owned.filter(({ occupation }) => !occupation).length;
  const original = Object.keys(era.ownership).filter((key) => era.ownership[key] === state.player && state.cities[key].owner === state.player).length;
  const wealth = era.factions.find(({ key }) => key === state.player).stats[rule.stock === "treasury" ? 0 : 1];
  const checks = [
    { label: "已结算季度", value: state.turn, target: 16 },
    { label: "战役目标", value: campaignRoute(world, era, state).filter(({ completed }) => completed !== null).length, target: 3 },
    { label: "保有开局城", value: original, target: core },
    { label: "稳定辖城", value: peaceful, target: Math.min(world.cities.length, starting + (starting <= 3 ? 1 : 2)) },
    { label: rule.wealth, value: state.factions[state.player][rule.stock], target: wealth + rule.margin },
  ];
  return { title: rule.name, checks, ready: !state.orders.length && checks.every(({ value, target }) => value >= target) };
}

export function concludeScenario(world, state) {
  if (state.reign?.stewardship || gameOutcome(state) !== "ongoing" || !scenarioEndingCriteria(world, state).ready) throw new Error("请先达成剧本条件并结清待执行政令。");
  const next = structuredClone(state);
  next.scenarioEnding = { turn: state.turn };
  next.incomingTreaty = null;
  return next;
}

export function concludeCoalition(world, state) {
  const era = eraByYear(world, state);
  if (state.reign?.stewardship || gameOutcome(state) !== "ongoing" || !coalitionCriteria(world, era, state).ready) throw new Error("联盟条件尚未满足。");
  return { ...state, scenarioEnding: { turn: state.turn, kind: "coalition" }, incomingTreaty: null };
}

export function recordCampaign(state, entries) {
  const { player, turn } = state;
  const { cities, troops } = forceTotals(state, player);
  const totals = state.campaignRecord ?? { from: turn, peak: 0, peakTroops: 0, gained: 0, lost: 0, victories: 0, defeats: 0, battles: [] };
  totals.peak = Math.max(totals.peak, cities);
  totals.peakTroops = Math.max(totals.peakTroops, troops);
  for (const entry of entries) {
    const battle = entry.battle;
    if (!battle || ![battle.attacker.faction, battle.defender.faction].includes(player)) continue;
    const attack = battle.attacker.faction === player;
    const capture = entry.type === "capture";
    const won = attack === capture;
    if (capture) totals[attack ? "gained" : "lost"] += 1;
    totals[won ? "victories" : "defeats"] += 1;
    const officer = (attack ? battle.personnel?.attacker : battle.personnel?.defender) ?? null;
    if (officer) {
      totals.people ??= {};
      totals.people[officer] ??= { wins: 0, defeats: 0 };
      totals.people[officer][won ? "wins" : "defeats"] += 1;
    }
    totals.battles.push({ city: entry.city, turn, won, capture, worth: battle.attacker.casualties + battle.defender.casualties, officer });
  }
  totals.battles.sort((a, b) => Number(b.capture) - Number(a.capture) || b.worth - a.worth || b.turn - a.turn);
  totals.battles = totals.battles.slice(0, 5);
  state.campaignRecord = totals;
}

export function validEnding(world, state, officers) {
  if (state.scenarioEnding !== undefined) {
    if (state.scenarioEnding?.turn !== state.turn) return false;
    if (state.scenarioEnding.kind === "coalition") {
      if (!coalitionCriteria(world, eraByYear(world, state), state).ready) return false;
    } else if (state.scenarioEnding.kind === "peace") {
      if (!peaceCriteria(world, state).ready) return false;
    } else if (state.scenarioEnding.kind !== undefined || !scenarioEndingCriteria(world, state).ready) return false;
  }
  const record = state.campaignRecord;
  if (record === undefined) return true;
  const nonnegative = (value) => Number.isSafeInteger(value) && value >= 0;
  if (!record || !nonnegative(record.from) || record.from < 1 || record.from > state.turn || !nonnegative(record.peak)
    || record.peak > world.cities.length || ![record.peakTroops, record.gained, record.lost, record.victories, record.defeats].every(nonnegative)
    || !Array.isArray(record.battles) || record.battles.length > 5) return false;
  if (record.people !== undefined && (!record.people || typeof record.people !== "object" || Array.isArray(record.people)
    || !Object.entries(record.people).every(([key, result]) => (officers.get(key)?.faction === state.player || formerlyServed(state, key, state.player))
      && result && nonnegative(result.wins) && nonnegative(result.defeats)))) return false;
  return record.battles.every((battle) => battle && Object.hasOwn(state.cities, battle.city) && nonnegative(battle.turn)
    && battle.turn >= record.from && battle.turn <= state.turn && typeof battle.won === "boolean" && typeof battle.capture === "boolean"
    && nonnegative(battle.worth) && (battle.officer === null || officers.get(battle.officer)?.faction === state.player
      || formerlyServed(state, battle.officer, state.player)));
}
