import { armyByOfficer, armyPhases, armyStatus, commandArmy } from "./armies.js";
import { availableAttackers, cityName, factionName, firstCity, gameOutcome, queueOrder } from "./engine.js";
import { treatyWith } from "./diplomacy.js";
import { answerReinforcementRevision, armyObservation, battleLocation, battleMissions, battleObjectives, battleRoles, fieldProjection, formationKinds, formationOf,
  musterBattlePlan, requestReinforcement, saveBattlePlan, serviceFormation, visibleBattles } from "./frontline.js";
import { edgeWeather, seasonWeather } from "./landscape-terrain.js";
import { forceColor } from "./map.js";
import { strategicPost } from "./sandtable-posts.js";
import { renderBattleScene } from "./battle-scene.js";
import { commandCareer } from "./high-command.js";
import { townIntel } from "./war-intel.js";

const verbs = { contact: "野战遭遇", withdrawal: "撤退接敌", siege: "城下攻守", relief: "援军策应", post: "据点争夺" };
const phases = ["接报", "接战", "战果"];
const numbers = new Intl.NumberFormat("zh-CN");
function element(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, onclick, disabled = false) {
  const node = element("button", text);
  Object.assign(node, { type: "button", onclick, disabled });
  return node;
}

function selector(label, key, values, previous) {
  const field = element("label", label);
  const input = element("select");
  input.dataset.battle = key;
  input.replaceChildren(...values.map(([value, name]) => new Option(name, value)));
  if (values.some(([value]) => String(value) === String(previous))) input.value = String(previous);
  field.append(input);
  return { field, input };
}

function group(...nodes) {
  const row = element("div", "", "frontline-row");
  row.append(...nodes);
  return row;
}

function fieldBoard(options, heading, context) {
  const { canvas, terrainLabel } = renderBattleScene(options);
  const board = element("section", "", "battlefield-board");
  board.setAttribute("aria-label", heading);
  const view = element("div", "", "battlefield-visual");
  const title = element("div", "", "battlefield-caption");
  const labels = element("div");
  labels.append(element("span", terrainLabel), element("strong", heading));
  title.append(labels);
  if (context) title.append(element("span", context, "battlefield-context"));
  const places = element("div", "", "battlefield-locations");
  places.append(element("span", options.from), element("span", options.to));
  view.append(canvas, title, places);
  board.append(view);
  return board;
}

function forceCard(side, era, step) {
  const card = element("section", "", "battlefield-force");
  card.style.setProperty("--side-color", side.color);
  const identity = element("div", "", "battlefield-force-name");
  const officer = era.officers.find(({ key }) => key === side.officer)?.name;
  identity.append(element("strong", factionName(era, side.faction)), element("span", officer ?? "驻防守军"));
  const stats = element("div", "", "battlefield-numbers");
  const metrics = step === 2 ? [["剩余", side.troops - side.loss], ["损失", side.loss]]
    : step === 1 ? [["兵力", side.troops], ["战力", side.strength]] : [["兵力", side.troops]];
  for (const [title, value] of metrics) {
    const metric = element("div");
    metric.append(element("span", title), element("strong", numbers.format(Math.max(0, value))));
    stats.append(metric);
  }
  card.append(identity, stats);
  if (step === 2) {
    const bar = element("div", "", "battlefield-strength");
    const remaining = element("span");
    remaining.style.width = (side.troops ? Math.max(0, (side.troops - side.loss) / side.troops * 100) : 0) + "%";
    bar.append(remaining);
    card.append(bar);
  }
  return card;
}

