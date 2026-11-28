// 经略三国 5.0 — 军团都督委任 / 地方州牧施政 / 军机处中枢决断 / 朝堂六卿官职 / 郡国农商基建

import {
  AWAKENED_TITLES, CITY_POLICIES, CITY_SPECIALTIES, DEFENSE_TRAPS, DIFFICULTY_MODES,
  FORMATIONS_V2, FORT_CATALOG, NATIONAL_DECREES_V2, SIEGE_DEFENSE_MODES, SIEGE_STANCES,
  STRATAGEM_CATALOG, TERRAIN_LABELS, TROOP_TYPES, edgeDisplayName, edgeKey, factionColor,
  formatCalendar, roadTerrain,
} from "./constants.js";
import {
  AUTO_PAUSE_MODES, CITY_BUILDINGS_V4, CORPS_MISSIONS, COURT_OFFICES_V4, EMPEROR_EDICTS_V3,
  GOVERNOR_DIRECTIVES, MIN_DISPATCH_TROOPS, MIN_GARRISON_LEAVE, OPENING_DEV_DEKADS,
  PRESTIGE_RANKS_V4, TAX_LEVELS_V4, activeTreaty, appointCourtOffice, appointOfficer,
  appointRegionalGovernor, approveAllCabinet, approveCabinetProposal, armyEtaDekads,
  assignCityToCorps, availableOfficersInCity, batchSetCityPolicy, bribeDefection,
  buildCabinetBriefings, buildFort, buildingBuildDekads, buildingUpgradeCost, canBuildFort,
  castStratagem, checkSupplyLine, cityBonds, cityByKey, cityNameV2, cityTierInfo,
  clearSupplyLink, computeCourtBonuses, computeRegionalGovernorBonus, computeThreats,
  createCorps, createGameV2, demolishFort, deserializeStateV2, disbandCorps,
  dismissCabinetProposal, dispatchArmy, dispatchEmergencyReinforce, enactDecree, eraByYearV2,
  estimateFactionEconomy, evaluateDeal, executeDiplomacy, factionNameV2, factionSummary,
  forecastDispatch, getCorpsForCity, getOfficersInCorps, getPlayerRegions, hasDecree,
  isHostileV2, issueImperialEdict, launchCoordinatedAttack, layCityTrap, officerBattleArt,
  planCoordinatedAttack, prestigeRankForFaction, previewCityRecruit, previewSmartDispatch,
  proposeDeal, rankProgressForFaction, recallOfficerFromCorps, recruitCityTroops,
  recruitWanderingOfficer, redirectArmy, renderDiploMatrixHtml, renderPowerChartSvg,
  renderReplayMapSvg, repairFort, resolveCaptive, resolveEventChoice, rewardOfficer,
  sendOfficerToCorps, serializeStateV2, setAutoGovernance, setAutoPauseMode, setCityPolicy,
  setCitySiegeDefense, setCityTroopType, setSupplyLink, setTaxLevel, smartAutoDispatch,
  sowDiscord, stratagemCooldownLeft, transferOfficer, triggerArmyArt, updateCorps,
  upgradeCityBuilding,
} from "./engine.js";

const $ = (id) => document.getElementById(id);

function openDialogSafe(dialog) {
  if (!dialog || dialog.open) return;
  if (typeof dialog.showModal === "function") {
    try {
      dialog.showModal();
      return;
    } catch {
      // Fallback for restricted mobile WebViews
    }
  }
  dialog.setAttribute("open", "");
}

function closeDialogSafe(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === "function") {
    try {
      if (dialog.open) dialog.close();
      return;
    } catch {
      // Fallback to attribute removal
    }
  }
  dialog.removeAttribute("open");
}

function esc(str = "") {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[m]));
}

