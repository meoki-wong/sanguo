import { annualDraft15, annualObjectives15, answerCase15, concludeChapter15, frame15, labor15, openCases15, previewYear15,
  provinceAgreement15, publishYear15, reignChapters15, renewAccord15, setFrontPriority15 } from "./century.js";
import { dynastyNotices, dynastyProvinces } from "./dynasty.js";
import { cityName, eraByYear, gameOutcome, setNationalPolicy } from "./engine.js";
import { courtFor } from "./polity-governance.js";
import { regionCandidates10, reignAlerts, reignPeople, reignSuccession, resolveReignAlert } from "./reign.js";
import { SOVEREIGN_DOCTRINES, appointAllProvinceGovernors } from "./sovereign.js";
import { marketRow } from "./reign-economy.js";
import { strategicAlerts9, strategicFronts9, theaterRoles9 } from "./strategy-nine.js";

const format = new Intl.NumberFormat("zh-CN");
const tabs = { overview: "国势", policy: "国策", pending: "待决", local: "委任", journal: "纪事" };
const numberFields = { civil: "民政额度", military: "战区军费", relief: "赈济额度", grain: "调度粮食", reserve: "钱粮底线", levy: "年度征发", transport: "运输额度" };
const choiceNames = { unification: "统一", coalition: "诸侯共守", peace: "承平", scenario: "剧本结局", stewardship: "守成",
  expansion: "拓土立制", accord: "保境成约", recovery: "再整山河" };

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function row(...items) {
  const line = element("div", undefined, "century-row");
  line.append(...items);
  return line;
}

function paragraph(text) {
  return element("p", text, "century-text");
}

function section(title, ...children) {
  const card = element("section", undefined, "century-card");
  card.append(element("h3", title), ...children);
  return card;
}

function control(label, action, click, { primary = false, disabled = false } = {}) {
  const node = element("button", label, primary ? "primary" : "quiet");
  node.type = "button";
  node.disabled = disabled;
  node.dataset.centuryAction = action;
  node.addEventListener("click", click);
  return node;
}

function field(label, input) {
  const wrapper = element("label", undefined, "century-field");
  wrapper.append(element("span", label), input);
  return wrapper;
}

function selector(label, options, value, change, name) {
  const input = element("select");
  input.replaceChildren(...options.map(([key, text]) => new Option(text, key)));
  if (value !== undefined) input.value = value;
  input.disabled = !options.length;
  if (change) input.addEventListener("change", () => change(input.value));
  if (name) input.dataset.centuryField = name;
  return { field: field(label, input), input };
}

const currentOptions = (state) => [
  ...openCases15(state).map((item) => ({ ...item, source: "century" })),
  ...reignAlerts(state).map((item) => ({ ...item, urgent: !["cargo-arrive", "compact"].includes(item.kind), source: "reign" })),
  ...strategicAlerts9(state).map((item) => ({ ...item, urgent: true, source: "strategy" })),
  ...dynastyNotices(state).map((item) => ({ ...item, urgent: true, source: "dynasty" })),
].sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.turn - a.turn);

export function centuryPendingCount(state) {
  return currentOptions(state).filter(({ urgent }) => urgent).length;
}

