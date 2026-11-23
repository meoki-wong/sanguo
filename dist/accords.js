import { isHostile, treatyWith } from "./diplomacy.js";
import { cityName, factionName, gameOutcome, openingCapital } from "./engine.js";
import { markRealmService, officeSkill, realmReserve } from "./realm.js";
import { roadPath } from "./roads.js";
import { warBlockaded, warReport } from "./war-operations.js";
import { militaryView } from "./war-intel.js";
import { hasPassage, openRoadEdge } from "./grand-logistics.js";

export const accordKinds = { trade: "通商", aid: "粮援", joint: "合兵" };
export const allyDuties = { assault: "合击", diversion: "牵制", relief: "解围策应" };
const descriptions = { signed: "已签署", rejected: "未获批准", block: "履约受阻", open: "恢复通商",
  delivered: "粮援已交付", expired: "协议到期", committed: "军队已经到位", fulfilled: "已经履约", defaulted: "未能履约" };
const durations = { trade: 8, aid: 2, joint: 5 };
const states = new Set(Object.keys(descriptions));
const live = (state, faction) => Object.values(state.cities).some(({ owner }) => owner === faction);
const own = (state, key, faction) => state.cities[key]?.owner === faction;
const between = ({ from, to }, a, b) => (a === from && b === to) || (b === from && a === to);
const safeInteger = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const creditKey = (a, b) => [a, b].sort().join(":");
const signature = ({ from, to, kind }) => kind + ":" + creditKey(from, to);
const inForce = (state, accord) => accord.expires > state.turn && live(state, accord.from) && live(state, accord.to);

export function accordCredit(state, a, b) {
  return state.realm?.relations[creditKey(a, b)] ?? 0;
}

export function adjustCredit(state, a, b, delta) {
  state.realm.relations[creditKey(a, b)] = Math.min(100, Math.max(-50, accordCredit(state, a, b) + delta));
}

export function activeAccords(state, faction) {
  return (state.realm?.accords ?? []).filter((accord) => inForce(state, accord) && (!faction || [accord.from, accord.to].includes(faction)));
}

function allowedTransit(state, kind, a, b) {
  return activeAccords(state).some((accord) => accord.kind === kind && between(accord, a, b));
}

function usableForTrade(state, from, to, key) {
  const city = state.cities[key];
  return !city.occupation && !warBlockaded(state, key) && ([from, to].includes(city.owner)
    || [from, to].every((side) => allowedTransit(state, "trade", city.owner, side) || hasPassage(state, side, key)));
}

export function commercialRoad(world, state, from, to, sites) {
  const graph = new Map(world.cities.map((city) => [city.key, city]));
  const markets = activeAccords(state).filter(({ kind }) => kind === "trade");
  const usable = (key) => {
    const { owner, occupation } = state.cities[key];
    return !occupation && !warBlockaded(state, key) && (owner === from || owner === to
      || [from, to].every((side) => markets.some((market) => between(market, owner, side)) || hasPassage(state, side, key)));
  };
  const edge = (a, b) => openRoadEdge(state, from, a, b);
  if (sites) {
    if (!own(state, sites[0], from) || !own(state, sites[1], to) || !sites.every(usable)) return null;
    return roadPath(graph, sites[0], sites[1], usable, 5, edge);
  }
  const starts = world.cities.filter(({ key }) => own(state, key, from) && usable(key));
  const ends = world.cities.filter(({ key }) => own(state, key, to) && usable(key));
  let best = null;
  for (const { key: origin } of starts) {
    for (const { key: destination } of ends) {
      const route = roadPath(graph, origin, destination, usable, Math.min(5, (best?.length ?? 7) - 2), edge);
      if (route) best = route;
      if (best?.length === 2) return best;
    }
  }
  return best;
}

export function commercialStatus(world, state, accord) {
  const { from, to, sites } = accord;
  const route = commercialRoad(world, state, from, to, sites);
  const blocked = !route && (!own(state, sites[0], from) ? sites[0] : !own(state, sites[1], to) ? sites[1]
    : accord.route?.find((key) => !usableForTrade(state, from, to, key)));
  return { route, blocked, display: route ?? accord.route ?? sites, income: tradeIncome(state, accord, route) };
}

