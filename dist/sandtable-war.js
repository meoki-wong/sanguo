import { adjustCredit, accordCredit } from "./accords.js";
import { armyByOfficer, marchRoute, redirectArmy, supplyRoute, withdrawalRoute } from "./armies.js";
import { availableAttackers, availableForPosting, cityName, cityReserve, eraByYear, factionName, gameOutcome, transferRoutesTo } from "./engine.js";
import { isHostile, treatyWith } from "./diplomacy.js";
import { openRoadEdge } from "./grand-logistics.js";
import { handoverCities, retreatCity } from "./polity-handover.js";
import { bounded, livingSide, plain } from "./polities-data.js";
import { realmReserve } from "./realm.js";
import { postOwner, strategicPost, strategicPosts } from "./sandtable-posts.js";
import { warBlockaded } from "./war-operations.js";
import { proposeCongressFor } from "./landscape-treaty.js";

export const warGoals = { corridor: "夺取走廊", region: "争夺州郡", relief: "解救围城" };
export const warPhases = { muster: "集结", breakthrough: "突破", contest: "争夺", consolidate: "巩固" };
const pair = (a, b, from, to) => a !== b && [from, to].includes(a) && [from, to].includes(b);
const owns = (state, faction, city) => state.cities[city]?.owner === faction;

export const limitedPeace = (state, from, to) => state.sandtable?.peaces.find(({ a, b, until }) => until > state.turn && pair(a, b, from, to));
function targetCity(war) { return war.goal === "corridor" ? strategicPost(war.target).seat : war.target; }
export const warLocation = targetCity;

export function warTargets(world, state, faction, goal) {
  if (goal === "corridor") return strategicPosts.filter((post) => isHostile(state, faction, postOwner(state, post))
    && [post.seat, post.to].some((key) => owns(state, faction, key)))
    .map((post) => ({ key: post.key, name: post.name, rival: postOwner(state, post) }));
  return world.cities.flatMap(({ key, name, links }) => {
    if (goal === "region" && isHostile(state, faction, state.cities[key].owner) && links.some((site) => owns(state, faction, site))) {
      return [{ key, name, rival: state.cities[key].owner }];
    }
    if (goal !== "relief") return [];
    const owner = state.cities[key].owner;
    const siege = (state.armies ?? []).find((army) => army.target === key && army.engagement?.owner === owner
      && isHostile(state, army.faction, faction));
    const protectedSide = owner === faction || treatyWith(state, faction, owner)?.kind === "alliance";
    return protectedSide && siege ? [{ key, name, rival: siege.faction, ward: owner }] : [];
  });
}

function warDraft(world, state, from, draft) {
  if (!state.sandtable || !Object.hasOwn(warGoals, draft.goal) || typeof draft.auto !== "boolean") return null;
  const point = warTargets(world, state, from, draft.goal).find(({ key }) => key === draft.target);
  if (!point || state.sandtable.wars.filter(({ status }) => status === "fighting").length >= 12
    || state.sandtable.wars.some((row) => row.status === "fighting" && pair(row.from, row.to, from, point.rival))) return null;
  const target = world.cities.find(({ key }) => key === draft.target);
  const objectives = draft.goal === "region" ? [point.key, ...target.links.filter((key) => owns(state, point.rival, key)
    && world.cities.find((site) => site.key === key).region === target.region)].slice(0, 3) : null;
  return { from, to: point.rival, goal: draft.goal, target: draft.target, auto: draft.auto, objectives, ward: point.ward ?? null };
}

function addWar(state, draft) {
  const data = state.sandtable;
  data.wars.push({ ...draft, id: data.serial++, opened: state.turn, phase: "muster", status: "fighting", score: 0,
    losses: { from: 0, to: 0 }, commander: null, coalition: [], offer: null, receipt: null });
  if (data.wars.length > 28) data.wars.splice(data.wars.findIndex(({ status }) => status !== "fighting"), 1);
}

export function declareWar(world, state, draft) {
  const terms = warDraft(world, state, state.player, draft);
  if (!terms || gameOutcome(state) !== "ongoing") throw new Error("请选择本方邻接的战略目标，交战方须可开战且没有重复战约。");
  const next = structuredClone(state);
  addWar(next, terms);
  return next;
}

