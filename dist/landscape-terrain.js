import { roadTerrain } from "./war-intel.js";

export const travelModes = { land: "陆路", water: "水运" };
export const edgeKey = (a, b) => [a, b].sort().join(":");
const waterways = new Set(["jiangxia:lujiang", "chaisang:lujiang", "lujiang:moling", "moling:shanyin", "moling:wu"]);

const weatherNames = {
  spring: ["春雨", "河水上涨，部分渡口受限。"],
  summer: ["夏汛", "江河涨水，洪峰可能封断渡口。"],
  autumn: ["秋晴", "风浪平息，水陆运输恢复。"],
  winter: ["冬雪", "山口积雪，陆运费增加。"],
};

export function seasonWeather(state) {
  const key = Object.keys(weatherNames)[state.turn % 4];
  const [name, description] = weatherNames[key];
  return { key, name, description };
}

export function edgeWeather(state, a, b) {
  const key = edgeKey(a, b);
  const terrain = roadTerrain(a, b) ?? (state.landscape && waterways.has(key) ? "river" : undefined);
  const clear = { terrain, blocked: false, cost: 0, label: terrain === "river" ? "江河" : terrain === "pass" ? "山道" : "平路" };
  if (!state.landscape || !terrain) return clear;
  const { key: season } = seasonWeather(state);
  const reinforced = state.landscape.bridges[key] > 0;
  const flood = terrain === "river" && season === "summer";
  const snow = terrain === "pass" && season === "winter";
  if (flood && !reinforced) {
    const crest = (Math.floor(state.turn / 4) + state.year + a.length + b.length) % 3 !== 0;
    return { ...clear, blocked: crest, cost: 2, label: crest ? "洪峰封渡" : "汛期涨水" };
  }
  if (snow && !reinforced) return { ...clear, cost: 3, label: "积雪难行" };
  if (terrain === "river" && season === "spring") return { ...clear, cost: reinforced ? 0 : 1, label: "春汛" };
  return clear;
}

export function weatherAllows(state, from, to, mode = "land") {
  if (!state.landscape) return mode === "land";
  const hazard = edgeWeather(state, from, to);
  if (mode === "land") return !hazard.blocked;
  return mode === "water" && hazard.terrain === "river"
    && (!hazard.blocked || waterways.has(edgeKey(from, to)) || (from.length + to.length) % 2 === 0);
}

export function routeWeather(state, route, mode = "land") {
  return (route ?? []).slice(1).reduce((fee, to, index) => {
    const hazard = edgeWeather(state, route[index], to);
    return fee + (mode === "water" ? Math.min(hazard.cost, 1) : hazard.cost);
  }, 0);
}
