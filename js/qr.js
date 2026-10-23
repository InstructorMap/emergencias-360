/* ============================================================
   qr.js — Generador de QR real escaneable (sin dependencias)
   Algoritmo basado en QR Code Model 2, versión 4 (33x33),
   nivel de corrección de errores L (bajo, ~7%), modo byte.
   API:
     E360QR.toSvg(text, size?)     -> string SVG
     E360QR.toCanvas(canvas, text, size?)
     E360QR.toDataUrl(text, size?) -> data:image/png;base64
   ============================================================ */

(function (global) {
  'use strict';

  // ---- Galois Field GF(256) ----
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  // ---- Reed-Solomon ----
  function rsGenPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    const gen = rsGenPoly(ecLen);
    const res = new Array(data.length + ecLen).fill(0);
    for (let i = 0; i < data.length; i++) res[i] = data[i];
    for (let i = 0; i < data.length; i++) {
      const factor = res[i];
      if (factor === 0) continue;
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], factor);
      }
    }
    return res.slice(data.length);
  }

  // ---- Configuración por versión ----
  // Solo versión 4 (33x33), nivel L, modo byte. Capacidad de datos: 78 bytes.
  const VERSION = 4;
  const SIZE = 17 + VERSION * 4; // 33
  const DATA_CODEWORDS = 78;
  const EC_CODEWORDS = 20;       // Nivel L para v4: 20 EC codewords por bloque (1 bloque)

  // ---- Codificación de datos (modo byte, UTF-8) ----
  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(str));
    // fallback
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6)); out.push(0x80 | (c & 0x3F)); }
      else { out.push(0xE0 | (c >> 12)); out.push(0x80 | ((c >> 6) & 0x3F)); out.push(0x80 | (c & 0x3F)); }
    }
    return out;
  }

  function encodeData(text) {
    const bytes = utf8Bytes(String(text));
    if (bytes.length > DATA_CODEWORDS - 2) {
      throw new Error('Texto demasiado largo para QR v4 (máx ' + (DATA_CODEWORDS - 2) + ' bytes UTF-8).');
    }
    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    };
    // Modo byte: 0100
    pushBits(0b0100, 4);
    // Longitud (8 bits para v1-9 modo byte)
    pushBits(bytes.length, 8);
    // Datos
    bytes.forEach((b) => pushBits(b, 8));
    // Terminador 0000
    const cap = DATA_CODEWORDS * 8;
    while (bits.length < cap) bits.push(0);
    // Padding alternado 0xEC 0x11 hasta llenar
    const padBytes = [0xEC, 0x11];
    let pi = 0;
    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] || 0);
      codewords.push(b);
    }
    while (codewords.length < DATA_CODEWORDS) {
      codewords.push(padBytes[pi % 2]);
      pi++;
    }
    return codewords;
  }

  // ---- Construcción de la matriz ----
  function buildMatrix(text) {
    const data = encodeData(text);
    const ec = rsEncode(data, EC_CODEWORDS);
    const all = data.concat(ec);

    const matrix = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));
    const reserved = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));

    function setModule(r, c, dark) {
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return;
      matrix[r][c] = !!dark;
      reserved[r][c] = true;
    }

    // Finder patterns
    function placeFinder(row, col) {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = row + r, cc = col + c;
          if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
          const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
          let dark = false;
          if (inside) {
            const ring = (r === 0 || r === 6 || c === 0 || c === 6);
            const core = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
            dark = ring || core;
          }
          setModule(rr, cc, dark);
        }
      }
    }
    placeFinder(0, 0);
    placeFinder(0, SIZE - 7);
    placeFinder(SIZE - 7, 0);

    // Timing patterns
    for (let i = 8; i < SIZE - 8; i++) {
      setModule(6, i, i % 2 === 0);
      setModule(i, 6, i % 2 === 0);
    }

    // Alignment pattern (v4: centro en (26,26))
    const align = SIZE - 7; // 26
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const rr = align + r, cc = align + c;
        const ring = Math.abs(r) === 2 || Math.abs(c) === 2;
        const core = r === 0 && c === 0;
        setModule(rr, cc, ring || core);
      }
    }

    // Dark module
    setModule(SIZE - 8, 8, true);

    // Format info: nivel L, máscara 0 (00000 00 000)
    // Bits de formato para (L, mask 0) = 111011111000100
    const formatBits = [1,1,1,0,1,1,1,1,1,0,0,0,1,0,0];
    const fmtPos = [];
    // alrededor del finder superior izquierdo
    for (let c = 0; c <= 8; c++) { if (!(c >= 6 && c <= 7)) fmtPos.push([8, c]); }
    for (let r = 7; r >= 0; r--) { if (!(r >= 6 && r <= 7)) fmtPos.push([r, 8]); }
    // alrededor de los otros finders
    const fmtPos2 = [];
    for (let r = SIZE - 1; r >= SIZE - 7; r--) fmtPos2.push([r, 8]);
    for (let c = SIZE - 8; c < SIZE; c++) fmtPos2.push([8, c]);

    // Los 15 bits de formato van: 15 en el bloque alrededor del finder sup-izq,
    // y los otros 15 (mismos bits) en el bloque inf-izq / sup-der
    const allFmt = fmtPos.concat(fmtPos2);
    for (let i = 0; i < 15; i++) {
      const p = allFmt[i];
      if (p) setModule(p[0], p[1], formatBits[i] === 1);
    }
    // El bit 14 (índice 14) es siempre 0; el módulo (SIZE-8,8) ya es dark fijo
    // Los formatos están en posiciones específicas; usamos las dos copias.
    // Copia 1: (8,0..5),(8,7),(8,8),(7,8),(5..0,8)  -> 15 posiciones
    // Copia 2: (SIZE-1..SIZE-7, 8) y (8, SIZE-8..SIZE-1) -> 15 posiciones
    // Nota: el módulo (SIZE-8, 8) es el dark fijo y NO va formato ahí.

    // Colocación de datos
    let bitIdx = 0;
    const totalBits = all.length * 8;
    function getBit(i) {
      if (i >= totalBits) return 0;
      const byte = all[i >> 3];
      return (byte >> (7 - (i & 7))) & 1;
    }

    let up = true;
    for (let col = SIZE - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let i = 0; i < SIZE; i++) {
        const row = up ? SIZE - 1 - i : i;
        for (let k = 0; k < 2; k++) {
          const c = col - k;
          if (reserved[row][c]) continue;
          matrix[row][c] = getBit(bitIdx) === 1;
          bitIdx++;
        }
      }
      up = !up;
    }

    // Aplicar máscara 0: (r + c) % 2 === 0
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (reserved[r][c]) continue;
        if ((r + c) % 2 === 0) matrix[r][c] = !matrix[r][c];
      }
    }

    return matrix;
  }

  // ---- Render SVG ----
  function toSvg(text, size) {
    const px = size || 240;
    const matrix = buildMatrix(text);
    const cell = px / SIZE;
    let rects = '';
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (matrix[r][c]) {
          rects += '<rect x="' + (c * cell).toFixed(3) + '" y="' + (r * cell).toFixed(3) +
            '" width="' + cell.toFixed(3) + '" height="' + cell.toFixed(3) + '" fill="#000"/>';
        }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + px + ' ' + px +
      '" width="' + px + '" height="' + px + '" role="img" aria-label="Código QR">' +
      '<rect width="' + px + '" height="' + px + '" fill="#fff"/>' + rects + '</svg>';
  }

  // ---- Render Canvas ----
  function toCanvas(canvas, text, size) {
    const px = size || 240;
    const matrix = buildMatrix(text);
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000';
    const cell = px / SIZE;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (matrix[r][c]) {
          ctx.fillRect(Math.floor(c * cell), Math.floor(r * cell), Math.ceil(cell), Math.ceil(cell));
        }
      }
    }
    return canvas;
  }

  function toDataUrl(text, size) {
    const c = document.createElement('canvas');
    toCanvas(c, text, size || 480);
    return c.toDataURL('image/png');
  }

  global.E360QR = { toSvg, toCanvas, toDataUrl };
})(typeof window !== 'undefined' ? window : globalThis);
