import { accordCredit } from "./accords.js";
import { protectionBetween } from "./polities-data.js";
import { grandArmistice } from "./grand-diplomacy.js";

export const treatyTerms = {
  truce: { name: "停战", seasons: 2, treasury: 12 },
  alliance: { name: "同盟", seasons: 4, treasury: 24 },
};

export const allianceIncome = 4;

export function treatyWith(state, first, second) {
  if (first === second) return null;
  const treaty = state.treaties?.find(({ sides, expires }) => expires > state.turn && sides.includes(first) && sides.includes(second));
  const protection = protectionBetween(state, first, second);
  const charter = grandArmistice(state, first, second);
  return treaty ?? (protection || charter ? { kind: "truce", sides: [first, second].sort(),
    expires: Math.max(protection?.expires ?? 0, charter?.expires ?? 0), ...(protection ? { protection: true } : { charter: true }) } : null);
}

export function isHostile(state, first, second) {
  return first !== second && !treatyWith(state, first, second);
}

export function allianceTrade(state, faction) {
  return (state.treaties ?? []).filter(({ sides, kind, expires }) => kind === "alliance"
    && expires > state.turn && sides.includes(faction)).length * allianceIncome;
}

function neighboringFactions(world, state, faction) {
  return new Set(world.cities.flatMap(({ key, links }) => state.cities[key].owner === faction
    ? links.map((link) => state.cities[link].owner).filter((owner) => owner !== faction)
    : []));
}

function diplomaticFronts(world, state) {
  const strength = new Map();
  const territory = new Map();
  for (const { owner, troops } of Object.values(state.cities)) {
    strength.set(owner, (strength.get(owner) ?? 0) + troops);
    territory.set(owner, (territory.get(owner) ?? 0) + 1);
  }
  for (const army of state.armies ?? []) if (strength.has(army.faction)) strength.set(army.faction, strength.get(army.faction) + army.troops);
  return new Map([...strength].map(([faction, troops]) => {
    const neighbors = [...neighboringFactions(world, state, faction)].filter((rival) => isHostile(state, faction, rival));
    const threats = neighbors.filter((rival) => strength.get(rival) >= Math.max(600, troops * .65));
    const stronger = threats.filter((rival) => strength.get(rival) >= Math.max(900, troops * 1.35));
    return [faction, { troops, cities: territory.get(faction), neighbors, threats, stronger }];
  }));
}

function unbalanced(first, second) {
  return Math.max(first.troops, second.troops) > Math.max(1, Math.min(first.troops, second.troops)) * 2.1
    && Math.max(first.cities, second.cities) >= Math.min(first.cities, second.cities) + 4;
}

export function reviewAlliances(world, state) {
  const due = state.treaties.filter(({ kind, expires }) => kind === "alliance" && expires === state.turn + 1);
  if (!due.length) return [];
  const fronts = diplomaticFronts(world, state);
  return due.flatMap(({ sides }) => {
    const [first, second] = sides.map((key) => fronts.get(key));
    if (!first || !second || !unbalanced(first, second)) return [];
    const smaller = first.troops <= second.troops ? sides[0] : sides[1];
    return [{ sides, smaller }];
  });
}

export function opponentTreaty(world, state) {
  if (state.turn < 4 || state.turn % 2) return null;
  const fronts = diplomaticFronts(world, state);
  const opponents = [...fronts.keys()].filter((faction) => faction !== state.player);
  const offers = [];
  for (const from of opponents) {
    const front = fronts.get(from);
    const treasury = state.factions[from].treasury;
    for (const to of opponents) {
      if (from === to || treatyWith(state, from, to)) continue;
      const firstGoal = state.strategies[from];
      const secondGoal = state.strategies[to];
      if ((firstGoal?.type === "expand" && state.cities[firstGoal.target].owner === to)
        || (secondGoal?.type === "expand" && state.cities[secondGoal.target].owner === from)) continue;
      const other = fronts.get(to);
      if (treasury >= treatyTerms.alliance.treasury && !unbalanced(front, other)
        && front.stronger.some((rival) => other.stronger.includes(rival))) {
        offers.push({ from, to, kind: "alliance", reason: "联手应对共同强敌", score: 4 });
      } else if (treasury >= treatyTerms.truce.treasury && front.threats.length >= 2 && front.threats.includes(to)
        && front.troops >= other.troops * .45) {
        offers.push({ from, to, kind: "truce", reason: "两线受压，先稳住一处边境", score: 3 });
      }
    }
  }
  return offers.sort((a, b) => b.score - a.score)[0] ?? null;
}

