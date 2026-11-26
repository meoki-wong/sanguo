import {
  cityIncome, cityName, cityReserve, delegationZones, describeOrder as describeTurnOrder, eraByYear, factionName, forecastAttack,
  forceTotals, gameOutcome, minimumMarch, playableFactions, projects, queueOrder, recruitment, replaceOrders,
  respondToTreaty, seasonOrderLimit, seasons, setGovernance, setNationalPolicy,
} from "./engine.js";
import { armyPhases } from "./armies.js";
import { isHostile, quoteTreaty, treatyTerms, treatyWith } from "./diplomacy.js";
import { formationKinds } from "./frontline.js";
import { knownOfficer } from "./personnel.js";
import { intelSummary, townIntel } from "./war-intel.js";
import { warBlockaded } from "./war-operations.js";
import { latestSeasonSummary } from "./chronicle.js";
import { openCases15 } from "./century.js";
import { forceColor } from "./map.js";
import { activeBondsForOfficer, officerMeta } from "./traits.js";
import {
  factionCourtProfile, hanEmperorStatus, historicalProvince, proclaimImperialChoice,
} from "./imperial.js";
import {
  BATTLE_TACTICS, DIFFICULTY_LEVELS, isOpeningPrepTurn,
} from "./tactics.js";
import {
  PROVINCE_DIRECTIVES, SOVEREIGN_DOCTRINES, appointAllProvinceGovernors, applyCityDirective, applySovereignDoctrine,
  assignProvinceGovernor, autoStaffRealm, bestAttackPlan, buildImperialMemorials, detectSovereignDoctrine,
  executeGrandManeuver, executeSovereignAttack, executeSovereignReinforce, listSovereignProvinces, quickReinforcePlan,
} from "./sovereign.js";
import { recruitWildTalent } from "./saga.js";
import { promoteOfficer } from "./campaign.js";
import { resolveClimateChoice } from "./coalition.js";
import { getTechState, researchTech } from "./tech.js";
import {
  STRATAGEMS, evaluateDemandSurrender, evaluateSpreadRumor, executeDemandSurrender, executeSpreadRumor,
} from "./stratagems.js";
import {
  BUILDING_CATALOG, builtWonderInCity, cityBuildings, citySlotLimit, constructBuilding, constructWonder, wonderForCity,
} from "./buildings.js";
import {
  activeSiegeOn, establishSiegeBlockade, isSupplyCut, liftSiegeBlockade, raidSupplyLine,
} from "./supply.js";
import {
  ESPIONAGE_ACTIONS, cityVisibility, executeEspionageAction, hasInsider, isConfusedByEspionage, isFogOfWarEnabled, maskedTroopRange,
} from "./espionage.js";
import { personaForFaction } from "./ai-persona.js";
import { collectWarRoomItems } from "./war-room.js";

const fmt = new Intl.NumberFormat("zh-CN");
const signed = (n) => (n > 0 ? "+" : "") + fmt.format(n);
const focusOptions = [
  ["auto", "自主"],
  ["farming", "屯田"],
  ["commerce", "商贸"],
  ["defense", "城防"],
  ["recruit", "征兵"],
];
const budgetPresets = [
  ["", "不限"],
  ["20", "20钱"],
  ["40", "40钱"],
  ["60", "60钱"],
];

const $ = (id) => document.getElementById(id);
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

const orderTags = {
  build: "建设",
  recruit: "征兵",
  attack: "出征",
  transfer: "调兵",
  mobilize: "集结",
};

function makeSeal(officer, color, small = false) {
  const meta = officerMeta(officer);
  const seal = el("span", meta.seal, small ? "officer-seal sm" : "officer-seal");
  if (color) seal.style.setProperty("--force", color);
  seal.setAttribute("aria-hidden", "true");
  return seal;
}

function makeTraitPills(officer, limit = 2) {
  const wrap = el("div", undefined, "trait-pills-row");
  for (const trait of officerMeta(officer).traits.slice(0, limit)) {
    const pill = el("span", trait.name, "trait-pill");
    pill.dataset.tone = trait.tone;
    pill.title = trait.detail;
    wrap.append(pill);
  }
  return wrap;
}

