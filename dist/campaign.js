import { isHostile } from "./diplomacy.js";
import { appoint, availableForPosting, eraByYear, gameOutcome, previewOrders } from "./engine.js";
import { scenarioObjective } from "./objectives.js";
import { formerlyServed } from "./polities-data.js";

export function campaignRoute(world, era, state) {
  const initial = Object.keys(era.ownership).filter((key) => era.ownership[key] === state.player);
  const held = initial.filter((key) => state.cities[key].owner === state.player).length;
  const recovered = Object.entries(state.cities).filter(([key, city]) => era.ownership[key] !== state.player
    && city.owner === state.player && city.occupation === 0).length;
  const opening = era.factions.find(({ key }) => key === state.player).stats;
  const stock = state.factions[state.player];
  const first = scenarioObjective(world, era, state);
  const defensive = era.year !== 265;
  const stockName = defensive ? "储粮" : "国库";
  const reserves = defensive ? stock.grain : stock.treasury;
  const reserveTarget = (defensive ? opening[1] : opening[0]) + (initial.length <= 3 ? 40 : 60);
  const enemyHoldings = world.cities.length - initial.length;
  const coreTarget = initial.length <= 3 ? initial.length : Math.ceil(initial.length * .8);
  const expansionTarget = Math.min(enemyHoldings, era.year === 265 ? 4 : initial.length <= 3 ? 1 : 2);
  const middle = defensive ? { label: "开局辖城", value: held, target: coreTarget }
    : { label: "新城整顿", value: recovered, target: Math.min(2, enemyHoldings) };
  const milestones = [
    { title: first.title, description: first.description, checks: [{ label: "达标城", value: first.progress, target: first.required }] },
    { title: { 184: "储粮赈乡", 190: "充实联军粮仓", 199: "充实仓廪", 208: "储粮守江", 219: "积粮保荆汉", 234: "筹措前线冬粮", 251: "厚积群英粮饷", 262: "稳住防线", 265: "复通税粮" }[era.year],
      description: defensive ? "守住开局辖城的核心，并充实储粮。" : "巩固新占城，并充实国库。",
      checks: [middle, { label: stockName, value: reserves, target: reserveTarget }] },
    { title: { 184: "平定郡县", 190: "平定关东", 199: "开疆稳政", 208: "立足荆江", 219: "固守江汉", 234: "巩固进军走廊", 251: "问鼎中原", 262: "推进战线", 265: "立足州郡" }[era.year],
      description: "控制开局疆域之外的城池并完成整顿，同时保有开局辖城的核心。",
      checks: [{ label: "新城整顿", value: recovered, target: expansionTarget }, { label: "开局辖城", value: held, target: coreTarget }] },
  ];
  const dates = [state.stageCompletedAt, ...(state.campaignMilestones ?? [])];
  return milestones.map((step, index) => ({ ...step, completed: dates[index] ?? null,
    ready: step.checks.every(({ value, target }) => value >= target) }));
}

export function settleCampaignRoute(world, era, state) {
  if (state.stageCompletedAt === null) return null;
  const dates = state.campaignMilestones ?? [];
  if (dates.length >= 2 || (dates.at(-1) ?? state.stageCompletedAt) >= state.turn) return null;
  const step = campaignRoute(world, era, state)[dates.length + 1];
  if (!step.ready) return null;
  state.campaignMilestones = [...dates, state.turn];
  return step.title;
}

const historicalEvents = {
  184: { title: "乡里归耕", description: "拨粮 28 安置流民，屯田提升一级。", cost: { grain: 28 }, project: "farming" },
  190: { title: "联军立寨", description: "拨钱 24 为联军修整营垒，城防提升一级。", cost: { treasury: 24 }, project: "defense" },
  199: { title: "流民归耕", description: "赈济迁来的百姓，拨粮 35，屯田提升一级。", cost: { grain: 35 }, project: "farming" },
  208: { title: "修缮江埠", description: "拨钱 28 修整渡口与仓行，商贸提升一级。", cost: { treasury: 28 }, project: "commerce" },
  219: { title: "汉水修圩", description: "拨粮 26 安顿河畔屯户，屯田提升一级。", cost: { grain: 26 }, project: "farming" },
  234: { title: "渭水屯兵", description: "拨钱 30 修筑前线工事，城防提升一级。", cost: { treasury: 30 }, project: "defense" },
  251: { title: "群英会盟", description: "拨粮 30 犒赏四方义士，屯田提升一级。", cost: { grain: 30 }, project: "farming" },
  262: { title: "修缮粮道", description: "稳固边城的转运道路，拨钱 32，城防提升一级。", cost: { treasury: 32 }, project: "defense" },
  265: { title: "州郡归心", description: "安置新附州郡，拨钱 36，商贸提升一级，民心增加 5。", cost: { treasury: 36 }, project: "commerce" },
};
const eventDates = { recommendation: 4, succession: 8, surrender: 10, historical: 13 };
const serviceSkills = ["governance", "command"];
const rankPrice = 3;
const maximumRank = 3;
const emptyService = { governance: 0, command: 0, governanceRank: 0, commandRank: 0 };