function relations(world, state, first, second) {
  const neighbors = neighboringFactions(world, state, first);
  const others = neighboringFactions(world, state, second);
  const sharedRival = [...neighbors].some((key) => others.has(key)
    && isHostile(state, first, key) && isHostile(state, second, key));
  let firstTroops = 0;
  let secondTroops = 0;
  for (const { owner, troops } of Object.values(state.cities)) {
    if (owner === first) firstTroops += troops;
    if (owner === second) secondTroops += troops;
  }
  return { adjacent: neighbors.has(second), sharedRival, ratio: firstTroops / Math.max(1, secondTroops) };
}

function hasPlannedAttack(state, target) {
  return state.orders.some((order) => ["attack", "mobilize"].includes(order.type) && state.cities[order.to].owner === target);
}

export function quoteTreaty(world, state, target, kind, availableTreasury = state.factions[state.player].treasury) {
  const player = state.player;
  const term = Object.hasOwn(treatyTerms, kind) ? treatyTerms[kind] : null;
  const blocked = (reason) => ({ available: false, accepted: false, reason });
  const cities = Object.values(state.cities);
  if (!term || player === target || !cities.some(({ owner }) => owner === target)) return blocked("请选择仍有辖城的其他势力。");
  if (!cities.some(({ owner }) => owner === player) || cities.every(({ owner }) => owner === player)) return blocked("战局已结束。");
  if (state.incomingTreaty?.from === target) {
    if (state.incomingTreaty.answer === null) return blocked("请先答复该势力的来使。");
    if (state.incomingTreaty.answer) return blocked("本季已与该势力签约。");
  }
  if (state.treatyOffers?.some((offer) => offer.target === target)) return blocked("本季已向该势力提议。");
  const current = treatyWith(state, player, target);
  const credit = accordCredit(state, player, target);
  const renew = current?.kind === "alliance" && kind === "alliance" && current.expires - state.turn === 1 && credit >= 12;
  if (current && !renew && (current.kind === "alliance" || kind === "truce")) return blocked("现有约定仍有效。");
  if (hasPlannedAttack(state, target)) {
    return blocked("请先撤销进攻该势力的政令。");
  }
  if (availableTreasury < term.treasury) return blocked("可用国库不足，礼金需要 " + term.treasury + " 钱。");

  const { adjacent, sharedRival, ratio } = relations(world, state, player, target);
  const goal = state.strategies?.[target];
  const advancesAgainstPlayer = goal?.type === "expand" && state.cities[goal.target].owner === player;
  const response = (accepted, reason) => ({ available: true, accepted, reason });

  if (kind === "truce") {
    if (advancesAgainstPlayer && ratio < 1) return response(false, "对方正在筹备争夺己方城池，暂不愿停战。");
    if (sharedRival) return response(true, "双方有共同对手，对方愿暂停交战。");
    if (!adjacent) return response(false, "双方暂无接壤，对方认为暂不必签停战。");
    return ratio >= .65 ? response(true, "双方接壤，对方愿用停战稳住边境。")
      : response(false, "对方兵力占优，暂不愿停战。");
  }
  if (renew && credit >= 12) return response(true, "双方履约稳定，可在旧约到期前续盟。");
  if (state.realm && credit >= 12 && sharedRival && !advancesAgainstPlayer) {
    return response(true, "通商履约稳定，双方愿就共同威胁结盟。");
  }
  if (advancesAgainstPlayer) return response(false, "对方正在筹备争夺己方城池，暂不愿结盟。");
  if (state.turn >= 10 && (ratio > 2.1 || ratio < 1 / 2.1)) {
    const fronts = diplomaticFronts(world, state);
    if (unbalanced(fronts.get(player), fronts.get(target))) return response(false, "彼此疆域和兵力相差过大，对方倾向先签停战。");
  }
  if (sharedRival && ratio >= .5 && ratio <= 3) return response(true, "双方有共同对手，且兵力差距可接受。");
  if (current?.kind === "truce" && ratio >= .75 && ratio <= 1.5) return response(true, "双方已有停战且实力接近，可升级为同盟。");
  return sharedRival ? response(false, "有共同对手，但双方兵力差距过大。")
    : response(false, "目前缺少共同对手，对方暂不愿结盟。");
}

export function incomingTreatyBlock(state) {
  const offer = state.incomingTreaty;
  if (!offer || offer.turn !== state.turn || offer.answer !== null) return "没有待答复的提议。";
  if (hasPlannedAttack(state, offer.from)) return "请先撤销进攻该势力的政令。";
  const current = treatyWith(state, state.player, offer.from);
  if (current && (current.kind === "alliance" || offer.kind === "truce")) return "双方已有有效约定。";
  if (state.factions[offer.from].treasury < treatyTerms[offer.kind].treasury) return "对方已无力支付礼金。";
  return "";
}

