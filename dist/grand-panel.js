import { cityName, createGame, factionName, firstCity, gameOutcome } from "./engine.js";
import { armyByOfficer, armyPhases, supplyRoute } from "./armies.js";
import { isHostile } from "./diplomacy.js";
import { enableGrand } from "./grand.js";
import { answerPackage, grandClauses, packageQuote, proposePackage } from "./grand-diplomacy.js";
import {
  campaignCandidates, campaignQuote, campaignStatuses, manageGrandCampaign, reinforceGrandWing, reviseGrandSupply, saveGrandCampaign, wingNames,
} from "./grand-campaign.js";
import { configureGate, crossings, dispatchRoute, districtStatus, gateOwner, grandPriorities, saveDistrict, saveGrandNational } from "./grand-logistics.js";
import { openingDifficulties, openingGoals } from "./landscape.js";
import { travelModes } from "./landscape-terrain.js";
import { frontMissions } from "./front-command.js";

function options(element, rows, preferred = element.value) {
  element.replaceChildren(...rows.map(([value, title]) => new Option(title, value)));
  if (rows.some(([value]) => String(value) === String(preferred))) element.value = preferred;
  return element.value;
}

const names = (cities) => cities.map(({ key, name }) => [key, name]);
const fields = (items) => Object.entries(items);
const line = (value) => Object.assign(document.createElement("li"), { textContent: value });