export function officerService(state, key) {
  return state.officerService?.[key] ?? emptyService;
}

export function officerSkill(state, person, skill) {
  if (!person) return 0;
  const bonus = (state?.officerService?.[person.key]?.[skill + "Rank"] ?? 0) * 5;
  return person[skill] + bonus;
}

export function awardService(state, key, skill, amount = 1) {
  if (!key) return;
  const service = officerService(state, key);
  const experience = Math.min(rankPrice * maximumRank, service[skill] + amount);
  if (experience === service[skill]) return;
  state.officerService ??= {};
  state.officerService[key] = { ...service, [skill]: experience };
}

export function promotionCost(state, key, skill) {
  const rank = officerService(state, key)[skill + "Rank"];
  return rank < maximumRank ? (rank + 1) * rankPrice : null;
}

export function promoteOfficer(world, state, key, skill) {
  if (gameOutcome(state) !== "ongoing") throw new Error("战局已结束。");
  const era = eraByYear(world, state);
  const person = era.officers.find((entry) => entry.key === key && entry.faction === state.player);
  if (!person || !state.stations[key] || !serviceSkills.includes(skill)) throw new Error("只能提拔仍在任用范围内的己方文武。");
  const required = promotionCost(state, key, skill);
  const service = officerService(state, key);
  if (required === null || service[skill] < required) throw new Error("当前资历不足，或已达最高品阶。");
  const next = structuredClone(state);
  next.officerService[key][skill + "Rank"] += 1;
  previewOrders(world, next);
  return next;
}

export function settleCommandService(world, era, state, entries) {
  const served = new Set();
  for (const { key, links } of world.cities) {
    const city = state.cities[key];
    if (city.owner === state.player && !city.occupation && city.commander
      && links.some((neighbor) => isHostile(state, state.player, state.cities[neighbor].owner))) served.add(city.commander);
  }
  for (const { battle } of entries) {
    if (battle?.attacker.faction === state.player) served.add(battle.personnel.attacker);
    if (battle?.defender.faction === state.player) served.add(battle.personnel.defender);
  }
  for (const person of era.officers) {
    if (person.faction === state.player && served.has(person.key)) awardService(state, person.key, "command");
  }
}

function eventOffer(world, era, state, kind, subject = {}) {
  if (kind === "historical") {
    const terms = historicalEvents[state.year];
    if (!terms) return null;
    const eligible = world.cities.filter(({ key }) => {
      const holding = state.cities[key];
      return (!subject.city || key === subject.city) && holding.owner === state.player && !holding.occupation
        && holding[terms.project] < 5 && (state.year !== 265 || era.ownership[key] !== state.player);
    });
    const city = eligible.find(({ links }) => state.year !== 262 || links.some((key) => isHostile(state, state.player, state.cities[key].owner)))
      ?? eligible[0];
    return city ? { ...terms, city: city.key, description: city.name + " · " + terms.description } : null;
  }
  if (kind === "surrender") {
    const site = world.cities.find(({ key, links }) => {
      const city = state.cities[key];
      return (!subject.city || key === subject.city) && city.owner === state.player && !city.occupation
        && links.some((link) => isHostile(state, state.player, state.cities[link].owner)
        && city.troops >= state.cities[link].troops);
    });
    if (!site) return null;
    return { title: "边军归降", description: site.name + "有邻境部众来降。拨粮 20 可接纳 350 人，补入该城驻军。",
      cost: { grain: 20 }, city: site.key };
  }
  const skill = kind === "recommendation" ? "governance" : "command";
  const persons = era.officers.filter(({ key, faction }) => faction === state.player && state.stations[key]
    && (!subject.officer || key === subject.officer) && (kind === "recommendation" || availableForPosting(state, key)));
  const person = persons.sort((a, b) => officerService(state, a.key)[skill] - officerService(state, b.key)[skill]
    || b[skill] - a[skill])[0];
  if (!person) return null;
  if (kind === "recommendation") return { title: "人才举荐", description: "群臣举荐" + person.name + "协理政务。拨钱 18 支持历练，增加 2 点政务资历。",
    cost: { treasury: 18 }, key: person.key, skill };
  const holding = world.cities.find(({ key, links }) => {
    const city = state.cities[key];
    return (!subject.city || key === subject.city) && city.owner === state.player && !city.occupation
      && links.some((link) => isHostile(state, state.player, state.cities[link].owner));
  });
  if (!holding) return null;
  return { title: "军务继任", description: "拨粮 12，任命" + person.name + "接任" + holding.name
    + "守将。此人获得 2 点统率资历，民心增加 4。", cost: { grain: 12 }, key: person.key, skill, city: holding.key };
}

