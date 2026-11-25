import { armyByOfficer, redirectArmy, supplyRoute } from "./armies.js";
import { isHostile } from "./diplomacy.js";
import { cityName, eraByYear, factionName, firstCity, gameOutcome } from "./engine.js";
import { formationOf } from "./frontline.js";
import { hasPassage, openRoadEdge } from "./grand-logistics.js";
import { roadPath } from "./roads.js";
import { warBlockaded } from "./war-operations.js";
import { bounded, livingSide, plain } from "./polities-data.js";
import { reignPolicy, recordReign } from "./reign.js";

export const leagueLabels = { proposed: "待议", active: "履约中", broken: "失约解体", ended: "期满" };
const alive = (state, side) => Object.hasOwn(state.factions, side) && livingSide(state, side);
const effective = (state, row) => row.status === "active" && row.until > state.turn;
const members = (row) => Object.keys(row.members);
const member = (row, side) => Object.hasOwn(row.members, side) && !row.members[side].suspended;
const sovereign = (state, side, city) => state.cities[city]?.owner === side;

export function leagueAccord(state, first, second) {
  return first !== second && state.reign?.leagues.find((row) => effective(state, row) && member(row, first) && member(row, second));
}

export function leagueMarket(state, first, second) {
  return Boolean(leagueAccord(state, first, second)?.passage);
}

export function marketEmbargo(state, first, second) {
  return Boolean(state.reign?.sanctions.some(({ from, to, until }) => until > state.turn
    && (first === from && second === to || first === to && second === from)));
}

function connected(world, state, first, second) {
  return world.cities.some(({ key, links }) => sovereign(state, first, key) && links.some((link) => sovereign(state, second, link)));
}

export function leagueCandidates(world, state, target, side = state.player) {
  return Object.keys(state.factions).filter((key) => key !== target && key !== side && alive(state, key)
    && (connected(world, state, side, key) || connected(world, state, target, key)));
}

function goodTerms(draft) {
  return plain(draft) && Array.isArray(draft.invited) && draft.invited.length >= 1 && draft.invited.length <= 3
    && new Set(draft.invited).size === draft.invited.length && typeof draft.passage === "boolean"
    && typeof draft.military === "boolean" && bounded(draft.dues, 0, 24) && bounded(draft.term, 4, 12);
}

function register(world, state, host, draft) {
  if (!goodTerms(draft) || !alive(state, draft.target) || draft.target === host
    || !draft.invited.every((key) => leagueCandidates(world, state, draft.target, host).includes(key))) return null;
  if (state.reign.leagues.some((row) => row.target === draft.target && ["proposed", "active"].includes(row.status)
    && (row.host === host || member(row, host)))) return null;
  const list = state.reign.leagues;
  if (list.length >= 16) {
    const index = list.findIndex(({ status }) => ["broken", "ended"].includes(status));
    if (index < 0) return null;
    list.splice(index, 1);
  }
  const newMember = () => ({ paid: 0, defaults: 0, suspended: false });
  const row = { id: state.reign.serial++, host, target: draft.target, invited: draft.invited.slice(),
    passage: draft.passage, military: draft.military, dues: draft.dues, term: draft.term,
    founded: state.turn, until: state.turn + draft.term, status: "proposed", votes: {}, members: { [host]: newMember() }, corps: {} };
  list.push(row);
  return row;
}

export function charterLeague10(world, state, draft) {
  if (!state.reign?.blueprint || gameOutcome(state) !== "ongoing") throw new Error("请先发布国策，再召集诸侯。");
  const next = structuredClone(state);
  if (!register(world, next, state.player, draft)) throw new Error("请选择相邻势力、共同目标和可履行的条款。");
  return next;
}

export function voteLeague10(state, id, accepted) {
  const next = structuredClone(state);
  const row = next.reign?.leagues.find((order) => order.id === id && order.status === "proposed" && order.invited.includes(state.player));
  if (!row || typeof accepted !== "boolean" || gameOutcome(state) !== "ongoing") throw new Error("请选择仍在磋商的集团。");
  row.votes[state.player] = accepted;
  return next;
}

