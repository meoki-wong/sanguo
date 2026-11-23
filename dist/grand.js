import { cityName, eraByYear, gameOutcome } from "./engine.js";
import { isHostile } from "./diplomacy.js";
import { beginWar } from "./war-intel.js";
import { enablePolity } from "./polity.js";
import { bounded, livingSide, plain, provinceKey } from "./polities-data.js";
import { finishGrandCampaigns, recoverGrandCampaigns, validCampaignShape } from "./grand-campaign.js";
import { packageShape, settlePackages, grandClauses } from "./grand-diplomacy.js";
import { administerDistricts, crossings, gateOwner, validDistrict, validGrandNational } from "./grand-logistics.js";
import { funds, spending } from "./finance.js";

export const agendas = { expand: "争取战略要地", guard: "巩固边防", restore: "安民筹粮", trade: "维持通商" };

export function enableGrand(world, state, custom = null) {
  if (state.grand) return state;
  if (!custom && gameOutcome(state) !== "ongoing") throw new Error("请选择进行中的战局。");
  const ready = enablePolity(world, beginWar(world, state));
  return { ...ready, grand: {
    since: state.turn, custom, national: { treasury: 0, grain: 0, reserve: 0 }, districts: {}, depots: {}, closed: {},
    campaigns: [], agendas: {}, passes: [], offers: [], agreements: [], serial: 0, receipts: [],
  } };
}

export function validateOpening(world, era, player, draft) {
  if (!draft) return;
  const { title, owners, stocks, stations } = draft;
  const sides = new Set(era.factions.map(({ key }) => key));
  const ownership = { ...era.ownership, ...owners };
  const citizens = new Map(era.officers.filter(({ reserve }) => !reserve).map(({ key, faction }) => [key, faction]));
  if (typeof title !== "string" || !title.trim() || title.length > 24 || !plain(owners) || !plain(stocks) || !plain(stations)
    || !Object.entries(owners).every(([key, owner]) => Object.hasOwn(era.ownership, key) && sides.has(owner))
    || !Object.values(ownership).includes(player)
    || !Object.entries(stocks).every(([key, stock]) => sides.has(key) && stock && bounded(stock.treasury, 0, 5000) && bounded(stock.grain, 0, 5000))
    || !Object.entries(stations).every(([key, city]) => citizens.has(key) && ownership[city] === citizens.get(key))) {
    throw new Error("自定义开局需要有效名称、至少一座玩家主城，人物须驻在本势力辖城。");
  }
}

export function agendaChoices(world, state, faction) {
  if (!state.grand || state.turn < 15 || !livingSide(state, faction)) return [];
  const { grain, treasury } = state.factions[faction];
  const owned = world.cities.filter(({ key }) => state.cities[key].owner === faction);
  const enemies = new Map();
  for (const { links } of owned) for (const site of links) {
    const rival = state.cities[site].owner;
    if (isHostile(state, faction, rival)) enemies.set(rival, (enemies.get(rival) ?? 0) + 1);
  }
  const rivals = [...enemies].sort((a, b) => b[1] - a[1]);
  const rival = rivals[0]?.[0] ?? null;
  const shaken = owned.filter(({ key }) => state.cities[key].occupation || state.realm.cities[key].welfare < 58).length;
  const ranked = grain < 100 || treasury < 55 || shaken > owned.length / 3 ? ["restore", "guard", "trade", "expand"]
    : owned.length <= 3 || rivals.length >= 3 ? ["guard", "restore", "trade", "expand"] : ["expand", "guard", "trade", "restore"];
  const prior = state.grand.agendas[faction];
  const ordered = prior && prior.until > state.turn + 1 && (ranked[0] !== "restore" || prior.kind === "restore")
    && (prior.rival === null || livingSide(state, prior.rival)) ? [prior.kind, ...ranked.filter((kind) => kind !== prior.kind)] : ranked;
  return ordered.filter((kind) => kind !== "expand" || rival !== null).map((kind, index) => ({ id: "G" + index, kind, rival }));
}

function settleAgendas(world, before, state, choices, entries) {
  const turn = before.turn + 1;
  for (const faction of Object.keys(state.factions)) {
    if (faction === state.player) continue;
    if (!livingSide(state, faction)) {
      delete state.grand.agendas[faction];
      continue;
    }
    const current = state.grand.agendas[faction];
    const options = agendaChoices(world, before, faction);
    const manual = choices[faction]?.source === "model";
    const proposal = manual && options.find(({ id }) => choices[faction].agenda === id);
    if (!proposal && current?.until > turn && (current.rival === null || livingSide(state, current.rival))
      && (options[0]?.kind !== "restore" || current.kind === "restore")) continue;
    const selected = proposal || options[0];
    if (!selected) continue;
    const rival = selected.rival && livingSide(state, selected.rival) ? selected.rival : null;
    if (current?.kind === selected.kind && current?.rival === rival && current.until > turn) continue;
    state.grand.agendas[faction] = { kind: selected.kind, rival, since: turn, until: turn + 4 };
    if (rival === state.player && current?.kind !== selected.kind) entries.push({ type: "grand", faction, participants: [faction, rival],
      text: "边报察见对方正在" + agendas[selected.kind] + "。" });
  }
}

