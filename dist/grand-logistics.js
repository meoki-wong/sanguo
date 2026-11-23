import { cityName, firstCity, gameOutcome } from "./engine.js";
import { isHostile } from "./diplomacy.js";
import { realmReserve } from "./realm.js";
import { roadPath } from "./roads.js";
import { roadTerrain } from "./war-intel.js";
import { warBlockaded } from "./war-operations.js";
import { bounded, provinceKey } from "./polities-data.js";
import { weatherAllows } from "./landscape-terrain.js";
import { conferencePass } from "./landscape-treaty.js";

export const grandPriorities = { growth: "发展", defense: "前线", recovery: "接管" };
export const crossings = [
  ["changan", "luoyang", "函谷道"],
  ["changan", "tianshui", "陇山道"],
  ["nanzheng", "shangyong", "汉水栈道"],
  ["nanzheng", "zitong", "剑门道"],
  ["yufu", "jiangzhou", "巴东道"],
  ["yufu", "jiangling", "三峡道"],
  ["jiangling", "jiangxia", "荆江渡"],
  ["jiangxia", "chaisang", "寻阳渡"],
  ["chaisang", "linxiang", "湘江渡"],
].map(([seat, to, name]) => ({ key: [seat, to].sort().join(":"), seat, to, name, kind: roadTerrain(seat, to) }));

const graph = (world) => new Map(world.cities.map((city) => [city.key, city]));

export function gateOwner(state, gate) {
  return state.cities[gate.seat]?.owner;
}

export function hasPassage(state, faction, key) {
  const owner = state.cities[key]?.owner;
  if (owner === faction) return true;
  return Boolean((conferencePass(state, faction, owner) || state.grand?.passes.some(({ from, to, expires, kind }) => kind === "pass" && expires > state.turn
    && !isHostile(state, faction, owner) && (from === faction && to === owner || from === owner && to === faction))
    ) && !state.cities[key].occupation && !warBlockaded(state, key));
}

export function crossesGate(state, faction, from, to, finalAssault = false) {
  if (!state.grand || finalAssault) return true;
  const edge = [from, to].sort().join(":");
  const gate = crossings.find(({ key }) => key === edge);
  return !gate || gateOwner(state, gate) === faction || state.grand.closed[edge] !== gateOwner(state, gate);
}

export function openRoadEdge(state, faction, from, to, finalAssault = false, mode = "land") {
  return crossesGate(state, faction, from, to, finalAssault) && weatherAllows(state, from, to, mode);
}

export function configureGate(state, key, closed) {
  const gate = crossings.find((item) => item.key === key);
  if (!state.grand || gameOutcome(state) !== "ongoing" || !gate || gateOwner(state, gate) !== state.player) {
    throw new Error("只有控制关隘所在城池的势力可以调整通行。");
  }
  const rules = { ...state.grand.closed };
  if (closed) rules[key] = state.player;
  else delete rules[key];
  return { ...state, grand: { ...state.grand, closed: rules } };
}

export function dispatchRoute(world, state, faction, to) {
  if (!Object.values(state.cities).some(({ owner }) => owner === faction)) return null;
  const from = firstCity(world, state, faction);
  const usable = (key) => hasPassage(state, faction, key) && !warBlockaded(state, key)
    && (!state.cities[key].occupation || key === to);
  if (!usable(from) || !usable(to)) return null;
  return roadPath(graph(world), from, to, usable, 8, (a, b) => openRoadEdge(state, faction, a, b));
}

const validBudgets = ({ treasury, grain }) => bounded(treasury, 0, 300) && bounded(grain, 0, 450);
export const validGrandNational = (value) => value && validBudgets(value) && bounded(value.reserve, 0, 3000);
export const validDistrict = (value) => value && validBudgets(value) && Object.hasOwn(grandPriorities, value.focus)
  && (value.depot === null || typeof value.depot === "string");

export function saveGrandNational(state, draft) {
  if (!state.grand || gameOutcome(state) !== "ongoing" || !validGrandNational(draft)) {
    throw new Error("请输入有效的每季调度上限及储粮底线。");
  }
  const { treasury, grain, reserve } = draft;
  return { ...state, grand: { ...state.grand, national: { treasury, grain, reserve } } };
}

const estates = (world, state, faction, region) => world.cities.filter(({ key, region: area }) => area === region && state.cities[key].owner === faction);

export function saveDistrict(world, state, region, draft) {
  const cities = estates(world, state, state.player, region);
  if (!state.grand || gameOutcome(state) !== "ongoing" || !cities.length
    || (draft && (!validDistrict(draft) || (draft.depot && !cities.some(({ key }) => key === draft.depot))))) {
    throw new Error("请选择本方州郡、调度额度及有效粮仓。");
  }
  const districts = { ...state.grand.districts };
  const id = provinceKey(state.player, region);
  if (draft) districts[id] = { ...draft };
  else delete districts[id];
  return { ...state, grand: { ...state.grand, districts } };
}