export function embargo10(world, state, target) {
  if (!state.reign?.blueprint || !alive(state, target) || target === state.player || gameOutcome(state) !== "ongoing") throw new Error("请选择可以交涉的势力。");
  const next = structuredClone(state);
  const exists = next.reign.sanctions.findIndex(({ from, to }) => from === next.player && to === target);
  if (exists >= 0) next.reign.sanctions.splice(exists, 1);
  else {
    next.reign.sanctions = next.reign.sanctions.filter(({ until }) => until > next.turn).slice(-23);
    next.reign.sanctions.push({ from: next.player, to: target, until: next.turn + 4 });
  }
  recordReign(next, null, "sanction", firstCity(world, state), exists >= 0 ? "撤回本方商贸限制。" : "暂停与对方的民间互市四季。");
  return next;
}

export function recognize10(world, state, side, answer) {
  if (!state.reign?.blueprint || !alive(state, side) || side === state.player
    || !state.polity.parties.some(({ key }) => key === side) || !["recognition", "protection"].includes(answer)
    || gameOutcome(state) !== "ongoing") throw new Error("请选择可以承认的地方政权。");
  const next = structuredClone(state);
  const price = answer === "protection" ? 12 : 0;
  if (next.factions[next.player].grain < reignPolicy(next).reserve + price) throw new Error("储粮不足以承诺保护援助。");
  next.factions[next.player].grain -= price;
  next.factions[side].grain += price;
  next.reign.recognitions[side] = { answer, at: state.turn, until: state.turn + (price ? 10 : 4) };
  recordReign(next, null, "recognition", firstCity(world, state, side), "承认地方政权" + (price ? "，交付首批保护粮援 12。" : "，开放短期交涉。"));
  return next;
}

export function reignRecognition(state, first, second) {
  const side = first === state.player ? second : second === state.player ? first : null;
  const record = side && state.reign?.recognitions[side];
  return record?.until > state.turn ? record : null;
}

export function reignGuarantee(state, first, second) {
  const peer = first === state.player ? second : second === state.player ? first : null;
  const deal = peer && state.reign?.guarantees[peer];
  return deal?.until > state.turn ? deal : null;
}

export function stewardshipTerms(world, state) {
  const side = state.player;
  if (!state.reign?.stewardship || gameOutcome(state) !== "ongoing") return [];
  const occupied = world.cities.filter(({ key }) => sovereign(state, side, key));
  const peers = [...new Set(occupied.flatMap(({ links }) => links.map((key) => state.cities[key].owner)))];
  return peers.filter((key) => key !== side && alive(state, key) && !reignGuarantee(state, side, key))
    .map((key) => ({ key, cost: Math.min(70, 24 + Math.max(0, Object.values(state.cities).filter(({ owner }) => owner === key).length - occupied.length) * 2) }));
}

export function assureHandover10(world, state) {
  const proposals = stewardshipTerms(world, state);
  const cost = proposals.reduce((sum, item) => sum + item.cost, 0);
  if (!proposals.length || state.factions[state.player].treasury < cost + reignPolicy(state).reserve) {
    throw new Error("现有交班停战仍在有效期内，或国库无法承担本轮续约。");
  }
  const next = structuredClone(state);
  for (const { key, cost } of proposals) {
    next.factions[next.player].treasury -= cost;
    next.factions[key].treasury += cost;
    next.reign.guarantees[key] = { since: next.turn, until: next.turn + 10, cost };
  }
  recordReign(next, null, "transition-talks", firstCity(world, state), "交付 " + cost + " 钱，与 " + proposals.length + " 个相邻势力续定十季交班停战。");
  return next;
}

function strongNeighbor(world, state, side) {
  const count = (faction) => Object.values(state.cities).filter(({ owner }) => owner === faction).length;
  const minimum = Math.max(5, count(side) + 3);
  return Object.keys(state.factions).filter((key) => key !== side && count(key) >= minimum && isHostile(state, side, key)
    && connected(world, state, side, key))
    .sort((a, b) => count(b) - count(a))[0];
}