export function offerPeace(state, id, draft) {
  const next = structuredClone(state);
  const war = next.sandtable?.wars.find((row) => row.id === id && [row.from, row.to].includes(next.player) && row.status === "fighting");
  if (!war || !bounded(draft.payment, 0, 150) || !["ceasefire", "passage", "return"].includes(draft.kind)
    || (draft.kind === "passage" && war.goal !== "corridor") || (draft.kind === "return" && (war.goal !== "region"
      || !owns(next, war.from, war.target) || !next.polity.formerOwners[war.target]?.includes(war.to)))) throw new Error("当前战事无法执行所选议和条款。");
  war.offer = { by: next.player, kind: draft.kind, payment: draft.payment, turn: next.turn, answer: null };
  return next;
}

export function answerPeace(state, id, accepted) {
  const next = structuredClone(state);
  const row = next.sandtable?.wars.find((war) => war.id === id && war.status === "fighting" && war.offer?.by !== state.player
    && [war.from, war.to].includes(state.player));
  if (!row?.offer || typeof accepted !== "boolean") throw new Error("请选择待回复的和议。");
  row.offer.answer = accepted;
  return next;
}

function leverage(state, row) {
  if (row.goal === "corridor") return postOwner(state, strategicPost(row.target)) === row.from ? 75 : 5;
  if (row.goal === "relief") return !warBlockaded(state, row.target) && owns(state, row.ward, row.target) ? 78 : 12;
  const held = row.objectives.filter((key) => owns(state, row.from, key));
  if (held.length === row.objectives.length) return held.some((key) => state.cities[key].occupation) ? 75 : 90;
  return held.length ? Math.round(25 + 60 * held.length / row.objectives.length) : 14;
}

function reviseGoal(world, state, row) {
  if (row.goal !== "corridor" || row.score >= 35 || state.turn - row.opened < 5 || row.offer) return null;
  return warTargets(world, state, row.from, "region").find(({ rival }) => rival === row.to);
}

export function diplomaticManeuvers(world, state, faction) {
  if (!state.sandtable || faction === state.player || !livingSide(state, faction)) return [];
  const data = state.sandtable;
  const actions = [];
  const stocks = state.factions[faction];
  for (const row of data.wars.filter((war) => war.status === "fighting" && [war.from, war.to].includes(faction))) {
    if (row.offer && row.offer.by !== faction && row.offer.answer === null) {
      const score = row.from === row.offer.by ? row.score : 100 - row.score;
      actions.push({ id: "P" + row.id, kind: "response", key: row.id, text: "答复" + cityName(world, targetCity(row)) + "和议",
        accept: score >= 62 || stocks.grain < 45 || row.offer.payment >= 25 || row.offer.kind === "return" });
      continue;
    }
    if (!row.offer && state.turn - row.opened >= 3 && (stocks.grain < 60 || (row.from === faction ? row.score : 100 - row.score) >= 72)) {
      actions.push({ id: "S" + row.id, kind: "seek", key: row.id, text: "就" + cityName(world, targetCity(row)) + "提出停战" });
    }
    const revision = row.from === faction && reviseGoal(world, state, row);
    if (revision) actions.push({ id: "R" + row.id, kind: "revise", key: row.id, target: revision.key,
      text: "改围绕" + revision.name + "争夺州郡" });
  }
  if (state.turn >= 12 && (state.turn + faction.length) % 5 === 0 && stocks.grain >= 90 && stocks.treasury >= 65) {
    const options = warTargets(world, state, faction, "corridor").filter(({ rival }) => accordCredit(state, faction, rival) < 10)
      .flatMap(({ key, name }) => {
        const draft = warDraft(world, state, faction, { goal: "corridor", target: key, auto: true });
        return draft ? [{ id: "W" + key, kind: "war", draft, text: "争夺" + name + "以打开通路" }] : [];
      });
    actions.push(...options.slice(0, 2));
  }
  if (state.turn >= 14 && (state.turn + faction.length) % 9 === 0 && stocks.grain >= 70
    && state.landscape.congresses.filter(({ status }) => ["active", "voting"].includes(status)).length < 4
    && !state.landscape.congresses.some(({ host, status }) => host === faction && ["active", "voting"].includes(status))) {
    const target = warTargets(world, state, faction, "region")[0];
    if (target) {
      const neighbors = world.cities.filter(({ key }) => state.cities[key].owner === target.rival)
        .flatMap(({ links }) => links.map((key) => state.cities[key].owner))
        .filter((side) => ![faction, target.rival].includes(side) && accordCredit(state, faction, side) >= -4);
      const guests = [...new Set(neighbors)].slice(0, 2);
      if (guests.length === 2) actions.unshift({ id: "C" + target.key, kind: "coalition", target: target.key, guests,
        text: "召集诸侯会盟以争夺" + target.name });
    }
  }
  return actions;
}

