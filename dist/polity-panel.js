import { cityName, factionName, gameOutcome } from "./engine.js";
import { forceColor } from "./map.js";
import { provincePolicies, settlementKinds, territoryAt } from "./polities-data.js";
import { answerEdict, currentEdict, enablePolity, peaceCriteria } from "./polity.js";
import { courtBacking, courtCandidates, courtFor, provincialBudget, provinceRows, saveProvincePolicy, saveSuccession } from "./polity-governance.js";
import { cancelSettlement, proposeSettlement, respondSettlement, settlementDraft, settlementTerms } from "./polity-settlements.js";

export function createPolityPanel(world, { snapshot, commit, locate, conclude, seasonTitle }) {
  const find = (id) => document.getElementById("polity-" + id);
  const dialog = find("dialog");
  const tabs = [...find("tabs").querySelectorAll("button")];
  const land = new Path2D(world.land);
  const maps = new Map();
  let pane = "tasks";
  let frame = null;
  let entry = 0;

  function options(id, rows, preferred = find(id).value) {
    const select = find(id);
    select.replaceChildren(...rows.map(([key, label]) => new Option(label, key)));
    if (rows.some(([key]) => String(key) === String(preferred))) select.value = preferred;
    return select.value;
  }

  function message(text = "", error = false) {
    find("message").textContent = text;
    find("message").hidden = !text;
    find("message").dataset.error = String(error);
  }

  function act(change, label) {
    try {
      commit(change(snapshot()), label);
      render();
      return true;
    } catch (error) {
      message(error.message, true);
      return false;
    }
  }

  function button(label, action, disabled = false) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.disabled = disabled;
    element.addEventListener("click", action);
    return element;
  }

  function show(next) {
    pane = next;
    render();
  }

  const program = () => ({ focus: find("focus").value, treasury: find("money").valueAsNumber, grain: find("grain").valueAsNumber });
  const selectedRegion = (state) => provinceRows(world, state).find(({ region }) => region === find("region").value);
  const personName = (era, key) => era.officers.find((person) => person.key === key)?.name;

  function tasks({ state, era }) {
    const running = gameOutcome(state) === "ongoing";
    const { offers, deals } = state.polity;
    const rows = provinceRows(world, state).filter(({ warning }) => warning !== null).map((row) => ({
      key: "region:" + row.region, title: row.region + (row.crisis === null ? "预警" : "危机"),
      note: "地方压力 " + row.pressure + " / 100。可调整州郡预算，支援民生、驻防和商路。",
      buttons: [button("查看州郡", () => { show("province"); find("region").value = row.region; province({ state }); })],
    }));
    const seat = courtFor(state, state.player);
    const edict = currentEdict(world, state);
    if (seat && seat.due - state.turn <= 4) rows.push({
      key: "court", title: "安排交接", note: "距离交接还剩 " + (seat.due - state.turn) + " 季。",
      buttons: [button("查看继任", () => show("court"))],
    });
    for (const item of [...offers.filter(({ to }) => to === state.player), ...deals.filter(({ from, to }) => [from, to].includes(state.player))]) {
      const other = factionName(era, item.from === state.player ? item.to : item.from);
      rows.push({ key: "deal:" + item.id, title: settlementKinds[item.kind] + " · " + other,
        note: item.due ? "批准完成，等待实物交割。" : item.accept === undefined ? "往来议案待批复。" : "批复已登记，等待结算。",
        buttons: [button("查阅条款", () => {
          find("dip-view").value = "pending";
          show("diplomacy");
          find("deal").value = item.id;
          diplomacy({ state, era });
        })] });
    }
    if (edict) rows.push({
      key: "edict", title: edict.title + " · 剧本议案",
      note: edict.region + " · " + edict.text + " 预算 " + edict.treasury + " 钱、" + edict.grain + " 粮。"
        + (edict.answer === undefined ? "" : " 批复已登记。"),
      buttons: [button("拨款", () => act(({ state }) => answerEdict(world, state, true), "已登记拨款。"), !running || !edict.available),
        button("驳回", () => act(({ state }) => answerEdict(world, state, false), "已登记驳回。"), !running)],
    });
    const key = options("task", rows.map(({ key, title }) => [key, title]));
    const item = rows.find((row) => row.key === key);
    find("task-field").hidden = !item;
    find("task-note").textContent = item?.note ?? "当前没有地方预警、紧急交接或待处理国政议案。";
    find("task-actions").replaceChildren(...(item?.buttons ?? []));
  }

  function quoteProvince({ state }) {
    const row = selectedRegion(state);
    const draft = program();
    const valid = Number.isInteger(draft.treasury) && Number.isInteger(draft.grain) && find("province").checkValidity();
    const quote = row && valid ? provincialBudget(state, row, draft) : null;
    find("quote").textContent = quote ? "按现有钱粮与预留估算，可执行 " + quote.cities.length + " 城，支出 "
      + quote.treasury + " 钱、" + quote.grain + " 粮。" : "";
  }

  function province(context) {
    const { state } = context;
    const rows = provinceRows(world, state);
    const active = options("region", rows.map(({ region, cities }) => [region, region + " · " + cities.length + " 城"]));
    const row = rows.find(({ region }) => region === active);
    const editable = Boolean(row && gameOutcome(state) === "ongoing");
    find("pressure").textContent = row ? (row.crisis !== null ? "危机" : row.warning !== null ? "预警" : "平稳")
      + " · 压力 " + row.pressure + " / 100 · 平均民心 " + row.welfare + " · 驻军 " + row.garrison : "当前没有可治理的州郡。";
    find("causes").textContent = row ? "交接中 " + row.rebuilding + " · 民心低 " + row.lowWelfare
      + " · 驻军少 " + row.shortGarrison + " · 缺太守 " + row.absent : "";
    options("focus", Object.entries(provincePolicies), row?.policy?.focus ?? "relief");
    find("money").value = row?.policy?.treasury ?? 30;
    find("grain").value = row?.policy?.grain ?? 30;
    for (const id of ["focus", "money", "grain", "save-program"]) find(id).disabled = !editable;
    find("clear").disabled = !editable || !row?.policy;
    find("locate").disabled = !row;
    quoteProvince(context);
  }

  function quoteCourt({ state, era }) {
    const candidate = courtCandidates(era, state).find(({ key }) => key === find("heir").value);
    const running = Boolean(courtFor(state, state.player) && gameOutcome(state) === "ongoing");
    find("abdicate").disabled = !running || !candidate;
    find("backing").textContent = candidate ? "预计支持 " + courtBacking(world, state, state.player, candidate)
      + " / 100，达到 60 可顺利交接。" : "可提名本方在籍人物，设置代理人以备交接受阻。";
  }

  function court(context) {
    const { state, era } = context;
    const seat = courtFor(state, state.player);
    const running = Boolean(seat && gameOutcome(state) === "ongoing");
    const candidates = courtCandidates(era, state).filter(({ key }) => key !== seat?.head).map(({ key, name }) => [key, name]);
    find("court-status").textContent = seat ? (personName(era, seat.head) ?? "现任执政班底")
      + " · 距交接 " + (seat.due - state.turn) + " 季 · 已交接 " + seat.count + " 次。"
      + (seat.last ? " 上次获支持 " + seat.last.support + "。" : "") : "暂无继任安排。";
    options("heir", [["", "待提名"], ...candidates], seat?.heir ?? "");
    options("regent", [["", "待提名"], ...candidates], seat?.regent ?? "");
    for (const id of ["heir", "regent", "save-court"]) find(id).disabled = !running;
    quoteCourt(context);
  }

  function draftFor(state) {
    return settlementDraft(state, state.player, find("partner").value, find("kind").value, {
      ward: find("ward").value, city: find("return-city").value || null, payment: find("payment").valueAsNumber || 0,
    });
  }

  function quoteDeal({ state, era }) {
    const other = find("partner").value;
    const kind = find("kind").value;
    const peace = kind === "peace";
    find("peace-terms").hidden = !peace;
    find("payment").disabled = !peace;
    find("return-city").disabled = !peace;
    find("ward-field").hidden = peace;
    options("ward", [[state.player, factionName(era, state.player)], ...(other ? [[other, factionName(era, other)]] : [])],
      kind === "union" ? other : find("ward").value);
    find("ward").disabled = kind === "union";
    const held = world.cities.filter(({ key }) => state.cities[key].owner === state.player
      && settlementTerms(world, state, settlementDraft(state, state.player, other, "peace", { city: key }), true).possible);
    options("return-city", [["", "不返城"], ...held.map(({ key, name }) => [key, name])]);
    const result = settlementTerms(world, state, draftFor(state));
    find("terms").textContent = [result.summary, result.reason].filter(Boolean).join(" · ");
    find("send").disabled = !result.possible || gameOutcome(state) !== "ongoing" || !find("proposal").checkValidity();
  }

  function diplomacy(context) {
    const { state, era } = context;
    const view = find("dip-view").value;
    find("proposal").hidden = view !== "proposal";
    find("deal-list").hidden = view === "proposal";
    if (view === "proposal") {
      const live = new Set(Object.values(state.cities).map(({ owner }) => owner));
      options("partner", era.factions.filter(({ key }) => key !== state.player && live.has(key)).map(({ key, name }) => [key, name]));
      options("kind", Object.entries(settlementKinds));
      quoteDeal(context);
      return;
    }
    const { offers, deals, protections } = state.polity;
    const active = gameOutcome(state) === "ongoing";
    const rows = view === "protection" ? protections.map((item) => ({
      key: item.ward, title: factionName(era, item.ward) + " · " + factionName(era, item.patron),
      note: factionName(era, item.patron) + "提供保护 · 关系稳定 " + item.good + " 季 · 剩 " + (item.expires - state.turn) + " 季。",
      buttons: [],
    })) : [...offers, ...deals].filter(({ from, to }) => [from, to].includes(state.player)).map((item) => {
      const { from, to, kind, id, city, payment, due, ward, accept } = item;
      const buttons = [];
      if (!due && active && to === state.player) buttons.push(
        button("同意", () => act(({ state }) => respondSettlement(state, id, true), "已登记同意。")),
        button("拒绝", () => act(({ state }) => respondSettlement(state, id, false), "已登记拒绝。")));
      if (!due && active && from === state.player) buttons.push(
        button("撤回", () => act(({ state }) => cancelSettlement(state, id), "已撤回议案。")));
      const terms = kind === "peace" ? (payment ? "支付 " + payment + " 钱" : "无赔款")
        + (city ? "，返还" + cityName(world, city) : "") : factionName(era, ward) + "为受保护方";
      const status = due ? "待下季交割" : accept === undefined ? "待批复" : accept ? "已登记同意" : "已登记拒绝";
      return { key: id, title: settlementKinds[kind] + " · " + factionName(era, from) + " → " + factionName(era, to),
        note: status + " · " + terms + "。", buttons };
    });
    const key = options("deal", rows.map(({ key, title }) => [key, title]));
    const row = rows.find((item) => String(item.key) === key);
    find("deal-field").hidden = !row;
    find("deal-note").textContent = row?.note ?? (view === "protection" ? "暂无有效保护协定。" : "暂无待决或待交割议案。");
    find("deal-actions").replaceChildren(...(row?.buttons ?? []));
  }

  function archive({ state, era }) {
    const slider = find("quarter");
    const history = state.polity.atlas;
    slider.min = history[0].turn;
    slider.max = history.at(-1).turn;
    slider.value = Math.max(Number(slider.min), Math.min(Number(slider.max), frame ?? state.turn));
    slider.disabled = slider.min === slider.max;
    const turn = Number(slider.value);
    const owners = territoryAt(world, state, turn);
    const records = state.polity.history.filter((item) => item.turn === turn);
    entry = Math.max(0, Math.min(entry, records.length - 1));
    find("quarter-title").textContent = turn === state.polity.since ? "纪事起点" : seasonTitle(turn - 1);
    find("record").textContent = records.length ? (entry + 1) + " / " + records.length + " · "
      + factionName(era, records[entry].faction) + " · " + records[entry].text : "本季暂无留存事件。";
    find("history-prev").disabled = entry === 0;
    find("history-next").disabled = entry + 1 >= records.length;
    if (!maps.has(era.year)) maps.set(era.year, world.cities.map(({ key }) => new Path2D(era.zones[key])));
    const canvas = find("map");
    const ctx = canvas.getContext("2d");
    const [width, height] = world.view;
    const scale = Math.min(canvas.width / width, canvas.height / height);
    ctx.resetTransform();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, (canvas.width - width * scale) / 2, (canvas.height - height * scale) / 2);
    ctx.fillStyle = "#ded4b7";
    ctx.fill(land);
    ctx.save();
    ctx.clip(land);
    ctx.globalAlpha = .74;
    const paths = maps.get(era.year);
    world.cities.forEach(({ key }, index) => {
      ctx.fillStyle = forceColor(owners[key]);
      ctx.fill(paths[index]);
    });
    ctx.restore();
    ctx.fillStyle = "#efe3c7";
    const places = records[entry]?.city;
    world.cities.forEach(({ key, position: [x, y] }) => {
      ctx.beginPath();
      ctx.arc(x, y, (key === places ? 3.5 : 1.4) / scale, 0, Math.PI * 2);
      ctx.fill();
    });
    const counts = {};
    for (const owner of Object.values(owners)) counts[owner] = (counts[owner] ?? 0) + 1;
    canvas.setAttribute("aria-label", find("quarter-title").textContent + " · " + Object.entries(counts)
      .map(([key, count]) => factionName(era, key) + " " + count + " 城").join("、"));
  }

  function ending({ state }) {
    const { tests, ready } = peaceCriteria(world, state);
    find("conditions").replaceChildren(...tests.map(({ name, value, target }) => {
      const item = document.createElement("li");
      item.className = value >= target ? "stage-met" : "muted";
      item.textContent = name + " " + Math.min(value, target) + " / " + target;
      return item;
    }));
    find("conclude").disabled = !ready || gameOutcome(state) !== "ongoing";
    find("ending-note").textContent = state.scenarioEnding?.kind === "peace" ? "已达成天下承平。" : ready
      ? "条件齐备，确认后结束本局。" : "承平需要结清涉及本方的议案与本季政令。";
  }

  const sections = { tasks, province, court, diplomacy, archive, ending };
  function render() {
    const context = snapshot();
    const enabled = Boolean(context.state.polity);
    find("upgrade").hidden = enabled;
    find("enable").disabled = gameOutcome(context.state) !== "ongoing";
    find("tabs").hidden = !enabled;
    for (const tab of tabs) tab.setAttribute("aria-pressed", String(tab.dataset.polityTab === pane));
    for (const id of Object.keys(sections)) find(id).hidden = !enabled || pane !== id;
    message();
    if (enabled) sections[pane](context);
  }

  for (const tab of tabs) tab.addEventListener("click", () => show(tab.dataset.polityTab));
  find("enable").addEventListener("click", () => act(({ state }) => enablePolity(world, state), "已启用天下演变。"));
  find("task").addEventListener("change", () => tasks(snapshot()));
  find("region").addEventListener("change", () => province(snapshot()));
  find("province").addEventListener("input", () => quoteProvince(snapshot()));
  find("locate").addEventListener("click", () => locate(selectedRegion(snapshot().state).cities[0]));
  find("clear").addEventListener("click", () => act(({ state }) => saveProvincePolicy(world, state, find("region").value, null), "已收回州郡委任。"));
  find("province").addEventListener("submit", (event) => {
    event.preventDefault();
    act(({ state }) => saveProvincePolicy(world, state, find("region").value, program()), "已保存州郡方针。");
  });
  find("heir").addEventListener("change", () => quoteCourt(snapshot()));
  find("court").addEventListener("submit", (event) => {
    event.preventDefault();
    act(({ state, era }) => saveSuccession(world, era, state, { heir: find("heir").value || null, regent: find("regent").value || null,
      abdicate: event.submitter === find("abdicate") }), "已保存继任安排。");
  });
  find("dip-view").addEventListener("change", () => diplomacy(snapshot()));
  find("deal").addEventListener("change", () => diplomacy(snapshot()));
  find("proposal").addEventListener("change", () => quoteDeal(snapshot()));
  find("payment").addEventListener("input", () => quoteDeal(snapshot()));
  find("proposal").addEventListener("submit", (event) => {
    event.preventDefault();
    if (act(({ state }) => proposeSettlement(world, state, draftFor(state)), "已递交议案。")) {
      find("dip-view").value = "pending";
      diplomacy(snapshot());
    }
  });
  find("quarter").addEventListener("input", () => { frame = Number(find("quarter").value); entry = 0; archive(snapshot()); });
  find("history-prev").addEventListener("click", () => { entry -= 1; archive(snapshot()); });
  find("history-next").addEventListener("click", () => { entry += 1; archive(snapshot()); });
  find("conclude").addEventListener("click", conclude);
  return { open(next = "tasks", preferred) {
    frame = null;
    entry = 0;
    if (next === "diplomacy" && preferred !== undefined) find("dip-view").value = "pending";
    show(next);
    if (preferred !== undefined && snapshot().state.polity) {
      const selectors = { tasks: "task", province: "region", diplomacy: "deal" };
      const field = find(selectors[next]);
      if (field && [...field.options].some(({ value }) => value === String(preferred))) {
        field.value = preferred;
        sections[next](snapshot());
      }
    }
    if (!dialog.open) dialog.showModal();
  } };
}