export function selectIncomingTreaty(world, state) {
  const player = state.player;
  if (state.history.at(-1)?.entries.some((entry) => entry.type === "diplomacy" && entry.incomingFrom)) return null;
  const recentlyContacted = new Set(state.history.slice(-2).flatMap(({ entries }) =>
    entries.filter((entry) => entry.type === "diplomacy" && entry.incomingFrom).map((entry) => entry.incomingFrom)));
  const owners = new Set(Object.values(state.cities).map(({ owner }) => owner));
  const fronts = state.turn >= 4 ? diplomaticFronts(world, state) : null;
  const candidates = [];
  for (const from of owners) {
    if (from === player || recentlyContacted.has(from)) continue;
    const current = treatyWith(state, player, from);
    if (current?.kind === "alliance") continue;
    const goal = state.strategies[from];
    const frontOwner = goal?.target ? state.cities[goal.target].owner : null;
    if (goal?.type === "expand" && frontOwner === player) continue;
    const { adjacent, sharedRival, ratio } = relations(world, state, from, player);
    const treasury = state.factions[from].treasury;
    const front = fronts?.get(from);
    const playerFront = fronts?.get(player);
    const wary = front && playerFront && unbalanced(front, playerFront);
    if (!wary && treasury >= treatyTerms.alliance.treasury && front?.stronger.some((rival) => playerFront?.stronger.includes(rival))) {
      candidates.push({ from, kind: "alliance", score: 6, reason: "共同强敌兵力占优，对方希望结盟。" });
      continue;
    }
    if (!current && treasury >= treatyTerms.truce.treasury && front?.threats.length >= 2 && front.threats.includes(player)) {
      candidates.push({ from, kind: "truce", score: 5, reason: "对方两线受压，希望先与我方停战。" });
      continue;
    }
    if (!wary && sharedRival && ratio >= .38 && ratio <= 2.5 && treasury >= treatyTerms.alliance.treasury) {
      const defensive = goal?.type === "defend" && frontOwner !== player;
      candidates.push({ from, kind: "alliance", score: defensive ? 4 : 3, reason: defensive
        ? "对方正加固前线，愿结盟以应对共同对手。" : "双方有共同对手，对方希望结盟稳定战局。" });
    } else if (!current && adjacent && treasury >= treatyTerms.truce.treasury
      && (ratio <= .85 || (goal?.type === "economy" && ratio <= 1.2))) {
      candidates.push({ from, kind: "truce", score: ratio < .55 ? 3 : 2, reason: goal?.type === "economy"
        ? "对方正在积蓄粮草，希望暂停边境交战。" : "对方希望先稳住边境，主动提议停战。" });
    }
  }
  const selected = candidates.sort((a, b) => b.score - a.score)[0];
  if (!selected) return null;
  const { from, kind, reason } = selected;
  return { from, kind, reason, turn: state.turn, answer: null };
}

export function validDiplomacy(state, era) {
  if (!Array.isArray(state.treaties) || !Array.isArray(state.treatyOffers)) return false;
  const alive = new Set(Object.values(state.cities).map(({ owner }) => owner));
  const pairs = new Set();
  for (const treaty of state.treaties) {
    const term = treaty && Object.hasOwn(treatyTerms, treaty.kind) && treatyTerms[treaty.kind];
    if (!term || !Array.isArray(treaty.sides) || treaty.sides.length !== 2) return false;
    const [first, second] = treaty.sides;
    const pair = treaty.sides.join("/");
    if (!alive.has(first) || !alive.has(second) || first >= second || pairs.has(pair)
      || !Number.isSafeInteger(treaty.expires) || treaty.expires <= state.turn || treaty.expires > state.turn + term.seasons) return false;
    pairs.add(pair);
  }
  const offered = new Set();
  for (const offer of state.treatyOffers) {
    if (!offer || !Object.hasOwn(treatyTerms, offer.kind) || offer.target === state.player
      || !alive.has(offer.target) || !era.factions.some(({ key }) => key === offer.target)
      || offered.has(offer.target) || typeof offer.accepted !== "boolean"
      || typeof offer.reason !== "string" || offer.reason.length > 100) return false;
    offered.add(offer.target);
  }
  const incoming = state.incomingTreaty;
  if (incoming !== null) {
    if (!incoming || !alive.has(incoming.from) || incoming.from === state.player
      || !Object.hasOwn(treatyTerms, incoming.kind) || incoming.turn !== state.turn
      || typeof incoming.reason !== "string" || incoming.reason.length > 100
      || (incoming.answer !== null && typeof incoming.answer !== "boolean")) return false;
    if (incoming.answer === true && treatyWith(state, state.player, incoming.from)?.kind !== incoming.kind) return false;
  }
  return true;
}

