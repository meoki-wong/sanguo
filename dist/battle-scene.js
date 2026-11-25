const width = 720;
const height = 284;
const center = width / 2;
const terrainSheets = {
  city: { column: 0, row: 1, label: "城防与攻城通道" },
  ford: { column: 0, row: 0, label: "江面与渡口" },
  pass: { column: 1, row: 0, label: "山隘与营垒" },
  camp: { column: 1, row: 1, label: "行军道与野战营地" },
};
const centurySheets = {
  city: { column: 0, row: 0 }, ford: { column: 1, row: 0 },
  pass: { column: 0, row: 1 }, camp: { column: 1, row: 1 },
};
const unitFrames = {
  infantry: [29, 126, 567, 428],
  cavalry: [647, 28, 561, 555],
  navy: [7, 654, 610, 503],
  wagon: [641, 698, 600, 483],
};
const artwork = new Map();

function loadArt(file) {
  if (!artwork.has(file)) {
    const image = new Image();
    image.src = new URL("./assets/" + file, import.meta.url);
    artwork.set(file, image);
  }
  return artwork.get(file);
}

function seasonBackdrop(location, season) {
  if (location === "ford" && ["spring", "summer"].includes(season)) return "river-mist";
  if (location === "pass" && season === "winter") return "snow-pass";
  if (location === "city" && ["spring", "summer"].includes(season)) return "rain-siege";
  if (location === "camp" && season === "autumn") return "autumn-camp";
  return null;
}

function paintLand(ctx, art, sheet, seasonal) {
  if (art.naturalWidth) {
    const cellWidth = Math.floor(art.naturalWidth / 2);
    const cellHeight = Math.floor(art.naturalHeight / 2);
    const crop = Math.min(cellHeight - 2, cellWidth * height / width);
    ctx.drawImage(art, sheet.column * cellWidth + 1, sheet.row * cellHeight + (cellHeight - crop) * (seasonal ? .34 : .56),
      cellWidth - 2, crop, 0, 0, width, height);
  } else {
    ctx.fillStyle = "#303631";
    ctx.fillRect(0, 0, width, height);
  }
  const light = ctx.createLinearGradient(0, 0, 0, height);
  light.addColorStop(0, "#0a1117a0");
  light.addColorStop(.46, "#15201d17");
  light.addColorStop(.74, "#181c1b12");
  light.addColorStop(1, "#0b1114b3");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, width, height);
}

