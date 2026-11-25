import { cityName, factionName, forceTotals, gameOutcome } from "./engine.js";
import { economicRoles, mobilizationModes, saveIndustry } from "./sandtable-economy.js";
import { postKinds, postOwner, postUnits, queuePostOrder, strategicPost } from "./sandtable-posts.js";
import { branchChoices, continueAs, orderRegimeResponse, regimeTerms } from "./sandtable-politics.js";
import { answerPeace, declareWar, offerPeace, warGoals, warLocation, warPhases, warTargets } from "./sandtable-war.js";

function make(tag, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function button(text, run, disabled = false) {
  const node = make("button", text);
  node.type = "button";
  node.onclick = run;
  node.disabled = disabled;
  return node;
}

function field(label, name, input) {
  const node = make("label", label);
  input.name = name;
  node.append(input);
  return node;
}

function select(values, prior) {
  const input = make("select");
  input.replaceChildren(...values.map(([key, name]) => new Option(name, key)));
  if (values.some(([key]) => String(key) === String(prior))) input.value = prior;
  return input;
}

function amount(value, max) {
  const input = make("input");
  Object.assign(input, { type: "number", value, min: 0, max, step: 1, inputMode: "numeric" });
  return input;
}

export function createSandtableDesk(world, { snapshot, commit, upgrade, replace, locate, batch, council, operations, roads, diplomacy, battle }) {
  const dialog = document.getElementById("sandtable-dialog");
  const body = document.getElementById("sandtable-body");
  const nav = dialog.querySelector("nav");
  const caption = dialog.querySelector("#sandtable-error");
  let pane = "overview";
  let picked;
  let draftWar = false;
  let diaryTurn;
  let industryRegion;
  const panes = { overview: "总览", war: "战争", industry: "动员", regime: "政局", journal: "纪事" };
  const town = (key) => cityName(world, key);
  for (const [key, label] of Object.entries(panes)) {
    const node = button(label, () => { pane = key; draftWar = false; render(); });
    node.dataset.sandtableTab = key;
    nav.append(node);
  }
  const group = (...children) => {
    const node = make("div");
    node.className = "sandtable-actions";
    node.append(...children);
    return node;
  };
  const fields = (...children) => {
    const node = make("section");
    node.className = "sandtable-fields";
    node.append(...children);
    return node;
  };

  function perform(action, text) {
    try {
      commit(action(snapshot().state), text);
    } catch (error) {
      caption.hidden = false;
      caption.textContent = error.message;
    }
  }

  function overview(state) {
    const totals = forceTotals(state, state.player);
    const data = state.sandtable;
    const alerts = Object.values(data.unrest).filter(({ faction }) => faction === state.player).length;
    const wars = data.wars.filter(({ from, to, status }) => status === "fighting" && [from, to].includes(state.player));
    body.append(make("p", totals.cities + " 城 · 税粮 +" + totals.treasury + " 钱 / +" + totals.grain + " 粮 · " + wars.length + " 场战事"));
    if (alerts) body.append(make("p", alerts + " 支军团等待处置，可在「政局」查看。"));
    body.append(group(button("定国策", () => { dialog.close(); council(); }),
      button("战区授权", () => { dialog.close(); operations(); }),
      button("会盟", () => { dialog.close(); diplomacy(); }),
      button("查看战略据点", () => { dialog.close(); roads(); })));
    body.append(group(button("连续推进四季", () => { dialog.close(); batch(); }, gameOutcome(state) !== "ongoing")));
  }

  function warScreen(state, era) {
    const data = state.sandtable;
    const wars = data.wars.filter(({ from, to }) => [from, to].includes(state.player)).slice().reverse();
    const title = (row) => row.goal === "corridor" ? strategicPost(row.target).name : town(row.target);
    if (!draftWar && wars.length) {
      const picker = select(wars.map((row) => [row.id, title(row) + " · " + (row.status === "ended" ? "已结束" : warPhases[row.phase])]), picked);
      const inspection = make("section");
      const view = () => {
        const row = wars.find(({ id }) => id === Number(picker.value));
        picked = row.id;
        inspection.replaceChildren(make("p", factionName(era, row.from) + " 对 " + factionName(era, row.to)
          + " · 战势 " + row.score + "/100 · 折损 " + row.losses.from + "/" + row.losses.to));
        if (row.objectives) inspection.append(make("p", "争夺 " + row.objectives.map(town).join("、")
          + " · 控制 " + row.objectives.filter((key) => state.cities[key].owner === row.from).length + "/" + row.objectives.length));
        if (row.receipt) inspection.append(make("p", row.receipt.detail));
        else if (row.offer?.by !== state.player && row.offer?.answer === null) {
          inspection.append(make("p", factionName(era, row.offer.by) + "提出" + ({ ceasefire: "停战", passage: "停战通行", return: "交还目标城" }[row.offer.kind])
            + (row.offer.payment ? "，支付 " + row.offer.payment + " 钱。" : "。")),
          group(button("接受和议", () => perform((current) => answerPeace(current, row.id, true), "已同意，季末交割。")),
            button("拒绝和议", () => perform((current) => answerPeace(current, row.id, false), "已回复使者。"))));
        } else if (row.offer) inspection.append(make("p", "和议待本季答复与交割。"));
        else {
          const kind = select([["ceasefire", "停战六季"], ...(row.goal === "corridor" ? [["passage", "停战并开放通行"]] : []),
            ...(row.goal === "region" && state.cities[row.target].owner === row.from ? [["return", "停战并还城"]] : [])]);
          const payment = amount(0, 150);
          inspection.append(fields(field("和议条款", "peace-kind", kind), field("本方付钱", "peace-pay", payment)),
            group(button("遣使议和", () => perform((current) => offerPeace(current, row.id, { kind: kind.value, payment: payment.valueAsNumber }), "和议已送出。"))));
        }
      };
      picker.onchange = view;
      view();
      body.append(group(field("战事", "war-record", picker)), inspection,
        group(button("设立战争目标", () => { draftWar = true; render(); }),
          button("地图定位", () => { dialog.close(); locate(warLocation(wars.find(({ id }) => id === +picker.value))); })));
      return;
    }
    const goal = select(Object.entries(warGoals));
    const target = select([]);
    const auto = make("input");
    auto.type = "checkbox";
    auto.checked = true;
    const submit = button("下达开战令", () => {
      const terms = { goal: goal.value, target: target.value, auto: auto.checked };
      perform((current) => {
        const next = declareWar(world, current, terms);
        picked = next.sandtable.wars.at(-1).id;
        draftWar = false;
        return next;
      }, "战争目标已下达。");
    });
    function sync() {
      const list = warTargets(world, state, state.player, goal.value);
      target.replaceChildren(...list.map(({ key, name, rival }) => new Option(name + " · " + factionName(era, rival), key)));
      submit.disabled = !list.length;
    }
    goal.onchange = sync;
    sync();
    body.append(fields(field("战争目标", "war-goal", goal), field("目标", "war-target", target)),
      group(field("授权将领准备并出击", "war-auto", auto), submit,
        ...(wars.length ? [button("返回战事", () => { draftWar = false; render(); })] : [])));
  }

  function industry(state) {
    const current = state.sandtable.economy[state.player] ?? { mode: "normal", budget: 30, reserve: 25, regions: {} };
    const regions = [...new Set(world.cities.filter(({ key }) => state.cities[key].owner === state.player).map(({ region }) => region))];
    const region = select(regions.map((key) => [key, key]), industryRegion);
    const role = select(Object.entries(economicRoles), current.regions[region.value]);
    region.onchange = () => {
      industryRegion = region.value;
      role.value = current.regions[region.value] ?? "farms";
    };
    const mode = select(Object.entries(mobilizationModes), current.mode);
    const budget = amount(current.budget, 120);
    const reserve = amount(current.reserve, 600);
    const labor = Object.entries(state.sandtable.labor).filter(([key]) => state.cities[key].owner === state.player).reduce((sum, [, count]) => sum + count, 0);
    body.append(make("p", "离岗劳力 " + labor + " · 生产和运输按季执行"), fields(
      field("全国动员", "mobilization", mode), field("每季钱限", "industry-budget", budget), field("最低储粮", "industry-reserve", reserve),
      field("州郡", "industry-region", region), field("职责", "industry-role", role)),
    group(button("颁行动员令", () => perform((snapshot) => saveIndustry(world, snapshot, {
      mode: mode.value, budget: budget.valueAsNumber, reserve: reserve.valueAsNumber, region: region.value, role: role.value,
    }), "州郡将按职责生产和转运。"))));
  }

  function regime(state, era) {
    const risks = Object.entries(state.sandtable.unrest).filter(([, row]) => row.faction === state.player);
    const choices = branchChoices(state);
    if (risks.length) {
      const risk = select(risks.map(([key, record]) => [key, (era.officers.find((person) => person.key === key)?.name ?? key) + " · " + town(record.city)]));
      const response = select(Object.entries(regimeTerms));
      body.append(fields(field("军政争议", "regime-risk", risk), field("处置", "regime-term", response)),
        group(button("安排处置", () => perform((current) => orderRegimeResponse(current, risk.value, response.value), "已下达处置令。"))));
    } else body.append(make("p", "本季军政稳定。"));
    if (choices.length) {
      const side = select(choices.map(({ key, name }) => [key, name]));
      body.append(group(field("接手续局", "branch-faction", side), button("接手势力", () => {
        try { replace(continueAs(world, snapshot().state, side.value)); dialog.close(); }
        catch (error) { caption.hidden = false; caption.textContent = error.message; }
      })));
    }
    if (!risks.length) body.append(group(button("州郡与人事", () => { dialog.close(); council(); })));
  }

  function postScreen(state, era) {
    const post = strategicPost(picked);
    if (!post) return;
    const owner = postOwner(state, post);
    const station = state.sandtable.posts[post.key];
    body.append(make("h3", post.name + " · " + postKinds[post.kind]));
    body.append(make("p", town(post.seat) + " — " + town(post.to) + " · " + factionName(era, owner)
      + " · 驻防 " + (station?.troops ?? 180) + (station?.closed ? " · 封控" : "")));
    if (state.frontline) body.append(button("安排会战", () => { dialog.close(); battle(post.key); }));
    if (owner === state.player) {
      const from = select([post.seat, post.to].filter((key) => state.cities[key].owner === owner && state.cities[key].troops >= 500)
        .map((key) => [key, town(key)]));
      body.append(group(field("调驻", "post-origin", from), button("拨 250 人驻防", () => perform((current) => queuePostOrder(current, post.key,
        { kind: "garrison", city: from.value }), "据点驻防令已入队。"), !from.value)));
      const mode = station?.closed ? "open" : "close";
      body.append(group(button(mode === "open" ? "解除封控" : "封控通路", () => perform((current) => queuePostOrder(current, post.key, { kind: mode }), "通行令已入队。"))));
    } else {
      const roster = postUnits(state, post);
      const leader = select(roster.map((unit) => [unit.officer, (era.officers.find(({ key }) => key === unit.officer)?.name ?? unit.officer) + " · " + unit.troops + " 兵"]));
      body.append(group(field("就位军团", "post-officer", leader), button("争夺据点", () => perform((current) => queuePostOrder(current, post.key,
        { kind: "assault", officer: leader.value }), "夺取据点令已入队。"), !roster.length)));
      if (!roster.length) body.append(make("p", "军团在相邻城就位后可以争夺此处。"));
    }
    if (state.sandtable.postOrders.some(({ key }) => key === post.key)) body.append(make("p", "本季有据点指令待执行。"));
  }

  function journal(state) {
    const news = [...state.sandtable.journal].reverse();
    if (!news.length) { body.append(make("p", "争夺、交割与政局变化会记入纪事。")); return; }
    const date = select(news.map(({ turn }) => [turn, "第 " + turn + " 季"]), diaryTurn);
    const page = make("section");
    function sync() {
      const record = news.find(({ turn }) => turn === +date.value);
      diaryTurn = record.turn;
      const events = select(record.news.map(({ text }, index) => [index, text.length > 20 ? text.slice(0, 20) + "…" : text]));
      const title = make("p");
      const go = button("地图回看", () => { dialog.close(); locate(record.news[+events.value].city, record.turn); });
      function fill() { title.textContent = record.news[+events.value].text; go.disabled = !record.news[+events.value].city; }
      events.onchange = fill;
      fill();
      page.replaceChildren(group(field("事件", "history-event", events)), title, group(go));
    }
    date.onchange = sync;
    sync();
    body.append(group(field("季度", "history-turn", date)), page);
  }

  function render() {
    const { state, era } = snapshot();
    caption.hidden = true;
    body.replaceChildren();
    nav.hidden = !state.sandtable;
    if (!state.sandtable) { body.append(make("p", "在本局启用 5.0 天下沙盘。"), group(button("启用 5.0", () => perform(upgrade, "已启用天下沙盘。")))); return; }
    for (const node of nav.children) node.setAttribute("aria-pressed", String(node.dataset.sandtableTab === pane));
    if (pane === "overview") overview(state);
    if (pane === "war") warScreen(state, era);
    if (pane === "industry") industry(state);
    if (pane === "regime") regime(state, era);
    if (pane === "journal") journal(state);
    if (pane === "post") postScreen(state, era);
  }

  return { render, open(next = "overview", key) {
    pane = next; picked = key; draftWar = false; render();
    if (!dialog.open) dialog.showModal();
  } };
}