export function accordProposal(world, state, from, to, kind, target, grain = 18, coordination) {
  if (kind === "trade" || kind === "aid") {
    const path = commercialRoad(world, state, from, to);
    return { from, to, kind, sites: path ? [path[0], path.at(-1)] : null, ...(kind === "aid" ? { grain } : {}) };
  }
  return { from, to, kind, target, enemy: state.cities[target]?.owner, ...(coordination ? { coordination } : {}) };
}

function validCoordination(value) {
  return value && Object.hasOwn(allyDuties, value.duty) && safeInteger(value.offset, 0, 2);
}

export function allyWindow(accord) {
  return { first: accord.signed + 1 + (accord.coordination?.offset ?? 0), last: accord.expires };
}

export function alliedPlan(state, faction, target) {
  return activeAccords(state, faction).find((accord) => accord.kind === "joint" && accord.target === target);
}

export function alliedDuty(state, faction, target) {
  const plan = alliedPlan(state, faction, target);
  return plan?.to === faction ? plan.coordination?.duty : undefined;
}

function canApproach(world, state, faction, target) {
  const graph = new Map(world.cities.map((city) => [city.key, city]));
  return world.cities.some(({ key }) => own(state, key, faction) && roadPath(graph, key, target, (site) =>
    site === target || own(state, site, faction), 4));
}

export function jointTargets(world, state, a, b) {
  return world.cities.filter(({ key, links }) => {
    const { owner } = state.cities[key];
    return ![a, b].includes(owner) && isHostile(state, a, owner) && isHostile(state, b, owner)
      && links.some((link) => own(state, link, a)) && links.some((link) => own(state, link, b));
  });
}

export function quoteAccord(world, era, state, proposal, { queued = false } = {}) {
  const { from, to, kind, sites, target, enemy, grain, coordination } = proposal;
  const reject = (reason) => ({ accepted: false, reason });
  if (!state.realm || !Object.hasOwn(accordKinds, kind) || from === to || !live(state, from) || !live(state, to)) return reject("请选两个仍有辖城的势力。");
  const current = activeAccords(state).find((accord) => signature(accord) === signature(proposal));
  if (current && (kind !== "trade" || current.expires - state.turn > 2)) return reject("已有同类约定，有效期将满后才可续约。");
  if (!queued && state.realm.proposals.some((item) => item.from === from && signature(item) === signature(proposal))) return reject("同类提案正在等待回复。");
  if (kind !== "joint" && (!Array.isArray(sites) || sites.length !== 2 || !commercialRoad(world, state, from, to, sites))) {
    return reject("双方之间没有畅通商路。");
  }
  const treaty = treatyWith(state, from, to);
  const goodwill = accordCredit(state, from, to) + (state.player === from ? Math.floor(officeSkill(era, state, "envoy") / 10) : 0);
  if (goodwill < -20) return reject("履约信用过低，对方暂缓新约。");
  if (kind === "trade") {
    if (!treaty && isHostile(state, from, to)) {
      const threat = Object.values(state.cities).filter(({ owner }) => owner === from).length;
      const size = Object.values(state.cities).filter(({ owner }) => owner === to).length;
      const shared = jointTargets(world, state, from, to).length > 0;
      if (!shared && threat > size * 4 && goodwill < 15) return reject("对方担心边境安全，愿先谈停战。");
    }
    return { accepted: true, reason: "道路通畅，可按季通商。" };
  }
  if (kind === "aid") {
    if (!treaty && !allowedTransit(state, "trade", from, to)) return reject("粮援需要通商或停战、同盟的保障。");
    if (!safeInteger(grain, 6, 36) || state.factions[from].grain - realmReserve(state, from).grain < grain) return reject("粮援为 6 至 36 粮，须留足本国储粮。");
    return { accepted: true, reason: "同意交割，次季沿商路转运粮食。" };
  }
  if (!treaty || treaty.kind !== "alliance") return reject("合兵须先签署同盟。");
  if (coordination !== undefined && (!state.war || !validCoordination(coordination))) return reject("请选择盟军任务和有效的到位季度。");
  if (!state.cities[target] || state.cities[target].owner !== enemy || [from, to].includes(enemy)
    || !isHostile(state, from, enemy) || !isHostile(state, to, enemy)
    || !canApproach(world, state, from, target) || !canApproach(world, state, to, target)) return reject("请选择双方都能进军的共同敌城。");
  if (state.factions[from].grain < 24 || state.factions[to].grain < 24) return reject("一方目前军粮不足。");
  return { accepted: true, reason: coordination ? "盟军将于签约后第 " + (coordination.offset + 1) + " 季起"
    + allyDuties[coordination.duty] + "，五季内到位，并须维持同盟。"
    : "请在五季内、且同盟有效时向目标城出兵。" };
}