export function createCenturyDesk(world, api) {
  const dialog = document.querySelector("#century-dialog");
  const nav = dialog.querySelector("nav");
  const body = dialog.querySelector(".century-body");
  const feedback = dialog.querySelector(".century-feedback");
  let pane = "overview";
  let fieldKey;
  let draft;
  let comparison;
  let expanded = false;
  let auto = true;
  let firstTurn;
  let lastTurn;

  function detail(tab, key) {
    pane = tab;
    fieldKey = key;
    feedback.textContent = "";
    render();
    body.scrollTop = 0;
  }

  function open(tab = "overview", key) {
    if (!dialog.open) dialog.showModal();
    detail(tab, key);
  }

  function leave(action, value) {
    dialog.close();
    api[action](value);
  }

  function change(operation, message, then) {
    try {
      const next = operation(api.snapshot());
      then?.(next);
      api.commit(next, message);
      feedback.textContent = message;
    } catch (error) {
      feedback.textContent = error.message;
    }
  }

  function overview(state) {
    const data = state.century;
    const plan = data.plan;
    const stock = state.factions[state.player];
    const next = currentOptions(state).find(({ urgent }) => urgent);
    const sites = Object.values(state.cities).filter(({ owner }) => owner === state.player);
    const header = section(reignChapters15[data.chapter], row(
      element("span", sites.length + " 座辖城"),
      element("span", format.format(stock.treasury) + " 钱"),
      element("span", format.format(stock.grain) + " 粮"),
      element("span", "第 " + (data.generation + 1) + " 章")));
    header.classList.add("century-hero");
    body.append(header);
    if (plan) {
      body.append(section(annualObjectives15[plan.primary] + " · 保底 " + annualObjectives15[plan.secondary],
        paragraph("钱粮底线各 " + plan.reserve + " · 已委任 " + Object.keys(state.reign.seats).length + " 州 · 下次复核第 " + plan.review + " 季"),
        row(control("调整国策", "policy", () => detail("policy")), control("看战区", "war-map", () => leave("map", ["war"])),
          control("粮运地图", "economy-map", () => leave("map", ["economy"])))));
    } else {
      body.append(section("本局尚未颁布年度国策", paragraph("选定主目标后统一拨款，并为有合适人选的州郡设置委任。"),
        control("制定国策", "plan", () => detail("policy"), { primary: true })));
    }
    if (next) body.append(section("优先待决", paragraph(next.text), control("处置", "pending", () => detail("pending", next.source + next.id))));
    const outcome = gameOutcome(state);
    body.append(row(
      outcome === "ongoing" ? control("推进一季", "advance", () => leave("advance"), { primary: true }) :
        control("继续下一章", "reopen", () => change(api.reopen, "新章开始。"), { primary: true, disabled: outcome !== "victory" }),
      ...(outcome === "ongoing" ? [control("续行至多四季", "batch", () => leave("batch"))] : []),
      control("外交", "diplomacy", () => leave("diplomacy")),
      control("会战回放", "replay", () => leave("replay")),
    ));
  }

  function policy(state) {
    if (!draft) {
      draft = state.century.plan ? { ...state.century.plan } : annualDraft15("accord");
      auto = state.century.plan?.auto ?? true;
    }
    const options = Object.entries(annualObjectives15);
    const active = gameOutcome(state) === "ongoing";
    const annualToDoctrine = { recovery: "rest", accord: "prepare", expansion: "expand" };
    const descriptions = {
      expansion: "倾力前线募兵扩土，积极调度军费粮草与接管新城。",
      accord: "兼顾边防、商贸与外交通盟，稳中求进（兼配守边）。",
      recovery: "着重垦殖、赈济与安定民心，蓄积钱粮恢复元气。",
    };
    const presets = options.map(([id, label]) => {
      const button = control(label, "preset-" + id, () => { draft = annualDraft15(id); comparison = null; render(); }, { disabled: !active });
      button.setAttribute("aria-pressed", String(id === draft.primary));
      return button;
    });
    const design = selector("保底目标", options.filter(([id]) => id !== draft.primary), draft.secondary, (value) => {
      draft.secondary = value; comparison = null; render();
    }, "secondary");
    const delegation = element("input");
    delegation.type = "checkbox";
    delegation.checked = auto;
    delegation.addEventListener("change", () => { auto = delegation.checked; comparison = null; render(); });
    body.append(section("年度国策（三选一统一施行）",
      paragraph(descriptions[draft.primary] + " 颁布时同步配置城池委任与州牧。"),
      row(...presets),
      row(control("施行此国策", "publish", () => change((value) => {
        let next = publishYear15(world, value, draft, { auto });
        const doc = SOVEREIGN_DOCTRINES.find((d) => d.id === annualToDoctrine[draft.primary]);
        if (doc) {
          next = setNationalPolicy(next, null);
          next = setNationalPolicy(next, doc.policy);
        }
        next = appointAllProvinceGovernors(world, next).state;
        return next;
      }, "已统一颁布「" + annualObjectives15[draft.primary] + "」并任免州牧。",
      () => { pane = "overview"; draft = undefined; comparison = null; }), { primary: true, disabled: !active }),
      control(expanded ? "收起高级细项" : "高级与四季推演", "edit", () => { expanded = !expanded; render(); }))));
    if (expanded) {
      const fields = Object.entries(numberFields).map(([id, label]) => {
        const input = element("input");
        input.type = "number";
        input.inputMode = "numeric";
        input.min = id === "reserve" ? 5 : id === "transport" || id === "grain" ? 1 : 0;
        input.max = id === "transport" ? 6 : 160;
        input.value = draft[id];
        input.dataset.centuryField = id;
        input.addEventListener("change", () => { draft[id] = input.valueAsNumber; comparison = null; });
        return field(label, input);
      });
      body.append(section("高级配额（非必要无需调整）",
        row(design.field, field("代办续任和新城接管", delegation)),
        row(...fields),
        row(control("比较四季走势", "preview", () => {
          try {
            comparison = previewYear15(world, state, draft, { auto });
            feedback.textContent = "";
            render();
          } catch (error) { feedback.textContent = error.message; }
        }, { disabled: !active }))));
    }
    if (comparison) {
      const table = element("table", undefined, "century-table");
      const head = table.createTHead().insertRow();
      ["季", "现行钱 / 粮", "新案钱 / 粮", "停拨"].forEach((label) => head.append(element("th", label)));
      const rows = table.createTBody();
      const value = (item) => item ? item.cash + " / " + item.grain : "已结局";
      comparison.proposed.forEach((item, index) => {
        const line = rows.insertRow();
        [index + 1, value(comparison.current[index]), value(item), item.stalled].forEach((text) => line.insertCell().textContent = text);
      });
      body.append(section("四季推演", table, paragraph("按当前情势与规则对手推演。实际外交与战事可能改变结果。")));
    }
  }

  function pending(state) {
    const list = currentOptions(state);
    const selected = list.find((item) => item.source + item.id === fieldKey) ?? list[0];
    const court = courtFor(state, state.player);
    if (!selected) body.append(section("暂无待决", paragraph("预算内的例行事务由委任人员执行。")));
    if (selected) {
      const options = selector("选择奏报", list.map((item) => [item.source + item.id,
        (item.urgent ? "急 · " : "") + (item.city ? cityName(world, item.city) : "全国") + " · 第 " + item.turn + " 季"]), selected.source + selected.id,
      (value) => detail("pending", value), "pending");
      const buttons = [];
      if (selected.city) buttons.push(control("地图定位", "locate", () => leave("locate", selected.city)));
      if (selected.source === "century") {
        if (selected.kind === "charter") buttons.push(control("签署让权", "grant", () => change(
          (value) => answerCase15(world, value, selected.id, "grant"), "地方协议已重订。")));
        if (selected.kind === "resources") buttons.push(control("批准赈济", "relief", () => change(
          (value) => answerCase15(world, value, selected.id, "relief"), "已列入民仓调拨。")));
        buttons.push(control("归档", "read", () => change((value) => answerCase15(world, value, selected.id, "read"), "奏报已归档。")));
      }
      if (selected.source === "reign") {
        if (selected.kind === "market" && state.century.plan && state.cities[selected.city]?.owner === state.player) buttons.push(control("批准赈济", "relief", () =>
          change(api.relief(selected), "已列入民仓调拨。")));
        buttons.push(control("阅知", "read", () => change((value) => resolveReignAlert(world, value, selected.id, "read"), "奏报已归档。")));
      }
      if (selected.source === "strategy") buttons.push(control("打开全国方略", "strategy", () => leave("strategy")));
      if (selected.source === "dynasty") buttons.push(control("查看政务", "administration", () => leave("administration")));
      body.append(section("例外处置", options.field, paragraph(selected.text), row(...buttons)));
    }
    if (court?.warned || state.reign.stewardship) body.append(succession(state));
  }

  function succession(state) {
    const court = courtFor(state, state.player);
    const roster = [["", "请选择"], ...reignPeople(world, state).map(({ key, name }) => [key, name])];
    const successor = selector("继任者", roster, court?.heir ?? "", null, "successor");
    const deputy = selector("代理人", roster, court?.regent ?? "", null, "deputy");
    return section("朝廷交班", row(successor.field, deputy.field), row(
      control("登记交班", "succession", () => change((value) => reignSuccession(world, value, successor.input.value || null, deputy.input.value || null, true),
        "已令安排交班，由下一季核定。")),
      control("续定和约", "renew", () => change((value) => renewAccord15(world, value), "续约已登记。"))));
  }

  function local(state) {
    const provinces = dynastyProvinces(world, state);
    const province = provinces.find((item) => item.region === fieldKey) ?? provinces[0];
    const active = gameOutcome(state) === "ongoing";
    const officerMap = new Map(eraByYear(world, state).officers.map((o) => [o.key, o]));
    if (province) {
      const city = province.cities[0];
      const select = selector("州郡", provinces.map(({ region }) => [region, region]), province.region,
        (value) => detail("local", value), "region");
      const seat = state.reign.seats[province.region];
      const governor = seat?.lead && seat.end > state.turn ? officerMap.get(seat.lead) : null;
      const candidates = regionCandidates10(world, state, province.region);
      const leadPicker = selector(
        "选任州牧",
        candidates.length ? candidates.map((o) => [o.key, `${o.name}（政${o.governance}·统${o.command}）`]) : [["", "暂无闲员"]],
        governor?.key ?? candidates[0]?.key ?? "",
        null,
        "governor-pick",
      );
      const charter = state.century.charters[province.region];
      const labor = labor15(state, city);
      const stores = marketRow(state, city);
      body.append(section("州牧任免与地方统筹",
        row(select.field, leadPicker.field),
        paragraph(province.cities.length + " 城 · 现任州牧：" + (governor ? governor.name + "（余" + (seat.end - state.turn) + "季）" : "空缺")
          + " · 民心 " + province.welfare + " · 地方压力 " + province.pressure
          + (charter ? " · 留粮 " + charter.retain + "%" : "")),
        paragraph(cityName(world, city) + " 民仓 " + stores.bins + " · 可耕劳力 " + labor.cultivation + " / " + labor.capacity),
        row(
          control(governor ? "重签 / 换任州牧" : "委任州牧", "delegate", () => {
            const leadKey = leadPicker.input.value || undefined;
            change((value) => provinceAgreement15(world, value, province.region, "renew", { leadKey }),
              "已委任 " + (officerMap.get(leadKey)?.name || "能吏") + " 出任" + province.region + "州牧。");
          }, { primary: true, disabled: !active || !candidates.length }),
          control("签订共治安民", "compact", () => {
            const leadKey = leadPicker.input.value || undefined;
            change((value) => provinceAgreement15(world, value, province.region, "compact", { leadKey }),
              province.region + "共治安民协议已生效。");
          }, { disabled: !active || !candidates.length }),
          control("一键遍任各州", "appoint-all", () => change(
            (value) => appointAllProvinceGovernors(world, value).state, "已为各缺额州郡遍任州牧。"), { disabled: !active }),
          control("详细册任", "staff", () => leave("staff", province.region)),
          control("地图", "province-map", () => leave("map", ["regions", city])),
        )));
    }
    const fronts = strategicFronts9(state);
    if (fronts.length) {
      const chosen = fronts.find(({ id }) => Number(fieldKey) === id) ?? fronts[0];
      const select = selector("战区", fronts.map(({ id, seat, role }) => [id, cityName(world, seat) + " · " + theaterRoles9[role]]), chosen.id,
        (value) => detail("local", value), "front");
      body.append(section("战区授权", row(select.field, control(chosen.priority === 5 ? "恢复常额" : "优先拨付", "front-priority",
        () => change((value) => setFrontPriority15(world, value, chosen.id), "战区优先级已修改。")),
      control("地图", "front-map", () => leave("map", ["war", chosen.seat])))));
    }
    body.append(row(control("安排交班", "court", () => detail("court")), control("完整战区", "strategy", () => leave("strategy")),
      control("集团与通商", "leagues", () => leave("leagues"))));
  }

  function journal(state) {
    const data = state.century;
    const frames = data.frames;
    if (frames.length) {
      const options = frames.map(({ turn, chapter }) => [turn, "第 " + turn + " 季 · " + reignChapters15[chapter]]);
      const older = frames.find(({ turn }) => turn === firstTurn) ?? frames[0];
      const recent = frames.find(({ turn }) => turn === lastTurn) ?? frames.at(-1);
      const before = selector("起点", options, older.turn, (value) => { firstTurn = Number(value); render(); }, "from");
      const after = selector("终点", options, recent.turn, (value) => { lastTurn = Number(value); render(); }, "to");
      const shift = (a, b) => (b - a > 0 ? "+" : "") + format.format(b - a);
      body.append(section("季度对照", row(before.field, after.field),
        paragraph("辖城 " + shift(older.cities, recent.cities) + " · 国库 " + shift(older.cash, recent.cash)
          + " · 储粮 " + shift(older.grain, recent.grain) + " · 辖区人口 " + shift(older.population, recent.population)),
        paragraph("在途粮队 " + shift(older.cargos.length, recent.cargos.length)
          + " · 地方协议覆盖 " + shift(older.authority, recent.authority) + " 城"),
        row(control("起点地图", "before-map", () => leave("history", frame15(world, state, older.turn))),
          control("终点地图", "after-map", () => leave("history", frame15(world, state, recent.turn))),
          control("会战", "replay", () => leave("replay")))));
    }
    const outcomes = data.epochs.filter(({ generation }) => generation === data.generation).slice(-4);
    const choices = outcomes.map(({ kind, turn }) => {
      const texts = paragraph("第 " + turn + " 季 · " + choiceNames[kind]);
      return gameOutcome(state) === "ongoing" && Object.hasOwn(annualObjectives15, kind)
        ? row(texts, control("结卷", "conclude-" + kind, () => change((value) => concludeChapter15(value, kind), "本章战果已结卷。",
          () => { pane = "overview"; }))) : texts;
    });
    const restoration = data.restoration;
    const goal = data.plan?.primary;
    const recovered = Object.values(data.transitions).filter(({ to, progress }) => to === state.player && progress >= 3).length;
    const requirements = {
      expansion: "拓土立制：增加至少 3 城，完成 2 城接管并维持 4 季安定。已完成接管 " + recovered + " 城。",
      accord: "保境成约：守住开局城池规模，通商或集团履约 5 季，并维持 3 季安定。",
      recovery: "再整山河：分裂或失地危机后收复疆土，连续维持 4 季安定。",
    };
    body.append(section("本章进展",
      paragraph("开局 " + data.started + " 城 · 最多 " + data.peak + " 城 · 连续安定 " + data.stable + " 季 · 履约 " + data.trade + " 季"),
      ...(goal ? [paragraph(requirements[goal])] : []),
      ...(restoration ? [paragraph("重整起点 · 第 " + restoration.turn + " 季 · " + restoration.floor + " 城")] : []), ...choices));
  }

  function render() {
    if (!dialog.open) return;
    const state = api.snapshot();
    body.replaceChildren();
    nav.hidden = !state.century;
    if (!state.century) {
      body.append(section("将当前战局迁入「山河百年」", paragraph("迁移前备份会保存在本浏览器。城池、军团、条约、库存与奏报随原局继续。"),
        control("升级当前存档", "upgrade", () => change(api.upgrade, "旧档已备份，当前战局已升级。"), { primary: true })));
      return;
    }
    nav.replaceChildren(...Object.entries(tabs).map(([id, label]) => {
      const button = control(label, id, () => detail(id));
      button.setAttribute("aria-current", pane === id || pane === "court" && id === "local" ? "page" : "false");
      return button;
    }));
    if (pane === "policy") policy(state);
    else if (pane === "pending") pending(state);
    else if (pane === "local") local(state);
    else if (pane === "journal") journal(state);
    else if (pane === "court") body.append(succession(state));
    else overview(state);
  }

  return { open, render, close: () => dialog.close(), reset: () => {
    draft = undefined;
    comparison = null;
    firstTurn = undefined;
    lastTurn = undefined;
    pane = "overview";
  } };
}
