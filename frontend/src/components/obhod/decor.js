// Decor layout on the 1536×1024 design canvas (mockup ×1.5).
// Items left of centre are anchored to the viewport's left edge, the rest to its right edge,
// so on wider screens the rocks stay at the edges instead of drifting inward.
// s: asset name, x/y: top-left on the canvas, w: display width, r: rotation (deg), f: mirror.

export const LIGHT_ROCKS = [
  { s: 'rock-l-04', x: 150,  y: 38,  w: 176, r: -10 },
  { s: 'rock-l-06', x: -12,  y: 68,  w: 44,  r: 0 },
  { s: 'rock-l-03', x: 108,  y: 188, w: 44,  r: 15 },
  { s: 'rock-d-04', x: -44,  y: 218, w: 132, r: 12 },
  { s: 'rock-l-05', x: 88,   y: 258, w: 136, r: -22 },
  { s: 'rock-l-06', x: 36,   y: 418, w: 54,  r: -10 },
  { s: 'rock-l-01', x: -78,  y: 630, w: 170, r: 25, f: 1 },
  { s: 'rock-l-03', x: -30,  y: 770, w: 92,  r: -15 },
  { s: 'rock-l-02', x: -44,  y: 890, w: 160, r: 8 },
  { s: 'rock-l-01', x: 1284, y: 52,  w: 212, r: -6 },
  { s: 'rock-d-06', x: 1292, y: 150, w: 66,  r: 10 },
  { s: 'rock-l-06', x: 1499, y: -14, w: 62,  r: 20 },
  { s: 'rock-l-03', x: 1190, y: 118, w: 50,  r: 0 },
  { s: 'rock-d-01', x: 1318, y: 268, w: 160, r: -4 },
  { s: 'rock-l-02', x: 1224, y: 300, w: 52,  r: 30 },
]

// [x, y, size, pebble #, rotation] — positions taken from the light mockup
export const LIGHT_PEBBLES = [[1447,719,34,1,0],[1467,657,30,8,37],[1495,702,30,15,74],[1204,261,27,22,111],[1466,457,27,5,148],[1519,889,44,12,185],[381,138,28,19,222],[333,279,25,2,259],[1453,415,22,9,296],[19,575,22,16,333],[1197,65,25,23,10],[1523,434,38,6,47],[1176,119,21,13,84],[82,436,39,3,158],[1504,371,19,10,195],[248,178,18,17,232],[80,948,32,24,269],[352,159,17,7,306],[1484,292,17,14,343],[34,103,26,21,20],[1207,85,16,4,57],[1168,89,15,11,94],[1136,206,13,18,131],[52,527,13,1,168],[1262,248,15,8,205],[1302,325,13,15,242],[348,110,13,22,279],[84,242,16,5,316],[1103,70,11,12,353]]

export const DARK_ROCKS = [
  { s: 'rock-d-05', x: 186,  y: 79,  w: 96,  r: -8 },
  { s: 'rock-d-06', x: 346,  y: 128, w: 70,  r: 12 },
  { s: 'rock-d-03', x: 316,  y: 282, w: 92,  r: -6 },
  { s: 'cube-1',    x: 48,   y: 182, w: 84,  r: 0 },
  { s: 'cube-3',    x: 2,    y: 788, w: 104, r: 0 },
  { s: 'rock-d-04', x: 204,  y: 944, w: 110, r: 0 },
  { s: 'rock-d-02', x: 1122, y: 70,  w: 124, r: 5 },
  { s: 'rock-d-05', x: 1246, y: 170, w: 96,  r: 20, f: 1 },
  { s: 'cube-2',    x: 1190, y: 268, w: 96,  r: 0 },
  { s: 'rock-d-01', x: 1350, y: 276, w: 112, r: -10 },
  { s: 'rock-d-06', x: 1124, y: 944, w: 96,  r: -12 },
]

// thin survey lines that tie the rocks together in the dark mockup (canvas coords)
export const DARK_LINES = [
  'M128 222 C 190 196, 250 170, 318 158 S 410 150, 462 158',
  'M300 322 C 350 332, 402 348, 452 346',
  'M1102 196 C 1146 224, 1178 246, 1206 278',
  'M1282 318 C 1306 302, 1334 292, 1362 300',
]
