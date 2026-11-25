import { cityName, firstCity, forceTotals, factionName, gameOutcome } from "./engine.js";
import { editFront, frontMissions, frontPreview, frontStatuses, frontTargets, saveFront } from "./front-command.js";
import { crisisResponses, eligibleApproaches, inviteOfficer, loyalty, orderCrisisResponse, personnelMandates } from "./statecraft-personnel.js";
import { nationalPriorities, regionalMandates, regionalSteward, saveRegionalMandate, saveStatecraftPolicy, statecraftBrief } from "./statecraft.js";
import { recruitOfficer, recruitmentChoices } from "./recruitment.js";
import { knownOfficer } from "./personnel.js";

function el(tag, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function action(label, run, disabled = false) {
  const button = el("button", label);
  button.type = "button";
  button.onclick = run;
  button.disabled = disabled;
  return button;
}

function options(rows, initial) {
  const input = el("select");
  input.append(...rows.map(([key, title]) => new Option(title, key)));
  if (initial !== undefined && rows.some(([key]) => String(key) === String(initial))) input.value = initial;
  return input;
}

function field(parent, label, name, control) {
  control.name = name;
  const row = el("label", label);
  row.append(control);
  parent.append(row);
  return control;
}

function number(value, min, max) {
  const input = el("input");
  Object.assign(input, { type: "number", value, min, max, step: 1, required: true, inputMode: "numeric" });
  return input;
}

function controls() {
  const node = el("div");
  node.className = "statecraft-controls";
  return node;
}

export function createStatecraftDesk(world, { snapshot, commit, upgrade, redraw, showCities, locate, diplomacy, replay }) {
  const dialog = document.getElementById("statecraft-dialog");
  const body = document.getElementById("statecraft-body");
  const tabs = dialog.querySelector("nav");
  const notice = document.getElementById("statecraft-notice");
  const mapBar = document.getElementById("statecraft-map-bar");
  let page = "nation";
  let chosenRegion;
  let frontId = 1;
  let draft;
  let picking;
  let advanced = false;
  let frontDetails = false;
  const names = { nation: "全国", fronts: "战线", regions: "州郡", talent: "人才" };
  const town = (key) => cityName(world, key);
  for (const [id, title] of Object.entries(names)) {
    const button = action(title, () => { page = id; draft = null; render(); });
    button.dataset.statecraftTab = id;
    tabs.append(button);
  }

  function act(work, message) {
    try {
      const next = work();
      commit(next, message);
      if (dialog.open) render();
    } catch (error) {
      notice.hidden = false;
      notice.textContent = error.message;
    }
  }

  function panelForm(handler, buttonText) {
    const form = el("form");
    form.className = "statecraft-form";
    form.onsubmit = (event) => { event.preventDefault(); handler(new FormData(form)); };
    const submit = el("button", buttonText);
    submit.className = "primary";
    return { form, submit };
  }

  const defaults = {
    growth: { development: 65, military: 35, relief: 30, reserveMoney: 24, reserveGrain: 30 },
    muster: { development: 35, military: 85, relief: 25, reserveMoney: 20, reserveGrain: 45 },
    recovery: { development: 40, military: 30, relief: 60, reserveMoney: 20, reserveGrain: 32 },
  };

  function renderNation(state, brief) {
    const totals = forceTotals(state, state.player);
    const policy = state.statecraft.policy;
    body.append(el("p", "委任 " + brief.managed + " / " + brief.held + " 城 · 本季预计税粮 +" + totals.treasury + " 钱 / +" + totals.grain + " 粮"));
    const alert = brief.alerts[0];
    if (alert) {
      const item = controls();
      item.classList.add("statecraft-alert");
      item.append(el("strong", alert.title), el("span", alert.text),
        action("处置", () => { chosenRegion = alert.region; page = "regions"; render(); }));
      body.append(item);
    }
    const { form, submit } = panelForm((values) => {
      const profile = values.get("profile");
      const amounts = Object.fromEntries(Object.entries(defaults[profile]).map(([key, value]) => [key, advanced ? Number(values.get(key))
        : policy?.profile === profile ? policy[key] : value]));
      act(() => saveStatecraftPolicy(snapshot().state, { profile, personnel: values.get("personnel"), ...amounts }), "全国方针已生效，下季按授权执行。");
    }, "颁行国策");
    const profile = field(form, "全国方针", "profile", options(Object.entries(nationalPriorities), policy?.profile ?? "growth"));
    field(form, "人才方针", "personnel", options(Object.entries(personnelMandates), policy?.personnel ?? "search"));
    if (advanced) {
      const fields = { development: "发展上限", military: "军备上限", relief: "赈济上限", reserveMoney: "国库预留", reserveGrain: "储粮预留" };
      for (const [key, title] of Object.entries(fields)) field(form, title, key, number(policy?.[key] ?? defaults[profile.value][key], 0, 600));
      profile.onchange = () => {
        for (const [key, value] of Object.entries(defaults[profile.value])) form.elements.namedItem(key).value = value;
      };
    }
    form.append(submit, action(advanced ? "收起预算" : "调整预算", () => { advanced = !advanced; render(); }));
    const links = controls();
    links.append(action("多方议盟", () => { dialog.close(); diplomacy(); }), action("战役复盘", () => { dialog.close(); replay(); }));
    body.append(form, links);
  }

  function renderFronts(state, era) {
    const plans = state.statecraft.fronts;
    const plan = plans.find(({ id }) => id === frontId);
    const head = controls();
    const picker = field(head, "战线", "front-slot", options([1, 2, 3].map((key) => {
      const item = plans.find(({ id }) => id === key);
      return [key, (item ? town(item.target) + " · " + frontStatuses[item.status] : "第 " + key + " 战区 · 待设")];
    }), frontId));
    picker.onchange = () => { frontId = Number(picker.value); draft = null; render(); };
    body.append(head);
    if (plan) {
      const person = era.officers.find(({ key }) => key === plan.officer);
      const text = [person?.name, plan.report?.text].filter(Boolean).join(" · ");
      if (text) body.append(el("p", text));
    }
    draft ??= { mission: plan?.mission ?? "siege", target: plan?.target ?? "", troops: plan?.troops ?? 1400,
      grain: plan?.grain ?? 45, floor: plan?.floor ?? 400, auto: plan?.auto ?? true };
    const { form, submit } = panelForm(() => {
      sync();
      act(() => saveFront(world, snapshot().state, { ...draft, id: frontId, officer: null }), "战区授权已下达。");
    }, "下达授权");
    const mission = field(form, "任务", "mission", options(Object.entries(frontMissions), draft.mission));
    const target = field(form, "目标", "target", options([], draft.target));
    const details = el("fieldset");
    details.className = "statecraft-front-details";
    details.hidden = !frontDetails;
    form.append(details);
    const troops = field(details, "最多调兵", "troops", number(draft.troops, 200, 6000));
    const grain = field(details, "每季军粮", "grain", number(draft.grain, 10, 300));
    const floor = field(details, "撤回底线", "floor", number(draft.floor, 200, 6000));
    const auto = el("input");
    auto.type = "checkbox";
    auto.checked = draft.auto;
    field(details, "授权自主推进", "auto", auto);
    const quote = el("p");
    quote.className = "statecraft-front-quote";
    form.append(quote);
    function sync() {
      draft = { mission: mission.value, target: target.value, troops: troops.valueAsNumber, grain: grain.valueAsNumber,
        floor: floor.valueAsNumber, auto: auto.checked };
    }
    function choices() {
      const list = frontTargets(world, state, mission.value);
      const prior = target.value || draft.target;
      target.replaceChildren(...list.map(({ key }) => new Option(town(key), key)));
      if (list.some(({ key }) => key === prior)) target.value = prior;
      submit.disabled = !list.length;
      preview();
      return list;
    }
    function preview() {
      sync();
      quote.textContent = frontPreview(world, state, { ...draft, id: frontId, officer: null });
    }
    mission.onchange = choices;
    for (const input of [target, troops, grain, floor, auto]) input.oninput = preview;
    choices();
    form.append(submit, action("地图选目标", () => {
      const sites = choices();
      if (!sites.length) return;
      sync();
      picking = new Set(sites.map(({ key }) => key));
      dialog.close();
      showCities();
      syncMap();
      redraw();
    }));
    head.append(action(frontDetails ? "收起额度" : "调整战区额度", () => { sync(); frontDetails = !frontDetails; render(); }));
    body.append(form);
    if (!plan) return;
    const links = controls();
    const paused = plan.status === "paused" || plan.status === "blocked";
    links.append(action(paused ? "恢复" : "暂停", () => act(() => editFront(snapshot().state, plan.id, paused ? "resume" : "pause"), "战区命令已更新。")),
      action("地图定位", () => { dialog.close(); locate(plan.target); }));
    body.append(links);
  }

  function renderRegions(state, era, brief) {
    const row = brief.rows.find((item) => item.region === chosenRegion) ?? brief.rows[0];
    if (!row) { body.append(el("p", "当前没有可调度的州郡。")); return; }
    const tool = controls();
    const picker = field(tool, "州郡", "region", options(brief.rows.map(({ region, pressure }) => [region, region + " · 压力 " + pressure]), row.region));
    picker.onchange = () => { chosenRegion = picker.value; render(); };
    body.append(tool);
    const policy = state.statecraft.regions[row.region];
    const steward = regionalSteward(state, row);
    const person = era.officers.find(({ key }) => key === steward);
    body.append(el("p", (person ? person.name + "主管" : "中枢代管") + " · " + row.cities.length + " 城 · 民生 " + row.welfare
      + (state.statecraft.responses[row.region] ? " · 待办 " + crisisResponses[state.statecraft.responses[row.region]] : "")));
    const { form, submit } = panelForm((values) => act(() => saveRegionalMandate(world, snapshot().state, row.region,
      { focus: values.get("focus"), budget: Number(values.get("budget")), floor: Number(values.get("floor")), officer: values.get("officer") }), "州郡授权已更新。"), "保存州郡授权");
    field(form, "这季重点", "focus", options(Object.entries(regionalMandates), policy?.focus ?? "growth"));
    field(form, "州郡预算", "budget", number(policy?.budget ?? 30, 0, 100));
    field(form, "驻军底线", "floor", number(policy?.floor ?? 850, 0, 2800));
    field(form, "主管", "officer", options([["", "由中枢安排"], ...era.officers.filter(({ key, faction }) => faction === state.player && row.cities.includes(state.stations[key]))
      .map(({ key, name }) => [key, name])], policy?.officer ?? ""));
    form.append(submit);
    const remedies = controls();
    const resolve = options(Object.entries(crisisResponses));
    field(remedies, "处置", "response", resolve);
    remedies.append(action("安排处置", () => act(() => orderCrisisResponse(world, snapshot().state, row.region, resolve.value), "将在本季拨款处置。")));
    body.append(form, remedies);
  }

  function renderTalent(state, era) {
    const owned = era.officers.filter((person) => person.faction === state.player && knownOfficer(state, person));
    const highRisk = owned.filter((person) => loyalty(state, person) <= 40);
    body.append(el("p", "在册 " + owned.length + " 人 · 离心 " + highRisk.length + " 人"
      + (state.statecraft.policy?.personnel === "search" ? " · 季末访才已启用" : "")));
    const candidates = recruitmentChoices(world, state).filter(({ ready }) => ready);
    const neighbors = eligibleApproaches(world, state);
    const hr = controls();
    const candidate = field(hr, "在野", "recruit", options(candidates.map(({ person }) => [person.key, person.name + " · " + person.reserve.fee + " 钱"])));
    const recruitHome = () => {
      const seat = firstCity(world, state);
      return [seat, ...world.cities.map(({ key }) => key)].find((key) => state.cities[key].owner === state.player && !state.cities[key].occupation);
    };
    hr.append(action("招募", () => act(() => recruitOfficer(world, snapshot().state, candidate.value, recruitHome()), "新人已入仕，可由国策安排职务。"),
      !candidates.length || !recruitHome()));
    const outreach = controls();
    const invite = field(outreach, "邻境待任", "invite", options(neighbors.map(({ key, name, faction }) => [key, name + " · " + factionName(era, faction)])));
    outreach.append(action(state.statecraft.invite ? "已发登庸" : "登庸 · 42 钱", () => act(() => inviteOfficer(world, snapshot().state, invite.value), "已派使者登庸。"),
      !neighbors.length || Boolean(state.statecraft.invite)));
    body.append(hr, outreach);
    const events = state.polity.history.filter(({ faction, event }) => faction === state.player && ["talent", "defection", "loyalty-warning"].includes(event));
    if (events.length) body.append(el("p", events.at(-1).text));
  }

  function render() {
    const { state, era } = snapshot();
    body.replaceChildren();
    notice.hidden = true;
    tabs.hidden = !state.statecraft;
    if (!state.statecraft) {
      body.append(el("p", "在现有战局启用全国授权、战线和人才。"));
      body.append(action("启用 4.0", () => act(upgrade, "已启用战线与天下。")));
      return;
    }
    for (const button of tabs.children) button.setAttribute("aria-pressed", String(button.dataset.statecraftTab === page));
    const brief = statecraftBrief(world, state);
    if (page === "nation") renderNation(state, brief);
    if (page === "fronts") renderFronts(state, era);
    if (page === "regions") renderRegions(state, era, brief);
    if (page === "talent") renderTalent(state, era);
    if (gameOutcome(state) !== "ongoing") for (const button of body.querySelectorAll('button[type="submit"]')) button.disabled = true;
  }

  function syncMap() {
    const { state } = snapshot();
    mapBar.replaceChildren();
    mapBar.hidden = !state.statecraft || gameOutcome(state) !== "ongoing";
    if (mapBar.hidden) return;
    if (picking) {
      mapBar.append(el("span", "点选高亮战区目标"), action("返回授权", () => {
        picking = null; render(); dialog.showModal(); syncMap(); redraw();
      }));
      return;
    }
    const brief = statecraftBrief(world, state);
    const alert = brief.alerts[0];
    const main = action(alert ? "国政 · " + alert.title : state.statecraft.policy ? "国政 · 委任 " + brief.managed + "/" + brief.held : "定国策",
      () => open(alert ? "regions" : "nation", alert?.region));
    main.id = "open-statecraft-map";
    if (alert) main.dataset.alert = "true";
    const fronts = action("战线" + (state.statecraft.fronts.length ? " " + state.statecraft.fronts.length : ""), () => open("fronts"));
    fronts.id = "open-statecraft-fronts";
    mapBar.append(main, fronts);
  }

  function open(key = "nation", selected) {
    picking = null;
    draft = null;
    frontDetails = false;
    page = key;
    if (page === "fronts" && Number.isInteger(selected)) frontId = selected;
    if (page === "regions" && selected) chosenRegion = selected;
    render();
    if (!dialog.open) dialog.showModal();
    syncMap();
    redraw();
  }

  return { open, render, syncMap, reset() { picking = null; draft = null; }, overlay() {
    return picking ? { picking: true, targets: picking } : null;
  }, pick(key) {
    if (!picking) return false;
    if (!picking.has(key)) return true;
    draft.target = key;
    picking = null;
    render();
    dialog.showModal();
    syncMap();
    redraw();
    return true;
  } };
}