export function authorizeWars(world, era, state, runOrder, entries, slots, runRival) {
  if (!state.sandtable) return;
  const served = new Set();
  for (const row of state.sandtable.wars.filter(({ status, auto }) => status === "fighting" && auto)) {
    const ours = row.from === state.player;
    if ((ours ? slots < 1 : !runRival || served.has(row.from)) || leverage(state, row) >= 72
      || state.factions[row.from].grain <= realmReserve(state, row.from).grain + 24) continue;
    const issue = (order) => ours ? runOrder(order) : runRival(row.from, order);
    const log = (entry) => {
      if (entry.type !== "order") return;
      entries.push(entry);
      if (ours) slots--;
      else served.add(row.from);
    };
    if (row.goal === "relief") {
      if (row.ward !== row.from) {
        if (treatyWith(state, row.from, row.ward)?.kind !== "alliance" || !owns(state, row.ward, row.target)) continue;
        const links = world.cities.find(({ key }) => key === row.target).links;
        const rear = links.find((key) => owns(state, row.from, key) && state.cities[key].troops >= 1100
          && openRoadEdge(state, row.from, key, row.target));
        if (!rear) continue;
        state.cities[rear].troops -= 550;
        state.cities[row.target].troops += 550;
        state.factions[row.from].grain -= 10;
        entries.push({ type: "war", event: "support", faction: row.from, city: row.target, participants: [row.from, row.ward],
          text: "盟军自" + cityName(world, rear) + "向" + cityName(world, row.target) + "增援 550 人。" });
        if (ours) slots--;
        else served.add(row.from);
        continue;
      }
      const route = transferRoutesTo(world, { ...state, player: row.from }, row.target).find((path) => state.cities[path[0]].troops >= 1100);
      if (route) {
        log(issue({ type: "transfer", from: route[0], to: row.target, troops: 550, ...(route.length > 2 ? { route } : {}) }));
      }
      continue;
    }
    const post = row.goal === "corridor" ? strategicPost(row.target) : null;
    const target = post ? [post.seat, post.to].find((key) => owns(state, row.to, key)) : row.objectives.find((key) => owns(state, row.to, key));
    const commander = row.commander && armyByOfficer(state, row.commander);
    if (target && !post && commander?.faction === row.from && ["secured", "hold"].includes(commander.phase)
      && commander.troops >= 500 && supplyRoute(world, state, commander)
      && marchRoute(world, state, row.from, commander.location, target, commander.travel)) {
      redirectArmy(world, state, commander, { type: "march", target, depot: commander.depot, stance: "siege" });
      if (ours) slots--;
      else served.add(row.from);
      continue;
    }
    if (!target || (state.armies ?? []).some((army) => army.faction === row.from && (army.target === target
      || (post && [post.seat, post.to].includes(army.location))))) continue;
    const site = world.cities.find(({ key }) => key === target);
    const approach = (post ? [post.seat, post.to] : site.links).filter((key) => owns(state, row.from, key) && !state.cities[key].occupation);
    const source = approach
      .map((key) => ({ key, leader: availableAttackers(era, state, row.from, key).sort((a, b) => b.command - a.command)[0] }))
      .filter(({ leader, key }) => leader && state.cities[key].troops > cityReserve + 550)
      .sort((a, b) => state.cities[b.key].troops - state.cities[a.key].troops)[0];
    if (!source) {
      const home = approach.find((key) => state.cities[key].troops > cityReserve + 550);
      if (!home) continue;
      const head = state.polity.courts[row.from]?.head;
      const locked = new Set(state.sandtable.wars.filter((item) => item.status === "fighting" && item.id !== row.id).map(({ commander }) => commander));
      const reserve = era.officers.filter(({ key, faction }) => faction === row.from && key !== head && !locked.has(key)
        && availableForPosting(state, key) && supplyRoute(world, state, { faction: row.from, depot: state.stations[key], location: home }))
        .sort((a, b) => b.command - a.command)[0];
      if (reserve) {
        row.commander = reserve.key;
        state.stations[reserve.key] = home;
        entries.push({ type: "notice", faction: row.from, city: home, text: reserve.name + "调往" + cityName(world, home) + "主持战前集结。" });
        if (ours) slots--;
        else served.add(row.from);
      }
      continue;
    }
    row.commander = source.leader.key;
    const troops = Math.min(2500, state.cities[source.key].troops - 500);
    const order = { type: "mobilize", from: source.key, to: target, officer: source.leader.key,
      troops, stance: post ? "blockade" : "siege" };
    let entry = issue(order);
    if (entry.type !== "order" && post && ["port", "ferry"].includes(post.kind)) entry = issue({ ...order, travel: "water" });
    log(entry);
  }
}