export function reignModelChoices(world, state, side) {
  if (!state.reign?.blueprint || side === state.player || !alive(state, side)) return [];
  const options = state.reign.leagues.filter((row) => row.status === "proposed" && row.invited.includes(side) && !Object.hasOwn(row.votes, side))
    .flatMap((row) => [{ id: "R" + row.id + "-yes", league: row.id, vote: true, text: "接受共同守备，季付 " + row.dues + " 粮。" },
      { id: "R" + row.id + "-no", league: row.id, vote: false, text: "拒绝该集团的义务。" }]);
  if (state.turn < state.reign.since + 5 || state.turn % 4 !== 1) return options;
  const target = strongNeighbor(world, state, side);
  if (!target || state.reign.leagues.some((row) => ["active", "proposed"].includes(row.status) && row.target === target
    && (row.invited.includes(side) || member(row, side)))) return options;
  const prospects = leagueCandidates(world, state, target, side).filter((key) => isHostile(state, key, target) && connected(world, state, key, target));
  if (prospects.length) {
    const names = prospects.slice(0, 2);
    options.push({ id: "R-found-" + target, target, invited: names,
      text: "召集相邻诸侯共同牵制" + factionName(eraByYear(world, state), target) + "。" });
    if (!marketEmbargo(state, side, target)) options.push({ id: "R-sanction-" + target, sanction: target,
      text: "限制与" + factionName(eraByYear(world, state), target) + "互市四季。" });
  }
  return options;
}

function willingness(world, state, row, side) {
  const treasury = state.factions[side];
  return alive(state, row.host) && alive(state, row.target) && treasury.grain >= reignPolicy(state, side).reserve + row.dues * 2
    && (isHostile(state, side, row.target) || connected(world, state, side, row.host) && !isHostile(state, row.host, side));
}

function diplomaticAI(world, state, proposals, entries) {
  const sides = Object.keys(state.factions).filter((side) => side !== state.player && alive(state, side));
  for (const side of sides) {
    const options = reignModelChoices(world, state, side);
    if (!options.length) continue;
    const chosen = options.find(({ id }) => id === proposals[side]?.reignChoice);
    const planned = chosen ?? options.find((row) => row.target && (state.turn + side.length) % 2 === 0);
    if (planned?.sanction) {
      state.reign.sanctions = [...state.reign.sanctions, { from: side, to: planned.sanction, until: state.turn + 4 }].slice(-24);
      if (planned.sanction === state.player) recordReign(state, entries, "sanction", firstCity(world, state), factionName(eraByYear(world, state), side) + "宣布暂停与本方互市。", { critical: true });
    }
    if (planned?.target && state.reign.leagues.filter(({ status }) => status === "active" || status === "proposed").length < 4) {
      const bill = register(world, state, side, { target: planned.target, invited: planned.invited, passage: true, military: true, dues: 4, term: 8 });
      if (bill?.invited.includes(state.player)) recordReign(state, entries, "league", firstCity(world, state), factionName(eraByYear(world, state), side) + "邀本方加入诸侯集团。", { critical: true });
    }
  }
}

function signLeague(world, state, row, proposals, entries) {
  for (const side of row.invited) {
    if (!alive(state, side)) continue;
    const explicit = row.votes[side];
    const chosen = proposals[side]?.reignChoice;
    const yes = side === state.player ? explicit === true : chosen === "R" + row.id + "-no" ? false
      : chosen === "R" + row.id + "-yes" || willingness(world, state, row, side);
    if (explicit === false || !yes) continue;
    row.members[side] = { paid: 0, defaults: 0, suspended: false };
  }
  if (members(row).length === 1) {
    if (state.turn + 1 >= row.founded + 3) row.status = "ended";
    return;
  }
  // Invitations to the player stay open for one settlement so a fast AI vote cannot preempt a player choice.
  if (row.invited.includes(state.player) && row.host !== state.player && !Object.hasOwn(row.votes, state.player)
    && state.turn < row.founded + 1) return;
  row.status = "active";
  row.until = state.turn + 1 + row.term;
  const publiclyRelevant = row.target === state.player || member(row, state.player);
  if (publiclyRelevant) recordReign(state, entries, "league", firstCity(world, state),
    factionName(eraByYear(world, state), row.host) + "主持的集团已生效，共 " + members(row).length + " 个成员。",
    { critical: row.target === state.player });
}