export function createGrandPanel(world, { snapshot, commit, locate, classic }) {
  const find = (id) => document.getElementById("grand-" + id);
  const value = (id) => find(id).value;
  const number = (id) => find(id).valueAsNumber;
  const dialog = find("dialog");
  const tabs = [...find("tabs").querySelectorAll("button")];
  const steps = ["objective", "supply", "wings", "review"];
  let pane = "govern";
  let planDraft = null;
  let proposal = null;
  let fielding = false;
  const regions = () => districtStatus(world, snapshot().state);
  const region = () => regions().find((item) => item.region === value("region"));
  const openGame = () => gameOutcome(snapshot().state) === "ongoing";
  const ownCities = (state) => world.cities.filter(({ key }) => state.cities[key].owner === state.player);
  const occupies = (state, faction) => Object.values(state.cities).some(({ owner }) => owner === faction);
  const selectedPlan = () => snapshot().state.grand.campaigns.find(({ id }) => id === Number(value("campaign-slot")));
  const reviewID = () => Number(value("treaty-review"));
  const routeText = (path) => path.map((key) => cityName(world, key)).join(" → ");

  function report(content = "", error = false) {
    find("message").textContent = content;
    find("message").hidden = !content;
    find("message").dataset.error = String(error);
  }

  function apply(change, message, after) {
    try {
      const next = change(snapshot().state);
      commit(next, message);
      after?.();
      render();
      report(message);
    } catch (error) {
      report(error.message, true);
    }
  }

  function showGovern() {
    const { state } = snapshot();
    options(find("region"), [["", "全国调度"], ...regions().map(({ region, cities }) => [region, region + " · " + cities.length + " 城"])]);
    const district = region();
    const record = district ? district.program : state.grand.national;
    find("money").value = record?.treasury ?? 12;
    find("grain").value = record?.grain ?? 24;
    find("reserve").value = state.grand.national.reserve;
    find("reserve").disabled = Boolean(district);
    find("reserve-field").hidden = Boolean(district);
    find("district-fields").hidden = !district;
    find("district-clear").hidden = !district?.program || !openGame();
    find("save-govern").disabled = !openGame();
    if (district) {
      options(find("priority"), fields(grandPriorities), record?.focus);
      options(find("depot"), [["", "只做地方调度"], ...names(district.cities)], record?.depot ?? "");
    }
    quoteGovern();
  }

  function quoteGovern() {
    const { state } = snapshot();
    const row = region();
    const depot = value("depot");
    const path = row && depot ? dispatchRoute(world, state, state.player, depot) : null;
    find("depot-map").hidden = !row || !depot;
    find("govern-info").textContent = row ? (row.pending + " 城整顿中 · " + row.frontier + " 座前线城"
      + (depot ? " · 粮仓存粮 " + (state.grand.depots[depot] ?? 0) + (path ? " · 粮路畅通" : " · 粮路受阻") : ""))
      : "国库 " + state.factions[state.player].treasury + " 钱 · 储粮 " + state.factions[state.player].grain
        + " · 拨款后须保留储粮底线。";
  }

  function showCampaign() {
    const { state } = snapshot();
    options(find("campaign-slot"), [1, 2].map((id) => [id, state.grand.campaigns.find((item) => item.id === id)?.name ?? "空席位 " + id]));
    const plan = selectedPlan();
    const editing = Boolean(planDraft);
    find("campaign-slot").disabled = editing || fielding;
    find("plan-view").hidden = editing || fielding;
    find("plan-form").hidden = !editing;
    find("field-command").hidden = !fielding;
    if (editing) { showStep(); return; }
    if (fielding) { showFieldMode(); return; }
    find("plan-status").textContent = plan ? campaignStatuses[plan.status] + " · " + cityName(world, plan.target) + "。"
      + (plan.note || "军团将在结算时集结。") : "选定目标，分别安排主攻、策应和护粮，再核对耗粮与退路。";
    find("plan-new").hidden = Boolean(plan) || !openGame();
    find("wing-report-field").hidden = !plan;
    const active = plan && !["complete", "recovering"].includes(plan.status);
    find("plan-pause").hidden = !active || !openGame();
    find("plan-pause").textContent = plan?.status === "paused" ? "恢复" : "暂停";
    find("plan-withdraw").hidden = !plan || !Object.values(plan.wings).some(({ officer }) => armyByOfficer(state, officer)) || !openGame();
    find("plan-clear").hidden = !plan || !find("plan-withdraw").hidden || !openGame();
    find("plan-map").hidden = !plan;
    find("plan-adjust").hidden = !active || !openGame();
    if (plan) options(find("wing-report"), Object.keys(plan.wings).map((key) => [key, wingNames[key]]));
    showWingReport();
  }

  function showWingReport() {
    const plan = selectedPlan();
    const { state, era } = snapshot();
    const unit = plan?.wings[value("wing-report")];
    const army = unit && armyByOfficer(state, unit.officer);
    const person = unit && era.officers.find(({ key }) => key === unit.officer);
    find("wing-status").textContent = unit ? (person?.name ?? "") + " · " + (army
      ? cityName(world, army.location) + " · " + armyPhases[army.phase] + " · " + army.troops + "兵 / " + army.grain + "随军粮"
      : cityName(world, unit.from) + " · 编制 " + unit.troops + " 兵") : "";
  }

  function showFieldMode() {
    find("field-supply").hidden = value("field-mode") !== "supply";
    find("field-aid").hidden = value("field-mode") !== "aid";
  }

  function fieldCommand() {
    const plan = selectedPlan();
    const { state } = snapshot();
    const held = names(ownCities(state));
    options(find("field-depot"), held, plan.depot);
    options(find("field-backup"), [["", "无"], ...held], plan.backup ?? "");
    options(find("field-retreat"), held, plan.retreat);
    options(find("field-wing"), Object.keys(plan.wings).map((key) => [key, wingNames[key]]));
    find("field-grain").value = plan.grain;
    find("field-floor").value = plan.floor;
    find("field-mode").value = "supply";
    fielding = true;
    showCampaign();
  }

  function initPlan() {
    const { state, selected } = snapshot();
    const targets = world.cities.filter(({ key }) => isHostile(state, state.player, state.cities[key].owner) && campaignCandidates(world, state, key).length);
    const target = targets.find(({ key }) => key === selected) ?? targets[0];
    const reserve = firstCity(world, state);
    planDraft = { id: Number(value("campaign-slot")), name: target ? target.name + "战役" : "", target: target?.key ?? "",
      depot: reserve, backup: null, retreat: reserve, grain: 120, floor: 400, recover: true, wings: {}, status: "ready", lost: 0, note: null };
    options(find("plan-target"), names(targets), planDraft.target);
    options(find("plan-depot"), names(ownCities(state)), reserve);
    options(find("plan-retreat"), names(ownCities(state)), reserve);
    options(find("plan-backup"), [["", "无"], ...names(ownCities(state))], "");
    options(find("wing-role"), fields(wingNames), "main");
    find("plan-name").value = planDraft.name;
    find("plan-recover").checked = true;
    find("plan-grain").value = planDraft.grain;
    find("plan-floor").value = planDraft.floor;
    find("plan-step").value = "objective";
    showCampaign();
  }

  function showStep() {
    const step = value("plan-step");
    for (const key of steps) find("step-" + key).hidden = key !== step;
    find("plan-next").hidden = step === "review";
    find("plan-confirm").hidden = step !== "review";
    if (step === "wings") showWingDraft();
    if (step === "review") {
      const quote = campaignQuote(world, snapshot().state, planDraft);
      find("plan-estimate").textContent = quote.reason;
      find("plan-wings").replaceChildren(...quote.wings.map(({ role, route, grain, quarters }) =>
        line(wingNames[role] + " · " + routeText(route) + " · 约 " + quarters + " 季 · " + grain + " 粮")));
      find("plan-confirm").disabled = !quote.ready;
    }
  }

  function showWingDraft() {
    const { state } = snapshot();
    const role = value("wing-role");
    const unit = planDraft.wings[role];
    const blocked = new Set(Object.entries(planDraft.wings).filter(([key]) => key !== role).map(([, unit]) => unit.officer));
    const candidates = campaignCandidates(world, state, planDraft.target).filter(({ officer }) => !blocked.has(officer));
    options(find("wing-officer"), [["", role === "main" ? "选择主将" : "暂不编入"], ...candidates.map(({ officer, name, city, max }) =>
      [officer, name + " · " + city + " · 可派 " + max])], unit?.officer ?? "");
    find("wing-troops").value = unit?.troops ?? (role === "main" ? 1000 : 400);
    find("wing-travel").value = unit?.travel ?? "land";
    updateWing();
  }

  function updateWing() {
    const role = value("wing-role");
    const { state } = snapshot();
    const unit = campaignCandidates(world, state, planDraft.target).find(({ officer }) => officer === value("wing-officer"));
    find("wing-travel").closest("label").hidden = !state.landscape || !unit || unit.modes.length < 2;
    const travel = options(find("wing-travel"), (unit?.modes ?? ["land"]).map((mode) => [mode, travelModes[mode]]));
    if (unit) planDraft.wings[role] = { from: unit.from, officer: unit.officer, troops: number("wing-troops"),
      ...(state.landscape ? { travel } : {}) };
    else delete planDraft.wings[role];
    find("wing-hint").textContent = unit ? cityName(world, unit.from) + "最多可派 " + unit.max + " 人，须留守 250 人。"
      : "可依次编入主攻、策应与护粮。";
  }

  function syncPlan() {
    const target = value("plan-target");
    if (planDraft.target !== target) {
      planDraft.target = target;
      planDraft.wings = {};
      if (planDraft.name === value("plan-name") && target) find("plan-name").value = cityName(world, target) + "战役";
    }
    Object.assign(planDraft, { name: value("plan-name").trim(), recover: find("plan-recover").checked,
      depot: value("plan-depot"), backup: value("plan-backup") || null, retreat: value("plan-retreat"),
      grain: number("plan-grain"), floor: number("plan-floor") });
  }

  const freshProposal = (state, to) => ({ from: state.player, to, halt: false, pass: false, treasury: 0, grain: 0, city: null, joint: null });
  function showTreaty() {
    const { state, era } = snapshot();
    const mode = value("treaty-mode");
    find("package-form").hidden = mode !== "draft";
    find("treaty-list").hidden = mode === "draft";
    if (mode === "draft") {
      const to = options(find("partner"), era.factions.filter(({ key }) => key !== state.player && occupies(state, key)).map(({ key, name }) => [key, name]),
        proposal?.to);
      if (!proposal || proposal.to !== to) proposal = freshProposal(state, to);
      options(find("clause"), fields(grandClauses));
      showClause();
      return;
    }
    const show = (list) => list.filter(({ from, to }) => from === state.player || to === state.player);
    const rows = mode === "receipt" ? show(state.grand.receipts).slice().reverse() : show([...state.grand.offers, ...state.grand.agreements]);
    options(find("treaty-review"), rows.map((item) => [item.id,
      (mode === "receipt" ? "第 " + item.turn + " 季" : item.due ? "待交割" : "待批复") + " · "
        + factionName(era, item.from) + " → " + factionName(era, item.to)]));
    const item = rows.find(({ id }) => id === reviewID());
    find("review-field").hidden = !item;
    find("review-clause-field").hidden = mode !== "receipt" || !item;
    find("package-withdraw").hidden = mode !== "pending" || !item || Boolean(item.due) || item.from !== state.player || !openGame();
    find("package-accept").hidden = find("package-reject").hidden = mode !== "pending" || !item || Boolean(item.due) || item.to !== state.player || !openGame();
    if (mode === "receipt" && item) {
      const key = options(find("review-clause"), item.clauses.map(({ key, ok }) => [key, grandClauses[key] + (ok ? " · 已履约" : " · 未完成")]));
      find("treaty-status").textContent = item.clauses.find((clause) => clause.key === key)?.detail ?? "";
    } else {
      find("treaty-status").textContent = item ? describeTerms(item) + (item.due ? " · 下一季交割。" : item.answer === undefined ? "" : " · 批复已登记。")
        : "暂无此类议约。";
    }
  }

  function describeTerms(item) {
    return fields(grandClauses).filter(([key]) => item[key]).map(([key, name]) => {
      const value = item[key];
      return name + (typeof value === "number" ? " " + value : typeof value === "string" ? " " + cityName(world, value) : "");
    }).join("、");
  }

  function showClause() {
    const { state } = snapshot();
    const kind = value("clause");
    const numeric = ["treasury", "grain"].includes(kind);
    const city = ["city", "joint"].includes(kind);
    find("term-check-field").hidden = numeric || city;
    find("term-number-field").hidden = !numeric;
    find("term-city-field").hidden = !city;
    find("term-check").checked = Boolean(proposal[kind]);
    find("term-number").value = numeric ? proposal[kind] : 0;
    find("term-number").max = kind === "grain" ? 160 : 200;
    find("term-number").disabled = !numeric;
    if (city) {
      const available = kind === "city" ? ownCities(state).filter(({ key }) => state.polity.formerOwners[key].includes(proposal.to))
        : world.cities.filter(({ key }) => ![proposal.from, proposal.to].includes(state.cities[key].owner));
      options(find("term-city"), [["", "暂不纳入"], ...names(available)], proposal[kind] ?? "");
    }
    quotePackage();
  }

  function quotePackage() {
    const kind = value("clause");
    const outcome = packageQuote(world, snapshot().state, proposal);
    find("package-list").textContent = describeTerms(proposal) || "请选择要纳入的条款。";
    find("package-quote").textContent = outcome.clauses.find(({ key }) => key === kind)?.issue || outcome.reason;
    find("package-send").disabled = !openGame() || !outcome.ready;
  }

  function showRoad() {
    const { state, era } = snapshot();
    const key = options(find("gate"), crossings.map(({ key, name, kind }) => [key, name + " · " + (kind === "river" ? "渡口" : "关隘")]));
    const gate = crossings.find((item) => item.key === key);
    const owner = gateOwner(state, gate);
    const closed = state.grand.closed[key] === owner;
    find("gate-info").textContent = routeText([gate.seat, gate.to]) + " · " + factionName(era, owner)
      + "控制 · " + (closed ? "外来军路已封控" : "持通行议约可借道") + "。易主后按接管方的规定执行。";
    find("gate-toggle").textContent = closed ? "恢复通行" : "封控军路";
    find("gate-toggle").disabled = owner !== state.player || !openGame();
  }

  const panes = { govern: showGovern, campaign: showCampaign, treaty: showTreaty, road: showRoad };
  function render() {
    const enabled = Boolean(snapshot().state.grand);
    find("upgrade").hidden = enabled;
    find("enable").disabled = !openGame();
    find("tabs").hidden = !enabled;
    for (const tab of tabs) tab.setAttribute("aria-pressed", String(tab.dataset.grandPane === pane));
    for (const key of Object.keys(panes)) find(key).hidden = !enabled || pane !== key;
    report();
    if (enabled) panes[pane]();
  }

  for (const tab of tabs) tab.addEventListener("click", () => { pane = tab.dataset.grandPane; render(); });
  find("enable").onclick = () => apply((state) => enableGrand(world, state), "已启用天下大势。");
  find("region").onchange = showGovern;
  find("depot").onchange = quoteGovern;
  find("govern").onsubmit = (event) => {
    event.preventDefault();
    const budgets = { treasury: number("money"), grain: number("grain") };
    apply((state) => value("region") ? saveDistrict(world, state, value("region"), { ...budgets, focus: value("priority"), depot: value("depot") || null })
      : saveGrandNational(state, { ...budgets, reserve: number("reserve") }), "已保存每季调度。");
  };
  find("district-clear").onclick = () => apply((state) => saveDistrict(world, state, value("region"), null), "已撤回州郡调度。");
  find("depot-map").onclick = () => {
    const { state } = snapshot();
    locate(value("depot"), dispatchRoute(world, state, state.player, value("depot")), "roads");
  };
  for (const [id, target] of [["govern-classic", "policy"], ["campaign-classic", "war"], ["treaty-classic", "diplomacy"]]) {
    find(id).onclick = () => { dialog.close(); classic(target); };
  }
  find("campaign-slot").onchange = showCampaign;
  find("wing-report").onchange = showWingReport;
  find("plan-new").onclick = initPlan;
  find("plan-adjust").onclick = fieldCommand;
  find("field-mode").onchange = showFieldMode;
  find("field-back").onclick = () => { fielding = false; showCampaign(); };
  find("field-command").onsubmit = (event) => {
    event.preventDefault();
    const { id } = selectedPlan();
    apply((state) => value("field-mode") === "aid" ? reinforceGrandWing(state, id, value("field-wing"), number("field-troops"))
      : reviseGrandSupply(state, id, { depot: value("field-depot"), backup: value("field-backup") || null,
        retreat: value("field-retreat"), grain: number("field-grain"), floor: number("field-floor") }),
    "已登记调度。", () => { fielding = false; });
  };
  find("plan-back").onclick = () => { planDraft = null; render(); };
  find("plan-form").oninput = () => { syncPlan(); };
  find("plan-step").onchange = showStep;
  find("wing-role").onchange = showWingDraft;
  find("wing-officer").onchange = updateWing;
  find("wing-troops").oninput = updateWing;
  find("wing-travel").onchange = updateWing;
  find("plan-next").onclick = () => { find("plan-step").value = steps[steps.indexOf(value("plan-step")) + 1]; showStep(); };
  find("plan-form").onsubmit = (event) => {
    event.preventDefault();
    if (value("plan-step") !== "review") return;
    apply((state) => saveGrandCampaign(world, state, planDraft), "已登记战役，下季执行。", () => { planDraft = null; });
  };
  for (const [id, action] of [["plan-pause", "pause"], ["plan-withdraw", "withdraw"], ["plan-clear", "cancel"]]) {
    find(id).onclick = () => {
      const plan = selectedPlan();
      apply((state) => manageGrandCampaign(state, plan.id, action === "pause" && plan.status === "paused" ? "resume" : action), "战役指令已更新。");
    };
  }
  find("plan-map").onclick = () => {
    const { state } = snapshot();
    const plan = selectedPlan();
    const wing = plan.wings[value("wing-report")] ?? plan.wings.main;
    const unit = armyByOfficer(state, wing.officer);
    locate(unit?.location ?? wing.from, unit ? supplyRoute(world, state, unit) ?? unit.route : [wing.from, plan.target], "roads");
  };
  find("treaty-mode").onchange = showTreaty;
  find("partner").onchange = () => { proposal = freshProposal(snapshot().state, value("partner")); showClause(); };
  find("clause").onchange = showClause;
  find("term-check").onchange = () => { proposal[value("clause")] = find("term-check").checked; quotePackage(); };
  find("term-number").oninput = () => { proposal[value("clause")] = number("term-number") || 0; quotePackage(); };
  find("term-city").onchange = () => { proposal[value("clause")] = value("term-city") || null; quotePackage(); };
  find("package-form").onsubmit = (event) => {
    event.preventDefault();
    apply((state) => proposePackage(world, state, proposal), "议案已递交。", () => { find("treaty-mode").value = "pending"; proposal = null; });
  };
  find("treaty-review").onchange = find("review-clause").onchange = showTreaty;
  for (const [id, reply] of [["withdraw", "withdraw"], ["reject", false], ["accept", true]]) {
    find("package-" + id).onclick = () => apply((state) => answerPackage(state, reviewID(), reply), "议案已更新。");
  }
  find("gate").onchange = showRoad;
  find("gate-map").onclick = () => {
    const gate = crossings.find(({ key }) => key === value("gate"));
    locate(gate.seat, [gate.seat, gate.to], "roads");
  };
  find("gate-toggle").onclick = () => apply((state) => configureGate(state, value("gate"), !state.grand.closed[value("gate")]), "已调整军路通行。");

  return { open(next = "govern", preferred) {
    pane = next;
    fielding = false;
    planDraft = null;
    if (next === "treaty" && preferred) find("treaty-mode").value = "pending";
    render();
    if (next === "road" && preferred && snapshot().state.grand) { find("gate").value = preferred; showRoad(); }
    if (next === "treaty" && preferred && snapshot().state.grand) { find("treaty-review").value = preferred; showTreaty(); }
    if (next === "campaign" && preferred && snapshot().state.grand) { find("campaign-slot").value = preferred; showCampaign(); }
    if (!dialog.open) dialog.showModal();
  } };
}