export function createFrontlineDesk(world, { snapshot, commit, upgrade, armyDetails, locate, advance }) {
  const dialog = document.getElementById("frontline-dialog");
  const body = dialog.querySelector(".frontline-body");
  const tabbar = dialog.querySelector(".frontline-tabs");
  const feedback = dialog.querySelector(".frontline-feedback");
  const name = (key) => strategicPost(key)?.name ?? cityName(world, key);
  let pane = "plan";
  let selected = {};
  let draft;
  let step = 0;
  let focusedFormation = null;
  let playback = null;

  function perform(update, confirmation) {
    try {
      const next = update(snapshot().state);
      feedback.textContent = confirmation;
      feedback.dataset.error = "false";
      commit(next, confirmation);
    } catch (error) {
      feedback.textContent = error.message;
      feedback.dataset.error = "true";
    }
  }

  function open(nextPane = "plan", key) {
    pane = nextPane;
    selected = nextPane === "formation" ? { officer: key } : nextPane === "replay" ? { battle: key } : { objective: key };
    if (nextPane === "coalition") {
      const { state } = snapshot();
      selected.plan = state.frontline?.plans.find(({ objective, faction }) => objective === key && faction === state.player)?.id;
    }
    draft = undefined;
    step = 0;
    focusedFormation = null;
    clearInterval(playback);
    feedback.textContent = "";
    if (!dialog.open) dialog.showModal();
    render();
  }

  function assembly(state, era, objective) {
    const target = battleLocation(state, objective);
    const queued = state.orders.some((order) => order.type === "mobilize" && order.to === target);
    if (queued) return element("p", "集结令已登记，推进一季后即可编入会战。");
    const order = musterBattlePlan(world, state, objective);
    if (!order) return element("p", "当前没有可直接调往目标的新军，可从地图查看集结点。");
    const { from: key, officer, travel, troops } = order;
    const label = queued ? "已列入本季政令" : "在" + name(key) + "集结";
    return group(element("p", era.officers.find(({ key }) => key === officer)?.name + " · " + troops.toLocaleString("zh-CN")
      + " 人 · " + (travel === "water" ? "水军" : "陆军")), button(label, () => perform((current) => queueOrder(world, current, order),
      "集结令已登记，结算本季后军团入列。")));
  }

  function plans(state, era) {
    const saved = state.frontline.plans.filter(({ faction }) => faction === state.player);
    const fixed = selected.objective;
    const lookup = (id) => saved.find((row) => row.id === Number(id));
    if (!draft) {
      const row = selected.plan === null ? null : lookup(selected.plan) ?? (fixed ? saved.find(({ objective }) => objective === fixed) : saved[0]);
      const mission = row?.mission ?? (fixed && !battleObjectives(world, state).some(({ key }) => key === fixed) ? "defense" : "offensive");
      draft = row ? structuredClone(row) : { mission, objective: fixed, mode: "delegate", reserve: 35, units: [] };
    }
    const officers = new Map(era.officers.map(({ key, name }) => [key, name]));
    const choice = selector("行动", "plan", [["", "新建会战"], ...saved.map(({ id, objective, mission }) => [id, battleMissions[mission] + name(objective)])], draft.id);
    choice.input.onchange = () => {
      selected.plan = Number(choice.input.value) || null;
      selected.objective = undefined;
      draft = undefined;
      render();
    };
    const mission = selector("目标类型", "mission", Object.entries(battleMissions), draft.mission);
    mission.input.onchange = () => {
      draft.mission = mission.input.value;
      render();
    };
    const choices = battleObjectives(world, state, state.player, draft.mission);
    if (draft.id && lookup(draft.id)?.mission === draft.mission && !choices.some(({ key }) => key === draft.objective)) {
      choices.unshift({ key: draft.objective, name: name(draft.objective) });
    }
    if (!choices.some(({ key }) => key === draft.objective)) draft.objective = choices[0]?.key;
    const objective = selector("目标", "objective", choices.map(({ key, name }) => [key, name]), draft.objective);
    objective.input.onchange = () => {
      draft.objective = objective.input.value;
      render();
    };
    body.append(group(choice.field, mission.field, objective.field));
    if (!draft.objective) {
      body.append(element("p", "当前没有符合条件的目标。"));
      return;
    }
    const available = state.frontline.formations.filter((row) => row.faction === state.player && row.ended === null
      && !saved.some((plan) => plan.id !== draft.id && plan.units.some(({ id }) => id === row.id)));
    draft.units = draft.units.filter(({ id }) => available.some((row) => row.id === id));
    const post = strategicPost(draft.objective);
    const city = battleLocation(state, draft.objective);
    const lead = draft.units.find(({ role }) => role === "advance");
    const armyForForecast = armyByOfficer(state, available.find(({ id }) => id === lead?.id)?.officer);
    const origin = armyForForecast?.location ?? post?.seat ?? firstCity(world, state);
    const fieldTarget = post ? (origin === post.to ? post.seat : post.to) : city;
    const originTerrain = origin === fieldTarget ? null : edgeWeather(state, origin, fieldTarget).terrain;
    const intel = townIntel(state, state.player, fieldTarget);
    const defenders = state.strategy9 && state.cities[fieldTarget].owner !== state.player && intel.troops && intel.troops[1] > 0
      ? [{ faction: intel.owner, kind: "infantry", slot: 1, troops: Math.round((intel.troops[0] + intel.troops[1]) / 2),
        color: forceColor(intel.owner) }] : [];
    const sideBadge = (row) => {
      const army = armyByOfficer(state, row.officer);
      return { id: row.id, kind: row.kind, troops: army.troops, color: forceColor(army.faction) };
    };
    const board = fieldBoard({
      terrain: post?.kind === "ferry" || post?.kind === "port" ? "river" : post?.kind === "pass" ? "pass" : originTerrain,
      from: name(origin), to: name(fieldTarget), site: post?.name, step: 0, siege: !post && draft.mission === "offensive",
      sides: [...available.filter(({ id }) => id === lead?.id).map(sideBadge), ...defenders],
      support: available.filter(({ id }) => id !== lead?.id && draft.units.some((unit) => unit.id === id)).map(sideBadge),
      focus: focusedFormation,
      season: state.strategy9 ? seasonWeather(state).key : undefined,
      reign: Boolean(state.reign),
    }, name(draft.objective), "部署");
    if (defenders.length) board.dataset.defenderIntel = intel.source;
    const mandate = state.highCommand?.campaigns.find(({ plan, stage }) => plan === draft.id && stage !== "ended");
    if (state.highCommand && available.length) {
      const roster = element("div", "", "battlefield-roster");
      for (const row of available.slice(0, 4)) {
        const assigned = draft.units.find(({ id }) => id === row.id);
        const marker = button("", () => {
          focusedFormation = row.id;
          render();
        });
        const army = armyByOfficer(state, row.officer);
        marker.append(element("strong", officers.get(row.officer) ?? "军团"), element("span", assigned ? battleRoles[assigned.role] : "待命"),
          element("small", formationKinds[row.kind] + " · " + numbers.format(army.troops)));
        marker.className = "battlefield-marker";
        marker.dataset.fieldFormation = row.id;
        marker.setAttribute("aria-pressed", String(focusedFormation === row.id));
        roster.append(marker);
      }
      const arrival = armyForForecast ? fieldProjection(world, state, armyForForecast, draft.objective, draft.mission) : null;
      const estimate = armyForForecast ? arrival === 0 ? "已到达" : arrival === null ? "暂无可通行路线" : "预计 " + arrival + " 季"
        : "待指定主攻军团";
      const enemy = state.cities[fieldTarget].owner === state.player ? "" : intel.troops ? " · 侦见约 "
        + (intel.troops[0] === intel.troops[1] ? intel.troops[0] : intel.troops.join("–")) + " 人" : " · 敌军未侦察";
      board.append(element("p", estimate + enemy, "battlefield-intel"), roster);
    }
    body.append(board);
    if (!available.length) {
      body.append(assembly(state, era, draft.objective), group(button("查看地图目标", () => locate(city)),
        button("推进一季", advance, !state.orders.length || gameOutcome(state) !== "ongoing")));
      return;
    }
    const mode = selector("指挥", "mode", [["delegate", "委任主将"], ["direct", "手动部署"]], draft.mode);
    mode.input.onchange = () => { draft.mode = mode.input.value; };
    const budget = element("input");
    Object.assign(budget, { type: "number", min: 0, max: 9999, value: draft.reserve, inputMode: "numeric" });
    budget.dataset.battle = "reserve";
    const money = element("label", "国粮底线");
    money.append(budget);
    budget.oninput = () => { draft.reserve = Number(budget.value); };
    if (mandate) {
      budget.disabled = true;
      budget.title = "此战役使用全国军议设定的储粮底线";
    }
    body.append(group(mode.field, money, button("地图定位", () => locate(city))));
    const line = group(...available.map((row) => {
      const role = selector(officers.get(row.officer), "unit-" + row.id, [["", "待命"], ...Object.entries(battleRoles)],
        draft.units.find(({ id }) => id === row.id)?.role);
      role.input.onchange = () => {
        if (role.input.value) draft.units = [...draft.units.filter(({ id }) => id !== row.id), { id: row.id, role: role.input.value }];
        else draft.units = draft.units.filter(({ id }) => id !== row.id);
        render();
      };
      return role.field;
    }));
    line.classList.add("frontline-units");
    if (state.highCommand && available.some(({ id }) => id === focusedFormation)) {
      const choose = group(...Object.entries(battleRoles).map(([role, title]) => {
        const control = button(title, () => {
          draft.units = [...draft.units.filter(({ id }) => id !== focusedFormation), { id: focusedFormation, role }];
          draft.mode = "direct";
          render();
        });
        control.dataset.fieldRole = role;
        control.setAttribute("aria-pressed", String(draft.units.some(({ id, role: assigned }) => id === focusedFormation && assigned === role)));
        return control;
      }));
      choose.classList.add("battle-scene-controls");
      body.append(choose);
    } else body.append(line);
    const canEdit = gameOutcome(state) === "ongoing";
    const confirmOrders = button(draft.id ? "更新调令" : "授权会战", () => perform((current) => {
      const next = saveBattlePlan(world, current, draft);
      selected.plan = draft.id ?? next.frontline.plans.at(-1).id;
      selected.objective = draft.objective;
      draft = undefined;
      return next;
    }, "调令已确认，结算本季时执行。"), !canEdit);
    confirmOrders.classList.add("battlefield-submit");
    const actions = group(confirmOrders, button("推进一季", advance, !canEdit));
    if (!draft.units.length && available.length) {
      body.append(element("p", "委任可自动集结，也可为现有军团分派主攻、预备或护运。"));
    }
    if (draft.id) {
      actions.append(button("联军", () => { selected.plan = draft.id; pane = "coalition"; render(); }));
      if (!mandate) actions.append(button("撤销", () => perform((current) => {
        const next = saveBattlePlan(world, current, { id: draft.id, cancel: true });
        selected.plan = null;
        draft = undefined;
        return next;
      }, "会战授权已撤销。"), !canEdit));
    }
    body.append(actions);
  }

  function formations(state, era) {
    const own = state.frontline.formations.filter(({ faction }) => faction === state.player).slice().reverse();
    const observer = selected.officer && armyObservation(state, state.player, selected.officer);
    if (observer?.observed) {
      body.append(element("h3", factionName(era, observer.faction) + "军团 · " + name(observer.location)),
        element("p", "记录于第 " + (observer.seen + 1) + " 季，估计 " + observer.troopRange.join("–") + " 人。"),
        button("地图定位", () => locate(observer.location)));
      return;
    }
    if (!own.length) {
      body.append(element("p", "暂无军团。可在会战中发集结令，或从地图点城出征。"));
      return;
    }
    const label = (key) => era.officers.find((person) => person.key === key)?.name ?? key;
    const row = own.find(({ id, officer }) => id === selected.formation || officer === selected.officer) ?? own.find(({ ended }) => ended === null) ?? own[0];
    const unit = selector("军团", "formation", own.map(({ id, officer, ended }) => [id, label(officer) + (ended !== null ? " · 已归建" : "")]), row.id);
    unit.input.onchange = () => { selected = { formation: Number(unit.input.value) }; render(); };
    const army = row.ended === null && armyByOfficer(state, row.officer);
    body.append(group(unit.field, element("p", formationKinds[row.kind] + " · 疲劳 " + row.fatigue + " · 资历 " + row.experience)));
    if (army) {
      const status = armyStatus(world, state, army);
      body.append(element("p", name(army.location) + " · " + armyPhases[army.phase] + " · " + army.troops.toLocaleString("zh-CN")
        + " 人 · 随军粮 " + army.grain + " · 军械 " + (army.equipment ?? 0) + (status.supply ? " · 粮道畅通" : " · 粮道已断")));
      body.append(group(button("地图定位", () => locate(army.location)), button("行军与粮道", () => armyDetails(row.officer)),
        button("轮换整补", () => perform((current) => serviceFormation(world, current, row.officer, "rest"), "已设为轮换整补。"),
          state.cities[army.location].owner !== state.player || gameOutcome(state) !== "ongoing"),
        button("归建驻防", () => perform((current) => commandArmy(world, current, row.officer, { type: "garrison" }), "军团已归建当地。"),
          state.cities[army.location].owner !== state.player || gameOutcome(state) !== "ongoing")));
      const choices = [
        ...Object.entries(formationKinds).filter(([key]) => key !== row.kind).map(([key, kind]) => ["kind:" + key, "改编" + kind]),
        ...availableAttackers(era, state, state.player, army.location).filter(({ key }) => key !== row.officer).map(({ key }) => ["leader:" + key, "换将 · " + label(key)]),
        ...own.filter(({ id, officer, ended }) => id !== row.id && ended === null && armyByOfficer(state, officer)?.location === army.location)
          .map(({ officer }) => ["merge:" + officer, "合编 · " + label(officer)]),
      ];
      const action = selector("整补指令", "service", choices);
      body.append(group(action.field, button("执行", () => {
        const [verb, target] = action.input.value.split(":");
        perform((current) => serviceFormation(world, current, row.officer, verb, target), "整补指令已完成。");
      }, army.phase !== "hold" || state.cities[army.location].owner !== state.player || gameOutcome(state) !== "ongoing")));
    }
    const details = row.service.slice(-3).reverse().map(({ turn, event }) => "第 " + (turn + 1) + " 季 " + event);
    const merit = commandCareer(state, row.officer);
    if (merit) body.append(element("p", "战役履历 · " + merit));
    body.append(element("p", "累计损失 " + row.losses + " 人" + (details.length ? " · " + details.join(" / ") : " · 暂无履历记录")));
  }

  function coalition(state, era) {
    const plan = state.frontline.plans.find(({ id }) => id === selected.plan);
    if (!plan) { body.append(element("p", "请先保存会战调令。")); return; }
    const friendly = era.factions.filter(({ key }) => treatyWith(state, state.player, key)?.kind === "alliance");
    const requests = state.frontline.requests.filter(({ plan: id }) => id === plan.id).slice(-3);
    const status = { pending: "待答复", accepted: "已承诺", refused: "已婉拒", expired: "已到期", fulfilled: "已履约", withdrawn: "已撤军" };
    body.append(element("h3", name(plan.objective) + " · 联军邀约"));
    for (const request of requests) {
      const person = state.frontline.formations.find(({ id }) => id === request.unit)?.officer;
      const leader = era.officers.find(({ key }) => key === person)?.name;
      body.append(element("p", factionName(era, request.to) + " · " + battleRoles[request.role] + " · " + status[request.status]
        + " · 第 " + (request.until + 1) + " 季前" + (leader ? " · " + leader : "")));
      if (request.status === "accepted" && request.revision) body.append(group(element("p", "请求宽限至第 " + (request.revision.until + 1) + " 季"),
        button("同意改约", () => perform((current) => answerReinforcementRevision(current, request.id, true), "联军期限已更新。")),
        button("维持原约", () => perform((current) => answerReinforcementRevision(current, request.id, false), "联军仍按原期限执行。"))));
    }
    if (!friendly.length) {
      body.append(element("p", "与其他势力结盟后，可以请盟友派出具名军团。"));
      return;
    }
    const ally = selector("盟友", "ally", friendly.map(({ key, name }) => [key, name]));
    const role = selector("分工", "ally-role", [["advance", "主攻"], ["escort", "护运"]]);
    const time = selector("期限", "ally-time", [2, 3, 4, 5, 6].map((turns) => [turns, turns + " 季"]), 3);
    const terms = selector("归属", "ally-terms", [["retain", "按实际占领"], ["handover", "战后移交"]]);
    body.append(group(ally.field, role.field, time.field, terms.field),
      button("发邀约", () => perform((current) => requestReinforcement(current, { plan: plan.id, faction: ally.input.value,
        role: role.input.value, duration: Number(time.input.value), handover: terms.input.value }), "邀约已发出，盟友将独立决定。"),
      gameOutcome(state) !== "ongoing"));
  }

  function replay(state, era) {
    const battles = visibleBattles(state);
    if (!battles.length) { body.append(element("p", "暂无本方会战奏报。军团接敌或攻城后可在这里回看。")); return; }
    const battle = battles.find(({ id }) => id === selected.battle) ?? battles[0];
    const picker = selector("战报", "replay", battles.map(({ id, site, turn }) => [id, "第 " + (turn + 1) + " 季 · " + name(site)]), battle.id);
    picker.input.onchange = () => { clearInterval(playback); playback = null; selected.battle = Number(picker.input.value); step = 0; render(); };
    const sides = battle.sides.map((side) => ({ ...side, color: forceColor(side.faction) }));
    const events = battle.events;
    const board = fieldBoard({
      terrain: battle.terrain, from: name(sides[0].from), to: name(sides[1].from), site: name(battle.site), sides, step,
      support: step && events ? events.support.map((unit) => ({ ...unit, color: forceColor(unit.faction) })) : [],
      winner: battle.winner, siege: ["siege", "relief"].includes(battle.kind),
      season: state.strategy9 ? seasonWeather({ ...state, turn: battle.turn }).key : undefined,
      reign: Boolean(state.reign),
      century: Boolean(state.century),
    }, name(battle.site), verbs[battle.kind] ?? "会战");
    body.append(group(picker.field), board);
    const stage = group(...phases.map((label, index) => {
      const control = button(label, () => { clearInterval(playback); playback = null; step = index; render(); });
      control.setAttribute("aria-pressed", String(step === index));
      control.dataset.battleStep = index;
      return control;
    }), button("定位", () => locate(battleLocation(state, battle.site))));
    if (state.highCommand) stage.append(button(playback ? "暂停" : "播放", () => {
      if (playback) {
        clearInterval(playback);
        playback = null;
        render();
        return;
      }
      step = 0;
      playback = setInterval(() => {
        if (!dialog.open || pane !== "replay" || step === 2) {
          clearInterval(playback);
          playback = null;
        } else step += 1;
        render();
      }, 850);
      render();
    }));
    stage.classList.add("battlefield-timeline");
    body.append(stage);
    const forces = element("div", "", "battlefield-forces");
    forces.append(...sides.map((side) => forceCard(side, era, step)));
    body.append(forces);
    const context = [];
    if (step === 0 && events?.blocked.length) context.push("本季补给中断 · " + events.blocked.map((side) => factionName(era, side)).join("、"));
    if (step === 1 && events?.support.length) context.push("到场援军 · " + events.support.map(({ officer, troops }) =>
      (era.officers.find(({ key }) => key === officer)?.name ?? "联军") + " " + numbers.format(troops) + " 人").join("、"));
    if (step === 2) {
      context.push(battle.winner ? factionName(era, battle.winner) + "占优。" : "双方均撤离交战线。");
      if (events?.occupied) context.push(factionName(era, events.occupied) + "接管" + name(battle.site) + "。");
      if (events?.withdrawing.length) context.push(events.withdrawing.map((side) => factionName(era, side)).join("、") + "正在撤离。");
    }
    if (context.length) body.append(element("p", context.join(" "), "battlefield-result"));
  }

  function render() {
    if (!dialog.open) return;
    const { state, era } = snapshot();
    const nav = [["plan", "指挥"], ["formation", "军团履历"], ["replay", "战报回看"]];
    tabbar.hidden = !state.frontline;
    tabbar.replaceChildren(...nav.map(([key, label]) => {
      const action = button(label, () => { pane = key; feedback.textContent = ""; render(); });
      action.dataset.battlePane = key;
      action.setAttribute("aria-pressed", String(pane === key || key === "plan" && pane === "coalition"));
      return action;
    }));
    body.replaceChildren();
    body.dataset.pane = pane;
    dialog.dataset.battleView = pane;
    if (!state.frontline) {
      body.append(element("p", "启用会战指挥，将当前战局的城池、军团、外交与行军记录带入山河会战。"),
        button("启用山河会战", () => perform(upgrade, "山河会战已启用。")));
      return;
    }
    if (pane === "plan") plans(state, era);
    if (pane === "formation") formations(state, era);
    if (pane === "coalition") coalition(state, era);
    if (pane === "replay") replay(state, era);
  }

  return { open, render, close: () => { if (dialog.open) dialog.close(); } };
}
