import { armyByOfficer } from "./armies.js";
import { cityName, eraByYear, gameOutcome } from "./engine.js";
import { knownOfficer } from "./personnel.js";
import { changeTheater, defaultWarBudget, saveTheater, saveWarBudget, theaterGoals, theaterLimit, theaterSupply } from "./theaters.js";
import { nationalDuty } from "./realm.js";

export function createTheaterPanel(world, { snapshot, commit, locate, campaign }) {
  const find = (id) => document.getElementById(id);
  const dialog = find("theater-dialog");
  let draft;
  let confirmRemove = false;

  function notify(text = "") {
    const note = find("theater-feedback");
    note.hidden = !text;
    note.textContent = text;
  }

  function options(id, rows, preferred = find(id).value) {
    const select = find(id);
    select.replaceChildren(...rows.map(([key, label]) => new Option(label, key)));
    if (rows.some(([key]) => String(key) === String(preferred))) select.value = preferred;
    return select.value;
  }

  const selectedId = () => Number(find("theater-picker").value || 1);
  const selectedPlan = () => snapshot().state.theaters?.find(({ id }) => id === selectedId());
  const ownCities = (state) => world.cities.filter(({ key }) => state.cities[key].owner === state.player);
  const officerName = (state, key) => eraByYear(world, state).officers.find((person) => person.key === key)?.name ?? "未任命";

  function overview(preferred = selectedId()) {
    const { state } = snapshot();
    const plans = new Map((state.theaters ?? []).map((plan) => [plan.id, plan]));
    const rows = Array.from({ length: theaterLimit }, (_, index) => {
      const id = index + 1;
      return [id, plans.get(id)?.name ?? "空战区 " + id];
    });
    options("theater-picker", rows, preferred);
    const plan = selectedPlan();
    confirmRemove = false;
    find("theater-remove").textContent = "撤销战区";
    find("theater-state").textContent = plan ? `${theaterGoals[plan.goal]}${cityName(world, plan.target)} · ${officerName(state, plan.commander)} · ${plan.paused ? "已暂停" : "委任中"}`
      : "选择空战区，指定目标、主将和军费。";
    find("theater-report").textContent = plan?.report?.text ?? (plan ? "等待下一季结算。" : "");
    find("theater-report").hidden = !plan;
    find("theater-report").dataset.blocked = String(plan?.report?.status === "blocked");
    const attached = plan?.army && armyByOfficer(state, plan.army);
    const supply = plan?.backup && theaterSupply(world, state, plan);
    find("theater-resources").textContent = plan ? `治所 ${cityName(world, plan.seat ?? plan.depot)} · 粮仓 ${cityName(world, plan.depot)} · 留守 ${plan.reserve}`
      + (plan.backup ? ` · 备仓 ${cityName(world, plan.backup)}` : "")
      + (supply?.depot === plan.backup && plan.backup ? `启用，运耗 ${supply.freight}` : "")
      + (attached ? ` · ${officerName(state, attached.officer)}军团` : "")
      + (plan.report ? ` · 上季用 ${plan.report.treasury} 钱 ${plan.report.grain} 粮` : "") : "";
    find("theater-resources").hidden = !plan;
    const ended = gameOutcome(state) !== "ongoing";
    find("theater-edit").textContent = plan ? "编辑战区" : "配置战区";
    find("theater-toggle").textContent = plan?.paused ? "恢复委任" : "暂停";
    find("theater-edit").disabled = ended;
    find("theater-open-war").hidden = !plan || !state.war;
    for (const id of ["theater-remove", "theater-toggle", "theater-locate"]) find(id).hidden = !plan || (ended && id !== "theater-locate");
  }

  function showPane(pane, preferred) {
    notify();
    for (const button of find("theater-panes").querySelectorAll("button")) {
      button.setAttribute("aria-pressed", button.dataset.theaterPane === pane);
    }
    find("theater-overview").hidden = pane !== "overview";
    find("theater-national").hidden = pane !== "national";
    find("theater-editor").hidden = pane !== "editor";
    if (pane === "overview") overview(preferred);
    if (pane === "national") {
      const { state } = snapshot();
      const budget = state.warBudget ?? defaultWarBudget;
      find("war-treasury").value = budget.treasury;
      find("war-grain").value = budget.grain;
      find("save-war-budget").disabled = gameOutcome(state) !== "ongoing";
    }
  }

  function missionTargets(preferred) {
    const { state } = snapshot();
    const advance = find("theater-goal").value === "advance";
    const rows = world.cities.filter(({ key }) => advance ? state.cities[key].owner !== state.player
      : draft.cities.includes(key) && state.cities[key].owner === state.player).map(({ key, name }) => [key, name]);
    options("theater-target", rows, preferred);
  }

  function rosterFields(preferredDepot, preferredCommander, preferredArmy, preferredSeat, preferredBackup) {
    const { state } = snapshot();
    const own = ownCities(state);
    const cities = own.filter(({ key }) => draft.cities.includes(key));
    const holdings = cities.map(({ key, name }) => [key, name]);
    const depot = options("theater-depot", holdings, preferredDepot);
    options("theater-backup", [["", "未指定"], ...holdings.filter(([key]) => key !== depot)], preferredBackup);
    options("theater-seat", holdings, preferredSeat);
    const armies = (state.armies ?? []).filter(({ faction }) => faction === state.player);
    const selectedArmy = options("theater-army", [["", "未编入军团"], ...armies.map(({ officer }) => [officer, officerName(state, officer) + "军团"])], preferredArmy);
    const commanders = eraByYear(world, state).officers.filter((person) => person.faction === state.player && knownOfficer(state, person) && !nationalDuty(state, person.key)
      && (draft.cities.includes(state.stations[person.key]) || person.key === selectedArmy));
    options("theater-commander", commanders.map(({ key, name }) => [key, name]), preferredCommander);
    options("theater-member", own.filter(({ key }) => !draft.cities.includes(key)).map(({ key, name }) => [key, name]));
    find("add-theater-member").disabled = !find("theater-member").value || draft.cities.length >= 5;
    find("theater-members").replaceChildren(...draft.cities.map((key) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quiet";
      button.textContent = cityName(world, key) + " ×";
      button.setAttribute("aria-label", "移出" + cityName(world, key));
      button.addEventListener("click", () => {
        draft.cities = draft.cities.filter((city) => city !== key);
        rosterFields();
        missionTargets();
      });
      return button;
    }));
  }

  function editTab(pane) {
    notify();
    for (const button of find("theater-editor-tabs").querySelectorAll("button")) {
      const active = button.dataset.theaterEdit === pane;
      button.setAttribute("aria-pressed", String(active));
      find(button.getAttribute("aria-controls")).hidden = !active;
    }
  }

  function edit() {
    const { state, selected } = snapshot();
    const plan = selectedPlan();
    const home = state.cities[selected]?.owner === state.player ? selected : ownCities(state)[0]?.key;
    draft = { id: selectedId(), cities: plan ? [...plan.cities] : [home] };
    find("theater-name").value = plan?.name ?? `战区 ${draft.id}`;
    options("theater-goal", Object.entries(theaterGoals), plan?.goal ?? "defend");
    missionTargets(plan?.target ?? home);
    rosterFields(plan?.depot ?? home, plan?.commander, plan?.army ?? "", plan?.seat ?? plan?.depot ?? home, plan?.backup ?? "");
    find("theater-reserve").value = plan?.reserve ?? 1100;
    find("theater-money").value = plan?.budget.treasury ?? 25;
    find("theater-grain").value = plan?.budget.grain ?? 40;
    find("theater-priority").value = plan?.priority ?? 2;
    showPane("editor");
    editTab("mission");
  }

  function perform(action, message, nextPane = "overview") {
    try {
      commit(action(snapshot().state), message);
      showPane(nextPane);
    } catch (error) { notify(error.message); }
  }

  for (const button of find("theater-panes").querySelectorAll("button")) button.addEventListener("click", () => showPane(button.dataset.theaterPane));
  for (const button of find("theater-editor-tabs").querySelectorAll("button")) button.addEventListener("click", () => editTab(button.dataset.theaterEdit));
  find("theater-picker").addEventListener("change", () => { notify(); overview(); });
  find("theater-edit").addEventListener("click", edit);
  find("cancel-theater-edit").addEventListener("click", () => showPane("overview"));
  find("theater-goal").addEventListener("change", () => missionTargets());
  find("theater-army").addEventListener("change", () => rosterFields());
  find("theater-depot").addEventListener("change", () => rosterFields());
  find("add-theater-member").addEventListener("click", () => {
    draft.cities.push(find("theater-member").value);
    rosterFields();
    missionTargets();
  });
  find("theater-locate").addEventListener("click", () => { const plan = selectedPlan(); if (plan) locate(plan.target); });
  find("theater-open-war").addEventListener("click", () => { dialog.close(); campaign(selectedId()); });
  find("theater-toggle").addEventListener("click", () => perform((state) => changeTheater(state, selectedId(), selectedPlan().paused ? "resume" : "pause"), "战区状态已更新。"));
  find("theater-remove").addEventListener("click", () => {
    if (confirmRemove) perform((state) => changeTheater(state, selectedId(), "remove"), "已撤销战区。现有军团可单独指挥。");
    else {
      confirmRemove = true;
      find("theater-remove").textContent = "确认撤销";
    }
  });
  find("theater-national").addEventListener("submit", (event) => {
    event.preventDefault();
    perform((state) => saveWarBudget(state, { treasury: find("war-treasury").valueAsNumber, grain: find("war-grain").valueAsNumber }), "已更新全国军费。", "national");
  });
  find("theater-editor").addEventListener("submit", (event) => {
    event.preventDefault();
    const goal = find("theater-goal").value;
    const previous = selectedPlan()?.operation;
    const retreat = previous?.retreat;
    const compatible = previous && (goal === "advance" ? previous.mission !== "relief" : goal === "defend" && previous.mission === "relief");
    perform((state) => saveTheater(world, state, { ...draft, name: find("theater-name").value, goal: find("theater-goal").value,
      ...(compatible ? { operation: { ...previous, retreat: draft.cities.includes(retreat) ? retreat : null } } : {}),
      target: find("theater-target").value, seat: find("theater-seat").value, depot: find("theater-depot").value,
      ...(find("theater-backup").value ? { backup: find("theater-backup").value } : {}),
      commander: find("theater-commander").value,
      army: find("theater-army").value || null, reserve: find("theater-reserve").valueAsNumber, priority: Number(find("theater-priority").value),
      budget: { treasury: find("theater-money").valueAsNumber, grain: find("theater-grain").valueAsNumber } }), "已保存战区命令。");
  });

  return { open(id, pane = "overview") {
    showPane(pane === "budget" ? "overview" : pane, id);
    if (pane === "budget" && selectedPlan()) {
      edit();
      editTab("budget");
    }
    dialog.showModal();
  } };
}