export function createUiV2({ world, sound, getState, setState, mapApi, onNewGame }) {
  let selectedCity = null;
  let selectedArmyId = null;
  let selectedEdge = null; // { edgeKey, aKey, bKey }
  let courtTab = "offices";
  let overlayMode = "standard";
  let dispatchDraft = {
    from: null,
    to: null,
    officer: null,
    deputy: null,
    formation: "heyi",
    troopType: null,
    troops: 800,
    siegeStance: "storm",
  };
  let dealDraft = {
    target: null,
    type: "truce",
    gold: 25,
    grain: 20,
    cedeCityKey: "",
    releaseCaptiveKey: "",
    thirdFactionKey: "",
  };
  let coordDraft = {
    target: null,
    origins: [],
    sync: true,
    formation: "heyi",
  };
  let trendMetric = "cities";
  let replayIndex = -1;
  let edictTarget = null;
  let transferDraft = { officer: null, to: null };
  let smartRatio = 0.75;
  let advancedDispatchOpen = false;
  let corpsDraft = {
    name: "",
    commanderKey: "",
    mission: "conquer_city",
    targetCity: "",
    targetFaction: "",
    supplyToCity: "",
    cityKeys: [],
  };

  let menuScenarioYear = null;
  let menuFaction = null;
  let menuDifficulty = null;

  const inspector = $("v2-inspector");
  const inspectorBody = $("inspector-body");
  const handleSummary = $("inspector-handle-summary");
  const handleToggle = $("inspector-handle-toggle");
  const handleBtn = $("inspector-handle");

  function setInspectorCollapsed(collapsed) {
    if (!inspector) return;
    inspector.dataset.collapsed = String(collapsed);
    if (handleBtn) handleBtn.setAttribute("aria-expanded", String(!collapsed));
    if (handleToggle) handleToggle.textContent = collapsed ? "展开 ▴" : "收起 ▾";
    // Re-frame map smoothly if bottom drawer toggled on H5
    if (window.innerWidth <= 900) {
      requestAnimationFrame(() => mapApi.invalidateLayout?.());
    }
  }

  handleBtn?.addEventListener("click", () => {
    const isCol = inspector.dataset.collapsed === "true";
    setInspectorCollapsed(!isCol);
  });

  function showTicker(text) {
    const el = $("v2-ticker");
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.hidden = true; }, 4500);
  }

  function preserveScroll(el, renderFn) {
    const prevTop = el ? el.scrollTop : 0;
    renderFn();
    if (el) el.scrollTop = prevTop;
  }

  function applyCommand(fn, tickerMsg) {
    try {
      const next = fn(getState());
      setState(next);
      sound?.play?.("order");
      if (next.lastTurnEvents?.length) mapApi.flashEvents?.(next.lastTurnEvents);
      if (tickerMsg) showTicker(tickerMsg);
      renderAll();
      return true;
    } catch (err) {
      sound?.play?.("alert");
      showTicker(`⚠️ ${err.message}`);
      return false;
    }
  }

  function renderTopbar(state) {
    const cal = formatCalendar(state.year, state.turn);
    const era = eraByYearV2(world, state.year);
    const sum = factionSummary(state, state.player);
    const rp = rankProgressForFaction(state, state.player);
    const econ = estimateFactionEconomy(state, state.player);
    const fName = factionNameV2(world, state, state.player);
    const holdsEmp = Boolean(state.emperorCity && state.cities[state.emperorCity]?.owner === state.player);
    const holdsSeal = state.sealFaction === state.player;
    const crownTxt = holdsEmp && holdsSeal ? " · 👑奉天子·💎传国玺"
      : holdsEmp ? " · 👑奉天子"
        : holdsSeal ? " · 💎传国玺" : "";
    const devLeft = Math.max(0, OPENING_DEV_DEKADS - (state.turn || 0));
    const phaseTag = state.threeKingdoms?.triggered ? " · 👑三足鼎立" : devLeft > 0 ? ` · 🌱蓄势余${devLeft}旬` : "";

    const isCompact = typeof window !== "undefined" && window.innerWidth <= 900;
    const isMedium = typeof window !== "undefined" && window.innerWidth <= 1320;
    $("v2-date").textContent = isCompact
      ? `${cal.year}年${cal.month}月${cal.dekadName} · ${rp.prestigeRank?.title || rp.current.title}${devLeft > 0 ? ` 🌱${devLeft}` : ""}`.trim()
      : isMedium
        ? `${cal.label}（${fName}·${rp.prestigeRank?.title || rp.current.title}${crownTxt}${phaseTag}）`
        : `${era.title} · ${cal.label}（${fName} · ${rp.prestigeRank?.title || rp.current.title}${crownTxt}${phaseTag}）`;
    const wPill = $("v2-weather");
    if (wPill && state.weather) {
      wPill.textContent = `${state.weather.icon} ${state.weather.name}`;
      wPill.title = state.weather.summary;
    }

    const signT = econ.netTreasury >= 0 ? `+${econ.netTreasury}` : `${econ.netTreasury}`;
    const signG = econ.netGrain >= 0 ? `+${econ.netGrain}` : `${econ.netGrain}`;
    const resT = $("res-treasury");
    if (resT) {
      resT.textContent = `${sum.treasury.toLocaleString()}钱`;
      if (resT.parentElement) {
        resT.parentElement.title = `月净收支 ${signT} 钱（税收 +${econ.grossTreasury} / 军饷 -${econ.upkeepTreasury} / 腐败 -${econ.corruptionLoss}）`;
      }
    }
    const resG = $("res-grain");
    if (resG) {
      resG.textContent = `${sum.grain.toLocaleString()}石`;
      if (resG.parentElement) {
        resG.parentElement.title = `月净产粮 ${signG} 石（农产 +${econ.grossGrain} / 军粮消耗 -${econ.upkeepGrain}）`;
      }
    }
    $("res-cities").textContent = `${sum.cityCount}/44`;
    $("res-troops").textContent = `${sum.totalTroops.toLocaleString()}`;

    const sealBtn = $("seal-btn");
    if (sealBtn) {
      sealBtn.textContent = [...fName][0] || "略";
      sealBtn.style.background = factionColor(state.player);
    }

    const cabBtn = $("open-cabinet");
    const cabBadge = $("cabinet-badge");
    const cabCount = buildCabinetBriefings(world, state).length;
    if (cabBtn?.firstChild?.nodeType === 3) {
      cabBtn.firstChild.nodeValue = isCompact ? "军机" : "🏛️ 军机处";
    }
    if (cabBadge) {
      cabBadge.textContent = String(cabCount);
      cabBadge.hidden = cabCount === 0;
    }

    const courtBtn = $("open-court");
    if (courtBtn) {
      const nArmies = sum.armyCount;
      const nCap = state.captives?.length || 0;
      courtBtn.textContent = isCompact
        ? (nCap ? "朝堂(俘)" : "朝堂")
        : (nCap ? `朝堂 (${nCap}俘)` : nArmies ? `朝堂 (${nArmies}军)` : "朝堂");
    }
  }

  function renderAlerts(state) {
    const strip = $("v2-alert-strip");
    if (!strip) return;
    const threats = computeThreats(world, state).slice(0, 3);
    if (!threats.length) {
      strip.hidden = true;
      strip.innerHTML = "";
      return;
    }
    strip.hidden = false;
    strip.innerHTML = threats.map((t) => {
      const cName = cityNameV2(world, t.to);
      if (t.kind === "siege") {
        return `<button type="button" class="v2-alert-pill" data-focus-city="${esc(t.to)}">🔥 ${esc(cName)}正遭围攻！</button>`;
      }
      if (t.kind === "marching") {
        return `<button type="button" class="v2-alert-pill" data-focus-city="${esc(t.to)}">⚠️ ${esc(t.officerName)} ${t.troops.toLocaleString()}人逼近${esc(cName)} (${t.etaDekads}旬)</button>`;
      }
      return `<button type="button" class="v2-alert-pill" data-focus-city="${esc(t.to)}">🚩 ${esc(cName)}边防吃紧（邻敌${t.troops.toLocaleString()}）</button>`;
    }).join("");

    strip.querySelectorAll("[data-focus-city]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ck = btn.dataset.focusCity;
        selectCity(ck, { expandMobile: true, focusMap: true });
      });
    });
  }

  function ensureValidDraft(state, fromKey) {
    const fromCity = state.cities[fromKey];
    if (!fromCity || fromCity.owner !== state.player) return null;
    const adj = cityByKey(world, fromKey)?.links || [];
    const enemyAdj = adj.filter((k) => isHostileV2(state, state.player, state.cities[k]?.owner));
    const friendlyAdj = adj.filter((k) => state.cities[k]?.owner === state.player);
    const allReachable = Object.values(state.cities)
      .filter((c) => c.key !== fromKey)
      .sort((a, b) => Number(b.owner !== state.player) - Number(a.owner !== state.player));

    if (dispatchDraft.from !== fromKey) {
      dispatchDraft.from = fromKey;
      dispatchDraft.to = enemyAdj[0] || friendlyAdj[0] || allReachable[0]?.key || null;
      dispatchDraft.deputy = null;
      dispatchDraft.troopType = fromCity.troopType;
      dispatchDraft.troops = Math.min(fromCity.troops - MIN_GARRISON_LEAVE, Math.max(MIN_DISPATCH_TROOPS, Math.round((fromCity.troops - MIN_GARRISON_LEAVE) * 0.65)));
    }
    const avail = availableOfficersInCity(state, fromKey, state.player);
    if (!avail.some((o) => o.key === dispatchDraft.officer)) {
      dispatchDraft.officer = avail[0]?.key || null;
    }
    if (dispatchDraft.deputy && (dispatchDraft.deputy === dispatchDraft.officer || !avail.some((o) => o.key === dispatchDraft.deputy))) {
      dispatchDraft.deputy = null;
    }
    if (!dispatchDraft.formation || !FORMATIONS_V2[dispatchDraft.formation]) {
      dispatchDraft.formation = "heyi";
    }
    if (!dispatchDraft.troopType || !TROOP_TYPES[dispatchDraft.troopType]) {
      dispatchDraft.troopType = fromCity.troopType;
    }
    const maxSend = Math.max(0, fromCity.troops - MIN_GARRISON_LEAVE);
    dispatchDraft.troops = Math.max(MIN_DISPATCH_TROOPS, Math.min(maxSend, dispatchDraft.troops || MIN_DISPATCH_TROOPS));
    return { avail, maxSend, enemyAdj, friendlyAdj };
  }

  function renderArmyInspector(state, army) {
    const off = army.officer ? state.officers[army.officer] : null;
    const dep = army.deputy ? state.officers[army.deputy] : null;
    const form = FORMATIONS_V2[army.formation || "heyi"] || FORMATIONS_V2.heyi;
    const spec = TROOP_TYPES[army.troopType] || TROOP_TYPES.infantry;
    const isOwn = army.faction === state.player;
    const supplyOk = checkSupplyLine(world, state, army);
    const eta = armyEtaDekads(world, state, army);
    const fName = factionNameV2(world, state, army.faction);
    const destName = cityNameV2(world, army.targetCity);
    const leadLabel = off?.name || army.escortName || "辎重编队";
    const art = off ? officerBattleArt(off) : null;
    const ragePct = clamp(army.rage || 0, 0, 100);

    if (handleSummary) {
      handleSummary.textContent = `${leadLabel} · ${spec.icon}${army.troops.toLocaleString()} · 趋向${destName}`;
    }

    const stanceLabel = army.stance === "besiege" ? `🔥 围攻${destName}中`
      : army.stance === "engaged" ? `⚔️ 阵前绞杀交锋中（第${army.engageRounds || 1}合）`
        : army.stance === "reinforce" ? `🛡️ 驰援${destName}（约${eta}旬）`
          : army.stance === "retreat" ? `🏳️ 回撤${destName}（约${eta}旬）`
            : `⚔️ 进军${destName}（约${eta}旬）`;

    let html = `
      <div class="v2-card ${army.stance === "engaged" ? "siege-alert" : ""}">
        <div class="v2-card-head">
          <h2>${esc(leadLabel)}所部</h2>
          <span class="v2-badge" style="background:${factionColor(army.faction)}">${esc(fName)}</span>
        </div>
        <p class="v2-muted">${esc(stanceLabel)} · ${form.icon}${esc(form.name)}${dep ? ` · 副将${esc(dep.name)}` : ""}${off ? ` · 统 ${off.command} / 武 ${off.might}` : ""}</p>
        ${(army.delayDekads || 0) > 0 ? `<p class="v2-muted" style="color:var(--gold)">⏳ 合围协同期：原地整装待命（余 ${army.delayDekads} 旬启程以求诸路齐至）。</p>` : ""}
        ${army.stance === "engaged" ? `<p class="v2-muted" style="color:var(--gold)">⚡ 两军正于官道白刃相持！调遣友好军团进抵同道可获 +18% 夹击加成，或下令班师脱战。</p>` : ""}
        ${art ? `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem">
            <span class="v2-art-pill" title="${esc(art.desc)}">${art.icon} 战法：${esc(art.name)}</span>
            <span class="v2-muted" style="font-size:0.74rem">战意 ${ragePct}%</span>
          </div>
          <div class="v2-bar rage"><i style="width:${ragePct}%"></i></div>
          ${isOwn && ragePct >= 100 ? `<button type="button" class="v2-btn primary" id="btn-army-art">⚡ 立即施放「${esc(art.name)}」</button>` : ""}
        ` : ""}
        <div class="v2-stat-grid">
          <div class="v2-stat-box"><small>兵种与兵力</small><strong>${spec.icon} ${esc(spec.name)} ${army.troops.toLocaleString()}</strong></div>
          <div class="v2-stat-box"><small>随军士气</small><strong>${army.morale} / 100</strong></div>
          <div class="v2-stat-box"><small>随军余粮</small><strong>${army.grain} 石</strong></div>
          <div class="v2-stat-box"><small>后勤补给线</small><strong>${supplyOk ? "✅ 畅通" : "⚡ 已被切断"}</strong></div>
        </div>
      </div>`;

    if (isOwn) {
      const reachable = Object.values(state.cities)
        .filter((c) => c.key !== army.targetCity && (c.owner === state.player || isHostileV2(state, state.player, c.owner)))
        .slice(0, 24);
      html += `
        <div class="v2-card">
          <div class="v2-card-head"><h3>军团实时变阵指令</h3></div>
          <div class="v2-field">
            <label>围城战术（临城即生效）</label>
            <div class="v2-chip-grid">
              ${Object.values(SIEGE_STANCES).map((st) => `
                <button type="button" class="v2-chip ${army.siegeStance === st.id ? "active" : ""}" data-army-stance="${st.id}" title="${esc(st.summary)}">
                  ${st.icon} ${esc(st.name)}${st.cost ? `(${st.cost}钱)` : ""}
                </button>`).join("")}
            </div>
            <p class="v2-muted">${esc(SIEGE_STANCES[army.siegeStance]?.summary || "")}</p>
          </div>
          <div class="v2-field">
            <label>中途改道至别城</label>
            <div style="display:flex;gap:0.4rem">
              <select class="v2-select" id="army-redirect-target">
                ${reachable.map((c) => `<option value="${esc(c.key)}">${esc(cityNameV2(world, c.key))}（${esc(factionNameV2(world, state, c.owner))} · ${c.troops}人）</option>`).join("")}
              </select>
              <button type="button" class="v2-btn secondary" id="btn-army-redirect">改道</button>
            </div>
          </div>
          <div style="display:flex;gap:0.45rem;margin-top:0.2rem">
            <button type="button" class="v2-btn danger" id="btn-army-retreat" style="flex:1">🏳️ 全军撤回己城</button>
            <button type="button" class="v2-btn quiet" id="btn-army-dest" style="flex:1">查看目标城</button>
          </div>
        </div>`;
    } else {
      const cdFire = stratagemCooldownLeft(state, state.player, "fire_attack");
      const cdRaid = stratagemCooldownLeft(state, state.player, "raid_supply");
      const cdFlood = stratagemCooldownLeft(state, state.player, "flood_attack");
      const nearRiver = roadTerrain(army.from, army.to) === "river"
        || (cityByKey(world, army.targetCity)?.links || []).some((nb) => roadTerrain(army.targetCity, nb) === "river");
      html += `
        <div class="v2-card">
          <div class="v2-card-head"><h3>🔥 天时实战奇计（作用于此敌军）</h3></div>
          <p class="v2-muted">敌将统兵在野，可借天时火风、轻骑劫粮或江渡决水直接重创此部！</p>
          <div style="display:flex;flex-wrap:wrap;gap:0.35rem">
            <button type="button" class="v2-btn danger" id="btn-st-fire" ${cdFire ? "disabled" : ""} title="${esc(STRATAGEM_CATALOG.fire_attack.summary)}">🔥 顺风火攻(${cdFire ? `冷${cdFire}旬` : "16钱"})</button>
            <button type="button" class="v2-btn secondary" id="btn-st-raid" ${cdRaid ? "disabled" : ""} title="${esc(STRATAGEM_CATALOG.raid_supply.summary)}">⚡ 奇袭劫粮(${cdRaid ? `冷${cdRaid}旬` : "14钱"})</button>
            ${nearRiver ? `<button type="button" class="v2-btn secondary" id="btn-st-flood" ${cdFlood ? "disabled" : ""} title="${esc(STRATAGEM_CATALOG.flood_attack.summary)}">🌊 决水阻击(${cdFlood ? `冷${cdFlood}旬` : "20钱"})</button>` : ""}
          </div>
          <button type="button" class="v2-btn quiet" id="btn-army-dest">定位查看目标城「${esc(destName)}」</button>
        </div>`;
    }

    preserveScroll(inspectorBody, () => {
      inspectorBody.innerHTML = html;
    });

    $("btn-army-art")?.addEventListener("click", () => {
      applyCommand((s) => triggerArmyArt(world, s, army.id, [], { manual: true }));
    });
    $("btn-st-fire")?.addEventListener("click", () => {
      applyCommand((s) => castStratagem(world, s, { kind: "fire_attack", targetType: "army", targetId: army.id }));
    });
    $("btn-st-raid")?.addEventListener("click", () => {
      applyCommand((s) => castStratagem(world, s, { kind: "raid_supply", targetType: "army", targetId: army.id }));
    });
    $("btn-st-flood")?.addEventListener("click", () => {
      applyCommand((s) => castStratagem(world, s, { kind: "flood_attack", targetType: "army", targetId: army.id }));
    });

    inspectorBody.querySelectorAll("[data-army-stance]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextSt = btn.dataset.armyStance;
        applyCommand((s) => redirectArmy(world, s, army.id, { siegeStance: nextSt }), `军团围城方略已切换为「${SIEGE_STANCES[nextSt].name}」`);
      });
    });
    $("btn-army-redirect")?.addEventListener("click", () => {
      const target = $("army-redirect-target")?.value;
      if (target) applyCommand((s) => redirectArmy(world, s, army.id, { targetCity: target }), `大军已就地改道趋向${cityNameV2(world, target)}`);
    });
    $("btn-army-retreat")?.addEventListener("click", () => {
      applyCommand((s) => redirectArmy(world, s, army.id, { stance: "retreat" }), "大军已奉命班师回撤");
    });
    $("btn-army-dest")?.addEventListener("click", () => {
      selectCity(army.targetCity, { expandMobile: true, focusMap: true });
    });
  }

  function renderEdgeInspector(state, edge) {
    const { edgeKey: eKey, aKey, bKey } = edge;
    const passName = edgeDisplayName(world, aKey, bKey);
    const terrain = roadTerrain(aKey, bKey);
    const fort = state.forts?.[eKey];
    const cityA = state.cities[aKey];
    const cityB = state.cities[bKey];
    const fSpec = fort ? (FORT_CATALOG[fort.kind] || FORT_CATALOG.gate) : null;
    const ownFort = fort && fort.faction === state.player;
    const hostileFort = fort && isHostileV2(state, state.player, fort.faction);

    if (handleSummary) {
      handleSummary.textContent = `${passName} · ${fSpec ? `${fSpec.icon}${fSpec.name}` : "待修工事要冲"}`;
    }

    let html = `
      <div class="v2-card">
        <div class="v2-card-head">
          <h2>🚧 ${esc(passName)}</h2>
          <span class="v2-badge">${TERRAIN_LABELS[terrain]}官道</span>
        </div>
        <p class="v2-muted">连通：${esc(cityNameV2(world, aKey))}（${esc(factionNameV2(world, state, cityA?.owner))}） ↔ ${esc(cityNameV2(world, bKey))}（${esc(factionNameV2(world, state, cityB?.owner))}）</p>`;

    if (fort && fSpec) {
      const pct = Math.round((fort.hp / Math.max(1, fort.hpMax)) * 100);
      html += `
        <div class="v2-stat-grid">
          <div class="v2-stat-box"><small>现有工事（${esc(factionNameV2(world, state, fort.faction))}）</small><strong>${fSpec.icon} ${esc(fSpec.name)}</strong></div>
          <div class="v2-stat-box"><small>工事耐久 (${fort.hp}/${fort.hpMax})</small><div class="v2-bar wall"><i style="width:${pct}%"></i></div></div>
        </div>
        <p class="v2-muted">${esc(fSpec.summary)}</p>`;
      if (ownFort) {
        html += `
          <div style="display:flex;gap:0.45rem">
            <button type="button" class="v2-btn secondary" id="btn-fort-repair" ${fort.hp >= fort.hpMax ? "disabled" : ""} style="flex:1">🔧 抢修(+95 · 8钱)</button>
            <button type="button" class="v2-btn danger" id="btn-fort-demolish">拆除</button>
          </div>`;
      } else if (hostileFort) {
        const cdFire = stratagemCooldownLeft(state, state.player, "fire_attack");
        html += `<button type="button" class="v2-btn danger" id="btn-fort-fire" ${cdFire ? "disabled" : ""}>🔥 顺风火攻焚毁敌寨 (${cdFire ? `冷${cdFire}旬` : "16钱"})</button>`;
      }
    } else {
      html += `
        <p class="v2-muted">此处官道尚无工事。掌控任一端城池即可在此兴建沙盘工事，扼守交通咽喉或延伸粮道！</p>
        <div style="display:flex;flex-direction:column;gap:0.42rem">
          ${Object.values(FORT_CATALOG).map((fc) => {
            const check = canBuildFort(world, state, state.player, aKey, bKey, fc.id);
            return `
              <button type="button" class="v2-pick-card" data-build-fort="${fc.id}" ${check.ok ? "" : "disabled"} title="${esc(check.ok ? fc.summary : check.reason)}">
                <div class="v2-row-top"><strong>${fc.icon} 修筑${esc(fc.name)}</strong><span class="v2-badge">${fc.cost}钱</span></div>
                <div class="v2-muted">${esc(check.ok ? fc.summary : check.reason)}</div>
              </button>`;
          }).join("")}
        </div>`;
    }
    html += `<button type="button" class="v2-btn quiet" id="btn-edge-back">返回城池「${esc(cityNameV2(world, aKey))}」</button></div>`;
    inspectorBody.innerHTML = html;

    inspectorBody.querySelectorAll("[data-build-fort]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fk = btn.dataset.buildFort;
        applyCommand((s) => buildFort(world, s, aKey, bKey, fk), `${passName}已筑起「${FORT_CATALOG[fk].name}」！`);
      });
    });
    $("btn-fort-repair")?.addEventListener("click", () => {
      applyCommand((s) => repairFort(world, s, eKey), `${passName}工事已抢修加固！`);
    });
    $("btn-fort-demolish")?.addEventListener("click", () => {
      applyCommand((s) => demolishFort(s, eKey), `已拆除${passName}工事`);
    });
    $("btn-fort-fire")?.addEventListener("click", () => {
      applyCommand((s) => castStratagem(world, s, { kind: "fire_attack", targetType: "fort", targetId: eKey }));
    });
    $("btn-edge-back")?.addEventListener("click", () => selectCity(aKey));
  }

  function renderCityInspector(state, cityKey) {
    const cMeta = cityByKey(world, cityKey);
    const city = state.cities[cityKey];
    if (!cMeta || !city) return;

    const isOwn = city.owner === state.player;
    const isBesieged = Boolean(state.sieges?.[cityKey]);
    const spec = TROOP_TYPES[city.troopType] || TROOP_TYPES.infantry;
    const citySpec = CITY_SPECIALTIES[city.specialty];
    const activeBonds = cityBonds(state, cityKey);
    const ownerName = factionNameV2(world, state, city.owner);
    const wallPct = Math.round((city.wall / Math.max(1, city.wallMax)) * 100);
    const cmdOff = city.commander ? state.officers[city.commander] : null;
    const govOff = city.governor ? state.officers[city.governor] : null;
    const cityCorps = isOwn ? getCorpsForCity(state, cityKey) : null;
    const regName = city.region || cMeta.region;
    const regGovInfo = isOwn ? computeRegionalGovernorBonus(state, { ...city, region: regName }) : null;

    if (handleSummary) {
      handleSummary.textContent = `${cMeta.name}（${ownerName}）· ${spec.icon}${city.troops.toLocaleString()} · 城防${wallPct}%`;
    }

    let html = `
      <div class="v2-card ${isBesieged ? "siege-alert" : ""}">
        <div class="v2-card-head">
          <h2>${esc(cMeta.name)} ${isBesieged ? "🔥 围城中" : ""}</h2>
          <span class="v2-badge" style="background:${factionColor(city.owner)}">${esc(ownerName)} · ${esc(cMeta.region)}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:0.35rem">
          ${state.emperorCity === cityKey ? `<span class="v2-specialty-pill">👑 汉帝行在（天子驻跸）</span>` : ""}
          ${citySpec ? `<span class="v2-specialty-pill" title="${esc(citySpec.desc)}">${citySpec.icon} ${esc(citySpec.name)}</span>` : ""}
          ${regGovInfo?.officer ? `<span class="v2-specialty-pill">🏛️ ${esc(regName)}州牧：${esc(regGovInfo.officer.name)}</span>` : ""}
          ${activeBonds.map((b) => `<span class="v2-bond-pill" title="${esc(b.matched.join(" / "))}">🤝 ${esc(b.name)}</span>`).join("")}
        </div>
        ${citySpec ? `<p class="v2-muted" style="font-size:0.72rem">${esc(citySpec.desc)}</p>` : ""}
        <div class="v2-stat-grid">
          <div class="v2-stat-box">
            <small>驻军与主力兵种</small>
            <strong>${spec.icon} ${esc(spec.name)} · ${city.troops.toLocaleString()}</strong>
          </div>
          <div class="v2-stat-box">
            <small>守军士气 / 等级</small>
            <strong>${city.morale} / Lv.${city.level}</strong>
          </div>
          <div class="v2-stat-box">
            <small>城防耐久 (${city.wall}/${city.wallMax})</small>
            <div class="v2-bar wall"><i style="width:${wallPct}%"></i></div>
          </div>
          <div class="v2-stat-box">
            <small>城内余粮 (${city.foodReserve}%)</small>
            <div class="v2-bar food"><i style="width:${city.foodReserve}%"></i></div>
          </div>
        </div>
        <p class="v2-muted">太守：${esc(govOff?.name || "虚位")} ｜ 守将：${esc(cmdOff?.name || "虚位")}${city.trap && DEFENSE_TRAPS[city.trap.id] ? ` ｜ 暗伏：${DEFENSE_TRAPS[city.trap.id].icon}${DEFENSE_TRAPS[city.trap.id].name}` : ""}</p>
        ${isOwn ? `
          <div class="v2-recruit-row">
            <span class="v2-muted" style="font-size:0.75rem">${cityCorps ? `🚩 归属「${esc(cityCorps.name)}」` : "👑 主公直辖"}</span>
            <select class="v2-select" id="city-assign-corps" style="width:auto;max-width:62%;padding:0.24rem 1.7rem 0.24rem 0.45rem;font-size:0.74rem">
              <option value="" ${!cityCorps ? "selected" : ""}>👑 归主公直辖</option>
              ${(state.corps || []).map((co) => `<option value="${esc(co.id)}" ${cityCorps?.id === co.id ? "selected" : ""}>🚩 划入【${esc(co.name)}】</option>`).join("")}
            </select>
          </div>` : ""}
      </div>`;

    if (isBesieged) {
      const siege = state.sieges[cityKey];
      const besiegers = (siege.attackerArmyIds || [])
        .map((id) => state.armies.find((a) => a.id === id))
        .filter((a) => a && a.troops > 0);
      html += `
        <div class="v2-card siege-alert">
          <div class="v2-card-head"><h3>🔥 跨旬围城对峙阵地</h3></div>
          ${besiegers.map((a) => {
            const o = state.officers[a.officer];
            const st = SIEGE_STANCES[a.siegeStance] || SIEGE_STANCES.storm;
            const tSp = TROOP_TYPES[a.troopType] || TROOP_TYPES.infantry;
            return `<div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;font-size:0.8rem">
              <span>${esc(factionNameV2(world, state, a.faction))} · ${esc(o?.name || "围军")} ${tSp.icon}${a.troops.toLocaleString()}</span>
              <span class="v2-badge">${st.icon} ${esc(st.name)}</span>
            </div>`;
          }).join("")}
          ${isOwn ? `
            <div class="v2-field">
              <label>我方守城应变战法</label>
              <div class="v2-chip-grid">
                ${Object.values(SIEGE_DEFENSE_MODES).map((m) => `
                  <button type="button" class="v2-chip ${city.siegeDefense === m.id ? "active" : ""}" data-siege-def="${m.id}" title="${esc(m.summary)}">${m.icon} ${esc(m.name)}</button>`).join("")}
              </div>
              <p class="v2-muted">${esc(SIEGE_DEFENSE_MODES[city.siegeDefense || "hold"].summary)}</p>
            </div>
            <button type="button" class="v2-btn primary" id="btn-emergency-relief">🎺 一键自邻城火速发兵解围</button>
          ` : besiegers.some((a) => a.faction === state.player) ? `
            <button type="button" class="v2-btn secondary" id="btn-focus-own-besieger">指挥我方围城主军</button>
          ` : ""}
        </div>`;
    }

    const recruitHeroesHere = (state.wanderingOfficers || []).filter((w) => (
      w.city === cityKey || cMeta.links.includes(w.city)
    ) && (state.cities[w.city]?.owner === state.player || (cityByKey(world, w.city)?.links || []).some((nb) => state.cities[nb]?.owner === state.player)));
    if (recruitHeroesHere.length) {
      html += `
        <div class="v2-card">
          <div class="v2-card-head"><h3>📜 在野名士现踪 · 礼贤登庸</h3></div>
          ${recruitHeroesHere.map((w) => `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.45rem">
              <div>
                <strong>${esc(w.name)}</strong> <small class="v2-muted">（统${w.command} 武${w.might} 政${w.governance} · 现于${esc(cityNameV2(world, w.city))}）</small>
                <div class="v2-muted" style="font-size:0.72rem">${esc(w.bio)}</div>
              </div>
              <button type="button" class="v2-btn primary" data-recruit-hero="${esc(w.id)}">礼聘(24钱)</button>
            </div>`).join("")}
        </div>`;
    }

    if (isOwn) {
      const draftInfo = ensureValidDraft(state, cityKey);
      const targets = Object.values(state.cities)
        .filter((c) => c.key !== cityKey)
        .sort((a, b) => {
          const adjA = cMeta.links.includes(a.key) ? 0 : 1;
          const adjB = cMeta.links.includes(b.key) ? 0 : 1;
          if (adjA !== adjB) return adjA - adjB;
          const hostA = isHostileV2(state, state.player, a.owner) ? 0 : 1;
          const hostB = isHostileV2(state, state.player, b.owner) ? 0 : 1;
          return hostA - hostB || a.troops - b.troops;
        });

      const recPrev = previewCityRecruit(state, cityKey, state.player);
      const tier = cityTierInfo(city);
      const orderVal = Number.isFinite(city.publicOrder) ? city.publicOrder : 78;
      const treasury = state.factions[state.player]?.treasury ?? 0;
      const con = city.construction;
      const conDef = con ? CITY_BUILDINGS_V4[con.trackId] : null;

      html += `
        <div class="v2-card">
          <div class="v2-card-head">
            <h3>🏗️ 郡国农商基建 · 征兵 · 治安</h3>
            <span class="v2-badge">${esc(tier.title)} (${tier.totalDev}/20)</span>
          </div>
          <div class="v2-stat-box">
            <small>公共秩序 (${orderVal}/100${orderVal < 30 ? " · ⚠️ 恐生民变" : ""})</small>
            <div class="v2-bar order"><i style="width:${orderVal}%"></i></div>
          </div>
          ${con && conDef ? `
            <div class="v2-forecast-line">
              🔨 正在施工：<strong>${conDef.icon} ${esc(conDef.name)} Lv.${con.targetLevel}</strong>（尚余 <strong>${con.remainingDekads}/${con.totalDekads} 旬</strong> 竣工${isBesieged ? " · 围城暂缓" : ""}）
            </div>` : ""}
          <div class="v2-building-grid">
            ${Object.values(CITY_BUILDINGS_V4).map((b) => {
              const lv = city.buildings?.[b.id] ?? 0;
              const maxd = lv >= 5;
              const cost = maxd ? 0 : buildingUpgradeCost(state, state.player, b.id, lv + 1);
              const dur = maxd ? 0 : buildingBuildDekads(lv + 1);
              const blocked = maxd || isBesieged || Boolean(con) || treasury < cost;
              return `
                <button type="button" class="v2-building-cell" data-upgrade-building="${esc(b.id)}" ${blocked ? "disabled" : ""} title="${esc(b.summary)}">
                  <div class="v2-row-top">
                    <strong style="font-size:0.78rem">${b.icon} ${esc(b.name)}</strong>
                    <span class="v2-badge">Lv.${lv}/5</span>
                  </div>
                  <span class="v2-muted" style="font-size:0.7rem">${maxd ? "✅ 已至满级" : con ? "另有工程在建" : isBesieged ? "围城停工" : `动工 Lv.${lv + 1} · ${cost}钱/${dur}旬`}</span>
                </button>`;
            }).join("")}
          </div>
          <div class="v2-recruit-row">
            <span class="v2-muted" style="font-size:0.74rem">兵源上限 ${recPrev.cap.toLocaleString()} 人</span>
            <button type="button" class="v2-btn secondary" id="btn-city-recruit" ${recPrev.ok ? "" : "disabled"} title="${esc(recPrev.reason || "耗费钱粮即刻募兵补员")}">
              ⚔️ 立即征兵 (${recPrev.ok ? `+${recPrev.amount}人 · ${recPrev.goldCost}钱/${recPrev.grainCost}粮` : esc(recPrev.reason.slice(0, 14))})
            </button>
          </div>
          <div class="v2-field">
            <label>月度自动治城方针</label>
            <div class="v2-chip-grid">
              ${Object.values(CITY_POLICIES).map((p) => `
                <button type="button" class="v2-chip ${city.policy === p.id ? "active" : ""}" data-city-policy="${p.id}" title="${esc(p.desc)}">${p.icon} ${esc(p.name)}</button>`).join("")}
            </div>
          </div>
        </div>`;

      const smartPrev = dispatchDraft.to ? previewSmartDispatch(world, state, {
        from: cityKey,
        to: dispatchDraft.to,
        troopRatio: smartRatio,
      }) : { ok: false, reason: "请选择出兵目标城池。" };

      const canSend = draftInfo && draftInfo.avail.length > 0 && draftInfo.maxSend >= MIN_DISPATCH_TROOPS && dispatchDraft.to;
      const fc = canSend ? forecastDispatch(world, state, {
        from: cityKey,
        to: dispatchDraft.to,
        troops: dispatchDraft.troops,
        troopType: dispatchDraft.troopType,
        officer: dispatchDraft.officer,
        formation: dispatchDraft.formation,
      }) : null;
      const depChoices = draftInfo.avail.filter((o) => o.key !== dispatchDraft.officer);
      const selectedForm = FORMATIONS_V2[dispatchDraft.formation] || FORMATIONS_V2.heyi;
      const targetCityObj = dispatchDraft.to ? state.cities[dispatchDraft.to] : null;
      const isFriendlyTarget = targetCityObj && (targetCityObj.owner === state.player || activeTreaty(state, state.player, targetCityObj.owner)?.kind === "alliance");

      html += `
        <div class="v2-card">
          <div class="v2-card-head">
            <h3>⚡ 极简一键出征 / 驰援</h3>
            <span class="v2-muted" style="font-size:0.72rem">拖拽或右键地图目标城快选</span>
          </div>
          <div class="v2-field">
            <label>出兵目标城池</label>
            <select class="v2-select" id="dispatch-to">
              ${targets.map((c) => {
                const tag = c.owner === state.player ? "己方" : isHostileV2(state, state.player, c.owner) ? `敌·${factionNameV2(world, state, c.owner)}` : `盟·${factionNameV2(world, state, c.owner)}`;
                const adjMark = cMeta.links.includes(c.key) ? "直连 · " : "";
                return `<option value="${esc(c.key)}" ${dispatchDraft.to === c.key ? "selected" : ""}>${esc(cityNameV2(world, c.key))}（${adjMark}${esc(tag)} · ${c.troops}人）</option>`;
              }).join("")}
            </select>
          </div>
          <div class="v2-chip-grid">
            ${[
              { pct: 0.5, label: "半编 (50%)" },
              { pct: 0.75, label: "精锐 (75%)" },
              { pct: 0.95, label: "倾巢 (95%)" },
            ].map((item) => `
              <button type="button" class="v2-chip ${Math.abs(smartRatio - item.pct) < 0.02 ? "active" : ""}" data-smart-pct="${item.pct}">${item.label}</button>`).join("")}
          </div>
          ${smartPrev.ok ? `
            <div class="v2-forecast-line ${smartPrev.forecast.counter.relation}">
              自动择将：<strong>${esc(smartPrev.officer.name)}</strong>${smartPrev.deputy ? ` + 副将 <strong>${esc(smartPrev.deputy.name)}</strong>` : ""} · <strong>${smartPrev.troops.toLocaleString()} 人</strong> · ${smartPrev.forecast.dekads} 旬抵达 · 耗粮 ${smartPrev.forecast.grainCost} 石
            </div>` : `<div class="v2-forecast-line countered">${esc(smartPrev.reason || "暂不可出征")}</div>`}
          <button type="button" class="v2-btn primary" id="btn-smart-dispatch" ${smartPrev.ok ? "" : "disabled"}>
            ${isFriendlyTarget ? "🛡️ 委任将领驰援" : "⚡ 委任将领出征"}
          </button>

          <details class="v2-collapse" id="advanced-dispatch-details" ${advancedDispatchOpen ? "open" : ""}>
            <summary><span>⚙️ 高级手动编组（自选将领 / 兵种 / 阵型）</span><span>展开 ▾</span></summary>
            <div class="v2-collapse-body">
              <div class="v2-field">
                <label>领兵主将</label>
                <select class="v2-select" id="dispatch-officer">
                  ${draftInfo.avail.map((o) => `<option value="${esc(o.key)}" ${dispatchDraft.officer === o.key ? "selected" : ""}>${esc(o.name)}（统${o.command} 武${o.might} 忠${o.loyalty}）</option>`).join("")}
                </select>
              </div>
              <div class="v2-field">
                <label>随军副将（激活名将羁绊与作战加成）</label>
                <select class="v2-select" id="dispatch-deputy">
                  <option value="">-- 无副将 --</option>
                  ${depChoices.map((o) => `<option value="${esc(o.key)}" ${dispatchDraft.deputy === o.key ? "selected" : ""}>${esc(o.name)}（统${o.command} 武${o.might}）</option>`).join("")}
                </select>
              </div>
              <div class="v2-field">
                <label>出征主力兵种</label>
                <div class="v2-chip-grid">
                  ${Object.values(TROOP_TYPES).map((t) => `
                    <button type="button" class="v2-chip ${dispatchDraft.troopType === t.id ? "active" : ""}" data-draft-troop="${t.id}" title="${esc(t.detail)}">${t.icon} ${esc(t.name)}</button>`).join("")}
                </div>
              </div>
              <div class="v2-field">
                <label><span>出动兵力</span><strong id="dispatch-troops-val">${dispatchDraft.troops.toLocaleString()} 人</strong></label>
                <input type="range" id="dispatch-troops" min="${MIN_DISPATCH_TROOPS}" max="${Math.max(MIN_DISPATCH_TROOPS, draftInfo.maxSend)}" step="50" value="${dispatchDraft.troops}" ${draftInfo.maxSend < MIN_DISPATCH_TROOPS ? "disabled" : ""}>
                <div class="v2-chip-grid">
                  <button type="button" class="v2-chip" data-troop-pct="0.5">50%</button>
                  <button type="button" class="v2-chip" data-troop-pct="0.75">75%</button>
                  <button type="button" class="v2-chip" data-troop-pct="1">100%</button>
                </div>
              </div>
              <div class="v2-field">
                <label>行军战阵</label>
                <div class="v2-chip-grid">
                  ${Object.values(FORMATIONS_V2).map((fm) => `
                    <button type="button" class="v2-chip ${dispatchDraft.formation === fm.id ? "active" : ""}" data-draft-form="${fm.id}" title="${esc(fm.summary)}">${fm.icon} ${esc(fm.name)}</button>`).join("")}
                </div>
                <p class="v2-muted">${esc(selectedForm.summary)}</p>
              </div>
              <div class="v2-field">
                <label>临城默认围攻方略</label>
                <div class="v2-chip-grid">
                  ${Object.values(SIEGE_STANCES).map((st) => `
                    <button type="button" class="v2-chip ${dispatchDraft.siegeStance === st.id ? "active" : ""}" data-draft-stance="${st.id}" title="${esc(st.summary)}">${st.icon} ${esc(st.name)}</button>`).join("")}
                </div>
              </div>
              ${fc ? (fc.ok ? `
                <div class="v2-forecast-line ${fc.counter.relation}">
                  🛣️ 约 <strong>${fc.dekads} 旬</strong> 抵达 · 耗粮 <strong id="dispatch-grain-val">${fc.grainCost} 石</strong> · ${TERRAIN_LABELS[fc.terrain]}
                  ${fc.counter.label ? `<br>⚔️ ${esc(fc.counter.label)}` : ""}
                </div>` : `<div class="v2-forecast-line countered">${esc(fc.reason)}</div>`) : ""}
              <button type="button" class="v2-btn secondary" id="btn-dispatch" ${canSend && fc?.ok ? "" : "disabled"}>
                ${fc?.isFriendlyDest ? "🛡️ 手动誓师驰援" : "⚔️ 手动誓师出征"}
              </button>
            </div>
          </details>
        </div>

        <div class="v2-card">
          <div class="v2-card-head"><h3>🛡️ 整编 · 设伏 · 临机驰援</h3></div>
          <div class="v2-field">
            <label>驻军常备兵种整编${citySpec?.costMult ? "（本城特产享折扣）" : ""}</label>
            <div class="v2-chip-grid">
              ${Object.values(TROOP_TYPES).map((t) => {
                const cost = citySpec?.troopBoost === t.id ? Math.max(4, Math.round(t.reequipCost * citySpec.costMult)) : t.reequipCost;
                return `<button type="button" class="v2-chip ${city.troopType === t.id ? "active" : ""}" data-city-troop="${t.id}" title="${esc(t.detail)}">${t.icon}${esc(t.name)}(${cost}钱)</button>`;
              }).join("")}
            </div>
          </div>
          <div class="v2-field">
            <label>城外伏兵与拒马工事（持续 12 旬）</label>
            <div class="v2-chip-grid">
              ${Object.values(DEFENSE_TRAPS).map((tr) => `
                <button type="button" class="v2-chip ${city.trap?.id === tr.id ? "active" : ""}" data-city-trap="${tr.id}" title="${esc(tr.summary)}">${tr.icon} ${esc(tr.name)} (${tr.cost}钱)</button>`).join("")}
            </div>
          </div>
          ${!isBesieged ? `<button type="button" class="v2-btn secondary" id="btn-emergency-relief">🎺 从邻近腹地调拨援军到此</button>` : ""}
        </div>

        <div class="v2-card">
          <div class="v2-card-head"><h3>🚧 邻接官道与关隘工事</h3></div>
          <p class="v2-muted">点击任意官道即可修筑「关隘寨堡」「连弩箭楼」「前哨粮寨」或「江防水寨」。</p>
          <div class="v2-chip-grid">
            ${cMeta.links.map((nb) => {
              const eK = edgeKey(cityKey, nb);
              const ft = state.forts?.[eK];
              const pName = edgeDisplayName(world, cityKey, nb);
              const ftSpec = ft ? FORT_CATALOG[ft.kind] : null;
              return `<button type="button" class="v2-chip ${ft ? "active" : ""}" data-open-edge="${esc(cityKey)}|${esc(nb)}">${ftSpec ? ftSpec.icon : "⚒️"} ${esc(pName)}</button>`;
            }).join("")}
          </div>
        </div>`;

      const otherPlayerCities = Object.values(state.cities).filter((c) => c.owner === state.player && c.key !== cityKey);
      const curSupplyTarget = state.supplyLinks?.[cityKey] || "";
      html += `
        <div class="v2-card">
          <div class="v2-card-head"><h3>🚚 腹地后勤自动输血</h3></div>
          <p class="v2-muted">设定后，每逢月初且本城驻军充沛（&ge;1650）时将自动派出辎重偏将护送兵员驰援目标前线。</p>
          ${otherPlayerCities.length ? `
            <div style="display:flex;gap:0.4rem">
              <select class="v2-select" id="supply-front-target">
                ${otherPlayerCities.map((oc) => `<option value="${esc(oc.key)}" ${curSupplyTarget === oc.key ? "selected" : ""}>${esc(cityNameV2(world, oc.key))}（${oc.troops}人）</option>`).join("")}
              </select>
              <button type="button" class="v2-btn secondary" id="btn-supply-link">设定</button>
              ${curSupplyTarget ? `<button type="button" class="v2-btn quiet" id="btn-supply-clear">解除</button>` : ""}
            </div>` : `<p class="v2-muted">尚无其余己方城池可联结补给线。</p>`}
        </div>`;

      const idlePool = Object.values(state.officers).filter((o) => o.faction === state.player && !o.armyId && !o.capturedBy && !o.transferringTo);
      const idleLocal = idlePool.filter((o) => o.city === cityKey);
      const availableCorps = state.corps || [];
      html += `
        <div class="v2-card">
          <div class="v2-card-head"><h3>📜 城池官署任免 · 调防 · 输送军团</h3></div>
          <div class="v2-field">
            <label>太守（加成月度钱粮/征兵）</label>
            <select class="v2-select" id="city-set-gov">
              <option value="">-- 虚位 --</option>
              ${idlePool.slice().sort((a, b) => b.governance - a.governance).map((o) => `<option value="${esc(o.key)}" ${city.governor === o.key ? "selected" : ""}>${esc(o.name)}（政${o.governance} 统${o.command}）</option>`).join("")}
            </select>
          </div>
          <div class="v2-field">
            <label>守将（加成守城与野战迎击）</label>
            <select class="v2-select" id="city-set-cmd">
              <option value="">-- 虚位 --</option>
              ${idlePool.slice().sort((a, b) => b.command - a.command).map((o) => `<option value="${esc(o.key)}" ${city.commander === o.key ? "selected" : ""}>${esc(o.name)}（统${o.command} 武${o.might}）</option>`).join("")}
            </select>
          </div>
          ${idleLocal.length && availableCorps.length ? `
            <div class="v2-field" style="padding-top:0.35rem;border-top:1px solid rgba(255,255,255,0.06)">
              <label>🚀 直接输送本城将领给委任军团</label>
              <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:0.32rem">
                <select class="v2-select" id="city-send-off">
                  ${idleLocal.map((o) => `<option value="${esc(o.key)}">${esc(o.name)}</option>`).join("")}
                </select>
                <select class="v2-select" id="city-send-corps">
                  ${availableCorps.map((co) => `<option value="${esc(co.id)}">拨入【${esc(co.name)}】</option>`).join("")}
                </select>
                <button type="button" class="v2-btn secondary" id="btn-city-send-corps">输送</button>
              </div>
            </div>` : ""}
          ${idleLocal.length && otherPlayerCities.length ? `
            <div class="v2-field" style="padding-top:0.35rem;border-top:1px solid rgba(255,255,255,0.06)">
              <label>将领驿传快速调防（1~2 旬直达前线）</label>
              <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:0.32rem">
                <select class="v2-select" id="transfer-off-pick">
                  ${idleLocal.map((o) => `<option value="${esc(o.key)}">${esc(o.name)}</option>`).join("")}
                </select>
                <select class="v2-select" id="transfer-dest-pick">
                  ${otherPlayerCities.map((c) => `<option value="${esc(c.key)}">调往 ${esc(cityNameV2(world, c.key))}</option>`).join("")}
                </select>
                <button type="button" class="v2-btn quiet" id="btn-city-transfer">调防</button>
              </div>
            </div>` : ""}
        </div>`;
    } else {
      const playerLaunchPoints = Object.values(state.cities)
        .filter((c) => c.owner === state.player && c.troops >= MIN_DISPATCH_TROOPS + MIN_GARRISON_LEAVE && availableOfficersInCity(state, c.key, state.player).length > 0)
        .sort((a, b) => Number(cMeta.links.includes(b.key)) - Number(cMeta.links.includes(a.key)) || b.troops - a.troops);

      html += `
        <div class="v2-card">
          <div class="v2-card-head"><h3>🧭 敌情研判与进剿捷径</h3></div>
          <p class="v2-muted">守备兵种为「${spec.icon} ${esc(spec.name)}」，建议遣「${spec.counteredBy ? TROOP_TYPES[spec.counteredBy].name : "攻城械"}」或攻城器械压制；若城防深厚可先长围绝其余粮（${city.foodReserve}%）。</p>
          ${playerLaunchPoints.length ? `
            <div class="v2-field">
              <label>自哪座己城发兵直指「${esc(cMeta.name)}」</label>
              <div style="display:flex;gap:0.4rem">
                <select class="v2-select" id="enemy-launch-from">
                  ${playerLaunchPoints.slice(0, 10).map((pc) => `<option value="${esc(pc.key)}">${esc(cityNameV2(world, pc.key))}（${pc.troops}人${cMeta.links.includes(pc.key) ? " · 直连" : ""}）</option>`).join("")}
                </select>
                <button type="button" class="v2-btn primary" id="btn-jump-attack">筹备发兵</button>
              </div>
            </div>` : `<p class="v2-muted">暂无兵将齐备的己城可直接进发。</p>`}
          <button type="button" class="v2-btn quiet" id="btn-open-diplo">前往朝堂与「${esc(ownerName)}」外交交涉</button>
        </div>`;

      if (isHostileV2(state, state.player, city.owner)) {
        if (coordDraft.target !== cityKey) {
          coordDraft.target = cityKey;
          coordDraft.origins = playerLaunchPoints.slice(0, 2).map((c) => c.key);
        } else {
          coordDraft.origins = coordDraft.origins.filter((k) => playerLaunchPoints.some((c) => c.key === k));
          if (!coordDraft.origins.length && playerLaunchPoints.length) {
            coordDraft.origins = playerLaunchPoints.slice(0, 2).map((c) => c.key);
          }
        }
        const coordPlan = playerLaunchPoints.length >= 2 ? planCoordinatedAttack(world, state, {
          targetCity: cityKey,
          originKeys: coordDraft.origins,
          formation: coordDraft.formation,
          syncArrival: coordDraft.sync,
        }) : null;
        if (playerLaunchPoints.length >= 2) {
          html += `
            <div class="v2-card">
              <div class="v2-card-head"><h3>🎺 多城一键协同合围</h3></div>
              <div class="v2-chip-grid">
                ${playerLaunchPoints.slice(0, 5).map((pc) => {
                  const checked = coordDraft.origins.includes(pc.key);
                  return `<button type="button" class="v2-chip ${checked ? "active" : ""}" data-coord-origin="${esc(pc.key)}">${checked ? "☑" : "☐"} ${esc(cityNameV2(world, pc.key))}</button>`;
                }).join("")}
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem">
                <label style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.78rem;color:var(--ink-muted)">
                  <input type="checkbox" id="coord-sync" ${coordDraft.sync ? "checked" : ""}> 同旬齐至（快军原地候发）
                </label>
                <select class="v2-select" id="coord-form" style="width:auto;padding:0.28rem 1.8rem 0.28rem 0.5rem;font-size:0.76rem">
                  ${Object.values(FORMATIONS_V2).map((fm) => `<option value="${fm.id}" ${coordDraft.formation === fm.id ? "selected" : ""}>${fm.icon} ${esc(fm.name)}</option>`).join("")}
                </select>
              </div>
              ${coordPlan?.ok ? `
                <div class="v2-forecast-line">
                  共调 <strong>${coordPlan.columns.length} 路 · ${coordPlan.totalTroops.toLocaleString()} 人</strong> · 约 <strong>${coordPlan.maxDekads} 旬</strong> 齐抵（耗粮 ${coordPlan.totalGrain} 石）
                </div>` : `<p class="v2-muted">${esc(coordPlan?.reason || "请至少勾选 1 座出发城池")}</p>`}
              <button type="button" class="v2-btn primary" id="btn-coord-launch" ${coordPlan?.ok ? "" : "disabled"}>🎺 一键多路同步进军</button>
            </div>`;
        }

        const nearRiver = cMeta.links.some((nb) => roadTerrain(cityKey, nb) === "river");
        const cdFlood = stratagemCooldownLeft(state, state.player, "flood_attack");
        const stationedEnemies = Object.values(state.officers).filter((o) => o.city === cityKey && o.faction === city.owner && !o.armyId && !o.capturedBy);
        html += `
          <div class="v2-card">
            <div class="v2-card-head"><h3>🕵️ 奇计破城与细作离间</h3></div>
            ${nearRiver ? `<button type="button" class="v2-btn secondary" id="btn-city-flood" ${cdFlood ? "disabled" : ""}>🌊 决水淹城（${cdFlood ? `冷${cdFlood}旬` : "20钱"}）</button>` : `<p class="v2-muted">此城不临大江渡口，不可用决水计；可派细作离间守臣策反。</p>`}
            ${stationedEnemies.length ? stationedEnemies.map((eo) => {
              const isRuler = eo.name === state.factions[eo.faction]?.name;
              return `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:0.35rem;padding-top:0.3rem;border-top:1px solid rgba(255,255,255,0.06)">
                  <span style="font-size:0.78rem">${esc(eo.name)} · 忠 ${eo.loyalty}${isRuler ? " (主)" : ""}</span>
                  <div style="display:flex;gap:0.25rem">
                    <button type="button" class="v2-chip" data-sow="${esc(eo.key)}">🕵️ 离间(12钱)</button>
                    ${!isRuler ? `<button type="button" class="v2-chip" data-bribe="${esc(eo.key)}" ${eo.loyalty >= 75 ? "disabled" : ""} title="敌将忠义降至75以下即可重金策反">💰 策反(30钱)</button>` : ""}
                  </div>
                </div>`;
            }).join("") : `<p class="v2-muted">城中暂无驻守敌将。</p>`}
          </div>`;
      }
    }

    preserveScroll(inspectorBody, () => {
      inspectorBody.innerHTML = html;
    });

    inspectorBody.querySelectorAll("[data-recruit-hero]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyCommand((s) => recruitWanderingOfficer(world, s, btn.dataset.recruitHero));
      });
    });
    $("btn-supply-link")?.addEventListener("click", () => {
      const fKey = $("supply-front-target")?.value;
      if (fKey) applyCommand((s) => setSupplyLink(world, s, cityKey, fKey));
    });
    $("btn-supply-clear")?.addEventListener("click", () => {
      applyCommand((s) => clearSupplyLink(s, cityKey), `已解除${cMeta.name}自动输血补给线`);
    });
    $("btn-city-transfer")?.addEventListener("click", () => {
      const offK = $("transfer-off-pick")?.value;
      const toK = $("transfer-dest-pick")?.value;
      if (offK && toK) applyCommand((s) => transferOfficer(world, s, offK, toK));
    });
    inspectorBody.querySelectorAll("[data-coord-origin]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.coordOrigin;
        if (coordDraft.origins.includes(k)) coordDraft.origins = coordDraft.origins.filter((x) => x !== k);
        else coordDraft.origins = [...coordDraft.origins, k].slice(0, 4);
        renderInspector(getState());
      });
    });
    $("coord-sync")?.addEventListener("change", (ev) => {
      coordDraft.sync = ev.target.checked;
      renderInspector(getState());
    });
    $("coord-form")?.addEventListener("change", (ev) => {
      coordDraft.formation = ev.target.value;
      renderInspector(getState());
    });
    $("btn-coord-launch")?.addEventListener("click", () => {
      applyCommand((s) => launchCoordinatedAttack(world, s, {
        targetCity: cityKey,
        originKeys: coordDraft.origins,
        formation: coordDraft.formation,
        syncArrival: coordDraft.sync,
      }));
    });

    inspectorBody.querySelectorAll("[data-open-edge]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [aK, bK] = btn.dataset.openEdge.split("|");
        selectEdge(edgeKey(aK, bK), aK, bK);
      });
    });
    $("btn-city-flood")?.addEventListener("click", () => {
      applyCommand((s) => castStratagem(world, s, { kind: "flood_attack", targetType: "city", targetId: cityKey }));
    });
    inspectorBody.querySelectorAll("[data-sow]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyCommand((s) => sowDiscord(world, s, cityKey, btn.dataset.sow));
      });
    });
    inspectorBody.querySelectorAll("[data-bribe]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyCommand((s) => bribeDefection(world, s, cityKey, btn.dataset.bribe));
      });
    });

    // Bind events inside city inspector
    inspectorBody.querySelectorAll("[data-siege-def]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.siegeDef;
        applyCommand((s) => setCitySiegeDefense(s, cityKey, mode), `${cMeta.name}守军战法已切换为「${SIEGE_DEFENSE_MODES[mode].name}」`);
      });
    });

    $("btn-emergency-relief")?.addEventListener("click", () => {
      applyCommand((s) => dispatchEmergencyReinforce(world, s, cityKey), `已自后方急调大军驰援${cMeta.name}！`);
    });

    $("btn-focus-own-besieger")?.addEventListener("click", () => {
      const besieger = (state.sieges[cityKey]?.attackerArmyIds || [])
        .map((id) => state.armies.find((a) => a.id === id))
        .find((a) => a && a.faction === state.player);
      if (besieger) selectArmy(besieger.id);
    });

    $("dispatch-to")?.addEventListener("change", (ev) => {
      dispatchDraft.to = ev.target.value;
      renderInspector(getState());
    });
    $("dispatch-officer")?.addEventListener("change", (ev) => {
      dispatchDraft.officer = ev.target.value;
      if (dispatchDraft.deputy === dispatchDraft.officer) dispatchDraft.deputy = null;
      renderInspector(getState());
    });
    $("dispatch-deputy")?.addEventListener("change", (ev) => {
      dispatchDraft.deputy = ev.target.value || null;
      renderInspector(getState());
    });
    inspectorBody.querySelectorAll("[data-draft-troop]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dispatchDraft.troopType = btn.dataset.draftTroop;
        renderInspector(getState());
      });
    });
    inspectorBody.querySelectorAll("[data-draft-form]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dispatchDraft.formation = btn.dataset.draftForm;
        renderInspector(getState());
      });
    });
    inspectorBody.querySelectorAll("[data-draft-stance]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dispatchDraft.siegeStance = btn.dataset.draftStance;
        renderInspector(getState());
      });
    });
    inspectorBody.querySelectorAll("[data-troop-pct]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pct = Number(btn.dataset.troopPct);
        const maxS = Math.max(MIN_DISPATCH_TROOPS, (state.cities[cityKey]?.troops ?? 0) - MIN_GARRISON_LEAVE);
        dispatchDraft.troops = Math.max(MIN_DISPATCH_TROOPS, Math.min(maxS, Math.round((maxS * pct) / 50) * 50));
        renderInspector(getState());
      });
    });
    $("dispatch-troops")?.addEventListener("input", (ev) => {
      dispatchDraft.troops = Number(ev.target.value);
      const valNode = $("dispatch-troops-val");
      if (valNode) valNode.textContent = `${dispatchDraft.troops.toLocaleString()} 人`;
      const grainNode = $("dispatch-grain-val");
      if (grainNode) grainNode.textContent = `${Math.max(4, Math.ceil(dispatchDraft.troops / 220) * 2)} 石`;
    });
    $("dispatch-troops")?.addEventListener("change", () => renderInspector(getState()));

    $("btn-dispatch")?.addEventListener("click", () => {
      applyCommand((s) => dispatchArmy(world, s, {
        from: cityKey,
        to: dispatchDraft.to,
        officer: dispatchDraft.officer,
        deputy: dispatchDraft.deputy || null,
        formation: dispatchDraft.formation || "heyi",
        troops: dispatchDraft.troops,
        troopType: dispatchDraft.troopType,
        siegeStance: dispatchDraft.siegeStance,
      }), `${cityNameV2(world, dispatchDraft.to)}征伐大军已沿官道出发！`);
    });

    inspectorBody.querySelectorAll("[data-upgrade-building]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const trackId = btn.dataset.upgradeBuilding;
        applyCommand((s) => upgradeCityBuilding(world, s, cityKey, trackId));
      });
    });
    inspectorBody.querySelectorAll("[data-city-policy]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pid = btn.dataset.cityPolicy;
        applyCommand((s) => setCityPolicy(s, cityKey, pid), `${cMeta.name}治城方针已定为「${CITY_POLICIES[pid].name}」`);
      });
    });
    inspectorBody.querySelectorAll("[data-city-troop]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tid = btn.dataset.cityTroop;
        applyCommand((s) => setCityTroopType(s, cityKey, tid), `${cMeta.name}驻军已整编为「${TROOP_TYPES[tid].name}」`);
      });
    });
    inspectorBody.querySelectorAll("[data-city-trap]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tr = btn.dataset.cityTrap;
        applyCommand((s) => layCityTrap(s, cityKey, tr), `${cMeta.name}城外已暗设「${DEFENSE_TRAPS[tr].name}」`);
      });
    });

    $("city-assign-corps")?.addEventListener("change", (ev) => {
      applyCommand((s) => assignCityToCorps(world, s, cityKey, ev.target.value || null));
    });
    $("btn-city-recruit")?.addEventListener("click", () => {
      applyCommand((s) => recruitCityTroops(world, s, cityKey));
    });
    inspectorBody.querySelectorAll("[data-smart-pct]").forEach((btn) => {
      btn.addEventListener("click", () => {
        smartRatio = Number(btn.dataset.smartPct);
        renderInspector(getState());
      });
    });
    $("btn-smart-dispatch")?.addEventListener("click", () => {
      applyCommand((s) => smartAutoDispatch(world, s, {
        from: cityKey,
        to: dispatchDraft.to,
        troopRatio: smartRatio,
      }), `${cityNameV2(world, dispatchDraft.to)}征伐大军已由委任将领带队出发！`);
    });
    $("advanced-dispatch-details")?.addEventListener("toggle", (ev) => {
      advancedDispatchOpen = ev.target.open;
    });
    $("btn-city-send-corps")?.addEventListener("click", () => {
      const offK = $("city-send-off")?.value;
      const cid = $("city-send-corps")?.value;
      if (offK && cid) applyCommand((s) => sendOfficerToCorps(world, s, offK, cid));
    });

    $("city-set-gov")?.addEventListener("change", (ev) => {
      applyCommand((s) => appointOfficer(s, cityKey, "governor", ev.target.value || null), "已调整太守任命");
    });
    $("city-set-cmd")?.addEventListener("change", (ev) => {
      applyCommand((s) => appointOfficer(s, cityKey, "commander", ev.target.value || null), "已调整守将任命");
    });

    $("btn-jump-attack")?.addEventListener("click", () => {
      const from = $("enemy-launch-from")?.value;
      if (from) {
        selectedArmyId = null;
        selectedCity = from;
        dispatchDraft.from = from;
        dispatchDraft.to = cityKey;
        const fcCity = state.cities[from];
        dispatchDraft.troopType = fcCity.troopType;
        dispatchDraft.troops = Math.min(fcCity.troops - MIN_GARRISON_LEAVE, Math.max(MIN_DISPATCH_TROOPS, Math.round((fcCity.troops - MIN_GARRISON_LEAVE) * 0.7)));
        renderAll();
      }
    });
    $("btn-open-diplo")?.addEventListener("click", () => openCourtDialog("diplomacy"));
  }

  function renderInspector(state) {
    if (selectedEdge) {
      renderEdgeInspector(state, selectedEdge);
      return;
    }
    if (selectedArmyId) {
      const army = (state.armies || []).find((a) => a.id === selectedArmyId && a.troops > 0);
      if (army) {
        renderArmyInspector(state, army);
        return;
      }
      selectedArmyId = null;
    }
    if (!selectedCity || !state.cities[selectedCity]) {
      selectedCity = Object.values(state.cities).find((c) => c.owner === state.player)?.key || world.cities[0].key;
    }
    renderCityInspector(state, selectedCity);
  }

  function renderCabinetDialog() {
    const dialog = $("cabinet-dialog");
    if (!dialog?.open) return;
    const state = getState();
    const body = $("cabinet-body");
    const econ = estimateFactionEconomy(state, state.player);
    const fac = state.factions[state.player];
    const proposals = buildCabinetBriefings(world, state);
    const autoGov = state.autoGovernance || {};
    const curTax = fac?.taxLevel || "normal";

    const signT = econ.netTreasury >= 0 ? `+${econ.netTreasury}` : `${econ.netTreasury}`;
    const signG = econ.netGrain >= 0 ? `+${econ.netGrain}` : `${econ.netGrain}`;

    preserveScroll(body, () => {
      body.innerHTML = `
        <div class="v2-econ-strip">
          <div class="v2-econ-box">
            <small>月度净财政 (税${econ.grossTreasury} - 饷${econ.upkeepTreasury} - 腐${econ.corruptionLoss})</small>
            <strong style="color:${econ.netTreasury >= 0 ? "#8de6ae" : "#f28e7d"}">${signT} 钱/月</strong>
          </div>
          <div class="v2-econ-box">
            <small>月度净军粮 (产${econ.grossGrain} - 耗${econ.upkeepGrain})</small>
            <strong style="color:${econ.netGrain >= 0 ? "#8de6ae" : "#f28e7d"}">${signG} 石/月</strong>
          </div>
          <div class="v2-econ-box">
            <small>全境平均治安 / 腐败</small>
            <strong>${econ.avgOrder}/100 · ${Math.round(econ.corruptionRate * 100)}%</strong>
          </div>
          <div class="v2-econ-box">
            <small>国家威望 / 总繁荣</small>
            <strong>${econ.prestige} · ${econ.totalDev}级</strong>
          </div>
        </div>

        <div class="v2-card">
          <div class="v2-card-head">
            <h3>⚖️ 国家税赋 · 理政托管 · 推演节奏</h3>
            <button type="button" class="v2-btn primary" id="btn-approve-all" ${proposals.length ? "" : "disabled"}>✨ 一键全批推荐项 (${proposals.length})</button>
          </div>
          <div class="v2-chip-grid">
            ${Object.values(TAX_LEVELS_V4).map((t) => `
              <button type="button" class="v2-chip ${curTax === t.id ? "active" : ""}" data-cab-tax="${esc(t.id)}" title="${esc(t.summary)}">${t.icon} ${esc(t.name)}</button>`).join("")}
          </div>
          <p class="v2-muted" style="font-size:0.74rem">${esc(TAX_LEVELS_V4[curTax].summary)}</p>
          <div class="v2-auto-bar">
            <span class="v2-muted" style="font-size:0.74rem">月末自动理政：</span>
            <button type="button" class="v2-auto-toggle" data-auto-gov="autoEconomy" aria-pressed="${Boolean(autoGov.autoEconomy)}">🌾 自理农商基建</button>
            <button type="button" class="v2-auto-toggle" data-auto-gov="autoPersonnel" aria-pressed="${Boolean(autoGov.autoPersonnel)}">📜 自理礼贤招降</button>
            <button type="button" class="v2-auto-toggle" data-auto-gov="autoDefense" aria-pressed="${Boolean(autoGov.autoDefense)}">⚔️ 自理危城急援</button>
          </div>
          <div class="v2-auto-bar">
            <span class="v2-muted" style="font-size:0.74rem">推演暂停时机：</span>
            ${Object.values(AUTO_PAUSE_MODES).map((pm) => `
              <button type="button" class="v2-chip ${(state.autoPauseMode || "major") === pm.id ? "active" : ""}" data-pause-mode="${esc(pm.id)}" title="${esc(pm.summary)}">${esc(pm.name)}</button>`).join("")}
          </div>
          <div class="v2-recruit-row">
            <span class="v2-muted" style="font-size:0.74rem">已有 ${(state.corps || []).length} 支委任军团 · ${Object.keys(state.governors || {}).length} 位地方州牧</span>
            <button type="button" class="v2-btn secondary" id="btn-open-delegation-from-cabinet">🚩 委任军团与地方州牧</button>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:0.55rem">
          ${proposals.length ? proposals.map((p) => `
            <div class="v2-proposal-card ${p.urgent ? "urgent" : ""}">
              <div class="v2-row-top">
                <strong>${esc(p.title)}</strong>
                <span class="v2-badge">${esc(p.ministerName)}</span>
              </div>
              <div class="v2-muted">${esc(p.summary)}</div>
              <div class="v2-proposal-foot">
                <span style="font-size:0.74rem;color:#e7c982">✨ ${esc(p.effectText)} · 💰 ${esc(p.costText)}</span>
                <div style="display:flex;gap:0.35rem">
                  <button type="button" class="v2-btn quiet" data-cab-dismiss="${esc(p.id)}">留中</button>
                  <button type="button" class="v2-btn primary" data-cab-approve="${esc(p.id)}">朱批准奏</button>
                </div>
              </div>
            </div>`).join("") : `<div class="v2-card"><p class="v2-muted" style="margin:0">✅ 本月军机奏折已尽数批复，无复积案。主公可安心推进旬日（下月初重臣再呈新折）。</p></div>`}
        </div>

        ${(() => {
          const activeBuilds = Object.values(state.cities).filter((c) => c.owner === state.player && c.construction);
          if (!activeBuilds.length) return "";
          return `
            <div class="v2-card">
              <div class="v2-card-head">
                <h3>🔨 正在施工中的郡国工程 (${activeBuilds.length})</h3>
                <span class="v2-badge">按旬推进</span>
              </div>
              <div class="v2-chip-grid">
                ${activeBuilds.map((c) => {
                  const con = c.construction;
                  const bDef = CITY_BUILDINGS_V4[con.trackId];
                  return `<span class="v2-dev-pip">🏛️ ${esc(cityNameV2(world, c.key))} · ${bDef?.icon || ""}${esc(bDef?.name || "")} Lv.${con.targetLevel}（余${con.remainingDekads}/${con.totalDekads}旬）</span>`;
                }).join("")}
              </div>
            </div>`;
        })()}`;
    });

    $("btn-approve-all")?.addEventListener("click", () => {
      const ok = applyCommand((s) => approveAllCabinet(world, s));
      if (ok) renderCabinetDialog();
    });
    body.querySelectorAll("[data-cab-tax]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ok = applyCommand((s) => setTaxLevel(s, btn.dataset.cabTax));
        if (ok) renderCabinetDialog();
      });
    });
    body.querySelectorAll("[data-auto-gov]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.autoGov;
        const nextVal = !(getState().autoGovernance?.[key]);
        const ok = applyCommand((s) => setAutoGovernance(s, key, nextVal));
        if (ok) renderCabinetDialog();
      });
    });
    body.querySelectorAll("[data-pause-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.pauseMode;
        const ok = applyCommand((s) => setAutoPauseMode(s, mode), `推演暂停策略已设为「${AUTO_PAUSE_MODES[mode]?.name || mode}」`);
        if (ok) renderCabinetDialog();
      });
    });
    $("btn-open-delegation-from-cabinet")?.addEventListener("click", () => {
      closeDialogSafe(dialog);
      openCourtDialog("delegation");
    });
    body.querySelectorAll("[data-cab-approve]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ok = applyCommand((s) => approveCabinetProposal(world, s, btn.dataset.cabApprove));
        if (ok) renderCabinetDialog();
      });
    });
    body.querySelectorAll("[data-cab-dismiss]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ok = applyCommand((s) => dismissCabinetProposal(s, btn.dataset.cabDismiss), "已暂缓该件奏折（下月初将重议）");
        if (ok) renderCabinetDialog();
      });
    });
  }

  function openCabinetDialog() {
    const dialog = $("cabinet-dialog");
    openDialogSafe(dialog);
    renderCabinetDialog();
  }

  function renderCourtDialog() {
    const dialog = $("court-dialog");
    if (!dialog?.open) return;
    const state = getState();
    const body = $("court-body");

    if (courtTab === "officers" || courtTab === "armies" || courtTab === "captives") courtTab = "roster";
    if (courtTab === "decrees") courtTab = "offices";
    if (courtTab === "trends") courtTab = "chronicle";

    dialog.querySelectorAll(".v2-tab").forEach((t) => {
      t.setAttribute("aria-selected", String(t.dataset.tab === courtTab));
    });

    const renderBody = (html) => preserveScroll(body, () => { body.innerHTML = html; });

    if (courtTab === "offices") {
      const rp = rankProgressForFaction(state, state.player);
      const bonuses = computeCourtBonuses(state, state.player);
      const treasury = state.factions[state.player]?.treasury ?? 0;
      const enactedList = state.decrees?.[state.player] || [];
      const curP = rp.prestige ?? 0;
      const nextP = rp.nextPrestigeRank?.minPrestige;
      const rankPct = nextP ? Math.min(100, Math.round((curP / nextP) * 100)) : 100;
      const ownOfficers = Object.values(state.officers)
        .filter((o) => o.faction === state.player && !o.capturedBy)
        .sort((a, b) => (b.governance + b.command) - (a.governance + a.command));

      const holdsEmperor = Boolean(state.emperorCity && state.cities[state.emperorCity]?.owner === state.player);
      const holdsSeal = state.sealFaction === state.player;
      const activeRivals = Object.values(state.factions).filter(
        (f) => f.key !== state.player && Object.values(state.cities).some((c) => c.owner === f.key),
      );
      if (!edictTarget || !activeRivals.some((f) => f.key === edictTarget)) {
        edictTarget = activeRivals[0]?.key || null;
      }

      const officesHtml = `
        <div class="v2-card">
          <div class="v2-card-head">
            <h3>👑 威望爵位：${esc(rp.prestigeRank?.title || rp.current.title)}（威望 ${curP} · 领 ${rp.cityCount}/44 城）</h3>
            <span class="v2-badge">已行国策 ${enactedList.length} / ${Object.keys(NATIONAL_DECREES_V2).length}</span>
          </div>
          <div class="v2-bar wall"><i style="width:${rankPct}%"></i></div>
          <p class="v2-muted">
            ${rp.nextPrestigeRank ? `距下一爵位「${esc(rp.nextPrestigeRank.title)}」需威望 ${rp.nextPrestigeRank.minPrestige}（扩建农商、攻城拓土或奉迎天子皆增威望）。` : "威加海内，已登九五至尊威望！"}
            <br>中枢总光环：基建-${Math.round((1 - bonuses.buildDiscount) * 100)}% · 维持-${Math.round((1 - bonuses.upkeepDiscount) * 100)}% · 军力+${Math.round((bonuses.combatMult - 1) * 100)}% · 农+${Math.round((bonuses.grainMult - 1) * 100)}% · 商+${Math.round((bonuses.treasuryMult - 1) * 100)}%
          </p>
        </div>

        <div class="v2-card">
          <div class="v2-card-head"><h3>🏛️ 朝堂六卿中枢官职（随威望晋爵渐次开府）</h3></div>
          <div class="v2-office-grid">
            ${Object.values(COURT_OFFICES_V4).map((def) => {
              const unlocked = (rp.rankIndex ?? 0) >= def.minRankIdx;
              const holderKey = state.courtOffices?.[state.player]?.[def.id] || "";
              return `
                <div class="v2-office-card ${unlocked ? "" : "locked"}">
                  <div class="v2-row-top">
                    <strong>${def.icon} ${esc(def.name)}</strong>
                    <span class="v2-badge">${unlocked ? (holderKey ? "已拜官" : "虚位") : "未解锁"}</span>
                  </div>
                  <div class="v2-muted" style="font-size:0.74rem">${esc(def.auraSummary)}</div>
                  ${unlocked ? `
                    <select class="v2-select" data-appoint-office="${esc(def.id)}">
                      <option value="">-- 虚位以待 --</option>
                      ${ownOfficers.map((o) => `<option value="${esc(o.key)}" ${holderKey === o.key ? "selected" : ""}>${esc(o.name)}（政${o.governance} 统${o.command} 忠${o.loyalty}）</option>`).join("")}
                    </select>` : `<span class="v2-muted">须晋升至更高爵位方可开府拜官</span>`}
                </div>`;
            }).join("")}
          </div>
        </div>`;

      const emperorBanner = `
        <div class="v2-card ${(holdsEmperor || holdsSeal) ? "siege-alert" : ""}">
          <div class="v2-card-head">
            <h3>👑 汉帝天子诏书与传国玉玺</h3>
            <span class="v2-badge">${(holdsEmperor || holdsSeal) ? ((state.edictCooldown || 0) > 0 ? `冷却余 ${state.edictCooldown} 旬` : "✅ 可发天子诏") : "尚未奉迎"}</span>
          </div>
          <p class="v2-muted">
            汉帝所在：${state.emperorCity ? `「${esc(cityNameV2(world, state.emperorCity))}」（${esc(factionNameV2(world, state, state.cities[state.emperorCity]?.owner))}）` : "禅代已终"} ·
            传国玉玺：${state.sealFaction ? esc(factionNameV2(world, state, state.sealFaction)) : "散落民间"}
          </p>
          ${(holdsEmperor || holdsSeal) ? `
            ${activeRivals.length ? `
              <div class="v2-faction-pills">
                ${activeRivals.slice(0, 6).map((rf) => `
                  <button type="button" class="v2-faction-pill ${edictTarget === rf.key ? "selected" : ""}" data-edict-target="${esc(rf.key)}">
                    <i class="v2-fac-dot" style="background:${factionColor(rf.key)}"></i>${esc(rf.name)}
                  </button>`).join("")}
              </div>` : ""}
            <div style="display:flex;flex-wrap:wrap;gap:0.4rem">
              ${Object.values(EMPEROR_EDICTS_V3).map((ed) => {
                const blocked = (state.edictCooldown || 0) > 0 || treasury < ed.cost || (ed.requiresTarget && !edictTarget);
                return `<button type="button" class="v2-btn secondary" data-issue-edict="${esc(ed.id)}" ${blocked ? "disabled" : ""} title="${esc(ed.summary)}">${ed.icon} ${esc(ed.name)} (${ed.cost}钱)</button>`;
              }).join("")}
            </div>` : ""}
        </div>`;

      const decreesGrid = `
        <div class="v2-list-grid">${Object.values(NATIONAL_DECREES_V2).map((d) => {
          const done = hasDecree(state, state.player, d.id);
          const lockedCity = rp.cityCount < d.minCities;
          const lowGold = treasury < d.cost;
          return `
            <div class="v2-row-card">
              <div class="v2-row-top">
                <strong>${d.icon} ${esc(d.name)}</strong>
                <span class="v2-badge">${done ? "✅ 已颁行" : `需 ${d.minCities} 城 · ${d.cost} 钱`}</span>
              </div>
              <div class="v2-muted">${esc(d.summary)}</div>
              <div class="v2-row-actions">
                <button type="button" class="v2-btn ${done ? "quiet" : "primary"}" data-enact-decree="${esc(d.id)}" style="width:100%" ${(done || lockedCity || lowGold) ? "disabled" : ""}>
                  ${done ? "✅ 政令已传四方" : lockedCity ? `尚需占领至 ${d.minCities} 城` : lowGold ? `国库银两不足 (${d.cost}钱)` : `📜 颁布国策 (${d.cost}钱)`}
                </button>
              </div>
            </div>`;
        }).join("")}</div>`;

      renderBody(officesHtml + emperorBanner + decreesGrid);

      body.querySelectorAll("[data-appoint-office]").forEach((sel) => {
        sel.addEventListener("change", (ev) => {
          const ok = applyCommand((s) => appointCourtOffice(s, sel.dataset.appointOffice, ev.target.value || null));
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-edict-target]").forEach((btn) => {
        btn.addEventListener("click", () => { edictTarget = btn.dataset.edictTarget; renderCourtDialog(); });
      });
      body.querySelectorAll("[data-issue-edict]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ok = applyCommand((s) => issueImperialEdict(world, s, btn.dataset.issueEdict, edictTarget));
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-enact-decree]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.enactDecree;
          const ok = applyCommand((s) => enactDecree(world, s, id), `已颁布国家方略「${NATIONAL_DECREES_V2[id].name}」！`);
          if (ok) renderCourtDialog();
        });
      });
    } else if (courtTab === "delegation") {
      const corpsList = state.corps || [];
      const ownCities = Object.values(state.cities)
        .filter((c) => c.owner === state.player)
        .sort((a, b) => b.troops - a.troops);
      const assignedCitySet = new Set(corpsList.flatMap((c) => c.cities || []));
      const unassignedCities = ownCities.filter((c) => !assignedCitySet.has(c.key));
      const usedCommanders = new Set(corpsList.map((c) => c.commanderKey).filter(Boolean));
      const allOfficers = Object.values(state.officers)
        .filter((o) => o.faction === state.player && !o.capturedBy)
        .sort((a, b) => (b.command * 1.2 + b.might + b.governance * 0.4) - (a.command * 1.2 + a.might + a.governance * 0.4));
      const cmdCandidates = allOfficers.filter((o) => !usedCommanders.has(o.key));
      const enemyCities = Object.values(state.cities)
        .filter((c) => isHostileV2(state, state.player, c.owner))
        .sort((a, b) => a.troops - b.troops);
      const hostileFactions = Object.values(state.factions).filter(
        (f) => f.key !== state.player && isHostileV2(state, state.player, f.key)
          && Object.values(state.cities).some((c) => c.owner === f.key),
      );

      if (!corpsDraft.commanderKey || !cmdCandidates.some((o) => o.key === corpsDraft.commanderKey)) {
        corpsDraft.commanderKey = cmdCandidates[0]?.key || "";
      }
      corpsDraft.cityKeys = corpsDraft.cityKeys.filter((ck) => state.cities[ck]?.owner === state.player);
      if (!corpsDraft.cityKeys.length && ownCities.length) {
        corpsDraft.cityKeys = [unassignedCities[0]?.key || ownCities[0].key];
      }
      if (!corpsDraft.targetCity || !enemyCities.some((c) => c.key === corpsDraft.targetCity)) {
        corpsDraft.targetCity = enemyCities[0]?.key || "";
      }
      if (!corpsDraft.targetFaction || !hostileFactions.some((f) => f.key === corpsDraft.targetFaction)) {
        corpsDraft.targetFaction = hostileFactions[0]?.key || "";
      }
      if (!corpsDraft.supplyToCity || state.cities[corpsDraft.supplyToCity]?.owner !== state.player) {
        corpsDraft.supplyToCity = ownCities[0]?.key || "";
      }

      const corpsTargetSelect = (idAttr, dataAttr, missionId, curCity, curFac, curSup) => {
        if (missionId === "conquer_city") {
          return `<select class="v2-select" ${idAttr ? `id="${idAttr}"` : ""} ${dataAttr ? `${dataAttr}` : ""}>
            ${enemyCities.map((c) => `<option value="${esc(c.key)}" ${curCity === c.key ? "selected" : ""}>攻打 ${esc(cityNameV2(world, c.key))}（${esc(factionNameV2(world, state, c.owner))}·${c.troops}人）</option>`).join("")}
          </select>`;
        }
        if (missionId === "conquer_faction") {
          return `<select class="v2-select" ${idAttr ? `id="${idAttr}"` : ""} ${dataAttr ? `${dataAttr}` : ""}>
            ${hostileFactions.map((f) => `<option value="${esc(f.key)}" ${curFac === f.key ? "selected" : ""}>征讨「${esc(f.name)}」</option>`).join("")}
          </select>`;
        }
        if (missionId === "logistics") {
          return `<select class="v2-select" ${idAttr ? `id="${idAttr}"` : ""} ${dataAttr ? `${dataAttr}` : ""}>
            ${ownCities.map((c) => `<option value="${esc(c.key)}" ${curSup === c.key ? "selected" : ""}>输血「${esc(cityNameV2(world, c.key))}」（${c.troops}人）</option>`).join("")}
          </select>`;
        }
        return `<span class="v2-muted" style="font-size:0.75rem">自主固守防线与驰援受围城池</span>`;
      };

      const corpsCardsHtml = corpsList.length ? corpsList.map((co) => {
        const cmd = co.commanderKey ? state.officers[co.commanderKey] : null;
        const mSpec = CORPS_MISSIONS[co.mission] || CORPS_MISSIONS.defend;
        const roster = getOfficersInCorps(state, co.id);
        const coCitySet = new Set(co.cities || []);
        const totalTroops = (co.cities || []).reduce((s, ck) => s + (state.cities[ck]?.troops || 0), 0);
        const sendable = allOfficers.filter((o) => !o.armyId && !o.transferringTo && !coCitySet.has(o.city));
        return `
          <div class="v2-corps-card">
            <div class="v2-row-top">
              <strong>🚩 ${esc(co.name)} · 都督 ${esc(cmd?.name || "虚位")}${cmd ? `（统${cmd.command} 武${cmd.might}）` : ""}</strong>
              <div style="display:flex;gap:0.35rem;align-items:center">
                <span class="v2-badge">${mSpec.icon} 辖 ${(co.cities || []).length} 城 · ${totalTroops.toLocaleString()}兵</span>
                <button type="button" class="v2-btn quiet" data-disband-corps="${esc(co.id)}" style="padding:0.2rem 0.45rem;font-size:0.72rem">解散</button>
              </div>
            </div>
            <div class="v2-inline-form">
              <select class="v2-select" data-corps-mission="${esc(co.id)}">
                ${Object.values(CORPS_MISSIONS).map((m) => `<option value="${esc(m.id)}" ${co.mission === m.id ? "selected" : ""}>${m.icon} ${esc(m.name)}</option>`).join("")}
              </select>
              ${corpsTargetSelect("", `data-corps-target="${esc(co.id)}"`, co.mission, co.targetCity, co.targetFaction, co.supplyToCity)}
              <button type="button" class="v2-btn secondary" data-save-corps="${esc(co.id)}" style="padding:0.32rem 0.6rem">保存方针</button>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:0.3rem;align-items:center">
              <span class="v2-muted" style="font-size:0.72rem">辖区：</span>
              ${(co.cities || []).map((ck) => `
                <button type="button" class="v2-chip-remove" data-remove-corps-city="${esc(co.id)}:${esc(ck)}" title="点击移出并归主公直辖">
                  ${esc(cityNameV2(world, ck))} (${state.cities[ck]?.troops || 0}) ×
                </button>`).join("")}
            </div>
            ${unassignedCities.length ? `
              <div class="v2-inline-form">
                <select class="v2-select" data-add-corps-city-select="${esc(co.id)}">
                  ${unassignedCities.map((uc) => `<option value="${esc(uc.key)}">${esc(cityNameV2(world, uc.key))}（${uc.troops}人）</option>`).join("")}
                </select>
                <button type="button" class="v2-btn quiet" data-add-corps-city-btn="${esc(co.id)}">+ 划入辖区</button>
              </div>` : ""}
            <div style="display:flex;flex-wrap:wrap;gap:0.3rem;align-items:center">
              <span class="v2-muted" style="font-size:0.72rem">统辖武将 (${roster.all.length})：</span>
              ${roster.all.length ? roster.all.map((o) => o.armyId
                ? `<span class="v2-dev-pip">⚔️ ${esc(o.name)}·在途</span>`
                : `<button type="button" class="v2-chip-remove" data-recall-corps-off="${esc(o.key)}" title="调回主公直辖城池">${esc(o.name)}(统${o.command}) ↩召回</button>`).join("")
                : `<span class="v2-muted" style="font-size:0.72rem">暂无驻将，请从下方输送</span>`}
            </div>
            ${sendable.length ? `
              <div class="v2-inline-form">
                <select class="v2-select" data-send-corps-off-select="${esc(co.id)}">
                  ${sendable.map((o) => `<option value="${esc(o.key)}">${esc(o.name)}（统${o.command} 武${o.might} · 现于${esc(cityNameV2(world, o.city))}）</option>`).join("")}
                </select>
                <button type="button" class="v2-btn secondary" data-send-corps-off-btn="${esc(co.id)}">🚀 输送武将给军团</button>
              </div>` : ""}
          </div>`;
      }).join("") : `<p class="v2-muted">暂未设立任何委任军团。主公可组建前线军团拜将都督，自主攻略敌城或守御防线。</p>`;

      const createCorpsHtml = `
        <div class="v2-card">
          <div class="v2-card-head">
            <h3>➕ 组建新委任军团</h3>
            <span class="v2-badge">${unassignedCities.length} 座直辖待编城</span>
          </div>
          <div class="v2-inline-form">
            <input type="text" class="v2-input" id="new-corps-name" placeholder="军团名号（如：北伐军团，留空则自动命名）" value="${esc(corpsDraft.name)}">
            <select class="v2-select" id="new-corps-cmd">
              ${cmdCandidates.length ? cmdCandidates.map((o) => `<option value="${esc(o.key)}" ${corpsDraft.commanderKey === o.key ? "selected" : ""}>都督：${esc(o.name)}（统${o.command} 武${o.might}）</option>`).join("") : `<option value="">-- 无空闲都督 --</option>`}
            </select>
          </div>
          <div class="v2-inline-form">
            <select class="v2-select" id="new-corps-mission">
              ${Object.values(CORPS_MISSIONS).map((m) => `<option value="${esc(m.id)}" ${corpsDraft.mission === m.id ? "selected" : ""}>${m.icon} ${esc(m.name)}</option>`).join("")}
            </select>
            ${corpsTargetSelect("new-corps-target", "", corpsDraft.mission, corpsDraft.targetCity, corpsDraft.targetFaction, corpsDraft.supplyToCity)}
          </div>
          <p class="v2-muted" style="font-size:0.73rem">${esc(CORPS_MISSIONS[corpsDraft.mission]?.summary || "")}</p>
          <div class="v2-field">
            <label>勾选划归该军团的城池（已选 ${corpsDraft.cityKeys.length} 座）：</label>
            <div class="v2-chip-grid">
              ${ownCities.map((c) => {
                const active = corpsDraft.cityKeys.includes(c.key);
                const prevCorps = getCorpsForCity(state, c.key);
                return `<button type="button" class="v2-chip ${active ? "active" : ""}" data-new-corps-city="${esc(c.key)}">${active ? "☑" : "☐"} ${esc(cityNameV2(world, c.key))}${prevCorps ? `(${esc(prevCorps.name)})` : ""}</button>`;
              }).join("")}
            </div>
          </div>
          <button type="button" class="v2-btn primary" id="btn-create-corps" ${cmdCandidates.length && corpsDraft.cityKeys.length ? "" : "disabled"}>🚩 拜将授印 · 组建委任军团</button>
        </div>`;

      const regions = getPlayerRegions(world, state);
      const govOfficers = allOfficers.slice().sort((a, b) => (b.governance * 1.3 + b.intellect * 0.5) - (a.governance * 1.3 + a.intellect * 0.5));
      const regionsHtml = `
        <div class="v2-card">
          <div class="v2-card-head">
            <h3>🏛️ 地方州牧委任（按州郡宏观农商 · 募兵）</h3>
            <span class="v2-badge">${regions.filter((r) => r.officerObj).length}/${regions.length} 州已设牧</span>
          </div>
          <p class="v2-muted">受印州牧每月自动依国库余钱（留足战备底银后）推进全州基建、维持治安并视方针补兵，主公无需逐城微操。</p>
          <div style="display:flex;flex-direction:column;gap:0.55rem">
            ${regions.map((r) => {
              const curDir = r.governorRec?.directive || "balanced";
              const curReserve = r.governorRec?.budgetReserve ?? 60;
              const tPct = Math.round((r.bonus.treasuryMult - 1) * 100);
              const recPct = Math.round((r.bonus.recruitMult - 1) * 100);
              return `
                <div class="v2-region-card">
                  <div class="v2-row-top">
                    <strong>🏛️ ${esc(r.region)}（辖 ${r.cities.length} 城 · ${r.totalTroops.toLocaleString()}兵 · 均治${r.avgOrder}）</strong>
                    <span class="v2-badge">${r.officerObj ? `农商+${tPct}% · 募兵+${recPct}% · 治安+${r.bonus.orderBonus}` : "中枢直理"}</span>
                  </div>
                  <div class="v2-muted" style="font-size:0.73rem">辖城：${r.cities.map((c) => esc(cityNameV2(world, c.key))).join("、")}</div>
                  <div class="v2-inline-form">
                    <select class="v2-select" data-region-gov="${esc(r.region)}">
                      <option value="">-- 虚位（中枢直理） --</option>
                      ${govOfficers.map((o) => `<option value="${esc(o.key)}" ${r.officerObj?.key === o.key ? "selected" : ""}>州牧：${esc(o.name)}（政${o.governance} 统${o.command}）</option>`).join("")}
                    </select>
                    <select class="v2-select" data-region-reserve="${esc(r.region)}" ${r.officerObj ? "" : "disabled"} style="max-width:130px">
                      ${[40, 60, 120].map((v) => `<option value="${v}" ${curReserve === v ? "selected" : ""}>留备 ${v} 钱</option>`).join("")}
                    </select>
                  </div>
                  <div class="v2-chip-grid">
                    ${Object.values(GOVERNOR_DIRECTIVES).map((d) => `
                      <button type="button" class="v2-chip ${curDir === d.id ? "active" : ""}" data-region-dir="${esc(r.region)}:${esc(d.id)}" title="${esc(d.summary)}">${d.icon} ${esc(d.name)}</button>`).join("")}
                  </div>
                </div>`;
            }).join("")}
          </div>
        </div>`;

      renderBody(`
        <div class="v2-card">
          <div class="v2-card-head">
            <h3>🚩 委任军团都督府 (${corpsList.length} 军团)</h3>
            <span class="v2-badge">宏观执简驭繁</span>
          </div>
          ${corpsCardsHtml}
        </div>
        ${createCorpsHtml}
        ${regionsHtml}
      `);

      $("new-corps-name")?.addEventListener("input", (ev) => { corpsDraft.name = ev.target.value; });
      $("new-corps-cmd")?.addEventListener("change", (ev) => { corpsDraft.commanderKey = ev.target.value; });
      $("new-corps-mission")?.addEventListener("change", (ev) => {
        corpsDraft.mission = ev.target.value;
        renderCourtDialog();
      });
      $("new-corps-target")?.addEventListener("change", (ev) => {
        if (corpsDraft.mission === "conquer_city") corpsDraft.targetCity = ev.target.value;
        else if (corpsDraft.mission === "conquer_faction") corpsDraft.targetFaction = ev.target.value;
        else if (corpsDraft.mission === "logistics") corpsDraft.supplyToCity = ev.target.value;
      });
      body.querySelectorAll("[data-new-corps-city]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ck = btn.dataset.newCorpsCity;
          if (corpsDraft.cityKeys.includes(ck)) corpsDraft.cityKeys = corpsDraft.cityKeys.filter((x) => x !== ck);
          else corpsDraft.cityKeys = [...corpsDraft.cityKeys, ck];
          renderCourtDialog();
        });
      });
      $("btn-create-corps")?.addEventListener("click", () => {
        const ok = applyCommand((s) => createCorps(world, s, {
          name: corpsDraft.name,
          commanderKey: corpsDraft.commanderKey,
          cityKeys: corpsDraft.cityKeys,
          mission: corpsDraft.mission,
          targetCity: corpsDraft.targetCity,
          targetFaction: corpsDraft.targetFaction,
          supplyToCity: corpsDraft.supplyToCity,
        }));
        if (ok) {
          corpsDraft.name = "";
          corpsDraft.cityKeys = [];
          renderCourtDialog();
        }
      });

      body.querySelectorAll("[data-corps-mission]").forEach((sel) => {
        sel.addEventListener("change", (ev) => {
          const cid = sel.dataset.corpsMission;
          const m = ev.target.value;
          const ok = applyCommand((s) => updateCorps(world, s, cid, {
            mission: m,
            targetCity: m === "conquer_city" ? (enemyCities[0]?.key || null) : null,
            targetFaction: m === "conquer_faction" ? (hostileFactions[0]?.key || null) : null,
            supplyToCity: m === "logistics" ? (ownCities[0]?.key || null) : null,
          }));
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-save-corps]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const cid = btn.dataset.saveCorps;
          const m = body.querySelector(`[data-corps-mission="${cid}"]`)?.value || "defend";
          const tVal = body.querySelector(`[data-corps-target="${cid}"]`)?.value || null;
          const ok = applyCommand((s) => updateCorps(world, s, cid, {
            mission: m,
            targetCity: m === "conquer_city" ? tVal : null,
            targetFaction: m === "conquer_faction" ? tVal : null,
            supplyToCity: m === "logistics" ? tVal : null,
          }));
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-disband-corps]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ok = applyCommand((s) => disbandCorps(s, btn.dataset.disbandCorps));
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-remove-corps-city]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const [, ck] = btn.dataset.removeCorpsCity.split(":");
          const ok = applyCommand((s) => assignCityToCorps(world, s, ck, null));
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-add-corps-city-btn]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const cid = btn.dataset.addCorpsCityBtn;
          const ck = body.querySelector(`[data-add-corps-city-select="${cid}"]`)?.value;
          if (ck) {
            const ok = applyCommand((s) => assignCityToCorps(world, s, ck, cid));
            if (ok) renderCourtDialog();
          }
        });
      });
      body.querySelectorAll("[data-send-corps-off-btn]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const cid = btn.dataset.sendCorpsOffBtn;
          const offK = body.querySelector(`[data-send-corps-off-select="${cid}"]`)?.value;
          if (offK) {
            const ok = applyCommand((s) => sendOfficerToCorps(world, s, offK, cid));
            if (ok) renderCourtDialog();
          }
        });
      });
      body.querySelectorAll("[data-recall-corps-off]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ok = applyCommand((s) => recallOfficerFromCorps(world, s, btn.dataset.recallCorpsOff));
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-region-gov]").forEach((sel) => {
        sel.addEventListener("change", (ev) => {
          const reg = sel.dataset.regionGov;
          const curRec = getState().governors?.[reg];
          const ok = applyCommand((s) => appointRegionalGovernor(world, s, reg, ev.target.value || null, curRec?.directive || "balanced", curRec?.budgetReserve ?? 60));
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-region-dir]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const [reg, dir] = btn.dataset.regionDir.split(":");
          const curState = getState();
          const curRec = curState.governors?.[reg];
          const offKey = curRec?.officer || govOfficers[0]?.key || null;
          if (!offKey) {
            showTicker("请先为该州择定一位州牧");
            return;
          }
          const ok = applyCommand((s) => appointRegionalGovernor(world, s, reg, offKey, dir, curRec?.budgetReserve ?? 60));
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-region-reserve]").forEach((sel) => {
        sel.addEventListener("change", (ev) => {
          const reg = sel.dataset.regionReserve;
          const curRec = getState().governors?.[reg];
          if (!curRec?.officer) return;
          const ok = applyCommand((s) => appointRegionalGovernor(world, s, reg, curRec.officer, curRec.directive || "balanced", Number(ev.target.value)));
          if (ok) renderCourtDialog();
        });
      });
    } else if (courtTab === "cities") {
      const ownCities = Object.values(state.cities)
        .filter((c) => c.owner === state.player)
        .sort((a, b) => b.troops - a.troops);
      const econ = estimateFactionEconomy(state, state.player);
      const treasury = state.factions[state.player]?.treasury ?? 0;
      const curTax = state.factions[state.player]?.taxLevel || "normal";

      renderBody(`
        <div class="v2-card">
          <div class="v2-card-head">
            <h3>🏛️ 郡国农商与批量布政（共 ${ownCities.length} 城 · 平均治安 ${econ.avgOrder}）</h3>
            <span class="v2-badge">月净 ${econ.netTreasury >= 0 ? `+${econ.netTreasury}` : econ.netTreasury}钱 / ${econ.netGrain >= 0 ? `+${econ.netGrain}` : econ.netGrain}石</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.35rem;align-items:center">
            <span class="v2-muted">全境税制：</span>
            ${Object.values(TAX_LEVELS_V4).map((t) => `
              <button type="button" class="v2-chip ${curTax === t.id ? "active" : ""}" data-court-tax="${esc(t.id)}">${t.icon} ${esc(t.name)}</button>`).join("")}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.35rem;align-items:center">
            <span class="v2-muted">全境治城方针：</span>
            ${Object.values(CITY_POLICIES).map((p) => `
              <button type="button" class="v2-chip" data-batch-policy="${esc(p.id)}" title="${esc(p.desc)}">${p.icon} ${esc(p.name)}</button>`).join("")}
          </div>
        </div>
        <div class="v2-city-table-wrap">
          <table class="v2-city-table">
            <thead>
              <tr>
                <th>城池 · 规模</th>
                <th>农 / 商 / 工 / 学</th>
                <th>治安 · 驻军</th>
                <th>治城方针</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${ownCities.map((c) => {
                const tSpec = TROOP_TYPES[c.troopType] || TROOP_TYPES.infantry;
                const tier = cityTierInfo(c);
                const b = c.buildings || { farm: 1, market: 1, workshop: 0, academy: 0 };
                const orderVal = Number.isFinite(c.publicOrder) ? c.publicOrder : 78;
                const nextTrack = (b.farm <= b.market && b.farm < 5) ? "farm"
                  : (b.market < 5) ? "market"
                    : (b.academy < 5) ? "academy" : "workshop";
                const nextCost = (b[nextTrack] ?? 0) < 5 ? buildingUpgradeCost(state, state.player, nextTrack, (b[nextTrack] ?? 0) + 1) : 9999;
                const con = c.construction;
                const conDef = con ? CITY_BUILDINGS_V4[con.trackId] : null;
                const canQuickBuild = !state.sieges?.[c.key] && !con && (b[nextTrack] ?? 0) < 5 && treasury >= nextCost;
                const empBadge = state.emperorCity === c.key ? "👑 " : "";
                return `
                  <tr>
                    <td>
                      <strong>${empBadge}${esc(cityNameV2(world, c.key))}</strong>
                      <span class="v2-muted" style="font-size:0.7rem"> · ${esc(tier.title)}</span>
                    </td>
                    <td>
                      <div class="v2-dev-badges">
                        <span class="v2-dev-pip">🌾${b.farm}</span>
                        <span class="v2-dev-pip">🏮${b.market}</span>
                        <span class="v2-dev-pip">⚒️${b.workshop}</span>
                        <span class="v2-dev-pip">🏛️${b.academy}</span>
                      </div>
                    </td>
                    <td>治${orderVal} · ${tSpec.icon}${c.troops.toLocaleString()}${state.sieges?.[c.key] ? " 🔥" : ""}</td>
                    <td>
                      <select class="v2-select" data-row-policy="${esc(c.key)}" style="min-width:105px;padding:0.25rem 1.7rem 0.25rem 0.45rem;font-size:0.74rem">
                        ${Object.values(CITY_POLICIES).map((p) => `<option value="${esc(p.id)}" ${c.policy === p.id ? "selected" : ""}>${p.icon} ${esc(p.name)}</option>`).join("")}
                      </select>
                    </td>
                    <td>
                      <div style="display:flex;gap:0.25rem;align-items:center">
                        ${con ? `<span class="v2-dev-pip">🔨${conDef?.icon || ""}余${con.remainingDekads}旬</span>`
                          : (b[nextTrack] ?? 0) < 5 ? `<button type="button" class="v2-btn secondary" data-table-build="${esc(c.key)}:${esc(nextTrack)}" ${canQuickBuild ? "" : "disabled"} style="padding:0.22rem 0.44rem;font-size:0.72rem">+${CITY_BUILDINGS_V4[nextTrack].icon}</button>` : ""}
                        <button type="button" class="v2-btn quiet" data-jump-city="${esc(c.key)}" style="padding:0.22rem 0.46rem;font-size:0.72rem">定位</button>
                      </div>
                    </td>
                  </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>`);

      body.querySelectorAll("[data-court-tax]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ok = applyCommand((s) => setTaxLevel(s, btn.dataset.courtTax));
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-batch-policy]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ok = applyCommand((s) => batchSetCityPolicy(s, ownCities.map((c) => c.key), btn.dataset.batchPolicy));
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-row-policy]").forEach((sel) => {
        sel.addEventListener("change", (ev) => {
          const ck = sel.dataset.rowPolicy;
          applyCommand((s) => setCityPolicy(s, ck, ev.target.value), `${cityNameV2(world, ck)}治城方针已更新`);
        });
      });
      body.querySelectorAll("[data-table-build]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const [ck, tid] = btn.dataset.tableBuild.split(":");
          const ok = applyCommand((s) => upgradeCityBuilding(world, s, ck, tid));
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-jump-city]").forEach((btn) => {
        btn.addEventListener("click", () => {
          closeDialogSafe(dialog);
          selectCity(btn.dataset.jumpCity, { expandMobile: true, focusMap: true });
        });
      });
    } else if (courtTab === "roster") {
      const list = Object.values(state.officers)
        .filter((o) => o.faction === state.player && !o.capturedBy)
        .sort((a, b) => (b.command + b.governance) - (a.command + a.governance));
      const playerCities = Object.values(state.cities).filter((c) => c.owner === state.player);
      const wandering = state.wanderingOfficers || [];
      const myArmies = (state.armies || []).filter((a) => a.faction === state.player && a.troops > 0);
      const caps = state.captives || [];

      const wanderingHtml = wandering.length ? `
        <div class="v2-card">
          <div class="v2-card-head">
            <h3>📜 在野贤才寻访榜</h3>
            <span class="v2-badge">${wandering.length} 位待聘</span>
          </div>
          <div class="v2-list-grid">
            ${wandering.map((w) => {
              const adjOrOwn = state.cities[w.city]?.owner === state.player
                || (cityByKey(world, w.city)?.links || []).some((nb) => state.cities[nb]?.owner === state.player);
              return `
                <div class="v2-row-card">
                  <div class="v2-row-top">
                    <strong>${esc(w.name)}（${esc(cityNameV2(world, w.city))}）</strong>
                    <span class="v2-badge">统${w.command} 武${w.might} 政${w.governance}</span>
                  </div>
                  <div class="v2-muted">${esc(w.bio)}</div>
                  <div class="v2-row-actions">
                    <button type="button" class="v2-btn primary" data-court-recruit="${esc(w.id)}" ${adjOrOwn ? "" : "disabled"} style="width:100%">
                      ${adjOrOwn ? "🤝 礼贤下士 (24钱)" : `需夺占「${esc(cityNameV2(world, w.city))}」或邻城`}
                    </button>
                  </div>
                </div>`;
            }).join("")}
          </div>
        </div>` : "";

      const armiesHtml = myArmies.length ? `
        <div class="v2-card">
          <div class="v2-card-head"><h3>⚔️ 在途野战军团 (${myArmies.length})</h3></div>
          <div class="v2-list-grid">${myArmies.map((a) => {
            const o = a.officer ? state.officers[a.officer] : null;
            const dep = a.deputy ? state.officers[a.deputy] : null;
            const form = FORMATIONS_V2[a.formation || "heyi"] || FORMATIONS_V2.heyi;
            const sp = TROOP_TYPES[a.troopType] || TROOP_TYPES.infantry;
            const eta = armyEtaDekads(world, state, a);
            const leadName = o?.name || a.escortName || "辎重编队";
            const stName = (a.delayDekads || 0) > 0 ? `⏳ 待命(${a.delayDekads}旬)→${cityNameV2(world, a.targetCity)}`
              : a.stance === "besiege" ? `围攻「${cityNameV2(world, a.targetCity)}」`
                : a.stance === "engaged" ? `⚔️ 阵前绞杀(第${a.engageRounds || 1}合)`
                  : `趋「${cityNameV2(world, a.targetCity)}」(${eta}旬)`;
            return `
              <div class="v2-row-card">
                <div class="v2-row-top">
                  <strong>${esc(leadName)}${dep ? `·${esc(dep.name)}` : ""} · ${form.icon}${sp.icon}${a.troops.toLocaleString()}</strong>
                  <span class="v2-badge">${a.supplyCut ? "⚡断粮" : "✅畅通"}</span>
                </div>
                <div class="v2-muted">${esc(stName)} · 士气${a.morale} · 战意${a.rage || 0}%</div>
                <div class="v2-row-actions">
                  <button type="button" class="v2-btn secondary" data-cmd-army="${esc(a.id)}">地图定位并指挥</button>
                </div>
              </div>`;
          }).join("")}</div>
        </div>` : "";

      const captivesHtml = caps.length ? `
        <div class="v2-card">
          <div class="v2-card-head"><h3>⛓️ 在押敌将处置 (${caps.length})</h3></div>
          <div class="v2-list-grid">${caps.map((c) => {
            const off = state.officers[c.officer];
            if (!off) return "";
            return `
              <div class="v2-row-card">
                <div class="v2-row-top">
                  <strong>俘将「${esc(off.name)}」（原属${esc(factionNameV2(world, state, c.origFaction))}）</strong>
                  <span class="v2-badge">统${off.command} 武${off.might} 政${off.governance}</span>
                </div>
                <div class="v2-row-actions">
                  <button type="button" class="v2-btn primary" data-cap="${esc(c.officer)}:recruit">🎖️ 招降</button>
                  <button type="button" class="v2-btn secondary" data-cap="${esc(c.officer)}:ransom">💰 勒赎</button>
                  <button type="button" class="v2-btn quiet" data-cap="${esc(c.officer)}:release">🕊️ 义释</button>
                </div>
              </div>`;
          }).join("")}</div>
        </div>` : "";

      const officersHtml = `<div class="v2-list-grid">${list.map((o) => {
        const aw = AWAKENED_TITLES.find((t) => t.id === o.awakenedTitle);
        const art = officerBattleArt(o);
        const pos = o.armyId ? "⚔️ 领军在外"
          : o.transferringTo ? `🐎 驿传赴「${cityNameV2(world, o.transferringTo)}」中`
            : o.city ? `📍 驻 ${cityNameV2(world, o.city)}` : "待命";
        const canTr = !o.armyId && !o.transferringTo && (o.injuredDekads || 0) <= 0 && playerCities.length >= 2;
        return `
          <div class="v2-row-card">
            <div class="v2-row-top">
              <strong>${esc(o.name)}${aw ? ` · <span style="color:var(--gold)">${esc(aw.name)}</span>` : ""}</strong>
              <span class="v2-badge">忠 ${o.loyalty}</span>
            </div>
            <div style="display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap">
              <span class="v2-art-pill" title="${esc(art.desc)}">${art.icon} ${esc(art.name)}</span>
              <span class="v2-muted" style="font-size:0.74rem">${esc(pos)}</span>
            </div>
            <div class="v2-muted">统 ${o.command} · 武 ${o.might} · 政 ${o.governance} · 功勋 ${o.merit}（胜${o.wins}/守${o.defenses}）</div>
            <div class="v2-row-actions">
              <button type="button" class="v2-btn quiet" data-reward-off="${esc(o.key)}" ${o.loyalty >= 100 ? "disabled" : ""}>🎁 慰劳(10钱)</button>
              ${canTr ? `
                <select class="v2-select" data-tr-city="${esc(o.key)}" style="flex:1;min-width:105px;padding:0.28rem 1.7rem 0.28rem 0.45rem;font-size:0.74rem">
                  ${playerCities.filter((c) => c.key !== o.city).map((c) => `<option value="${esc(c.key)}">调至${esc(cityNameV2(world, c.key))}</option>`).join("")}
                </select>
                <button type="button" class="v2-btn secondary" data-tr-go="${esc(o.key)}">调防</button>
              ` : ""}
            </div>
          </div>`;
      }).join("")}</div>`;

      renderBody(wanderingHtml + armiesHtml + captivesHtml + officersHtml);

      body.querySelectorAll("[data-court-recruit]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ok = applyCommand((s) => recruitWanderingOfficer(world, s, btn.dataset.courtRecruit));
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-cmd-army]").forEach((btn) => {
        btn.addEventListener("click", () => {
          closeDialogSafe(dialog);
          selectArmy(btn.dataset.cmdArmy, true);
        });
      });
      body.querySelectorAll("[data-cap]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const [offKey, action] = btn.dataset.cap.split(":");
          const ok = applyCommand((s) => resolveCaptive(s, offKey, action), "已处置在押敌将！");
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-reward-off]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ok = applyCommand((s) => rewardOfficer(s, btn.dataset.rewardOff), "已行赏慰劳军心！");
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-tr-go]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const okKey = btn.dataset.trGo;
          const destK = body.querySelector(`[data-tr-city="${okKey}"]`)?.value;
          if (destK) {
            const ok = applyCommand((s) => transferOfficer(world, s, okKey, destK));
            if (ok) renderCourtDialog();
          }
        });
      });
    } else if (courtTab === "diplomacy") {
      const rivals = Object.values(state.factions).filter((f) => f.key !== state.player).map((f) => {
        const fs = factionSummary(state, f.key);
        const tr = activeTreaty(state, state.player, f.key);
        return { f, fs, tr };
      }).filter((r) => r.fs.cityCount > 0);

      const enemyCities = Object.values(state.cities).filter((c) => isHostileV2(state, state.player, c.owner));
      if (!dealDraft.target || !rivals.some((r) => r.f.key === dealDraft.target)) {
        dealDraft.target = rivals[0]?.f.key || "";
      }
      if (!dealDraft.thirdFactionKey || dealDraft.thirdFactionKey === dealDraft.target || !rivals.some((r) => r.f.key === dealDraft.thirdFactionKey)) {
        dealDraft.thirdFactionKey = rivals.find((r) => r.f.key !== dealDraft.target)?.f.key || "";
      }
      const playerCities = Object.values(state.cities).filter((c) => c.owner === state.player);
      const targetCaps = (state.captives || []).filter((c) => c.origFaction === dealDraft.target);
      const dealEval = dealDraft.target ? evaluateDeal(world, state, dealDraft.target, dealDraft) : { pct: 0, accepted: false, reasons: [] };

      const dealTypes = [
        { id: "truce", icon: "🕊️", label: "停战和约 (18旬)" },
        { id: "alliance", icon: "🤝", label: "缔结同盟 (36旬)" },
        { id: "instigate_war", icon: "🐺", label: "驱虎吞狼 (挑拨)" },
        { id: "trade_grain_gold", icon: "🌾", label: "以金易粮" },
        { id: "peace_cede", icon: "🏯", label: "割城换和 (27旬)" },
      ];

      renderBody(`
        <div class="v2-deal-card">
          <div class="v2-card-head">
            <h3>⚖️ 多边筹码谈判台 & 纵横秘策</h3>
            <span class="v2-badge" id="deal-badge">${dealEval.accepted ? `✅ 可成 (${dealEval.pct}%)` : `接受度 ${dealEval.pct}%`}</span>
          </div>
          <div class="v2-deal-meter"><i id="deal-meter-fill" style="width:${dealEval.pct}%"></i></div>
          <div class="v2-field">
            <label>选择交涉势力</label>
            <div class="v2-faction-pills">
              ${rivals.map(({ f, fs }) => `
                <button type="button" class="v2-faction-pill ${dealDraft.target === f.key ? "selected" : ""}" data-deal-target="${esc(f.key)}">
                  <i class="v2-fac-dot" style="background:${factionColor(f.key)}"></i>${esc(f.name)}<small class="v2-muted">(${fs.cityCount}城)</small>
                </button>`).join("")}
            </div>
          </div>
          <div class="v2-field">
            <label>条约与纵横名目</label>
            <div class="v2-chip-grid">
              ${dealTypes.map((dt) => `
                <button type="button" class="v2-chip ${dealDraft.type === dt.id ? "active" : ""}" data-deal-type="${dt.id}">${dt.icon} ${dt.label}</button>`).join("")}
            </div>
          </div>
          ${dealDraft.type === "instigate_war" ? `
            <div class="v2-field">
              <label>驱使其攻打第三方势力</label>
              <div class="v2-faction-pills">
                ${rivals.filter((r) => r.f.key !== dealDraft.target).map(({ f }) => `
                  <button type="button" class="v2-faction-pill ${dealDraft.thirdFactionKey === f.key ? "selected" : ""}" data-deal-third="${esc(f.key)}">
                    <i class="v2-fac-dot" style="background:${factionColor(f.key)}"></i>${esc(f.name)}
                  </button>`).join("")}
              </div>
            </div>` : ""}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:0.55rem">
            <div class="v2-field">
              <label><span>随礼银两</span><strong id="deal-gold-val">${dealDraft.gold} 钱</strong></label>
              <input type="range" id="deal-gold" min="0" max="${Math.max(50, Math.min(200, state.factions[state.player].treasury))}" step="5" value="${dealDraft.gold}">
            </div>
            <div class="v2-field">
              <label><span>随礼军粮</span><strong id="deal-grain-val">${dealDraft.grain} 石</strong></label>
              <input type="range" id="deal-grain" min="0" max="${Math.max(40, Math.min(200, state.factions[state.player].grain))}" step="5" value="${dealDraft.grain}">
            </div>
            ${playerCities.length >= 2 ? `
              <div class="v2-field">
                <label>额外筹码：割让边城 (+62意愿)</label>
                <select class="v2-select" id="deal-cede">
                  <option value="">-- 不割城 --</option>
                  ${playerCities.map((c) => `<option value="${esc(c.key)}" ${dealDraft.cedeCityKey === c.key ? "selected" : ""}>${esc(cityNameV2(world, c.key))}</option>`).join("")}
                </select>
              </div>` : ""}
            ${targetCaps.length ? `
              <div class="v2-field">
                <label>归还其俘将 (+42意愿)</label>
                <select class="v2-select" id="deal-cap">
                  <option value="">-- 不还俘 --</option>
                  ${targetCaps.map((c) => `<option value="${esc(c.officer)}" ${dealDraft.releaseCaptiveKey === c.officer ? "selected" : ""}>${esc(state.officers[c.officer]?.name)}</option>`).join("")}
                </select>
              </div>` : ""}
          </div>
          <p class="v2-muted" id="deal-reasons">评估依据：${dealEval.reasons.join(" · ") || "请配置筹码"}</p>
          <button type="button" class="v2-btn primary" id="btn-deal-submit" ${dealEval.accepted ? "" : "disabled"}>📜 遣使照会缔约</button>
        </div>

        <div class="v2-card">
          <div class="v2-card-head"><h3>🕸️ 九州诸侯邦交关系矩阵</h3></div>
          ${renderDiploMatrixHtml(world, state)}
        </div>

        <div class="v2-list-grid">${rivals.map(({ f, fs, tr }) => {
        const status = tr ? `${tr.kind === "alliance" ? "同盟" : "停战"}（余${tr.expires - state.turn}旬）` : "敌对 / 自由交锋";
        const allyBorderTargets = tr?.kind === "alliance"
          ? enemyCities.filter((ec) => Object.values(state.cities).some((ac) => ac.owner === f.key && cityByKey(world, ac.key).links.includes(ec.key)))
          : [];
        return `
          <div class="v2-row-card">
            <div class="v2-row-top">
              <strong><i class="v2-fac-dot" style="background:${factionColor(f.key)};margin-right:4px"></i>${esc(f.name)}</strong>
              <span class="v2-badge">${esc(status)}</span>
            </div>
            <div class="v2-muted">${fs.cityCount} 城 · 总兵力 ${fs.totalTroops.toLocaleString()}</div>
            <div class="v2-row-actions">
              ${!tr ? `
                <button type="button" class="v2-btn quiet" data-dip="${esc(f.key)}:truce">停战(15钱)</button>
                <button type="button" class="v2-btn secondary" data-dip="${esc(f.key)}:alliance">会盟(28钱)</button>
                ${fs.cityCount <= 2 ? `<button type="button" class="v2-btn primary" data-dip="${esc(f.key)}:persuade_surrender">传檄劝降</button>` : ""}
              ` : `
                ${tr.kind === "truce" ? `<button type="button" class="v2-btn secondary" data-dip="${esc(f.key)}:alliance">升级同盟(28钱)</button>` : ""}
                <button type="button" class="v2-btn danger" data-dip="${esc(f.key)}:break">废止盟约</button>
              `}
            </div>
            ${allyBorderTargets.length ? `
              <div style="display:flex;gap:0.35rem;margin-top:0.25rem">
                <select class="v2-select" id="joint-city-${esc(f.key)}">
                  ${allyBorderTargets.map((ec) => `<option value="${esc(ec.key)}">合击 ${esc(cityNameV2(world, ec.key))}</option>`).join("")}
                </select>
                <button type="button" class="v2-btn primary" data-joint="${esc(f.key)}">合击(20钱)</button>
              </div>` : ""}
          </div>`;
      }).join("")}</div>`);

      const syncDealLive = () => {
        const cur = evaluateDeal(world, getState(), dealDraft.target, dealDraft);
        const fill = $("deal-meter-fill");
        const badge = $("deal-badge");
        const reasons = $("deal-reasons");
        const submit = $("btn-deal-submit");
        if (fill) fill.style.width = `${cur.pct}%`;
        if (badge) badge.textContent = cur.accepted ? `✅ 可成 (${cur.pct}%)` : `接受度 ${cur.pct}%`;
        if (reasons) reasons.textContent = `评估依据：${cur.reasons.join(" · ") || "请配置筹码"}`;
        if (submit) submit.disabled = !cur.accepted;
      };

      body.querySelectorAll("[data-deal-target]").forEach((btn) => {
        btn.addEventListener("click", () => { dealDraft.target = btn.dataset.dealTarget; renderCourtDialog(); });
      });
      body.querySelectorAll("[data-deal-type]").forEach((btn) => {
        btn.addEventListener("click", () => { dealDraft.type = btn.dataset.dealType; renderCourtDialog(); });
      });
      body.querySelectorAll("[data-deal-third]").forEach((btn) => {
        btn.addEventListener("click", () => { dealDraft.thirdFactionKey = btn.dataset.dealThird; renderCourtDialog(); });
      });
      body.querySelectorAll("[data-dip]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const [fk, kind] = btn.dataset.dip.split(":");
          const ok = applyCommand((s) => executeDiplomacy(world, s, fk, kind), "外交使节已赴命交涉！");
          if (ok) renderCourtDialog();
        });
      });
      body.querySelectorAll("[data-joint]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const fk = btn.dataset.joint;
          const targetCityKey = $(`joint-city-${fk}`)?.value;
          const ok = applyCommand((s) => executeDiplomacy(world, s, fk, "joint_attack", { targetCityKey }), "盟军已领命发兵协同进攻！");
          if (ok) renderCourtDialog();
        });
      });
      $("deal-gold")?.addEventListener("input", (ev) => {
        dealDraft.gold = Number(ev.target.value);
        const gv = $("deal-gold-val");
        if (gv) gv.textContent = `${dealDraft.gold} 钱`;
        syncDealLive();
      });
      $("deal-grain")?.addEventListener("input", (ev) => {
        dealDraft.grain = Number(ev.target.value);
        const grv = $("deal-grain-val");
        if (grv) grv.textContent = `${dealDraft.grain} 石`;
        syncDealLive();
      });
      $("deal-cede")?.addEventListener("change", (ev) => { dealDraft.cedeCityKey = ev.target.value; renderCourtDialog(); });
      $("deal-cap")?.addEventListener("change", (ev) => { dealDraft.releaseCaptiveKey = ev.target.value; renderCourtDialog(); });
      $("btn-deal-submit")?.addEventListener("click", () => {
        const ok = applyCommand((s) => proposeDeal(world, s, dealDraft.target, dealDraft), "外交通好使团已圆满复命！");
        if (ok) renderCourtDialog();
      });
    } else if (courtTab === "chronicle") {
      const snaps = state.historySnapshots || [];
      const maxIdx = Math.max(0, snaps.length - 1);
      const curIdx = replayIndex < 0 || replayIndex > maxIdx ? maxIdx : replayIndex;
      const reports = state.battleReports || [];
      const logs = (state.events || []).slice().reverse();
      const tk = state.threeKingdoms;

      const tkBanner = tk?.triggered ? `
        <div class="v2-three-kingdoms-banner">
          <strong>👑 【三足鼎立 · 三帝并立大变局】</strong>
          <div class="v2-muted" style="margin-top:0.25rem">
            ${(tk.emperors || []).map((e) => `${esc(e.name)}（帝都：${esc(e.capitalName)} · 威望 ${e.prestige}）`).join(" ｜ ")}
          </div>
        </div>` : "";

      const reportsHtml = reports.length ? `
        <div class="v2-card">
          <div class="v2-card-head"><h3>📊 重大战役明细复盘档案（可点开分析胜负成因）</h3></div>
          <div class="v2-list-grid">
            ${reports.slice(0, 6).map((r) => `
              <div class="v2-row-card">
                <div class="v2-row-top">
                  <strong>${esc(r.title)}</strong>
                  <span class="v2-badge">${esc(formatCalendar(state.year, r.turn).short)}</span>
                </div>
                <div class="v2-muted">${esc(r.location)} · ${r.factors.slice(0, 2).join(" / ")}</div>
                <div class="v2-row-actions">
                  <button type="button" class="v2-btn quiet" data-open-report="${esc(r.id)}" style="width:100%">查看战报明细</button>
                </div>
              </div>`).join("")}
          </div>
        </div>` : "";

      const logsHtml = logs.length ? logs.map((e) => {
        const c = formatCalendar(state.year, e.turn);
        const btn = e.reportId ? `<button type="button" class="v2-chip" data-open-report="${esc(e.reportId)}" style="margin-left:0.4rem;padding:0.08rem 0.42rem;font-size:0.7rem">明细</button>` : "";
        return `<div class="v2-log-row" data-kind="${esc(e.kind || "system")}"><strong>[${esc(c.short)}]</strong> ${esc(e.text)}${btn}</div>`;
      }).join("") : `<p class="v2-muted">暂无战局纪录。</p>`;

      renderBody(`
        ${tkBanner}
        ${state.coalitionAlertLevel > 0 ? `
          <div class="v2-card siege-alert">
            <div class="v2-card-head"><h3>🔥 天下反霸警报（第 ${state.coalitionAlertLevel} 阶）</h3></div>
            <p class="v2-muted">我军威势震动九州，周边群雄正相互停战乃至联手对抗，请慎防多线反扑！</p>
          </div>` : ""}
        <div class="v2-card">
          <div class="v2-card-head">
            <h3>📈 诸侯势力消长曲线</h3>
            <div class="v2-chip-grid">
              <button type="button" class="v2-chip ${trendMetric === "cities" ? "active" : ""}" data-trend-metric="cities">城池数</button>
              <button type="button" class="v2-chip ${trendMetric === "troops" ? "active" : ""}" data-trend-metric="troops">总兵力</button>
            </div>
          </div>
          ${renderPowerChartSvg(world, state, trendMetric)}
        </div>
        <div class="v2-card">
          <div class="v2-card-head"><h3>🕰️ 九州疆域统一演进回放</h3></div>
          <div id="replay-container">${renderReplayMapSvg(world, state, curIdx)}</div>
          ${snaps.length > 1 ? `
            <div class="v2-field">
              <label><span>拖动时间轴回看开局至今风云变化</span><strong id="replay-turn-lbl">${formatCalendar(state.year, snaps[curIdx].turn).label}</strong></label>
              <input type="range" id="replay-slider" min="0" max="${maxIdx}" step="1" value="${curIdx}">
            </div>` : `<p class="v2-muted">继续推进战局以记录更多历史版图演进帧。</p>`}
        </div>
        ${reportsHtml}
        ${logsHtml}`);

      body.querySelectorAll("[data-trend-metric]").forEach((btn) => {
        btn.addEventListener("click", () => {
          trendMetric = btn.dataset.trendMetric;
          renderCourtDialog();
        });
      });
      $("replay-slider")?.addEventListener("input", (ev) => {
        const idx = Number(ev.target.value);
        replayIndex = idx;
        const wrap = $("replay-container");
        if (wrap) wrap.innerHTML = renderReplayMapSvg(world, state, idx);
        const lbl = $("replay-turn-lbl");
        if (lbl && snaps[idx]) lbl.textContent = formatCalendar(state.year, snaps[idx].turn).label;
      });
      body.querySelectorAll("[data-open-report]").forEach((btn) => {
        btn.addEventListener("click", () => renderBattleDialog(btn.dataset.openReport));
      });
    }
  }

  function openCourtDialog(tab = "offices") {
    courtTab = tab;
    const dialog = $("court-dialog");
    openDialogSafe(dialog);
    renderCourtDialog();
  }

  function renderMenuDialog() {
    const dialog = $("menu-dialog");
    const state = getState();
    menuScenarioYear ??= state.year;
    menuFaction ??= state.player;
    menuDifficulty ??= state.difficulty;

    const era = eraByYearV2(world, menuScenarioYear);
    if (!era.factions.some((f) => f.key === menuFaction)) {
      menuFaction = era.factions[0].key;
    }

    const body = $("menu-body");
    body.innerHTML = `
      <div class="v2-field">
        <label>择定史实剧本（11 个剧本全数开放）</label>
        <div class="v2-scenario-grid">
          ${world.scenarios.slice().sort((a, b) => a.year - b.year).map((sc) => `
            <button type="button" class="v2-pick-card ${sc.year === menuScenarioYear ? "selected" : ""}" data-sc-year="${sc.year}">
              <strong>${sc.year}年 · ${esc(sc.title)}</strong>
              <div class="v2-muted">${sc.factions.length} 诸侯</div>
            </button>`).join("")}
        </div>
      </div>

      <div class="v2-field">
        <label>择定主公势力</label>
        <div class="v2-scenario-grid">
          ${era.factions.map((f) => {
            const cnt = Object.values(era.ownership).filter((ow) => ow === f.key).length;
            return `
              <button type="button" class="v2-pick-card ${f.key === menuFaction ? "selected" : ""}" data-sc-fac="${esc(f.key)}">
                <strong><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${factionColor(f.key)};margin-right:4px"></span>${esc(f.name)}</strong>
                <div class="v2-muted">${cnt} 城 · ${esc(f.trait || "争霸九州")}</div>
              </button>`;
          }).join("")}
        </div>
      </div>

      <div class="v2-field">
        <label>战局难度与全局声效</label>
        <div style="display:flex;flex-wrap:wrap;gap:0.4rem">
          ${Object.values(DIFFICULTY_MODES).map((d) => `
            <button type="button" class="v2-chip ${menuDifficulty === d.id ? "active" : ""}" data-sc-diff="${d.id}" title="${esc(d.summary)}">${esc(d.name)}</button>`).join("")}
          <button type="button" class="v2-btn quiet" id="menu-toggle-bgm">${sound?.isBgmEnabled?.() ? "🎵 雅乐已开" : "🎵 古风雅乐: 关"}</button>
          <button type="button" class="v2-btn quiet" id="menu-toggle-sfx">${sound?.isMuted?.() ? "🔇 音效已闭" : "🔊 音效已开"}</button>
        </div>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:0.5rem;padding-top:0.4rem;border-top:1px solid var(--border)">
        <button type="button" class="v2-btn primary" id="menu-start-game" style="flex:1">🚩 开启选定剧本战局</button>
        <button type="button" class="v2-btn secondary" id="menu-export-save">导出存档 JSON</button>
        <label class="v2-btn quiet" style="display:inline-flex;align-items:center">
          导入存档<input type="file" id="menu-import-file" accept=".json" hidden>
        </label>
      </div>`;

    body.querySelectorAll("[data-sc-year]").forEach((b) => {
      b.addEventListener("click", () => {
        menuScenarioYear = Number(b.dataset.scYear);
        renderMenuDialog();
      });
    });
    body.querySelectorAll("[data-sc-fac]").forEach((b) => {
      b.addEventListener("click", () => {
        menuFaction = b.dataset.scFac;
        renderMenuDialog();
      });
    });
    body.querySelectorAll("[data-sc-diff]").forEach((b) => {
      b.addEventListener("click", () => {
        menuDifficulty = b.dataset.scDiff;
        renderMenuDialog();
      });
    });
    $("menu-toggle-bgm")?.addEventListener("click", () => {
      sound?.toggleBgm?.();
      renderMenuDialog();
    });
    $("menu-toggle-sfx")?.addEventListener("click", () => {
      sound?.toggle?.();
      renderMenuDialog();
    });
    $("menu-start-game")?.addEventListener("click", () => {
      const next = createGameV2(world, menuScenarioYear, menuFaction, { difficulty: menuDifficulty });
      selectedEdge = null;
      selectedArmyId = null;
      selectedCity = Object.values(next.cities).find((c) => c.owner === next.player)?.key || world.cities[0].key;
      dispatchDraft = { from: null, to: null, officer: null, deputy: null, formation: "heyi", troopType: null, troops: 800, siegeStance: "storm" };
      dealDraft.target = null;
      coordDraft = { target: null, origins: [], sync: true, formation: "heyi" };
      replayIndex = -1;
      edictTarget = null;
      onNewGame(next);
      closeDialogSafe(dialog);
      mapApi.fitAll();
      showTicker(`新局开启：${eraByYearV2(world, next.year).title} · ${factionNameV2(world, next, next.player)}`);
    });
    $("menu-export-save")?.addEventListener("click", () => {
      const blob = new Blob([serializeStateV2(getState())], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `jinglue-sanguo-v2-${getState().year}-${getState().turn}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $("menu-import-file")?.addEventListener("change", async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const loaded = deserializeStateV2(world, text);
        selectedEdge = null;
        selectedArmyId = null;
        selectedCity = Object.values(loaded.cities).find((c) => c.owner === loaded.player)?.key || world.cities[0].key;
        dispatchDraft = { from: null, to: null, officer: null, deputy: null, formation: "heyi", troopType: null, troops: 800, siegeStance: "storm" };
        dealDraft.target = null;
        coordDraft = { target: null, origins: [], sync: true, formation: "heyi" };
        replayIndex = -1;
        edictTarget = null;
        onNewGame(loaded);
        closeDialogSafe(dialog);
        showTicker("已载入存档，继续经略九州！");
      } catch (err) {
        showTicker(`⚠️ ${err.message}`);
      }
    });
  }

  function openMenuDialog() {
    const dialog = $("menu-dialog");
    menuScenarioYear = getState().year;
    menuFaction = getState().player;
    menuDifficulty = getState().difficulty;
    renderMenuDialog();
    openDialogSafe(dialog);
  }

  function checkOutcomeDialog(state) {
    if (state.outcome === "ongoing") return;
    const dialog = $("outcome-dialog");
    if (!dialog || dialog.open) return;
    const won = state.outcome === "victory";
    const cal = formatCalendar(state.year, state.turn);
    $("outcome-title").textContent = won ? "🏆 四海归一 · 鼎定九州" : "🥀 社稷倾覆 · 战局告终";
    $("outcome-sub").textContent = `${cal.label} · 历时 ${state.turn} 旬`;
    $("outcome-body").innerHTML = `
      <p class="v2-muted">${won ? `恭喜主公率${factionNameV2(world, state, state.player)}一统天下四十四城！` : "所余城池尽失，可随时重整山河或换选剧本再图霸业。"}</p>
      <button type="button" class="v2-btn primary" id="outcome-restart">开启新剧本</button>`;
    $("outcome-restart")?.addEventListener("click", () => {
      closeDialogSafe(dialog);
      openMenuDialog();
    });
    openDialogSafe(dialog);
  }

  function renderEventDialog() {
    const state = getState();
    const ev = state.pendingEvent;
    const dialog = $("event-dialog");
    if (!dialog) return;
    if (!ev) {
      closeDialogSafe(dialog);
      delete dialog.dataset.eventId;
      return;
    }
    const eventSig = `${ev.id}:${ev.turn}`;
    if (dialog.open && dialog.dataset.eventId === eventSig) return;
    dialog.dataset.eventId = eventSig;

    const cal = formatCalendar(state.year, ev.turn);
    $("event-title").textContent = `${ev.icon || "📜"} ${ev.title}`;
    $("event-sub").textContent = `${cal.label} · 时局关键节点，请主公定夺`;
    const body = $("event-body");
    body.innerHTML = `
      <p style="margin:0;line-height:1.65;color:#f3ead3">${esc(ev.text)}</p>
      <div style="display:flex;flex-direction:column;gap:0.55rem;margin-top:0.25rem">
        ${(ev.choices || []).map((c, idx) => `
          <button type="button" class="v2-choice-card" data-event-choice="${idx}">
            <strong>${esc(c.label)}</strong>
            <span class="v2-muted">${esc(c.hint)}</span>
          </button>`).join("")}
      </div>`;

    body.querySelectorAll("[data-event-choice]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.eventChoice);
        const ok = applyCommand((s) => resolveEventChoice(world, s, idx));
        if (ok) {
          closeDialogSafe(dialog);
          delete dialog.dataset.eventId;
          const msg = getState().lastTurnEvents?.[0]?.text;
          if (msg) showTicker(msg);
        }
      });
    });

    openDialogSafe(dialog);
  }

  function renderBattleDialog(reportId) {
    const state = getState();
    const reports = state.battleReports || [];
    const rep = reports.find((r) => r.id === reportId) || reports[0];
    const dialog = $("battle-dialog");
    if (!dialog || !rep) return;

    const cal = formatCalendar(state.year, rep.turn);
    $("battle-title").textContent = `📊 ${rep.title}`;
    $("battle-sub").textContent = `${cal.label} · 地点：${rep.location || "前线战区"}`;

    const winFactionName = rep.winnerFaction ? factionNameV2(world, state, rep.winnerFaction) : "势均力敌";
    const winCol = rep.winnerFaction ? factionColor(rep.winnerFaction) : "#c8a962";
    const attFactionName = rep.attacker?.faction ? factionNameV2(world, state, rep.attacker.faction) : "攻方";
    const defFactionName = rep.defender?.faction ? factionNameV2(world, state, rep.defender.faction) : "守方";
    const attCol = rep.attacker?.faction ? factionColor(rep.attacker.faction) : "#c8a962";
    const defCol = rep.defender?.faction ? factionColor(rep.defender.faction) : "#c8a962";

    const attWon = Boolean(rep.winnerFaction && rep.attacker?.faction === rep.winnerFaction);
    const attLoss = rep.losses?.attacker ?? (attWon ? rep.losses?.winner : rep.losses?.loser) ?? 0;
    const defLoss = rep.losses?.defender ?? (attWon ? rep.losses?.loser : rep.losses?.winner) ?? 0;

    $("battle-body").innerHTML = `
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0.4rem">
        <div style="display:flex;align-items:center;gap:0.45rem;font-size:0.86rem">
          <span class="v2-fac-dot" style="background:${winCol}"></span>
          <strong>胜方：${esc(winFactionName)}</strong>
        </div>
        ${rep.shattered ? `<span class="v2-badge" style="color:#f5a292;border-color:rgba(218,86,70,0.5)">💥 全军溃灭</span>` : ""}
      </div>
      <div class="v2-list-grid">
        <div class="v2-battle-card">
          <div class="v2-row-top">
            <strong style="display:flex;align-items:center;gap:0.35rem"><span class="v2-fac-dot" style="background:${attCol}"></span>攻 · ${esc(attFactionName)}</strong>
            ${rep.attacker?.form ? `<span class="v2-badge">${esc(rep.attacker.form)}</span>` : ""}
          </div>
          <div style="font-size:0.82rem">主将：<strong>${esc(rep.attacker?.officer || "偏将")}</strong></div>
          <div class="v2-muted">参战兵力 ${(rep.attacker?.troops ?? 0).toLocaleString()} · 战损 <strong style="color:#f29b8a">${attLoss.toLocaleString()}</strong></div>
        </div>
        <div class="v2-battle-card">
          <div class="v2-row-top">
            <strong style="display:flex;align-items:center;gap:0.35rem"><span class="v2-fac-dot" style="background:${defCol}"></span>守 · ${esc(defFactionName)}</strong>
            ${rep.defender?.form ? `<span class="v2-badge">${esc(rep.defender.form)}</span>` : ""}
          </div>
          <div style="font-size:0.82rem">主将：<strong>${esc(rep.defender?.officer || "守军")}</strong></div>
          <div class="v2-muted">参战兵力 ${(rep.defender?.troops ?? 0).toLocaleString()} · 战损 <strong style="color:#f29b8a">${defLoss.toLocaleString()}</strong></div>
        </div>
      </div>
      <div class="v2-battle-card">
        <strong style="font-size:0.82rem;color:var(--gold)">🔎 胜负成因与战局修正</strong>
        ${rep.factors?.length ? `
          <div class="v2-factor-list">
            ${rep.factors.map((f) => `<span class="v2-factor-pill">${esc(f)}</span>`).join("")}
          </div>` : `<p class="v2-muted">双方正面列阵硬撼交锋，未触发额外地形或谋略修正。</p>`}
        ${rep.artTriggered?.length ? `
          <div class="v2-factor-list" style="margin-top:0.2rem">
            ${rep.artTriggered.map((a) => `<span class="v2-art-pill">⚡ 战法发动：${esc(a)}</span>`).join("")}
          </div>` : ""}
      </div>`;

    openDialogSafe(dialog);
  }

  function quickPrimeTarget(targetCityKey) {
    const state = getState();
    const selCity = selectedCity ? state.cities[selectedCity] : null;
    if (selCity && selCity.owner === state.player && selectedCity !== targetCityKey) {
      handleDragDispatch(selectedCity, targetCityKey);
      showTicker(`🎯 已快速设定「${cityNameV2(world, selectedCity)} → ${cityNameV2(world, targetCityKey)}」出兵目标`);
      return;
    }
    if (state.cities[targetCityKey]?.owner === state.player) {
      selectCity(targetCityKey, { expandMobile: true });
      return;
    }
    const targetMeta = cityByKey(world, targetCityKey);
    const adjSet = new Set(targetMeta?.links || []);
    const candidates = Object.values(state.cities)
      .filter((c) => (
        c.owner === state.player
        && c.troops >= MIN_GARRISON_LEAVE + MIN_DISPATCH_TROOPS
        && availableOfficersInCity(state, c.key, state.player).length > 0
      ))
      .sort((a, b) => (adjSet.has(b.key) ? 1 : 0) - (adjSet.has(a.key) ? 1 : 0) || b.troops - a.troops);

    if (candidates.length) {
      handleDragDispatch(candidates[0].key, targetCityKey);
      showTicker(`🎯 已自动择定「${cityNameV2(world, candidates[0].key)}」拟定直扑「${cityNameV2(world, targetCityKey)}」`);
    } else {
      selectCity(targetCityKey, { expandMobile: true });
    }
  }

  function selectCity(cityKey, { expandMobile = false, focusMap = false } = {}) {
    selectedEdge = null;
    selectedArmyId = null;
    selectedCity = cityKey;
    if (expandMobile && window.innerWidth <= 900) {
      setInspectorCollapsed(false);
    }
    if (focusMap) mapApi.focusCity(cityKey, 1.9);
    renderAll();
  }

  function selectArmy(armyId, focusMap = false) {
    const army = (getState().armies || []).find((a) => a.id === armyId);
    if (!army) return;
    selectedEdge = null;
    selectedArmyId = armyId;
    if (window.innerWidth <= 900) setInspectorCollapsed(false);
    if (focusMap) mapApi.focusCity(army.targetCity, 1.85);
    renderAll();
  }

  function selectEdge(eKey, aKey, bKey) {
    selectedArmyId = null;
    selectedEdge = { edgeKey: eKey, aKey, bKey };
    if (window.innerWidth <= 900) setInspectorCollapsed(false);
    renderAll();
  }

  function handleDragDispatch(fromKey, toKey) {
    selectedEdge = null;
    selectedArmyId = null;
    selectedCity = fromKey;
    dispatchDraft.from = fromKey;
    dispatchDraft.to = toKey;
    const fcCity = getState().cities[fromKey];
    if (fcCity) {
      dispatchDraft.troopType = fcCity.troopType;
      dispatchDraft.troops = Math.min(fcCity.troops - MIN_GARRISON_LEAVE, Math.max(MIN_DISPATCH_TROOPS, Math.round((fcCity.troops - MIN_GARRISON_LEAVE) * 0.68)));
    }
    if (window.innerWidth <= 900) setInspectorCollapsed(false);
    sound?.play?.("click");
    renderAll();
  }

  function renderAll() {
    const state = getState();
    renderTopbar(state);
    renderAlerts(state);
    renderInspector(state);
    mapApi.render(state, { city: selectedCity, armyId: selectedArmyId, edgeKey: selectedEdge?.edgeKey || null, overlay: overlayMode });
    if ($("court-dialog")?.open) renderCourtDialog();
    if ($("cabinet-dialog")?.open) renderCabinetDialog();
    if (state.pendingEvent) renderEventDialog();
    checkOutcomeDialog(state);
  }

  // Wire top-level buttons & tabs
  $("open-cabinet")?.addEventListener("click", () => openCabinetDialog());
  $("open-court")?.addEventListener("click", () => openCourtDialog("offices"));
  $("open-log")?.addEventListener("click", () => openCourtDialog("chronicle"));
  $("open-menu")?.addEventListener("click", () => openMenuDialog());
  $("seal-btn")?.addEventListener("click", () => openMenuDialog());

  $("court-tabs")?.querySelectorAll(".v2-tab").forEach((t) => {
    t.addEventListener("click", () => {
      courtTab = t.dataset.tab || "offices";
      renderCourtDialog();
    });
  });

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeDialogSafe($(btn.dataset.close)));
  });

  $("event-dialog")?.addEventListener("cancel", (ev) => {
    if (getState().pendingEvent) ev.preventDefault();
  });

  for (const dlgId of ["court-dialog", "cabinet-dialog", "menu-dialog", "battle-dialog", "outcome-dialog"]) {
    const dlg = $(dlgId);
    dlg?.addEventListener("click", (ev) => {
      if (ev.target === dlg) closeDialogSafe(dlg);
    });
  }

  $("tool-fit")?.addEventListener("click", () => mapApi.fitAll());
  $("tool-zoom-in")?.addEventListener("click", () => mapApi.zoomBy(1.32));
  $("tool-zoom-out")?.addEventListener("click", () => mapApi.zoomBy(1 / 1.32));
  function setOverlayToolbar(nextMode) {
    overlayMode = overlayMode === nextMode ? "standard" : nextMode;
    $("tool-supply")?.setAttribute("aria-pressed", String(overlayMode === "supply"));
    $("tool-troops")?.setAttribute("aria-pressed", String(overlayMode === "troops"));
    $("tool-forts")?.setAttribute("aria-pressed", String(overlayMode === "forts"));
    renderAll();
  }

  $("tool-supply")?.addEventListener("click", () => setOverlayToolbar("supply"));
  $("tool-troops")?.addEventListener("click", () => setOverlayToolbar("troops"));
  $("tool-forts")?.addEventListener("click", () => setOverlayToolbar("forts"));

  window.addEventListener("resize", () => renderTopbar(getState()));

  return {
    renderAll,
    selectCity,
    selectArmy,
    selectEdge,
    handleDragDispatch,
    quickPrimeTarget,
    openCabinetDialog,
    openCourtDialog,
    openMenuDialog,
    renderEventDialog,
    renderBattleDialog,
    showTicker,
    setOverlay(mode) { overlayMode = mode; },
  };
}