export function proposeAccord(world, era, state, item) {
  if (gameOutcome(state) !== "ongoing" || item.from !== state.player) throw new Error("当前无法发送提案。");
  const quote = quoteAccord(world, era, state, item);
  if (!quote.accepted) throw new Error(quote.reason);
  if (state.realm.proposals.filter(({ from }) => from === state.player).length >= 3) throw new Error("本季最多发出三个提案。");
  return { ...state, realm: { ...state.realm, proposals: [...state.realm.proposals, { ...structuredClone(item), submitted: state.turn }] } };
}

export function respondAccord(state, from, kind, accepted) {
  const item = state.realm?.proposals.find((proposal) => proposal.to === state.player && proposal.from === from && proposal.kind === kind);
  if (!item || gameOutcome(state) !== "ongoing") throw new Error("这份提案已经结束。");
  return { ...state, realm: { ...state.realm, proposals: state.realm.proposals.map((proposal) =>
    proposal === item ? { ...proposal, answer: Boolean(accepted) } : proposal) } };
}

export function cancelAccordProposal(state, to, kind) {
  const item = state.realm?.proposals.find((proposal) => proposal.from === state.player && proposal.to === to && proposal.kind === kind);
  if (!item || gameOutcome(state) !== "ongoing") throw new Error("这份提案已经结束。");
  return { ...state, realm: { ...state.realm, proposals: state.realm.proposals.filter((proposal) => proposal !== item) } };
}

export function revokeTrade(state, partner) {
  const item = activeAccords(state, state.player).find((accord) => accord.kind === "trade" && between(accord, state.player, partner));
  if (!item || gameOutcome(state) !== "ongoing") throw new Error("这条商路已经停运。");
  const next = structuredClone(state);
  next.realm.accords = next.realm.accords.filter((accord) => signature(accord) !== signature(item));
  adjustCredit(next, item.from, item.to, -12);
  next.realm.reports = [...next.realm.reports, { from: state.player, to: partner, kind: "trade", turn: state.turn,
    status: "block", text: "本方终止通商许可。" }].slice(-64);
  next.realm.coalition = { streak: 0, partners: [] };
  return next;
}

function log(state, entries, accord, status, detail) {
  const { from, to, kind } = accord;
  const text = accordKinds[kind] + descriptions[status] + "。" + (detail ?? "");
  const turn = state.turn + 1;
  if ([from, to].includes(state.player)) {
    state.realm.reports = [...state.realm.reports, { from, to, kind, turn, status, text }].slice(-64);
  }
  entries.push({ type: "diplomacy", faction: from, participants: [from, to], text });
}

export function tradeIncome(state, accord, route) {
  if (!route) return 0;
  return 6 + Math.min(6, route.length + Math.floor(accordCredit(state, accord.from, accord.to) / 20));
}

function committed(state, accord, faction, entries) {
  const duty = faction === accord.to ? accord.coordination?.duty : undefined;
  const attack = entries.some((entry) => entry.faction === faction && entry.battle?.attacker.faction === faction && entry.city === accord.target
    && entry.battle.defender.faction === accord.enemy);
  const blockade = entries.some(({ type, event, faction: side, city }) => type === "war" && side === faction
    && city === accord.target && ["blockaded", "diverted"].includes(event));
  if (duty === "diversion") return blockade;
  return attack || (state.armies ?? []).some((army) => army.faction === faction && army.target === accord.target
    && ["muster", "march", "secured"].includes(army.phase) && (duty !== "relief" || army.stance === "assault"));
}

export function pactTarget(state, faction) {
  return activeAccords(state, faction).find((accord) => {
    const { kind, joined, enemy, target } = accord;
    return kind === "joint" && !joined.includes(faction) && (!accord.coordination || state.turn + 1 >= allyWindow(accord).first)
      && state.cities[target].owner === enemy && isHostile(state, faction, enemy);
  })?.target;
}

