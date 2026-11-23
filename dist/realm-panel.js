import {
  accordCredit, accordKinds, accordProposal, activeAccords, allyDuties, allyWindow, cancelAccordProposal, coalitionCriteria,
  commercialStatus, jointTargets, proposeAccord, quoteAccord, respondAccord, revokeTrade,
} from "./accords.js";
import { quoteTreaty, treatyTerms } from "./diplomacy.js";
import { cityName, factionName, forecastFinance, gameOutcome, previewOrders, respondToTreaty, sendTreatyOffer } from "./engine.js";
import { programResults } from "./finance.js";
import { assignRealmOffice, editRealmPolicy, officeCandidates, officeSkill, realmOffices, realmReserve, startRealm } from "./realm.js";

const titles = { ...accordKinds, truce: "停战", alliance: "同盟" };
const impacts = { civil: "擅长政务时可节省发展与赈济开支", envoy: "提高谈判意愿并记录履约功过", marshal: "统率达标时可节省远程运粮消耗" };
const number = new Intl.NumberFormat("zh-CN");

export function createRealmPanel(world, { snapshot, commit, locateRoad, conclude, seasonTitle, statList }) {
  const find = (id) => document.getElementById(id);
  const dialog = find("realm-dialog");
  const tabs = [...find("realm-tabs").querySelectorAll("button")];
  let pane = "policy";
  let serviceIndex = 0;
  let preview;
  let policyDraft;

  function options(id, rows, value = find(id).value) {
    const input = find(id);
    input.replaceChildren(...rows.map(([key, label]) => new Option(label, key)));
    if (rows.some(([key]) => String(key) === String(value))) input.value = value;
    return input.value;
  }

  function message(text = "", error = false) {
    const line = find("realm-message");
    line.textContent = text;
    line.hidden = !text;
    line.dataset.error = String(error);
  }

  function action(operation, label, repaint = true) {
    try {
      const { state, era } = snapshot();
      commit(operation(state, era), label);
      message(label);
      if (repaint) render();
    } catch (error) { message(error.message, true); }
  }

  function render() {
    const { state } = snapshot();
    find("realm-upgrade").hidden = Boolean(state.realm);
    find("start-realm").disabled = gameOutcome(state) !== "ongoing";
    find("realm-tabs").hidden = !state.realm;
    for (const button of tabs) {
      const showing = button.dataset.realmPane === pane;
      button.setAttribute("aria-pressed", String(showing));
      find("realm-" + button.dataset.realmPane).hidden = !state.realm || !showing;
    }
    if (!state.realm) return;
    if (pane === "policy") showPolicy();
    if (pane === "diplomacy") showDiplomacy();
    if (pane === "offices") showOffices();
    if (pane === "ledger") showLedger();
    if (pane === "coalition") showCoalition();
  }

  const policyInputs = { development: "realm-development", military: "realm-military", relief: "realm-relief" };
  function showPolicy() {
    const { state } = snapshot();
    const draft = policyDraft ?? state;
    const reserve = realmReserve(draft, state.player);
    for (const [key, id] of Object.entries(policyInputs)) find(id).value = draft.realm.policy[key];
    find("realm-priority").value = draft.realm.policy.priority;
    find("realm-reserve-money").value = reserve.treasury;
    find("realm-reserve-grain").value = reserve.grain;
    find("realm-preview-summary").textContent = "发展、军备和救济为每季拨款上限。";
    find("save-realm-policy").disabled = gameOutcome(state) !== "ongoing";
    find("realm-preview").disabled = gameOutcome(state) !== "ongoing";
  }

  function applyPolicyDraft(state) {
    const policy = Object.fromEntries(Object.entries(policyInputs).map(([key, id]) => [key, find(id).valueAsNumber]));
    policy.priority = find("realm-priority").value;
    return editRealmPolicy(state, policy, { treasury: find("realm-reserve-money").valueAsNumber, grain: find("realm-reserve-grain").valueAsNumber });
  }

  function quote() {
    const { state, era } = snapshot();
    const partner = find("realm-partner").value;
    const kind = find("realm-kind").value;
    const joint = kind === "joint";
    const aid = kind === "aid";
    find("realm-pact-target").hidden = !joint;
    find("realm-pact-target-label").hidden = !joint;
    const coordinate = joint && Boolean(state.war);
    find("realm-pact-coordination").hidden = !coordinate;
    find("realm-pact-coordination-label").hidden = !coordinate;
    const selectedDuty = options("realm-pact-coordination", coordinate ? Object.entries(allyDuties)
      .flatMap(([key, name]) => [0, 1, 2].map((offset) => [key + ":" + offset, name + " · 签约后第 " + (offset + 1) + " 季起"])) : []);
    const [duty, delay] = selectedDuty.split(":");
    find("realm-aid-grain").hidden = !aid;
    find("realm-aid-grain-label").hidden = !aid;
    options("realm-pact-target", joint ? jointTargets(world, state, state.player, partner).map(({ key, name }) => [key, name]) : []);
    const target = find("realm-pact-target").value;
    const grain = find("realm-aid-grain").valueAsNumber;
    const proposal = accordProposal(world, state, state.player, partner, kind, target, grain,
      coordinate ? { duty, offset: Number(delay) } : undefined);
    const regular = Object.hasOwn(treatyTerms, kind);
    const result = !partner ? { reason: "当前无其他势力。" }
      : regular ? quoteTreaty(world, state, partner, kind, previewOrders(world, state).factions[state.player].treasury)
        : quoteAccord(world, era, state, proposal);
    find("realm-proposal-quote").textContent = result.reason + (result.accepted && proposal.sites
      ? ` ${proposal.sites.map((site) => cityName(world, site)).join(" → ")}。` : "");
    find("send-realm-proposal").disabled = gameOutcome(state) !== "ongoing" || !(regular ? result.available : result.accepted);
    return { proposal, regular };
  }

  function records(view, state) {
    if (view === "proposals") {
      const newItems = state.realm.proposals.filter(({ from, to }) => from === state.player || to === state.player);
      const incoming = state.incomingTreaty?.answer === null ? [{ ...state.incomingTreaty, to: state.player, treaty: true }] : [];
      return [...incoming, ...newItems];
    }
    if (view === "active") {
      const normal = (state.treaties ?? []).filter(({ sides, expires }) => sides.includes(state.player) && expires > state.turn)
        .map(({ sides, kind, expires }) => ({ kind, from: state.player, to: sides.find((side) => side !== state.player), expires, treaty: true }));
      return [...activeAccords(state, state.player), ...normal];
    }
    return [...state.realm.reports].reverse();
  }

  function control(text, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", handler);
    return button;
  }

  function showAccordRecord(view, items) {
    const { state, era } = snapshot();
    const item = items[Number(find("realm-record-select").value || 0)];
    const actions = find("realm-diplomacy-actions");
    actions.replaceChildren();
    const line = find("realm-diplomacy-note");
    if (!item) {
      line.textContent = { proposals: "当前没有往来提案。", active: "当前没有现行协议。", history: "履约情况将在这里记录。" }[view];
      return;
    }
    const { from, to, kind, target, grain, expires, answer, treaty } = item;
    const outgoing = from === state.player;
    const partner = outgoing ? to : from;
    const editable = gameOutcome(state) === "ongoing";
    const details = target ? " · 目标 " + cityName(world, target) + (item.coordination ? " · " + allyDuties[item.coordination.duty] : "")
      : grain ? " · " + grain + " 粮" : "";
    if (view === "history") {
      line.textContent = (item.turn ? seasonTitle(item.turn - 1) + " · " : "") + item.text;
      return;
    }
    if (view === "proposals") {
      line.textContent = (outgoing ? "等待对方回覆" : answer === undefined || answer === null ? "等待本方答复" : answer ? "已批准，待结算" : "已回绝")
        + details + (item.reason ? " · " + item.reason : "");
      if (editable && !outgoing) for (const [label, accept] of [["批准", true], ["回绝", false]]) {
        actions.append(control(label, () => action((current) => treaty ? respondToTreaty(world, current, accept) : respondAccord(current, from, kind, accept), "已登记答复。")));
      }
      if (editable && outgoing) actions.append(control("撤回", () => action((current) => cancelAccordProposal(current, to, kind), "已撤回提案。")));
      return;
    }
    const credit = accordCredit(state, state.player, partner);
    line.textContent = `余 ${expires - state.turn} 季 · 信用 ${credit}${details}`;
    if (kind === "trade") {
      const status = commercialStatus(world, state, item);
      line.textContent += status.route ? ` · 每季 +${status.income} 钱`
        : " · 商路中断" + (status.blocked ? "于" + cityName(world, status.blocked) : "");
      actions.append(control("地图查看", () => locateRoad(status.display, status.blocked)));
      if (editable) actions.append(control("撤回通商许可", () => action((current) => revokeTrade(current, partner), "已终止通商。")));
    }
    if (kind === "joint") line.textContent += item.joined.length ? " · " + item.joined.map((key) => factionName(era, key)).join("、") + "已出兵" : " · 等待出兵";
    if (kind === "joint" && item.coordination) line.textContent += ` · 第 ${allyWindow(item).first}–${allyWindow(item).last} 季到位`;
    if (editable && (kind === "trade" || kind === "alliance") && expires - state.turn <= 2) {
      actions.append(control("提交续约", () => {
        find("realm-diplomacy-view").value = "propose";
        showDiplomacy();
        find("realm-partner").value = partner;
        find("realm-kind").value = kind;
        quote();
      }));
    }
  }

  function showDiplomacy() {
    const { state, era } = snapshot();
    const view = find("realm-diplomacy-view").value;
    find("realm-propose").hidden = view !== "propose";
    find("realm-diplomacy-list").hidden = view === "propose";
    if (view === "propose") {
      const alive = new Set(Object.values(state.cities).map(({ owner }) => owner));
      options("realm-partner", era.factions.filter(({ key }) => key !== state.player && alive.has(key)).map(({ key, name }) => [key, name]));
      options("realm-kind", Object.entries(titles));
      quote();
      return;
    }
    const items = records(view, state);
    options("realm-record-select", items.map(({ from, to, kind, turn }, index) => [index,
      factionName(era, from === state.player ? to : from) + " · " + titles[kind] + (turn ? " · " + seasonTitle(turn - 1) : "")]));
    find("realm-record-select-label").hidden = !items.length;
    showAccordRecord(view, items);
  }

  function service() {
    const { state, era } = snapshot();
    const items = state.realm.service.filter(({ role }) => role === find("realm-post").value).reverse();
    serviceIndex = Math.min(serviceIndex, Math.max(0, items.length - 1));
    const entry = items[serviceIndex];
    const person = entry && era.officers.find(({ key }) => key === entry.person);
    find("realm-service-record").textContent = entry ? `第 ${entry.turn} 季 · ${person.name} · ${entry.detail}` : "该职务尚无履历。";
    find("realm-service-prev").disabled = serviceIndex === 0;
    find("realm-service-next").disabled = serviceIndex + 1 >= items.length;
  }

  function showOffices() {
    const { state, era } = snapshot();
    const role = options("realm-post", Object.entries(realmOffices));
    const appointment = state.realm.offices[role];
    const officers = officeCandidates(era, state, role).map(({ key, name }) => [key, name]);
    options("realm-holder", [["", "空缺"], ...officers], appointment?.holder ?? "");
    options("realm-deputy", [["", "无"], ...officers], appointment?.deputy ?? "");
    find("realm-office-summary").textContent = impacts[role] + "。当前能力 " + officeSkill(era, state, role) + "。";
    find("save-realm-office").disabled = gameOutcome(state) !== "ongoing";
    service();
  }

  function showLedger() {
    const { state, selected, era } = snapshot();
    const archive = state.history.filter(({ finance }) => finance?.realm).slice(-8).reverse();
    const ended = gameOutcome(state) !== "ongoing";
    const rows = archive.map(({ turn }) => [turn, seasonTitle(turn - 1) + " · 实账"]);
    if (!ended) rows.unshift(["forecast", (preview ? "拨款试算" : "本季预算") + " · 预估"]);
    const period = options("realm-ledger-turn", rows);
    const ledger = period === "forecast" ? preview ?? forecastFinance(world, state)
      : archive.find(({ turn }) => turn === Number(period))?.finance;
    const selectedCity = options("realm-ledger-city", world.cities.filter(({ key }) => state.cities[key].owner === state.player)
      .map(({ key, name }) => [key, name]), find("realm-ledger-city").value || selected);
    const lines = ledger?.realm;
    statList(find("realm-ledger-stats"), lines ? [
      ["商路收益", "+" + lines.commerce + " 钱"], ["外援入粮", "+" + lines.aidIn + " 粮"], ["粮援支出", lines.aidOut + " 粮"],
      ["赈济支出", lines.relief.treasury + " 钱 / " + lines.relief.grain + " 粮"], ["期末国库", ledger.closing.treasury + " 钱"],
      ["期末储粮", ledger.closing.grain + " 粮"],
    ] : []);
    const demo = state.realm.cities[selectedCity];
    const program = ledger?.programs.find(({ city }) => city === selectedCity);
    const changes = [demo && `当前人口 ${number.format(demo.population)} · 民心 ${demo.welfare}`,
      program ? "委任 " + programResults[program.result] : demo ? "该账期无委任支出" : "暂无本方辖城"].filter(Boolean);
    find("realm-ledger-note").textContent = changes.join("。") + "。";
  }

  function showCoalition() {
    const { state, era } = snapshot();
    const result = coalitionCriteria(world, era, state);
    find("realm-coalition-checks").replaceChildren(...result.checks.map(({ label, value, target }) => {
      const row = document.createElement("li");
      row.textContent = `${label} ${value} / ${target}`;
      if (value >= target) row.className = "stage-met";
      return row;
    }));
    const available = Object.keys(state.factions).filter((key) => Object.values(era.ownership).includes(key)).length >= 3;
    find("realm-coalition-partners").textContent = available
      ? (result.partners.length ? "履约盟友 " + result.partners.map((key) => factionName(era, key)).join("、")
        : "维持两位盟友的通商、信用与核心城，连同本方组成稳定联盟。")
      : "联盟结局需要至少三个独立势力开局。";
    find("conclude-coalition").disabled = !result.ready || gameOutcome(state) !== "ongoing";
  }

  for (const button of tabs) button.addEventListener("click", () => {
    pane = button.dataset.realmPane;
    message();
    render();
  });
  find("start-realm").addEventListener("click", () => action((state) => startRealm(world, state), "已启用天下格局。"));
  find("realm-policy").addEventListener("submit", (event) => {
    event.preventDefault();
    action((state) => {
      const next = applyPolicyDraft(state);
      preview = undefined;
      policyDraft = undefined;
      return next;
    }, "已保存全国预算。");
  });
  find("realm-preview").addEventListener("click", () => {
    try {
      const draft = applyPolicyDraft(snapshot().state);
      preview = forecastFinance(world, draft);
      policyDraft = draft;
      pane = "ledger";
      message("试算采用当前政令与协议。");
      render();
      find("realm-ledger-turn").value = "forecast";
      showLedger();
    } catch (error) { message(error.message, true); }
  });
  for (const id of ["realm-ledger-turn", "realm-ledger-city"]) find(id).addEventListener("change", showLedger);
  for (const id of ["realm-kind", "realm-partner", "realm-pact-target", "realm-pact-coordination", "realm-aid-grain"]) find(id).addEventListener("change", quote);
  for (const id of ["realm-diplomacy-view", "realm-record-select"]) find(id).addEventListener("change", () => { message(); showDiplomacy(); });
  find("realm-propose").addEventListener("submit", (event) => {
    event.preventDefault();
    const { proposal, regular } = quote();
    if (regular) action((state) => sendTreatyOffer(world, state, proposal.to, proposal.kind), "外交答复已载入奏报。");
    else action((state, era) => {
      const next = proposeAccord(world, era, state, proposal);
      find("realm-diplomacy-view").value = "proposals";
      return next;
    }, "已送出提案。");
  });
  find("realm-post").addEventListener("change", () => { serviceIndex = 0; showOffices(); });
  find("realm-offices").addEventListener("submit", (event) => {
    event.preventDefault();
    action((state) => assignRealmOffice(world, state, find("realm-post").value, find("realm-holder").value || null,
      find("realm-deputy").value || null), "已更新国级任命。");
  });
  find("realm-office-history").addEventListener("click", () => {
    find("realm-service").hidden = !find("realm-service").hidden;
    serviceIndex = 0;
    service();
  });
  find("realm-service-prev").addEventListener("click", () => { serviceIndex -= 1; service(); });
  find("realm-service-next").addEventListener("click", () => { serviceIndex += 1; service(); });
  find("conclude-coalition").addEventListener("click", conclude);
  return {
    open(requested = "policy", diplomaticView) {
      pane = requested;
      preview = undefined;
      policyDraft = undefined;
      serviceIndex = 0;
      if (diplomaticView) find("realm-diplomacy-view").value = diplomaticView;
      find("realm-service").hidden = true;
      message();
      render();
      dialog.showModal();
    },
  };
}
