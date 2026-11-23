import { cityName, firstCity, gameOutcome } from "./engine.js";
import { armyPhases, commandArmy, marchRoute, supplyRoute, withdrawalRoute } from "./armies.js";
import { configureGate, crossings, gateOwner } from "./grand-logistics.js";
import { cancelConvoy, commodities, orderBridge, prepareConvoy, quoteConvoy, regionalPolicies, setRegionalPolicy } from "./landscape-economy.js";
import { edgeWeather, seasonWeather, travelModes } from "./landscape-terrain.js";
import { visibleArmy } from "./war-intel.js";

function button(label, action, disabled = false) {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  node.disabled = disabled;
  node.onclick = action;
  return node;
}

function field(label, id, input) {
  const wrapper = document.createElement("label");
  wrapper.append(document.createTextNode(label), input);
  input.id = id;
  return wrapper;
}

function select(rows, current) {
  const input = document.createElement("select");
  input.append(...rows.map(([key, label]) => new Option(label, key)));
  if (rows.some(([key]) => key === current)) input.value = current;
  return input;
}

export function createLandscapeMap(world, { snapshot, commit, redraw, showCities }) {
  const root = document.getElementById("map-landscape-command");
  const shell = root.closest(".map-panel");
  const title = root.querySelector("strong");
  const brief = root.querySelector(".landscape-brief");
  const actions = root.querySelector(".map-command-actions");
  const fields = root.querySelector(".landscape-fields");
  const notice = root.querySelector(".landscape-notice");
  const back = root.querySelector(".landscape-back");
  const town = (key) => cityName(world, key);
  let current = null;
  let picking = null;
  let preview;

  function close() {
    if (!current) return;
    current = picking = null;
    preview = undefined;
    root.hidden = true;
    delete shell.dataset.mapCommand;
    redraw();
  }

  function act(operation, label) {
    try {
      const state = operation();
      const stay = current;
      commit(state, label);
      if (current === stay) render();
    } catch (error) {
      notice.hidden = false;
      notice.dataset.problem = "true";
      notice.textContent = error.message;
    }
  }

  function pickCity(label, paths, chosen) {
    if (paths.size === 0) {
      notice.textContent = "本季没有可选的城池，请检查补给与道路。";
      notice.dataset.problem = "true";
      notice.hidden = false;
      return;
    }
    showCities();
    picking = { paths, chosen };
    render();
    const input = select([["", "选择城池"], ...[...paths.keys()].map((key) => [key, town(key)])]);
    input.onchange = () => pick(input.value);
    brief.textContent = label;
    fields.append(field("地图上点选", "landscape-destination", input));
    redraw();
  }

  function pick(key) {
    if (!picking) return false;
    if (picking.paths.has(key)) {
      const { chosen } = picking;
      picking = null;
      chosen(key);
      render();
    }
    return true;
  }

  function renderArmy(state, era, ongoing) {
    const army = visibleArmy(state, state.player, current.key);
    if (!army) { close(); return; }
    const own = army.faction === state.player;
    title.textContent = (era.officers.find(({ key }) => key === army.officer)?.name ?? "") + "军团";
    if (!own) {
      brief.textContent = town(army.location) + " · 估计 " + army.troopRange.join("–") + " 兵 · " + Math.max(0, state.turn - army.seen) + " 季前";
      return;
    }
    const route = supplyRoute(world, state, army);
    preview = route?.length > 1 ? route : army.route;
    brief.textContent = armyPhases[army.phase] + " · " + town(army.location) + " · " + army.troops + " 兵 · 粮 " + army.grain
      + " · 军械 " + (army.equipment ?? 0) + (route ? " · 粮仓 " + town(army.depot) : " · 断粮");
    if (picking || !ongoing) return;
    const command = (order, label) => act(() => commandArmy(world, snapshot().state, army.officer, order), label);
    const choices = (map) => new Map(world.cities.flatMap(({ key }) => {
      const path = map(key);
      return path ? [[key, path]] : [];
    }));
    const march = (mode) => pickCity("点亮的敌城可以" + travelModes[mode] + "出征",
      choices((key) => marchRoute(world, state, army.faction, army.location, key, mode)),
      (target) => command({ type: "march", target, travel: mode, depot: army.depot }, "军团已接到出征令。"));
    actions.append(
      button("固守", () => command({ type: "hold" }, "军团就地固守。"), army.phase === "hold"),
      button("陆路改令", () => march("land")),
      button("水路改令", () => march("water")),
      button("换粮仓", () => pickCity("点选新的补给城", choices((key) => supplyRoute(world, state, army, key)),
        (depot) => command({ type: "supply", depot }, "军团已改用新粮仓。"))),
      button("撤回", () => pickCity("点选撤往的己方城池", choices((key) => withdrawalRoute(world, state, army, key)),
        (target) => command({ type: "retreat", target }, "军团开始撤回。"))),
      button("驻入城池", () => command({ type: "garrison" }, "军团已驻入城池。"), state.cities[army.location].owner !== army.faction),
    );
  }

  function renderGate(state, ongoing) {
    const gate = crossings.find(({ key }) => key === current.key);
    const hazard = edgeWeather(state, gate.seat, gate.to);
    const closed = state.grand.closed[gate.key] === gateOwner(state, gate);
    const repair = state.landscape.repairs.includes(gate.key);
    const own = gateOwner(state, gate) === state.player;
    title.textContent = gate.name;
    preview = [gate.seat, gate.to];
    brief.textContent = town(gate.seat) + " → " + town(gate.to) + " · " + hazard.label + " · " + (closed ? "军管" : "开放")
      + (repair ? " · 待整修" : state.landscape.bridges[gate.key] ? " · 已加固" : "");
    actions.append(
      button(closed ? "解除封控" : "封控关隘", () => act(() => configureGate(snapshot().state, gate.key, !closed), "关隘通行状态已更新。"), !ongoing || !own),
      button("整修 · 24 钱 8 粮", () => act(() => orderBridge(snapshot().state, gate.key), "已列入本季修复令。"), !ongoing || !own || repair || Boolean(state.landscape.bridges[gate.key])),
      button("安排粮运", () => open("convoy", { from: gate.seat, to: gate.to }), !own || !ongoing),
    );
  }

  function renderConvoy(state, ongoing) {
    const row = current.id && state.landscape.convoys.find(({ id }) => id === current.id);
    const from = current.from || row?.from || firstCity(world, state);
    const to = current.to || row?.to;
    title.textContent = to ? town(from) + " → " + town(to) : town(from) + "粮运";
    const depot = state.grand.depots[from] ?? 0;
    brief.textContent = "粮仓 " + depot + " / 300 · 军械 " + (state.landscape.equipment[from] ?? 0)
      + (row ? " · " + ({ queued: "待发", delivered: "已入库", blocked: "受阻", cancelled: "已取消" }[row.status]) : "");
    if (picking || !ongoing) return;
    if (row) preview = row.route;
    if (row?.status === "queued") {
      actions.append(button("取消运输", () => act(() => cancelConvoy(snapshot().state, row.id), "已取消待发运输。")));
      return;
    }
    if (state.cities[from].owner !== state.player) return;
    const cargo = select(Object.entries(commodities), current.cargo);
    const mode = select(Object.entries(travelModes), current.mode);
    const count = document.createElement("input");
    Object.assign(count, { type: "number", min: 1, max: 200, value: current.amount ?? 20, inputMode: "numeric" });
    const request = () => ({ faction: state.player, from, to, mode: mode.value, cargo: cargo.value, amount: count.valueAsNumber });
    const submit = button("安排本季运输", () => act(() => prepareConvoy(world, snapshot().state, request()), "已安排本季运输。"));
    const update = () => {
      Object.assign(current, { cargo: cargo.value, mode: mode.value, amount: count.valueAsNumber });
      const quote = to && quoteConvoy(world, state, request());
      preview = quote?.route;
      submit.disabled = !quote?.affordable;
      const via = quote?.route.slice(1, -1).map(town);
      notice.dataset.problem = String(!quote?.affordable);
      notice.textContent = quote ? "运费 " + quote.freight + " 钱 · 可用 " + quote.source + " · 目的城可收 " + quote.capacity
        + (via.length ? " · 经" + via.join("、") : "")
        : to ? "其间没有可通行的" + travelModes[mode.value] + "。" : "";
      notice.hidden = !notice.textContent;
      redraw();
    };
    fields.append(field("货物", "map-convoy-cargo", cargo), field("运法", "map-convoy-mode", mode), field("数量", "map-convoy-count", count));
    for (const input of [cargo, mode, count]) input.oninput = update;
    const destinations = () => new Map(world.cities.flatMap(({ key }) => {
      const quote = quoteConvoy(world, state, { ...request(), to: key, amount: 1 });
      return quote ? [[key, quote.route]] : [];
    }));
    actions.append(button("点选目的城", () => pickCity("点选可达城池 · " + travelModes[mode.value], destinations(), (key) => { current.to = key; })), submit);
    update();
  }

  function renderPolicy(state, ongoing) {
    const { region } = world.cities.find(({ key }) => key === current.key);
    title.textContent = region + " · 经营方针";
    brief.textContent = "工坊每季 5 钱 · 赈济每季 4 钱 5 粮 · 互市需要通畅商路";
    const value = select([["", "随国策"], ...Object.entries(regionalPolicies)], state.landscape.policies[state.player]?.[region]);
    fields.append(field("州郡方针", "map-landscape-policy", value));
    actions.append(button("颁行", () => act(() => setRegionalPolicy(world, snapshot().state, region, value.value), "州郡方针已生效。"), !ongoing));
  }

  function render() {
    if (!current) return;
    const { state, era } = snapshot();
    if (!state.landscape) { close(); return; }
    root.hidden = false;
    shell.dataset.mapCommand = picking ? "pick" : "edit";
    back.textContent = picking ? "返回" : "收起";
    notice.hidden = true;
    delete notice.dataset.problem;
    fields.replaceChildren();
    actions.replaceChildren();
    const ongoing = gameOutcome(state) === "ongoing";
    if (current.type === "army") renderArmy(state, era, ongoing);
    if (current.type === "gate") renderGate(state, ongoing);
    if (current.type === "convoy") renderConvoy(state, ongoing);
    if (current.type === "policy") renderPolicy(state, ongoing);
    redraw();
  }

  function open(type, key) {
    current = typeof key === "object" ? { ...key, type } : { type, key };
    picking = null;
    preview = undefined;
    render();
  }
  back.onclick = () => {
    if (!picking) close();
    else {
      picking = null;
      render();
    }
  };
  document.addEventListener("keydown", (event) => {
    if (current && event.key === "Escape" && !event.defaultPrevented && !document.querySelector("dialog[open]")) back.click();
  });
  return { open, close, pick, weather() { return seasonWeather(snapshot().state); }, sync() { if (!picking) render(); },
    overlay() { return !current ? null : picking ? { picking: true, targets: new Set(picking.paths.keys()) }
      : preview?.length ? { from: preview[0], to: preview.at(-1), type: "transfer", route: preview } : null; } };
}