export function settleGrand(world, before, state, entries, choices = {}, forecast = false) {
  if (!state.grand) return null;
  const stock = state.factions[state.player];
  const start = funds(stock);
  if (!forecast) settleAgendas(world, before, state, choices, entries);
  for (const faction of Object.keys(state.factions)) {
    if (livingSide(state, faction) && (!forecast || faction === state.player)) administerDistricts(world, state, faction, entries);
  }
  recoverGrandCampaigns(world, state, entries);
  const after = funds(stock);
  const budget = spending(start, after);
  settlePackages(world, state, entries, forecast);
  const closing = funds(stock);
  const delta = (key) => closing[key] - after[key];
  const positive = (sign) => ({ treasury: Math.max(0, sign * delta("treasury")), grain: Math.max(0, sign * delta("grain")) });
  if (!forecast) {
    finishGrandCampaigns(world, state, entries);
    for (const gate of crossings) if (state.grand.closed[gate.key] && state.grand.closed[gate.key] !== gateOwner(state, gate)) {
      delete state.grand.closed[gate.key];
    }
    for (const key of Object.keys(state.grand.depots)) {
      if (!state.grand.depots[key]) delete state.grand.depots[key];
      else if (before.cities[key].owner !== state.cities[key].owner) {
        const grain = state.grand.depots[key];
        if (before.cities[key].owner === state.player || state.cities[key].owner === state.player) {
          entries.push({ type: "grand", faction: state.cities[key].owner, city: key,
            participants: [before.cities[key].owner, state.cities[key].owner], text: cityName(world, key) + "换防，城内 " + grain + " 粮随仓交接。" });
        }
      }
    }
  }
  return { budget, in: positive(1), out: positive(-1) };
}

export function validGrand(world, state, officers) {
  const data = state.grand;
  if (data === undefined) return true;
  if (!plain(data) || !state.war || !state.polity || !bounded(data.since, 0, state.turn) || !bounded(data.serial, 0, 15000000)
    || !validGrandNational(data.national)) return false;
  const side = (key) => Object.hasOwn(state.factions, key);
  const city = (key) => Object.hasOwn(state.cities, key);
  const date = (turn) => bounded(turn, data.since, state.turn);
  if (data.custom !== null && (!plain(data.custom) || typeof data.custom.title !== "string" || !data.custom.title.trim() || data.custom.title.length > 24
    || !plain(data.custom.ownership) || Object.keys(data.custom.ownership).length !== world.cities.length
    || !Object.entries(data.custom.ownership).every(([key, owner]) => city(key) && side(owner)))) return false;
  if (!plain(data.depots) || !Object.entries(data.depots).every(([key, amount]) => city(key) && bounded(amount, 0, 300))) return false;
  if (!plain(data.closed) || !Object.entries(data.closed).every(([key, faction]) => side(faction) && crossings.some((gate) => gate.key === key))) return false;
  const districts = new Set(Object.keys(state.factions).flatMap((owner) => world.cities.map(({ region }) => provinceKey(owner, region))));
  if (!plain(data.districts) || !Object.entries(data.districts).every(([key, value]) => districts.has(key) && validDistrict(value)
    && (value.depot === null || city(value.depot)))) return false;
  if (!plain(data.agendas) || !Object.entries(data.agendas).every(([key, value]) => side(key) && value
    && Object.hasOwn(agendas, value.kind) && (value.rival === null || (side(value.rival) && key !== value.rival)) && date(value.since)
    && value.until === value.since + 4)) return false;
  if (!Array.isArray(data.campaigns) || data.campaigns.length > 2 || new Set(data.campaigns.map((plan) => plan?.id)).size !== data.campaigns.length
    || !data.campaigns.every((plan) => validCampaignShape(state, plan, officers))) return false;
  const records = (items, limit, allows) => Array.isArray(items) && items.length <= limit && items.every(allows);
  const id = (item) => item && bounded(item.id, 1, data.serial);
  if (!records(data.offers, 24, (item) => id(item) && packageShape(state, item) && date(item.submitted)
    && (item.answer === undefined || typeof item.answer === "boolean" && item.to === state.player))
    || !records(data.agreements, 24, (item) => id(item) && packageShape(state, item) && item.due === state.turn + 1)
    || !records(data.receipts, 36, (item) => id(item) && side(item.from) && side(item.to) && date(item.turn)
      && records(item.clauses, 6, (clause) => clause && Object.hasOwn(grandClauses, clause.key)
        && typeof clause.ok === "boolean" && typeof clause.detail === "string" && clause.detail.length <= 140))
    || !records(data.passes, 80, (item) => item && side(item.from) && side(item.to) && item.from !== item.to
      && ["halt", "pass"].includes(item.kind) && bounded(item.expires, state.turn + 1, state.turn + 6))) return false;
  const ids = [...data.offers, ...data.agreements, ...data.receipts].map((item) => item.id);
  return ids.length === new Set(ids).size;
}
