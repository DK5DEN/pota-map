/**
 * Symbols for the OpenStreetMap points, drawn at runtime.
 *
 * Not a sprite: a sprite would need a build step of its own and a second
 * sprite file next to the one Protomaps ships, and half of what is drawn here
 * (bench, bunker, information board, pylon) does not exist in any of the usual
 * icon sets anyway. Drawing them into a canvas costs a few milliseconds once
 * per style and keeps everything in one file that also works offline.
 *
 * Each symbol is a filled disc in the colour of its group with a white glyph
 * on it. The disc carries the group, the glyph carries the kind - that way a
 * symbol stays readable at 20 pixels, where a detailed drawing turns to mush.
 */

const SIZE = 22;          // logical pixels
const RATIO = 2;          // drawn twice as large for high resolution screens

/* Every glyph draws inside a 22x22 box whose centre is 11,11. Stroke width and
   colour are set by the caller, so the shapes below only describe the form. */
const GLYPHS = {
  parking: (c) => letter(c, "P"),
  toilets: (c) => letter(c, "WC", 7),

  transit: (c) => {
    roundRect(c, 6, 5.5, 10, 8, 1.5);
    c.stroke();
    c.beginPath();
    c.moveTo(6.5, 10);
    c.lineTo(15.5, 10);
    c.stroke();
    dot(c, 8, 15, 1.1);
    dot(c, 14, 15, 1.1);
  },

  bench: (c) => {
    line(c, 5, 9, 17, 9);
    line(c, 5, 12, 17, 12);
    line(c, 7, 12, 7, 16);
    line(c, 15, 12, 15, 16);
  },

  // A bench you lie on: the same slats, with the back end raised.
  lounger: (c) => {
    line(c, 4, 13, 16, 13);
    line(c, 12, 13, 17, 8);
    line(c, 6, 13, 6, 16);
    line(c, 14, 13, 14, 16);
  },

  shelter: (c) => {
    line(c, 4, 10, 11, 5);
    line(c, 11, 5, 18, 10);
    line(c, 6, 11, 6, 17);
    line(c, 16, 11, 16, 17);
  },

  hut: (c) => {
    line(c, 4, 11, 11, 5);
    line(c, 11, 5, 18, 11);
    roundRect(c, 6, 11, 10, 6, 0.5);
    c.stroke();
  },

  picnic: (c) => {
    line(c, 4, 8, 18, 8);
    line(c, 6, 8, 4, 17);
    line(c, 16, 8, 18, 17);
    line(c, 6, 13, 16, 13);
  },

  camp: (c) => {
    line(c, 11, 4, 4, 17);
    line(c, 11, 4, 18, 17);
    line(c, 4, 17, 18, 17);
  },

  water: (c) => {
    // A drop: tip at the top, a bowl underneath.
    c.beginPath();
    c.moveTo(11, 4);
    c.quadraticCurveTo(17, 11, 15.5, 14.5);
    c.arc(11, 13.5, 4.6, 0.22 * Math.PI, 0.78 * Math.PI, false);
    c.quadraticCurveTo(5, 11, 11, 4);
    c.stroke();
  },

  food: (c) => {
    line(c, 7, 4, 7, 18);         // knife
    line(c, 7, 4, 9, 7);
    line(c, 14, 4, 14, 18);       // fork
    line(c, 12, 4, 12, 8);
    line(c, 16, 4, 16, 8);
    line(c, 12, 8, 16, 8);
  },

  viewpoint: (c) => {
    c.beginPath();
    c.moveTo(4, 11);
    c.quadraticCurveTo(11, 5, 18, 11);
    c.quadraticCurveTo(11, 17, 4, 11);
    c.stroke();
    dot(c, 11, 11, 1.8);
  },

  tower: (c) => {
    // A lookout tower is its platform - without it, it is a pylon.
    line(c, 7.5, 18, 9.5, 8);
    line(c, 14.5, 18, 12.5, 8);
    line(c, 5.5, 8, 16.5, 8);
    line(c, 9.5, 8, 9.5, 4);
    line(c, 12.5, 8, 12.5, 4);
    line(c, 9.5, 4, 12.5, 4);
    line(c, 8.4, 13, 13.6, 13);
  },

  peak: (c) => {
    line(c, 3, 17, 11, 5);
    line(c, 11, 5, 19, 17);
    line(c, 3, 17, 19, 17);
  },

  guidepost: (c) => {
    line(c, 11, 4, 11, 18);
    arrow(c, 11, 7, 8);          // to the right
    arrow(c, 11, 12, -8);        // to the left
  },

  board: (c) => {
    roundRect(c, 4, 4, 14, 9, 1);
    c.stroke();
    line(c, 11, 13, 11, 18);
  },

  bunker: (c) => {
    // A dome with an embrasure.
    c.beginPath();
    c.arc(11, 14, 7.5, Math.PI, 2 * Math.PI, false);
    c.stroke();
    line(c, 3.5, 14, 18.5, 14);
    line(c, 7.5, 11, 14.5, 11);
  },

  castle: (c) => {
    // Two towers and the wall between them.
    line(c, 5, 18, 5, 6);
    line(c, 8.5, 18, 8.5, 6);
    line(c, 5, 6, 8.5, 6);
    line(c, 13.5, 18, 13.5, 6);
    line(c, 17, 18, 17, 6);
    line(c, 13.5, 6, 17, 6);
    line(c, 8.5, 11, 13.5, 11);
    line(c, 8.5, 18, 13.5, 18);
  },

  lighthouse: (c) => {
    line(c, 8, 18, 9.5, 8);
    line(c, 14, 18, 12.5, 8);
    roundRect(c, 8.5, 4, 5, 4, 0.8);
    c.stroke();
    line(c, 4, 6, 6.5, 6);
    line(c, 15.5, 6, 18, 6);
  },

  mill: (c) => {
    // Four blades over a body - a cross alone reads as a plus sign.
    line(c, 5, 3, 17, 13);
    line(c, 17, 3, 5, 13);
    dot(c, 11, 8, 1.3);
    line(c, 11, 12, 11, 19);
  },

  substation: (c) => {
    // Lightning bolt.
    c.beginPath();
    c.moveTo(13, 3);
    c.lineTo(7, 11.5);
    c.lineTo(11, 11.5);
    c.lineTo(9, 19);
    c.lineTo(15, 10.5);
    c.lineTo(11, 10.5);
    c.closePath();
    c.stroke();
  },

  pylon: (c) => {
    line(c, 6, 18, 11, 4);
    line(c, 16, 18, 11, 4);
    line(c, 8.2, 12, 13.8, 12);
    line(c, 4, 7, 18, 7);
  },

  // Power lines and electrified railways are drawn as lines, not as symbols -
  // they have no glyph here. Anything unforeseen falls back to a plain dot.
  generic: (c) => dot(c, 11, 11, 3),
};

