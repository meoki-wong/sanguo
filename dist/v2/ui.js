// 经略三国 2.0 — 精炼战略指挥舱、朝堂军政、外交合击与剧本弹窗控制器

import {
  AWAKENED_TITLES, CITY_POLICIES, CITY_SPECIALTIES, DEFENSE_TRAPS, DIFFICULTY_MODES,
  FORMATIONS_V2, FORT_CATALOG, NATIONAL_DECREES_V2, SIEGE_DEFENSE_MODES, SIEGE_STANCES,
  STRATAGEM_CATALOG, TERRAIN_LABELS, TROOP_TYPES, edgeDisplayName, edgeKey, factionColor,
  formatCalendar, roadTerrain,
} from "./constants.js";
import {
  MIN_DISPATCH_TROOPS, MIN_GARRISON_LEAVE, activeTreaty, appointOfficer, armyEtaDekads,
  availableOfficersInCity, bribeDefection, buildFort, canBuildFort, castStratagem,
  checkSupplyLine, cityBonds, cityByKey, cityNameV2, computeThreats, demolishFort,
  dispatchArmy, dispatchEmergencyReinforce, enactDecree, eraByYearV2, evaluateDeal,
  executeDiplomacy, factionNameV2, factionSummary, forecastDispatch, hasDecree, isHostileV2,
  layCityTrap, proposeDeal, rankProgressForFaction, redirectArmy, repairFort, resolveCaptive,
  rewardOfficer, serializeStateV2, deserializeStateV2, setCityPolicy, setCitySiegeDefense,
  setCityTroopType, sowDiscord, stratagemCooldownLeft, createGameV2,
} from "./engine.js";

const $ = (id) => document.getElementById(id);

function esc(str = "") {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[m]));
}

