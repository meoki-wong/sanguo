import { eraByYear, firstCity, forceTotals, gameOutcome, playableFactions } from "./engine.js";
import { treatyWith } from "./diplomacy.js";
import { assessGoal } from "./strategy.js";

function reportKinds(entry) {
  if (entry.type === "army" || entry.type === "theater" || entry.orderType === "mobilize") return ["combat"];
  if (entry.type === "recruit-officer") return ["staff"];
  if (entry.type === "capture") return ["combat", "occupation"];
  if (entry.type === "battle" || entry.type === "frontline" || entry.type === "command") return ["combat"];
  if (entry.type === "recovery") return ["occupation"];
  if (entry.type === "diplomacy") return ["diplomacy"];
  if (entry.type === "grand") return entry.participants ? ["diplomacy"] : ["combat", "domestic"];
  if (entry.orderType === "deploy") return ["staff"];
  if (entry.orderType === "appoint-governor") return ["staff", "occupation"];
  if (entry.orderType === "delegate-city") return ["domestic"];
  if (entry.orderType === "transfer" || (entry.type === "order" && /调\s+[\d,]+\s+人至/.test(entry.text))) return ["transfer"];
  if (entry.type === "notice" && entry.orderType === "attack") return ["combat"];
  if (["order", "income", "delegation"].includes(entry.type)) return ["domestic"];
  return [];
}

export function filteredReports(history, { section, turn, category, faction }) {
  const reports = [...history].reverse().filter((report) => turn === "all" || String(report.turn) === turn);
  return reports.flatMap((report) => {
    const entries = section === "plans" ? report.decisions ?? [] : report.entries;
    return entries.filter((entry) => {
      const included = faction === "all" || faction === entry.faction || entry.participants?.includes(faction);
      return included && (section === "plans" || category === "all" || reportKinds(entry).includes(category));
    }).map((entry) => {
      const item = { entry, turn: report.turn };
      if (section === "plans" && entry.entryIndex !== undefined) {
        item.receipt = entry.entryIndex === null ? null : report.entries[entry.entryIndex];
      }
      return item;
    });
  });
}

export function opponentBrief(world, state, faction) {
  const opponent = playableFactions(eraByYear(world, state)).find(({ key }) => key === faction && key !== state.player);
  if (!opponent) return null;
  const { cities, troops } = forceTotals(state, faction);
  const treaty = cities ? treatyWith(state, state.player, faction) : null;
  const goal = state.strategies?.[faction];
  const assessment = cities && goal && gameOutcome(state) === "ongoing" ? assessGoal(state, faction, goal) : null;
  const [latest = null] = filteredReports(state.history, { section: "plans", turn: "all", faction });
  return { opponent, cities, troops, treaty, seat: cities ? firstCity(world, state, faction) : null,
    strategy: assessment?.status === "active" ? assessment : null, latest };
}

export function opponentHoldings(world, state, faction, { query = "", sort = "map" } = {}) {
  const controlled = world.cities.filter(({ key }) => state.cities[key].owner === faction);
  const search = query.trim();
  const matching = controlled.filter(({ name }) => name.includes(search)).map((city) => ({ city, holding: state.cities[city.key] }));
  if (sort === "troops") matching.sort((a, b) => b.holding.troops - a.holding.troops);
  return { total: controlled.length, matching };
}

export function territoryChanges(history, faction) {
  const reports = [...history].reverse().sort((a, b) => b.turn - a.turn);
  const changes = [];
  for (const { turn, entries } of reports) {
    for (const entry of entries.toReversed()) {
      const { type, city, faction: attacker, battle, participants } = entry;
      if (type !== "capture" || !city || !attacker) continue;
      let defender = battle?.defender.faction;
      if (!defender && participants?.includes(attacker)) {
        const opponents = new Set(participants.filter((side) => side !== attacker));
        if (opponents.size === 1) [defender] = opponents;
      }
      if (attacker === faction) changes.push({ kind: "gain", other: defender, entry, turn });
      else if (defender === faction) changes.push({ kind: "loss", other: attacker, entry, turn });
    }
  }
  return changes;
}

export function latestSeasonSummary(state) {
  const report = state.history.at(-1);
  if (!report) return null;
  let gains = 0;
  let losses = 0;
  let cancellations = 0;
  let lossesIncomplete = false;
  const events = [];
  const battles = [];
  for (const entry of report.entries) {
    if (entry.faction === state.player && ["stage", "milestone", "event", "victory", "defeat"].includes(entry.type)) {
      events.push({ kind: entry.type, entry });
    }
    if (entry.faction === state.player && entry.type === "army" && entry.reason === "supply-cut") events.push({ kind: "army", entry });
    if (entry.faction === state.player && entry.type === "theater" && entry.reason === "theater-blocked") events.push({ kind: "theater", entry });
    if (entry.type === "war" && (entry.faction === state.player || entry.participants?.includes(state.player))
      && ["isolated", "withdraw-blocked", "relieved", "diverted", "strained", "milestone"].includes(entry.event)) events.push({ kind: "war", entry });
    if (entry.type === "notice" && entry.faction === state.player) {
      cancellations += 1;
      events.push({ kind: "cancelled", entry });
    }
    if (entry.type === "battle") {
      if (entry.faction === state.player) battles.push({ kind: "attack-failed", entry });
      else if (entry.participants?.includes(state.player)) battles.push({ kind: "defended", entry });
    }
    if (entry.type !== "capture") continue;
    if (entry.faction === state.player) {
      gains += 1;
      events.push({ kind: "gain", entry });
    } else if (entry.participants?.includes(state.player)) {
      losses += 1;
      events.push({ kind: "loss", entry });
    } else if (!entry.participants?.includes(entry.faction) || new Set(entry.participants).size < 2) {
      lossesIncomplete = true;
    }
  }
  const ledger = report.finance;
  const balance = ledger ? {
    treasury: ledger.closing.treasury - ledger.opening.treasury,
    grain: ledger.closing.grain - ledger.opening.grain,
  } : null;
  const offer = state.incomingTreaty;
  return {
    turn: report.turn,
    gains, losses, lossesIncomplete, cancellations, balance, events: [...events, ...battles],
    envoy: offer?.answer === null && offer.turn === report.turn && offer.turn === state.turn ? offer : null,
  };
}

