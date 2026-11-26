import { cityName, eraByYear, factionName, firstCity, forceTotals, gameOutcome } from "./engine.js";
import { officerService, officerSkill } from "./campaign.js";
import { frame15 } from "./century.js";
import { factionCourtProfile } from "./imperial.js";
import { knownOfficer } from "./personnel.js";
import { activeBondsForOfficer } from "./traits.js";

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export function generateImperialEpitaph(world, era, state) {
  const outcome = gameOutcome(state);
  const totals = forceTotals(state, state.player);
  const profile = factionCourtProfile(world, state, state.player);
  const rep = state.saga?.reputation ?? 50;
  const fName = factionName(era, state.player);
  const record = state.campaignRecord;
  const wins = record?.victories ?? 0;
  const defeats = record?.defeats ?? 0;

  let templeTitle = "创业未半";
  if (outcome === "victory") {
    if (state.scenarioEnding?.kind === "coalition" || state.scenarioEnding?.kind === "peace") {
      templeTitle = rep >= 65 ? "太宗 · 睦邻承平" : "高祖 · 盟会定局";
    } else if (state.imperialChoice === "loyalist") {
      templeTitle = "光武中兴 · 汉室柱石";
    } else if (rep >= 70) {
      templeTitle = "高祖武皇帝 · 仁武一统";
    } else if (rep >= 45) {
      templeTitle = "太祖烈皇帝 · 雄略定鼎";
    } else {
      templeTitle = "霸府雄主 · 威震四海";
    }
  } else if (outcome === "defeat") {
    templeTitle = totals.cities === 0 ? "社稷既墟 · 英雄惜败" : "偏安一隅";
  } else if (totals.cities >= 28) {
    templeTitle = `${profile.badge} · 定鼎可期`;
  } else if (totals.cities >= 14) {
    templeTitle = `${profile.badge} · 虎踞一方`;
  } else {
    templeTitle = `${profile.badge} · 经略初成`;
  }

  const stanceComment = rep >= 70
    ? "礼贤释俘，恩信著于四海；"
    : rep >= 45
      ? "赏罚明审，兼行权谋与政理；"
      : "严刑重威，虽克强敌而海内微惮；";
  const militaryComment = wins >= defeats * 2 && wins >= 4
    ? `大小 ${wins + defeats} 战而克捷 ${wins} 阵，兵锋所指莫之能当。`
    : wins > 0
      ? `历战 ${wins + defeats} 役，胜 ${wins} 负 ${defeats}，图谋中原不辍。`
      : "整军蓄势，静待天时。";
  const statusLine = outcome === "victory"
    ? `${fName}历 ${state.turn} 季而底定大局，收 ${totals.cities} 郡，功业垂诸青史。`
    : outcome === "defeat"
      ? `${fName}转战 ${state.turn} 季，终因强敌环伺失地覆没，遗恨千古。`
      : `${fName}今传 ${state.turn} 季，统辖 ${totals.cities} 城、带甲 ${(totals.troops).toLocaleString("zh-CN")} 人，正图天下之势。`;

  return {
    title: `${fName}本纪 · ${templeTitle}`,
    text: `${statusLine}${stanceComment}${militaryComment}`,
    stats: {
      turn: state.turn,
      cities: totals.cities,
      peak: record?.peak ?? totals.cities,
      victories: wins,
      defeats,
      reputation: rep,
    },
  };
}

