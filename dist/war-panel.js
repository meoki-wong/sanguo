import { armyByOfficer } from "./armies.js";
import { alliedPlan, allyWindow } from "./accords.js";
import { cityName, factionName, gameOutcome } from "./engine.js";
import { saveTheater, theaterLimit } from "./theaters.js";
import { beginWar, intelLabels, intelSummary, queueScout, scoutReachable, townIntel } from "./war-intel.js";
import { campaignTasks, missions, operationPreview, stances } from "./war-operations.js";
import { recoveryRows, saveRecovery } from "./war-recovery.js";

const number = new Intl.NumberFormat("zh-CN");

export function createWarPanel(world, { snapshot, commit, locate, theater, army, seasonTitle }) {
  const find = (id) => document.getElementById(id);
  const dialog = find("war-dialog");
  const buttons = [...find("war-tabs").querySelectorAll("button")];
  let pane = "plans";
  let editing = false;
  let reviewIndex = 0;

  function message(text = "", error = false) {
    const line = find("war-message");
    line.textContent = text;
    line.hidden = !text;
    line.dataset.error = String(error);
  }

  function options(id, rows, preferred = find(id).value) {
    const input = find(id);
    input.replaceChildren(...rows.map(([key, title]) => new Option(title, key)));
    if (rows.some(([key]) => String(key) === String(preferred))) input.value = preferred;
    return input.value;
  }

  const selectedSlot = () => Number(find("war-theater").value || 1);
  const selectedPlan = (state) => state.theaters?.find(({ id }) => id === selectedSlot());

  function action(change, label) {
    try {
      commit(change(snapshot().state), label);
      render();
      message(label);
    } catch (error) { message(error.message, true); }
  }

  function showPlans(preferred = selectedSlot()) {
    const { state, era } = snapshot();
    const plans = new Map((state.theaters ?? []).map((plan) => [plan.id, plan]));
    options("war-theater", Array.from({ length: theaterLimit }, (_, index) => [index + 1, plans.get(index + 1)?.name ?? "空战区 " + (index + 1)]), preferred);
    const plan = selectedPlan(state);
    const order = plan?.operation;
    const unit = plan?.army && armyByOfficer(state, plan.army);
    const running = gameOutcome(state) === "ongoing";
    find("war-open-theater").textContent = plan ? "调整战区" : "配置战区";
    find("war-budget").hidden = !plan || !running;
    find("war-army").hidden = !unit;
    find("war-plan-map").hidden = !plan;
    find("edit-war-plan").hidden = !plan || !running;
    find("edit-war-plan").textContent = order ? "改战役" : "设战役";
    find("war-plan-view").hidden = editing;
    find("war-plan-form").hidden = !editing;
    const commander = era.officers.find(({ key }) => key === (unit?.officer ?? plan?.commander))?.name;
    find("war-plan-status").textContent = plan ? `${order ? missions[order.mission] + " · " : ""}${cityName(world, plan.target)} · ${commander}
${plan.report?.text ? " · " + plan.report.text : plan.paused ? " · 已暂停" : ""}`.replace(/\n/g, "")
      : "先配置辖城、粮仓和主将，再设置战役。";
    if (!plan) {
      find("war-plan-estimate").textContent = "";
      find("war-plan-route").textContent = "";
      return;
    }
    const quote = operationPreview(world, state, plan);
    const intel = townIntel(state, state.player, plan.target);
    const siege = unit?.engagement;
    const pact = alliedPlan(state, state.player, plan.target);
    const forecast = quote.quarters ? `约 ${quote.quarters} 季到位${quote.extra ? " · 到位后另需围城或封锁" : ""}` : "暂无有效行军道";
    find("war-plan-estimate").textContent = siege ? `围城第 ${siege.quarters} 季 · 城防动摇 ${siege.progress} / 100`
      : forecast + ` · 兵 ${number.format(quote.troops)} · 每季约 ${quote.ration} 粮`
        + (!unit && quote.ration * 2 > quote.funding ? ` · 集结需 ${quote.ration * 2} 粮，可拨 ${quote.funding}` : "");
    const details = [quote.supply ? "补给 " + quote.supply.map((key) => cityName(world, key)).join(" → ") : "补给中断",
      quote.terrain.length ? quote.terrain.map(({ to, label }) => cityName(world, to) + label).join("、") : null,
      quote.rally.length ? "敌援可能来自" + quote.rally.slice(0, 2).map((key) => cityName(world, key)).join("、") : null,
      quote.odds ? "守军估计 " + intelSummary(state, state.player, plan.target) + "（" + intelLabels[intel.source] + "）" : null,
      pact?.coordination ? `盟军第 ${allyWindow(pact).first}–${allyWindow(pact).last} 季到位` : null];
    find("war-plan-route").textContent = details.filter(Boolean).join(" · ");
  }

  function stanceOptions(preferred) {
    const task = find("war-mission").value;
    options("war-stance", task === "relief" ? [["assault", "增援"]]
      : Object.entries(stances).filter(([key]) => key !== "blockade" || task === "diversion"), preferred);
    find("war-sync").disabled = task === "relief";
  }

  function edit() {
    const { state } = snapshot();
    const plan = selectedPlan(state);
    if (!plan) return;
    if (plan.goal === "recover") {
      pane = "recovery";
      render();
      return;
    }
    const order = plan.operation;
    options("war-mission", plan.goal === "advance" ? [["main", "主攻"], ["diversion", "牵制"]] : [["relief", "解围"]], order?.mission);
    stanceOptions(order?.stance);
    options("war-retreat", [["", "待命等指令"], ...plan.cities.filter((key) => state.cities[key].owner === state.player)
      .map((key) => [key, cityName(world, key)])], order?.retreat ?? plan.backup ?? plan.depot);
    const affordable = Math.floor(operationPreview(world, state, plan).funding / 2) * 100;
    find("war-troops").value = order?.troops ?? Math.max(700, Math.min(2800, affordable));
    find("war-floor").value = order?.floor ?? 700;
    find("war-sync").checked = Boolean(order?.sync);
    editing = true;
    showPlans();
  }

  function showIntel(preferred) {
    const { state, selected, era } = snapshot();
    const others = world.cities.filter(({ key }) => state.cities[key].owner !== state.player);
    const key = options("war-intel-city", others.map(({ key, name }) => [key, name]),
      preferred ?? (find("war-intel-city").value || selected));
    const note = find("war-intel-brief");
    find("war-scout").disabled = true;
    find("war-intel-locate").disabled = !key;
    find("war-intel-origin").textContent = "";
    find("war-intel-units").textContent = "";
    if (!key) { note.textContent = "当前没有外部城池。"; return; }
    const intel = townIntel(state, state.player, key);
    note.textContent = `${factionName(era, state.cities[key].owner)} · 驻军 ${intelSummary(state, state.player, key)}
 · 城防 ${intelSummary(state, state.player, key, "defense")}`.replace(/\n/g, "");
    const reach = scoutReachable(world, state, state.player, key);
    const tasked = state.war.scouts.includes(key);
    find("war-intel-origin").textContent = intel.source === "unknown" ? "暂无可信军情"
      : intelLabels[intel.source] + " · 第 " + intel.seen + " 季获取" + (state.turn - intel.seen > 1 ? " · 已转为旧报" : "");
    if (!reach) find("war-intel-origin").textContent += " · 超出两段侦察范围";
    if (tasked) find("war-intel-origin").textContent += " · 本季已派斥候";
    find("war-intel-units").textContent = intel.spotted.length ? "观察到的军团 " + intel.spotted.slice(0, 2).map((unit) => {
      const person = era.officers.find(({ key }) => key === unit.officer);
      return (person?.name ?? "军团") + " " + unit.troops.map((troops) => number.format(troops)).join("–");
    }).join("、") : "";
    find("war-scout").disabled = !reach || tasked || state.war.scouts.length >= 2 || gameOutcome(state) !== "ongoing";
  }

  function showRecovery(reset = false) {
    const { state } = snapshot();
    const rows = recoveryRows(world, state);
    const held = Object.values(state.cities).filter(({ owner }) => owner === state.player).length;
    const work = state.war.recovery;
    find("war-recovery-status").textContent = `占领 ${held} 城 · 稳定 ${held - rows.length} 城 · 接管中 ${rows.length} 城`;
    const picker = options("war-recovery-city", [["all", "全部待整顿城"], ...rows.map(({ key, name }) => [key, name])]);
    const local = rows.find(({ key }) => key === picker);
    find("war-recovery-details").textContent = local
      ? `${local.troops} 驻军 · ${local.governor ? "太守在任" : "太守空缺"} · 整顿余 ${local.occupation} 季`
      : rows.length ? `${rows.filter(({ shortage }) => shortage).length} 城缺驻军 · ${rows.filter(({ governor }) => !governor).length} 城缺太守`
        : "委任可自动接管后续攻占的城池。";
    if (reset) {
      find("war-recovery-money").value = work?.treasury ?? 32;
      find("war-recovery-grain").value = work?.grain ?? 45;
      find("war-recovery-follow").checked = work?.follow ?? true;
    }
    find("save-war-recovery").disabled = gameOutcome(state) !== "ongoing";
    find("clear-war-recovery").hidden = !work || gameOutcome(state) !== "ongoing";
  }

  function showRoutes() {
    const { state } = snapshot();
    find("war-route-goals").replaceChildren(...campaignTasks(world, state).map(({ title, detail, done, ready }) => {
      const row = document.createElement("li");
      const heading = document.createElement("strong");
      heading.textContent = title + (done !== null ? " · 第 " + done + " 季达成" : ready ? " · 待验收" : "");
      if (done !== null) heading.className = "stage-met";
      const description = document.createElement("p");
      description.className = "muted";
      description.textContent = detail;
      row.append(heading, description);
      return row;
    }));
  }

  function review() {
    const { state, era } = snapshot();
    const rows = state.war.timeline;
    reviewIndex = Math.max(0, Math.min(reviewIndex, rows.length - 1));
    const row = rows.at(-1 - reviewIndex);
    find("war-review-count").textContent = row ? `${reviewIndex + 1} / ${rows.length} · ${row.turn ? seasonTitle(row.turn - 1) : "战前"}
 · ${factionName(era, row.faction)} · ${cityName(world, row.city)}`.replace(/\n/g, "") : "暂无已结算的战役事迹。";
    find("war-review-note").textContent = row ? row.text + (row.cost ? " 支出 " + row.cost + " 粮。" : "") : "";
    find("war-review-prev").disabled = !reviewIndex;
    find("war-review-next").disabled = reviewIndex + 1 >= rows.length;
    find("war-review-map").hidden = !row;
    return row;
  }

  function render() {
    const { state } = snapshot();
    find("war-tabs").hidden = !state.war;
    find("war-upgrade").hidden = Boolean(state.war);
    find("enable-war").disabled = gameOutcome(state) !== "ongoing";
    for (const button of buttons) {
      const shown = button.dataset.warPane === pane;
      button.setAttribute("aria-pressed", String(shown));
      find("war-" + button.dataset.warPane).hidden = !state.war || !shown;
    }
    if (!state.war) return;
    if (pane === "plans") showPlans();
    if (pane === "intel") showIntel();
    if (pane === "recovery") showRecovery(true);
    if (pane === "route") showRoutes();
    if (pane === "review") review();
  }

  for (const button of buttons) button.addEventListener("click", () => {
    pane = button.dataset.warPane;
    editing = false;
    message();
    render();
  });
  find("enable-war").addEventListener("click", () => action((state) => beginWar(world, state), "战役指挥已启用。"));
  find("war-theater").addEventListener("change", () => { editing = false; showPlans(); message(); });
  find("war-open-theater").addEventListener("click", () => theater(selectedSlot()));
  find("war-budget").addEventListener("click", () => theater(selectedSlot(), "budget"));
  find("war-army").addEventListener("click", () => army(selectedPlan(snapshot().state)?.army));
  find("war-plan-map").addEventListener("click", () => {
    const { state } = snapshot();
    const plan = selectedPlan(state);
    if (plan) locate(plan.target, operationPreview(world, state, plan).route);
  });
  find("edit-war-plan").addEventListener("click", edit);
  find("close-war-plan").addEventListener("click", () => { editing = false; showPlans(); message(); });
  find("war-mission").addEventListener("change", () => stanceOptions());
  find("war-plan-form").addEventListener("submit", (event) => {
    event.preventDefault();
    action((state) => {
      const plan = selectedPlan(state);
      const mission = find("war-mission").value;
      const updated = saveTheater(world, state, { ...plan, operation: { mission, stance: find("war-stance").value,
        troops: find("war-troops").valueAsNumber, floor: find("war-floor").valueAsNumber, retreat: find("war-retreat").value || null,
        sync: mission !== "relief" && find("war-sync").checked, started: plan.operation?.started ?? state.turn } });
      editing = false;
      return updated;
    }, "已委任战役。");
  });
  find("war-intel-city").addEventListener("change", () => { message(); showIntel(); });
  find("war-intel-locate").addEventListener("click", () => locate(find("war-intel-city").value));
  find("war-scout").addEventListener("click", () => action((state) => queueScout(world, state, find("war-intel-city").value), "斥候已受命，季末回报。"));
  find("war-recovery-city").addEventListener("change", () => showRecovery());
  find("war-recovery").addEventListener("submit", (event) => {
    event.preventDefault();
    action((state) => {
      const key = find("war-recovery-city").value;
      return saveRecovery(world, state, { cities: key === "all" ? recoveryRows(world, state).map(({ key }) => key) : [key],
        treasury: find("war-recovery-money").valueAsNumber, grain: find("war-recovery-grain").valueAsNumber, follow: find("war-recovery-follow").checked });
    }, "已委任战后接管。");
  });
  find("clear-war-recovery").addEventListener("click", () => action((state) => saveRecovery(world, state, null), "已停止接管委任。"));
  find("war-review-prev").addEventListener("click", () => { reviewIndex -= 1; review(); });
  find("war-review-next").addEventListener("click", () => { reviewIndex += 1; review(); });
  find("war-review-map").addEventListener("click", () => { const record = review(); if (record) locate(record.city); });
  return { open(next = "plans", preferred) {
    pane = next;
    editing = false;
    reviewIndex = 0;
    message();
    render();
    if (snapshot().state.war && preferred !== undefined) {
      if (pane === "intel") showIntel(preferred);
      if (pane === "plans") showPlans(preferred);
    }
    dialog.showModal();
  } };
}
