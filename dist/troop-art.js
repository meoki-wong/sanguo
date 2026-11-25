function fill(ctx, color, points) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fill();
}

function line(ctx, color, width, points) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.stroke();
}

function ellipse(ctx, color, x, y, a, b) {
  ctx.beginPath();
  ctx.ellipse(x, y, a, b, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function banner(ctx, color, x, y) {
  line(ctx, "#e9cf9a", 1, [[x, y + 21], [x, y]]);
  fill(ctx, "#2b251b", [[x, y], [x + 13, y - 1], [x + 10, y + 5], [x + 12, y + 10], [x, y + 10]]);
  fill(ctx, color, [[x + 1, y + 1], [x + 11, y], [x + 9, y + 5], [x + 10, y + 8], [x + 1, y + 9]]);
  line(ctx, "#e9cf9a", .8, [[x + 2, y + 2], [x + 8, y + 2]]);
}

function infantry(ctx, color) {
  ellipse(ctx, "#29271da0", 1, 7, 6, 2);
  line(ctx, "#211b16", 2, [[-2, 1], [-3, 7], [0, 7]]);
  line(ctx, "#211b16", 2, [[1, 1], [3, 7], [5, 7]]);
  fill(ctx, "#28201b", [[-3, -6], [3, -6], [5, 1], [-3, 3]]);
  fill(ctx, color, [[-3, -5], [2, -6], [3, 0], [-2, 1]]);
  line(ctx, "#d3bb83", .8, [[-2, -1], [2, -2]]);
  ellipse(ctx, "#e3bd84", -.2, -7.5, 1.6, 1.5);
  fill(ctx, "#292b2c", [[-3, -8], [-2, -11], [.8, -11], [2, -8]]);
  line(ctx, "#efd29c", 1, [[4, 6], [5, -12]]);
  fill(ctx, "#e8d4bc", [[4, -11], [5.5, -15], [7, -11]]);
}

function cavalry(ctx, color) {
  ellipse(ctx, "#211c15a0", 0, 6, 12, 2.4);
  line(ctx, "#362318", 2, [[-6, 1], [-8, 7], [-5, 7]]);
  line(ctx, "#362318", 2, [[4, -1], [7, 5], [6, 7]]);
  fill(ctx, "#583622", [[-10, -2], [-7, -6], [4, -5], [7, -10], [11, -9], [13, -6], [10, -4],
    [8, -5], [6, 1], [0, 4], [-8, 2]]);
  fill(ctx, "#a4683e", [[-8, -5], [-4, -6], [3, -5], [7, -8], [7, -4], [3, 0], [-4, 1], [-8, -1]]);
  line(ctx, "#2b2419", 1.8, [[-9, -3], [-12, 1], [-13, 4]]);
  fill(ctx, "#32251c", [[-4, -15], [0, -15], [3, -7], [1, 0], [-3, -3], [-4, -8]]);
  fill(ctx, color, [[-3, -14], [0, -14], [2, -8], [-3, -7]]);
  ellipse(ctx, "#d6a675", -1.4, -16, 1.8, 1.6);
  fill(ctx, "#2c2821", [[-4, -17], [-3, -20], [-.6, -21], [1, -17]]);
  line(ctx, "#e0c691", 1.1, [[-6, -7], [12, -16]]);
}

function ship(ctx, color) {
  ellipse(ctx, "#28373dc0", 0, 6, 16, 3.3);
  line(ctx, "#add2ca", 1.15, [[-17, 6], [-12, 8], [4, 9], [12, 7]]);
  fill(ctx, "#352821", [[-15, 0], [14, -3], [17, -7], [16, 1], [10, 6], [-10, 6]]);
  fill(ctx, "#a67347", [[-12, 0], [13, -2], [9, 3], [-10, 4]]);
  line(ctx, "#e6c08a", .9, [[-13, 0], [13, -2], [17, -7]]);
  line(ctx, "#533c26", 1.6, [[0, 3], [0, -24]]);
  fill(ctx, "#ebd2a2", [[-7, -20], [9, -21], [7, -10], [9, -7], [-8, -5], [-5, -12]]);
  fill(ctx, "#ab8759", [[4, -20], [9, -21], [7, -10], [9, -7], [3, -7], [2, -12]]);
  line(ctx, "#806343", .8, [[-6, -16], [8, -17]]);
  line(ctx, "#806343", .8, [[-6, -11], [7, -12]]);
  fill(ctx, color, [[0, -25], [10, -26], [7, -22], [0, -23]]);
}

function wagon(ctx, color) {
  ellipse(ctx, "#282017b0", 1, 7, 17, 3);
  line(ctx, "#291f14", 1.5, [[2, 0], [11, 0], [15, -3]]);
  fill(ctx, "#765037", [[6, -3], [10, -6], [15, -6], [17, -4], [18, -2], [15, -1], [14, 3], [12, 6], [11, 1], [8, 2], [7, 5]]);
  fill(ctx, "#cba27b", [[14, -5], [15, -8], [17, -7], [16, -5]]);
  fill(ctx, "#533820", [[-15, -4], [1, -5], [4, -1], [2, 4], [-12, 6]]);
  fill(ctx, "#d0ac72", [[-14, -5], [-13, -12], [-9, -15], [-3, -14], [1, -10], [2, -5]]);
  fill(ctx, "#9d7b50", [[-6, -14], [-3, -14], [1, -10], [2, -5], [-3, -5]]);
  line(ctx, color, 1.4, [[-13, -6], [1, -7]]);
  ellipse(ctx, "#37291e", -10, 4, 3.6, 3.6);
  ellipse(ctx, "#d3a468", -10, 4, 2.2, 2.2);
  ellipse(ctx, "#37291e", 0, 3, 3.6, 3.6);
  ellipse(ctx, "#d3a468", 0, 3, 2.2, 2.2);
}

export function paintUnit(ctx, x, y, { kind, color, troops = 500, scale = 1, far = false, flip = false, faded = false }) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale * (flip ? -1 : 1), scale);
  ctx.globalAlpha = faded ? .66 : 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (far) {
    ellipse(ctx, "#30261c70", 1, 7, 7, 2);
    banner(ctx, color, -3, -13);
  } else {
    const quantity = troops >= 2000 ? 3 : troops >= 950 ? 2 : 1;
    if (kind === "navy") {
      if (quantity > 1) {
        ctx.save();
        ctx.translate(-9, -7);
        ctx.scale(.65, .65);
        ship(ctx, color);
        ctx.restore();
      }
      ctx.translate(quantity > 1 ? 5 : 0, 0);
      ship(ctx, color);
    } else if (kind === "wagon") wagon(ctx, color);
    else {
      banner(ctx, color, -6, -19);
      for (let i = 0; i < quantity + (kind === "infantry" ? 1 : 0); i += 1) {
        ctx.save();
        ctx.translate((i % 2 ? -1 : 1) * (3 + 2.5 * i), (i - 2) * 4);
        ctx.scale(.84, .84);
        if (kind === "cavalry") cavalry(ctx, color);
        else infantry(ctx, color);
        ctx.restore();
      }
    }
  }
  ctx.restore();
}

export function troopCanvas(options) {
  const canvas = document.createElement("canvas");
  canvas.width = 112;
  canvas.height = 84;
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);
  paintUnit(ctx, 28, 27, options);
  return canvas;
}