function paintFormation(ctx, art, side, x, y, size, facing, focused) {
  ctx.save();
  ctx.translate(x, y);
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, size / 2);
  shadow.addColorStop(0, "#1116118c");
  shadow.addColorStop(1, "#11161100");
  ctx.save();
  ctx.scale(1, .24);
  ctx.fillStyle = shadow;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.restore();
  if (focused) {
    ctx.strokeStyle = "#ffe2accc";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.ellipse(0, -1, size * .43, size * .093, -.06, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.scale(facing, 1);
  if (art.naturalWidth) {
    const frame = unitFrames[side.kind] ?? unitFrames.infantry;
    const scaledHeight = size * frame[3] / frame[2];
    ctx.filter = "brightness(1.13) saturate(.8)";
    ctx.drawImage(art, ...frame, -size / 2, -scaledHeight, size, scaledHeight);
    ctx.filter = "none";
  } else {
    ctx.fillStyle = "#55534c";
    ctx.fillRect(-size * .23, -size * .25, size * .46, size * .22);
  }
  ctx.restore();
}

function positions(step, sides, winner) {
  if (step === 0) return [[163, 225], [557, 225]];
  if (step === 1) return [[304, 223], [416, 223]];
  const held = (index) => sides[index]?.faction === winner;
  return [[held(0) ? 277 : 119, 226], [held(1) ? 443 : 601, 226]];
}

function paintApproach(ctx, from, to, facing) {
  const length = (to - from) * facing;
  if (length <= 0) return;
  ctx.save();
  ctx.strokeStyle = "#faf0cb88";
  ctx.lineWidth = 1.25;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(from, 234);
  ctx.quadraticCurveTo(from + facing * length * .65, 244, to, 227);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(to - facing * 8, 226);
  ctx.lineTo(to, 227);
  ctx.lineTo(to - facing * 4, 234);
  ctx.stroke();
  ctx.restore();
}

function drawContact(ctx) {
  const cloud = ctx.createRadialGradient(center, 203, 1, center, 203, 58);
  cloud.addColorStop(0, "#dbc39b59");
  cloud.addColorStop(1, "#c7ae8c00");
  ctx.save();
  ctx.translate(center, 203);
  ctx.scale(1, .48);
  ctx.translate(-center, -203);
  ctx.fillStyle = cloud;
  ctx.fillRect(center - 58, 145, 116, 116);
  ctx.restore();
}

function drawStandard(ctx, side, x, y) {
  if (!side.color) return;
  ctx.fillStyle = "#222823de";
  ctx.strokeStyle = "#e6daae99";
  ctx.lineWidth = .8;
  ctx.fillRect(x - 7, y + 6, 14, 5);
  ctx.strokeRect(x - 7, y + 6, 14, 5);
  ctx.fillStyle = side.color;
  ctx.fillRect(x - 5.5, y + 7, 11, 3);
}

export function renderBattleScene({ terrain, site, from, to, sides, support = [], step = 0, siege, winner, focus, season, reign, century }) {
  const location = siege ? "city" : terrain === "river" ? "ford" : terrain === "pass" ? "pass" : "camp";
  const sheet = terrainSheets[location];
  const backdrop = seasonBackdrop(location, season);
  const file = century ? "century-battlefield.webp"
    : reign && backdrop !== "snow-pass" ? "campaign-terrain.webp"
      : backdrop ? "battlefield-seasons.webp" : "battlefield-atlas.webp";
  const ground = loadArt(file);
  const units = loadArt("battle-formations.webp");
  const canvas = document.createElement("canvas");
  canvas.className = "frontline-scene";
  const resolution = century && matchMedia("(max-width: 600px)").matches ? 1 : 2;
  canvas.width = width * resolution;
  canvas.height = height * resolution;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", [site ?? to, sheet.label, from + "至" + to].filter(Boolean).join("，"));
  const ctx = canvas.getContext("2d");
  const paint = () => {
    ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
    paintLand(ctx, ground, century ? centurySheets[location] : sheet, file !== "battlefield-atlas.webp");
    if (ground.naturalWidth) {
      canvas.dataset.terrainArt = location;
      if (file === "battlefield-seasons.webp") canvas.dataset.seasonTerrain = backdrop;
      if (file === "campaign-terrain.webp") canvas.dataset.campaignTerrain = location;
      if (century) canvas.dataset.centuryTerrain = location;
    }
    if (units.naturalWidth) canvas.dataset.unitArt = "formations";
    const anchors = positions(step, sides, winner);
    if (step === 1) {
      paintApproach(ctx, 177, 239, 1);
      paintApproach(ctx, 543, 481, -1);
      drawContact(ctx);
    }
    for (const [index, side] of support.slice(0, 3).entries()) {
      const [x, depth] = [[81, 170], [207, 160], [96, 241]][index];
      const y = side.kind === "navy" ? depth - 37 : depth;
      paintFormation(ctx, units, side, x, y, 72, 1, side.id === focus);
      drawStandard(ctx, side, x, y);
    }
    for (const [index, side] of sides.entries()) {
      const troops = Math.max(0, side.troops - (step === 2 ? side.loss ?? 0 : 0));
      if (!troops) continue;
      const position = side.slot ?? index;
      const [x, ground] = anchors[position];
      const y = side.kind === "navy" ? ground - 44 : ground;
      const size = Math.min(step === 1 ? 135 : 168, 69 + Math.sqrt(troops) * 1.28);
      const facing = position === 0 ? 1 : -1;
      if (troops >= 2200) paintFormation(ctx, units, side, x - 46 * facing, y - 39, size * .68, facing, false);
      paintFormation(ctx, units, side, x, y, size, facing, side.id != null && side.id === focus);
      drawStandard(ctx, side, x, y);
    }
  };
  paint();
  for (const image of [ground, units]) {
    if (!image.complete) image.addEventListener("load", () => { if (canvas.isConnected) paint(); }, { once: true });
  }
  return { canvas, terrainLabel: sheet.label };
}
