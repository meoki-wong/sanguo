import { eraByYear, firstCity, gameOutcome, previewOrders } from "./engine.js";
import { knownOfficer } from "./personnel.js";

export function recruitmentChoices(world, state, faction = state.player) {
  const stock = faction === state.player ? previewOrders(world, state).factions[faction] : state.factions[faction];
  return eraByYear(world, state).officers.filter((person) => person.faction === faction && !knownOfficer(state, person))
    .map((person) => ({ person, ready: state.turn >= person.reserve.turn && stock.treasury >= person.reserve.fee }));
}

function sign(state, candidate, city) {
  state.recruitedOfficers = [...(state.recruitedOfficers ?? []), candidate.key];
  state.stations[candidate.key] = city;
  state.factions[candidate.faction].treasury -= candidate.reserve.fee;
}

export function recruitOfficer(world, state, key, city) {
  if (gameOutcome(state) !== "ongoing" || state.cities[city]?.owner !== state.player || state.cities[city].occupation) {
    throw new Error("请选择已完成整顿的己方驻地。");
  }
  const choice = recruitmentChoices(world, state).find(({ person }) => person.key === key);
  if (!choice?.ready) throw new Error("当前还无法招揽此人。");
  const next = structuredClone(state);
  sign(next, choice.person, city);
  previewOrders(world, next);
  return next;
}

export function recruitRivals(world, era, state) {
  if (state.turn < 12 || state.turn % 3) return [];
  return era.factions.flatMap(({ key }) => {
    if (key === state.player || state.factions[key].treasury < 80 || !Object.values(state.cities).some((hold) => hold.owner === key)) return [];
    const city = firstCity(world, state, key);
    const choice = recruitmentChoices(world, state, key).find(({ ready }) => ready);
    if (!choice || state.cities[city].occupation) return [];
    sign(state, choice.person, city);
    return [{ type: "recruit-officer", faction: key, city, text: choice.person.name + "接受招揽，已入仕。" }];
  });
}
