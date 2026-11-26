import { eraByYear, factionName, firstCity } from "./engine.js";
import { armyPhases, supplyRoute } from "./armies.js";
import { militaryView, roadTerrain, terrainLabels, townIntel } from "./war-intel.js";
import { polityColors } from "./polities-data.js";
import { crossings, dispatchRoute, gateOwner } from "./grand-logistics.js";
import { convoyRoute } from "./landscape-economy.js";
import { edgeWeather, seasonWeather } from "./landscape-terrain.js";
import { frontStatuses } from "./front-command.js";
import { postOwner, strategicPost, strategicPosts } from "./sandtable-posts.js";
import { hanEmperorStatus } from "./imperial.js";
import { formationKinds, formationOf } from "./frontline.js";
import { campaignStages } from "./high-command.js";
import { paintUnit, troopCanvas } from "./troop-art.js";
import { dynastyYield } from "./dynasty-economy.js";
import { strategicFronts9, theaterRoles9 } from "./strategy-nine.js";
import { marketRow } from "./reign-economy.js";
import { chokepointBetween, isCoalitionActive } from "./coalition.js";
import { supplyLinesForMap } from "./supply.js";
import { cityVisibility, isFogOfWarEnabled } from "./espionage.js";

const colors = {
  cao: "#416a91", wei: "#416a91", yuan: "#8c6a25", zhang: "#a55b42", shu: "#a1503a",
  biao: "#76588d", lu: "#984d67", ce: "#3d7965", wu: "#3d7965", ma: "#657743",
  gongsun: "#438089", shi: "#8d6446", jin: "#77548c", liu: "#a1503a", han: "#766191",
  dong: "#743f4c", jiu: "#937443", jian: "#386c56", yan: "#8f6346", yellow: "#a68b35", frontier: "#4e7a77",
  lvbu: "#b03a48", sima: "#565a8f",
};
const seasonalPalette = {
  spring: ["#c3cbb6", "#aec6bb", "#8faeab", "#e7d7b2"],
  summer: ["#c0c7ad", "#94b9b6", "#6a9ca4", "#d9d2a9"],
  autumn: ["#d6c6a4", "#b9c2a6", "#8aa4a2", "#e8d2a1"],
  winter: ["#d8ddd4", "#b2c5c8", "#91a9b7", "#e1dfce"],
};

export const forceColor = (key) => colors[key] || (key?.startsWith("spl-") ? polityColors[(Number(key.slice(4)) - 1) % polityColors.length] : "#776e57");

