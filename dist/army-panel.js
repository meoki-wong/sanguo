import { armyByOfficer, armyPhases, armyStatus, commandArmy, marchRoute, mobilizationQuote, shippingCost, supplyRoute, withdrawalRoute } from "./armies.js";
import { availableAttackers, cityName, cityReserve, eraByYear, factionName, gameOutcome, minimumMarch, queueOrder, seasonOrderLimit } from "./engine.js";
import { officerSkill } from "./campaign.js";
import { militaryView, visibleArmy } from "./war-intel.js";
import { stances } from "./war-operations.js";

const number = new Intl.NumberFormat("zh-CN");

export function createArmyPanel(world, { snapshot, commit, locate }) {
  const find = (id) => document.getElementById(id);
  const dialog = find("army-dialog");
  let pane = "roster";
  let instruction;

  function feedback(message = "") {
    const info = find("army-feedback");
    info.textContent = message;
    info.hidden = !message;
  }

  function select(id, options, preferred = find(id).value) {
    const input = find(id);
    input.replaceChildren(...options.map(([key, label]) => new Option(label, key)));
    if (options.some(([key]) => key === preferred)) input.value = preferred;
    return input.value;
  }

  function describeRoute(route) {
    return route.map((key) => cityName(world, key)).join(" → ");
  }

  function drawFormationOrigins(preferred) {
    const { state, planned } = snapshot();
    const era = eraByYear(world, state);
    const cities = world.cities.filter(({ key }) => planned.cities[key].owner === state.player && !planned.cities[key].occupation
      && planned.cities[key].troops >= cityReserve + minimumMarch && availableAttackers(era, planned, state.player, key).length);
    select("army-origin", cities.map(({ key, name }) => [key, name]), preferred);
    drawFormationFields(true);
  }

  function drawFormationFields(resetTroops = false) {
    const { state, planned } = snapshot();
    const era = eraByYear(world, state);
    const from = find("army-origin").value;
    find("army-stance").hidden = find("army-stance-label").hidden = !state.war;
    if (state.war) select("army-stance", Object.entries(stances), find("army-stance").value || "assault");
    const rivals = world.cities.map(({ key, name }) => ({ key, name, route: marchRoute(world, planned, state.player, from, key) }))
      .filter(({ route }) => route).sort((a, b) => a.route.length - b.route.length);
    select("army-target", rivals.map(({ key, name }) => [key, name]));
    const officers = availableAttackers(era, planned, state.player, from)
      .sort((a, b) => officerSkill(planned, b, "command") - officerSkill(planned, a, "command"));
    select("army-leader", officers.map((officer) => [officer.key, officer.name + " · 统率 " + officerSkill(planned, officer, "command")]));
    const input = find("army-troops");
    const maximum = Math.max(0, (planned.cities[from]?.troops ?? 0) - cityReserve);
    input.max = maximum;
    if (resetTroops || input.valueAsNumber > maximum || !input.value) input.value = maximum ? Math.min(1200, maximum) : "";
    updateEstimate();
  }

  function readFormation() {
    const stance = snapshot().state.war ? find("army-stance").value : "";
    return { type: "mobilize", from: find("army-origin").value, to: find("army-target").value,
      officer: find("army-leader").value, troops: find("army-troops").valueAsNumber, ...(stance ? { stance } : {}) };
  }

  function updateEstimate() {
    feedback();
    const { state, planned } = snapshot();
    const order = readFormation();
    const estimate = find("army-formation-estimate");
    const routeText = find("army-formation-route");
    const submit = find("queue-army");
    submit.disabled = true;
    const route = marchRoute(world, planned, state.player, order.from, order.to);
    routeText.textContent = route ? describeRoute(route) : "";
    routeText.hidden = !route;
    try {
      if (!order.from) throw new Error("暂无可集结的城池。需要驻地有可领兵武将，并能保留 250 名守军。");
      const result = mobilizationQuote(world, militaryView(planned), state.player, order);
      const { quarters, carried, ration, leave, battle } = result;
      estimate.textContent = `预计 ${quarters} 季${order.stance && order.stance !== "assault" ? "到位" : "交战"} · 随军粮 ${carried} · 至交战耗粮 ${ration * (quarters - 1)} · 留守 ${number.format(leave)} · ${state.war ? "战力估计" : "当前战力"} ${number.format(battle.offense)} / ${number.format(battle.defense)}`;
      if (state.orders.length >= seasonOrderLimit) estimate.textContent += " · 队列已满";
      submit.disabled = gameOutcome(state) !== "ongoing" || state.orders.length >= seasonOrderLimit;
    } catch (error) {
      estimate.textContent = error.message;
    }
  }

  function drawRoster(preferred) {
    const { state } = snapshot();
    const era = eraByYear(world, state);
    const officers = new Map(era.officers.map(({ key, name }) => [key, name]));
    const armies = [...(militaryView(state).armies ?? [])].sort((a, b) => Number(b.faction === state.player) - Number(a.faction === state.player));
    const current = find("army-current");
    const active = select("army-picker", armies.map((army) => [army.officer, officers.get(army.officer) + "军团 · "
      + factionName(era, army.faction)]), preferred);
    find("army-empty").hidden = !!active;
    current.hidden = !active || Boolean(instruction);
    find("army-instructions").hidden = !instruction;
    if (!active) return;
    const army = visibleArmy(state, state.player, active);
    const { supply, ration, reserveSeasons, routeClosed } = army.observed ? {} : armyStatus(world, state, army);
    const strength = army.observed ? army.troopRange.map((count) => number.format(count)).join("–") : number.format(army.troops);
    find("army-summary").textContent = (army.observed ? "袭报" : armyPhases[army.phase]) + " · " + cityName(world, army.location) + " · " + strength + " 人";
    const supplyLine = find("army-supply");
    supplyLine.dataset.cut = String(!army.observed && !supply);
    supplyLine.textContent = army.observed ? "第 " + army.seen + " 季观察，随军粮未核实。" : (supply ? "补给通畅 · " + cityName(world, army.depot) : "补给中断 · 原仓 " + cityName(world, army.depot))
      + ` · 随军粮 ${army.grain}（${reserveSeasons} 季） · 每季 ${ration}`
      + (supply && state.realm ? " · 运耗 " + shippingCost(world, state, army, supply) : "");
    find("army-route").textContent = (army.observed ? "行军路线未掌握" : describeRoute(army.route))
      + (routeClosed ? " · 原路线已中断" : "") + (army.engagement ? " · 围城第 " + army.engagement.quarters + " 季" : "");
    const own = army.faction === state.player && gameOutcome(state) === "ongoing";
    find("army-hold").hidden = !own || ["hold", "secured"].includes(army.phase);
    find("army-reroute").hidden = !own;
    find("army-retreat").hidden = !own;
    find("army-garrison").hidden = !own || state.cities[army.location].owner !== army.faction;
  }

  function showPane(next) {
    pane = next;
    instruction = undefined;
    feedback();
    for (const button of find("army-panes").querySelectorAll("button")) {
      button.setAttribute("aria-pressed", button.dataset.armyPane === pane);
    }
    find("army-roster").hidden = pane !== "roster";
    find("army-formation").hidden = pane !== "formation";
    if (pane === "formation") drawFormationOrigins(snapshot().selected);
    else drawRoster();
  }

  function orderRoute() {
    const { state } = snapshot();
    const army = armyByOfficer(state, find("army-picker").value);
    const target = find("army-new-target").value;
    const depot = find("army-new-depot").value;
    if (!army || !target) return null;
    if (instruction === "retreat") return withdrawalRoute(world, state, army, target);
    return depot && supplyRoute(world, state, army, depot) && marchRoute(world, state, army.faction, army.location, target);
  }

  function updateInstruction() {
    feedback();
    const route = orderRoute();
    const { state } = snapshot();
    const army = armyByOfficer(state, find("army-picker").value);
    const depot = find("army-new-depot").value;
    const supply = route && army && instruction === "march" && supplyRoute(world, state, army, depot);
    find("confirm-army-instructions").disabled = !route;
    find("army-instruction-route").textContent = route ? describeRoute(route)
      + (state.realm && supply ? " · 运粮 " + describeRoute(supply) + " · 运耗 " + shippingCost(world, state, army, supply) : "")
      : "当前没有符合条件的道路。";
  }

  function showInstruction(type) {
    const { state } = snapshot();
    const army = armyByOfficer(state, find("army-picker").value);
    if (!army) return;
    instruction = type;
    const withdrawing = type === "retreat";
    find("army-new-stance").hidden = find("army-new-stance-label").hidden = withdrawing || !state.war;
    if (state.war && !withdrawing) select("army-new-stance", Object.entries(stances), army.stance ?? "assault");
    const reachable = world.cities.map(({ key, name }) => ({ key, name, route: withdrawing ? withdrawalRoute(world, state, army, key)
      : marchRoute(world, state, army.faction, army.location, key) })).filter(({ route }) => route)
      .sort((a, b) => a.route.length - b.route.length);
    select("army-new-target", reachable.map(({ key, name }) => [key, name]), withdrawing ? "" : army.target);
    const depots = world.cities.filter(({ key }) => supplyRoute(world, state, army, key));
    select("army-new-depot", depots.map(({ key, name }) => [key, name]), army.depot);
    find("army-new-depot").hidden = withdrawing;
    find("army-new-depot-label").hidden = withdrawing;
    find("army-new-target-label").textContent = withdrawing ? "撤往" : "攻城目标";
    find("army-instruction-label").textContent = withdrawing ? "沿己方道路撤回，抵达后归入驻军。" : "更换目标或粮仓，随后按新路线续进。";
    drawRoster();
    updateInstruction();
    find("army-new-target").focus();
  }

  function send(order, message) {
    try {
      const { state } = snapshot();
      commit(commandArmy(world, state, find("army-picker").value, order), message);
      showPane("roster");
    } catch (error) { feedback(error.message); }
  }

  for (const button of find("army-panes").querySelectorAll("button")) {
    button.addEventListener("click", () => showPane(button.dataset.armyPane));
  }
  find("army-picker").addEventListener("change", () => { feedback(); drawRoster(); });
  find("army-origin").addEventListener("change", () => drawFormationFields(true));
  for (const id of ["army-target", "army-leader", "army-troops", "army-stance"]) find(id).addEventListener("input", updateEstimate);
  find("army-formation").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      commit(queueOrder(world, snapshot().state, readFormation()), "已将军团集结令加入政令队列。");
      dialog.close();
    } catch (error) { feedback(error.message); }
  });
  find("army-hold").addEventListener("click", () => send({ type: "hold" }, "军团已奉命固守。"));
  find("army-garrison").addEventListener("click", () => send({ type: "garrison" }, "军团已归入驻军。"));
  find("army-reroute").addEventListener("click", () => showInstruction("march"));
  find("army-retreat").addEventListener("click", () => showInstruction("retreat"));
  find("cancel-army-instructions").addEventListener("click", () => showPane("roster"));
  find("army-locate").addEventListener("click", () => {
    const { state } = snapshot();
    const army = visibleArmy(state, state.player, find("army-picker").value);
    if (army) locate(army.location);
  });
  for (const id of ["army-new-target", "army-new-depot"]) find(id).addEventListener("change", updateInstruction);
  find("army-instructions").addEventListener("submit", (event) => {
    event.preventDefault();
    const stance = instruction === "march" && snapshot().state.war ? find("army-new-stance").value : null;
    send({ type: instruction, target: find("army-new-target").value, depot: find("army-new-depot").value, ...(stance ? { stance } : {}) },
      instruction === "retreat" ? "已下令撤军。" : "已按新路线下令。");
  });

  return {
    open(officer) {
      showPane(snapshot().state.armies?.length ? "roster" : "formation");
      if (officer && pane === "roster") drawRoster(officer);
      dialog.showModal();
    },
  };
}
