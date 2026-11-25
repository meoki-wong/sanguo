import { allianceTrade, treatyTerms } from "./diplomacy.js";

export const programResults = {
  completed: "已执行",
  budget: "本城预算不足",
  "national-budget": "全国拨款上限已用完",
  unrest: "地方拒绝征募",
  population: "可征募人口不足",
  treasury: "国库不足",
  grain: "储粮不足",
  "reserve-treasury": "按国库预留暂缓",
  "reserve-grain": "按储粮预留暂缓",
  occupation: "城池整顿中",
  level: "项目已满级",
  garrison: "驻军已达委任征兵上限",
  lost: "城池易主",
};

const nonnegative = (number) => Number.isSafeInteger(number) && number >= 0;

export function validResourcePair(value) {
  return value && typeof value === "object" && !Array.isArray(value) && nonnegative(value.treasury) && nonnegative(value.grain);
}

export function funds(stock) {
  return { treasury: stock.treasury, grain: stock.grain };
}

export function spending(before, after) {
  return { treasury: before.treasury - after.treasury, grain: before.grain - after.grain };
}

export function filterDelegationPrograms(programs, requested) {
  const present = new Set(programs.map(({ result }) => result));
  const reasons = Object.keys(programResults).filter((result) => result !== "completed" && present.has(result));
  const filter = ["all", "completed", "unexecuted", ...reasons].includes(requested) ? requested : "all";
  const matching = filter === "all" ? programs : programs.filter(({ result }) =>
    filter === "unexecuted" ? result !== "completed" : result === filter);
  return { filter, reasons, matching };
}

function delegationQuarter({ programs, delegation: spent }) {
  if (!programs) return null;
  const projects = { farming: 0, commerce: 0, defense: 0, recruit: 0 };
  const unexecuted = new Map();
  let completed = 0;
  for (const { result, project, focus } of programs) {
    if (result === "completed") {
      completed += 1;
      projects[project ?? focus] += 1;
    } else {
      unexecuted.set(result, (unexecuted.get(result) ?? 0) + 1);
    }
  }
  return { cities: programs.length, completed, projects, spent, unexecuted: [...unexecuted].sort((a, b) => b[1] - a[1]) };
}

export function quarterlyFinance(history) {
  const archive = new Map(history.filter(({ turn }) => turn > 0).map(({ turn, finance }) => [turn, finance]));
  if (!archive.size) return [];
  const turns = [...archive.keys()];
  const last = Math.max(...turns);
  const first = Math.max(Math.min(...turns), last - 11);
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const turn = first + index;
    const ledger = archive.get(turn);
    if (!ledger) return { turn, closing: null, net: null, delegation: null };
    const { opening, closing } = ledger;
    const net = { treasury: closing.treasury - opening.treasury, grain: closing.grain - opening.grain };
    return { turn, closing, net, delegation: delegationQuarter(ledger) };
  });
}

export function openingLedger(state, income) {
  const paid = state.treatyOffers.reduce((sum, offer) => sum + (offer.accepted ? treatyTerms[offer.kind].treasury : 0), 0);
  const incoming = state.incomingTreaty;
  const received = incoming?.answer === true ? treatyTerms[incoming.kind].treasury : 0;
  const trade = allianceTrade(state, state.player);
  const stock = state.factions[state.player];
  const ledger = {
    opening: { treasury: stock.treasury + paid - received, grain: stock.grain },
    tax: { treasury: income.treasury - trade, grain: income.grain },
    trade,
    gifts: { paid, received },
  };
  if (state.delegationReserve) ledger.reserve = funds(state.delegationReserve);
  return ledger;
}

export function validLedger(ledger, cities, focuses, developmentProjects) {
  if (!ledger || !Array.isArray(ledger.programs) || ledger.programs.length > Object.keys(cities).length) return false;
  const { opening, tax, trade, gifts, orders, delegation, closing, programs, reserve, realm, politics, grand, landscape, statecraft, sandtable, dynasty, reign, century, armyReturns = 0 } = ledger;
  const seasonal = [politics, grand, landscape, statecraft, sandtable, dynasty, reign, century];
  if (![opening, tax, orders, delegation, closing].every(validResourcePair) || !nonnegative(trade)
    || (reserve !== undefined && !validResourcePair(reserve))
    || !gifts || !nonnegative(gifts.paid) || !nonnegative(gifts.received) || !nonnegative(armyReturns)
    || (realm !== undefined && (!realm || ![realm.commerce, realm.aidIn, realm.aidOut].every(nonnegative) || !validResourcePair(realm.relief)))
    || seasonal.some((item) => item !== undefined && (!item || ![item.in, item.out, item.budget].every(validResourcePair)))) return false;
  const afterPolitics = (resource) => seasonal.reduce((sum, item) =>
    sum + (item ? item.in[resource] - item.out[resource] - item.budget[resource] : 0), 0);
  if (opening.treasury + tax.treasury + trade + gifts.received - gifts.paid - orders.treasury - delegation.treasury
    + (realm?.commerce ?? 0) - (realm?.relief.treasury ?? 0) + afterPolitics("treasury") !== closing.treasury
    || opening.grain + tax.grain + armyReturns - orders.grain - delegation.grain
    + (realm?.aidIn ?? 0) - (realm?.aidOut ?? 0) - (realm?.relief.grain ?? 0) + afterPolitics("grain") !== closing.grain) return false;
  const seen = new Set();
  let treasury = 0;
  let grain = 0;
  for (const program of programs) {
    if (!program || !Object.hasOwn(cities, program.city) || seen.has(program.city) || !focuses.includes(program.focus)
      || typeof program.result !== "string" || !Object.hasOwn(programResults, program.result) || !validResourcePair(program.spent)) return false;
    if (program.priority !== undefined && typeof program.priority !== "boolean") return false;
    if (program.focus === "auto" && program.result === "completed") {
      if (!developmentProjects.includes(program.project) || program.spent.grain !== 0) return false;
    } else if (program.project !== undefined) return false;
    if (program.adjustedForReserve !== undefined && (program.adjustedForReserve !== true || !program.project || !reserve?.treasury)) return false;
    const withheld = program.result.startsWith("reserve-");
    if (withheld && !reserve?.[program.result.slice("reserve-".length)]) return false;
    if ((withheld || ["budget", "national-budget", "treasury", "grain"].includes(program.result))
      && (!nonnegative(program.available) || !nonnegative(program.needed) || program.available >= program.needed)) return false;
    if (program.result !== "completed" && (program.spent.treasury || program.spent.grain)) return false;
    seen.add(program.city);
    treasury += program.spent.treasury;
    grain += program.spent.grain;
  }
  return delegation.treasury === treasury && delegation.grain === grain;
}