export function createUiV2({ world, sound, getState, setState, mapApi, onNewGame }) {
  let selectedCity = null;
  let selectedArmyId = null;
  let selectedEdge = null; // { edgeKey, aKey, bKey }
  let courtTab = "officers";
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
    const fName = factionNameV2(world, state, state.player);

    const isCompact = typeof window !== "undefined" && window.innerWidth <= 900;
    $("v2-date").textContent = isCompact
      ? `${cal.year}年${cal.month}月${cal.dekadName} · ${rp.current.title} ${state.weather?.icon || ""}`.trim()
      : `${era.title} · ${cal.label}（${fName} · ${rp.current.title}）`;
    const wPill = $("v2-weather");
    if (wPill && state.weather) {
      wPill.textContent = `${state.weather.icon} ${state.weather.name}`;
      wPill.title = state.weather.summary;
    }

    $("res-treasury").textContent = `${sum.treasury.toLocaleString()}钱`;
    $("res-grain").textContent = `${sum.grain.toLocaleString()}石`;
    $("res-cities").textContent = `${sum.cityCount}/44`;
    $("res-troops").textContent = `${sum.totalTroops.toLocaleString()}`;

    const sealBtn = $("seal-btn");
    if (sealBtn) {
      sealBtn.textContent = [...fName][0] || "略";
      sealBtn.style.background = factionColor(state.player);
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
    const off = state.officers[army.officer];
    const dep = army.deputy ? state.officers[army.deputy] : null;
    const form = FORMATIONS_V2[army.formation || "heyi"] || FORMATIONS_V2.heyi;
    const spec = TROOP_TYPES[army.troopType] || TROOP_TYPES.infantry;
    const isOwn = army.faction === state.player;
    const supplyOk = checkSupplyLine(world, state, army);
    const eta = armyEtaDekads(world, state, army);
    const fName = factionNameV2(world, state, army.faction);
    const destName = cityNameV2(world, army.targetCity);

    if (handleSummary) {
      handleSummary.textContent = `${off?.name || "大军"} · ${spec.icon}${army.troops.toLocaleString()} · 趋向${destName}`;
    }

    const stanceLabel = army.stance === "besiege" ? `🔥 围攻${destName}中`
      : army.stance === "engaged" ? `⚔️ 阵前绞杀交锋中（第${army.engageRounds || 1}合）`
        : army.stance === "reinforce" ? `🛡️ 驰援${destName}（约${eta}旬）`
          : army.stance === "retreat" ? `🏳️ 回撤${destName}（约${eta}旬）`
            : `⚔️ 进军${destName}（约${eta}旬）`;

    let html = `
      <div class="v2-card ${army.stance === "engaged" ? "siege-alert" : ""}">
        <div class="v2-card-head">
          <h2>${esc(off?.name || "野战军团")}所部</h2>
          <span class="v2-badge" style="background:${factionColor(army.faction)}">${esc(fName)}</span>
        </div>
        <p class="v2-muted">${esc(stanceLabel)} · ${form.icon}${esc(form.name)}${dep ? ` · 副将${esc(dep.name)}` : ""} · 统 ${off?.command ?? 70} / 武 ${off?.might ?? 70}</p>
        ${army.stance === "engaged" ? `<p class="v2-muted" style="color:var(--gold)">⚡ 两军正于官道白刃相持！调遣友好军团进抵同道可获 +18% 夹击加成，或下令班师脱战。</p>` : ""}
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

    inspectorBody.innerHTML = html;

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
          ${citySpec ? `<span class="v2-specialty-pill" title="${esc(citySpec.desc)}">${citySpec.icon} ${esc(citySpec.name)}</span>` : ""}
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

      html += `
        <div class="v2-card">
          <div class="v2-card-head">
            <h3>⚔️ 派军出征 / 驰援前线</h3>
            <span class="v2-muted" style="font-size:0.72rem">可直接在地图上拖箭头出兵</span>
          </div>
          ${draftInfo.avail.length === 0 ? `<p class="v2-muted">⚠️ 当前城内暂无空闲武将，可自「任免」或别城调派。</p>` : ""}
          ${draftInfo.maxSend < MIN_DISPATCH_TROOPS ? `<p class="v2-muted">⚠️ 驻军需保留 ${MIN_GARRISON_LEAVE} 留守，当前兵力暂不足出征（需至少 ${MIN_GARRISON_LEAVE + MIN_DISPATCH_TROOPS} 人）。</p>` : ""}
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
              🛣️ 约 <strong>${fc.dekads} 旬</strong> 抵达 · 耗粮 <strong>${fc.grainCost} 石</strong> · ${TERRAIN_LABELS[fc.terrain]}
              ${fc.counter.label ? `<br>⚔️ ${esc(fc.counter.label)}` : ""}
            </div>` : `<div class="v2-forecast-line countered">${esc(fc.reason)}</div>`) : ""}
          <button type="button" class="v2-btn primary" id="btn-dispatch" ${canSend && fc?.ok ? "" : "disabled"}>
            ${fc?.isFriendlyDest ? "🛡️ 挥师驰援" : "⚔️ 誓师出征"}
          </button>
        </div>

        <div class="v2-card">
          <div class="v2-card-head"><h3>🏛️ 治城方针 · 整编 · 设伏</h3></div>
          <div class="v2-field">
            <label>月度自动治城方针</label>
            <div class="v2-chip-grid">
              ${Object.values(CITY_POLICIES).map((p) => `
                <button type="button" class="v2-chip ${city.policy === p.id ? "active" : ""}" data-city-policy="${p.id}" title="${esc(p.desc)}">${p.icon} ${esc(p.name)}</button>`).join("")}
            </div>
          </div>
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

      const idlePool = Object.values(state.officers).filter((o) => o.faction === state.player && !o.armyId && !o.capturedBy);
      html += `
        <div class="v2-card">
          <div class="v2-card-head"><h3>📜 城池官署任免</h3></div>
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
        </div>`;
    } else {
      // Enemy or Allied city quick launch helper
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

    inspectorBody.innerHTML = html;

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
    $("dispatch-troops")?.addEventListener("input", (ev) => {
      dispatchDraft.troops = Number(ev.target.value);
      const valNode = $("dispatch-troops-val");
      if (valNode) valNode.textContent = `${dispatchDraft.troops.toLocaleString()} 人`;
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

  function renderCourtDialog() {
    const dialog = $("court-dialog");
    if (!dialog?.open) return;
    const state = getState();
    const body = $("court-body");
    dialog.querySelectorAll(".v2-tab").forEach((t) => {
      t.setAttribute("aria-selected", String(t.dataset.tab === courtTab));
    });

    if (courtTab === "officers") {
      const list = Object.values(state.officers)
        .filter((o) => o.faction === state.player && !o.capturedBy)
        .sort((a, b) => (b.command + b.governance) - (a.command + a.governance));
      body.innerHTML = `<div class="v2-list-grid">${list.map((o) => {
        const aw = AWAKENED_TITLES.find((t) => t.id === o.awakenedTitle);
        const pos = o.armyId ? "⚔️ 领军在外" : o.city ? `📍 驻 ${cityNameV2(world, o.city)}` : "待命";
        return `
          <div class="v2-row-card">
            <div class="v2-row-top">
              <strong>${esc(o.name)}${aw ? ` · <span style="color:var(--gold)">${esc(aw.name)}</span>` : ""}</strong>
              <span class="v2-badge">忠 ${o.loyalty}</span>
            </div>
            <div class="v2-muted">统率 ${o.command} · 武力 ${o.might} · 内政 ${o.governance} · 功勋 ${o.merit}（胜${o.wins}/守${o.defenses}）</div>
            <div class="v2-muted">${esc(pos)}</div>
            <button type="button" class="v2-btn quiet" data-reward-off="${esc(o.key)}" ${o.loyalty >= 100 ? "disabled" : ""}>🎁 赏赐慰劳 (+14忠义 · 10钱)</button>
          </div>`;
      }).join("")}</div>`;

      body.querySelectorAll("[data-reward-off]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ok = applyCommand((s) => rewardOfficer(s, btn.dataset.rewardOff), "已行赏慰劳军心！");
          if (ok) renderCourtDialog();
        });
      });
    } else if (courtTab === "armies") {
      const myArmies = (state.armies || []).filter((a) => a.faction === state.player && a.troops > 0);
      body.innerHTML = myArmies.length ? myArmies.map((a) => {
        const o = state.officers[a.officer];
        const dep = a.deputy ? state.officers[a.deputy] : null;
        const form = FORMATIONS_V2[a.formation || "heyi"] || FORMATIONS_V2.heyi;
        const sp = TROOP_TYPES[a.troopType] || TROOP_TYPES.infantry;
        const eta = armyEtaDekads(world, state, a);
        const stName = a.stance === "besiege" ? `围攻「${cityNameV2(world, a.targetCity)}」中`
          : a.stance === "engaged" ? `⚔️ 阵前绞杀中（第${a.engageRounds || 1}合）`
            : `行军趋「${cityNameV2(world, a.targetCity)}」（约 ${eta} 旬）`;
        return `
          <div class="v2-row-card">
            <div class="v2-row-top">
              <strong>${esc(o?.name || "大军")}${dep ? `·${esc(dep.name)}` : ""} · ${form.icon}${esc(form.name)} · ${sp.icon}${esc(sp.name)} ${a.troops.toLocaleString()} 人</strong>
              <span class="v2-badge">${a.supplyCut ? "⚡ 断粮" : "✅ 畅通"}</span>
            </div>
            <div class="v2-muted">${esc(stName)} · 士气 ${a.morale} · 余粮 ${a.grain} 石</div>
            <div style="display:flex;gap:0.4rem">
              <button type="button" class="v2-btn secondary" data-cmd-army="${esc(a.id)}">地图定位并指挥</button>
            </div>
          </div>`;
      }).join("") : `<p class="v2-muted">当前无外派野战军团，可在地图选择己城发兵出征。</p>`;

      body.querySelectorAll("[data-cmd-army]").forEach((btn) => {
        btn.addEventListener("click", () => {
          dialog.close();
          selectArmy(btn.dataset.cmdArmy, true);
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

      body.innerHTML = `
        <div class="v2-deal-card">
          <div class="v2-card-head">
            <h3>⚖️ 多边筹码谈判台 & 驱虎吞狼</h3>
            <span class="v2-badge">${dealEval.accepted ? `✅ 可成 (${dealEval.pct}%)` : `接受度 ${dealEval.pct}%`}</span>
          </div>
          <div class="v2-deal-meter"><i style="width:${dealEval.pct}%"></i></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:0.45rem">
            <div class="v2-field">
              <label>交涉势力</label>
              <select class="v2-select" id="deal-target">
                ${rivals.map(({ f }) => `<option value="${esc(f.key)}" ${dealDraft.target === f.key ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
              </select>
            </div>
            <div class="v2-field">
              <label>条约 / 纵横名目</label>
              <select class="v2-select" id="deal-type">
                <option value="truce" ${dealDraft.type === "truce" ? "selected" : ""}>停战和约 (18旬)</option>
                <option value="alliance" ${dealDraft.type === "alliance" ? "selected" : ""}>缔结同盟 (36旬)</option>
                <option value="instigate_war" ${dealDraft.type === "instigate_war" ? "selected" : ""}>🐺 驱虎吞狼（挑拨战火）</option>
                <option value="trade_grain_gold" ${dealDraft.type === "trade_grain_gold" ? "selected" : ""}>🌾 以金易粮</option>
                <option value="peace_cede" ${dealDraft.type === "peace_cede" ? "selected" : ""}>🕊️ 割城换和 (27旬)</option>
              </select>
            </div>
            ${dealDraft.type === "instigate_war" ? `
              <div class="v2-field">
                <label>驱使其攻打第三方</label>
                <select class="v2-select" id="deal-third">
                  ${rivals.filter((r) => r.f.key !== dealDraft.target).map(({ f }) => `<option value="${esc(f.key)}" ${dealDraft.thirdFactionKey === f.key ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
                </select>
              </div>` : ""}
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.45rem">
            <div class="v2-field">
              <label><span>随礼银两</span><strong>${dealDraft.gold} 钱</strong></label>
              <input type="range" id="deal-gold" min="0" max="${Math.max(50, Math.min(200, state.factions[state.player].treasury))}" step="5" value="${dealDraft.gold}">
            </div>
            <div class="v2-field">
              <label><span>随礼军粮</span><strong>${dealDraft.grain} 石</strong></label>
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
          <p class="v2-muted">评估依据：${dealEval.reasons.join(" · ") || "请配置筹码"}</p>
          <button type="button" class="v2-btn primary" id="btn-deal-submit" ${dealEval.accepted ? "" : "disabled"}>📜 遣使照会缔约</button>
        </div>

        <div class="v2-list-grid">${rivals.map(({ f, fs, tr }) => {
        const status = tr ? `${tr.kind === "alliance" ? "同盟" : "停战"}（余${tr.expires - state.turn}旬）` : "敌对 / 自由交锋";
        const allyBorderTargets = tr?.kind === "alliance"
          ? enemyCities.filter((ec) => Object.values(state.cities).some((ac) => ac.owner === f.key && cityByKey(world, ac.key).links.includes(ec.key)))
          : [];
        return `
          <div class="v2-row-card">
            <div class="v2-row-top">
              <strong><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${factionColor(f.key)};margin-right:4px"></span>${esc(f.name)}</strong>
              <span class="v2-badge">${esc(status)}</span>
            </div>
            <div class="v2-muted">${fs.cityCount} 城 · 总兵力 ${fs.totalTroops.toLocaleString()}</div>
            <div style="display:flex;flex-wrap:wrap;gap:0.35rem">
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
      }).join("")}</div>`;

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
      $("deal-target")?.addEventListener("change", (ev) => { dealDraft.target = ev.target.value; renderCourtDialog(); });
      $("deal-type")?.addEventListener("change", (ev) => { dealDraft.type = ev.target.value; renderCourtDialog(); });
      $("deal-third")?.addEventListener("change", (ev) => { dealDraft.thirdFactionKey = ev.target.value; renderCourtDialog(); });
      $("deal-gold")?.addEventListener("input", (ev) => { dealDraft.gold = Number(ev.target.value); });
      $("deal-gold")?.addEventListener("change", () => renderCourtDialog());
      $("deal-grain")?.addEventListener("input", (ev) => { dealDraft.grain = Number(ev.target.value); });
      $("deal-grain")?.addEventListener("change", () => renderCourtDialog());
      $("deal-cede")?.addEventListener("change", (ev) => { dealDraft.cedeCityKey = ev.target.value; renderCourtDialog(); });
      $("deal-cap")?.addEventListener("change", (ev) => { dealDraft.releaseCaptiveKey = ev.target.value; renderCourtDialog(); });
      $("btn-deal-submit")?.addEventListener("click", () => {
        const ok = applyCommand((s) => proposeDeal(world, s, dealDraft.target, dealDraft), "外交通好使团已圆满复命！");
        if (ok) renderCourtDialog();
      });
    } else if (courtTab === "captives") {
      const caps = state.captives || [];
      body.innerHTML = caps.length ? caps.map((c) => {
        const off = state.officers[c.officer];
        if (!off) return "";
        return `
          <div class="v2-row-card">
            <div class="v2-row-top">
              <strong>俘将「${esc(off.name)}」（原属${esc(factionNameV2(world, state, c.origFaction))}）</strong>
              <span class="v2-badge">统 ${off.command} · 武 ${off.might} · 政 ${off.governance}</span>
            </div>
            <div style="display:flex;gap:0.4rem">
              <button type="button" class="v2-btn primary" data-cap="${esc(c.officer)}:recruit">🎖️ 厚礼招降</button>
              <button type="button" class="v2-btn secondary" data-cap="${esc(c.officer)}:ransom">💰 放还勒赎</button>
              <button type="button" class="v2-btn quiet" data-cap="${esc(c.officer)}:release">🕊️ 义释(+4民心)</button>
            </div>
          </div>`;
      }).join("") : `<p class="v2-muted">监牢尚空，野战擒将或伏兵生擒敌将后可在此处招降或勒赎。</p>`;

      body.querySelectorAll("[data-cap]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const [offKey, action] = btn.dataset.cap.split(":");
          const ok = applyCommand((s) => resolveCaptive(s, offKey, action), "已处置在押敌将！");
          if (ok) renderCourtDialog();
        });
      });
    } else if (courtTab === "decrees") {
      const rp = rankProgressForFaction(state, state.player);
      const treasury = state.factions[state.player]?.treasury ?? 0;
      const enactedList = state.decrees?.[state.player] || [];
      const rankPct = rp.nextRank
        ? Math.min(100, Math.round((rp.cityCount / rp.nextRank.minCities) * 100))
        : 100;
      body.innerHTML = `
        <div class="v2-card">
          <div class="v2-card-head">
            <h3>👑 当前爵位：${esc(rp.current.title)}（领 ${rp.cityCount} / 44 城）</h3>
            <span class="v2-badge">已行国策 ${enactedList.length} / ${Object.keys(NATIONAL_DECREES_V2).length}</span>
          </div>
          <div class="v2-bar wall"><i style="width:${rankPct}%"></i></div>
          <p class="v2-muted">${rp.nextRank ? `距下一爵位「${esc(rp.nextRank.title)}」还需掌控 ${Math.max(0, rp.nextRank.minCities - rp.cityCount)} 城（共需 ${rp.nextRank.minCities} 城）。` : "已登天子大位，四海清平在望！"}</p>
        </div>
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
              <button type="button" class="v2-btn ${done ? "quiet" : "primary"}" data-enact-decree="${esc(d.id)}" ${(done || lockedCity || lowGold) ? "disabled" : ""}>
                ${done ? "✅ 政令已传四方" : lockedCity ? `尚需占领至 ${d.minCities} 城` : lowGold ? `国库银两不足 (${d.cost}钱)` : `📜 颁布国策 (${d.cost}钱)`}
              </button>
            </div>`;
        }).join("")}</div>`;

      body.querySelectorAll("[data-enact-decree]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.enactDecree;
          const ok = applyCommand((s) => enactDecree(world, s, id), `已颁布国家方略「${NATIONAL_DECREES_V2[id].name}」！`);
          if (ok) renderCourtDialog();
        });
      });
    } else if (courtTab === "chronicle") {
      const logs = (state.events || []).slice().reverse();
      body.innerHTML = logs.length ? logs.map((e) => {
        const c = formatCalendar(state.year, e.turn);
        return `<div class="v2-log-row" data-kind="${esc(e.kind || "system")}"><strong>[${esc(c.short)}]</strong> ${esc(e.text)}</div>`;
      }).join("") : `<p class="v2-muted">暂无战局纪录。</p>`;
    }
  }

  function openCourtDialog(tab = "officers") {
    courtTab = tab;
    const dialog = $("court-dialog");
    if (dialog && !dialog.open) dialog.showModal();
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
      dispatchDraft = { from: null, to: null, officer: null, troopType: null, troops: 800, siegeStance: "storm" };
      onNewGame(next);
      dialog?.close();
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
        onNewGame(loaded);
        dialog?.close();
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
    if (dialog && !dialog.open) dialog.showModal();
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
      dialog.close();
      openMenuDialog();
    });
    dialog.showModal();
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
    checkOutcomeDialog(state);
  }

  // Wire top-level buttons & tabs
  $("open-court")?.addEventListener("click", () => openCourtDialog("officers"));
  $("open-log")?.addEventListener("click", () => openCourtDialog("chronicle"));
  $("open-menu")?.addEventListener("click", () => openMenuDialog());
  $("seal-btn")?.addEventListener("click", () => openMenuDialog());

  $("court-tabs")?.querySelectorAll(".v2-tab").forEach((t) => {
    t.addEventListener("click", () => {
      courtTab = t.dataset.tab || "officers";
      renderCourtDialog();
    });
  });

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => $(btn.dataset.close)?.close());
  });

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
    openCourtDialog,
    openMenuDialog,
    showTicker,
    setOverlay(mode) { overlayMode = mode; },
  };
}
