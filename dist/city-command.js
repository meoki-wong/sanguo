import {
  appoint, availableAttackers, availableForPosting, cityName, cityReserve, factionName, forecastAttack, gameOutcome,
  minimumMarch, pendingExpedition, projects, queueOrder, recruitment, seasonOrderLimit, setGovernance, transferGrain,
  transferOfficer, transferRoutes, validateOrder,
} from "./engine.js";
import { armyCapacity, marchRoute, mobilizationQuote } from "./armies.js";
import { isHostile } from "./diplomacy.js";
import { knownOfficer } from "./personnel.js";
import { intelSummary, queueScout, scoutCost } from "./war-intel.js";
import { officerSkill } from "./campaign.js";
import { forceColor } from "./map.js";
import { travelModes, weatherAllows } from "./landscape-terrain.js";

const number = new Intl.NumberFormat("zh-CN");
const format = (value) => number.format(value);
const actionNames = { attack: "出征", transfer: "调兵", build: "建设", recruit: "征兵", appoint: "任命", delegate: "委任",
  scout: "侦察", convoy: "粮运", policy: "州郡", province: "州郡委任", battle: "会战", strategic: "战区", details: "详情" };
const roles = { governor: "太守", commander: "守将", station: "调驻" };
const governance = { direct: "收回委任", auto: "自主发展", farming: "屯田", commerce: "商贸", defense: "城防", recruit: "征兵" };
const methods = { attack: "本季直接进攻", assault: "军团强攻", siege: "军团围困", blockade: "军团封锁" };