export function settleCampaignEvent(world, era, state) {
  const events = state.campaignEvents;
  if (events?.pending) return null;
  for (const [kind, turn] of Object.entries(eventDates)) {
    if (state.turn < turn || events?.records.some(({ kind: used }) => used === kind)) continue;
    const offer = eventOffer(world, era, state, kind);
    if (!offer) continue;
    const pending = { kind, turn: state.turn };
    if (offer.key) pending.officer = offer.key;
    if (offer.city) pending.city = offer.city;
    state.campaignEvents = { records: events?.records ?? [], pending };
    return offer.title;
  }
  return null;
}

export function campaignEvent(world, era, state) {
  const pending = state.campaignEvents?.pending;
  if (!pending) return null;
  const offer = eventOffer(world, era, state, pending.kind, pending);
  if (!offer) return { title: "条件已变化", description: "事件所需的人选或城池已不可用。", available: false };
  const balance = previewOrders(world, state).factions[state.player];
  const available = Object.entries(offer.cost).every(([resource, amount]) => balance[resource] >= amount);
  return { ...offer, available };
}

export function answerCampaignEvent(world, era, state, accepted) {
  if (gameOutcome(state) !== "ongoing") throw new Error("战局已结束。");
  const event = campaignEvent(world, era, state);
  if (!event || typeof accepted !== "boolean") throw new Error("没有待处理的事件。");
  if (accepted && !event.available) throw new Error("当前条件不足，无法接受。");
  const next = accepted && state.campaignEvents.pending.kind === "succession"
    ? appoint(world, state, event.city, "commander", event.key) : structuredClone(state);
  const { pending, records } = next.campaignEvents;
  if (accepted) {
    for (const [resource, amount] of Object.entries(event.cost)) next.factions[state.player][resource] -= amount;
    if (pending.kind === "surrender") next.cities[event.city].troops += 350;
    else if (pending.kind === "historical") {
      next.cities[event.city][event.project] += 1;
      if (next.year === 265) next.factions[next.player].morale += 5;
    } else awardService(next, event.key, event.skill, 2);
    if (pending.kind === "succession") next.factions[state.player].morale += 4;
  }
  records.push({ kind: pending.kind, turn: next.turn, accepted });
  next.campaignEvents.pending = null;
  previewOrders(world, next);
  return next;
}

export function campaignEventName(year, kind) {
  if (kind === "historical") return historicalEvents[year].title;
  return { recommendation: "人才举荐", succession: "军务继任", surrender: "边军归降" }[kind];
}

export function validCampaignProgress(state, officers) {
  const date = (value) => Number.isSafeInteger(value) && value > 0 && value <= state.turn;
  const dates = state.campaignMilestones;
  if (dates !== undefined && (!Array.isArray(dates) || dates.length > 2 || state.stageCompletedAt === null
    || dates.some((value, index) => !date(value) || value <= (index ? dates[index - 1] : state.stageCompletedAt)))) return false;
  const events = state.campaignEvents;
  if (events !== undefined) {
    if (!events || !Array.isArray(events.records) || events.records.length > Object.keys(eventDates).length) return false;
    const valid = (record) => record && Object.hasOwn(eventDates, record.kind) && date(record.turn) && record.turn >= eventDates[record.kind];
    if (!events.records.every((record, index) => valid(record) && typeof record.accepted === "boolean"
      && (!index || record.turn >= events.records[index - 1].turn))) return false;
    const used = new Set(events.records.map(({ kind }) => kind));
    if (used.size !== events.records.length || (events.pending !== null && (!valid(events.pending)
      || used.has(events.pending.kind) || events.pending.turn < (events.records.at(-1)?.turn ?? 0)))) return false;
    if (events.pending) {
      const { kind, officer, city } = events.pending;
      if (["recommendation", "succession"].includes(kind) && officers.get(officer)?.faction !== state.player) return false;
      if (kind !== "recommendation" && !Object.hasOwn(state.cities, city)) return false;
    }
  }
  const service = state.officerService;
  return service === undefined || (service && typeof service === "object" && !Array.isArray(service)
    && Object.entries(service).every(([key, value]) => (officers.get(key)?.faction === state.player || formerlyServed(state, key, state.player)) && value
      && serviceSkills.every((skill) => {
        const xp = value[skill];
        const rank = value[skill + "Rank"];
        return Number.isInteger(xp) && xp >= 0 && xp <= rankPrice * maximumRank
          && Number.isInteger(rank) && rank >= 0 && rank * rankPrice <= xp;
      })));
}