export function settleLeagues(world, previous, state, proposals, entries, ledger, forecast = false) {
  const data = state.reign;
  const current = state.turn + 1;
  const envoy = state.realm.offices.envoy?.holder && data.offices.envoy;
  let envoyRoom = envoy ? (envoy.term > state.turn ? envoy.cap : 0) : Infinity;
  if (!forecast) diplomaticAI(world, state, proposals, entries);
  data.sanctions = data.sanctions.filter(({ until, from, to }) => until > current && alive(state, from) && alive(state, to));
  if (!forecast) for (const party of state.polity.parties.filter(({ turn }) => turn === current)) {
    recordReign(state, entries, "recognition", party.city, party.name + "建立地方政权，可进行承认或保护交涉。", { critical: party.origin === state.player });
  }
  for (const row of data.leagues) {
    if (!["active", "proposed"].includes(row.status)) continue;
    if (forecast && !members(row).includes(state.player) && !row.invited.includes(state.player)) continue;
    if (!alive(state, row.host) || !alive(state, row.target) && current > row.founded + 1) {
      row.status = "ended";
      continue;
    }
    if (row.status === "proposed") { signLeague(world, state, row, proposals, entries); continue; }
    if (current >= row.until) { row.status = "ended"; continue; }
    for (const side of members(row).filter((key) => key !== row.host && member(row, key))) {
      const obligation = row.members[side];
      const stock = state.factions[side];
      if (!alive(state, side)) { obligation.suspended = true; continue; }
      const envoyLimit = side === state.player ? envoyRoom : Infinity;
      if (row.dues && (stock.grain < reignPolicy(state, side).reserve + row.dues || row.dues > envoyLimit)) {
        obligation.defaults++;
        if (obligation.defaults >= 2) obligation.suspended = true;
        if (side === state.player || row.host === state.player) recordReign(state, entries, "arrears", firstCity(world, state),
          factionName(eraByYear(world, state), side) + (obligation.suspended ? "连续欠缴情报与粮援，已暂停通行和共同守备权。" : "本季未能交纳盟粮。"), { critical: true });
        continue;
      }
      obligation.defaults = 0;
      if (row.dues) {
        stock.grain -= row.dues;
        state.factions[row.host].grain += row.dues;
        if (side === state.player) { ledger.out.grain += row.dues; envoyRoom -= row.dues; }
        if (row.host === state.player) ledger.in.grain += row.dues;
      }
      obligation.paid += row.dues;
    }
    if (members(row).filter((key) => member(row, key)).length < 2) row.status = "broken";
  }
}

function defenseRoute(world, state, unit, to) {
  const graph = new Map(world.cities.map((row) => [row.key, row]));
  const legal = (key) => hasPassage(state, unit.faction, key);
  return roadPath(graph, unit.location, to, legal, 5, (a, b) => openRoadEdge(state, unit.faction, a, b, false, unit.travel));
}

function threatenedTowns(world, state, row) {
  const armies = (state.armies ?? []).filter((army) => army.faction === row.target && ["march", "muster"].includes(army.phase));
  return world.cities.filter(({ key }) => member(row, state.cities[key].owner) && !state.cities[key].occupation
    && armies.some(({ target }) => target === key) && !warBlockaded(state, key));
}

