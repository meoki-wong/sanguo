import {
  availableAttackers, cityReserve, describeOrder, firstCity, forecastAttack, projects,
  recruitment, validateOrder,
} from "./engine.js";

export function legalChoices(world, era, state, faction) {
  const owned = world.cities.filter(({ key }) => state.cities[key].owner === faction);
  const frontier = owned.filter(({ links }) => links.some((key) => state.cities[key].owner !== faction));
  const pressure = ({ links }) => Math.max(0, ...links.filter((key) => state.cities[key].owner !== faction).map((key) => state.cities[key].troops));
  const exposed = [...frontier].sort((a, b) => pressure(b) - pressure(a))[0];
  const trading = [...owned].sort((a, b) => state.cities[b.key].commerce - state.cities[a.key].commerce)[0];
  const centers = [...new Set([firstCity(world, state, faction), exposed?.key, trading?.key].filter(Boolean))];
  const choices = [{ order: null, text: "休整，保留本季钱粮" }];

  function add(order, effect) {
    try {
      validateOrder(world, state, faction, order);
      choices.push({ order, text: describeOrder(world, era, order) + "，" + effect });
    } catch {
      // Candidate orders are checked by the same rules as player orders.
    }
  }

  const benefits = { farming: "每季粮食+4", commerce: "每季税收+3", defense: "城防+1级" };
  for (const city of centers) {
    for (const [project, rule] of Object.entries(projects)) {
      add({ type: "build", city, project }, "耗钱" + rule.cost + "，" + benefits[project]);
    }
  }
  for (const city of [...new Set([exposed?.key, centers[0]].filter(Boolean))]) {
    add({ type: "recruit", city }, "增兵" + recruitment.troops + "，耗钱" + recruitment.treasury + "、耗粮" + recruitment.grain);
  }

  const attacks = [];
  for (const city of frontier) {
    const troops = Math.min(state.cities[city.key].troops - cityReserve, state.factions[faction].grain * 100);
    if (troops < 200) continue;
    const officer = availableAttackers(era, state, faction, city.key).sort((a, b) => b.command - a.command)[0];
    if (!officer) continue;
    for (const target of city.links) {
      if (state.cities[target].owner === faction) continue;
      const order = { type: "attack", from: city.key, to: target, troops, officer: officer.key };
      const battle = forecastAttack(era, state, order, faction);
      attacks.push({ order, battle, strength: battle.offense / Math.max(1, battle.defense) });
    }
  }
  for (const { order, battle } of attacks.sort((a, b) => b.strength - a.strength).slice(0, 4)) {
    add(order, "耗粮" + battle.grain + "，攻守战力" + battle.offense + "/" + battle.defense);
  }
  return choices.map((choice, index) => ({ ...choice, id: String(index) }));
}
