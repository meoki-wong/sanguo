import { advanceQuarter, cityName, factionName, firstCity, gameOutcome, seasons } from "./engine.js";
import { acknowledgeDynasty, courtStanding, dynastyNotices, dynastyPolicy, dynastyProvinces, jurisdiction, orderJurisdiction,
  provinceStages, saveDynastyPolicy } from "./dynasty.js";
import { authorizeProvince, calamities, commissionProgram, delegateRealm, dispatchCivilSupply, mandateGoals, nationalProjects, programTargets,
  projectCost, projectStages, provinceCandidates, restorationPolicies, reviseProgram, saveRestoration, supplyLabels, supplyTrace } from "./dynasty-economy.js";
import { answerDynastyTreaty, proposeDynastyTreaty, renegotiateDynastyTreaty, treatyOptions, treatyStatuses8 } from "./dynasty-treaties.js";
import { saveSuccession } from "./polity-governance.js";
import { livingSide } from "./polities-data.js";

const tabs = { summary: "总览", budget: "拨款", programs: "工程", local: "州郡", court: "朝局",
  supply: "粮运", treaties: "和约", history: "纪事" };
const projectStatuses = { active: "推进中", paused: "已暂停", complete: "已验收", cancelled: "已撤销" };
const seasonName = (turn) => (Math.floor(turn / 4) + 1) + "年" + seasons[turn % 4];
const options = (entries) => Object.entries(entries);
function make(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function createDynastyDesk(world, { snapshot, commit, upgrade, locate, military, talent, advance, batch, atlas, layer }) {
  const dialog = document.querySelector("#dynasty-dialog");
  const nav = dialog.querySelector("nav");
  const body = dialog.querySelector(".dynasty-body");
  const notice = dialog.querySelector(".dynasty-notice");
  let pane = "summary";
  let focusedCity;
  let focusedRegion;
  let overviewIndex = 0;
  let reportTurn;
  let programId = "";
  let programKind = "fields";
  let treatyId = "";
  let treatyRival = "";
  let amendment = false;
  let projection = null;

  const current = () => snapshot().state;
  const name = (city) => cityName(world, city);
  const line = (text) => make("p", text);
  const row = (...items) => { const group = make("div", undefined, "dynasty-row"); group.append(...items); return group; };
  function button(label, action, actionId, disabled = false) {
    const control = make("button", label);
    control.type = "button";
    if (actionId) control.dataset.dynastyAction = actionId;
    control.disabled = disabled;
    control.onclick = action;
    return control;
  }
  function select(label, choices, value, change) {
    const control = make("select");
    control.append(...choices.map(([id, name]) => new Option(name, id)));
    if (choices.some(([id]) => String(id) === String(value))) control.value = value;
    if (change) control.onchange = () => change(control.value);
    return field(label, control);
  }
  function field(label, control) {
    const wrapper = make("label", label, "dynasty-field");
    control.setAttribute("aria-label", label);
    wrapper.append(control);
    return { wrapper, get value() { return control.type === "number" ? control.valueAsNumber : control.type === "checkbox" ? control.checked : control.value; } };
  }
  function number(label, value, max) {
    const control = make("input");
    Object.assign(control, { type: "number", inputMode: "numeric", min: 0, max, step: 1, value });
    return field(label, control);
  }
  function check(label, value) {
    const control = make("input");
    control.type = "checkbox";
    control.checked = value;
    return field(label, control).wrapper;
  }
  function title(title, detail, className = "") {
    const card = make("header", undefined, "dynasty-heading " + className);
    card.append(make("h3", title), line(detail));
    return card;
  }
  function apply(operation, message) {
    try {
      const next = operation(current());
      projection = null;
      commit(next, message);
      notice.textContent = message;
      render();
    } catch (error) {
      notice.textContent = error.message;
    }
  }
  function show(type, city, region) {
    pane = type;
    if (city) focusedCity = city;
    if (region) focusedRegion = region;
    notice.textContent = "";
    render();
  }
  function close() { dialog.close(); }
  function open(type = "summary", city) {
    show(type, city);
    if (!dialog.open) dialog.showModal();
  }
  function leave(operation) { close(); operation(); }

  function summary(state, era) {
    const { treasury, grain } = state.factions[state.player];
    const provinces = dynastyProvinces(world, state);
    const governing = provinces.filter(({ mandate }) => mandate?.mode === "delegate").length;
    const alerts = [...dynastyNotices(state)].reverse();
    const issue = alerts[overviewIndex % Math.max(alerts.length, 1)];
    body.append(title(factionName(era, state.player) + " · 天下经略",
      "国库 " + treasury + " · 储粮 " + grain + " · 代管州郡 " + governing + "/" + provinces.length, "dynasty-summary"));
    if (issue) {
      const destination = { supply: "supply", calamity: "supply", province: "local", court: "court", treaty: "treaties" }[issue.kind];
      body.append(line(issue.text), row(button("处理急报", () => show(destination, issue.city, world.cities.find(({ key }) => key === issue.city)?.region), "notice"),
        button("已阅", () => apply((next) => acknowledgeDynasty(next, issue.id), "急报已阅。"), "ack"),
        ...(alerts.length > 1 ? [button("下一件 " + alerts.length, () => { overviewIndex++; render(); })] : [])));
    } else body.append(line("暂无急报。按当前拨款和委任方针推进。"));
    body.append(row(button("全国军议", () => leave(military), "military"),
      button("招揽人才", () => leave(talent), "talent"),
      button("粮运地图", () => leave(() => layer(focusedCity)), "layer"),
      button("一键委任", () => apply((next) => delegateRealm(world, next), "未设方针的州郡已按国策委任。"), "delegate-realm",
        gameOutcome(state) !== "ongoing" || provinces.every(({ mandate }) => mandate)),
      button("推进一季", () => leave(advance), "advance", gameOutcome(state) !== "ongoing"),
      button("推进一年", () => leave(batch), "batch", gameOutcome(state) !== "ongoing" || alerts.length > 0)));
  }

  function budget(state) {
    const policy = dynastyPolicy(state);
    const priority = select("支出优先", options(mandateGoals), policy.priority);
    const money = number("每季拨钱", policy.money, 999);
    const grain = number("每季拨粮", policy.grain, 999);
    const moneyFloor = number("留钱底线", policy.moneyFloor, 999);
    const grainFloor = number("留粮底线", policy.grainFloor, 999);
    const diplomacy = check("授权批准本方盟友的无割地和约", policy.diplomacy);
    const draft = () => ({ priority: priority.value, money: money.value, grain: grain.value,
      moneyFloor: moneyFloor.value, grainFloor: grainFloor.value, diplomacy: diplomacy.lastChild.checked });
    if (projection?.origin === state) {
      const records = document.createElement("div");
      records.className = "dynasty-forecast";
      for (const record of projection.rows) {
        records.append(line(seasonName(record.turn - 1) + " · 钱 " + record.treasury + delta(record.treasury - record.baseMoney)
          + " · 粮 " + record.grain + delta(record.grain - record.baseGrain) + " · 工程 " + record.projects + delta(record.projects - record.baseProjects)));
      }
      body.append(title("未来四季", "按规则推演。括号为相对当前预算的变化。"), records,
        row(button("返回拨款", () => { projection = null; render(); }, "back-budget"),
          button("采用这套拨款", () => apply((next) => saveDynastyPolicy(next, projection.policy), "全国拨款已调整。"), "apply-forecast")));
      return;
    }
    body.append(row(priority.wrapper, money.wrapper, grain.wrapper), row(moneyFloor.wrapper, grainFloor.wrapper, diplomacy),
      row(button("保存拨款", () => apply((next) => saveDynastyPolicy(next, draft()), "全国拨款已调整。"), "save-budget"),
        button("推演四季", () => {
          try {
            const policy = draft();
            const changed = saveDynastyPolicy(state, policy);
            projection = { origin: state, policy, rows: forecast(world, state, changed) };
            render();
          } catch (error) { notice.textContent = error.message; }
        }, "forecast")));
  }

  function programs(state) {
    const programs = state.dynasty.programs.filter(({ side }) => side === state.player).reverse();
    const list = select("查看工程", [["", "新立项"], ...programs.map((item) => [item.id, nationalProjects[item.kind] + " · " + name(item.city)])], programId,
      (value) => { programId = value; render(); });
    const item = programs.find(({ id }) => String(id) === programId);
    body.append(row(list.wrapper));
    if (item) {
      const active = ["active", "paused"].includes(item.status);
      body.append(title(nationalProjects[item.kind], name(item.city) + " · " + projectStatuses[item.status]
        + " · " + (item.made ? projectStages[Math.min(4, Math.ceil(item.made / 2)) - 1] + " " : "") + item.made + "/8季"),
      line("已支 " + item.spentMoney + "/" + item.money + " 钱 · " + item.spentGrain + "/" + item.grain + " 粮" + (item.last ? " · " + item.last : "")));
      if (active) {
        const money = number("钱上限", item.money, 800);
        const grain = number("粮上限", item.grain, 600);
        body.append(row(money.wrapper, grain.wrapper, button("改拨款", () =>
          apply((next) => reviseProgram(next, item.id, { money: money.value, grain: grain.value }), "项目拨款已调整。"), "revise-project")));
      }
      body.append(row(button("地图定位", () => locate(item.city), "locate"),
        ...(active ? [button(item.status === "paused" ? "继续" : "暂停", () => apply(
          (next) => reviseProgram(next, item.id, { action: item.status === "paused" ? "resume" : "pause" }), "工程进度已更新。"), "pause-project")] : [])));
      return;
    }
    const kind = select("工程类型", options(nationalProjects), programKind, (value) => { programKind = value; render(); });
    const choices = programTargets(world, state, kind.value).map(({ key, name }) => [key, name]);
    const target = select("实施城市", choices, focusedCity, (value) => { focusedCity = value; });
    const cost = projectCost(kind.value);
    const money = number("钱上限", cost.treasury * 8, 800);
    const grain = number("粮上限", cost.grain * 8, 600);
    body.append(row(kind.wrapper, target.wrapper), row(money.wrapper, grain.wrapper,
      button("批准立项", () => apply((next) => commissionProgram(world, next,
        { kind: kind.value, city: target.value, money: money.value, grain: grain.value }), "新工程将在下季支出。"), "new-project", !choices.length)),
    line("每个里程碑需拨款两季。临时紧缩将延后工程。"));
  }

  function local(state) {
    const provinces = dynastyProvinces(world, state);
    const item = provinces.find(({ region }) => region === focusedRegion) ?? provinces[0];
    if (!item) { body.append(line("无可委任州郡。")); return; }
    const province = select("州郡", provinces.map(({ region }) => [region, region]), item.region,
      (value) => { focusedRegion = value; render(); });
    const mandate = item.mandate ?? {};
    const steward = select("州牧", [["", "由在任太守兼领"], ...provinceCandidates(world, state, item.region).map(({ key, name }) => [key, name])], mandate.steward);
    const goal = select("授权方针", options(mandateGoals), mandate.goal);
    const money = number("季拨钱", mandate.money ?? 10, 70);
    const grain = number("季拨粮", mandate.grain ?? 6, 70);
    const dispatch = check("准许运粮", mandate.dispatch ?? true);
    const appoint = check("准许补任", mandate.appoint ?? true);
    const action = select("地方处置", options(jurisdiction), item.pending ?? "relieve");
    body.append(row(province.wrapper, steward.wrapper, goal.wrapper), line(provinceStages[item.stage] + " · 事权 " + item.authority + " · 民怨 " + item.conflict
      + (item.pending ? " · 待" + jurisdiction[item.pending] : "") + (mandate.mode === "delegate" ? " · 已委任" : "")),
    row(money.wrapper, grain.wrapper, dispatch, appoint), row(button("保存委任", () => apply((next) => authorizeProvince(world, next, {
      region: item.region, steward: steward.value || null, goal: goal.value, money: money.value, grain: grain.value,
      dispatch: dispatch.lastChild.checked, appoint: appoint.lastChild.checked, mode: "delegate",
    }), "州牧将按授权管理本州。"), "delegate"), action.wrapper,
    button("下令", () => apply((next) => orderJurisdiction(world, next, item.region, action.value), "下季执行地方处置。"), "jurisdiction")));
  }

  function court(state, era) {
    const { seat, candidates, legitimacy, support } = courtStanding(world, state);
    if (!seat) { body.append(line("本方尚未设立治所。")); return; }
    const members = [["", "未指定"], ...candidates.filter(({ key }) => key !== seat.head).map(({ key, name }) => [key, name])];
    const heir = select("继承人", members, seat.heir);
    const regent = select("摄政", members, seat.regent);
    body.append(title("治所 · " + name(firstCity(world, state)), "正统 " + legitimacy + " · 朝臣支持 " + support + " · " + seasonName(seat.due) + "交接"),
      row(heir.wrapper, regent.wrapper, button("确认人选", () => apply((next) => saveSuccession(world, era, next,
        { heir: heir.value || null, regent: regent.value || null }), "已登记继任安排。"), "succession")),
      line("摄政可在继承人威望不足时代理朝政。"));
  }

  function supply(state) {
    const towns = world.cities.filter(({ key }) => state.cities[key].owner === state.player);
    const city = select("本方城市", towns.map(({ key, name }) => [key, name]), focusedCity, (value) => { focusedCity = value; render(); });
    if (!city.value) { body.append(line("无本方粮仓。")); return; }
    const key = city.value;
    const info = supplyTrace(world, state, key);
    const restore = state.dynasty.restorations[key];
    const route = info.incoming ? "粮队 " + info.incoming.amount + " · 当前在" + name(info.incoming.route[info.incoming.cursor])
      : info.depotOrigin ? "可从" + name(info.depotOrigin) + "调运" : "";
    body.append(row(city.wrapper, button("看地图", () => leave(() => layer(key)), "supply-map")),
      title(supplyLabels[info.status], "本季产粮 " + info.production + " · 地方库存 " + info.depot
        + (info.damage ? " · " + calamities[info.damage.kind] : ""), "dynasty-supply"),
      ...(route || info.weather ? [line([route, info.weather].filter(Boolean).join(" · "))] : []),
      row(button("调运 18 粮", () => apply((next) => dispatchCivilSupply(world, next, key), "调运已下令，地图可见粮队。"),
        "dispatch", Boolean(info.incoming) || !info.depotOrigin)));
    if (restore || state.cities[key].occupation) {
      const mode = select("战后治理", options(restorationPolicies), restore?.mode);
      body.append(row(mode.wrapper, button("确认接管", () => apply((next) => saveRestoration(next, key, mode.value), "接管方针已调整。"), "restore")));
    }
  }

  function treaties(state, era) {
    const treaties = state.dynasty.treaties.filter(({ from, to }) => [from, to].includes(state.player)).reverse();
    const other = (row) => row.from === state.player ? row.to : row.from;
    const sideName = (side) => factionName(era, side);
    const chosen = treaties.find(({ id }) => String(id) === treatyId);
    const picker = select("和约档案", [["", "起草新和约"], ...treaties.map((item) => [item.id, sideName(other(item)) + " · " + treatyStatuses8[item.status]])],
      treatyId, (value) => { treatyId = value; amendment = false; render(); });
    body.append(row(picker.wrapper));
    if (chosen && !amendment) {
      const terms = [chosen.passage ? "通关" : "", chosen.defense ? "共同守备" : "", chosen.cede ? "交割" + name(chosen.cede) : ""].filter(Boolean);
      body.append(title(sideName(chosen.from) + " → " + sideName(chosen.to), treatyStatuses8[chosen.status] + " · 约期 " + chosen.seasons
        + " 季 · 季付 " + chosen.payment + " 钱" + (terms.length ? " · " + terms.join("、") : "")),
      line("累计已付 " + chosen.paid + " 钱 · 连续欠付 " + chosen.missed + " 期" + (chosen.vote !== null && chosen.status === "offered" ? " · 已登记答复" : "")));
      const choices = [];
      if (chosen.to === state.player && chosen.status === "offered") for (const vote of [true, false]) choices.push(button(vote ? "接受和约" : "拒绝",
        () => apply((next) => answerDynastyTreaty(next, chosen.id, vote), "已登记答复，下季生效。"), vote ? "ratify" : "reject"));
      if (chosen.status === "offered" || chosen.status === "active" && chosen.missed) choices.push(
        button("重谈条款", () => { amendment = true; render(); }, "renegotiate"));
      body.append(row(...choices));
      return;
    }
    const rivals = Object.keys(state.factions).filter((key) => key !== state.player && livingSide(state, key)
      && (chosen ? key === other(chosen) : treatyOptions(world, state, key).available));
    if (!rivals.length) { body.append(line("暂无可提出新和约的势力。")); return; }
    const rival = select("交涉势力", rivals.map((id) => [id, sideName(id)]), treatyRival, (value) => { treatyRival = value; render(); });
    const allowed = treatyOptions(world, state, rival.value);
    const duration = number("停战季数", chosen?.seasons ?? 5, 12);
    const payment = number("季付钱", chosen?.payment ?? 8, 50);
    const passage = check("开放通路", chosen?.passage ?? true);
    const defense = check("共同守备", chosen?.defense ?? false);
    const terms = chosen ? treatyOptions(world, { ...state, dynasty: { ...state.dynasty, treaties: state.dynasty.treaties.filter(({ id }) => id !== chosen.id) } }, rival.value) : allowed;
    const cede = select("交割属城", [["", "无"], ...terms.cities.map(({ key, name }) => [key, name])], chosen?.cede);
    const post = select("仅开放指定关隘", [["", "不限"], ...terms.posts.map(({ key, name }) => [key, name])], chosen?.post);
    body.append(row(rival.wrapper, duration.wrapper, payment.wrapper), row(cede.wrapper, post.wrapper, passage, defense),
      row(button("递交和约", () => apply((next) => {
        const draft = { to: rival.value, seasons: duration.value, payment: payment.value, passage: passage.lastChild.checked,
          defense: defense.lastChild.checked, cede: cede.value || null, post: post.value || null };
        return chosen ? renegotiateDynastyTreaty(world, next, chosen.id, draft) : proposeDynastyTreaty(world, next, draft);
      }, "使者已携条款出发。"), "propose")));
  }

  function history(state) {
    const dates = [null, ...state.dynasty.timelines.map(({ turn }) => turn).reverse()];
    const time = select("纪事时点", dates.map((turn) => [turn ?? "", turn ? seasonName(turn - 1) : "当前"]), reportTurn,
      (value) => { reportTurn = value; render(); });
    const frame = state.dynasty.timelines.find(({ turn }) => String(turn) === time.value);
    const reports = state.dynasty.dispatches.filter((row) => (row.side === state.player || row.participants?.includes(state.player))
      && row.turn === (frame?.turn ?? state.turn)).slice(-3).reverse();
    body.append(row(time.wrapper, button("在地图回看", () => leave(() => atlas(frame)), "replay-map")),
      ...(frame ? [line("当季在途粮队 " + frame.freights.length + " · 野战部队 " + frame.front.length + " · 受灾或待整顿 " + frame.distress.length)] : []),
      ...(reports.length ? reports.map(({ text }) => line(text)) : [line("这一季没有新的天下经略奏报。")]));
  }

  const renderers = { summary, budget, programs, local, court, supply, treaties, history };
  function render() {
    const { state, era } = snapshot();
    body.replaceChildren();
    nav.replaceChildren();
    if (!state.dynasty) {
      body.append(title("升级至天下秩序", "沿用现有城池、武将、军团、议约和奏报。"),
        button("升级当前存档", () => apply(upgrade, "存档已升级至 8.0。"), "upgrade"));
      return;
    }
    nav.append(...options(tabs).map(([key, text]) => {
      const tab = button(text, () => show(key), key);
      tab.setAttribute("aria-pressed", String(pane === key));
      return tab;
    }));
    renderers[pane](state, era);
  }
  return { open, close, render() { if (dialog.open) render(); } };
}

function delta(value) { return value === 0 ? "" : "（" + (value > 0 ? "+" : "") + value + "）"; }

function forecast(world, baseline, alternative) {
  return Array.from({ length: 4 }, () => {
    if (gameOutcome(baseline) === "ongoing") baseline = advanceQuarter(world, baseline);
    if (gameOutcome(alternative) === "ongoing") alternative = advanceQuarter(world, alternative);
    const progress = (state) => state.dynasty.programs.filter(({ side }) => side === state.player).reduce((sum, row) => sum + row.made, 0);
    const before = baseline.factions[baseline.player];
    const after = alternative.factions[alternative.player];
    return { turn: alternative.turn, treasury: after.treasury, grain: after.grain,
      baseMoney: before.treasury, baseGrain: before.grain, projects: progress(alternative), baseProjects: progress(baseline) };
  });
}