export function accordCandidates(world, era, state, faction) {
  if (!state.realm || !live(state, faction)) return [];
  state = militaryView(state, faction);
  const available = [];
  const stocks = state.factions[faction];
  const size = Object.values(state.cities).filter(({ owner }) => owner === faction).length;
  for (const { key } of era.factions) {
    if (key === faction || !live(state, key)) continue;
    if (state.realm.proposals.some((item) => item.from === key && item.to === faction)) continue;
    const rivalCities = Object.values(state.cities).filter(({ owner }) => owner === key).length;
    if (rivalCities <= size * 3 || treatyWith(state, faction, key)) {
      available.push(accordProposal(world, state, faction, key, "trade"));
    }
    if (state.factions[key].grain < 48 && stocks.grain > 80) {
      available.push(accordProposal(world, state, faction, key, "aid", null, 18));
    }
    const target = treatyWith(state, faction, key)?.kind === "alliance" && jointTargets(world, state, faction, key)[0]?.key;
    if (target) available.push(accordProposal(world, state, faction, key, "joint", target, undefined,
      state.war ? { duty: "assault", offset: 0 } : undefined));
  }
  return available.filter((item) => quoteAccord(world, era, state, item).accepted)
    .sort((a, b) => ["joint", "aid", "trade"].indexOf(a.kind) - ["joint", "aid", "trade"].indexOf(b.kind)
      || accordCredit(state, b.from, b.to) - accordCredit(state, a.from, a.to)).slice(0, 4);
}

