import { cityName, factionName, playableFactions } from "./engine.js";
import { proposeCongress } from "./landscape-treaty.js";
import { commodities } from "./landscape-economy.js";
import { seasonWeather } from "./landscape-terrain.js";

function el(tag, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function action(label, callback) {
  const button = el("button", label);
  button.type = "button";
  button.onclick = callback;
  return button;
}

function field(form, label, name, input) {
  input.name = name;
  const container = el("label", label);
  container.append(input);
  form.append(container);
  return input;
}

function choices(entries, initial) {
  const input = document.createElement("select");
  input.append(...entries.map(([key, label]) => new Option(label, key)));
  if (initial !== undefined) input.value = initial;
  return input;
}

export function createLandscapeDesk(world, { snapshot, commit, locate, original, upgrade }) {
  const dialog = document.getElementById("landscape-dialog");
  const body = dialog.querySelector("#landscape-body");
  const nav = dialog.querySelector(".landscape-tabs");
  let page = "summary";
  let cursor;
  let replayIndex = 0;
  let writing = false;
  const town = (key) => cityName(world, key);
  const pages = { summary: "时令", economy: "粮运与州郡", treaty: "多方议盟", replay: "战役复盘" };
  for (const [key, label] of Object.entries(pages)) {
    const button = action(label, () => { page = key; writing = false; render(); });
    button.dataset.landscapeTab = key;
    nav.append(button);
  }

  function summary(state) {
    const weather = seasonWeather(state);
    body.append(el("h3", weather.name), el("p", weather.description));
    const next = seasonWeather({ ...state, turn: state.turn + 1 });
    body.append(el("p", "下季 " + next.name + " · " + next.description));
    const links = el("div");
    links.className = "landscape-tabs";
    links.append(action("在地图查看关隘粮道", () => { dialog.close(); locate("roads"); }),
      action("战役编组", () => { dialog.close(); original("campaign"); }),
      action("国家预算", () => { dialog.close(); original("govern"); }),
      action("双边外交", () => { dialog.close(); original("treaty"); }));
    body.append(links);
  }

  function economy(state) {
    const rows = state.landscape.convoys.filter(({ faction }) => faction === state.player)
      .slice(window.innerHeight < 450 ? -2 : -4).reverse();
    const granaries = Object.entries(state.grand.depots).filter(([key]) => state.cities[key].owner === state.player);
    const arsenal = Object.entries(state.landscape.equipment).filter(([key]) => state.cities[key].owner === state.player);
    body.append(el("h3", "府库与运输"),
      el("p", "储粮 " + state.factions[state.player].grain + " · 地方仓粮 " + granaries.reduce((sum, [, value]) => sum + value, 0)
        + " · 库存军械 " + arsenal.reduce((sum, [, value]) => sum + value, 0)));
    for (const row of rows) body.append(el("p", town(row.from) + " → " + town(row.to) + " · " + row.amount + " " + commodities[row.cargo]
      + " · " + ({ queued: "待发", delivered: "入库", blocked: "受阻", cancelled: "取消" }[row.status])));
    body.append(action("查看地图粮道", () => { dialog.close(); locate("roads"); }));
  }

  function treaty(state, era) {
    const name = (key) => factionName(era, key);
    const peers = playableFactions(era).filter(({ key }) => key !== state.player
      && Object.values(state.cities).some(({ owner }) => owner === key));
    const statuses = { voting: "等待表决", rejected: "未通过", active: "执行中", closed: "已结算" };
    const records = state.landscape.congresses.filter(({ parties }) => parties.includes(state.player)).slice().reverse();
    if (records.length && !writing) {
      const picker = choices(records.map((row) => [String(row.id), town(row.target) + " · " + statuses[row.status]]));
      const item = el("section");
      item.className = "landscape-clause";
      function inspect() {
        const row = records.find(({ id }) => String(id) === picker.value);
        item.replaceChildren(el("p", row.parties.map((key) => name(key) + " " + ({ yes: "赞成", no: "反对" }[row.votes[key]] ?? "待投票")
          + " / 军事 " + (row.contributions[key] ?? 0) + " 季").join(" · ")),
          el("p", "已付粮援 " + row.delivered + " · " + (row.completed ? "攻取目标" : "尚未攻取")
            + (row.returnTo ? " · 战后交割给" + name(row.returnTo) : "")));
      }
      picker.onchange = inspect;
      const tools = el("div");
      tools.className = "landscape-tabs";
      field(tools, "查看议约", "congress-record", picker);
      if (peers.length >= 3) tools.append(action("发起议盟", () => { writing = true; render(); }));
      inspect();
      body.append(tools, item);
      return;
    }
    if (peers.length < 3) {
      body.append(el("p", "需要两个与会势力，以及一个与会势力之外的共同目标。"));
      return;
    }
    const form = el("form");
    form.className = "landscape-congress-form";
    const factionRows = peers.map(({ key }) => [key, name(key)]);
    const a = field(form, "邀请", "guest-a", choices(factionRows));
    const b = field(form, "同邀", "guest-b", choices(factionRows, factionRows[1][0]));
    const target = field(form, "共取", "target", choices([]));
    const aid = field(form, "每季粮援", "aid", choices([["0", "无"], ["8", "8 粮 · 首位受邀方"], ["16", "16 粮 · 首位受邀方"], ["24", "24 粮 · 首位受邀方"]]));
    const duration = field(form, "议约期限", "duration", choices([["4", "4 季"], ["6", "6 季"], ["8", "8 季"], ["12", "12 季"]], "6"));
    const returnTo = field(form, "战后归城", "return", choices([]));
    const clauses = el("div");
    clauses.className = "landscape-tabs";
    const market = field(clauses, "互开商埠", "market", el("input"));
    const border = field(clauses, "停战通行", "border", el("input"));
    for (const checkbox of [market, border]) { checkbox.type = "checkbox"; checkbox.checked = true; }
    form.append(clauses);
    const submit = el("button", "提交各方表决");
    submit.className = "primary";
    form.append(submit);
    if (records.length) form.append(action("返回履约记录", () => { writing = false; render(); }));
    const error = el("p");
    error.setAttribute("role", "status");
    error.className = "landscape-notice";
    function sync() {
      const parties = [state.player, a.value, b.value];
      const goal = target.value;
      target.replaceChildren(...world.cities.filter(({ key }) => !parties.includes(state.cities[key].owner))
        .map(({ key }) => new Option(town(key), key)));
      if ([...target.options].some(({ value }) => value === goal)) target.value = goal;
      returnTo.replaceChildren(new Option("按战后控制", ""), ...[...new Set(parties)].map((key) => new Option(name(key), key)));
      submit.disabled = a.value === b.value || !target.value || !market.checked && !border.checked;
    }
    for (const input of [a, b, market, border]) input.onchange = sync;
    form.onsubmit = (event) => {
      event.preventDefault();
      try {
        const next = proposeCongress(snapshot().state, { guests: [a.value, b.value], target: target.value, aid: +aid.value,
          duration: +duration.value, market: market.checked, border: border.checked, beneficiary: a.value, returnTo: returnTo.value });
        writing = false;
        commit(next, "已发出多方议盟邀请。");
      } catch (cause) { error.textContent = cause.message; }
    };
    sync();
    body.append(form, error);
  }

  function replay(state) {
    const records = state.landscape.replay.filter(({ stages }) => stages.length);
    if (!records.length) { body.append(el("p", "下达出征指令后，这里会按季度记录集结、行军、接战和撤回。")); return; }
    const row = records.find(({ turn }) => turn === cursor) ?? records.at(-1);
    const quarters = choices(records.map(({ turn, weather }) => [String(turn), "第 " + (turn + 1) + " 季 · " + weather]), String(row.turn));
    quarters.onchange = () => { cursor = Number(quarters.value); replayIndex = 0; render(); };
    const toolbar = el("div");
    toolbar.className = "landscape-tabs";
    field(toolbar, "回放季度", "quarter", quarters);
    const size = window.innerHeight < 450 ? 1 : window.innerHeight < 720 ? 3 : 5;
    const pages = Math.ceil(row.stages.length / size);
    replayIndex = Math.min(replayIndex, pages - 1);
    if (pages > 1) {
      const previous = action("上页", () => { replayIndex--; render(); });
      const next = action("下页", () => { replayIndex++; render(); });
      previous.disabled = replayIndex === 0;
      next.disabled = replayIndex === pages - 1;
      toolbar.append(previous, el("span", (replayIndex + 1) + " / " + pages), next);
    }
    body.append(toolbar);
    const timeline = el("ol");
    timeline.className = "landscape-timeline";
    for (const step of row.stages.slice(replayIndex * size, (replayIndex + 1) * size)) {
      const line = el("li", step.text);
      if (step.strength) line.append(el("p", "接战战力 " + step.strength.join(" 对 ") + " · 双方折损 " + step.losses.join(" / ")));
      line.append(action("定位" + town(step.city), () => { dialog.close(); locate("cities", step.city, step.from); }));
      timeline.append(line);
    }
    body.append(timeline);
  }

  function render() {
    const { state, era } = snapshot();
    body.replaceChildren();
    nav.hidden = !state.landscape;
    for (const control of nav.children) control.setAttribute("aria-pressed", String(control.dataset.landscapeTab === page));
    if (!state.landscape) {
      body.append(el("p", "启用山河变局，将在现有战局中加入时令、军械与多方议盟。"));
      body.append(action("在此存档启用 3.0", upgrade));
      return;
    }
    if (page === "summary") summary(state);
    if (page === "economy") economy(state);
    if (page === "treaty") treaty(state, era);
    if (page === "replay") replay(state);
  }
  return { render, open(key = "summary") { page = key; writing = false; render(); if (!dialog.open) dialog.showModal(); } };
}