export function createOpeningEditor(world, accept) {
  const find = (id) => document.getElementById("custom-" + id);
  let setup;
  let draft;
  const value = (key) => find(key).value;
  const libraryKey = "sanguo.openings.v3";
  let library = [];
  try {
    const stored = JSON.parse(localStorage.getItem(libraryKey) ?? "[]");
    if (Array.isArray(stored)) library = stored.filter((item) => item && item.draft && typeof item.draft.title === "string").slice(-24);
  } catch { /* Local storage may be unavailable in private browsing. */ }

  function list() {
    options(find("library"), [["", "选择同一时期与势力的剧本"], ...library.flatMap((item, index) =>
      item.year === setup.era.year && item.player === setup.player ? [[String(index), item.draft.title]] : [])], "");
  }

  function request() {
    const command = draft.command;
    return { ...draft, title: value("title").trim(), ...(command ? { command: { depot: command.depot, amount: command.amount,
      truce: command.truce, front: command.target ? { id: 1, mission: command.mission, target: command.target, troops: 1400,
        grain: 50, floor: 400, auto: true, army: command.army } : null } } : {}) };
  }

  function opening() {
    return createGame(world, setup.era.year, setup.player, { century: true, opening: request() });
  }

  function refresh() {
    const { era, player } = setup;
    const mode = value("mode");
    const owner = (key) => draft.owners[key] ?? era.ownership[key];
    for (const key of ["cities", "stocks", "stations", "rules", "command"]) find(key).hidden = key !== mode;
    const factions = era.factions.map(({ key, name }) => [key, name]);
    if (mode === "cities") {
      const city = options(find("city"), names(world.cities));
      options(find("owner"), factions, owner(city));
    }
    if (mode === "stocks") {
      const key = options(find("faction"), factions);
      const [treasury, grain] = era.factions.find((entry) => entry.key === key).stats;
      find("money").value = draft.stocks[key]?.treasury ?? treasury;
      find("grain").value = draft.stocks[key]?.grain ?? grain;
    }
    if (mode === "stations") {
      const people = era.officers.filter(({ reserve }) => !reserve);
      const key = options(find("person"), people.map(({ key, name, faction }) => [key, name + " · " + factionName(era, faction)]));
      const faction = people.find((entry) => entry.key === key).faction;
      options(find("station"), [["", "由剧本分配"], ...names(world.cities.filter(({ key }) => owner(key) === faction))], draft.stations[key] ?? "");
    }
    if (mode === "rules") {
      options(find("difficulty"), Object.entries(openingDifficulties), draft.difficulty);
      options(find("goal"), Object.entries(openingGoals), draft.goal);
      const rival = options(find("rival"), factions.filter(([key]) => key !== player));
      find("credit").value = draft.relations[rival] ?? 0;
    }
    if (mode === "command") {
      const command = draft.command ?? {};
      options(find("mission"), Object.entries(frontMissions), command.mission ?? "siege");
      const defensive = ["relief", "guard"].includes(value("mission"));
      options(find("objective"), [["", "按剧本开局"], ...names(world.cities.filter(({ key }) => (owner(key) === player) === defensive))], command.target ?? "");
      options(find("warehouse"), [["", "无初始粮仓"], ...names(world.cities.filter(({ key }) => owner(key) === player))], command.depot ?? "");
      options(find("ceasefire"), [["", "遵从剧本"], ...factions.filter(([key]) => key !== player)], command.truce ?? "");
      find("warehouse-stock").value = command.amount || 40;
      find("assemble").checked = Boolean(command.army);
      find("assemble").disabled = defensive;
    }
    const holdings = world.cities.filter(({ key }) => owner(key) === player).length;
    find("status").textContent = factionName(era, player) + " · " + holdings + " 座开局主城 · 已调整 " + Object.keys(draft.owners).length + " 城。";
    find("status").dataset.error = "false";
    find("opening-form").querySelector("[type=submit]").disabled = !holdings;
  }

  function reset() {
    draft = { title: "", owners: {}, stocks: {}, stations: {}, difficulty: "normal", goal: "historic", relations: {} };
    find("title").value = setup.era.year + " 年 · 自定义";
    refresh();
  }

  for (const id of ["mode", "city", "faction", "person", "rival"]) find(id).onchange = refresh;
  for (const id of ["difficulty", "goal"]) find(id).onchange = () => { draft[id] = value(id); };
  for (const id of ["mission", "objective", "warehouse", "warehouse-stock", "ceasefire", "assemble"]) find(id).onchange = () => {
    draft.command = { mission: value("mission"), target: value("objective"), depot: value("warehouse"),
      amount: value("warehouse") ? find("warehouse-stock").valueAsNumber : 0, truce: value("ceasefire"),
      army: find("assemble").checked && !["guard", "relief"].includes(value("mission")) };
    if (id === "mission") { draft.command.target = ""; refresh(); }
  };
  find("credit").onchange = () => {
    if (find("credit").checkValidity() && Number.isSafeInteger(find("credit").valueAsNumber)) {
      draft.relations[value("rival")] = find("credit").valueAsNumber;
    }
  };
  find("library").onchange = () => {
    if (!value("library")) return;
    draft = structuredClone(library[Number(value("library"))].draft);
    if (draft.command?.front) Object.assign(draft.command, draft.command.front);
    find("title").value = draft.title;
    refresh();
  };
  find("store").onclick = () => {
    try {
      opening();
      const saved = { year: setup.era.year, player: setup.player, draft: request() };
      const revised = [...library.filter((item) => item.year !== saved.year || item.player !== saved.player
        || item.draft.title !== saved.draft.title), saved].slice(-24);
      localStorage.setItem(libraryKey, JSON.stringify(revised));
      library = revised;
      list();
      find("library").value = String(library.length - 1);
      find("status").textContent = "已保存剧本「" + saved.draft.title + "」。";
      find("status").dataset.error = "false";
    } catch (error) {
      find("status").textContent = error.message;
      find("status").dataset.error = "true";
    }
  };
  find("owner").onchange = () => {
    const city = value("city");
    if (value("owner") === setup.era.ownership[city]) delete draft.owners[city];
    else draft.owners[city] = value("owner");
    for (const [person, site] of Object.entries(draft.stations)) if (city === site
      && setup.era.officers.find(({ key }) => key === person)?.faction !== value("owner")) delete draft.stations[person];
    refresh();
  };
  for (const id of ["money", "grain"]) find(id).onchange = () => {
    if (!find("money").checkValidity() || !find("grain").checkValidity()) return;
    draft.stocks[value("faction")] = { treasury: find("money").valueAsNumber, grain: find("grain").valueAsNumber };
  };
  find("station").onchange = () => {
    if (value("station")) draft.stations[value("person")] = value("station");
    else delete draft.stations[value("person")];
  };
  find("reset").onclick = reset;
  find("opening-form").onsubmit = (event) => {
    event.preventDefault();
    try {
      accept(opening());
    } catch (error) {
      find("status").textContent = error.message;
      find("status").dataset.error = "true";
    }
  };
  return { open(era, player) {
    setup = { era, player };
    list();
    find("mode").value = "cities";
    reset();
    find("opening-dialog").showModal();
  } };
}