function line(c, x1, y1, x2, y2) {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

function dot(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, r, 0, 2 * Math.PI);
  c.fill();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function arrow(c, x, y, dx) {
  line(c, x, y, x + dx, y);
  const tip = x + dx;
  const back = tip - Math.sign(dx) * 3;
  line(c, tip, y, back, y - 2.5);
  line(c, tip, y, back, y + 2.5);
}

function letter(c, text, size = 12) {
  c.font = `bold ${size / 0.72}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, 11, 11.5);
}

/** One symbol: a disc in the group colour, a white glyph on top. */
function draw(kind, color, ratio = RATIO) {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE * ratio;
  canvas.height = SIZE * ratio;
  const c = canvas.getContext("2d");
  c.scale(ratio, ratio);

  // A white ring keeps the symbol readable on dark forest and bright field
  // alike - the same trick the park points use.
  c.fillStyle = "#ffffff";
  dot(c, 11, 11, 10.5);
  c.fillStyle = color;
  dot(c, 11, 11, 9.2);

  c.strokeStyle = "#ffffff";
  c.fillStyle = "#ffffff";
  c.lineCap = "round";
  c.lineJoin = "round";
  // The glyphs are drawn in the full 22x22 box; shrinking them towards the
  // centre keeps their corners off the rim of the disc. The stroke is scaled
  // back up so the lines keep their weight.
  const shrink = 0.72;
  c.lineWidth = 1.4 / shrink;
  c.translate(11, 11);
  c.scale(shrink, shrink);
  c.translate(-11, -11);
  (GLYPHS[kind] || GLYPHS.generic)(c);

  return c.getImageData(0, 0, canvas.width, canvas.height);
}

/* What the symbols were last drawn at. Someone who pulls them up to twice
   the size gets twice the pixels, otherwise the disc turns to mush - the
   bitmap is the same either way, only stretched further. */
let drawnRatio = 0;

/**
 * Register every symbol with the map. Has to run again after a style change -
 * `setStyle` throws the images away with everything else - and again when the
 * symbols are to be drawn at a different size.
 */
export function addPoiIcons(map, colorOf, ratio = RATIO) {
  const wanted = Math.max(1, Math.round(ratio));
  const coarse = wanted !== drawnRatio;
  for (const kind of Object.keys(GLYPHS)) {
    const id = "poi-" + kind;
    if (map.hasImage(id)) {
      if (!coarse) continue;
      map.removeImage(id);
    }
    map.addImage(id, draw(kind, colorOf(kind), wanted), { pixelRatio: wanted });
  }
  drawnRatio = wanted;
}