export function prepareLeagueArmies(world, state, entries, controlled) {
  for (const row of state.reign.leagues.filter((group) => effective(state, group) && group.military && group.passage)) {
    const currentTargets = threatenedTowns(world, state, row);
    for (const side of members(row).filter((key) => key !== state.player && member(row, key) && alive(state, key))) {
      const duty = row.corps[side];
      const prior = duty && armyByOfficer(state, duty.officer);
      if (duty && (!prior || prior.faction !== side || !member(row, state.cities[duty.city].owner))) delete row.corps[side];
      if (prior && row.corps[side] && prior.location === duty.city && side !== state.cities[duty.city].owner && !prior.engagement && prior.troops > 200) {
        controlled.add(prior.officer);
        redirectArmy(world, state, prior, { type: "hold" });
        if (!duty.arrived) {
          duty.arrived = true;
          const ally = state.cities[duty.city].owner;
          recordReign(state, entries, "allied-arrival", duty.city, "盟军已进入" + cityName(world, duty.city) + "守备。", { side: ally });
        }
        continue;
      }
      const targets = duty && prior && row.corps[side] ? [duty.city] : currentTargets.map(({ key }) => key);
      if (!targets.length) continue;
      const alternatives = (state.armies ?? []).filter((unit) => unit.faction === side && unit.prepared && unit.troops >= 420
        && unit.grain >= 5 && !unit.engagement && !controlled.has(unit.officer) && !formationOf(state, unit.officer)?.resting
        && !state.frontline.requests.some(({ status, unit: id }) => status === "accepted" && formationOf(state, unit.officer)?.id === id)
        && !state.frontline.plans.some(({ units }) => units.some(({ id }) => formationOf(state, unit.officer)?.id === id)));
      const choices = (prior && row.corps[side] ? [prior] : alternatives).flatMap((unit) => targets
        .filter((key) => !sovereign(state, side, key) && supplyRoute(world, state, unit))
        .map((key) => ({ unit, key, route: defenseRoute(world, state, unit, key) })).filter(({ route }) => route?.length > 1))
        .sort((a, b) => a.route.length - b.route.length);
      const order = choices[0];
      if (!order) continue;
      const { key, unit, route } = order;
      const path = route.slice(0, 5);
      redirectArmy(world, state, unit, { type: "hold" });
      Object.assign(unit, { phase: "march", target: path.at(-1), route: path });
      controlled.add(unit.officer);
      if (!row.corps[side]) {
        row.corps[side] = { officer: unit.officer, city: key, from: state.turn, arrived: false };
        if (state.cities[key].owner === state.player) recordReign(state, entries, "allied-march", key,
          factionName(eraByYear(world, state), side) + "已发军团往" + cityName(world, key) + "，预计 " + (route.length - 1) + " 季。");
      }
    }
  }
}

export function leagueDefenders(state, city) {
  const owner = state.cities[city]?.owner;
  const counts = new Map();
  for (const league of state.reign?.leagues ?? []) {
    if (!effective(state, league) || !league.military || !member(league, owner)) continue;
    for (const [side, duty] of Object.entries(league.corps)) {
      if (side === owner || !member(league, side) || duty.city !== city) continue;
      const unit = armyByOfficer(state, duty.officer);
      if (unit?.faction === side && unit.location === city && unit.phase === "hold") counts.set(unit.officer, unit);
    }
  }
  return [...counts.values()];
}

export function validLeagues(state, data) {
  const side = (key) => Object.hasOwn(state.factions, key);
  const date = (value) => bounded(value, data.since, state.turn);
  const cities = (key) => Object.hasOwn(state.cities, key);
  return Array.isArray(data.leagues) && data.leagues.length <= 16 && data.leagues.every((row) => goodTerms(row)
    && bounded(row.id, 1, data.serial - 1) && side(row.host) && side(row.target) && row.host !== row.target
    && row.invited.every((key) => side(key) && key !== row.host && key !== row.target) && date(row.founded)
    && bounded(row.until, row.founded + row.term, state.turn + 12) && Object.hasOwn(leagueLabels, row.status)
    && plain(row.votes) && Object.entries(row.votes).every(([key, value]) => row.invited.includes(key) && typeof value === "boolean")
    && plain(row.members) && member(row, row.host) && Object.entries(row.members).every(([key, value]) => (key === row.host || row.invited.includes(key))
      && plain(value) && bounded(value.paid, 0, row.dues * row.term) && bounded(value.defaults, 0, 2) && typeof value.suspended === "boolean")
    && plain(row.corps) && Object.entries(row.corps).every(([key, value]) => side(key) && plain(value) && typeof value.officer === "string"
      && cities(value.city) && date(value.from) && typeof value.arrived === "boolean"))
    && Array.isArray(data.sanctions) && data.sanctions.length <= 24 && data.sanctions.every((row) => plain(row) && side(row.from) && side(row.to)
      && row.from !== row.to && bounded(row.until, data.since, state.turn + 4))
    && plain(data.recognitions) && Object.entries(data.recognitions).every(([key, value]) => side(key) && key !== state.player && plain(value)
      && date(value.at) && ["recognition", "protection"].includes(value.answer) && value.until === value.at + (value.answer === "protection" ? 10 : 4))
    && plain(data.guarantees) && Object.entries(data.guarantees).every(([key, value]) => side(key) && key !== state.player && plain(value)
      && date(value.since) && value.until === value.since + 10 && bounded(value.cost, 24, 70));
}