export function queueOpponentWarDecisions(world, before, state, proposals, entries) {
  const era = eraByYear(world, before);
  for (const { key } of era.factions) {
    const candidates = diplomaticManeuvers(world, before, key);
    const request = proposals[key];
    const item = request?.source === "model" && request.strategic
      ? candidates.find(({ id }) => id === request.strategic) : candidates.find(({ kind }) => kind === "response") ?? candidates[0];
    if (!item) continue;
    if (item.kind === "coalition") {
      try {
        const joined = proposeCongressFor(state, key, { guests: item.guests, target: item.target, duration: 4, border: true, market: true,
          aid: 0, beneficiary: null, returnTo: null, duties: { [key]: "assault", [item.guests[0]]: "screen", [item.guests[1]]: "assault" } });
        state.landscape = joined.landscape;
        entries.push({ type: "notice", faction: key, participants: [key, ...item.guests], city: item.target,
          text: factionName(era, key) + "发出了争夺" + cityName(world, item.target) + "的会盟邀请。" });
      } catch {
        // The objective or available conference seats can change during simultaneous orders.
      }
      continue;
    }
    if (item.kind === "war") {
      const draft = warDraft(world, state, key, item.draft);
      if (draft) {
        addWar(state, draft);
        entries.push({ type: "notice", faction: key, participants: [key, draft.to], city: targetCity(draft),
          text: factionName(era, key) + "发起" + warGoals[draft.goal] + "之战。" });
      }
      continue;
    }
    const row = state.sandtable.wars.find(({ id }) => id === item.key);
    if (!row || row.status !== "fighting") continue;
    if (item.kind === "seek" && !row.offer) row.offer = { by: key, kind: "ceasefire", payment: 0, turn: state.turn, answer: null };
    if (item.kind === "response" && row.offer?.by !== key && row.offer?.answer === null) row.offer.answer = item.accept;
    if (item.kind === "revise" && row.from === key && !row.offer && owns(state, row.to, item.target)) {
      row.goal = "region";
      row.target = item.target;
      row.objectives = [item.target];
      row.ward = null;
      row.score = 0;
      row.phase = "muster";
      entries.push({ type: "war", event: "war-treaty", faction: key, participants: [row.from, row.to], city: row.target,
        text: factionName(era, key) + "调整战争目标，转向争夺" + cityName(world, row.target) + "。" });
    }
  }
}

export function settleLimitedWars(world, state, entries, account) {
  const data = state.sandtable;
  const round = state.turn + 1;
  const era = eraByYear(world, state, round);
  data.peaces = data.peaces.filter(({ until }) => until > round);
  for (const row of data.wars.filter(({ status }) => status === "fighting")) {
    const { from, to } = row;
    const city = targetCity(row);
    const note = (text) => entries.push({ type: "war", event: "war-treaty", faction: from, participants: [from, to], city, text, warId: row.id });
    for (const { battle, post, city: place } of entries) {
      if (!battle || !(place === city || row.objectives?.includes(place) || post && post === row.target)
        || !pair(battle.attacker.faction, battle.defender.faction, from, to)) continue;
      for (const side of [battle.attacker, battle.defender]) {
        const role = side.faction === from ? "from" : "to";
        row.losses[role] = Math.min(5000000, row.losses[role] + side.casualties);
      }
    }
    row.score = Math.max(0, Math.min(100, leverage(state, row) + Math.max(-15, Math.min(15, Math.trunc((row.losses.to - row.losses.from) / 180)))));
    const allies = entries.filter(({ type, faction, city: at, participants }) => ["battle", "capture", "war"].includes(type)
      && at === city && ![from, to].includes(faction) && participants?.includes(to)
      && state.landscape.congresses.some((c) => c.status === "active" && c.parties.includes(faction) && c.parties.includes(from)));
    for (const { faction } of allies) if (!row.coalition.includes(faction)) row.coalition.push(faction);
    const phase = row.score >= 72 ? "consolidate" : row.score >= 55 ? "contest" : round - row.opened >= 2 ? "breakthrough" : "muster";
    if (phase !== row.phase) { row.phase = phase; note(warGoals[row.goal] + "进入" + warPhases[phase] + "阶段。"); }
    if (!livingSide(state, from) || !livingSide(state, to)) {
      row.status = "ended";
      row.receipt = { turn: round, kind: "collapse", detail: "交战势力失去全部主城。" };
      continue;
    }
    const offer = row.offer;
    if (offer?.answer === false) { note("和议被拒，战事继续。"); row.offer = null; continue; }
    if (offer?.answer !== true) continue;
    const receiver = offer.by === from ? to : from;
    const grant = { treasury: offer.payment, grain: 0 };
    if (offer.kind === "return" && (!owns(state, from, row.target)
      || Object.values(state.cities).filter(({ owner }) => owner === from).length <= 1)) {
      note("目标易主或交割会耗尽一方领土，和议未完成。");
      row.offer = null;
      continue;
    }
    if (offer.payment && !account(offer.by, "out", grant)) { note("赔款未付，和议留待重新提出。"); row.offer = null; continue; }
    if (offer.payment) account(receiver, "in", grant);
    if (offer.kind === "return") {
      const site = state.cities[row.target];
      const troops = Math.max(0, site.troops - 250);
      const before = state.factions[state.player].grain;
      handoverCities(world, era, state, from, to, [row.target], "return", round);
      const retreat = retreatCity(world, state, from, row.target);
      site.troops -= troops;
      state.cities[retreat].troops += troops;
      const returned = state.factions[state.player].grain - before;
      if (returned > 0) {
        state.factions[state.player].grain -= returned;
        account(state.player, "in", { treasury: 0, grain: returned });
      }
    }
    const corridor = offer.kind === "passage" ? row.target : null;
    data.peaces.push({ a: from, b: to, until: round + 6, corridor });
    if (data.peaces.length > 24) data.peaces.shift();
    let standDown = 0;
    for (const unit of state.armies ?? []) {
      const rival = state.cities[unit.target].owner;
      if (!pair(unit.faction, rival, from, to) || !["march", "muster", "hold"].includes(unit.phase)) continue;
      const home = [unit.depot, unit.location].find((key) => withdrawalRoute(world, state, unit, key));
      redirectArmy(world, state, unit, home ? { type: "retreat", target: home } : { type: "hold" });
      standDown++;
    }
    adjustCredit(state, from, to, 8);
    if ([from, to].includes(state.player)) state.polity.peaceDeals++;
    row.status = "ended";
    row.receipt = { turn: round, kind: offer.kind, detail: "停战六季 · " + standDown + " 支军团停止进攻" + (offer.payment ? " · 交付 " + offer.payment + " 钱" : "") };
    note(row.receipt.detail + "。");
  }
}