export function settleAccords(world, era, before, state, entries, plans = {}, forecast = false) {
  if (!state.realm) return null;
  const ledger = { commerce: 0, aidIn: 0, aidOut: 0 };
  const remaining = [];
  const turn = state.turn + 1;
  for (const accord of state.realm.accords) {
    const { from, to, kind } = accord;
    const open = inForce(state, accord);
    const phase = (status, detail) => log(state, entries, accord, status, detail);
    if (kind === "trade" && open) {
      const { route, income, blocked } = commercialStatus(world, state, accord);
      for (const partner of [from, to]) state.factions[partner].treasury += income;
      if ([from, to].includes(state.player)) ledger.commerce += income;
      const good = Boolean(route);
      if (good !== accord.open) phase(good ? "open" : "block", good ? "" : (blocked ? cityName(world, blocked) + "段无法通行。" : "授权道路或商埠失守。"));
      accord.open = good;
      if (route) accord.route = route;
      if (good) adjustCredit(state, from, to, 2);
    }
    if (kind === "aid" && open) {
      const stock = state.factions[from];
      if (commercialRoad(world, state, from, to, accord.sites) && stock.grain - realmReserve(state, from).grain >= accord.grain) {
        stock.grain -= accord.grain;
        state.factions[to].grain += accord.grain;
        if (from === state.player) ledger.aidOut += accord.grain;
        if (to === state.player) ledger.aidIn += accord.grain;
        adjustCredit(state, from, to, 10);
        phase("delivered", factionName(era, to) + "收到 " + accord.grain + " 粮。");
        if (!forecast && from === state.player) markRealmService(state, "envoy", "按约交割军粮");
        continue;
      }
      if (turn === accord.expires) {
        phase("defaulted", "期限内道路或储粮条件未满足。");
        adjustCredit(state, from, to, -10);
        if (!forecast && from === state.player) markRealmService(state, "envoy", "粮援逾期", false);
        continue;
      }
      phase("block", "请检查道路和拨粮预留。");
    }
    if (kind === "joint") {
      const mutual = treatyWith(before, from, to)?.kind === "alliance";
      const activeWindow = !accord.coordination || turn >= allyWindow(accord).first;
      for (const faction of [from, to]) {
        if (!accord.joined.includes(faction) && mutual && activeWindow && committed(state, accord, faction, entries)) {
          accord.joined.push(faction);
          phase("committed", factionName(era, faction) + "已向" + cityName(world, accord.target) + "出兵。");
          if (state.war) entries.push(warReport("allied", faction, accord.target, factionName(era, faction) + "按约出兵并已到位。",
            { participants: [from, to] }));
        }
      }
      if (accord.joined.length === 2) {
        phase("fulfilled", "双方均已出兵。");
        adjustCredit(state, from, to, 18);
        if (!forecast && [from, to].includes(state.player)) markRealmService(state, "envoy", "协调两军按约出兵");
        continue;
      }
      if (!open || !mutual || turn === accord.expires || state.cities[accord.target].owner !== accord.enemy) {
        const missing = [from, to].filter((faction) => !accord.joined.includes(faction));
        phase("defaulted", (!mutual ? "同盟已到期。" : "") + missing.map((key) => factionName(era, key)).join("、") + "未出兵。");
        if (state.war) entries.push(warReport("strained", from, accord.target, !mutual ? "同盟到期，合兵窗口结束。"
          : state.cities[accord.target].owner !== accord.enemy ? "目标先行易主，后续承诺未兑现。"
          : missing.map((key) => factionName(era, key)).join("、") + "未能在约定季度到位。", { participants: [from, to] }));
        adjustCredit(state, from, to, -16);
        if (!forecast && missing.includes(state.player)) markRealmService(state, "envoy", "合兵约定未履行", false);
        continue;
      }
    }
    if (!open || turn >= accord.expires) phase("expired");
    else remaining.push(accord);
  }
  state.realm.accords = remaining;
  const nextProposals = [];
  const pending = state.realm.proposals;
  for (const proposal of pending) {
    if (proposal.to === state.player && proposal.answer === undefined) {
      if (turn - proposal.submitted < 2 && live(state, proposal.from) && live(state, proposal.to)) nextProposals.push(proposal);
      else log(state, entries, proposal, "expired", "使节已离开。");
      continue;
    }
    const quote = quoteAccord(world, era, state, proposal, { queued: true });
    if (!quote.accepted || proposal.answer === false) {
      log(state, entries, proposal, "rejected", proposal.answer === false ? "来使提案已回绝。" : quote.reason);
      continue;
    }
    state.realm.accords = state.realm.accords.filter((accord) => signature(accord) !== signature(proposal));
    const { submitted, answer, ...terms } = proposal;
    state.realm.accords.push({ ...terms, signed: turn, expires: turn + durations[proposal.kind],
      ...(proposal.kind === "trade" ? { open: true, route: commercialRoad(world, state, proposal.from, proposal.to, proposal.sites) }
        : proposal.kind === "joint" ? { joined: [] } : {}) });
    log(state, entries, proposal, "signed", quote.reason);
  }
  const eligible = new Set(pending.map(signature));
  if (!forecast) for (const { key } of era.factions) {
    if (key === state.player || !live(state, key)) continue;
    const candidates = accordCandidates(world, era, before, key);
    const chosen = plans[key]?.accord;
    const choice = plans[key]?.source === "model" && chosen !== undefined
      ? chosen && candidates.find((item) => signature(item) === signature(chosen) && item.target === chosen.target && item.grain === chosen.grain)
      : candidates[0];
    if (!choice || eligible.has(signature(choice)) || !quoteAccord(world, era, state, choice).accepted) continue;
    eligible.add(signature(choice));
    nextProposals.push({ ...choice, submitted: turn });
    if (choice.to === state.player) entries.push({ type: "diplomacy", faction: key, participants: [key, state.player],
      text: factionName(era, key) + "送来" + accordKinds[choice.kind] + "提案。" });
  }
  state.realm.proposals = nextProposals;
  return ledger;
}

function originalCore(era, state, faction) {
  const sites = Object.keys(era.ownership).filter((key) => era.ownership[key] === faction);
  const capital = openingCapital(era, faction);
  return (!capital || own(state, capital, faction))
    && sites.filter((key) => own(state, key, faction) && !state.cities[key].occupation).length >= Math.max(1, Math.ceil(sites.length * .55));
}

export function coalitionPartners(world, era, state) {
  return activeAccords(state, state.player).filter(({ from, to, kind, sites }) => {
    const ally = from === state.player ? to : from;
    const treaty = treatyWith(state, state.player, ally);
    return kind === "trade" && treaty?.kind === "alliance" && accordCredit(state, state.player, ally) >= 12
      && originalCore(era, state, ally) && commercialRoad(world, state, from, to, sites);
  }).map(({ from, to }) => from === state.player ? to : from).sort();
}

