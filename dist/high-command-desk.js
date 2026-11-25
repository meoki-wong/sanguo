import { cityName, gameOutcome } from "./engine.js";
import { authorizeCampaign, campaignGoals, campaignStages, commandAlerts, commandBudgets, commandPolicy, decideCampaign,
  peaceTerms, saveCommandPolicy, settlements, staffChoices, strategicTargets, urgentCommands } from "./high-command.js";
import { visibleBattles } from "./frontline.js";
import { strategicPost } from "./sandtable-posts.js";

const divisions = { front: "前线", defense: "守备", recovery: "恢复" };
const personnel = { manual: "保留重要任命", appoint: "委任补缺", search: "委任访才与补缺" };
const defaultDraft = { goal: "corridor", target: "", commander: "", mode: "delegate", money: 96, grain: 180, withdraw: 350,
  seasons: 8, terms: "passage", reinforce: true, rebase: true };
const format = new Intl.NumberFormat("zh-CN");

const element = (tag, text = "", className) => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
};

function button(label, click, key, disabled = false) {
  const node = element("button", label);
  node.type = "button";
  node.disabled = disabled;
  node.onclick = click;
  if (key) node.dataset.command = key;
  return node;
}

function group(...children) {
  const node = element("div", "", "command-row");
  node.append(...children);
  return node;
}

function field(label, key, input) {
  const node = element("label", label, "command-field");
  input.dataset.command = key;
  node.append(input);
  return node;
}

function select(label, key, values, value, onChange) {
  const input = element("select");
  input.replaceChildren(...values.map(([id, name]) => new Option(name, id)));
  if (values.some(([id]) => String(id) === String(value))) input.value = String(value);
  input.onchange = () => onChange(input.value);
  return field(label, key, input);
}

function number(label, key, value, min, max, update) {
  const input = element("input");
  Object.assign(input, { type: "number", min, max, value, step: 1, inputMode: "numeric" });
  input.oninput = () => update(input.value === "" ? NaN : Number(input.value));
  return field(label, key, input);
}

function toggle(label, key, value, update) {
  const input = element("input");
  Object.assign(input, { type: "checkbox", checked: value });
  input.onchange = () => update(input.checked);
  const result = field(label, key, input);
  result.classList.add("command-toggle");
  return result;
}