export function validLimitedWars(state, data, officers) {
  const faction = (key) => Object.hasOwn(state.factions, key);
  const city = (key) => Object.hasOwn(state.cities, key);
  const date = (value) => bounded(value, data.since, state.turn);
  const terms = ["ceasefire", "passage", "return"];
  return Array.isArray(data.wars) && data.wars.length <= 28 && new Set(data.wars.map((row) => row?.id)).size === data.wars.length
    && data.wars.every((row) => plain(row) && bounded(row.id, 1, data.serial - 1) && faction(row.from) && faction(row.to) && row.from !== row.to
      && Object.hasOwn(warGoals, row.goal) && (row.goal === "corridor" ? strategicPost(row.target) : city(row.target))
      && (row.goal === "region" ? Array.isArray(row.objectives) && row.objectives.length >= 1 && row.objectives.length <= 3
        && row.objectives[0] === row.target && new Set(row.objectives).size === row.objectives.length && row.objectives.every(city) : row.objectives === null)
      && (row.goal === "relief" ? faction(row.ward) : row.ward === null)
      && typeof row.auto === "boolean" && date(row.opened) && Object.hasOwn(warPhases, row.phase)
      && ["fighting", "ended"].includes(row.status) && bounded(row.score, 0, 100)
      && row.losses && ["from", "to"].every((key) => bounded(row.losses[key], 0, 5000000))
      && (row.commander === null || officers.has(row.commander))
      && Array.isArray(row.coalition) && row.coalition.every(faction) && new Set(row.coalition).size === row.coalition.length
      && (row.offer === null || row.offer && [row.from, row.to].includes(row.offer.by) && terms.includes(row.offer.kind)
        && date(row.offer.turn) && bounded(row.offer.payment, 0, 150) && (row.offer.answer === null || typeof row.offer.answer === "boolean"))
      && (row.receipt === null && row.status === "fighting" || row.receipt && row.status === "ended" && date(row.receipt.turn)
        && [...terms, "collapse"].includes(row.receipt.kind) && typeof row.receipt.detail === "string" && row.receipt.detail.length <= 120))
    && Array.isArray(data.peaces) && data.peaces.length <= 24 && data.peaces.every((row) => row && faction(row.a) && faction(row.b)
      && row.a !== row.b && bounded(row.until, state.turn + 1, state.turn + 6) && (row.corridor === null || Boolean(strategicPost(row.corridor))));
}
