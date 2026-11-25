export const polityColors = ["#b47741", "#26756a", "#826364", "#547434", "#406888", "#994978", "#a68532", "#596a86"];
export const settlementKinds = { peace: "战后议和", protection: "保护协定", union: "归附合并" };
export const provincePolicies = { relief: "轻徭赈济", guard: "安集守备", trade: "恢复商路" };
export const archiveSymbols = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const maximumPolities = 18;
export const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
export const plain = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
export const livingSide = (state, faction) => Object.values(state.cities).some(({ owner }) => owner === faction);
export const provinceKey = (faction, region) => faction + ":" + region;

export function allegianceAt(state, person, turn = state.turn) {
  const record = state.polity?.allegiances[person];
  if (!record?.length) return undefined;
  let faction = record[0].from;
  for (const { to, turn: changed } of record) {
    if (changed > turn) break;
    faction = to;
  }
  return faction;
}

export function polityEra(base, state, turn = state.turn) {
  const history = state.polity;
  if (!history || (!history.parties?.length && !Object.keys(history.allegiances ?? {}).length)) return base;
  const additions = (history.parties ?? []).map(({ key, name, city, position, leader, cause }) => ({
    key, name, position, path: "", stats: [0, 0, 50], trait: cause === "uprising" ? "乡民推举" : cause === "independence" ? "州郡自立" : "地方建政", city, leader,
  }));
  const founders = additions.map(({ key, leader, name, city }) => ({
    key: leader, faction: key, home: city, name: name + "推举的主将", governance: 73, command: 78,
  }));
  const officers = [...base.officers, ...founders].map((officer) => {
    const faction = allegianceAt(state, officer.key, turn);
    return faction && faction !== officer.faction ? { ...officer, faction } : officer;
  });
  return { ...base, factions: [...base.factions, ...additions], officers,
    capitals: { ...base.capitals, ...Object.fromEntries(additions.map(({ key, city }) => [key, city])) },
    emergent: additions.map(({ key }) => key) };
}

export function encodeTerritory(world, state) {
  const keys = Object.keys(state.factions);
  return world.cities.map(({ key }) => archiveSymbols[keys.indexOf(state.cities[key].owner)]).join("");
}

export function territoryAt(world, state, turn) {
  const frame = state.polity?.atlas.find((record) => record.turn === turn);
  if (!frame) return null;
  const keys = Object.keys(state.factions);
  return Object.fromEntries(world.cities.map(({ key }, index) => [key, keys[archiveSymbols.indexOf(frame.map[index])]]));
}

export function protectionBetween(state, a, b) {
  return state.polity?.protections.find(({ ward, patron, expires }) => expires > state.turn && livingSide(state, ward) && livingSide(state, patron)
    && ((ward === a && patron === b) || (ward === b && patron === a)));
}

export function formerlyServed(state, person, faction) {
  return Boolean(state.polity?.allegiances[person]?.some(({ from, to }) => from === faction || to === faction));
}