export function createHighCommandDesk(world, { snapshot, commit, upgrade, locate, battlefield, coalition, report, politics, advance, batch }) {
  const dialog = document.getElementById("high-command-dialog");
  const root = dialog.querySelector(".high-command-body");
  const navigation = dialog.querySelector(".high-command-nav");
  const notice = dialog.querySelector(".high-command-notice");
  const header = dialog.querySelector("h2");
  const name = (point) => strategicPost(point)?.name ?? cityName(world, point);
  let page = "summary";
  let selected;
  let draft;
  let policy;

  const close = () => { if (dialog.open) dialog.close(); };
  const visit = (next) => {
    page = next;
    notice.textContent = "";
    render();
  };

  function action(update, message, destination) {
    try {
      const next = update(snapshot().state);
      if (destination) page = destination;
      notice.textContent = message;
      commit(next, message);
    } catch (error) { notice.textContent = error.message; }
  }

  function open(target, id) {
    page = "summary";
    notice.textContent = "";
    policy = undefined;
    selected = id;
    draft = undefined;
    const { state } = snapshot();
    if (state.highCommand && id) page = "campaign";
    if (state.highCommand && target) {
      const row = state.highCommand.campaigns.find((row) => row.target === target && row.side === state.player && row.stage !== "ended");
      if (row) { selected = row.id; page = "campaign"; }
      else edit(undefined, target, false);
    }
    if (!dialog.open) dialog.showModal();
    render();
  }

  function edit(row, target, draw = true) {
    const { state } = snapshot();
    draft = row ? structuredClone(row) : { ...defaultDraft };
    if (target) {
      const options = strategicPost(target) ? ["corridor", "defense"] : ["relief", "advance", "defense"];
      const goal = options.find((key) => strategicTargets(world, state, key).some(({ key }) => key === target));
      if (goal) Object.assign(draft, { goal, target, terms: goal === "corridor" ? "passage" : "ceasefire" });
    }
    if (draw) visit("authorize");
    else page = "authorize";
  }

  function goBattle(target, type) {
    close();
    if (type === "coalition") coalition(target);
    else battlefield(target);
  }

  function summary(state, era, canEdit) {
    const funds = commandBudgets(state);
    const live = state.highCommand.campaigns.filter(({ stage, side }) => stage !== "ended" && side === state.player);
    const alerts = urgentCommands(state);
    const cards = group(...[
      ["前线可用", funds.frontMoney, funds.frontGrain], ["守备可用", funds.defenseMoney, funds.defenseGrain],
      ["恢复可用", funds.recoveryMoney, funds.recoveryGrain],
    ].map(([label, money, grain]) => {
      const block = element("div", "", "command-budget");
      block.append(element("span", label), element("strong", format.format(money) + " 钱 · " + format.format(grain) + " 粮"));
      return block;
    }));
    cards.classList.add("command-budgets");
    root.append(cards);
    if (alerts.length) root.append(button("急报 " + alerts.length + " 件 · " + commandAlerts[alerts[0].alert.kind], () => visit("alerts"), "urgent"));
    else root.append(element("p", "本季没有需要君主裁决的战役急报。", "command-muted"));
    if (live.length) root.append(...live.map((row) => {
      const commander = era.officers.find(({ key }) => key === row.commander)?.name ?? row.commander;
      const line = element("div", "", "command-campaign-row");
      line.append(button(name(row.target) + " · " + campaignGoals[row.goal], () => { selected = row.id; visit("campaign"); }, "campaign-" + row.id),
        element("span", campaignStages[row.stage] + " · " + commander + (row.mode === "direct" ? " · 手动" : " · 委任")));
      return line;
    }));
    const last = state.highCommand.campaigns.filter(({ stage, side }) => stage === "ended" && side === state.player).at(-1);
    if (!live.length && last) root.append(button("最近结案 · " + name(last.target), () => { selected = last.id; visit("campaign"); }, "last-campaign"));
    root.append(group(button("授权新战役", () => edit(), "new-campaign", !canEdit || live.length >= 3),
      button("查看会战", () => goBattle(), "local-battle"),
      button("推进一季", () => { close(); advance(); }, "advance", !canEdit),
      button("委任四季", () => { close(); batch(); }, "batch", !canEdit)));
  }

  function authorization(state, canEdit) {
    const targets = strategicTargets(world, state, draft.goal);
    if (draft.id && !targets.some(({ key }) => key === draft.target)) targets.unshift({ key: draft.target, name: name(draft.target) });
    if (!targets.some(({ key }) => key === draft.target)) draft.target = targets[0]?.key;
    const people = draft.target ? staffChoices(world, state, draft.goal, draft.target, draft.id) : [];
    if (draft.id && !people.some(({ officer }) => officer === draft.commander)) {
      const { era } = snapshot();
      people.unshift({ officer: draft.commander, name: era.officers.find(({ key }) => key === draft.commander)?.name ?? draft.commander });
    }
    if (!people.some(({ officer }) => officer === draft.commander)) draft.commander = people[0]?.officer;
    const first = group(
      select("目标类型", "goal", Object.entries(campaignGoals), draft.goal, (value) => {
        draft.goal = value;
        draft.terms = value === "corridor" ? "passage" : "ceasefire";
        render();
      }),
      select("地图目标", "target", targets.map(({ key, name }) => [key, name]), draft.target, (value) => { draft.target = value; render(); }),
      select("统帅", "commander", people.map((person) => [person.officer, person.name + (person.city ? " · " + name(person.city) : "")]),
        draft.commander, (value) => { draft.commander = value; }));
    first.classList.add("command-grid");
    first.querySelector('[data-command="goal"]').disabled = Boolean(draft.id);
    first.querySelector('[data-command="target"]').disabled = Boolean(draft.id);
    root.append(first);
    if (!targets.length || !people.length) root.append(element("p", targets.length ? "当前没有可行军到此目标的统帅。" : "当前没有符合条件的目标。", "command-muted"));
    root.append(group(
      number("战费上限", "money", draft.money, 0, 9999, (value) => { draft.money = value; }),
      number("军粮上限", "grain", draft.grain, 0, 9999, (value) => { draft.grain = value; }),
      select("指挥权", "mode", [["delegate", "委任"], ["direct", "亲自指挥"]], draft.mode, (value) => { draft.mode = value; })),
      group(button(draft.id ? "更新授权" : "批准战役", () => action((current) => {
        const next = authorizeCampaign(world, current, draft);
        selected = draft.id ?? next.highCommand.campaigns.at(-1).id;
        return next;
      }, "战役调令已登记，将在季度推进时执行。", "campaign"), "authorize", !canEdit || !people.length),
      button("撤退线与停战", () => visit("permissions"), "permissions"),
      button("返回军议", () => visit("summary"), "back")));
  }

  function permissions() {
    const terms = Object.entries(peaceTerms).filter(([key]) => key === "ceasefire"
      || key === "passage" && draft.goal === "corridor" || key === "return" && draft.goal === "advance");
    root.append(group(number("撤退兵力线", "withdraw", draft.withdraw, 200, 2400, (value) => { draft.withdraw = value; }),
      number("授权季度", "seasons", draft.seasons, 2, 12, (value) => { draft.seasons = value; }),
      select("议和条款", "terms", terms, draft.terms, (value) => { draft.terms = value; })),
    group(toggle("可集结与调预备队", "reinforce", draft.reinforce, (value) => { draft.reinforce = value; }),
      toggle("可更换粮仓", "rebase", draft.rebase, (value) => { draft.rebase = value; })),
    button("返回授权", () => visit("authorize"), "back"));
  }

  function policies(state, canEdit) {
    policy ??= { ...commandPolicy(state) };
    const budget = commandBudgets(state);
    root.append(element("p", "扣除底线后可调度 " + budget.money + " 钱、" + budget.grain + " 粮。各项占比合计 100%。"));
    root.append(group(select("国家方针", "priority", Object.entries(divisions), policy.priority, (value) => { policy.priority = value; }),
      select("人才任命", "personnel", Object.entries(personnel), policy.personnel, (value) => { policy.personnel = value; })),
    group(number("国库底线", "floorMoney", policy.floorMoney, 0, 600, (value) => { policy.floorMoney = value; }),
      number("储粮底线", "floorGrain", policy.floorGrain, 0, 600, (value) => { policy.floorGrain = value; })),
    group(...Object.entries(divisions).map(([key, label]) => number(label + " %", key, policy[key], 0, 100, (value) => { policy[key] = value; }))),
    group(button("发布国策", () => action((state) => saveCommandPolicy(state, policy), "全国额度和人才委任已发布。", "summary"), "publish", !canEdit),
      button("州郡与人才", () => { close(); politics(); }, "civil")));
  }

  function showCampaign(state, era, canEdit) {
    const row = state.highCommand.campaigns.find(({ id, side }) => id === selected && side === state.player);
    if (!row) { visit("summary"); return; }
    const commander = era.officers.find(({ key }) => key === row.commander)?.name ?? row.commander;
    const concluded = row.stage === "ended";
    const changed = (choice, label) => button(label, () => action((current) => decideCampaign(world, current, row.id, choice),
      "战役处置已登记。", "campaign"), choice, !canEdit);
    root.append(element("h3", name(row.target) + " · " + campaignGoals[row.goal]),
      element("p", campaignStages[row.stage] + " · " + commander + (concluded ? " · " + settlements[row.resolution] : row.mode === "delegate" ? " · 委任" : " · 接管")),
      element("p", "已用 " + row.spentMoney + " / " + row.money + " 钱 · " + row.spentGrain + " / " + row.grain + " 粮", "command-tally"));
    if (row.alert) root.append(element("p", row.alert.text, "command-alert"));
    if (!row.alert) {
      const last = state.highCommand.dispatches.filter(({ campaign }) => campaign === row.id).at(-1);
      if (last) root.append(element("p", last.text, "command-muted"));
    }
    const recent = visibleBattles(state).find(({ site }) => site === row.target || site === row.point);
    root.append(group(button("地图定位", () => { close(); locate(row.point); }, "locate"),
      button("战场调度", () => goBattle(row.target), "battlefield", concluded),
      button("联军安排", () => goBattle(row.target, "coalition"), "coalition", concluded),
      ...(recent ? [button("回看", () => { close(); report(recent.id); }, "replay")] : [])));
    if (!concluded && row.stage === "settlement") {
      const war = state.sandtable.wars.find(({ id }) => id === row.war);
      root.append(group(changed("secure", "驻防"), changed("relief", "撤军休养"),
        ...(war?.status === "fighting" && !row.negotiating ? [changed("negotiate", "提出和议")] : [])));
    } else if (!concluded) root.append(group(changed(row.mode === "delegate" ? "direct" : "delegate",
      row.mode === "delegate" ? "接管" : "交回委任"), button("修改授权", () => edit(row), "edit", !canEdit),
    row.alert ? changed("acknowledge", "继续执行") : changed("relief", "结束战役")));
    if (!concluded) root.append(group(button("推进一季", () => { close(); advance(); }, "advance", !canEdit)));
  }

  function alerts(state) {
    const rows = urgentCommands(state);
    const civil = (state.history.at(-1)?.entries ?? []).filter(({ faction, event }) => faction === state.player
      && ["military-warning", "military-mutiny", "court-warning", "crisis", "uprising", "independence", "loyalty-warning"].includes(event));
    for (const row of rows) {
      root.append(group(button(name(row.target) + " · " + commandAlerts[row.alert.kind], () => { selected = row.id; visit("campaign"); }, "alert-" + row.id),
        button("定位", () => { close(); locate(row.alert.point); }, "alert-map-" + row.id)));
      root.append(element("p", row.alert.text, "command-muted"));
    }
    if (civil.length) root.append(element("p", civil[0].text, "command-alert"), button("处置地方政局", () => { close(); politics(); }, "civil-alert"));
    if (!rows.length && !civil.length) root.append(element("p", "当前无待裁决急报。"));
  }

  function render() {
    if (!dialog.open) return;
    const { state, era } = snapshot();
    const canEdit = gameOutcome(state) === "ongoing";
    root.replaceChildren();
    navigation.replaceChildren();
    header.textContent = page === "authorize" ? "授权战役" : page === "permissions" ? "授权条件" : "全国军议";
    if (!state.highCommand) {
      root.append(element("p", "把现有城池、军团、战约和盟约带入 7.0「国势与战局」。"),
        button("启用全国军议", () => action(upgrade, "现有战局已启用全国军议。", "summary"), "upgrade", !canEdit));
      return;
    }
    for (const [key, label] of [["summary", "全国"], ["policy", "国策"], ["alerts", "急报"]]) {
      const tab = button(label, () => visit(key), key);
      tab.setAttribute("aria-pressed", String(page === key || key === "summary" && ["authorize", "campaign", "permissions"].includes(page)));
      navigation.append(tab);
    }
    root.dataset.page = page;
    if (page === "summary") summary(state, era, canEdit);
    if (page === "authorize") authorization(state, canEdit);
    if (page === "permissions") permissions();
    if (page === "policy") policies(state, canEdit);
    if (page === "campaign") showCampaign(state, era, canEdit);
    if (page === "alerts") alerts(state);
  }

  return { open, render, close };
}