export function createCityCommand(world, { snapshot, commit, showDetails, redraw, showCities, openLandscape, openBattle, openProvince, strategyAt, openStrategy }) {
  const get = (id) => document.getElementById("map-command-" + id);
  const root = document.getElementById("map-city-command");
  const panel = root.closest(".map-panel");
  const actions = get("actions");
  const fields = get("fields");
  const picker = get("target");
  let city;
  let phase;
  let action;
  let candidates = new Map();
  let selection;
  let movementDraft;
  const stage = panel.querySelector(".map-stage");
  const town = (key) => cityName(world, key);
  const sites = new Map(world.cities.map((entry) => [entry.key, entry]));

  function message(text = "") {
    get("message").textContent = text;
    get("message").hidden = !text;
  }

  function replaceOptions(select, entries, preferred) {
    select.replaceChildren(...entries.map(([key, label]) => new Option(label, key)));
    if (entries.some(([key]) => key === preferred)) select.value = preferred;
  }

  function field(key, label, input) {
    input.id = "map-command-" + key;
    const wrapper = document.createElement("label");
    wrapper.dataset.commandField = key;
    const text = document.createElement("span");
    text.textContent = label;
    wrapper.append(text, input);
    fields.append(wrapper);
    return input;
  }

  function selectField(key, label, rows, preferred) {
    const input = field(key, label, document.createElement("select"));
    replaceOptions(input, rows, preferred);
    return input;
  }

  function numberField(key, label, value, min, max) {
    const input = field(key, label, document.createElement("input"));
    input.type = "number";
    input.inputMode = "numeric";
    input.min = min;
    input.max = max;
    input.value = value;
    return input;
  }

  function show(next) {
    phase = next;
    panel.dataset.mapCommand = phase;
    root.hidden = false;
    actions.hidden = next !== "menu";
    get("pick").hidden = next !== "pick";
    get("form").hidden = next !== "edit";
    get("back").textContent = next === "menu" ? "收起" : "返回";
    get("title").tabIndex = -1;
    message();
    header();
    redraw();
  }

  function header() {
    const { state, era, planned } = snapshot();
    const holding = state.cities[city];
    const from = selection?.from;
    const to = selection?.to;
    get("title").textContent = phase === "edit" && from ? town(from) + " → " + town(to) : town(city);
    root.style.setProperty("--city-force", forceColor(holding.owner));
    const base = factionName(era, holding.owner);
    let brief = base + " · 驻军 " + intelSummary(state, state.player, city) + (holding.occupation ? " · 整顿中" : "");
    if (phase !== "menu" && action) brief = actionNames[action];
    else if (holding.owner === state.player) {
      const local = state.orders.filter(({ city: at, from, to }) => [at, from, to].includes(city)).length;
      brief = base + " · 驻军 " + format(holding.troops) + (holding.occupation ? " · 整顿中" : "") + (local ? " · " + local + " 道待执行" : "");
    } else if (!isHostile(planned, state.player, planned.cities[city].owner)) {
      brief += " · 协定保护";
    }
    get("brief").textContent = brief;
  }

  function menu(focus) {
    candidates = new Map();
    selection = null;
    movementDraft = null;
    action = null;
    const { state } = snapshot();
    const own = state.cities[city].owner === state.player;
    const choices = gameOutcome(state) !== "ongoing" ? [] : own
      ? ["attack", "transfer", "build", "recruit", "appoint", "delegate", ...(state.landscape ? ["convoy", state.century ? "province" : "policy"] : [])]
      : ["attack", ...(state.war ? ["scout"] : [])];
    if (state.frontline && gameOutcome(state) === "ongoing") choices.push("battle");
    if (strategyAt?.(city)) choices.unshift("strategic");
    actions.replaceChildren(...[...choices, "details"].map((key) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = key === "attack" && !own ? "进攻此城" : actionNames[key];
      button.dataset.cityAction = key;
      button.onclick = () => start(key);
      return button;
    }));
    show("menu");
    if (focus) get("title").focus({ preventScroll: true });
  }

  function close(focus = false) {
    if (!phase) return;
    const previous = city;
    city = phase = action = selection = undefined;
    candidates = new Map();
    root.hidden = true;
    delete panel.dataset.mapCommand;
    redraw();
    if (focus) stage.querySelector('[data-city-pin="' + previous + '"]:not([hidden])')?.focus({ preventScroll: true });
  }

  function attackChoices(from, to) {
    const { state, planned, era } = snapshot();
    if (planned.cities[from].owner !== state.player || !isHostile(planned, state.player, planned.cities[to].owner)) return null;
    const max = planned.cities[from].troops - cityReserve;
    const officers = availableAttackers(era, planned, state.player, from)
      .filter((person) => !pendingExpedition(state, person.key) && knownOfficer(state, person))
      .sort((a, b) => officerSkill(state, b, "command") - officerSkill(state, a, "command"));
    if (max < minimumMarch || !officers.length) return null;
    const direct = sites.get(from).links.includes(to) && weatherAllows(planned, from, to);
    const corps = (planned.armies ?? []).filter(({ faction }) => faction === state.player).length;
    const canMuster = state.war && !planned.cities[from].occupation && corps < armyCapacity(state);
    const land = canMuster && marchRoute(world, planned, state.player, from, to);
    const water = canMuster && state.landscape && marchRoute(world, planned, state.player, from, to, "water");
    const route = land || water;
    return direct || route ? { from, to, max, officers, direct, route, land, water } : null;
  }

  function routesForCity() {
    const { state, planned } = snapshot();
    if (action === "transfer") {
      const max = planned.cities[city].troops - cityReserve;
      if (max < minimumMarch) return new Map();
      return new Map(transferRoutes(world, planned, city).map((route) => {
        const to = route.at(-1);
        return [to, { from: city, to, route, max }];
      }));
    }
    const own = state.cities[city].owner === state.player;
    const entries = world.cities.filter(({ key }) => key !== city).map(({ key }) =>
      [key, attackChoices(own ? city : key, own ? key : city)]);
    return new Map(entries.filter(([, option]) => option));
  }

  function picking() {
    selection = null;
    candidates = routesForCity();
    const { state } = snapshot();
    const source = action === "attack" && state.cities[city].owner !== state.player;
    if (!candidates.size) {
      const transferring = action === "transfer";
      menu();
      const text = transferring ? "当前没有可调兵的路线，或出发城留守兵力不足。"
        : !isHostile(state, state.player, state.cities[city].owner) && source ? "这座城受协定保护，约定有效时无法进攻。"
          : "暂无可用的出征路线。出发城需要武将、足够兵力与可通行的道路。";
      message(text);
      return;
    }
    replaceOptions(picker, [["", source ? "选出发城" : "选目标城"], ...[...candidates.keys()].map((key) => [key, town(key)])], "");
    get("instruction").textContent = "在地图点选" + (source ? "己方出发城" : "高亮目标") + " · " + candidates.size + " 城";
    showCities();
    show("pick");
    get("title").focus({ preventScroll: true });
  }

  function start(key) {
    const { state } = snapshot();
    if (key === "province") {
      const target = city;
      close();
      openProvince(target);
      return;
    }
    if (key === "strategic") {
      const front = strategyAt(city);
      close();
      if (front) openStrategy(front.id);
      return;
    }
    if (key === "battle") {
      const objective = city;
      close();
      openBattle(objective);
      return;
    }
    if (key === "details") {
      const current = city;
      close();
      showDetails(current);
      return;
    }
    if (key === "convoy" || key === "policy") {
      openLandscape(key, key === "convoy" ? { from: city } : city);
      return;
    }
    if (["attack", "transfer", "recruit", "build"].includes(key) && state.orders.length >= seasonOrderLimit) {
      message("本季政令已满。请从「政令」查看、撤销或结算。");
      return;
    }
    action = key;
    if (key === "attack" || key === "transfer") {
      picking();
      return;
    }
    editor();
  }

  function pick(key) {
    if (phase !== "pick") return false;
    selection = candidates.get(key);
    if (!selection) {
      message("请选择一座高亮城池。");
      return true;
    }
    editor();
    return true;
  }

  function renderAppointments() {
    const { state, era } = snapshot();
    const role = get("role").value;
    const skill = role === "governor" ? "governance" : "command";
    const current = state.cities[city][role];
    const officers = era.officers.filter((person) => person.faction === state.player && knownOfficer(state, person)
      && (role !== "station" || state.stations[person.key] !== city)
      && (person.key === current || availableForPosting(state, person.key)));
    officers.sort((a, b) => officerSkill(state, b, skill) - officerSkill(state, a, skill));
    replaceOptions(get("appointee"), [["", role === "station" ? "选择调驻的武将" : "暂缺"], ...officers.map((person) => [person.key,
      person.name + " · " + (role === "station" ? town(state.stations[person.key])
        : (role === "governor" ? "政务" : "统率") + " " + officerSkill(state, person, skill))])], current ?? "");
  }

  function editor() {
    fields.replaceChildren();
    const { state, planned } = snapshot();
    if (action === "attack") {
      const rows = Object.entries(methods).filter(([mode]) => mode === "attack" ? selection.direct : selection.route);
      const preferred = rows.some(([key]) => key === movementDraft?.method) ? movementDraft.method : selection.direct ? "attack" : "siege";
      selectField("method", "方式", rows, preferred);
      if (state.landscape && selection.water) {
        selectField("travel", "水陆", Object.entries(travelModes).filter(([mode]) => mode === "water" || selection.land || selection.direct),
          movementDraft?.travel);
      }
      selectField("officer", "主将", selection.officers.map((person) => [person.key, person.name + " · " + officerSkill(state, person, "command")]),
        movementDraft?.officer);
    }
    if (action === "attack" || action === "transfer") {
      const available = planned.factions[state.player].grain;
      const sensible = action === "transfer" ? 600 : available * (selection.direct ? 100 : 50);
      const amount = Math.max(minimumMarch, Math.min(selection.max, movementDraft?.troops || sensible));
      numberField("troops", "兵力", amount, minimumMarch, selection.max).required = true;
    }
    if (action === "build") {
      const options = Object.entries(projects).map(([key, { name, cost }]) => {
        const level = planned.cities[city][key];
        return [key, name + " · " + (level >= 5 ? "已满级" : level + " → " + (level + 1) + " 级 · " + cost + " 钱")];
      });
      const preferred = options.find(([key]) => planned.cities[city][key] < 5)?.[0];
      selectField("project", "项目", options, preferred);
    }
    if (action === "appoint") {
      selectField("role", "职务", Object.entries(roles));
      selectField("appointee", "人选", []);
      renderAppointments();
    }
    if (action === "delegate") {
      const holding = state.cities[city];
      selectField("policy", "方针", Object.entries(governance).filter(([key]) => key !== "direct" || holding.mode === "delegated"),
        holding.mode === "delegated" ? holding.focus : "auto");
      const budget = numberField("budget", "每季钱", holding.delegateBudget ?? "", 0, 100);
      budget.placeholder = "不限";
    }
    show("edit");
    estimate();
    get("title").focus({ preventScroll: true });
  }

  function order() {
    if (action === "build") return { type: "build", city, project: get("project").value };
    if (action === "recruit") return { type: "recruit", city };
    const { from, to, route } = selection;
    const troops = get("troops").valueAsNumber;
    if (action === "transfer") return { type: "transfer", from, to, troops, ...(route.length > 2 ? { route } : {}) };
    const mode = get("method").value;
    const travel = get("travel")?.value;
    return { type: mode === "attack" ? "attack" : "mobilize", from, to, troops, officer: get("officer").value,
      ...(mode === "attack" ? {} : { stance: mode, ...(travel ? { travel } : {}) }) };
  }

  function plan() {
    const { state, planned, era } = snapshot();
    if (action === "appoint") {
      const role = get("role").value;
      const key = get("appointee").value;
      const person = era.officers.find((entry) => entry.key === key);
      if (role === "station") {
        if (!person) throw new Error("请选择要调驻的空闲武将。");
        return { confirm: "确认调驻", summary: person.name + "将由" + town(state.stations[key]) + "调驻" + town(city) + "。",
          apply: () => transferOfficer(world, state, key, city) };
      }
      if ((state.cities[city][role] ?? "") === key) throw new Error("请选择新的任命安排。");
      return { confirm: "确认任命", summary: person ? person.name + "将赴" + town(city) + "担任" + roles[role] + "。" : "将解除此城当前" + roles[role] + "的任命。",
        apply: () => appoint(world, state, city, role, key || null) };
    }
    if (action === "delegate") {
      const holding = state.cities[city];
      const policy = get("policy").value;
      const input = get("budget");
      const direct = policy === "direct";
      const budget = !input.value && !input.validity.badInput ? null : input.valueAsNumber;
      input.disabled = direct;
      if (!direct && !holding.governor) throw new Error("请从地图上的「任命」先为此城选一位太守。");
      if (!direct && !input.validity.valid) throw new Error("每季预算为 0 到 100 钱，留空表示不限。");
      const governor = era.officers.find(({ key }) => key === holding.governor)?.name;
      return { confirm: direct ? "收回委任" : "保存委任", summary: direct ? "收回后由你下达该城的建设和征兵令。"
        : governor + "按季负责" + governance[policy] + (budget === null ? "，使用可用国库。" : "，每季最多使用 " + budget + " 钱。"),
      apply: () => setGovernance(state, city, direct ? "direct" : "delegated", direct ? holding.focus : policy, direct ? holding.delegateBudget : budget) };
    }
    if (action === "scout") {
      const draft = queueScout(world, state, city);
      return { confirm: "派出斥候", summary: "本季结算时消耗 " + scoutCost + " 粮侦察" + town(city) + "，更新驻军与城防情报。",
        apply: () => draft };
    }
    if (state.orders.length >= seasonOrderLimit) throw new Error("本季政令已满。");
    const item = order();
    if (selection && (!Number.isInteger(item.troops) || item.troops < minimumMarch || item.troops > selection.max)) {
      throw new Error("请派出 " + minimumMarch + " 至 " + format(selection.max) + " 人，留下至少 " + cityReserve + " 人。");
    }
    validateOrder(world, planned, state.player, item);
    let summary;
    if (item.type === "recruit") summary = "增加 " + recruitment.troops + " 人 · 消耗 " + recruitment.treasury + " 钱、" + recruitment.grain + " 粮";
    if (item.type === "build") {
      const { name, cost } = projects[item.project];
      const level = planned.cities[city][item.project];
      summary = name + " " + level + " → " + (level + 1) + " 级 · 消耗 " + cost + " 钱";
    }
    if (item.type === "transfer") summary = "调入 " + format(item.troops) + " 人 · 耗粮 " + transferGrain(item) + " · 留守 "
      + format(planned.cities[item.from].troops - item.troops) + " · " + (selection.route.length - 1) + " 段道路";
    if (item.type === "attack") {
      const odds = forecastAttack(era, planned, item);
      summary = (odds.wins ? "预计占优" : "预计失利") + " · 耗粮 " + odds.grain + " · 留守 " + format(planned.cities[item.from].troops - item.troops);
      if (state.war) summary += " · 按现有情报估算";
    }
    if (item.type === "mobilize") {
      const estimate = mobilizationQuote(world, planned, state.player, item);
      summary = "预计 " + estimate.quarters + " 季到位 · 随军 " + estimate.carried + " 粮 · 留守 " + format(estimate.leave)
        + (state.landscape ? " · 军械 " + estimate.equipment : "");
    }
    return { confirm: "加入政令", summary, apply: () => queueOrder(world, state, item) };
  }

  function estimate() {
    const confirm = get("confirm");
    try {
      if (get("travel")) get("travel").disabled = get("method").value === "attack";
      const preview = plan();
      confirm.textContent = preview.confirm;
      get("quote").textContent = preview.summary;
      get("quote").dataset.problem = "false";
      confirm.disabled = false;
    } catch (error) {
      confirm.textContent = ["appoint", "delegate", "scout"].includes(action) ? "确认" : "加入政令";
      confirm.disabled = true;
      get("quote").textContent = error.message;
      get("quote").dataset.problem = "true";
    }
    redraw();
  }

  function back() {
    if (phase === "menu") close(true);
    else if (phase === "edit" && selection) {
      movementDraft = { method: get("method")?.value, travel: get("travel")?.value, officer: get("officer")?.value, troops: get("troops").valueAsNumber };
      picking();
    }
    else menu(true);
  }

  get("back").onclick = back;
  picker.onchange = () => { if (picker.value) pick(picker.value); };
  get("form").oninput = (event) => {
    if (event.target.id === "map-command-role") renderAppointments();
    estimate();
  };
  get("form").onsubmit = (event) => {
    event.preventDefault();
    try {
      const next = plan().apply();
      const queued = next.orders.length > snapshot().state.orders.length;
      const label = actionNames[action];
      commit(next, town(city) + " · " + (queued ? label + "已加入政令" : label + "已登记"));
      menu(true);
    } catch (error) {
      get("quote").textContent = error.message;
      get("quote").dataset.problem = "true";
    }
  };

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !phase || event.defaultPrevented || document.querySelector("dialog[open]")) return;
    event.preventDefault();
    back();
  });

  return {
    open(key) { city = key; menu(true); },
    close,
    pick,
    sync() {
      if (!phase) return;
      const { state, selected } = snapshot();
      if (city !== selected || gameOutcome(state) !== "ongoing") { close(); return; }
      header();
    },
    overlay() {
      if (!phase) return null;
      if (phase === "pick") return { picking: true, targets: new Set(candidates.keys()) };
      if (!selection) return {};
      const route = action !== "attack" ? selection.route : get("method")?.value === "attack" ? [selection.from, selection.to]
        : get("travel")?.value === "water" ? selection.water : selection.land;
      return { from: selection.from, to: selection.to, type: action, route };
    },
  };
}