export function createUxHud(world, api) {
  const workspace = $("workspace");
  const hoverCard = $("map-hover-card");
  const recapBox = $("season-recap");
  const ordersPopover = $("quick-orders-popover");
  const memorialsSheet = $("sovereign-memorials");
  const doctrinePopover = $("sovereign-doctrine-popover");
  const sovCityCard = $("sovereign-city-card");
  const HUD_MODE_KEY = "jinglue-sanguo:hud-mode:v2";
  let hudMode = "sovereign";
  try {
    if (localStorage.getItem(HUD_MODE_KEY) === "detail") hudMode = "detail";
  } catch { /* ignore */ }
  let activeSovCity = null;
  let sovAttackCity = null;
  let sovSelectedTactic = null;
  let railTab = "forces";
  let lastRecapTurn = -1;

  function isSovereignMode() {
    return hudMode === "sovereign";
  }

  function syncModeToggleLabel() {
    const toggleBtn = $("toggle-hud-mode");
    if (!toggleBtn) return;
    const { state } = api.snapshot();
    const lex = factionCourtProfile(world, state).lexicon;
    toggleBtn.textContent = hudMode === "detail" ? lex.modeLabel : "幕府详图";
    toggleBtn.setAttribute("aria-pressed", String(hudMode === "detail"));
  }

  function setHudMode(mode, { persist = true } = {}) {
    hudMode = mode === "detail" ? "detail" : "sovereign";
    document.body.dataset.hudMode = hudMode;
    syncModeToggleLabel();
    if (persist) {
      try { localStorage.setItem(HUD_MODE_KEY, hudMode); } catch { /* ignore */ }
    }
    if (hudMode === "sovereign") {
      setLeftRail(false);
      setCityDrawer(false);
      hideSeasonRecap();
      renderSovereignDock();
    } else {
      if (memorialsSheet) memorialsSheet.hidden = true;
      if (doctrinePopover) doctrinePopover.hidden = true;
      if (sovCityCard) sovCityCard.hidden = true;
      activeSovCity = null;
      if (!matchMedia("(max-width: 960px)").matches) {
        setLeftRail(true);
        setCityDrawer(true);
      }
    }
  }

  function setLeftRail(open) {
    workspace.dataset.leftRail = open ? "open" : "closed";
  }

  function setCityDrawer(open) {
    workspace.dataset.cityDrawer = open ? "open" : "closed";
  }

  function switchRailTab(tab) {
    railTab = tab;
    for (const btn of document.querySelectorAll("[data-rail-tab]")) {
      btn.setAttribute("aria-selected", String(btn.dataset.railTab === tab));
    }
    $("rail-pane-forces").hidden = tab !== "forces";
    $("rail-pane-tasks").hidden = tab !== "tasks";
  }

  function ownCities(state) {
    return world.cities.filter(({ key }) => state.cities[key].owner === state.player).map(({ key }) => key);
  }

  function cycleOwnCity(delta) {
    const { state, selected } = api.snapshot();
    const list = ownCities(state);
    if (!list.length) return;
    const idx = list.indexOf(selected);
    const next = list[(idx === -1 ? 0 : idx + delta + list.length) % list.length];
    api.locateAndSelect(next);
    setCityDrawer(true);
  }

  /* ---------- Floating Map Hover Tooltip ---------- */
  function showHover(info) {
    if (!info || matchMedia("(max-width: 960px)").matches) {
      hoverCard.hidden = true;
      return;
    }
    const { state, era } = api.snapshot();
    hoverCard.replaceChildren();

    if (info.type === "city") {
      const city = world.cities.find(({ key }) => key === info.key);
      if (!city) { hoverCard.hidden = true; return; }
      const holding = state.cities[info.key];
      const mine = holding.owner === state.player;
      const known = !state.war || mine;
      const treaty = treatyWith(state, state.player, holding.owner);
      const ownerColor = forceColor(holding.owner);

      const head = el("div", undefined, "hover-head");
      head.append(el("strong", city.name + " · " + historicalProvince(city.key, city.region)));
      const badge = el("span", factionName(era, holding.owner), "hover-owner");
      badge.style.setProperty("--force", ownerColor);
      head.append(badge);

      const troops = intelSummary(state, state.player, info.key);
      const defense = intelSummary(state, state.player, info.key, "defense");
      const grid = el("div", undefined, "hover-grid");
      const cell = (k, v) => {
        const span = el("span", k);
        span.append(el("b", v));
        return span;
      };
      grid.append(
        cell("驻军", troops),
        cell("城防", defense + (known ? " 级" : "")),
      );
      if (known) {
        const pop = state.realm?.cities[info.key];
        const inc = cityIncome(holding, pop);
        grid.append(
          cell("产钱", "+" + inc.treasury + "/季"),
          cell("产粮", "+" + inc.grain + "/季"),
        );
        if (pop) {
          grid.append(
            cell("民心", String(pop.welfare)),
            cell("开发", `田${holding.farming}·商${holding.commerce}`),
          );
        }
      } else {
        const intel = townIntel(state, state.player, info.key);
        grid.append(
          cell("关系", treaty ? treatyTerms[treaty.kind].name : "敌对"),
          cell("情报", intel.seen !== undefined ? `第${intel.seen}季` : "边报"),
        );
      }

      hoverCard.append(head, grid);
      const notes = [];
      let warn = false;
      const han = hanEmperorStatus(state);
      if (han.active && han.cityKey === info.key) {
        notes.push(`${han.name}驻跸于此 · 奉天子以令诸侯`);
      }
      if (holding.occupation) { notes.push(`整顿中（余 ${holding.occupation} 季）`); warn = true; }
      if (warBlockaded(state, info.key) && known) { notes.push("道路被封锁"); warn = true; }
      if (mine) {
        const gov = era.officers.find(({ key }) => key === holding.governor)?.name;
        const cmd = era.officers.find(({ key }) => key === holding.commander)?.name;
        notes.push(`太守：${gov || "空缺"} · 守将：${cmd || "空缺"}`);
        const qCount = state.orders.filter(({ city: c, from, to }) => [c, from, to].includes(info.key)).length;
        if (qCount) notes.push(`本城已排 ${qCount} 道政令`);
      }
      if (notes.length) {
        const foot = el("div", notes.join(" · "), "hover-foot");
        if (warn) foot.dataset.warn = "true";
        hoverCard.append(foot);
      }
    } else if (info.type === "army") {
      const { army, kind, supply } = info;
      const leader = era.officers.find(({ key }) => key === army.officer)?.name || "主将";
      const head = el("div", undefined, "hover-head");
      head.append(el("strong", leader + "军团"));
      const badge = el("span", factionName(era, army.faction), "hover-owner");
      badge.style.setProperty("--force", forceColor(army.faction));
      head.append(badge);

      const grid = el("div", undefined, "hover-grid");
      const cell = (k, v) => { const s = el("span", k); s.append(el("b", v)); return s; };
      grid.append(
        cell("兵种", formationKinds[kind] || "步军"),
        cell("兵力", fmt.format(army.troops)),
        cell("状态", army.observed ? "敌情侦见" : (armyPhases[army.phase] || "行军")),
        cell("目标", cityName(world, army.target)),
      );
      hoverCard.append(head, grid);
      if (!army.observed) {
        const foot = el("div", `随军粮 ${army.grain} · ${supply ? "补给畅通" : "补给中断！"}`, "hover-foot");
        if (!supply) foot.dataset.warn = "true";
        hoverCard.append(foot);
      }
    }

    hoverCard.hidden = false;
    const pad = 16;
    const w = hoverCard.offsetWidth || 244;
    const h = hoverCard.offsetHeight || 110;
    const left = Math.min(window.innerWidth - w - 12, Math.max(12, info.x + pad));
    const top = info.y + pad + h > window.innerHeight - 12
      ? Math.max(12, info.y - h - pad)
      : Math.max(12, info.y + pad);
    hoverCard.style.left = left + "px";
    hoverCard.style.top = top + "px";
  }

  /* ---------- Topbar Deltas & Vital Stats ---------- */
  function renderTopbarExtras(state) {
    const totals = forceTotals(state, state.player);
    const profile = factionCourtProfile(world, state);
    const rankBadge = $("hud-rank-badge");
    if (rankBadge) {
      const rep = state.saga?.reputation;
      const custom = state.saga?.custom;
      const titleText = custom?.stateName ? `${custom.stateName} · ${custom.rulerName}` : profile.badge;
      rankBadge.textContent = rep !== undefined ? `${titleText} · 望${rep}` : titleText;
      rankBadge.dataset.tier = profile.tier;
      rankBadge.dataset.emperor = String(profile.holdsEmperor);
      rankBadge.title = rep !== undefined ? `${profile.tooltip} · 海内声望 ${rep}/100` : profile.tooltip;
      rankBadge.hidden = false;
    }
    const sagaBtn = $("open-saga-chronicle");
    if (sagaBtn) sagaBtn.hidden = !state.century;
    const wrBtn = $("open-war-room");
    if (wrBtn) {
      wrBtn.hidden = !state.century;
      if (state.century) {
        const era = eraByYear(world, state);
        const cnt = collectWarRoomItems(world, era, state).length;
        wrBtn.textContent = cnt > 0 ? `军机处 ${cnt}` : "军机处";
      }
    }
    const techBtn = $("open-tech-dialog");
    if (techBtn) {
      techBtn.hidden = !state.century;
      if (state.century) {
        const tp = getTechState(state).points ?? 0;
        techBtn.textContent = `兵技 ${tp}`;
      }
    }
    const achBtn = $("open-achievements-dialog");
    if (achBtn) achBtn.hidden = !state.century;
    syncModeToggleLabel();
    const tDelta = $("treasury-delta");
    const gDelta = $("grain-delta");
    if (tDelta) {
      tDelta.textContent = signed(totals.treasury);
      tDelta.dataset.neg = String(totals.treasury < 0);
    }
    if (gDelta) {
      gDelta.textContent = signed(totals.grain);
      gDelta.dataset.neg = String(totals.grain < 0);
    }
    const cEl = $("hud-cities");
    if (cEl) cEl.textContent = totals.cities + "/" + world.cities.length;
    const trEl = $("hud-troops");
    if (trEl) trEl.textContent = totals.troops >= 10000 ? (totals.troops / 10000).toFixed(1) + "万" : fmt.format(totals.troops);

    const yearBtn = $("advance-year");
    if (yearBtn) {
      yearBtn.hidden = !state.sandtable || gameOutcome(state) !== "ongoing";
      yearBtn.disabled = $("advance").disabled;
    }

    // Show/hide 15.0 map lens buttons in bottom HUD
    const hasReign = Boolean(state.reign);
    for (const btn of document.querySelectorAll("[data-hud-lens]")) {
      btn.hidden = !hasReign;
    }
  }

  /* ---------- Left Rail Priority Task Feed ---------- */
  function renderPriorityFeed(state) {
    const feed = $("priority-feed");
    const badge = $("rail-task-badge");
    if (!feed) return;
    const priorities = api.getPriorities();
    const cases = state.century ? openCases15(state) : [];
    const totalUrgent = priorities.length + cases.filter((c) => c.urgent).length;
    if (badge) badge.textContent = totalUrgent ? `(${totalUrgent})` : "";

    const rows = [];
    const pendingLabel = factionCourtProfile(world, state).lexicon.pendingLabel;
    for (const c of cases.slice(0, 3)) {
      const btn = el("button", undefined, "priority-item");
      btn.type = "button";
      if (c.urgent) btn.dataset.urgent = "true";
      const title = el("strong", (c.urgent ? "急 · " : "") + (c.city ? cityName(world, c.city) : pendingLabel));
      title.append(el("span", "处置 ›"));
      btn.append(title, el("span", c.text));
      btn.addEventListener("click", () => api.openCenturyPending(c));
      rows.push(btn);
    }
    for (const item of priorities) {
      const btn = el("button", undefined, "priority-item");
      btn.type = "button";
      const title = el("strong", item.title);
      title.append(el("span", "前往 ›"));
      btn.append(title, el("span", item.detail));
      btn.addEventListener("click", () => api.performAction(item.action, item.target));
      rows.push(btn);
    }
    if (!rows.length) {
      const btn = el("button", undefined, "priority-item");
      btn.type = "button";
      btn.append(el("strong", "查看本季军政建议"), el("span", "国中暂无急务，可查看军议建议或推进一季。"));
      btn.addEventListener("click", () => api.performAction("advice"));
      rows.push(btn);
    }
    feed.replaceChildren(...rows);
  }

  /* ---------- Right City Drawer: Visual Vital Strip + 1-Click Domestic Cards ---------- */
  function renderCityDrawerExtras(state, planned, era, selected) {
    const holding = state.cities[selected];
    const headerBar = $("city-heading-bar");
    if (headerBar) headerBar.style.setProperty("--city-accent", forceColor(holding.owner));

    // Vital strip (Population, Welfare, Officers, Occupation)
    const vital = $("city-vital-strip");
    if (vital) {
      const badges = [];
      const mine = holding.owner === state.player;
      const pop = state.realm?.cities[selected];
      if (mine && pop) {
        const bPop = el("span", `人口 ${fmt.format(pop.population)}`, "vital-badge");
        const bWel = el("span", `民心 ${pop.welfare}`, "vital-badge");
        bWel.dataset.state = pop.welfare < 50 ? "warn" : pop.welfare >= 75 ? "good" : "";
        badges.push(bPop, bWel);
      }
      if (mine) {
        const gov = era.officers.find(({ key }) => key === holding.governor)?.name;
        const cmd = era.officers.find(({ key }) => key === holding.commander)?.name;
        badges.push(el("span", `太守:${gov || "缺"}`, "vital-badge"));
        badges.push(el("span", `守将:${cmd || "缺"}`, "vital-badge"));
      }
      if (holding.occupation) {
        const occ = el("span", `整顿余 ${holding.occupation} 季`, "vital-badge");
        occ.dataset.state = "warn";
        badges.push(occ);
      }
      if (warBlockaded(state, selected) && (mine || !state.war)) {
        const blk = el("span", "道路封锁", "vital-badge");
        blk.dataset.state = "warn";
        badges.push(blk);
      }
      vital.replaceChildren(...badges);
    }

    // 1-Click 2x2 Domestic Action Cards
    const cardsBox = $("domestic-cards");
    const cardsHeading = $("domestic-cards-heading");
    const slotHint = $("domestic-slot-hint");
    const ongoing = gameOutcome(state) === "ongoing";
    const canAct = ongoing && planned.cities[selected].owner === state.player;
    const slotsLeft = Math.max(0, seasonOrderLimit - state.orders.length);

    if (cardsHeading) cardsHeading.hidden = !canAct;
    if (cardsBox) {
      cardsBox.hidden = !canAct;
      if (slotHint) slotHint.textContent = `剩余 ${slotsLeft}/${seasonOrderLimit} 政令`;
      if (canAct) {
        const stock = planned.factions[state.player];
        const cards = [];
        for (const [key, proj] of Object.entries(projects)) {
          const curLv = holding[key];
          const nextLv = planned.cities[selected][key];
          const max = nextLv >= 5;
          const affordable = stock.treasury >= proj.cost;
          const card = el("button", undefined, "domestic-card");
          card.type = "button";
          card.dataset.kind = key;
          card.disabled = max || !affordable || slotsLeft <= 0;
          const top = el("div", undefined, "domestic-card-top");
          top.append(el("strong", proj.name), el("span", max ? "已满级" : `${proj.cost} 钱`, "card-cost"));
          const sub = el("span", max ? "Lv.5 巅峰" : !affordable ? "国库不足" : slotsLeft <= 0 ? "本季政令已满" : `Lv.${nextLv} → Lv.${nextLv + 1}`, "card-sub");
          const pips = el("div", undefined, "level-pips");
          for (let lv = 1; lv <= 5; lv++) {
            const pip = el("span", undefined, "level-pip");
            if (lv <= curLv) pip.dataset.filled = "true";
            else if (lv <= nextLv) pip.dataset.next = "true";
            pips.append(pip);
          }
          card.append(top, sub, pips);
          card.addEventListener("click", () => {
            api.commitOrder({ type: "build", city: selected, project: key });
          });
          cards.push(card);
        }
        // Recruit card
        const canRecruit = stock.treasury >= recruitment.treasury && stock.grain >= recruitment.grain;
        const rCard = el("button", undefined, "domestic-card");
        rCard.type = "button";
        rCard.dataset.kind = "recruit";
        rCard.disabled = !canRecruit || slotsLeft <= 0;
        const rTop = el("div", undefined, "domestic-card-top");
        rTop.append(el("strong", `征兵 +${recruitment.troops}`), el("span", `${recruitment.treasury}钱 ${recruitment.grain}粮`, "card-cost"));
        const rSub = el("span", !canRecruit ? "钱粮不足" : slotsLeft <= 0 ? "本季政令已满" : `现有驻军 ${fmt.format(planned.cities[selected].troops)}`, "card-sub");
        rCard.append(rTop, rSub);
        rCard.addEventListener("click", () => {
          api.commitOrder({ type: "recruit", city: selected });
        });
        cards.push(rCard);
        cardsBox.replaceChildren(...cards);
      }
    }

    // Delegation Focus Segmented Pills & Budget Chips
    const focusPills = $("delegate-focus-pills");
    const budgetChips = $("delegate-budget-chips");
    const isDelegated = holding.mode === "delegated";
    const isOwned = ongoing && holding.owner === state.player;
    if (focusPills) {
      focusPills.hidden = !isDelegated;
      if (isDelegated) {
        focusPills.replaceChildren(...focusOptions.map(([val, label]) => {
          const btn = el("button", label, "pill-btn");
          btn.type = "button";
          btn.disabled = !isOwned;
          btn.setAttribute("aria-pressed", String(holding.focus === val));
          btn.addEventListener("click", () => {
            api.commitState(() => setGovernance(state, selected, "delegated", val, holding.delegateBudget));
          });
          return btn;
        }));
      }
    }
    if (budgetChips) {
      budgetChips.hidden = !isDelegated;
      if (isDelegated) {
        const cur = holding.delegateBudget === null ? "" : String(holding.delegateBudget);
        budgetChips.replaceChildren(...budgetPresets.map(([val, label]) => {
          const btn = el("button", label, "pill-btn");
          btn.type = "button";
          btn.disabled = !isOwned;
          btn.setAttribute("aria-pressed", String(cur === val));
          btn.addEventListener("click", () => {
            api.commitState(() => setGovernance(state, selected, "delegated", holding.focus, val === "" ? null : Number(val)));
          });
          return btn;
        }));
      }
    }

    // Contextual City Quick Links
    const quick = $("city-quick-links");
    if (quick) {
      const links = [];
      const addLink = (label, fn) => {
        const b = el("button", label);
        b.type = "button";
        b.addEventListener("click", fn);
        links.push(b);
      };
      if (ongoing && holding.owner === state.player) {
        if (state.century) addLink("州郡委任", () => api.openProvince(selected));
        if (state.landscape) addLink("粮运调度", () => api.openConvoy(selected));
        if (state.frontline) addLink("会战部署", () => api.openBattle(selected));
        addLink("前线军情", () => api.openFrontier());
      } else if (ongoing) {
        if (state.war) addLink("派斥候侦察 (6粮)", () => api.startMapAction(selected, "scout"));
        if (state.frontline) addLink("针对此城会战", () => api.openBattle(selected));
      }
      quick.replaceChildren(...links);
      quick.hidden = !links.length;
    }

    // Sync Attack / Transfer map-pick triggers & sliders
    const mapPickAttack = $("attack-map-pick");
    if (mapPickAttack) {
      mapPickAttack.hidden = !ongoing;
      mapPickAttack.textContent = holding.owner === state.player ? "⚔ 在地图点选出征 / 编组军团" : "⚔ 在地图选出发城进攻此城";
    }
    const mapPickTransfer = $("transfer-map-pick");
    if (mapPickTransfer) {
      mapPickTransfer.hidden = !ongoing || holding.owner !== state.player;
    }

    syncSlidersAndTargetCards(state, planned, era, selected);
    renderSelectedGeneralTraits();
    renderAppointmentCards(state, era, selected);
  }

  /* ---------- Attack General 4-Dim & Trait Strip ---------- */
  function renderSelectedGeneralTraits() {
    const strip = $("attack-officer-traits");
    if (!strip) return;
    if ($("attack-form")?.hidden) {
      strip.hidden = true;
      return;
    }
    const { state, era } = api.snapshot();
    const key = $("officer-picker")?.value;
    const person = era.officers.find((o) => o.key === key);
    if (!person) {
      strip.hidden = true;
      return;
    }
    const meta = officerMeta(person);
    const activeBonds = activeBondsForOfficer(era, state, state.player, person).bonds;
    const info = el("div", undefined, "officer-trait-meta");
    const nameLine = meta.title ? `${person.name}（字${meta.title}）` : person.name;
    const pillsRow = meta.traits.length ? makeTraitPills(person, 2) : el("div", undefined, "officer-trait-row");
    for (const bond of activeBonds) pillsRow.append(el("span", bond.name, "bond-badge"));
    if (!meta.traits.length && !activeBonds.length) pillsRow.append(el("span", "暂无专属特技", "muted"));
    info.append(
      el("div", `${nameLine} · 统${person.command} 武${meta.might} 智${meta.intellect} 政${person.governance}`, "officer-stat-line"),
      pillsRow,
    );
    strip.replaceChildren(makeSeal(person, forceColor(state.player)), info);
    strip.hidden = false;
  }

  /* ---------- Appointment Tab Visual Slot Cards ---------- */
  function renderAppointmentCards(state, era, selected) {
    const wrap = $("appointment-cards");
    if (!wrap) return;
    const holding = state.cities[selected];
    const color = forceColor(holding.owner);
    const slots = [
      ["太守", holding.governor, "governance", "政务"],
      ["守将", holding.commander, "command", "统率"],
    ];
    wrap.replaceChildren(...slots.map(([roleName, officerKey, mainKey, mainLabel]) => {
      const card = el("div", undefined, "appointment-slot");
      const person = era.officers.find((o) => o.key === officerKey);
      if (!person) {
        const head = el("div", undefined, "appointment-slot-head");
        const seal = el("span", "缺", "officer-seal sm");
        seal.style.setProperty("--force", "#474238");
        const txt = el("div");
        txt.append(el("small", roleName), el("div", "暂缺", "muted"));
        head.append(seal, txt);
        card.append(head);
        return card;
      }
      const meta = officerMeta(person);
      const head = el("div", undefined, "appointment-slot-head");
      const txt = el("div");
      txt.append(el("small", `${roleName} · ${mainLabel}${person[mainKey]} 智${meta.intellect}`), el("div", undefined, undefined));
      txt.lastChild.append(el("strong", person.name));
      head.append(makeSeal(person, color, true), txt);
      card.append(head);
      if (meta.traits.length) card.append(makeTraitPills(person, 2));
      return card;
    }));
  }

  /* ---------- Floating Quick Orders Popover ---------- */
  function renderQuickOrdersPopover() {
    if (!ordersPopover || ordersPopover.hidden) return;
    const { state, planned, era } = api.snapshot();
    const stock = planned.factions[state.player];
    $("qo-balance").textContent = `余 ${fmt.format(stock.treasury)} 钱 · ${fmt.format(stock.grain)} 粮`;
    $("qo-error").hidden = true;
    const list = $("qo-list");
    const orders = state.orders ?? [];
    if (!orders.length) {
      list.replaceChildren(el("li", "本季尚未下达政令。可从城池面板一键施政或出征。", "muted"));
    } else {
      list.replaceChildren(...orders.map((order, idx) => {
        const li = el("li", undefined, "qo-item");
        const tag = el("span", orderTags[order.type] || "政令", "qo-tag");
        tag.dataset.kind = order.type;
        const desc = el("span", describeTurnOrder(world, era, order), "qo-desc");
        const ctrls = el("div", undefined, "qo-actions");
        const reorder = (shift) => {
          const copy = [...state.orders];
          copy.splice(idx, 1);
          if (shift !== 0) copy.splice(idx + shift, 0, order);
          try {
            const next = replaceOrders(world, state, copy);
            api.commitState(() => next, shift === 0 ? "已撤销政令。" : "已调整政令顺序。");
            renderQuickOrdersPopover();
          } catch (err) {
            const errEl = $("qo-error");
            errEl.textContent = err.message;
            errEl.hidden = false;
          }
        };
        const up = el("button", "↑", "quiet");
        up.type = "button";
        up.disabled = idx === 0;
        up.title = "上移";
        up.addEventListener("click", () => reorder(-1));
        const down = el("button", "↓", "quiet");
        down.type = "button";
        down.disabled = idx === orders.length - 1;
        down.title = "下移";
        down.addEventListener("click", () => reorder(1));
        const del = el("button", "✕", "quiet");
        del.type = "button";
        del.title = "撤销";
        del.addEventListener("click", () => reorder(0));
        ctrls.append(up, down, del);
        li.append(tag, desc, ctrls);
        return li;
      }));
    }
    const advBtn = $("qo-advance");
    if (advBtn) {
      advBtn.disabled = $("advance")?.disabled;
      advBtn.textContent = $("advance")?.textContent || "推进一季";
    }
  }

  function toggleOrdersPopover(force) {
    if (!ordersPopover) return;
    const show = force ?? ordersPopover.hidden;
    ordersPopover.hidden = !show;
    if (show) {
      api.sound?.play("click");
      renderQuickOrdersPopover();
    }
  }

  /* ---------- Visual Scenario & Faction Selector Cards (#campaign-dialog) ---------- */
  function renderCampaignCards() {
    const eraBox = $("era-cards");
    const forceBox = $("force-cards");
    const eraSelect = $("era-select");
    const forceSelect = $("force-select");
    if (!eraBox || !forceBox || !eraSelect || !forceSelect) return;

    const selectedYear = Number(eraSelect.value);
    const selectedFaction = forceSelect.value;
    const scenarios = [...world.scenarios].sort((a, b) => a.year - b.year);

    eraBox.replaceChildren(...scenarios.map((sc) => {
      const btn = el("button", undefined, "era-card");
      btn.type = "button";
      btn.setAttribute("aria-pressed", String(sc.year === selectedYear));
      btn.append(el("strong", sc.year + " 年"), el("span", sc.title));
      btn.addEventListener("click", () => {
        api.sound?.play("click");
        eraSelect.value = String(sc.year);
        eraSelect.dispatchEvent(new Event("change", { bubbles: true }));
        renderCampaignCards();
      });
      return btn;
    }));

    const scenario = eraByYear(world, selectedYear);
    if (!scenario) return;
    const factions = playableFactions(scenario);
    const cityCounts = new Map();
    for (const owner of Object.values(scenario.ownership)) {
      cityCounts.set(owner, (cityCounts.get(owner) || 0) + 1);
    }
    factions.sort((a, b) => (cityCounts.get(b.key) || 0) - (cityCounts.get(a.key) || 0));

    forceBox.replaceChildren(...factions.map((fac) => {
      const cities = cityCounts.get(fac.key) || 0;
      const tier = cities >= 12 ? "霸主" : cities >= 6 ? "强藩" : cities >= 3 ? "割据" : "偏安";
      const stars = scenario.officers
        .filter((o) => o.faction === fac.key && !o.reserve)
        .sort((a, b) => (b.command + b.governance) - (a.command + a.governance))
        .slice(0, 3)
        .map((o) => o.name)
        .join(" · ");
      const btn = el("button", undefined, "force-card");
      btn.type = "button";
      btn.style.setProperty("--force", forceColor(fac.key));
      btn.setAttribute("aria-pressed", String(fac.key === selectedFaction));
      const top = el("div", undefined, "force-card-top");
      top.append(el("strong", fac.name), el("span", `${tier} · ${cities}城`, "force-tier"));
      btn.append(top, el("span", fac.trait || "", "force-card-meta"), el("span", stars || "名将待募", "force-card-stars"));
      btn.addEventListener("click", () => {
        api.sound?.play("click");
        forceSelect.value = fac.key;
        forceSelect.dispatchEvent(new Event("change", { bubbles: true }));
        renderCampaignCards();
      });
      return btn;
    }));

    const diffBox = $("difficulty-cards");
    const diffSelect = $("difficulty-select");
    if (diffBox && diffSelect) {
      const selectedDiff = diffSelect.value || "hard";
      diffBox.replaceChildren(...Object.values(DIFFICULTY_LEVELS).map((d) => {
        const btn = el("button", undefined, "difficulty-card");
        btn.type = "button";
        btn.setAttribute("aria-pressed", String(d.id === selectedDiff));
        const top = el("div", undefined, "doctrine-card-head");
        top.append(el("strong", d.name), el("span", d.tag, "doctrine-card-tag"));
        btn.append(top, el("span", d.desc, "doctrine-card-desc"));
        btn.addEventListener("click", () => {
          api.sound?.play("click");
          diffSelect.value = d.id;
          diffSelect.dispatchEvent(new Event("change", { bubbles: true }));
          renderCampaignCards();
        });
        return btn;
      }));
    }
  }

  /* ---------- Visual Diplomacy Cards (#diplomacy-dialog) ---------- */
  function renderDiplomacyCards() {
    const wrap = $("diplomacy-cards");
    const targetSelect = $("diplomacy-target");
    const kindSelect = $("diplomacy-kind");
    if (!wrap || !targetSelect) return;

    const { state, planned, era } = api.snapshot();
    const opponents = playableFactions(era).filter(({ key }) => key !== state.player && forceTotals(state, key).cities > 0);
    if (!opponents.length) {
      wrap.replaceChildren();
      return;
    }
    const selectedTarget = targetSelect.value;
    const kind = kindSelect?.value || "truce";
    const stock = planned.factions[state.player].treasury;

    wrap.replaceChildren(...opponents.map(({ key, name }) => {
      const totals = forceTotals(state, key);
      const treaty = treatyWith(state, state.player, key);
      const quote = quoteTreaty(world, state, key, kind, stock);
      const btn = el("button", undefined, "diplomacy-card");
      btn.type = "button";
      btn.style.setProperty("--force", forceColor(key));
      btn.setAttribute("aria-pressed", String(key === selectedTarget));

      const head = el("div", undefined, "diplomacy-card-head");
      head.append(el("strong", name));
      const rel = el("span", treaty ? `${treatyTerms[treaty.kind].name} 余${treaty.expires - state.turn}季` : quote.accepted ? "有望应允" : "敌对", "diplomacy-card-rel");
      if (treaty || quote.accepted) rel.dataset.pact = "true";
      head.append(rel);

      const stats = el("div", undefined, "diplomacy-card-stats");
      stats.append(el("span", `${totals.cities} 城`), el("span", `兵力 ${fmt.format(totals.troops)}`));
      btn.append(head, stats);
      btn.addEventListener("click", () => {
        api.sound?.play("click");
        targetSelect.value = key;
        targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
        renderDiplomacyCards();
      });
      return btn;
    }));
  }

  function syncSoundButton() {
    const btn = $("toggle-sound");
    if (!btn || !api.sound) return;
    const muted = api.sound.isMuted();
    btn.textContent = muted ? "🔇" : "🔊";
    btn.dataset.muted = String(muted);
    btn.setAttribute("aria-pressed", String(muted));
    btn.title = muted ? "开启古风音效" : "静音古风音效";
  }

  function syncSlidersAndTargetCards(state, planned, era, selected) {
    // Sync attack slider bounds & value
    const troopsInput = $("troops");
    const troopsSlider = $("troops-slider");
    if (troopsInput && troopsSlider && !$("attack-form").hidden) {
      const max = Number(troopsInput.max) || minimumMarch;
      troopsSlider.min = String(minimumMarch);
      troopsSlider.max = String(Math.max(minimumMarch, max));
      troopsSlider.value = String(Math.min(max, Math.max(minimumMarch, Number(troopsInput.value) || minimumMarch)));
    }
    // Render quick enemy target cards with live win/loss badge
    const cardsWrap = $("attack-target-cards");
    const targetPicker = $("target-picker");
    const officerPicker = $("officer-picker");
    if (cardsWrap && targetPicker && !$("attack-form").hidden) {
      const targets = [...targetPicker.options].map((o) => o.value).filter(Boolean);
      const curTarget = targetPicker.value;
      const curOfficer = officerPicker.value;
      const curTroops = Number(troopsInput.value) || minimumMarch;
      cardsWrap.replaceChildren(...targets.map((key) => {
        const enemyOwner = planned.cities[key].owner;
        const btn = el("button", undefined, "target-quick-card");
        btn.type = "button";
        btn.setAttribute("aria-pressed", String(key === curTarget));
        const nameWrap = el("span", undefined, "tq-name");
        const dot = el("span", "", "force-dot");
        dot.style.setProperty("--force", forceColor(enemyOwner));
        nameWrap.append(dot, el("span", `${cityName(world, key)} · ${intelSummary(state, state.player, key)}`));
        btn.append(nameWrap);
        if (curOfficer) {
          const curTactic = state.century ? ($("attack-tactic")?.value || "assault") : undefined;
          const outcome = forecastAttack(era, planned, { type: "attack", from: selected, to: key, officer: curOfficer, troops: curTroops, ...(curTactic ? { tactic: curTactic } : {}) });
          const badge = el("span", outcome.wins ? "占优" : "劣势", "tq-badge");
          badge.dataset.win = String(outcome.wins);
          btn.append(badge);
        }
        btn.addEventListener("click", () => {
          targetPicker.value = key;
          targetPicker.dispatchEvent(new Event("input", { bubbles: true }));
          syncPowerBar();
        });
        return btn;
      }));
      syncPowerBar();
    }

    // Sync transfer slider
    const trInput = $("transfer-troops");
    const trSlider = $("transfer-troops-slider");
    if (trInput && trSlider && !$("transfer-form").hidden) {
      const max = Number(trInput.max) || minimumMarch;
      trSlider.min = String(minimumMarch);
      trSlider.max = String(Math.max(minimumMarch, max));
      trSlider.value = String(Math.min(max, Math.max(minimumMarch, Number(trInput.value) || minimumMarch)));
    }
  }

  function syncPowerBar() {
    const compare = $("attack-power-compare");
    const offBar = $("power-bar-off");
    const defBar = $("power-bar-def");
    if (!compare || !offBar || !defBar || $("attack-form").hidden) {
      if (compare) compare.hidden = true;
      return;
    }
    const { state, planned, era, selected } = api.snapshot();
    const to = $("target-picker").value;
    const officer = $("officer-picker").value;
    const troops = Number($("troops").value);
    const tactic = state.century ? ($("attack-tactic")?.value || "assault") : undefined;
    if (!to || !officer || !troops || !$("troops").checkValidity()) {
      compare.hidden = true;
      return;
    }
    const outcome = forecastAttack(era, planned, { type: "attack", from: selected, to, officer, troops, ...(tactic ? { tactic } : {}) });
    const total = Math.max(1, outcome.offense + outcome.defense);
    const offPct = Math.round((outcome.offense / total) * 100);
    offBar.style.width = offPct + "%";
    defBar.style.width = (100 - offPct) + "%";
    compare.hidden = false;
  }

  /* ---------- Sovereign Mode (君主模式 · 御案定天下) ---------- */
  const focusZh = { farming: "屯田", commerce: "商贸", defense: "城防", recruit: "征兵", auto: "自主" };

  function closeSovereignCityCard() {
    activeSovCity = null;
    if (sovCityCard) sovCityCard.hidden = true;
  }

  function renderSovereignDock() {
    if (!isSovereignMode()) return;
    const { state, planned } = api.snapshot();
    const { memorials, profile } = buildImperialMemorials(world, state, planned);
    const lex = profile.lexicon;
    const memBtn = $("sov-open-memorials");
    if (memBtn?.firstChild) memBtn.firstChild.textContent = lex.memorialsTitle + " ";
    const docBtn = $("sov-open-doctrine");
    if (docBtn?.firstChild) docBtn.firstChild.textContent = "方略州牧 ";
    const badge = $("sov-memorial-badge");
    if (badge) {
      badge.textContent = String(memorials.length);
      badge.hidden = memorials.length === 0;
    }
    memBtn?.setAttribute("aria-pressed", String(Boolean(memorialsSheet && !memorialsSheet.hidden)));
    docBtn?.setAttribute("aria-pressed", String(Boolean(doctrinePopover && !doctrinePopover.hidden)));
    $("sov-toggle-forces")?.setAttribute("aria-pressed", String(workspace.dataset.leftRail === "open"));

    const docTag = $("sov-doctrine-tag");
    if (docTag) {
      const docId = detectSovereignDoctrine(state);
      const found = SOVEREIGN_DOCTRINES.find((d) => d.id === docId);
      docTag.textContent = found ? found.short : (state.nationalPolicy ? "自定义" : "未托");
      docTag.dataset.active = String(Boolean(found || state.nationalPolicy));
    }
    const diploDot = $("sov-diplo-dot");
    if (diploDot) diploDot.hidden = !(state.incomingTreaty?.answer === null);
  }

  function renderSovereignMemorials() {
    if (!memorialsSheet || !isSovereignMode()) return;
    const { state, planned } = api.snapshot();
    const { advisor, recap, strategicBrief, memorials, profile } = buildImperialMemorials(world, state, planned);
    const lex = profile.lexicon;

    const seal = $("sov-advisor-seal");
    if (seal) {
      if (advisor) {
        seal.textContent = advisor.meta.seal;
        seal.style.setProperty("--force", forceColor(advisor.officer.faction));
      } else {
        seal.textContent = "谋";
      }
    }
    if ($("sov-advisor-name")) {
      $("sov-advisor-name").textContent = advisor ? `${advisor.officer.name} · ${lex.advisorAction}` : `${lex.org} · ${lex.advisorAction}`;
    }
    if ($("sov-advisor-sub")) {
      $("sov-advisor-sub").textContent = `第 ${state.year} 年${seasons[state.turn % 4]} · ${profile.badge}（至多 4 件要事）`;
    }
    const briefEl = $("sov-advisor-brief");
    if (briefEl) {
      briefEl.textContent = strategicBrief || "";
      briefEl.hidden = !strategicBrief;
    }

    const deltasBox = $("sov-recap-deltas");
    if (deltasBox) {
      const pills = [];
      if (recap && recap.turn === state.turn && state.turn > 0) {
        if (recap.balance) {
          const m = el("span", `国库 ${signed(recap.balance.treasury)}`, "recap-pill");
          m.dataset.tone = recap.balance.treasury >= 0 ? "good" : "warn";
          const g = el("span", `储粮 ${signed(recap.balance.grain)}`, "recap-pill");
          g.dataset.tone = recap.balance.grain >= 0 ? "good" : "warn";
          pills.push(m, g);
        }
        if (recap.gains) {
          const p = el("span", `攻占 ${recap.gains} 城`, "recap-pill");
          p.dataset.tone = "good";
          pills.push(p);
        }
        if (recap.losses) {
          const p = el("span", `失守 ${recap.losses} 城`, "recap-pill");
          p.dataset.tone = "warn";
          pills.push(p);
        }
      }
      deltasBox.replaceChildren(...pills);
      deltasBox.hidden = pills.length === 0;
    }

    const list = $("sov-memorial-list");
    if (list) {
      if (!memorials.length) {
        const calm = el("div", undefined, "memorial-item");
        calm.dataset.tone = "good";
        const top = el("div", undefined, "memorial-top");
        top.append(el("span", "四境晏然", "memorial-tag"), el("strong", "眼下暂无急递与待办要务"));
        calm.append(top, el("p", `各郡按方略稳步运转，${lex.ruler}可直接指图用兵，或点击右下「推进一季」。`, "memorial-detail"));
        list.replaceChildren(calm);
      } else {
        list.replaceChildren(...memorials.map((item) => {
          const card = el("div", undefined, "memorial-item");
          card.dataset.tone = item.tone || "info";
          const top = el("div", undefined, "memorial-top");
          top.append(el("span", item.tag, "memorial-tag"), el("strong", item.title));
          const detail = el("p", item.detail, "memorial-detail");
          const actions = el("div", undefined, "memorial-actions");
          for (const act of item.actions || []) {
            const btn = el("button", act.label, act.kind === "primary" ? "primary" : "quiet");
            btn.type = "button";
            if (act.disabled) btn.disabled = true;
            btn.addEventListener("click", () => {
              if (act.op === "open-historical-event") {
                api.openHistoricalEvent?.();
              } else if (act.op === "climate-relief" || act.op === "climate-hold") {
                api.sound?.play("event");
                const action = act.op === "climate-relief" ? "relief" : "tax";
                const res = resolveClimateChoice(world, api.snapshot().state, action);
                api.commitState(() => res.state, res.message);
              } else if (act.op === "open-stratagem") {
                toggleSovereignMemorials(false);
                api.openStratagemTab?.();
              } else if (act.op === "promote-officer") {
                api.sound?.play("victory");
                api.commitState(() => promoteOfficer(world, api.snapshot().state, act.target, act.skill), "战功卓著，已晋爵提拔 +5 能力！");
              } else if (act.op === "research-tech") {
                api.sound?.play("tech");
                const res = researchTech(world, api.snapshot().state, act.target);
                api.commitState(() => res.state, res.message);
              } else if (act.op === "open-tech") {
                toggleSovereignMemorials(false);
                api.openTechDialog?.();
              } else if (act.op === "open-captive") {
                api.openCaptiveDialog?.(act.target);
              } else if (act.op === "recruit-wild") {
                api.sound?.play("event");
                api.commitState(() => recruitWildTalent(world, api.snapshot().state, act.target), "礼贤下士，名士已登坛受印入仕！");
              } else if (act.op === "execute-maneuver") {
                api.sound?.play("march");
                const { state: cur } = api.snapshot();
                api.commitState(() => executeGrandManeuver(world, cur, act.plan), `奇谋既定：${act.plan.title}`);
              } else if (act.op === "claim-emperor") {
                api.sound?.play("turn");
                api.commitState(() => proclaimImperialChoice(world, api.snapshot().state, "emperor"), "受禅登基，建朝称帝！礼制已升为正统朝廷。");
              } else if (act.op === "stay-loyalist") {
                api.sound?.play("order");
                api.commitState(() => proclaimImperialChoice(world, api.snapshot().state, "loyalist"), "恪守臣节，誓以「" + lex.org + "」之名兴复天下。");
              } else if (act.op === "accept-treaty") {
                api.commitState(() => respondToTreaty(world, api.snapshot().state, true), "已准来使所请，缔结盟约。");
              } else if (act.op === "reject-treaty") {
                api.commitState(() => respondToTreaty(world, api.snapshot().state, false), "已严词拒却来使。");
              } else if (act.op === "open-century") {
                api.openCenturyPending(act.item);
              } else if (act.op === "execute-attack") {
                const { state: cur } = api.snapshot();
                api.commitState(
                  () => executeSovereignAttack(world, cur, act.plan),
                  `${lex.attackOrder}：由${cityName(world, act.plan.from)}出兵攻${cityName(world, act.plan.to)}。`,
                );
              } else if (act.op === "locate") {
                api.locateAndSelect(act.target);
                openSovereignCityCard(act.target);
              } else if (act.op === "apply-doctrine") {
                const { state: cur } = api.snapshot();
                const res = applySovereignDoctrine(world, cur, act.target);
                const provSuffix = res.provincesAppointed ? `，并委任 ${res.provincesAppointed} 州州牧` : "";
                api.commitState(() => res.state, `已施行「整军备战」总纲${provSuffix}。`);
              } else if (act.op === "appoint-all-provinces") {
                const { state: cur } = api.snapshot();
                const res = appointAllProvinceGovernors(world, cur);
                api.commitState(() => res.state, res.count ? `已新任 ${res.count} 位州牧统筹各州。` : "各州州牧均已在任。");
              } else if (act.op === "open-diplomacy") {
                toggleSovereignMemorials(false);
                api.performAction("diplomacy");
              } else if (act.op === "open-doctrine") {
                toggleSovereignDoctrine(true);
              } else if (act.op === "auto-staff") {
                const { state: cur } = api.snapshot();
                const res = autoStaffRealm(world, cur);
                api.commitState(() => res.state, res.appointed ? `${lex.autoStaffMsg} ${res.appointed} 名官员。` : "暂无可补任官缺。");
              } else if (act.op === "city-front") {
                const { state: cur } = api.snapshot();
                api.commitState(() => applyCityDirective(world, cur, act.target, "front").state, `${cityName(world, act.target)}已转入前线战备。`);
              }
            });
            actions.append(btn);
          }
          card.append(top, detail, actions);
          return card;
        }));
      }
    }
    if ($("sov-memorial-advance")) {
      $("sov-memorial-advance").disabled = Boolean($("advance")?.disabled);
    }
    renderSovereignDock();
  }

  function toggleSovereignMemorials(force) {
    if (!memorialsSheet || !isSovereignMode()) return;
    const open = force !== undefined ? force : memorialsSheet.hidden;
    memorialsSheet.hidden = !open;
    if (open) {
      if (doctrinePopover) doctrinePopover.hidden = true;
      if (matchMedia("(max-width: 960px)").matches) closeSovereignCityCard();
      renderSovereignMemorials();
    } else {
      renderSovereignDock();
    }
  }

  function renderSovereignDoctrine() {
    if (!doctrinePopover) return;
    const { state } = api.snapshot();
    const lex = factionCourtProfile(world, state).lexicon;
    const { front, rear } = delegationZones(world, state);
    const vacant = [...front, ...rear].filter((key) => !state.cities[key].governor).length;
    if ($("sov-doctrine-title")) $("sov-doctrine-title").textContent = "方略与州牧 · 统一经略";
    if ($("sov-autostaff-btn")) $("sov-autostaff-btn").textContent = lex.autoStaffBtn;
    if ($("sov-doctrine-zones")) {
      $("sov-doctrine-zones").textContent = `前线 ${front.length} 城 · 后方 ${rear.length} 城 · 缺太守 ${vacant} 城（定纲即同步年策与州牧）`;
    }
    const activeId = detectSovereignDoctrine(state);
    const wrap = $("sov-doctrine-cards");
    if (wrap) {
      wrap.replaceChildren(...SOVEREIGN_DOCTRINES.map((doc) => {
        const btn = el("button", undefined, "doctrine-card");
        btn.type = "button";
        btn.setAttribute("aria-pressed", String(doc.id === activeId));
        const head = el("div", undefined, "doctrine-card-head");
        head.append(el("strong", doc.name), el("span", doc.tag, "doctrine-card-tag"));
        btn.append(head, el("span", doc.desc, "doctrine-card-desc"));
        btn.addEventListener("click", () => {
          api.sound?.play("order");
          const cur = api.snapshot().state;
          const res = applySovereignDoctrine(world, cur, doc.id, { autoStaff: true });
          const notes = [];
          if (res.provincesAppointed) notes.push(`新任 ${res.provincesAppointed} 州州牧`);
          if (res.appointed) notes.push(`补官 ${res.appointed} 名`);
          const suffix = notes.length ? `（${notes.join(" · ")}）` : "";
          api.commitState(() => res.state, `已统颁「${doc.name}」国策并委任 ${res.delegatedCount} 城${suffix}。`);
          renderSovereignDoctrine();
        });
        return btn;
      }));
    }

    const provSection = $("sov-province-section");
    const provList = $("sov-province-list");
    const appointAllBtn = $("sov-appoint-all-provs");
    if (provSection && provList) {
      const provs = state.century ? listSovereignProvinces(world, state) : [];
      provSection.hidden = !provs.length;
      if (provs.length) {
        const anyVacant = provs.some((p) => !p.leadOfficer && p.candidates.length);
        if (appointAllBtn) {
          appointAllBtn.disabled = !anyVacant || gameOutcome(state) !== "ongoing";
          appointAllBtn.textContent = anyVacant ? "一键遍任州牧" : "各州皆已置牧";
        }
        provList.replaceChildren(...provs.map((prov) => {
          const row = el("div", undefined, "sov-prov-row");
          const meta = el("div", undefined, "sov-prov-meta");
          const title = el("strong", prov.region);
          const stat = el("span", `${prov.cities.length}城 · ${fmt.format(prov.troops)}兵 · 民心${prov.welfare}`, "muted");
          meta.append(title, stat);

          const controls = el("div", undefined, "sov-prov-controls");
          const sel = el("select");
          sel.setAttribute("aria-label", prov.region + "州牧人选");
          if (prov.candidates.length) {
            for (const o of prov.candidates) {
              sel.append(new Option(`${o.name} (政${o.governance})`, o.key));
            }
            sel.value = prov.leadOfficer?.key ?? prov.candidates[0].key;
          } else {
            sel.append(new Option("暂无可用人选", ""));
            sel.disabled = true;
          }
          sel.addEventListener("change", () => {
            if (!sel.value) return;
            api.sound?.play("order");
            const res = assignProvinceGovernor(world, api.snapshot().state, prov.region, {
              officerKey: sel.value,
              directive: prov.directive,
            });
            api.commitState(() => res.state, `已拜 ${res.officer?.name || "能吏"} 为${prov.region}州牧。`);
            renderSovereignDoctrine();
          });

          const dirWrap = el("div", undefined, "sov-prov-dirs");
          for (const dir of Object.values(PROVINCE_DIRECTIVES)) {
            const btn = el("button", dir.label, "pill-btn");
            btn.type = "button";
            const isSet = Boolean(prov.leadOfficer) && prov.directive === dir.id;
            btn.setAttribute("aria-pressed", String(isSet));
            btn.disabled = !prov.candidates.length || gameOutcome(state) !== "ongoing";
            btn.addEventListener("click", () => {
              api.sound?.play("order");
              const res = assignProvinceGovernor(world, api.snapshot().state, prov.region, {
                officerKey: sel.value || prov.leadOfficer?.key,
                directive: dir.id,
              });
              api.commitState(() => res.state, `${prov.region}州牧（${res.officer?.name || "在任"}）已转入「${dir.label}」经略。`);
              renderSovereignDoctrine();
            });
            dirWrap.append(btn);
          }

          controls.append(sel, dirWrap);
          row.append(meta, controls);
          return row;
        }));
      }
    }

    const clearBtn = $("sov-clear-doctrine");
    if (clearBtn) clearBtn.hidden = !state.nationalPolicy;
    renderSovereignDock();
  }

  function toggleSovereignDoctrine(force) {
    if (!doctrinePopover || !isSovereignMode()) return;
    const open = force !== undefined ? force : doctrinePopover.hidden;
    doctrinePopover.hidden = !open;
    if (open) {
      if (memorialsSheet) memorialsSheet.hidden = true;
      if (matchMedia("(max-width: 960px)").matches) closeSovereignCityCard();
      renderSovereignDoctrine();
    } else {
      renderSovereignDock();
    }
  }

  function renderSovereignCityCard() {
    if (!sovCityCard || !isSovereignMode() || !activeSovCity) return;
    const key = activeSovCity;
    const { state, planned, era } = api.snapshot();
    const city = world.cities.find((c) => c.key === key);
    const holding = state.cities[key];
    if (!city || !holding) { closeSovereignCityCard(); return; }

    const mine = holding.owner === state.player;
    const known = !state.war || mine;
    const lex = factionCourtProfile(world, state).lexicon;
    const han = hanEmperorStatus(state);
    const prov = historicalProvince(city.key, city.region);
    $("sov-city-head")?.style.setProperty("--city-accent", forceColor(holding.owner));
    if ($("sov-city-region")) {
      $("sov-city-region").textContent = han.active && han.cityKey === key ? `${prov} · ${han.name}驻跸` : prov;
    }
    if ($("sov-city-owner")) {
      const ownerName = factionName(era, holding.owner);
      const persona = !mine && state.century ? personaForFaction(holding.owner) : null;
      $("sov-city-owner").textContent = persona ? `${ownerName} · ${persona.badge}` : ownerName;
    }
    if ($("sov-city-name")) $("sov-city-name").textContent = city.name;

    const vis = !mine && isFogOfWarEnabled(state) ? cityVisibility(world, state, key) : "visible";
    const statsBox = $("sov-city-stats");
    if (statsBox) {
      const pop = state.realm?.cities[key];
      const inc = cityIncome(holding, pop);
      const statPairs = known
        ? [
          ["驻军", fmt.format(holding.troops)],
          ["城防", `${holding.defense} 级`],
          ["税收", `+${inc.treasury}`],
          ["粮食", `+${inc.grain}`],
        ]
        : vis === "fogged"
          ? [
            ["烽火迷雾", maskedTroopRange(key, holding.troops)],
            ["城防情资", "未明（需斥候）"],
            ["外交关系", treatyWith(state, state.player, holding.owner) ? treatyTerms[treatyWith(state, state.player, holding.owner).kind].name : "敌对"],
            ["所属州郡", prov],
          ]
          : [
            ["兵力情资", intelSummary(state, state.player, key)],
            ["城防情资", intelSummary(state, state.player, key, "defense")],
            ["外交关系", treatyWith(state, state.player, holding.owner) ? treatyTerms[treatyWith(state, state.player, holding.owner).kind].name : "敌对"],
            ["所属州郡", prov],
          ];
      statsBox.replaceChildren(...statPairs.map(([label, val]) => {
        const wrap = el("div");
        wrap.append(el("dt", label), el("dd", val));
        return wrap;
      }));
    }

    const body = $("sov-city-body");
    const foot = $("sov-city-actions");
    if (!body || !foot) return;

    if (!mine) {
      const defOfficer = holding.commander ? era.officers.find((o) => o.key === holding.commander) : null;
      const defLine = defOfficer
        ? `守将：${defOfficer.name}（统${defOfficer.command}·智${officerMeta(defOfficer).intellect}）`
        : "守将：无名将统御";
      const prepTurn = isOpeningPrepTurn(state);
      const isAdjacentHostile = !prepTurn
        && gameOutcome(state) === "ongoing"
        && isHostile(state, state.player, holding.owner)
        && (city.links || []).some((n) => planned.cities[n]?.owner === state.player);

      if (prepTurn && isHostile(state, state.player, holding.owner)) {
        const box = el("div", undefined, "sov-expedition-box sov-prep-banner");
        box.append(
          el("div", defLine, "muted"),
          el("p", "开局首季为「整军备战期」，各军尚待整训且诸侯备边，不可贸然强攻。请先颁定方略、拜授州牧，次季（夏）即可布策伐之。", "memorial-detail"),
        );
        const goPrep = el("button", "定方略与拜州牧", "primary");
        goPrep.type = "button";
        goPrep.addEventListener("click", () => toggleSovereignDoctrine(true));
        box.append(goPrep);
        body.replaceChildren(box);
      } else {
        const plan = bestAttackPlan(world, state, planned, key, sovSelectedTactic ? { tactic: sovSelectedTactic } : {});
        const box = el("div", undefined, "sov-expedition-box");
        box.append(el("div", defLine, "muted"));

        if (state.century && isAdjacentHostile) {
          const activeTac = sovSelectedTactic || (plan.ok ? plan.tactic : "assault");
          const tacRow = el("div", undefined, "sov-tactic-pills");
          for (const tac of Object.values(BATTLE_TACTICS)) {
            const btn = el("button", undefined, "sov-tactic-pill");
            btn.type = "button";
            btn.title = tac.desc;
            btn.setAttribute("aria-pressed", String(tac.id === activeTac));
            const costStr = tac.treasury || tac.grain ? `${tac.treasury}钱${tac.grain ? tac.grain + "粮" : ""}` : "常势";
            btn.append(el("strong", tac.short), el("span", costStr));
            btn.addEventListener("click", () => {
              api.sound?.play("click");
              sovSelectedTactic = tac.id;
              renderSovereignCityCard();
            });
            tacRow.append(btn);
          }
          box.append(tacRow);
        }

        if (plan.ok) {
          const transferNote = plan.needsTransfer ? "（急调待命将领）" : "";
          box.append(el("div", `出兵方案：${cityName(world, plan.from)} → ${city.name} · ${fmt.format(plan.troops)} 人 ${transferNote}`, "sov-plan-route"));

          const offRow = el("div", undefined, "sov-plan-officer");
          const meta = officerMeta(plan.officer);
          offRow.append(makeSeal(plan.officer, forceColor(plan.officer.faction), true));
          const offMeta = el("div", undefined, "officer-trait-meta");
          offMeta.append(el("span", `${plan.officer.name} · 统${plan.officer.command} 武${meta.might} 智${meta.intellect}`, "officer-stat-line"));
          const pillWrap = makeTraitPills(plan.officer, 2);
          for (const bName of plan.outcome.bonds?.attacker ?? []) {
            pillWrap.append(el("span", bName, "bond-badge"));
          }
          if (meta.traits.length || plan.outcome.bonds?.attacker?.length) offMeta.append(pillWrap);
          offRow.append(offMeta);
          box.append(offRow);

          const fc = el("p", undefined, "forecast sov-plan-forecast");
          fc.dataset.state = plan.outcome.wins ? "advantage" : "disadvantage";
          const traitNotes = [...(plan.outcome.traitNotes?.attacker || []), ...(plan.outcome.traitNotes?.defender || [])];
          const bondNotes = [
            ...(plan.outcome.bonds?.attacker || []).map((n) => `羁绊:${n}`),
            ...(plan.outcome.bonds?.defender || []).map((n) => `敌羁绊:${n}`),
          ];
          const rumorTag = plan.outcome.rumorActive ? " · 敌城流言动摇" : "";
          const extraNotes = [...traitNotes, ...bondNotes];
          const tSuffix = extraNotes.length ? ` · ✦ ${extraNotes.join("·")}` : "";
          const tacticInfo = plan.outcome.tacticTag ? `【${plan.outcome.tacticTag}】${plan.outcome.tacticSummary ? plan.outcome.tacticSummary + " · " : ""}` : "";
          const terrainTag = plan.outcome.terrainLabel ? ` · ${plan.outcome.terrainLabel}` : "";
          const lossEst = `预计战损 我 ${fmt.format(plan.outcome.estimatedAttackerLoss)} / 敌 ${fmt.format(plan.outcome.estimatedDefenderLoss)}`;
          const costLine = `耗粮 ${plan.grain}${plan.treasury ? ` · 耗钱 ${plan.treasury}` : ""}`;
          fc.textContent = `${tacticInfo}${plan.outcome.wins ? "预计克敌" : "预计失利"} · 战力 ${fmt.format(plan.outcome.offense)} 对 ${fmt.format(plan.outcome.defense)} · ${lossEst} · ${costLine}${plan.affordable ? "" : "（钱粮不足）"}${terrainTag}${rumorTag}${tSuffix}`;
          box.append(fc);

          const goBtn = el("button", plan.affordable ? `${lex.attackVerb}（${plan.outcome.tacticName || "强攻"}）` : "钱粮不足，暂难发兵", "primary");
          goBtn.type = "button";
          goBtn.disabled = !plan.affordable;
          goBtn.addEventListener("click", () => {
            const cur = api.snapshot().state;
            const useManual = Boolean(cur.century && cur.saga?.options?.manualBattle !== false && api.openTacticalBattle);
            if (useManual) {
              api.openTacticalBattle(plan, () => renderSovereignCityCard());
              return;
            }
            api.commitState(
              () => executeSovereignAttack(world, cur, plan),
              `${lex.attackOrder}：命${plan.officer.name}施「${plan.outcome.tacticName || "正面强攻"}」自${cityName(world, plan.from)}攻打${city.name}。`,
            );
            renderSovereignCityCard();
          });
          box.append(goBtn);
        } else {
          box.append(el("p", plan.message, "memorial-detail"));
        }

        if (state.century && gameOutcome(state) === "ongoing") {
          // v18.0 粮道奇袭、围城断水 & 细作暗战快捷栏
          const opsBar = el("div", undefined, "sov-stratagem-bar v18-ops-bar");
          const cutNow = isSupplyCut(state, key);
          const cutBtn = el("button", cutNow ? "粮道已断" : "断其粮道（35金30粮）", "quiet");
          cutBtn.type = "button";
          cutBtn.disabled = cutNow;
          cutBtn.title = "奇兵夜袭敌城粮道：敌防 -22%、每季溃散，持续 2 季";
          cutBtn.addEventListener("click", () => {
            const cur = api.snapshot().state;
            const res = raidSupplyLine(world, cur, key);
            if (!res.ok) { api.notify?.(res.reason, true); return; }
            api.sound?.play("alert");
            api.commitState(() => res.state, res.summary);
            renderSovereignCityCard();
          });
          opsBar.append(cutBtn);

          const adjFrom = (city.links || []).find((n) => state.cities[n]?.owner === state.player && state.cities[n].troops >= 3500);
          const siegeNow = activeSiegeOn(state, key);
          if (adjFrom || siegeNow) {
            const siegeBtn = el("button", siegeNow ? "解除围城" : "围城断水（40粮）", "quiet");
            siegeBtn.type = "button";
            siegeBtn.title = siegeNow ? "撤回围城偏师" : "不硬拼城防，每季削弱敌军与城墙";
            siegeBtn.addEventListener("click", () => {
              const cur = api.snapshot().state;
              if (activeSiegeOn(cur, key)) {
                api.commitState(() => liftSiegeBlockade(cur, key), `已解除对${city.name}的围城。`);
              } else {
                const res = establishSiegeBlockade(world, cur, adjFrom, key);
                if (!res.ok) { api.notify?.(res.reason, true); return; }
                api.sound?.play("march");
                api.commitState(() => res.state, res.summary);
              }
              renderSovereignCityCard();
            });
            opsBar.append(siegeBtn);
          }

          for (const act of ESPIONAGE_ACTIONS) {
            if (act.id === "spread_rumor") continue; // 已有反间流言按钮
            const done = (act.id === "plant_insider" && hasInsider(state, key))
              || (act.id === "forge_letter" && isConfusedByEspionage(state, key));
            const eBtn = el("button", done ? `${act.name}·生效` : `${act.name}（${act.costTreasury}金）`, "quiet");
            eBtn.type = "button";
            eBtn.disabled = done;
            eBtn.title = act.summary;
            eBtn.addEventListener("click", () => {
              const cur = api.snapshot().state;
              const res = executeEspionageAction(world, cur, act.id, key);
              if (!res.ok) { api.notify?.(res.reason, true); return; }
              api.sound?.play("event");
              api.commitState(() => res.state, res.summary);
              renderSovereignCityCard();
            });
            opsBar.append(eBtn);
          }
          box.append(opsBar);

          const stratBar = el("div", undefined, "sov-stratagem-bar");
          const rumorCheck = evaluateSpreadRumor(world, state, key);
          const rumorActive = (state.saga?.rumors?.[key] ?? 0) > state.turn;
          const rumorBtn = el("button", rumorActive ? "已陷流言动摇" : `反间流言（${STRATAGEMS.spread_rumor.cost}钱）`, "quiet");
          rumorBtn.type = "button";
          rumorBtn.title = rumorCheck.ok ? STRATAGEMS.spread_rumor.desc : rumorCheck.reason;
          rumorBtn.disabled = !rumorCheck.ok;
          rumorBtn.addEventListener("click", () => {
            api.sound?.play("alert");
            const cur = api.snapshot().state;
            const res = executeSpreadRumor(world, cur, key);
            api.commitState(() => res.state, res.message);
            renderSovereignCityCard();
          });
          stratBar.append(rumorBtn);

          const surrCheck = evaluateDemandSurrender(world, state, holding.owner);
          if (surrCheck.ok || forceTotals(state, holding.owner).cities <= 3) {
            const surrBtn = el("button", surrCheck.ok ? `传檄劝降（${surrCheck.chance}%）` : "传檄劝降", "quiet");
            surrBtn.type = "button";
            surrBtn.title = surrCheck.ok ? STRATAGEMS.demand_surrender.desc : surrCheck.reason;
            surrBtn.disabled = !surrCheck.ok;
            surrBtn.addEventListener("click", () => {
              api.sound?.play("event");
              const cur = api.snapshot().state;
              const res = executeDemandSurrender(world, cur, holding.owner);
              api.commitState(() => res.state, res.message);
              if (res.succeeded) activeSovCity = null;
              renderSovereignCityCard();
            });
            stratBar.append(surrBtn);
          }
          box.append(stratBar);
        }

        body.replaceChildren(box);
      }

      const diploBtn = el("button", "外交交涉", "quiet");
      diploBtn.type = "button";
      diploBtn.addEventListener("click", () => api.openDiplomacyFor?.(holding.owner));
      const detailBtn = el("button", "细调攻防 ›", "quiet");
      detailBtn.type = "button";
      detailBtn.addEventListener("click", () => api.openCityDetail?.(key, "expedition"));
      foot.replaceChildren(diploBtn, detailBtn);
    } else {
      const govName = era.officers.find((o) => o.key === holding.governor)?.name;
      const cmdName = era.officers.find((o) => o.key === holding.commander)?.name;
      const seat = state.reign?.seats?.[city.region];
      const provGov = seat?.end > state.turn ? era.officers.find((o) => o.key === seat.lead)?.name : null;
      const modeText = holding.mode === "delegated" ? `${lex.delegateVerb} · ${focusZh[holding.focus] || holding.focus}` : lex.directLabel;
      const info = el("p", `治理：${modeText} · 太守 ${govName || "缺"} · 守将 ${cmdName || "缺"} · ${city.region}州牧 ${provGov || "未任"}`, "memorial-detail");

      const currentDir = holding.mode === "direct"
        ? "direct"
        : (holding.focus === "recruit" || holding.focus === "defense" ? "front" : "rear");
      const group = el("div", undefined, "sov-directive-group");
      const options = [
        ["front", "前线战备", "自动征兵增防"],
        ["rear", "后方屯田", "稳步屯田开源"],
        ["direct", lex.directLabel, "暂停自动委任"],
      ];
      for (const [dir, label, sub] of options) {
        const btn = el("button", undefined, "sov-directive-btn");
        btn.type = "button";
        btn.setAttribute("aria-pressed", String(dir === currentDir));
        btn.append(el("strong", label), el("span", sub));
        btn.addEventListener("click", () => {
          api.sound?.play("order");
          const cur = api.snapshot().state;
          const res = applyCityDirective(world, cur, key, dir);
          const extra = res.autoAppointed ? `（已授命 ${res.autoAppointed.name} 为太守）` : "";
          api.commitState(() => res.state, `${city.name}已设为「${label}」${extra}。`);
          renderSovereignCityCard();
        });
        group.append(btn);
      }

      const bodyItems = [info, group];
      // v18.0 一城一貌：城池设施与地域奇观
      if (state.century && gameOutcome(state) === "ongoing") {
        const bWrap = el("div", undefined, "v18-city-buildings");
        const built = cityBuildings(state, key);
        const limit = citySlotLimit(key);
        const builtNames = built.map((id) => {
          const d = BUILDING_CATALOG.find((x) => x.id === id);
          return d ? `${d.icon}${d.name}` : id;
        });
        bWrap.append(el("div", `城池设施（${built.length}/${limit}）：${builtNames.length ? builtNames.join(" · ") : "尚无专项设施"}`, "v18-b-head"));
        if (built.length < limit) {
          const chips = el("div", undefined, "v18-b-chips");
          for (const def of BUILDING_CATALOG) {
            if (built.includes(def.id)) continue;
            const cBtn = el("button", `${def.icon}${def.name} ${def.costTreasury}金`, "quiet v18-b-chip");
            cBtn.type = "button";
            cBtn.title = `${def.summary}（需金${def.costTreasury}/粮${def.costGrain}）`;
            cBtn.addEventListener("click", () => {
              const cur = api.snapshot().state;
              const res = constructBuilding(world, cur, key, def.id);
              if (!res.ok) { api.notify?.(res.reason, true); return; }
              api.sound?.play("order");
              api.commitState(() => res.state, res.summary);
              renderSovereignCityCard();
            });
            chips.append(cBtn);
          }
          bWrap.append(chips);
        }
        const wonder = wonderForCity(key);
        if (wonder) {
          const already = builtWonderInCity(state, key);
          const wBtn = el("button", already ? `✦ 奇观已落成：${wonder.name}` : `✦ 兴建奇观「${wonder.name}」（${wonder.costTreasury}金${wonder.costGrain}粮）`, already ? "quiet v18-wonder-btn" : "primary v18-wonder-btn");
          wBtn.type = "button";
          wBtn.disabled = Boolean(already);
          wBtn.title = wonder.summary;
          wBtn.addEventListener("click", () => {
            const cur = api.snapshot().state;
            const res = constructWonder(world, cur, key);
            if (!res.ok) { api.notify?.(res.reason, true); return; }
            api.sound?.play("victory");
            api.commitState(() => res.state, res.summary);
            renderSovereignCityCard();
          });
          bWrap.append(wBtn);
        }
        bodyItems.push(bWrap);
      }

      const reinforce = quickReinforcePlan(world, state, planned, key);
      if (reinforce.ok) {
        const rBtn = el("button", `紧急调援：自${cityName(world, reinforce.from)}调 ${fmt.format(reinforce.troops)} 兵来援（耗${reinforce.grain}粮）`, "quiet sov-reinforce-btn");
        rBtn.type = "button";
        rBtn.addEventListener("click", () => {
          api.sound?.play("march");
          api.commitState(
            () => executeSovereignReinforce(world, api.snapshot().state, reinforce),
            `紧急增援：自${cityName(world, reinforce.from)}调兵 ${fmt.format(reinforce.troops)} 增援${city.name}。`,
          );
          renderSovereignCityCard();
        });
        bodyItems.push(rBtn);
      }
      body.replaceChildren(...bodyItems);

      const govBtn = el("button", "详理城务 ›", "quiet");
      govBtn.type = "button";
      govBtn.addEventListener("click", () => api.openCityDetail?.(key, "governance"));
      const milBtn = el("button", "调兵/出征 ›", "quiet");
      milBtn.type = "button";
      milBtn.addEventListener("click", () => api.openCityDetail?.(key, "expedition"));
      foot.replaceChildren(govBtn, milBtn);
    }
    sovCityCard.hidden = false;
  }

  function openSovereignCityCard(cityKey) {
    if (sovAttackCity !== cityKey) {
      sovAttackCity = cityKey;
      sovSelectedTactic = null;
    }
    activeSovCity = cityKey;
    if (doctrinePopover) doctrinePopover.hidden = true;
    if (matchMedia("(max-width: 960px)").matches && memorialsSheet) memorialsSheet.hidden = true;
    renderSovereignCityCard();
    renderSovereignDock();
  }

  /* ---------- Season Recap Floating Card ---------- */
  function showSeasonRecap(state) {
    if (isSovereignMode()) {
      if (recapBox) recapBox.hidden = true;
      if (state.turn && state.turn !== lastRecapTurn && gameOutcome(state) === "ongoing") {
        lastRecapTurn = state.turn;
        toggleSovereignMemorials(true);
      }
      return;
    }
    if (!recapBox || !state.turn || state.turn === lastRecapTurn || gameOutcome(state) !== "ongoing") return;
    const report = latestSeasonSummary(state);
    if (!report) return;
    lastRecapTurn = state.turn;
    const prevTurn = report.turn - 1;
    $("recap-title").textContent = `第 ${Math.floor(prevTurn / 4) + 1} 年 · ${seasons[prevTurn % 4]}季结算`;

    const deltas = $("recap-deltas");
    const pills = [];
    if (report.balance) {
      const m = el("span", `国库 ${signed(report.balance.treasury)}`, "recap-pill");
      m.dataset.tone = report.balance.treasury >= 0 ? "good" : "warn";
      const g = el("span", `储粮 ${signed(report.balance.grain)}`, "recap-pill");
      g.dataset.tone = report.balance.grain >= 0 ? "good" : "warn";
      pills.push(m, g);
    }
    if (report.gains) {
      const p = el("span", `攻占 ${report.gains} 城`, "recap-pill");
      p.dataset.tone = "good";
      pills.push(p);
    }
    if (report.losses) {
      const p = el("span", `失守 ${report.losses} 城`, "recap-pill");
      p.dataset.tone = "warn";
      pills.push(p);
    }
    if (report.envoy) {
      const p = el("span", "有来使待答复", "recap-pill");
      p.dataset.tone = "warn";
      pills.push(p);
    }
    deltas.replaceChildren(...pills);

    const eventsBox = $("recap-events");
    const rows = [];
    for (const item of report.events.slice(0, 3)) {
      const row = el("div", undefined, "recap-event");
      row.append(el("span", item.entry.text));
      if (item.entry.battle) {
        const b = el("button", "战报");
        b.type = "button";
        b.addEventListener("click", () => { recapBox.hidden = true; api.openBattleEntry(item.entry, report.turn); });
        row.append(b);
      } else if (item.entry.city) {
        const b = el("button", "定位");
        b.type = "button";
        b.addEventListener("click", () => { recapBox.hidden = true; api.locateAndSelect(item.entry.city); });
        row.append(b);
      }
      rows.push(row);
    }
    if (report.envoy) {
      const row = el("div", undefined, "recap-event");
      row.append(el("span", `收到外交提议：${treatyTerms[report.envoy.kind].name}`));
      const b = el("button", "答复");
      b.type = "button";
      b.addEventListener("click", () => { recapBox.hidden = true; api.performAction("envoy"); });
      row.append(b);
      rows.push(row);
    }
    const urgentCase = state.century && openCases15(state).find((c) => c.turn === state.turn && c.urgent);
    if (urgentCase) {
      const row = el("div", undefined, "recap-event");
      row.append(el("span", "急报：" + urgentCase.text));
      const b = el("button", "处置");
      b.type = "button";
      b.addEventListener("click", () => { recapBox.hidden = true; api.openCenturyPending(urgentCase); });
      row.append(b);
      rows.push(row);
    }
    eventsBox.replaceChildren(...rows);
    eventsBox.hidden = !rows.length;
    $("recap-note").textContent = rows.length ? `共 ${report.events.length} 条要闻` : "本季风平浪静，各部按令运转。";
    recapBox.hidden = false;
  }

  function hideSeasonRecap() {
    if (recapBox) recapBox.hidden = true;
  }

  /* ---------- Wire Controls & Global Keyboard Shortcuts ---------- */
  function wire() {
    $("collapse-left-rail")?.addEventListener("click", () => setLeftRail(false));
    $("toggle-left-rail")?.addEventListener("click", () => setLeftRail(true));
    $("close-city-drawer")?.addEventListener("click", () => setCityDrawer(false));
    $("prev-own-city")?.addEventListener("click", () => cycleOwnCity(-1));
    $("next-own-city")?.addEventListener("click", () => cycleOwnCity(1));
    $("seal-campaign")?.addEventListener("click", () => $("open-campaign")?.click());
    $("advance-year")?.addEventListener("click", () => api.takeYear());
    $("zoom-reset")?.addEventListener("click", () => api.resetMapSmooth());
    $("open-shortcuts")?.addEventListener("click", () => $("shortcuts-dialog")?.showModal());
    $("toggle-sound")?.addEventListener("click", () => {
      api.sound?.toggle();
      syncSoundButton();
    });
    $("toggle-hud-mode")?.addEventListener("click", () => {
      api.sound?.play("click");
      setHudMode(isSovereignMode() ? "detail" : "sovereign");
    });
    $("sov-open-memorials")?.addEventListener("click", () => toggleSovereignMemorials());
    $("sov-memorials-close")?.addEventListener("click", () => toggleSovereignMemorials(false));
    $("sov-open-chronicle")?.addEventListener("click", () => {
      toggleSovereignMemorials(false);
      $("open-chronicle")?.click();
    });
    $("sov-memorial-advance")?.addEventListener("click", () => $("advance")?.click());

    $("sov-open-doctrine")?.addEventListener("click", () => toggleSovereignDoctrine());
    $("sov-doctrine-close")?.addEventListener("click", () => toggleSovereignDoctrine(false));
    $("sov-autostaff-btn")?.addEventListener("click", () => {
      const cur = api.snapshot().state;
      const lex = factionCourtProfile(world, cur).lexicon;
      const res = autoStaffRealm(world, cur);
      api.commitState(() => res.state, res.appointed ? `${lex.autoStaffMsg} ${res.appointed} 名官员（太守 ${res.governors} · 守将 ${res.commanders}）。` : "治下暂无需补任或无可用闲员。");
      renderSovereignDoctrine();
    });
    $("sov-appoint-all-provs")?.addEventListener("click", () => {
      const res = appointAllProvinceGovernors(world, api.snapshot().state);
      api.sound?.play("order");
      api.commitState(() => res.state, res.count ? `已为 ${res.count} 州遍任州牧。` : "各州州牧均已在任。");
      renderSovereignDoctrine();
    });
    $("sov-clear-doctrine")?.addEventListener("click", () => {
      api.commitState(() => setNationalPolicy(api.snapshot().state, null), "已暂撤全国托付总纲。");
      renderSovereignDoctrine();
    });
    $("sov-open-diplomacy")?.addEventListener("click", () => api.performAction("diplomacy"));
    $("sov-toggle-forces")?.addEventListener("click", () => {
      switchRailTab("forces");
      const open = workspace.dataset.leftRail !== "open";
      setLeftRail(open);
      renderSovereignDock();
    });
    $("sov-city-close")?.addEventListener("click", closeSovereignCityCard);
    $("qo-close")?.addEventListener("click", () => toggleOrdersPopover(false));
    $("qo-open-preview")?.addEventListener("click", () => {
      toggleOrdersPopover(false);
      api.openFullOrders(true);
    });
    $("qo-advance")?.addEventListener("click", () => {
      toggleOrdersPopover(false);
      $("advance")?.click();
    });
    $("recap-close")?.addEventListener("click", hideSeasonRecap);
    $("recap-open-chronicle")?.addEventListener("click", () => { hideSeasonRecap(); $("open-chronicle")?.click(); });

    for (const btn of document.querySelectorAll("[data-rail-tab]")) {
      btn.addEventListener("click", () => switchRailTab(btn.dataset.railTab));
    }
    for (const pill of document.querySelectorAll("[data-hud-jump]")) {
      pill.addEventListener("click", () => {
        const target = pill.dataset.hudJump;
        if (target === "finance") $("open-finance")?.click();
        else if (target === "holdings") $("open-holdings")?.click();
        else if (target === "frontier") $("open-frontier")?.click();
      });
    }
    for (const btn of document.querySelectorAll("[data-hud-lens]")) {
      btn.addEventListener("click", () => {
        const lens = btn.dataset.hudLens;
        const active = btn.getAttribute("aria-pressed") === "true";
        api.toggleLens(active ? null : lens);
      });
    }

    $("attack-map-pick")?.addEventListener("click", () => {
      const { selected } = api.snapshot();
      api.startMapAction(selected, "attack");
    });
    $("transfer-map-pick")?.addEventListener("click", () => {
      const { selected } = api.snapshot();
      api.startMapAction(selected, "transfer");
    });

    // Bidirectional troop range sliders
    const bindSlider = (sliderId, inputId) => {
      const slider = $(sliderId);
      const input = $(inputId);
      if (!slider || !input) return;
      slider.addEventListener("input", () => {
        input.value = slider.value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        if (inputId === "troops") syncPowerBar();
      });
      input.addEventListener("input", () => {
        slider.value = input.value;
        if (inputId === "troops") syncPowerBar();
      });
    };
    bindSlider("troops-slider", "troops");
    bindSlider("transfer-troops-slider", "transfer-troops");
    $("officer-picker")?.addEventListener("input", () => {
      syncPowerBar();
      renderSelectedGeneralTraits();
    });
    $("attack-tactic")?.addEventListener("input", () => {
      const { state, planned, era, selected } = api.snapshot();
      syncSlidersAndTargetCards(state, planned, era, selected);
      syncPowerBar();
    });
    $("target-picker")?.addEventListener("input", () => {
      const { state, planned, era, selected } = api.snapshot();
      syncSlidersAndTargetCards(state, planned, era, selected);
    });
    $("diplomacy-kind")?.addEventListener("change", () => renderDiplomacyCards());

    // Dismiss quick orders popover & doctrine popover on outside click
    document.addEventListener("pointerdown", (event) => {
      if (ordersPopover && !ordersPopover.hidden
        && !ordersPopover.contains(event.target) && !$("turn-orders")?.contains(event.target)) {
        toggleOrdersPopover(false);
      }
      if (doctrinePopover && !doctrinePopover.hidden
        && !doctrinePopover.contains(event.target) && !$("sov-open-doctrine")?.contains(event.target)) {
        toggleSovereignDoctrine(false);
      }
    });

    // Quick ratio chips for attack & transfer
    for (const group of document.querySelectorAll("[data-ratio-for]")) {
      const targetId = group.dataset.ratioFor;
      group.addEventListener("click", (event) => {
        const btn = event.target.closest("button[data-ratio]");
        if (!btn) return;
        const input = $(targetId);
        if (!input) return;
        const max = Number(input.max) || minimumMarch;
        const ratio = Number(btn.dataset.ratio);
        const value = ratio >= 1 ? max : Math.max(minimumMarch, Math.min(max, Math.round((max * ratio) / 50) * 50));
        input.value = String(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    // Dismiss recap when clicking empty map canvas
    $("map-stage")?.querySelector("canvas")?.addEventListener("pointerdown", () => {
      if (recapBox && !recapBox.hidden) hideSeasonRecap();
    });

    // Global Keyboard Shortcuts
    document.addEventListener("keydown", (event) => {
      if (event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
      const inField = Boolean(event.target.closest?.("input, select, textarea, [contenteditable]"));
      const openDialog = document.querySelector("dialog[open]");

      if (event.key === "Escape") {
        if (openDialog) return;
        if (ordersPopover && !ordersPopover.hidden) {
          event.preventDefault();
          toggleOrdersPopover(false);
          return;
        }
        if (doctrinePopover && !doctrinePopover.hidden) {
          event.preventDefault();
          toggleSovereignDoctrine(false);
          return;
        }
        if (sovCityCard && !sovCityCard.hidden) {
          event.preventDefault();
          closeSovereignCityCard();
          return;
        }
        if (memorialsSheet && !memorialsSheet.hidden) {
          event.preventDefault();
          toggleSovereignMemorials(false);
          return;
        }
        if (recapBox && !recapBox.hidden) {
          event.preventDefault();
          hideSeasonRecap();
          return;
        }
        if ($("map-city-command") && !$("map-city-command").hidden) return;
        if (workspace.dataset.cityDrawer === "open" && !matchMedia("(max-width: 960px)").matches) {
          event.preventDefault();
          setCityDrawer(false);
        }
        return;
      }

      if (inField || openDialog) return;

      if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault();
        $("shortcuts-dialog")?.showModal();
      } else if (event.key === " " && !event.target.closest?.("button")) {
        event.preventDefault();
        $("advance")?.click();
      } else if (event.key === "[") {
        event.preventDefault();
        cycleOwnCity(-1);
      } else if (event.key === "]") {
        event.preventDefault();
        cycleOwnCity(1);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        $("zoom-in")?.click();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        $("zoom-out")?.click();
      } else if (event.key === "0") {
        event.preventDefault();
        api.resetMapSmooth();
      } else if (["1", "2", "3", "4", "5"].includes(event.key)) {
        event.preventDefault();
        const mapActions = { "1": "policy", "2": "war", "3": "diplomacy", "4": "roster", "5": "polity" };
        api.performAction(mapActions[event.key]);
      } else if (["g", "G", "a", "A", "t", "T", "o", "O", "p", "P"].includes(event.key)) {
        event.preventDefault();
        const tabs = { g: "governance", a: "expedition", t: "reinforcement", o: "officers", p: "appointments" };
        setCityDrawer(true);
        api.selectTab(tabs[event.key.toLowerCase()]);
      }
    });
  }

  syncSoundButton();
  wire();
  setHudMode(hudMode, { persist: false });

  return {
    isSovereignMode,
    setHudMode,
    openSovereignCityCard,
    closeSovereignCityCard,
    toggleSovereignMemorials,
    showHover,
    setCityDrawer,
    setLeftRail,
    showSeasonRecap,
    hideSeasonRecap,
    toggleOrdersPopover,
    renderCampaignCards,
    renderDiplomacyCards,
    syncLensButtons(activeLens) {
      for (const btn of document.querySelectorAll("[data-hud-lens]")) {
        btn.setAttribute("aria-pressed", String(btn.dataset.hudLens === activeLens));
      }
    },
    render() {
      const { state, planned, era, selected } = api.snapshot();
      renderTopbarExtras(state);
      renderPriorityFeed(state);
      renderCityDrawerExtras(state, planned, era, selected);
      renderQuickOrdersPopover();
      if (isSovereignMode()) {
        renderSovereignDock();
        if (memorialsSheet && !memorialsSheet.hidden) renderSovereignMemorials();
        if (doctrinePopover && !doctrinePopover.hidden) renderSovereignDoctrine();
        if (sovCityCard && !sovCityCard.hidden) renderSovereignCityCard();
      }
    },
  };
}