export function createChronicleReplayController({ world, forceColor, getState }) {
  const dialog = document.getElementById("saga-chronicle-dialog");
  let timer = null;
  let playing = false;
  let speedMs = 700;
  let frames = [];
  let cursor = 0;
  let cityDots = new Map();

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    playing = false;
    const btn = document.getElementById("sc-play");
    if (btn) btn.textContent = "▶ 回放演变";
  }

  function buildFrames(state) {
    const era = eraByYear(world, state);
    const list = [{
      turn: 0,
      ownership: { ...era.ownership },
      label: `${state.year} 年春 · 开局版图`,
    }];
    const total = state.century?.frames?.length ?? 0;
    for (const row of state.century?.frames ?? []) {
      const unpacked = frame15(world, state, row.turn);
      if (unpacked) {
        const y = state.year + Math.floor(Math.max(0, row.turn - 1) / 4);
        const s = ["春", "夏", "秋", "冬"][Math.max(0, row.turn - 1) % 4];
        list.push({
          turn: row.turn,
          ownership: unpacked.ownership,
          label: `第 ${row.turn} 季（${y}年${s}）`,
        });
      }
    }
    if (total === 0 && state.turn > 0) {
      list.push({
        turn: state.turn,
        ownership: Object.fromEntries(Object.entries(state.cities).map(([k, c]) => [k, c.owner])),
        label: `第 ${state.turn} 季 · 当前版图`,
      });
    }
    return list;
  }

  function renderMapOnce(state) {
    const svg = document.getElementById("sc-map-svg");
    if (!svg) return;
    cityDots = new Map();
    const [vw, vh] = world.view || [780, 508];
    svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
    svg.replaceChildren();
    svg.append(
      svgEl("rect", { x: 0, y: 0, width: vw, height: vh, fill: "#13181e", rx: 8 }),
      svgEl("path", { d: world.land, fill: "#28261f", stroke: "#4a4332", "stroke-width": 1.2 }),
      svgEl("path", { d: world.rivers?.minor || "", fill: "none", stroke: "#2d4c63", "stroke-width": 0.9, opacity: 0.7 }),
      svgEl("path", { d: world.rivers?.major || "", fill: "none", stroke: "#3b6b8c", "stroke-width": 1.7, opacity: 0.85 }),
    );
    const linksGroup = svgEl("g", { stroke: "#5c5340", "stroke-width": 0.65, opacity: 0.45 });
    const seen = new Set();
    const byKey = new Map(world.cities.map((c) => [c.key, c]));
    for (const c of world.cities) {
      for (const n of c.links) {
        const id = [c.key, n].sort().join("-");
        if (seen.has(id)) continue;
        seen.add(id);
        const target = byKey.get(n);
        if (target) {
          linksGroup.append(svgEl("line", { x1: c.position[0], y1: c.position[1], x2: target.position[0], y2: target.position[1] }));
        }
      }
    }
    svg.append(linksGroup);
    const capital = firstCity(world, state);
    for (const c of world.cities) {
      const circle = svgEl("circle", {
        cx: c.position[0],
        cy: c.position[1],
        r: c.key === capital ? 6.2 : 4.6,
        fill: forceColor(state.cities[c.key]?.owner),
        stroke: "#efe2c0",
        "stroke-width": c.key === capital ? 1.5 : 0.75,
      });
      const title = svgEl("title");
      title.textContent = c.name;
      circle.append(title);
      svg.append(circle);
      cityDots.set(c.key, circle);
    }
  }

  function applyFrame(index) {
    if (!frames.length) return;
    cursor = Math.max(0, Math.min(frames.length - 1, index));
    const frame = frames[cursor];
    const state = getState();
    const era = eraByYear(world, state);
    const counts = new Map();
    for (const [key, owner] of Object.entries(frame.ownership)) {
      const dot = cityDots.get(key);
      if (dot) dot.setAttribute("fill", forceColor(owner));
      counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    document.getElementById("sc-frame-label").textContent = `${frame.label}（${cursor + 1} / ${frames.length} 帧）`;
    const slider = document.getElementById("sc-slider");
    if (slider) {
      slider.max = String(Math.max(0, frames.length - 1));
      slider.value = String(cursor);
    }
    const bar = document.getElementById("sc-power-bar");
    if (bar) {
      const total = Math.max(1, world.cities.length);
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      bar.replaceChildren(...sorted.map(([faction, n]) => {
        const seg = el("span", `${factionName(era, faction)} ${n}`, "sc-bar-seg");
        seg.style.width = `${Math.max(6, Math.round((n / total) * 100))}%`;
        seg.style.background = forceColor(faction);
        return seg;
      }));
    }
  }

  function renderHeroesAndAnnals(state) {
    const era = eraByYear(world, state);
    const epitaph = generateImperialEpitaph(world, era, state);
    document.getElementById("sc-epitaph-title").textContent = epitaph.title;
    document.getElementById("sc-epitaph-body").textContent = epitaph.text;

    const record = state.campaignRecord;
    const pool = era.officers
      .filter((o) => o.faction === state.player && knownOfficer(state, o))
      .map((o) => {
        const svc = officerService(state, o.key);
        const cmdNow = officerSkill(state, o, "command");
        const govNow = officerSkill(state, o, "governance");
        const fights = record?.people?.[o.key];
        const bonds = activeBondsForOfficer(era, state, state.player, o).bonds;
        const score = (fights ? fights.wins * 24 - fights.defeats * 6 : 0) + Math.round((cmdNow + govNow) * 0.4) + svc.governance + svc.command + (svc.governanceRank + svc.commandRank) * 15;
        return { o, cmdNow, govNow, svc, fights, bonds, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const heroesEl = document.getElementById("sc-heroes-list");
    if (heroesEl) {
      heroesEl.replaceChildren(...pool.map(({ o, cmdNow, govNow, fights, bonds }, idx) => {
        const li = el("li", undefined, "sc-hero-row");
        const rank = el("span", `${idx + 1}`, "sc-rank");
        const name = el("strong", o.name);
        const bondTag = bonds.length ? ` · ${bonds[0].name}` : "";
        const info = el("span", `统 ${cmdNow} / 政 ${govNow}${fights ? ` · ${fights.wins}胜${fights.defeats}负` : ""}${bondTag}`, "muted");
        li.append(rank, name, info);
        return li;
      }));
    }

    const annalsEl = document.getElementById("sc-annals-list");
    if (annalsEl) {
      const items = [...(state.saga?.annals ?? [])].reverse();
      if (!items.length) {
        annalsEl.replaceChildren(el("li", "暂无编年史事，随着征战与名士入仕将逐季记入《本纪》。", "muted"));
      } else {
        annalsEl.replaceChildren(...items.map((a) => {
          const li = el("li", undefined, "sc-annal-row");
          const tag = el("span", `第${a.turn}季 · ${a.tag}`, "memorial-tag");
          const txt = el("span", a.text);
          li.append(tag, txt);
          return li;
        }));
      }
    }
  }

  function startPlay() {
    if (frames.length <= 1) return;
    if (cursor >= frames.length - 1) cursor = 0;
    stopTimer();
    playing = true;
    document.getElementById("sc-play").textContent = "⏸ 暂停";
    timer = setInterval(() => {
      if (cursor >= frames.length - 1) {
        stopTimer();
        return;
      }
      applyFrame(cursor + 1);
    }, speedMs);
  }

  function open(stateArg = null) {
    const state = stateArg || getState();
    if (!dialog || !state) return;
    stopTimer();
    frames = buildFrames(state);
    renderMapOnce(state);
    applyFrame(frames.length - 1);
    renderHeroesAndAnnals(state);
    if (!dialog.open) dialog.showModal();
  }

  if (dialog) {
    document.getElementById("sc-play")?.addEventListener("click", () => {
      if (playing) stopTimer();
      else startPlay();
    });
    document.getElementById("sc-speed")?.addEventListener("click", (e) => {
      speedMs = speedMs === 700 ? 350 : speedMs === 350 ? 180 : 700;
      e.currentTarget.textContent = speedMs === 700 ? "1× 速" : speedMs === 350 ? "2× 速" : "4× 速";
      if (playing) startPlay();
    });
    document.getElementById("sc-slider")?.addEventListener("input", (e) => {
      stopTimer();
      applyFrame(Number(e.target.value));
    });
    document.getElementById("sc-close")?.addEventListener("click", () => {
      stopTimer();
      dialog.close();
    });
    dialog.addEventListener("cancel", stopTimer);
  }

  return { open, close: () => { stopTimer(); if (dialog?.open) dialog.close(); } };
}