export function updateCoalition(world, era, state) {
  if (!state.realm) return;
  const previous = state.realm.coalition;
  const partners = coalitionPartners(world, era, state);
  if (partners.length < 2 || !originalCore(era, state, state.player)) {
    state.realm.coalition = { streak: 0, partners: [] };
    return;
  }
  const continuing = partners.filter((key) => previous.partners.includes(key));
  state.realm.coalition = continuing.length >= 2 ? { streak: previous.streak + 1, partners: continuing } : { streak: 1, partners };
}

export function coalitionCriteria(world, era, state) {
  const current = state.realm?.coalition;
  const partners = coalitionPartners(world, era, state).filter((key) => current?.partners.includes(key));
  const checks = [
    { label: "已结算季度", value: state.turn, target: 16 },
    { label: "稳定盟友", value: partners.length, target: 2 },
    { label: "持续履约季度", value: current?.streak ?? 0, target: 4 },
    { label: "保有本国核心", value: Number(originalCore(era, state, state.player)), target: 1 },
  ];
  return { title: "诸侯共守", checks, partners, ready: !state.orders.length && checks.every(({ value, target }) => value >= target) };
}

export function validAccords(world, state) {
  const realm = state.realm;
  if (!realm) return true;
  const { accords, proposals, relations, reports, coalition } = realm;
  const factions = Object.keys(state.factions);
  const roads = new Map(world.cities.map(({ key, links }) => [key, links]));
  const pairs = new Set(factions.flatMap((a) => factions.filter((b) => b !== a).map((b) => creditKey(a, b))));
  const sides = (value) => value && Object.hasOwn(accordKinds, value.kind) && value.from !== value.to && pairs.has(creditKey(value.from, value.to));
  const terms = (value) => sides(value) && (value.kind === "joint"
    ? Object.hasOwn(state.cities, value.target) && factions.includes(value.enemy) && ![value.from, value.to].includes(value.enemy)
      && (value.coordination === undefined || (state.war && validCoordination(value.coordination)))
    : Array.isArray(value.sites) && value.sites.length === 2 && value.sites[0] !== value.sites[1]
      && value.sites.every((key) => Object.hasOwn(state.cities, key)) && (value.kind !== "aid" || safeInteger(value.grain, 6, 36)));
  if (!Array.isArray(accords) || accords.length > pairs.size * 3 || !accords.every((value) =>
    terms(value) && safeInteger(value.signed, 1, state.turn) && value.expires === value.signed + durations[value.kind]
    && value.expires > state.turn && (value.kind !== "trade" || (typeof value.open === "boolean" && Array.isArray(value.route)
      && value.route.length >= 2 && value.route.length <= 6 && value.route[0] === value.sites[0] && value.route.at(-1) === value.sites[1]
      && value.route.slice(1).every((key, index) => roads.get(value.route[index])?.includes(key)))) && (value.kind !== "joint"
      || (Array.isArray(value.joined) && value.joined.length <= 1 && value.joined.every((side) => [value.from, value.to].includes(side)))))
    || new Set(accords.map(signature)).size !== accords.length) return false;
  if (!Array.isArray(proposals) || proposals.length > 2 * factions.length + 3 || !proposals.every((value) =>
    terms(value) && safeInteger(value.submitted, Math.max(0, state.turn - 1), state.turn)
    && (value.answer === undefined || (value.to === state.player && typeof value.answer === "boolean")))) return false;
  if (!relations || typeof relations !== "object" || Array.isArray(relations)
    || !Object.entries(relations).every(([key, value]) => pairs.has(key) && safeInteger(value, -50, 100))) return false;
  if (!Array.isArray(reports) || reports.length > 64 || !reports.every((value) => sides(value) && states.has(value.status)
    && safeInteger(value.turn, 0, state.turn) && typeof value.text === "string" && value.text.length <= 140)) return false;
  return coalition && safeInteger(coalition.streak, 0, state.turn) && Array.isArray(coalition.partners)
    && new Set(coalition.partners).size === coalition.partners.length && coalition.partners.every((key) => key !== state.player && factions.includes(key));
}