function pin(label, className) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.setAttribute("aria-label", label);
  return element;
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function intersects(a, b) {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

function labelBox(side, x, y, length) {
  const width = length * 12 + 8;
  if (side === "left") return [x - width - 8, y - 9, x - 8, y + 9];
  if (side === "top") return [x - width / 2, y - 25, x + width / 2, y - 8];
  if (side === "bottom") return [x - width / 2, y + 8, x + width / 2, y + 25];
  return [x + 8, y - 9, x + width + 8, y + 9];
}

export function createMap(world, stage, onCity, onLayer, onArmy, onTheater, onGate, onConvoy, onFront, onPost, onCampaign, onCivilConvoy, onHover) {
  const canvas = stage.querySelector("canvas");
  const markerLayer = stage.querySelector(".map-markers");
  const armyLayer = stage.querySelector("#army-markers");
  const grandLayer = stage.querySelector("#grand-markers");
  const frontLayer = document.createElement("div");
  frontLayer.className = "map-markers statecraft-front-layer";
  stage.append(frontLayer);
  const freightLayer = document.createElement("div");
  freightLayer.className = "map-markers dynasty-freight-markers";
  stage.append(freightLayer);
  let frontPins = [];
  let campaignPins = [];
  const ctx = canvas.getContext("2d");
  const [width, height] = world.view;
  const center = [width / 2, height / 2];
  const cityPositions = new Map(world.cities.map(({ key, position }) => [key, position]));
  const hull = (points) => [0, 1].map((axis) => points.reduce((n, point) => n + point[axis], 0) / points.length);
  const gates = crossings.map((entry) => {
    const token = pin(entry.name, "grand-gate-marker");
    token.textContent = entry.name;
    token.hidden = true;
    token.dataset.gate = entry.key;
    token.addEventListener("click", () => onGate?.(entry.key));
    grandLayer.append(token);
    return { entry, token, position: hull([cityPositions.get(entry.seat), cityPositions.get(entry.to)]) };
  });
  const posts = strategicPosts.map((entry) => {
    const token = pin(entry.name, "sandtable-post");
    token.textContent = entry.name;
    token.dataset.kind = entry.kind;
    token.dataset.post = entry.key;
    token.hidden = true;
    token.onclick = () => onPost?.(entry.key);
    grandLayer.append(token);
    return { entry, token, post: true, position: hull([cityPositions.get(entry.seat), cityPositions.get(entry.to)]) };
  });
  let roadPins = [];
  let pinSource;
  function refreshRoadPins() {
    if (pinSource?.state === mapState && pinSource.active === active) return;
    pinSource = { state: mapState, active };
    for (const { token } of roadPins) token.remove();
    roadPins = [];
    if (!mapState.landscape) return;
    const faction = mapState.player;
    const owned = (key) => mapState.cities[key].owner === faction;
    if (!Object.keys(mapState.cities).some(owned)) return;
    const from = active && owned(active) ? active : firstCity(world, mapState);
    const potential = world.cities.filter(({ key }) => key !== from && owned(key))
      .map(({ key }) => {
        const land = convoyRoute(world, mapState, faction, from, key, "land");
        const mode = land ? "land" : "water";
        return { from, to: key, mode, route: land ?? convoyRoute(world, mapState, faction, from, key, mode) };
      })
      .filter(({ route }) => route).sort((a, b) => a.route.length - b.route.length).slice(0, 5);
    const operations = mapState.landscape.convoys.filter((row) => row.faction === faction && row.status === "queued");
    const roads = [...operations, ...potential.filter((item) => !operations.some((row) => row.from === item.from && row.to === item.to))];
    for (const road of roads) {
      const { from, to, id, route } = road;
      const name = world.cities.find(({ key }) => key === from).name + "至" + world.cities.find(({ key }) => key === to).name + "粮道";
      const token = pin(name, "landscape-road-marker");
      token.textContent = id ? "运" : "粮";
      token.title = name;
      token.dataset.convoy = id ?? from + ":" + to;
      token.dataset.water = String(road.mode === "water");
      token.addEventListener("click", () => onConvoy?.({ from, to, id, mode: road.mode }));
      grandLayer.append(token);
      const index = Math.floor((route.length - 1) / 2);
      roadPins.push({ road, token, position: hull([cityPositions.get(route[index]), cityPositions.get(route[index + 1])]) });
    }
  }
  const provinces = [...new Set(world.cities.map(({ region }) => region))].map((region) => {
    const token = document.createElement("span");
    token.className = "grand-region-marker";
    token.textContent = region;
    token.hidden = true;
    grandLayer.append(token);
    return { token, position: hull(world.cities.filter((city) => city.region === region).map(({ position }) => position)) };
  });
  const field = [0, 1].map((axis) => {
    const coordinates = world.cities.map(({ position }) => position[axis]);
    const min = Math.min(...coordinates);
    const max = Math.max(...coordinates);
    return { center: (min + max) / 2, span: max - min + (axis === 0 ? 118 : 84) };
  });
  const relief = new Image();
  const land = new Path2D(world.land);
  const coast = new Path2D(world.coast);
  const grid = new Path2D(world.graticule);
  const mainRivers = new Path2D(world.rivers.major);
  const rivers = new Path2D(world.rivers.minor);
  const scenePaths = new Map(world.scenarios.map((era) => [
    era.year, {
      zones: Object.fromEntries(Object.entries(era.zones).map(([key, value]) => [key, new Path2D(value)])),
      outlines: Object.fromEntries(era.factions.map(({ key, path }) => [key, new Path2D(path)])),
    },
  ]));
  const camera = { zoom: 1, x: field[0].center, y: field[1].center };
  let cameraFrame = 0;
  const pointers = new Map();

  function cancelCameraAnimation() {
    if (cameraFrame) {
      cancelAnimationFrame(cameraFrame);
      cameraFrame = 0;
    }
  }

  function animateCamera(targetZoom, targetX, targetY, duration = 260) {
    cancelCameraAnimation();
    const toZoom = clamp(targetZoom, 1, 5);
    const xMargin = field[0].span / (2 * toZoom);
    const yMargin = field[1].span / (2 * toZoom);
    const toX = clamp(targetX, xMargin, width - xMargin);
    const toY = clamp(targetY, yMargin, height - yMargin);
    if (!mapState || matchMedia("(prefers-reduced-motion: reduce)").matches || duration <= 0) {
      camera.zoom = toZoom;
      camera.x = toX;
      camera.y = toY;
      restrictCamera();
      draw();
      return;
    }
    const fromZoom = camera.zoom;
    const fromX = camera.x;
    const fromY = camera.y;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      camera.zoom = fromZoom + (toZoom - fromZoom) * eased;
      camera.x = fromX + (toX - fromX) * eased;
      camera.y = fromY + (toY - fromY) * eased;
      restrictCamera();
      draw();
      if (t < 1) cameraFrame = requestAnimationFrame(tick);
      else cameraFrame = 0;
    };
    cameraFrame = requestAnimationFrame(tick);
  }
  let layer = "cities";
  let dynastyLayer = false;
  let reignMode;
  let reignImpact = new Map();
  let historicalFrame;
  let pressedSnapshot;
  let cityTouch;
  let mapState;
  let active;
  let target;
  let routeOrigin;
  let commandTargets;
  let routeType;
  let itinerary;
  let trade;
  let warRoute;
  let markers = [];
  let armyPins = [];
  let strategyImpact = [];
  let convoyPins = [];
  let freightPins = [];
  let garrisons = [];
  let theaterPins = [];
  let territories = [];
  let visibleRoster;
  let battlePulses = [];
  let pulseFrame = 0;
  let lastAnimatedTurn = null;

  function toView([x, y]) {
    return [(x - camera.x) * camera.zoom + center[0], (y - camera.y) * camera.zoom + center[1]];
  }

  function restrictCamera() {
    const xMargin = field[0].span / (2 * camera.zoom);
    const yMargin = field[1].span / (2 * camera.zoom);
    camera.x = clamp(camera.x, xMargin, width - xMargin);
    camera.y = clamp(camera.y, yMargin, height - yMargin);
  }

  function switchLayer(next) {
    layer = next;
    onLayer(next);
  }

  function scale(zoom, reference = center, destination = reference) {
    const x = camera.x + (reference[0] - center[0]) / camera.zoom;
    const y = camera.y + (reference[1] - center[1]) / camera.zoom;
    if (commandTargets || dynastyLayer || reignMode === "economy" || reignMode === "regions") {
      if (layer !== "cities") switchLayer("cities");
    } else if (mapState?.grand && Math.abs(zoom - camera.zoom) > .001) {
      switchLayer(zoom < 1.04 ? "factions" : zoom < 1.46 ? "roads" : "cities");
    } else {
      if (zoom > camera.zoom && zoom > 1.16) switchLayer("cities");
      if (zoom < camera.zoom && zoom < 1.04) switchLayer("factions");
    }
    camera.zoom = clamp(zoom, 1, 5);
    camera.x = x - (destination[0] - center[0]) / camera.zoom;
    camera.y = y - (destination[1] - center[1]) / camera.zoom;
    restrictCamera();
    draw();
  }

  function reset(next = "cities", smooth = false) {
    trade = undefined;
    warRoute = undefined;
    switchLayer(next);
    if (smooth && mapState) {
      animateCamera(1, field[0].center, field[1].center, 240);
    } else {
      cancelCameraAnimation();
      Object.assign(camera, { zoom: 1, x: field[0].center, y: field[1].center });
      draw();
    }
  }

  function rebuildMarkers(era) {
    markers = [];
    markerLayer.replaceChildren();
    for (const faction of era.factions) {
      const token = pin(faction.name, "country-pin");
      token.textContent = faction.key === "ma" ? "马韩" : faction.name;
      token.style.setProperty("--force", forceColor(faction.key));
      token.dataset.factionMarker = faction.key;
      token.addEventListener("click", () => {
        const city = firstCity(world, mapState, faction.key);
        if (mapState.cities[city].owner === faction.key) {
          locate(city);
          onCity(city);
        }
      });
      markers.push({ type: "faction", entry: faction, token });
      markerLayer.append(token);
    }
    for (const city of world.cities) {
      const token = pin("查看" + city.name, "city-pin");
      token.dataset.cityPin = city.key;
      token.dataset.side = "right";
      const dot = document.createElement("span");
      dot.className = "pin-dot";
      dot.setAttribute("aria-hidden", "true");
      const title = document.createElement("span");
      title.className = "city-name-tag";
      const labelText = document.createElement("span");
      labelText.textContent = city.name;
      const troopTag = document.createElement("span");
      troopTag.className = "city-troop-tag";
      title.append(labelText, troopTag);
      token.append(dot, title);
      token.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") onHover?.({ type: "city", key: city.key, x: event.clientX, y: event.clientY });
      });
      token.addEventListener("pointermove", (event) => {
        if (event.pointerType === "mouse") onHover?.({ type: "city", key: city.key, x: event.clientX, y: event.clientY });
      });
      token.addEventListener("pointerleave", () => onHover?.(null));
      token.addEventListener("click", (event) => {
        onHover?.(null);
        if (!event.detail) {
          onCity(city.key);
          return;
        }
        const point = cityTouch && event.timeStamp - cityTouch.time < 450 ? cityTouch : { x: event.clientX, y: event.clientY };
        cityTouch = undefined;
        // The closest visible pin owns the click when two hit areas overlap;
        // on narrow mobile viewports at low zoom, show a quick cluster picker if >= 2 pins collide.
        const candidates = markers
          .filter(({ type, token }) => type === "city" && !token.hidden)
          .map((marker) => {
            const box = marker.token.getBoundingClientRect();
            const distance = Math.hypot(point.x - box.left - box.width / 2, point.y - box.top - box.height / 2);
            return { key: marker.entry.key, name: marker.entry.name, distance };
          })
          .sort((a, b) => a.distance - b.distance);
        const clusterPicker = document.getElementById("map-cluster-picker");
        const nearGroup = candidates.filter((c) => c.distance <= 28).slice(0, 4);
        if (clusterPicker && nearGroup.length >= 2 && matchMedia("(max-width: 960px)").matches && camera.zoom < 1.85) {
          clusterPicker.replaceChildren(...nearGroup.map((item) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "quiet";
            btn.textContent = item.name;
            btn.addEventListener("click", () => {
              clusterPicker.hidden = true;
              onCity(item.key);
            });
            return btn;
          }));
          const sRect = stage.getBoundingClientRect();
          clusterPicker.style.left = `${clamp(point.x - sRect.left, 72, Math.max(72, sRect.width - 72))}px`;
          clusterPicker.style.top = `${clamp(point.y - sRect.top - 12, 48, Math.max(48, sRect.height - 48))}px`;
          clusterPicker.hidden = false;
          return;
        }
        if (clusterPicker) clusterPicker.hidden = true;
        const nearest = candidates[0] ?? { key: city.key, distance: Infinity };
        onCity(nearest.distance > 6 && event.target.closest(".city-name-tag") ? city.key : nearest.key);
      });
      markers.push({ type: "city", entry: city, token, title, troopTag });
      markerLayer.append(token);
    }
  }

  function rebuildTerritories(era) {
    const paths = scenePaths.get(era.year);
    const ownerAt = (key) => historicalFrame?.ownership[key] ?? mapState.cities[key].owner;
    territories = era.factions.map(({ key }) => {
      const cities = world.cities.filter((city) => ownerAt(city.key) === key);
      const original = world.cities.filter((city) => eraByYear(world, era.year).ownership[city.key] === key);
      const historical = paths.outlines[key] && cities.length === original.length && cities.every((city, index) => city.key === original[index].key);
      const path = historical ? paths.outlines[key] : new Path2D();
      if (!historical) for (const city of cities) path.addPath(paths.zones[city.key]);
      return { key, path, populated: cities.length > 0, cities };
    });
    const capitalsByFaction = new Map(era.factions.map(({ key }) => [key, firstCity(world, mapState, key)]));
    const queuedCities = new Set((mapState.orders ?? []).flatMap((order) => [order.city, order.from, order.to]).filter(Boolean));
    for (const { entry, token, type } of markers) {
      if (type === "city") {
        const owner = ownerAt(entry.key);
        const occupation = historicalFrame ? historicalFrame.distress.includes(entry.key) : mapState.cities[entry.key].occupation;
        token.style.setProperty("--force", forceColor(owner));
        token.dataset.owner = owner;
        token.dataset.capital = String(!historicalFrame && capitalsByFaction.get(owner) === entry.key);
        token.dataset.queued = String(!historicalFrame && queuedCities.has(entry.key));
        token.dataset.occupation = String(Boolean(occupation));
        token.setAttribute("aria-label", entry.name + " · " + factionName(era, owner) + (occupation ? " · 整顿中" : ""));
      } else {
        token.dataset.player = String(entry.key === mapState.player);
      }
    }
  }

  function rebuildFreights() {
    const previous = new Map(freightPins.map(({ id, city }) => [id, city]));
    const freights = dynastyLayer && !historicalFrame
      ? mapState?.dynasty?.convoys.filter((row) => row.side === mapState.player && ["march", "blocked"].includes(row.status)) : [];
    freightPins = (freights ?? []).map((freight) => {
      const { id, route, cursor, status, mode, to } = freight;
      const city = route[cursor];
      const kind = mode === "water" ? "navy" : "wagon";
      const destination = world.cities.find(({ key }) => key === to).name;
      const label = destination + (status === "blocked" ? "粮队受阻" : "粮队在途");
      const token = pin(label, "army-map-pin troop-pin convoy-troop-pin dynasty-freight-pin");
      token.dataset.civilFreight = id;
      token.dataset.visualKind = kind;
      token.dataset.blocked = String(status === "blocked");
      token.title = label;
      token.append(troopCanvas({ kind, color: "#966237", troops: 620 }), troopCanvas({ kind, color: "#966237", far: true }));
      token.onclick = () => onCivilConvoy?.(to);
      return { id, city, token, previous: previous.get(id) };
    });
    freightLayer.replaceChildren(...freightPins.map(({ token }) => token));
  }

  function rebuildArmies(era) {
    const leaders = new Map(era.officers.map(({ key, name }) => [key, name]));
    const oldPositions = new Map(armyPins.map(({ army }) => [army.officer, army.location]));
    const oldConvoys = new Map(convoyPins.map(({ id, end }) => [id, end]));
    const units = (militaryView(mapState).armies ?? []).filter((army) => !mapState.frontline || !army.observed || mapState.turn - army.seen <= 2);
    armyPins = units.map((army) => {
      const supply = !army.observed && supplyRoute(world, mapState, army);
      const kind = army.observed ? army.kind ?? "infantry" : formationOf(mapState, army.officer)?.kind ?? (army.travel === "water" ? "navy" : "infantry");
      const freshness = army.observed ? (mapState.turn === army.seen ? "本季侦见" : (mapState.turn - army.seen) + " 季前侦见")
        : armyPhases[army.phase] + (supply ? "" : " · 补给中断");
      const label = leaders.get(army.officer) + "军团 · " + (mapState.frontline && !army.observed ? formationKinds[kind] + " · " : "") + freshness;
      const token = pin(label, "army-map-pin");
      const art = { color: forceColor(army.faction), kind, troops: army.troops, faded: army.observed && mapState.turn !== army.seen };
      if (mapState.frontline) {
        token.classList.add("troop-pin");
        token.dataset.visualKind = kind;
        const direction = army.route[1] && cityPositions.get(army.route[1])?.[0] < cityPositions.get(army.location)?.[0];
        token.append(troopCanvas({ ...art, flip: direction }), troopCanvas({ ...art, far: true }));
      } else token.textContent = "军";
      token.title = label;
      token.dataset.armyOfficer = army.officer;
      token.dataset.cut = String(!supply && !army.observed);
      if (mapState.highCommand) token.dataset.phase = army.phase;
      token.style.setProperty("--force", forceColor(army.faction));
      token.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") onHover?.({ type: "army", army, label, kind, supply: Boolean(supply), x: event.clientX, y: event.clientY });
      });
      token.addEventListener("pointermove", (event) => {
        if (event.pointerType === "mouse") onHover?.({ type: "army", army, label, kind, supply: Boolean(supply), x: event.clientX, y: event.clientY });
      });
      token.addEventListener("pointerleave", () => onHover?.(null));
      token.addEventListener("click", () => { onHover?.(null); onArmy?.(army.officer); });
      return { army, supply, token, previous: oldPositions.get(army.officer) };
    });
    convoyPins = mapState.frontline ? mapState.landscape.convoys.filter((convoy) => convoy.faction === mapState.player
      && (convoy.status === "queued" || convoy.status === "delivered" && convoy.settled === mapState.turn - 1)).map((convoy) => {
      const shape = convoy.mode === "water" ? "navy" : "wagon";
      const label = (convoy.mode === "water" ? "运粮船队" : "辎重车队") + " · " + (convoy.status === "queued" ? "待发" : "已入库");
      const token = pin(label, "army-map-pin troop-pin convoy-troop-pin");
      token.dataset.visualKind = shape;
      token.dataset.convoyPin = convoy.id;
      token.title = label;
      token.append(troopCanvas({ kind: shape, color: "#a67436", troops: convoy.amount * 9 }),
        troopCanvas({ kind: shape, color: "#a67436", far: true }));
      token.onclick = () => onConvoy?.(convoy.route);
      const end = convoy.status === "delivered" ? convoy.route.at(-1) : convoy.route[0];
      const near = convoy.status === "delivered" ? convoy.route.at(-2) : convoy.route[1];
      return { token, end, near, id: convoy.id, previous: mapState.highCommand ? oldConvoys.get(convoy.id) : null };
    }) : [];
    if (mapState.century) for (const freight of mapState.reign.freights) {
      if (freight.side !== mapState.player || !["travel", "blocked"].includes(freight.status)) continue;
      const id = "market-" + freight.id;
      const kind = freight.mode === "water" ? "navy" : "wagon";
      const color = freight.status === "blocked" ? "#bb6e50" : "#ad8956";
      const label = (kind === "navy" ? "漕船" : "粮队") + " · " + freight.amount + " 粮 · " + (freight.status === "blocked" ? "受阻" : "在途");
      const token = pin(label, "army-map-pin troop-pin convoy-troop-pin");
      token.dataset.visualKind = kind;
      token.dataset.convoyPin = id;
      token.title = label;
      token.append(troopCanvas({ kind, color, troops: freight.amount * 18 }), troopCanvas({ kind, color, far: true }));
      const route = freight.route.slice(freight.cursor);
      token.onclick = () => onConvoy?.(route);
      convoyPins.push({ token, end: route[0], near: route[1], id, previous: oldConvoys.get(id) });
    }
    garrisons = mapState.frontline ? world.cities.flatMap(({ key, links }) => {
      const city = mapState.cities[key];
      const mine = city.owner === mapState.player;
      const intel = mine ? null : townIntel(mapState, mapState.player, key);
      if (!mine && (!intel?.troops || mapState.turn - intel.seen > 2)) return [];
      const troops = mine ? city.troops : Math.round((intel.troops[0] + intel.troops[1]) / 2);
      const naval = links.some((target) => edgeWeather(mapState, key, target).terrain === "river");
      return troops > 0 ? [{ key, mine, troops, naval, color: forceColor(city.owner), capital: firstCity(world, mapState, city.owner) === key }] : [];
    }) : [];
    stage.dataset.garrisons = String(garrisons.length);
    theaterPins = (mapState.theaters ?? []).map((plan) => {
      const color = plan.paused ? "#a65545" : ["#794629", "#17606a", "#645383"][plan.id - 1];
      const label = plan.name + (plan.paused ? " · 已暂停" : " · 战区");
      const token = pin(label, "theater-map-pin");
      token.textContent = plan.name;
      token.title = label;
      token.dataset.theaterPin = plan.id;
      token.style.setProperty("--theater", color);
      token.addEventListener("click", () => onTheater?.(plan.id));
      return { plan, color, token };
    });
    armyLayer?.replaceChildren(...[...armyPins, ...convoyPins, ...theaterPins].map(({ token }) => token));
    campaignPins = (mapState.highCommand?.campaigns ?? []).filter(({ side, stage }) => side === mapState.player && stage !== "ended")
      .map((row) => {
        const front = strategicFronts9(mapState).find(({ campaign }) => campaign === row.id);
        const site = strategicPost(row.target);
        const position = site ? cityPositions.get(site.seat).map((value, axis) => (value + cityPositions.get(site.to)[axis]) / 2) : cityPositions.get(row.point);
        const title = (site?.name ?? world.cities.find(({ key }) => key === row.point)?.name) + " · " + campaignStages[row.stage];
        const token = pin(title, "command-map-pin");
        const impact = strategyImpact.find(({ campaign }) => campaign === row.id);
        const label = front ? theaterRoles9[front.role] + " · " + campaignStages[row.stage] : campaignStages[row.stage];
        token.textContent = impact ? label + (impact.grain ? " 粮" + (impact.grain > 0 ? "+" : "") + impact.grain : " 粮±0") : label;
        token.title = title;
        token.dataset.campaignPin = row.id;
        if (front) {
          token.dataset.strategyFront = front.id;
          token.dataset.strategyRole = front.role;
          token.setAttribute("aria-label", theaterRoles9[front.role] + " · " + title);
        }
        if (impact) {
          token.dataset.strategyImpact = impact.grain < 0 || impact.money < 0 ? "cut" : "gain";
          token.title = impact.text;
        }
        token.dataset.urgent = String(Boolean(row.alert));
        token.onclick = () => onCampaign?.(row.id);
        return { row, token, position, front };
      });
    frontPins = (mapState.statecraft?.fronts ?? []).map((front) => {
      const name = world.cities.find(({ key }) => key === front.target).name;
      const title = name + "战线 · " + frontStatuses[front.status];
      const token = pin(title, "statecraft-front-pin");
      token.textContent = name + "战线";
      token.title = title;
      token.dataset.statecraftFront = String(front.id);
      token.dataset.status = front.status;
      token.onclick = () => onFront?.(front.id);
      return { token, front };
    });
    frontLayer.replaceChildren(...[...frontPins, ...campaignPins].map(({ token }) => token));
  }

  function fittedMap(rect) {
    const scale = Math.min(rect.width / field[0].span, rect.height / field[1].span);
    const spaceBelow = Math.max(0, rect.height - field[1].span * scale) * .3;
    return { scale, left: (rect.width - width * scale) / 2, top: (rect.height - height * scale) / 2 - spaceBelow };
  }

  function positionMarkers(rect, { scale, left, top }) {
    const visible = (x, y) => x >= 0 && x <= rect.width && y >= 0 && y <= rect.height;
    const originalOwnership = eraByYear(world, mapState.year).ownership;
    const placed = [];
    for (const { token, title, troopTag, type, entry } of markers) {
      const district = type === "faction" ? territories.find(({ key }) => key === entry.key) : null;
      const hasOriginalHolding = district?.cities.some(({ key }) => originalOwnership[key] === entry.key);
      const position = district?.populated && !hasOriginalHolding ? district.cities[0].position : entry.position;
      const [baseX, baseY] = toView(position);
      const inset = type === "city" ? 5 : 14;
      const x = clamp(left + baseX * scale, inset, rect.width - inset);
      const y = clamp(top + baseY * scale, inset, rect.height - inset);
      token.hidden = layer === "roads" || (layer === "cities") !== (type === "city") || !visible(left + baseX * scale, top + baseY * scale)
        || rect.width < 2 * inset || rect.height < 2 * inset;
      if (token.hidden) continue;
      token.style.left = x + "px";
      token.style.top = y + "px";
      if (type === "faction") {
        token.disabled = !district?.populated;
      } else {
        token.dataset.active = String(active === entry.key);
        if (commandTargets) token.dataset.commandTarget = String(commandTargets.has(entry.key));
        else delete token.dataset.commandTarget;
        token.setAttribute("aria-pressed", String(active === entry.key));
        if (troopTag) {
          const holding = mapState.cities[entry.key];
          const showNum = !historicalFrame && camera.zoom >= 1.35 && (holding.owner === mapState.player || !mapState.war);
          if (showNum) {
            troopTag.textContent = holding.troops >= 1000 ? (holding.troops / 1000).toFixed(1) + "k" : String(holding.troops);
          } else troopTag.textContent = "";
        }
        placed.push({ entry, token, title, x, y });
      }
    }
    const occupied = placed.map(({ x, y }) => [x - 5, y - 5, x + 5, y + 5]);
    const priority = ({ entry }) => entry.key === active ? 2 : commandTargets?.has(entry.key) ? 1 : 0;
    placed.sort((a, b) => priority(b) - priority(a));
    for (const { entry, token, title, x, y } of placed) {
      const side = ["right", "left", "top", "bottom"].find((side) => {
        const box = labelBox(side, x, y, entry.name.length);
        return box[0] >= 2 && box[1] >= 2 && box[2] <= rect.width - 2 && box[3] <= rect.height - 2
          && !occupied.some((other) => intersects(other, box));
      });
      title.hidden = !side;
      if (side) {
        token.dataset.side = side;
        occupied.push(labelBox(side, x, y, entry.name.length));
      }
    }
    const decorations = [];
    const placeFormation = (token, px, py, forward = 1) => {
      const touch = rect.width < 575;
      const radius = touch ? 15 : 17;
      token.hidden = Boolean(commandTargets) || !visible(px, py) || rect.width < 54 || rect.height < 45;
      if (token.hidden) return;
      const slots = [[23 * forward, -20], [-23 * forward, 20], [26 * forward, 20], [-23 * forward, -20], [0, 28]];
      const nearest = [...cityPositions.values()].map((position) => toView(position)).filter(([x, y]) =>
        Math.hypot(left + x * scale - px, top + y * scale - py) < 62);
      const bounds = ([x, y]) => [x - radius, y - radius, x + radius, y + radius];
      const candidates = slots.map(([dx, dy]) => [clamp(px + dx, radius, rect.width - radius), clamp(py + dy, radius, rect.height - radius)]);
      const position = candidates.find(([x, y]) => !nearest.some(([a, b]) => Math.hypot(left + a * scale - x, top + b * scale - y) < 18)
        && !decorations.some((other) => intersects(bounds([x, y]), other))) ?? candidates[0];
      decorations.push(bounds(position));
      token.dataset.far = String(layer === "factions" && camera.zoom <= 1.2);
      token.style.left = position[0] + "px";
      token.style.top = position[1] + "px";
    };
    for (const { token, city, previous } of freightPins) {
      const [x, y] = toView(cityPositions.get(city));
      placeFormation(token, left + x * scale, top + y * scale);
      if (!token.hidden && previous && previous !== city && !token.dataset.arrival
        && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const [px, py] = toView(cityPositions.get(previous));
        token.dataset.arrival = "true";
        token.animate([{ translate: ((px - x) * scale) + "px " + ((py - y) * scale) + "px" }, { translate: "0 0" }],
          { duration: 460, easing: "ease-out" });
      }
    }
    for (const [index, { army, token, previous }] of armyPins.entries()) {
      const [baseX, baseY] = toView(cityPositions.get(army.location));
      if (mapState.frontline) {
        const next = army.route[1] && cityPositions.get(army.route[1]);
        const posture = next && army.phase === "march" ? .16 : 0;
        const [nx, ny] = next ? toView(next) : [baseX, baseY];
        placeFormation(token, left + (baseX + (nx - baseX) * posture) * scale, top + (baseY + (ny - baseY) * posture) * scale,
          nx < baseX ? -1 : 1);
        if (!token.hidden && previous && previous !== army.location && !army.observed && !token.dataset.arrival
          && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const [ox, oy] = toView(cityPositions.get(previous));
          token.dataset.arrival = "true";
          token.animate([{ translate: ((ox - baseX) * scale) + "px " + ((oy - baseY) * scale) + "px" }, { translate: "0 0" }],
            { duration: 420, easing: "ease-out" });
        }
        continue;
      }
      const x = clamp(left + baseX * scale + 10 + index % 2 * 8, 10, rect.width - 10);
      const y = clamp(top + baseY * scale - 12, 10, rect.height - 10);
      token.hidden = layer !== "cities" || !visible(left + baseX * scale, top + baseY * scale)
        || rect.width < 20 || rect.height < 20;
      if (token.hidden) continue;
      token.style.left = x + "px";
      token.style.top = y + "px";
    }
    for (const { token, end, near, previous } of convoyPins) {
      const [x, y] = toView(cityPositions.get(end));
      const [a, b] = toView(cityPositions.get(near ?? end));
      placeFormation(token, left + (x + (a - x) * .42) * scale, top + (y + (b - y) * .42) * scale, a >= x ? 1 : -1);
      if (!token.hidden && previous && previous !== end && !token.dataset.arrival
        && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const [ox, oy] = toView(cityPositions.get(previous));
        token.dataset.arrival = "true";
        token.animate([{ translate: ((ox - x) * scale) + "px " + ((oy - y) * scale) + "px" }, { translate: "0 0" }],
          { duration: 580, easing: "ease-out" });
      }
    }
    for (const [index, { token, position }] of campaignPins.entries()) {
      const [x, y] = toView(position);
      const tx = left + x * scale, ty = top + y * scale;
      token.hidden = Boolean(commandTargets) || layer === "roads" || !visible(tx, ty) || rect.height < 85;
      if (token.hidden) continue;
      const half = Math.max(22, token.textContent.length * 6 + 6);
      const bounds = ([x, y]) => [x - half, y - 13, x + half, y + 13];
      const slots = [[-24, 34], [27, 34], [-35, -33], [34, -35], [-62, 20], [65, 20], [0, 49]];
      const points = slots.map(([dx, dy]) => [clamp(tx + dx + index * 5, half, rect.width - half),
        clamp(ty + dy, 18, rect.height - 15)]);
      const nearest = [...cityPositions.values()].map((position) => toView(position))
        .map(([x, y]) => [left + x * scale, top + y * scale]).filter(([x, y]) => Math.hypot(x - tx, y - ty) < 85);
      const positionOnScreen = points.find((point) => !decorations.some((box) => intersects(bounds(point), box))
        && !nearest.some(([x, y]) => Math.abs(x - point[0]) < half - 5 && Math.abs(y - point[1]) < 16)) ?? points[0];
      decorations.push(bounds(positionOnScreen));
      token.style.left = positionOnScreen[0] + "px";
      token.style.top = positionOnScreen[1] + "px";
    }
    const theaterLabels = [];
    for (const { plan, token } of theaterPins) {
      const [x, y] = toView(cityPositions.get(plan.seat ?? plan.depot));
      token.hidden = layer !== "factions" || !visible(left + x * scale, top + y * scale)
        || rect.width < 100 || rect.height < 24;
      if (token.hidden) continue;
      const halfWidth = Math.min(49, Math.max(24, plan.name.length * 6 + 6));
      const offsets = [[0, 12], [0, -13], [halfWidth, 12], [-halfWidth, -13], [0, 31]];
      const candidates = offsets.map(([dx, dy]) => [clamp(left + x * scale + dx, halfWidth, rect.width - halfWidth),
        clamp(top + y * scale + dy, 10, rect.height - 10)]);
      const bounds = ([labelX, labelY]) => [labelX - halfWidth, labelY - 9, labelX + halfWidth, labelY + 9];
      const position = candidates.find((candidate) => !theaterLabels.some((other) => intersects(bounds(candidate), other))) ?? candidates[0];
      theaterLabels.push(bounds(position));
      token.style.left = position[0] + "px";
      token.style.top = position[1] + "px";
    }
    const labels = [];
    for (const { front, token } of frontPins) {
      const [x, y] = toView(cityPositions.get(front.target));
      const px = left + x * scale;
      const py = top + y * scale;
      token.hidden = Boolean(commandTargets) || layer === "roads" || rect.height < 66 || !visible(px, py);
      if (token.hidden) continue;
      token.style.left = clamp(px, 43, rect.width - 43) + "px";
      token.style.top = clamp(py + 25, 38, rect.height - 12) + "px";
    }
    for (const { entry, position, token, road, post } of [...gates, ...posts, ...roadPins, ...provinces]) {
      const [x, y] = toView(position);
      let px = left + x * scale, py = top + y * scale;
      token.hidden = layer !== "roads" || !mapState.grand || !visible(px, py) || entry && Boolean(post) !== Boolean(mapState.sandtable);
      if (token.hidden) continue;
      const half = token.textContent.length * 6 + (road ? 7 : 4);
      const bounds = (x, y) => [x - half, y - 10, x + half, y + 10];
      const offset = [[0, 0], [0, 23], [0, -23], [24, 0], [-24, 0]].find(([dx, dy]) => visible(px + dx, py + dy)
        && px + dx >= half && px + dx <= rect.width - half && py + dy >= 10 && py + dy <= rect.height - 10
        && !labels.some((other) => intersects(bounds(px + dx, py + dy), other)));
      token.hidden = !offset;
      if (token.hidden) continue;
      px += offset[0];
      py += offset[1];
      labels.push(bounds(px, py));
      token.style.left = px + "px";
      token.style.top = py + "px";
      if (entry) {
        const hazard = edgeWeather(mapState, entry.seat, entry.to);
        token.dataset.closed = String(Boolean(mapState.sandtable?.posts[entry.key]?.closed)
          || mapState.grand.closed[entry.key] === gateOwner(mapState, entry) || hazard.blocked);
        if (post) token.dataset.own = String(postOwner(mapState, entry) === mapState.player);
        token.dataset.hazard = String(hazard.cost > 0);
        token.title = entry.name + " · " + hazard.label;
      }
    }
  }

  function trace(path, color, size, opacity = 1) {
    ctx.strokeStyle = color;
    ctx.lineWidth = size / camera.zoom;
    ctx.globalAlpha = opacity;
    ctx.stroke(path);
    ctx.globalAlpha = 1;
  }

  function drawArrowPath(coords, color, { dashed = false, badge = "" } = {}) {
    if (coords.length < 2) return;
    const link = new Path2D();
    link.moveTo(...coords[0]);
    for (const point of coords.slice(1)) link.lineTo(...point);
    if (dashed) {
      ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
      ctx.lineDashOffset = -((performance.now() * 0.018) % 20) / camera.zoom;
    }
    trace(link, "#fff1c7", 5.2, dashed ? .6 : .8);
    trace(link, color, 3.1, dashed ? .82 : .98);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    const chevrons = new Path2D();
    const arrowSize = 7 / camera.zoom;
    for (let i = 0; i < coords.length - 1; i++) {
      const [ax, ay] = coords[i];
      const [bx, by] = coords[i + 1];
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const angle = Math.atan2(by - ay, bx - ax);
      chevrons.moveTo(mx - Math.cos(angle - 0.55) * arrowSize, my - Math.sin(angle - 0.55) * arrowSize);
      chevrons.lineTo(mx, my);
      chevrons.lineTo(mx - Math.cos(angle + 0.55) * arrowSize, my - Math.sin(angle + 0.55) * arrowSize);
    }
    trace(chevrons, "#fff3cc", 4.2, .9);
    trace(chevrons, color, 2.2, 1);
    if (badge) {
      const [ax, ay] = coords[0];
      const [bx, by] = coords[1];
      const mx = ax + (bx - ax) * 0.34;
      const my = ay + (by - ay) * 0.34;
      const r = 7 / camera.zoom;
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fillStyle = "#201b14";
      ctx.fill();
      ctx.lineWidth = 1.4 / camera.zoom;
      ctx.strokeStyle = "#f4d28b";
      ctx.stroke();
      ctx.fillStyle = "#fff1c9";
      ctx.font = "700 " + (9.5 / camera.zoom) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(badge, mx, my + 0.5 / camera.zoom);
      ctx.restore();
    }
  }

  function drawRoutes() {
    if (layer !== "roads") {
      for (const [index, order] of (mapState.orders ?? []).entries()) {
        if (!["attack", "mobilize", "transfer"].includes(order.type)) continue;
        const pts = order.route?.length >= 2 ? order.route : [order.from, order.to];
        const coords = pts.map((site) => cityPositions.get(site)).filter(Boolean);
        const color = order.type === "transfer" ? "#267294" : "#c23b26";
        drawArrowPath(coords, color, { badge: String(index + 1) });
      }
    }
    const origin = world.cities.find(({ key }) => key === routeOrigin);
    if (!origin || layer !== "cities" || (camera.zoom < 1.6 && !target)) return;
    const web = new Path2D();
    for (const neighbor of world.cities.filter(({ key }) => origin.links.includes(key))) {
      web.moveTo(...origin.position);
      web.lineTo(...neighbor.position);
    }
    ctx.setLineDash([3.5 / camera.zoom, 3 / camera.zoom]);
    trace(web, "#6d4f2d", 1.5, .74);
    ctx.setLineDash([]);
    const route = itinerary ?? (target && origin.links.includes(target) ? [routeOrigin, target] : null);
    if (route) {
      const coords = route.map((site) => cityPositions.get(site)).filter(Boolean);
      const routeColor = routeType === "transfer" ? "#3b9bc4" : "#e35a39";
      drawArrowPath(coords, routeColor, { dashed: Boolean((mapState.orders ?? []).length) });
    }
  }

  function drawBattlePulses() {
    if (!battlePulses.length) return;
    const now = performance.now();
    const duration = 1600;
    battlePulses = battlePulses.filter((p) => now - p.start < duration);
    if (!battlePulses.length) {
      pulseFrame = 0;
      return;
    }
    for (const pulse of battlePulses) {
      const pos = cityPositions.get(pulse.city);
      if (!pos) continue;
      const t = (now - pulse.start) / duration;
      const radius = (6 + t * 24) / camera.zoom;
      const alpha = (1 - t) * 0.9;
      const ring = new Path2D();
      ring.arc(pos[0], pos[1], radius, 0, Math.PI * 2);
      trace(ring, pulse.kind === "capture" ? "#f4cc72" : "#e05b3e", 2.8, alpha);
      if (t < 0.65) {
        const inner = new Path2D();
        inner.arc(pos[0], pos[1], (3 + t * 14) / camera.zoom, 0, Math.PI * 2);
        trace(inner, "#fff3cf", 1.8, (0.65 - t));
      }
    }
  }

  function drawSagaOverlays() {
    if (!mapState?.century || !mapState.saga) return;
    const z = camera.zoom;
    const rumors = mapState.saga.rumors ?? {};
    for (const [cityKey, exp] of Object.entries(rumors)) {
      if (exp <= mapState.turn) continue;
      const pos = cityPositions.get(cityKey);
      if (!pos) continue;
      ctx.save();
      ctx.setLineDash([3.5 / z, 2.5 / z]);
      const ring = new Path2D();
      ring.arc(pos[0], pos[1], 13 / z, 0, Math.PI * 2);
      trace(ring, "#b580e8", 2.6, 0.92);
      ctx.restore();
    }

    if (isCoalitionActive(mapState)) {
      const co = mapState.saga.coalition;
      const era = eraByYear(world, mapState);
      const leaderCap = era.capitals?.[co.leader] ?? firstCity(world, mapState, co.leader);
      const pos = leaderCap ? cityPositions.get(leaderCap) : null;
      if (pos) {
        ctx.save();
        ctx.setLineDash([4 / z, 3 / z]);
        const ring = new Path2D();
        ring.arc(pos[0], pos[1], 16 / z, 0, Math.PI * 2);
        trace(ring, "#e85442", 3.0, 0.9);
        ctx.restore();
      }
    }

    // v18.0 沙盘粮道补给线、断粮警报、围城环与烽火迷雾罩
    if (mapState?.century && layer === "cities") {
      const supMap = supplyLinesForMap(world, mapState);
      ctx.save();
      for (const seg of supMap.lines) {
        const a = cityPositions.get(seg.from);
        const b = cityPositions.get(seg.to);
        if (!a || !b) continue;
        ctx.setLineDash([5 / z, 4 / z]);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.strokeStyle = seg.cut ? "rgba(232, 84, 66, 0.85)" : seg.strained ? "rgba(235, 168, 72, 0.72)" : "rgba(214, 180, 96, 0.56)";
        ctx.lineWidth = 2.0 / z;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const s of supMap.sieges) {
        const p = cityPositions.get(s.target);
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 14.5 / z, 0, Math.PI * 2);
        ctx.strokeStyle = "#e87a3e";
        ctx.lineWidth = 2.4 / z;
        ctx.stroke();
      }
      for (const ck of supMap.cutCities) {
        const p = cityPositions.get(ck);
        if (!p) continue;
        ctx.fillStyle = "rgba(180, 42, 34, 0.92)";
        ctx.beginPath();
        ctx.arc(p[0] + 9 / z, p[1] - 9 / z, 5.2 / z, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff5e6";
        ctx.font = `700 ${Math.max(6, 7.2 / z)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("断", p[0] + 9 / z, p[1] - 8.6 / z);
      }
      if (isFogOfWarEnabled(mapState)) {
        for (const c of world.cities) {
          if (cityVisibility(world, mapState, c.key) !== "fogged") continue;
          const p = cityPositions.get(c.key);
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(p[0], p[1], 13 / z, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(16, 18, 22, 0.52)";
          ctx.fill();
          ctx.fillStyle = "rgba(232, 220, 194, 0.85)";
          ctx.font = `700 ${Math.max(7, 9 / z)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("?", p[0], p[1] - 11 / z);
        }
      }
      ctx.restore();
    }

    if (layer === "cities" && z >= 1.35) {
      ctx.save();
      ctx.font = `600 ${Math.max(6.2, 8.2 / z)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const post of strategicPosts) {
        const cp = chokepointBetween(post.seat, post.to);
        if (!cp) continue;
        const a = cityPositions.get(post.seat);
        const b = cityPositions.get(post.to);
        if (!a || !b) continue;
        const mx = (a[0] + b[0]) * 0.5;
        const my = (a[1] + b[1]) * 0.5 - 5.5 / z;
        ctx.fillStyle = "rgba(18, 16, 13, 0.78)";
        const w = cp.name.length * (7.2 / z) + 6 / z;
        const h = 11 / z;
        ctx.fillRect(mx - w / 2, my - h / 2, w, h);
        ctx.strokeStyle = cp.tier === "pass" ? "rgba(235, 198, 118, 0.75)" : "rgba(116, 186, 214, 0.75)";
        ctx.lineWidth = 0.8 / z;
        ctx.strokeRect(mx - w / 2, my - h / 2, w, h);
        ctx.fillStyle = cp.tier === "pass" ? "#f5dea2" : "#b8e4f5";
        ctx.fillText(cp.name, mx, my + 0.5 / z);
      }
      ctx.restore();
    }
  }

  function drawStrategicLandmarks() {
    if (layer !== "cities") return;
    const z = camera.zoom;
    ctx.save();
    for (const post of strategicPosts) {
      if (post.kind !== "pass" && post.kind !== "port" && post.kind !== "ferry") continue;
      const a = cityPositions.get(post.seat);
      const b = cityPositions.get(post.to);
      if (!a || !b) continue;
      const mx = (a[0] + b[0]) * 0.5;
      const my = (a[1] + b[1]) * 0.5;
      const isPass = post.kind === "pass";
      const r = (isPass ? 3.2 : 2.5) / z;
      ctx.beginPath();
      if (isPass) {
        ctx.moveTo(mx, my - r);
        ctx.lineTo(mx + r, my);
        ctx.lineTo(mx, my + r);
        ctx.lineTo(mx - r, my);
        ctx.closePath();
        ctx.fillStyle = "#7c3024";
        ctx.strokeStyle = "#f2d08a";
      } else {
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fillStyle = "#225968";
        ctx.strokeStyle = "#b8e3eb";
      }
      ctx.lineWidth = 1.1 / z;
      ctx.fill();
      ctx.stroke();

      if (z >= 1.32) {
        ctx.font = "600 " + (Math.max(7.2, 8.8) / z) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.lineWidth = 2.4 / z;
        ctx.strokeStyle = "rgba(18, 16, 13, 0.85)";
        ctx.strokeText(post.name, mx, my - r - 1.5 / z);
        ctx.fillStyle = isPass ? "#f7dfb0" : "#cbeaf2";
        ctx.fillText(post.name, mx, my - r - 1.5 / z);
      }
    }
    ctx.restore();
  }

  function drawEmperorSeal() {
    if (historicalFrame || !mapState) return;
    const han = hanEmperorStatus(mapState);
    if (!han.active || !han.cityKey) return;
    const pos = cityPositions.get(han.cityKey);
    if (!pos) return;
    const z = camera.zoom;
    const sx = pos[0] - 9 / z;
    const sy = pos[1] - 9 / z;
    const r = 6.2 / z;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#b23626";
    ctx.fill();
    ctx.lineWidth = 1.4 / z;
    ctx.strokeStyle = "#f9df97";
    ctx.stroke();
    ctx.fillStyle = "#ffe9ad";
    ctx.font = "700 " + (8.4 / z) + "px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("帝", sx, sy + 0.4 / z);
    ctx.restore();
  }

  function drawArmyRoutes() {
    for (const { army, supply } of armyPins) {
      if (supply?.length > 1 && layer === "cities") {
        const road = new Path2D();
        road.moveTo(...cityPositions.get(supply[0]));
        for (const key of supply.slice(1)) road.lineTo(...cityPositions.get(key));
        ctx.setLineDash([3 / camera.zoom, 4 / camera.zoom]);
        trace(road, "#176773", 2.1, .86);
        ctx.setLineDash([]);
      }
      if (army.route.length < 2) continue;
      const road = new Path2D();
      road.moveTo(...cityPositions.get(army.location));
      for (const key of army.route.slice(1)) road.lineTo(...cityPositions.get(key));
      if (army.phase === "hold") ctx.setLineDash([4 / camera.zoom, 5 / camera.zoom]);
      trace(road, supply ? forceColor(army.faction) : "#9f4138", layer === "cities" ? 3.4 : 5, .88);
      ctx.setLineDash([]);
    }
  }

  function drawCampaigns() {
    for (const { row, position, front } of campaignPins) {
      const role = front?.role;
      const color = row.alert ? "#a5412c" : { offensive: "#913e2b", diversion: "#9a6337", escort: "#766a3a", defense: "#3c6660" }[role] ?? "#806039";
      const radius = (row.alert ? 19 : 15) / camera.zoom;
      const ring = new Path2D();
      ring.arc(...position, radius, 0, 2 * Math.PI);
      ctx.fillStyle = row.alert ? "#c25f2b30" : "#eabc7037";
      ctx.fill(ring);
      ctx.setLineDash([3 / camera.zoom, 2 / camera.zoom]);
      trace(ring, color, 1.4, .96);
      ctx.setLineDash([]);
      const army = armyPins.find(({ army }) => army.officer === row.commander && !army.observed)?.army;
      if (!army || army.route.length < 2 || army.phase !== "march" && army.phase !== "retreat") continue;
      const [x, y] = cityPositions.get(army.route[0]);
      const [endX, endY] = cityPositions.get(army.route[1]);
      const dx = endX - x, dy = endY - y;
      const angle = Math.atan2(dy, dx);
      const scale = 1 / camera.zoom;
      const arrows = new Path2D();
      for (const at of [.4, .65]) {
        const px = x + dx * at, py = y + dy * at;
        arrows.moveTo(px - Math.cos(angle - .6) * 8 * scale, py - Math.sin(angle - .6) * 8 * scale);
        arrows.lineTo(px, py);
        arrows.lineTo(px - Math.cos(angle + .6) * 8 * scale, py - Math.sin(angle + .6) * 8 * scale);
      }
      trace(arrows, "#f5e3b1", 3.7, .83);
      trace(arrows, army.phase === "retreat" ? "#a4583b" : "#3a5454", 1.85, 1);
    }
  }

  function drawTheaterLines() {
    if (layer !== "factions") return;
    for (const { plan, color } of theaterPins) {
      const route = new Path2D();
      const seat = plan.seat ?? plan.depot;
      for (const destination of new Set([...plan.cities, plan.target])) {
        if (destination === seat) continue;
        route.moveTo(...cityPositions.get(seat));
        route.lineTo(...cityPositions.get(destination));
      }
      ctx.setLineDash([5 / camera.zoom, 5 / camera.zoom]);
      trace(route, color, 2.7, .82);
      ctx.setLineDash([]);
    }
  }

  function drawTrade() {
    if (!trade) return;
    const route = new Path2D();
    route.moveTo(...cityPositions.get(trade.path[0]));
    for (const key of trade.path.slice(1)) route.lineTo(...cityPositions.get(key));
    ctx.setLineDash([6 / camera.zoom, 3 / camera.zoom]);
    trace(route, trade.blocked ? "#a23c31" : "#22634e", 4, .88);
    ctx.setLineDash([]);
    if (trade.blocked) {
      const [x, y] = cityPositions.get(trade.blocked);
      const marker = new Path2D();
      const size = 5 / camera.zoom;
      marker.moveTo(x - size, y - size);
      marker.lineTo(x + size, y + size);
      marker.moveTo(x + size, y - size);
      marker.lineTo(x - size, y + size);
      trace(marker, "#a23c31", 3);
    }
  }

  function drawWar() {
    if (!mapState.war) return;
    if (warRoute?.length > 1) {
      const path = new Path2D();
      path.moveTo(...cityPositions.get(warRoute[0]));
      for (const key of warRoute.slice(1)) path.lineTo(...cityPositions.get(key));
      trace(path, "#7f382c", 4.4, .88);
    }
    for (const { army } of armyPins) {
      if (!army.engagement && !(army.observed && army.target !== army.location)) continue;
      const path = new Path2D();
      const position = cityPositions.get(army.target);
      if (!position) continue;
      path.arc(...position, 8 / camera.zoom, 0, Math.PI * 2);
      trace(path, "#943c2e", 3.9, .9);
    }
    if (camera.zoom < 1.7 && !warRoute) return;
    ctx.font = (13 / camera.zoom) + "px sans-serif";
    ctx.textAlign = "center";
    for (const { key, links } of world.cities) for (const neighbor of links) {
      if (key > neighbor) continue;
      if (strategicPost([key, neighbor].sort().join(":"))) continue;
      const terrain = roadTerrain(key, neighbor);
      if (!terrain) continue;
      const a = cityPositions.get(key);
      const b = cityPositions.get(neighbor);
      const x = (a[0] + b[0]) / 2;
      const y = (a[1] + b[1]) / 2;
      ctx.fillStyle = "#f0dfb7";
      ctx.fillRect(x - 15 / camera.zoom, y - 11 / camera.zoom, 30 / camera.zoom, 14 / camera.zoom);
      ctx.fillStyle = terrain === "river" ? "#205465" : "#663f22";
      ctx.fillText(terrainLabels[terrain], x, y);
    }
  }

  function draw() {
    if (!mapState) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const pixels = [Math.round(rect.width * ratio), Math.round(rect.height * ratio)];
    if (canvas.width !== pixels[0]) canvas.width = pixels[0];
    if (canvas.height !== pixels[1]) canvas.height = pixels[1];
    const fit = fittedMap(rect);
    ctx.resetTransform();
    const palette = seasonalPalette[mapState.landscape ? seasonWeather(historicalFrame ? { ...mapState, turn: historicalFrame.turn - 1 } : mapState).key : "spring"];
    const water = ctx.createLinearGradient(0, 0, ...pixels);
    water.addColorStop(0, palette[0]);
    water.addColorStop(.58, palette[1]);
    water.addColorStop(1, palette[2]);
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, ...pixels);
    ctx.save();
    ctx.setTransform(fit.scale * ratio, 0, 0, fit.scale * ratio, fit.left * ratio, fit.top * ratio);
    ctx.translate(...center);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.fillStyle = palette[3];
    ctx.fill(land, "evenodd");
    trace(grid, "#819582", .6, .3);
    for (const { key, path, populated } of territories) {
      ctx.globalAlpha = key === mapState.player ? .6 : populated ? .43 : .16;
      ctx.fillStyle = forceColor(key);
      ctx.fill(path, "evenodd");
    }
    ctx.globalAlpha = 1;
    if (relief.naturalWidth) {
      ctx.save();
      ctx.clip(land, "evenodd");
      ctx.globalAlpha = .8;
      ctx.drawImage(relief, 0, 0, width, height);
      ctx.restore();
    }
    trace(coast, "#777f67", .85, .84);
    trace(rivers, "#567873", .75, .53);
    trace(mainRivers, "#537972", 1.18, .73);
    for (const { key, path, populated } of territories) {
      trace(path, forceColor(key), key === mapState.player ? 1.6 : 1, populated ? .86 : .35);
    }
    const zone = scenePaths.get(mapState.year).zones[active];
    if (zone && camera.zoom > 1.35) trace(zone, "#7d552b", 1.45, .8);
    if (!historicalFrame) {
      if (layer === "roads" && mapState.grand) {
        refreshRoadPins();
        drawStrategicRoads();
      } else {
        drawStrategicLandmarks();
      }
      drawRoutes();
      drawTheaterLines();
      drawArmyRoutes();
      if (layer === "factions") drawFronts();
      drawTrade();
      drawWar();
      if (campaignPins.length) drawCampaigns();
      if (mapState.frontline) drawGarrisons(fit);
      drawBattlePulses();
      drawEmperorSeal();
      drawSagaOverlays();
    }
    if (dynastyLayer && mapState.dynasty) drawDynasty(fit);
    if (reignMode && mapState.reign && !historicalFrame) drawReign(fit);
    ctx.restore();
    positionMarkers(rect, fit);
  }

  function drawReign(fit) {
    const scale = 1 / (fit.scale * camera.zoom);
    const player = mapState.player;
    const data = mapState.reign;
    if (reignMode === "diplomacy") {
      for (const group of data.leagues.filter(({ status, until }) => status === "active" && until > mapState.turn)) {
        const supporters = Object.keys(group.members).filter((key) => !group.members[key].suspended
          && world.cities.some(({ key: city }) => mapState.cities[city].owner === key));
        const root = cityPositions.get(firstCity(world, mapState, group.host));
        for (const key of supporters) {
          if (key === group.host) continue;
          const edge = new Path2D();
          edge.moveTo(...root);
          edge.lineTo(...cityPositions.get(firstCity(world, mapState, key)));
          trace(edge, "#e9e3b6", 6 * scale, .85);
          trace(edge, "#2f6a57", 3 * scale, .93);
        }
      }
      return;
    }
    if (reignMode === "war") return;
    if (reignMode === "economy") for (const freight of data.freights.filter(({ side, status }) => side === player
      && ["travel", "blocked"].includes(status))) {
      const rest = freight.route.slice(freight.cursor);
      const leg = new Path2D();
      leg.moveTo(...cityPositions.get(rest[0]));
      for (const key of rest.slice(1)) leg.lineTo(...cityPositions.get(key));
      trace(leg, "#292820", 6 * scale, .75);
      ctx.save();
      ctx.setLineDash([6 * scale, 4 * scale]);
      trace(leg, freight.status === "blocked" ? "#c4654b" : "#f9d294", 3 * scale, .97);
      ctx.restore();
      const [x, y] = cityPositions.get(rest[0]);
      if (!mapState.century) paintUnit(ctx, x + 10 * scale, y - 16 * scale, { kind: freight.mode === "water" ? "navy" : "wagon",
        color: "#884e2b", troops: 630, scale: scale * .58 });
    }
    for (const { key, region } of world.cities.filter(({ key }) => mapState.cities[key].owner === player)) {
      const [x, y] = cityPositions.get(key);
      const market = marketRow(mapState, key);
      const power = data.titles[region]?.charter ?? 0;
      const change = reignImpact.get(key);
      const stress = reignMode === "economy" ? market.cause !== "normal" : power >= 45;
      const storage = reignMode === "economy" ? market.bins : power;
      const ring = new Path2D();
      ring.arc(x, y, (6 + Math.min(8, Math.floor(storage / 8))) * scale, 0, 2 * Math.PI);
      trace(ring, "#292820", 4.8 * scale, .8);
      trace(ring, change < 0 || stress ? "#b74e3a" : change > 0 ? "#7da66a" : "#ddb67a", 2.4 * scale, .97);
      if (change && camera.zoom >= 1.5) {
        ctx.save();
        ctx.font = "600 " + 10 * scale + "px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#282720";
        ctx.fillRect(x - 12 * scale, y - 23 * scale, 24 * scale, 12 * scale);
        ctx.fillStyle = change < 0 ? "#ffd3a6" : "#e1edc4";
        ctx.fillText((change > 0 ? "+" : "") + change, x, y - 13 * scale);
        ctx.restore();
      }
    }
  }

  function drawDynasty(fit) {
    const size = 1 / (fit.scale * camera.zoom);
    const path = (keys, color) => {
      const points = keys.map((key) => cityPositions.get(key)).filter(Boolean);
      if (points.length < 2) return;
      const course = new Path2D();
      course.moveTo(...points[0]);
      for (const point of points.slice(1)) course.lineTo(...point);
      trace(course, "#2e2a20", 6 * size, .8);
      ctx.save();
      ctx.setLineDash([6 * size, 4 * size]);
      trace(course, color, 3 * size, .95);
      ctx.restore();
    };
    const freights = historicalFrame?.freights.map((row) => ({ ...row, cursor: 0 }))
      ?? mapState.dynasty.convoys.filter((row) => row.side === mapState.player && ["march", "blocked"].includes(row.status));
    for (const freight of freights) {
      const color = freight.status === "blocked" ? "#c35845" : "#f4cf8a";
      path(freight.route.slice(freight.cursor), color);
      const point = cityPositions.get(freight.route[freight.cursor]);
      if (historicalFrame && point) paintUnit(ctx, point[0] + 11 * size, point[1] - 13 * size, { kind: "wagon", color: "#8f5633", troops: 600, scale: size * .6 });
    }
    for (const unit of historicalFrame?.front ?? []) {
      path(unit.route, "#a9c5d6");
      const point = cityPositions.get(unit.city);
      if (point) paintUnit(ctx, point[0], point[1] + 12 * size,
        { kind: "infantry", color: forceColor(mapState.player), troops: 800, scale: size * .55 });
    }
    for (const { key } of world.cities) {
      const threatened = historicalFrame ? historicalFrame.distress.includes(key)
        : mapState.dynasty.sites[key]?.calamity || mapState.dynasty.restorations[key] || mapState.dynasty.withheld?.[key];
      const hold = (historicalFrame?.ownership[key] ?? mapState.cities[key].owner) === mapState.player;
      if (!hold || historicalFrame && !threatened) continue;
      const [x, y] = cityPositions.get(key);
      const stock = mapState.grand.depots[key] ?? 0;
      const level = mapState.cities[key].farming + dynastyYield(mapState, key).extra;
      const radius = (threatened ? 10 : stock > 0 ? 8 : 5 + Math.min(3, level)) * size;
      const ring = new Path2D();
      ring.arc(x, y, radius, 0, Math.PI * 2);
      trace(ring, "#2a3022", 4 * size, .82);
      trace(ring, threatened ? "#c5634a" : stock > 0 ? "#ffd692" : "#6d9d6d", 2 * size, .95);
    }
  }

  function drawGarrisons(fit) {
    const far = layer === "factions" && camera.zoom <= 1.2;
    const ratio = Math.max(.35, Math.min(.9, .65 * fit.scale * camera.zoom + .23)) / (fit.scale * camera.zoom);
    for (const { key, troops, mine, naval, capital, color } of garrisons) {
      if (far && !capital && troops < 1600) continue;
      const [x, y] = cityPositions.get(key);
      paintUnit(ctx, x - 9 * ratio, y + 11 * ratio, { kind: "infantry", color, troops, scale: ratio, far, faded: !mine });
      if (naval && !far && camera.zoom >= 1.25 && troops >= 850) {
        paintUnit(ctx, x + 16 * ratio, y + 15 * ratio, { kind: "navy", color, troops: Math.floor(troops / 3), scale: ratio * .65, faded: !mine });
      }
    }
  }

  function drawFronts() {
    for (const { front } of frontPins) {
      if (!["ready", "active", "blocked"].includes(front.status)) continue;
      const unit = mapState.armies?.find(({ officer }) => officer === front.officer);
      const route = unit?.route.length > 1 ? unit.route : [front.target];
      const path = new Path2D();
      path.moveTo(...cityPositions.get(route[0]));
      for (const key of route.slice(1)) path.lineTo(...cityPositions.get(key));
      trace(path, front.status === "blocked" ? "#984538" : "#684b2c", 4, .92);
      const [x, y] = cityPositions.get(front.target);
      const circle = new Path2D();
      circle.arc(x, y, 11 / camera.zoom, 0, 2 * Math.PI);
      trace(circle, "#fff0c3", 2.3, .94);
    }
    for (const war of mapState.sandtable?.wars ?? []) {
      if (war.status !== "fighting" || ![war.from, war.to].includes(mapState.player)) continue;
      const post = war.goal === "corridor" ? strategicPost(war.target) : null;
      const [x, y] = post ? hull([cityPositions.get(post.seat), cityPositions.get(post.to)]) : cityPositions.get(war.target);
      const circle = new Path2D();
      circle.arc(x, y, 17 / camera.zoom, 0, 2 * Math.PI);
      ctx.save();
      ctx.setLineDash([3 / camera.zoom, 3 / camera.zoom]);
      trace(circle, war.score >= 65 ? "#edca76" : "#aa4e3b", 3.4, .95);
      ctx.restore();
    }
  }

  function drawStrategicRoads() {
    const all = new Path2D();
    for (const { key, links, position } of world.cities) for (const to of links) {
      if (key >= to) continue;
      all.moveTo(...position);
      all.lineTo(...cityPositions.get(to));
    }
    trace(all, "#534d3a", 1.05, .74);
    if (mapState.landscape) {
      const streams = new Path2D();
      const flooded = new Path2D();
      const snowy = new Path2D();
      for (const { key, links, position } of world.cities) for (const neighbor of links) {
        if (key >= neighbor) continue;
        const hazard = edgeWeather(mapState, key, neighbor);
        const path = hazard.blocked ? flooded : hazard.terrain === "river" ? streams : hazard.cost ? snowy : null;
        if (!path) continue;
        path.moveTo(...position);
        path.lineTo(...cityPositions.get(neighbor));
      }
      trace(streams, "#477e84", 2.25, .86);
      trace(flooded, "#ab432d", 3, .93);
      trace(snowy, "#f2efe0", 3.4, .89);
    }
    for (const { entry } of mapState.sandtable ? posts : gates) {
      const edge = new Path2D();
      edge.moveTo(...cityPositions.get(entry.seat));
      edge.lineTo(...cityPositions.get(entry.to));
      const hazard = edgeWeather(mapState, entry.seat, entry.to);
      const closed = mapState.sandtable?.posts[entry.key]?.closed || mapState.grand.closed[entry.key] === gateOwner(mapState, entry) || hazard.blocked;
      trace(edge, closed ? "#a03826" : hazard.cost ? "#9b6c23" : "#2b594c", 2.4, .94);
    }
    for (const { road } of roadPins) {
      const line = new Path2D();
      line.moveTo(...cityPositions.get(road.route[0]));
      for (const key of road.route.slice(1)) line.lineTo(...cityPositions.get(key));
      ctx.save();
      ctx.setLineDash(road.id ? [] : [4 / camera.zoom, 3 / camera.zoom]);
      trace(line, road.mode === "water" ? "#3b819c" : "#f6d28b", road.id ? 3.9 : 2.4, .9);
      ctx.restore();
    }
    const routes = Object.entries(mapState.grand.districts).filter(([key, value]) => key.startsWith(mapState.player + ":") && value.depot);
    for (const [, { depot }] of routes) {
      if (mapState.cities[depot]?.owner !== mapState.player) continue;
      const route = dispatchRoute(world, mapState, mapState.player, depot);
      if (!route?.length) continue;
      const line = new Path2D();
      line.moveTo(...cityPositions.get(route[0]));
      for (const key of route.slice(1)) line.lineTo(...cityPositions.get(key));
      trace(line, "#f8d984", 3.6, .94);
    }
    ctx.save();
    for (const [key, grain] of Object.entries(mapState.grand.depots)) {
      if (!grain || mapState.cities[key].owner !== mapState.player) continue;
      const [x, y] = cityPositions.get(key);
      const radius = 3.5 / camera.zoom;
      ctx.fillStyle = "#f0c98f";
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      ctx.strokeStyle = "#582f22";
      ctx.lineWidth = 1.2 / camera.zoom;
      ctx.strokeRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.restore();
  }

  function locate(key) {
    const city = world.cities.find((entry) => entry.key === key);
    if (!city) return;
    switchLayer("cities");
    animateCamera(Math.max(2.15, camera.zoom), city.position[0], city.position[1], 280);
  }

  function relativePoint(event) {
    const rect = stage.getBoundingClientRect();
    const { scale, left, top } = fittedMap(rect);
    return [(event.clientX - rect.left - left) / scale, (event.clientY - rect.top - top) / scale];
  }

  function gestureFrame() {
    const [first, second] = pointers.values();
    if (!second) return [first, 0];
    return [[(first[0] + second[0]) / 2, (first[1] + second[1]) / 2], Math.hypot(second[0] - first[0], second[1] - first[1])];
  }

  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    cancelCameraAnimation();
    onHover?.(null);
    const sensitivity = event.deltaMode === 0 ? .00155 : .023;
    scale(camera.zoom * Math.exp(-event.deltaY * sensitivity), relativePoint(event));
  }, { passive: false });
  // Touch-generated click coordinates can snap several pixels toward the browser's hit target.
  stage.addEventListener("pointerup", (event) => {
    cityTouch = event.pointerType === "touch" && event.target.closest(".city-pin")
      ? { x: event.clientX, y: event.clientY, time: event.timeStamp } : undefined;
  }, { capture: true });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    cancelCameraAnimation();
    onHover?.(null);
    const point = relativePoint(event);
    if (!pointers.size) pressedSnapshot = point;
    pointers.set(event.pointerId, point);
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    const [before, distance] = gestureFrame();
    const point = relativePoint(event);
    pointers.set(event.pointerId, point);
    if (pointers.size === 1 && canvas.dataset.dragging !== "true"
      && Math.hypot(point[0] - pressedSnapshot[0], point[1] - pressedSnapshot[1]) < 6) return;
    canvas.dataset.dragging = "true";
    const [after, nextDistance] = gestureFrame();
    scale(camera.zoom * (distance > 1 ? nextDistance / distance : 1), before, after);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(name, (event) => {
      pointers.delete(event.pointerId);
      if (!pointers.size) delete canvas.dataset.dragging;
    });
  }
  relief.addEventListener("load", draw);
  relief.src = new URL("./assets/relief.webp", import.meta.url);
  new ResizeObserver(draw).observe(stage);

  // Lightweight seasonal weather particle overlay (pauses when hidden or reduced-motion)
  const weatherCanvas = document.createElement("canvas");
  weatherCanvas.className = "weather-canvas";
  weatherCanvas.setAttribute("aria-hidden", "true");
  stage.append(weatherCanvas);
  const wCtx = weatherCanvas.getContext("2d");
  const particles = Array.from({ length: 24 }, (_, i) => ({
    x: (i * 43) % 100,
    y: (i * 29) % 100,
    vx: 0.14 + (i % 4) * 0.05,
    vy: 0.25 + (i % 5) * 0.08,
    size: 1.8 + (i % 3) * 0.9,
    phase: i * 0.7,
  }));
  let lastWeatherTick = 0;
  function tickWeather(now) {
    requestAnimationFrame(tickWeather);
    if (document.hidden || !mapState?.century || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (now - lastWeatherTick < 42) return; // ~24fps low-power ambient
    lastWeatherTick = now;
    const rect = stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (weatherCanvas.width !== w || weatherCanvas.height !== h) {
      weatherCanvas.width = w;
      weatherCanvas.height = h;
    }
    wCtx.clearRect(0, 0, w, h);
    const seasonIdx = mapState.turn % 4; // 0 spring, 1 summer, 2 autumn, 3 winter
    const style = seasonIdx === 0 ? "rgba(247, 206, 218, 0.55)"
      : seasonIdx === 1 ? "rgba(164, 212, 232, 0.36)"
        : seasonIdx === 2 ? "rgba(226, 152, 74, 0.52)"
          : "rgba(238, 244, 250, 0.62)";
    wCtx.fillStyle = style;
    wCtx.strokeStyle = style;
    for (const p of particles) {
      const speed = seasonIdx === 1 ? 3.2 : seasonIdx === 3 ? 0.75 : 1;
      p.x = (p.x + p.vx * (seasonIdx === 1 ? 0.45 : 1)) % 100;
      p.y = (p.y + p.vy * speed) % 100;
      const px = (p.x / 100) * w + Math.sin(now * 0.001 + p.phase) * (seasonIdx === 1 ? 1 : 6);
      const py = (p.y / 100) * h;
      if (seasonIdx === 1) {
        wCtx.lineWidth = 1;
        wCtx.beginPath();
        wCtx.moveTo(px, py);
        wCtx.lineTo(px + 2, py + 8);
        wCtx.stroke();
      } else {
        wCtx.beginPath();
        wCtx.arc(px, py, p.size, 0, Math.PI * 2);
        wCtx.fill();
      }
    }
  }
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(tickWeather);

  return {
    reset,
    setReignMap(mode, impact = []) {
      reignMode = mode;
      reignImpact = new Map(impact.map(({ key, change }) => [key, change]));
      stage.dataset.reignLens = mode ?? "";
      draw();
    },
    showStrategicImpact(rows) {
      strategyImpact = rows;
      if (mapState) rebuildArmies(eraByYear(world, mapState));
      draw();
    },
    dynastyView(enabled, frame) {
      dynastyLayer = enabled;
      historicalFrame = frame;
      stage.dataset.dynastyLayer = String(enabled);
      stage.dataset.dynastyReplay = String(Boolean(frame));
      if (mapState) rebuildTerritories(eraByYear(world, mapState));
      rebuildFreights();
      draw();
    },
    setLayer(next) { switchLayer(next); draw(); },
    locate,
    showTrade(path, blocked) {
      trade = { path, blocked };
      draw();
    },
    showWarRoute(path) { warRoute = path; draw(); },
    zoom: (amount) => {
      const nextZoom = clamp(camera.zoom * amount, 1, 5);
      if (!commandTargets && !dynastyLayer && reignMode !== "economy" && reignMode !== "regions") {
        if (mapState?.grand && Math.abs(nextZoom - camera.zoom) > .001) {
          switchLayer(nextZoom < 1.04 ? "factions" : nextZoom < 1.46 ? "roads" : "cities");
        } else {
          if (nextZoom > camera.zoom && nextZoom > 1.16) switchLayer("cities");
          if (nextZoom < camera.zoom && nextZoom < 1.04) switchLayer("factions");
        }
      }
      animateCamera(nextZoom, camera.x, camera.y, 180);
    },
    show(state, selected, destination, route, path, command) {
      const changed = state !== mapState;
      mapState = state;
      active = selected;
      target = destination;
      routeOrigin = command?.from ?? selected;
      commandTargets = command?.targets;
      routeType = route;
      itinerary = path;
      const era = eraByYear(world, state);
      const roster = state.year + ":" + era.factions.map(({ key, name }) => key + name).join(",");
      if (visibleRoster !== roster) {
        visibleRoster = roster;
        rebuildMarkers(era);
      }
      if (changed) {
        strategyImpact = [];
        trade = undefined;
        warRoute = undefined;
        if (lastAnimatedTurn !== null && state.turn > lastAnimatedTurn && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const entries = state.history.at(-1)?.entries ?? [];
          const now = performance.now();
          const hits = entries.filter((e) => (e.type === "capture" || e.type === "battle") && e.city);
          if (hits.length) {
            battlePulses = hits.slice(0, 10).map((e) => ({ city: e.city, kind: e.type, start: now }));
            if (!pulseFrame) {
              const stepPulse = () => {
                pulseFrame = 0;
                if (!battlePulses.length) return;
                draw();
                if (battlePulses.length) pulseFrame = requestAnimationFrame(stepPulse);
              };
              pulseFrame = requestAnimationFrame(stepPulse);
            }
          }
        }
        lastAnimatedTurn = state.turn;
        rebuildTerritories(era);
        rebuildArmies(era);
        rebuildFreights();
      }
      draw();
    },
  };
}
