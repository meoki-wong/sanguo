import { cityName, factionName, gameOutcome, seasons } from "./engine.js";
import { armyByOfficer, withdrawalRoute } from "./armies.js";
import { dynastyProvinces } from "./dynasty.js";
import { staffChoices } from "./high-command.js";
import { strategicPost } from "./sandtable-posts.js";
import { acknowledgeStrategy9, amendFront9, charterFront9, eligibleReserve9, frontAllocations9, objectives9, petitionMeasure9,
  publishStrategy9, sendReserve9, stateMeasures9, strategicAims, strategicAlerts9, strategicFronts9, strategicProgress9,
  theaterOptions9, theaterRoles9 } from "./strategy-nine.js";

const pages = { overview: "总览", aims: "方略", fronts: "战区", reserve: "预备军", regions: "地方", reports: "纪事" };
const outcomes = { travel: "行军中", arrived: "已编入", cancelled: "已中止" };
const turnName = (turn) => (Math.floor(turn / 4) + 1) + "年" + seasons[turn % 4];
const labels = (items) => Object.entries(items);

function make(tag, title, className) {
  const node = document.createElement(tag);
  if (title !== undefined) node.textContent = title;
  if (className) node.className = className;
  return node;
}

export function createStrategyDesk(world, actions) {
  const dialog = document.querySelector("#strategy-nine-dialog");
  const nav = dialog.querySelector("nav");
  const body = dialog.querySelector(".dynasty-body");
  const status = dialog.querySelector(".dynasty-notice");
  let pane = "overview";
  let frontId;
  let newRole = "diversion";
  let newSite;
  let alertIndex = 0;
  let inspectedTurn;
  let selectedRegion;
  let pendingPolicy;
  let comparison = null;
  const campaignFor = (state, row) => state.highCommand.campaigns.find(({ id }) => id === row?.campaign);
  const where = (key) => strategicPost(key)?.name ?? cityName(world, key);
  const player = () => actions.snapshot().state;
  const close = () => dialog.close();
  const leave = (method, ...args) => { close(); actions[method](...args); };
  const line = (text) => make("p", text);
  function row(...nodes) {
    const block = make("div", undefined, "dynasty-row");
    block.append(...nodes);
    return block;
  }
  function button(text, id, invoke, disabled = false) {
    const control = make("button", text);
    Object.assign(control, { type: "button", onclick: invoke, disabled });
    control.dataset.strategyAction = id;
    return control;
  }
  function field(label, control) {
    const wrap = make("label", label, "dynasty-field");
    control.setAttribute("aria-label", label);
    wrap.append(control);
    return { wrap, control, get value() { return control.type === "number" ? control.valueAsNumber
      : control.type === "checkbox" ? control.checked : control.value; } };
  }
  function select(label, options, value, change) {
    const control = make("select");
    control.append(...options.map(([key, name]) => new Option(name, key)));
    if (options.some(([key]) => String(key) === String(value))) control.value = String(value);
    if (change) control.onchange = () => change(control.value);
    return field(label, control);
  }
  function number(label, value, min, max) {
    const control = make("input");
    Object.assign(control, { type: "number", inputMode: "numeric", value, min, max, step: 1 });
    return field(label, control);
  }
  function flag(label, value) {
    const control = make("input");
    Object.assign(control, { type: "checkbox", checked: value });
    return field(label, control);
  }
  function banner(text, subtitle, illustration = false) {
    const block = make("header", undefined, "dynasty-heading" + (illustration ? " strategy-nine-banner" : ""));
    block.append(make("h3", text), line(subtitle));
    return block;
  }
  function apply(operation, message, then) {
    try {
      const next = operation(player());
      if (then) then(next);
      actions.commit(next, message);
      status.textContent = message;
      render();
    } catch (error) { status.textContent = error.message; }
  }
  function open(type = "overview", id) {
    show(type, id);
    if (!dialog.open) dialog.showModal();
  }
  function show(type, id) {
    pane = type;
    if (id !== undefined) frontId = id;
    status.textContent = "";
    render();
  }
  function overview(state, era) {
    const plan = state.strategy9.plans[state.player];
    const alerts = [...strategicAlerts9(state)].reverse();
    const active = alerts[alertIndex % Math.max(alerts.length, 1)];
    const theaters = strategicFronts9(state);
    body.append(banner(factionName(era, state.player) + " · 全国方略",
      "国库 " + state.factions[state.player].treasury + " · 储粮 " + state.factions[state.player].grain + " · 战区 " + theaters.length + "/3", true));
    if (plan) {
      const progress = [plan.primary, plan.secondary].map((goal) => strategicProgress9(world, state, goal));
      body.append(line(progress.map(({ label, value, target }) => label + " " + value + "/" + target).join("　")));
    } else body.append(line("先定三年主次目标，再把钱粮和兵员交给战区及州郡。"));
    if (active) {
      const handlers = { review: "aims", term: "aims", dissent: "regions", appropriation: "aims" };
      body.append(line(active.text), row(button("处理", "handle", () => {
        if (handlers[active.kind]) show(handlers[active.kind]);
        else if (active.front && theaters.some(({ id }) => id === active.front)) show("fronts", active.front);
        else leave("locate", active.city);
      }), button("已阅", "ack", () => apply((next) => acknowledgeStrategy9(next, active.id), "急报已阅。")),
      ...(alerts.length > 1 ? [button("下一件", "next-alert", () => { alertIndex++; render(); })] : [])));
    }
    body.append(row(button("州郡与人才", "dynasty", () => leave("dynasty", "local")),
      button("和约", "treaty", () => leave("dynasty", "treaties")),
      button("战区图", "map", () => leave("map")),
      button("推进一季", "advance", () => leave("advance"), gameOutcome(state) !== "ongoing"),
      button("连推一年", "batch", () => leave("batch"), gameOutcome(state) !== "ongoing" || alerts.length > 0)));
  }
  function aims(state) {
    const saved = state.strategy9.plans[state.player];
    const permitted = objectives9(world, state);
    if (comparison && comparison.origin !== state) comparison = null;
    if (comparison) {
      body.append(banner("战区额度预演", "括号内为比当前方略增加或减少的额度。"));
      for (const pair of comparison.pairs) body.append(line(pair.text));
      body.append(row(button("采用方案", "adopt", () => apply((next) => publishStrategy9(world, next, comparison.draft), "方略已颁布。",
        () => { comparison = null; pendingPolicy = null; })), button("返回调整", "edit-policy", () => { comparison = null; render(); }),
      ...(comparison.pairs.some(({ campaign }) => campaign) ? [button("地图看影响", "impact", () => leave("impact", comparison.pairs))] : [])));
      return;
    }
    const draft = pendingPolicy ?? saved ?? { primary: { kind: permitted.corridor.length ? "corridor" : "stability" },
      secondary: { kind: permitted.corridor.length ? "stability" : "concord" }, money: 32, grain: 42, manpower: 1200, transport: 3, negotiate: false };
    const models = {};
    const recalc = () => {
      pendingPolicy = read();
      render();
    };
    for (const [key, text] of [["primary", "主目标"], ["secondary", "次目标"]]) {
      const kind = select(text, labels(strategicAims).filter(([name]) => permitted[name].length || draft[key]?.kind === name), draft[key]?.kind, recalc);
      const choices = permitted[kind.value].map(({ key: entry, name }) => [entry, name ?? where(entry)]);
      if (draft[key].key && kind.value === draft[key].kind && !choices.some(([entry]) => entry === draft[key].key)) {
        choices.push([draft[key].key, strategicProgress9(world, state, draft[key]).label]);
      }
      const target = select(text + "地点", choices, draft[key].key);
      models[key] = { kind, target };
    }
    const money = number("季拨钱", draft.money, 5, 999);
    const grain = number("季拨粮", draft.grain, 5, 999);
    const manpower = number("季拨兵员", draft.manpower, 0, 2400);
    const transport = number("路网运力", draft.transport, 1, 8);
    const negotiate = flag("授权无赔款停战", draft.negotiate);
    function read() {
      const aims = Object.fromEntries(Object.entries(models).map(([key, { kind, target }]) => [key,
        { kind: kind.value, key: permitted[kind.value]?.some(({ key }) => key === target.value)
          || draft[key].kind === kind.value && draft[key].key === target.value ? target.value : undefined }]));
      return { ...aims, money: money.value, grain: grain.value, manpower: manpower.value, transport: transport.value, negotiate: negotiate.value };
    }
    body.append(row(models.primary.kind.wrap, models.primary.target.wrap, models.secondary.kind.wrap, models.secondary.target.wrap),
      row(money.wrap, grain.wrap, manpower.wrap, transport.wrap),
      row(negotiate.wrap, button("发布方略", "publish", () => apply((next) => publishStrategy9(world, next, read()), "三年方略已颁布。",
        () => { pendingPolicy = null; })), button("对比额度", "compare", () => {
        try {
          const draft = read();
          const proposed = publishStrategy9(world, state, draft);
          const old = frontAllocations9(state);
          const diff = (before, after) => after === before ? "" : "（" + (after - before > 0 ? "+" : "") + (after - before) + "）";
          const pairs = frontAllocations9(proposed).map((front) => {
            const baseline = old.find(({ id }) => id === front.id);
            return { campaign: front.campaign, money: front.money - (baseline?.money ?? 0), grain: front.grain - (baseline?.grain ?? 0),
              text: where(campaignFor(state, front).target) + " · 钱 " + front.money + diff(baseline?.money ?? 0, front.money)
              + " · 粮 " + front.grain + diff(baseline?.grain ?? 0, front.grain)
              + " · 兵员 " + front.manpower + diff(baseline?.manpower ?? 0, front.manpower) };
          });
          if (!pairs.length) pairs.push({ text: "待设战区 · 每季钱 " + draft.money + " · 粮 " + draft.grain + " · 兵员 " + draft.manpower });
          pairs.push({ text: "路网每季可优先调度 " + draft.transport + " 支队伍。" });
          comparison = { pairs, draft, origin: state };
          pendingPolicy = draft;
          render();
        } catch (error) { status.textContent = error.message; }
      })));
    if (saved) body.append(line("期限至" + turnName(saved.until - 1) + " · 年度复核 " + turnName(saved.review - 1)));
  }
  function frontPicker(state, selectNew) {
    const rows = strategicFronts9(state);
    const data = rows.map((front) => [front.id, theaterRoles9[front.role] + " · " + where(campaignFor(state, front).target)]);
    const item = select("战区", [...(selectNew ? [["", "新设战区"]] : []), ...data], frontId,
      (value) => { frontId = value ? Number(value) : undefined; render(); });
    return { item, chosen: rows.find(({ id }) => id === Number(item.value)) };
  }
  function fronts(state, era) {
    if (!state.strategy9.plans[state.player]) {
      body.append(banner("待制定全国方略", "战区从同一套钱粮和兵员额度取得授权。"),
        button("制定方略", "to-aims", () => show("aims")));
      return;
    }
    const { item, chosen } = frontPicker(state, true);
    body.append(row(item.wrap));
    if (chosen) {
      const command = campaignFor(state, chosen);
      const funds = frontAllocations9(state).find(({ id }) => id === chosen.id);
      const officer = (key) => era.officers.find((entry) => entry.key === key)?.name ?? key;
      const people = staffChoices(world, state, command.goal, command.target, command.id);
      const priority = number("调度优先级", chosen.priority, 1, 5);
      const replacement = select("战区统帅", [[command.commander, officer(command.commander)], ...people.filter(({ officer }) => officer !== command.commander)
        .map(({ officer, name }) => [officer, name])], command.commander);
      body.append(line((chosen.status === "paused" ? "已暂停" : "受命执行") + " · 集结地 " + where(chosen.seat)
        + " · 季拨 " + funds.money + " 钱 / " + funds.grain + " 粮 / " + funds.manpower + " 兵员"),
      row(replacement.wrap, priority.wrap, button("保存授权", "save-front", () => apply((next) => amendFront9(world, next, chosen.id,
        { priority: priority.value, status: chosen.status, commander: replacement.value }), "战区授权已更新。"))),
      row(button(chosen.status === "paused" ? "恢复" : "暂停", "pause", () => apply((next) => amendFront9(world, next, chosen.id,
        { priority: chosen.priority, status: chosen.status === "paused" ? "active" : "paused" }), "战区状态已更新。")),
      button("会战", "battle", () => leave("battle", command.target)),
      button("军议处置", "military", () => leave("military", command.id)),
      button("地图定位", "locate", () => leave("locate", command.point))));
      return;
    }
    const role = select("战区任务", labels(theaterRoles9), newRole, (value) => { newRole = value; newSite = null; render(); });
    const objectives = theaterOptions9(world, state, role.value);
    const target = select("战区目标", objectives.map(({ key, name }) => [key, name ?? where(key)]), newSite,
      (value) => { newSite = value; render(); });
    const objective = objectives.find(({ key }) => key === target.value);
    const people = objective ? staffChoices(world, state, objective.goal, objective.key) : [];
    const commander = select("指定统帅", people.map(({ officer, name, city }) => [officer, name + " · " + where(city)]));
    const priority = number("优先级", 3, 1, 5);
    const term = number("期限（季）", 8, 2, 12);
    const retire = number("撤兵线", 400, 200, 2400);
    body.append(row(role.wrap, target.wrap, commander.wrap), row(priority.wrap, term.wrap, retire.wrap,
      button("颁发战区授权", "charter", () => apply((next) => charterFront9(world, next, {
        role: role.value, target: target.value, commander: commander.value, priority: priority.value, retire: retire.value, term: term.value,
      }), "战区已接到授权。", (next) => { frontId = next.strategy9.fronts.at(-1).id; }),
      !people.length || strategicFronts9(state).length >= 3)));
  }
  function reserve(state, era) {
    const { item, chosen } = frontPicker(state, false);
    if (!chosen) { body.append(line("建立战区后，可从全国调入预备军或护运军团。")); return; }
    const officer = (key) => era.officers.find((person) => person.key === key)?.name ?? key;
    const choices = eligibleReserve9(state, chosen.id).flatMap((army) => {
      const route = withdrawalRoute(world, state, army, chosen.seat);
      return route ? [[army.officer, officer(army.officer) + " · " + Math.max(0, route.length - 1) + "季"]] : [];
    });
    const unit = select("调拨军团", choices);
    const duty = select("抵达任务", [["reserve", "后备"], ["escort", "护运"]]);
    const latest = state.strategy9.movements.findLast(({ front }) => front === chosen.id);
    body.append(row(item.wrap, unit.wrap, duty.wrap),
      line(latest ? officer(latest.officer) + " · " + outcomes[latest.status] + (latest.status === "travel" ? " · 预计余 " + latest.eta + " 季" : "") :
        choices.length ? "预备军出发后，原战区立即失去这支兵力。" : "本季没有可调动的完整军团。"),
      row(button("签发调拨令", "send", () => apply((next) => sendReserve9(world, next, {
        front: chosen.id, officer: unit.value, role: duty.value,
      }), "预备军调令已签发。"), !choices.length), button("地图定位", "locate", () => leave("locate", chosen.seat))));
  }
  function regions(state) {
    const provinces = dynastyProvinces(world, state);
    const data = state.strategy9.support[state.player] ?? { court: 70, officers: 70, districts: 70 };
    const region = select("交涉州郡", provinces.map(({ region }) => [region, region]), selectedRegion, (value) => { selectedRegion = value; });
    const action = select("朝廷决议", labels(stateMeasures9));
    body.append(banner("政军支持", "朝廷 " + data.court + " · 将领 " + data.officers + " · 地方 " + data.districts),
      row(region.wrap, action.wrap, button("颁发决议", "measure", () => apply((next) => petitionMeasure9(world, next, action.value, region.value),
        "朝廷决议已颁发。"), !region.value)),
      row(button("州牧委任", "governors", () => leave("dynasty", "local")),
        button("重建与粮运", "rebuild", () => leave("dynasty", "supply")),
        button("继嗣安排", "court", () => leave("dynasty", "court"))));
  }
  function reports(state) {
    const records = [...state.strategy9.records].reverse();
    const time = select("战略纪事", records.map(({ turn }) => [turn, turnName(turn - 1)]), inspectedTurn,
      (value) => { inspectedTurn = Number(value); render(); });
    const record = records.find(({ turn }) => turn === Number(time.value));
    if (!record) { body.append(line("发布方略后，按季记录军费、调粮、战损、推进和反制。")); return; }
    const events = state.strategy9.reports.filter(({ turn }) => turn === record.turn).slice(-2);
    body.append(row(time.wrap, button("当季地图", "timeline", () => leave("timeline", record.turn))),
      banner("钱 " + record.money + " · 粮 " + record.grain + " · 战损 " + record.losses, record.operations.length + " 个战区记录"),
      ...events.map(({ text }) => line(text)), row(button("战报与回放", "replay", () => leave("replay"))));
  }
  const renderers = { overview, aims, fronts, reserve, regions, reports };
  function render() {
    const { state, era } = actions.snapshot();
    nav.replaceChildren();
    body.replaceChildren();
    if (!state.strategy9) {
      body.append(banner("诸侯争衡", "兼容现有军团、粮运、工程、州郡和和约。"),
        button("升级当前存档", "upgrade", () => apply(actions.upgrade, "当前存档已启用 9.0。")));
      return;
    }
    nav.append(...labels(pages).map(([key, name]) => {
      const tab = button(name, key, () => show(key));
      tab.setAttribute("aria-pressed", String(pane === key));
      return tab;
    }));
    renderers[pane](state, era);
  }
  return { open, close, render() { if (dialog.open) render(); } };
}
