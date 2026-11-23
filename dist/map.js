import { eraByYear, factionName, firstCity } from "./engine.js";
import { armyPhases, supplyRoute } from "./armies.js";
import { militaryView, roadTerrain, terrainLabels } from "./war-intel.js";
import { polityColors } from "./polities-data.js";
import { crossings, dispatchRoute, gateOwner } from "./grand-logistics.js";

const colors = {
  cao: "#416a91", wei: "#416a91", yuan: "#8c6a25", zhang: "#a55b42", shu: "#a1503a",
  biao: "#76588d", lu: "#984d67", ce: "#3d7965", wu: "#3d7965", ma: "#657743",
  gongsun: "#438089", shi: "#8d6446", jin: "#77548c", liu: "#a1503a", han: "#766191",
  dong: "#743f4c", jiu: "#937443", jian: "#386c56", yan: "#8f6346",
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

export function createMap(world, stage, onCity, onLayer, onArmy, onTheater, onGate) {
  const canvas = stage.querySelector("canvas");
  const markerLayer = stage.querySelector(".map-markers");
  const armyLayer = stage.querySelector("#army-markers");
  const grandLayer = stage.querySelector("#grand-markers");
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
  const pointers = new Map();
  let layer = "cities";
  let pressedSnapshot;
  let mapState;
  let active;
  let target;
  let routeType;
  let itinerary;
  let trade;
  let warRoute;
  let markers = [];
  let armyPins = [];
  let theaterPins = [];
  let territories = [];
  let visibleRoster;

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
    if (mapState?.grand && Math.abs(zoom - camera.zoom) > .001) {
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

  function reset(next = "cities") {
    trade = undefined;
    warRoute = undefined;
    switchLayer(next);
    Object.assign(camera, { zoom: 1, x: field[0].center, y: field[1].center });
    draw();
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
      title.textContent = city.name;
      token.append(dot, title);
      token.addEventListener("click", (event) => {
        if (!event.detail || event.target.closest(".city-name-tag")) {
          onCity(city.key);
          return;
        }
        // The closest visible pin owns the click when two hit areas overlap.
        const nearest = markers.filter(({ type, token }) => type === "city" && !token.hidden)
          .reduce((match, marker) => {
            const box = marker.token.getBoundingClientRect();
            const distance = Math.hypot(event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2);
            return distance < match.distance ? { key: marker.entry.key, distance } : match;
          }, { key: city.key, distance: Infinity });
        onCity(nearest.key);
      });
      markers.push({ type: "city", entry: city, token, title });
      markerLayer.append(token);
    }
  }

  function rebuildTerritories(era) {
    const paths = scenePaths.get(era.year);
    territories = era.factions.map(({ key }) => {
      const cities = world.cities.filter((city) => mapState.cities[city.key].owner === key);
      const original = world.cities.filter((city) => eraByYear(world, era.year).ownership[city.key] === key);
      const historical = paths.outlines[key] && cities.length === original.length && cities.every((city, index) => city.key === original[index].key);
      const path = historical ? paths.outlines[key] : new Path2D();
      if (!historical) for (const city of cities) path.addPath(paths.zones[city.key]);
      return { key, path, populated: cities.length > 0, cities };
    });
    for (const { entry, token, type } of markers) {
      if (type === "city") {
        const { owner, occupation } = mapState.cities[entry.key];
        token.style.setProperty("--force", forceColor(owner));
        token.dataset.owner = owner;
        token.dataset.occupation = String(Boolean(occupation));
        token.setAttribute("aria-label", entry.name + " · " + factionName(era, owner) + (occupation ? " · 整顿中" : ""));
      } else {
        token.dataset.player = String(entry.key === mapState.player);
      }
    }
  }

  function rebuildArmies(era) {
    const leaders = new Map(era.officers.map(({ key, name }) => [key, name]));
    armyPins = (militaryView(mapState).armies ?? []).map((army) => {
      const supply = !army.observed && supplyRoute(world, mapState, army);
      const label = leaders.get(army.officer) + "军团 · " + (army.observed ? "侦见" : armyPhases[army.phase] + (supply ? "" : " · 补给中断"));
      const token = pin(label, "army-map-pin");
      token.textContent = "军";
      token.title = label;
      token.dataset.armyOfficer = army.officer;
      token.dataset.cut = String(!supply && !army.observed);
      token.style.setProperty("--force", forceColor(army.faction));
      token.addEventListener("click", () => onArmy?.(army.officer));
      return { army, supply, token };
    });
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
    armyLayer?.replaceChildren(...[...armyPins, ...theaterPins].map(({ token }) => token));
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
    for (const { token, title, type, entry } of markers) {
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
        token.setAttribute("aria-pressed", String(active === entry.key));
        placed.push({ entry, token, title, x, y });
      }
    }
    const occupied = placed.map(({ x, y }) => [x - 5, y - 5, x + 5, y + 5]);
    placed.sort((a, b) => Number(b.entry.key === active) - Number(a.entry.key === active));
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
    for (const [index, { army, token }] of armyPins.entries()) {
      const [baseX, baseY] = toView(cityPositions.get(army.location));
      const x = clamp(left + baseX * scale + 10 + index % 2 * 8, 10, rect.width - 10);
      const y = clamp(top + baseY * scale - 12, 10, rect.height - 10);
      token.hidden = layer !== "cities" || !visible(left + baseX * scale, top + baseY * scale)
        || rect.width < 20 || rect.height < 20;
      if (token.hidden) continue;
      token.style.left = x + "px";
      token.style.top = y + "px";
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
    for (const { entry, position, token } of [...gates, ...provinces]) {
      const [x, y] = toView(position);
      const px = left + x * scale, py = top + y * scale;
      token.hidden = layer !== "roads" || !mapState.grand || !visible(px, py);
      if (token.hidden) continue;
      const half = token.textContent.length * 6 + 3;
      const box = [px - half, py - 7, px + half, py + 7];
      token.hidden = labels.some((other) => intersects(box, other));
      if (token.hidden) continue;
      labels.push(box);
      token.style.left = px + "px";
      token.style.top = py + "px";
      if (entry) token.dataset.closed = String(mapState.grand.closed[entry.key] === gateOwner(mapState, entry));
    }
  }

  function trace(path, color, size, opacity = 1) {
    ctx.strokeStyle = color;
    ctx.lineWidth = size / camera.zoom;
    ctx.globalAlpha = opacity;
    ctx.stroke(path);
    ctx.globalAlpha = 1;
  }

  function drawRoutes() {
    const origin = world.cities.find(({ key }) => key === active);
    if (!origin || layer !== "cities" || (camera.zoom < 1.6 && !target)) return;
    const web = new Path2D();
    for (const neighbor of world.cities.filter(({ key }) => origin.links.includes(key))) {
      web.moveTo(...origin.position);
      web.lineTo(...neighbor.position);
    }
    ctx.setLineDash([3.5 / camera.zoom, 3 / camera.zoom]);
    trace(web, "#6d4f2d", 1.5, .74);
    ctx.setLineDash([]);
    const route = itinerary ?? (target && origin.links.includes(target) ? [active, target] : null);
    if (route) {
      const link = new Path2D();
      link.moveTo(...origin.position);
      for (const site of route.slice(1)) link.lineTo(...world.cities.find(({ key }) => key === site).position);
      trace(link, routeType === "transfer" ? "#215c79" : "#903b27", 3);
    }
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
    const water = ctx.createLinearGradient(0, 0, ...pixels);
    water.addColorStop(0, "#c3cbb6");
    water.addColorStop(.58, "#aec6bb");
    water.addColorStop(1, "#8faeab");
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, ...pixels);
    ctx.save();
    ctx.setTransform(fit.scale * ratio, 0, 0, fit.scale * ratio, fit.left * ratio, fit.top * ratio);
    ctx.translate(...center);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.fillStyle = "#e7d7b2";
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
    if (layer === "roads" && mapState.grand) drawStrategicRoads();
    drawRoutes();
    drawTheaterLines();
    drawArmyRoutes();
    drawTrade();
    drawWar();
    ctx.restore();
    positionMarkers(rect, fit);
  }

  function drawStrategicRoads() {
    const all = new Path2D();
    for (const { key, links, position } of world.cities) for (const to of links) {
      if (key >= to) continue;
      all.moveTo(...position);
      all.lineTo(...cityPositions.get(to));
    }
    trace(all, "#534d3a", 1.05, .74);
    for (const { entry } of gates) {
      const edge = new Path2D();
      edge.moveTo(...cityPositions.get(entry.seat));
      edge.lineTo(...cityPositions.get(entry.to));
      trace(edge, mapState.grand.closed[entry.key] === gateOwner(mapState, entry) ? "#9c3922" : "#2b594c", 2.4, .94);
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
    camera.zoom = Math.max(2.15, camera.zoom);
    [camera.x, camera.y] = city.position;
    restrictCamera();
    draw();
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
    const sensitivity = event.deltaMode === 0 ? .00155 : .023;
    scale(camera.zoom * Math.exp(-event.deltaY * sensitivity), relativePoint(event));
  }, { passive: false });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
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

  return {
    reset,
    setLayer(next) { switchLayer(next); draw(); },
    locate,
    showTrade(path, blocked) {
      trade = { path, blocked };
      draw();
    },
    showWarRoute(path) { warRoute = path; draw(); },
    zoom: (amount) => scale(camera.zoom * amount),
    show(state, selected, destination, route, path) {
      const changed = state !== mapState;
      mapState = state;
      active = selected;
      target = destination;
      routeType = route;
      itinerary = path;
      const era = eraByYear(world, state);
      const roster = state.year + ":" + era.factions.map(({ key, name }) => key + name).join(",");
      if (visibleRoster !== roster) {
        visibleRoster = roster;
        rebuildMarkers(era);
      }
      if (changed) {
        trade = undefined;
        warRoute = undefined;
        rebuildTerritories(era);
        rebuildArmies(era);
      }
      draw();
    },
  };
}