export function districtStatus(world, state, faction = state.player) {
  const regions = [...new Set(world.cities.filter(({ key }) => state.cities[key].owner === faction).map(({ region }) => region))];
  return regions.map((region) => {
    const cities = estates(world, state, faction, region);
    const program = state.grand?.districts[provinceKey(faction, region)];
    const site = cities.find(({ key }) => key === program?.depot);
    return { region, cities, program, site, route: site && dispatchRoute(world, state, faction, site.key),
      pending: cities.filter(({ key }) => Boolean(state.cities[key].occupation)).length,
      frontier: cities.filter(({ links }) => links.some((key) => isHostile(state, faction, state.cities[key].owner))).length };
  });
}

function npcDistricts(world, state, faction) {
  const agenda = state.grand.agendas[faction];
  if (!agenda || agenda.kind === "expand") return [];
  return districtStatus(world, state, faction).filter(({ cities, frontier }) => cities.length >= 2 && frontier)
    .sort((a, b) => b.pending - a.pending).slice(0, 1).map((row) => ({
      ...row, program: { focus: agenda.kind === "restore" ? "recovery" : "defense", grain: 18, treasury: 6 }, route: null,
    }));
}

export function administerDistricts(world, state, faction, entries) {
  const player = faction === state.player;
  const stock = state.factions[faction];
  const domestic = player ? state.grand.national : { treasury: 6, grain: 18, reserve: 55 };
  const reserve = realmReserve(state, faction);
  let money = Math.max(0, Math.min(domestic.treasury, stock.treasury - reserve.treasury));
  let grain = Math.max(0, Math.min(domestic.grain, stock.grain - Math.max(domestic.reserve, reserve.grain)));
  const rows = player ? districtStatus(world, state, faction).filter(({ program }) => program) : npcDistricts(world, state, faction);
  rows.sort((a, b) => Number(b.pending > 0) - Number(a.pending > 0) || b.frontier - a.frontier);
  for (const { region, cities, program, site, route } of rows) {
    let cash = Math.min(money, program.treasury);
    let wheat = Math.min(grain, program.grain);
    const note = [];
    if (program.depot && !route) note.push("粮路受阻");
    if (route && cash > 0 && wheat > 0) {
      const weight = route.length - 1 + route.slice(1).filter((key, index) => roadTerrain(route[index], key)).length;
      const fee = Math.max(1, Math.ceil(weight / 2));
      const convoy = Math.min(Math.floor(wheat * (program.focus === "growth" ? .8 : .55)) - weight, 300 - (state.grand.depots[site.key] ?? 0));
      if (convoy > 0 && cash >= fee) {
        cash -= fee;
        wheat -= convoy + weight;
        state.grand.depots[site.key] = (state.grand.depots[site.key] ?? 0) + convoy;
        note.push(cityName(world, site.key) + "入仓 " + convoy + " 粮" + (weight ? "（运耗 " + weight + "）" : ""));
      }
    }
    const units = [...cities].sort((a, b) => {
      const one = state.cities[a.key], two = state.cities[b.key];
      return program.focus === "recovery" ? two.occupation - one.occupation : one.troops - two.troops;
    });
    for (const { key, links } of units) {
      const city = state.cities[key], families = state.realm.cities[key];
      if (warBlockaded(state, key)) continue;
      if (program.focus === "recovery" && cash >= 6 && wheat >= 8 && (city.occupation || families.welfare < 68)) {
        cash -= 6;
        wheat -= 8;
        families.welfare = Math.min(100, families.welfare + 9);
        if (city.occupation && city.troops >= 400) city.occupation -= 1;
        note.push(cityName(world, key) + "获赈济");
      }
      if (program.focus === "defense" && cash >= 6 && wheat >= 6 && !city.occupation && city.troops < 1300
        && families.population >= 1020 && links.some((way) => isHostile(state, faction, state.cities[way].owner))) {
        cash -= 6;
        wheat -= 6;
        city.troops += 220;
        families.population -= 220;
        note.push(cityName(world, key) + "补充 220 驻军");
      }
      if (program.focus === "growth" && cash >= 12 && !city.occupation && city.governor && city.farming < 3) {
        cash -= 12;
        city.farming += 1;
        note.push(cityName(world, key) + "扩建屯田");
      }
    }
    const paid = Math.min(money, program.treasury) - cash;
    const delivered = Math.min(grain, program.grain) - wheat;
    money -= paid;
    grain -= delivered;
    stock.treasury -= paid;
    stock.grain -= delivered;
    if (note.length && player) entries.push({ type: "grand", faction, city: site?.key ?? cities[0].key,
      text: region + " · " + note.join("、") + "。本季拨 " + paid + " 钱、" + delivered + " 粮。" });
  }
}
