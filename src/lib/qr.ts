// ── QR 코드 인코더 (ISO/IEC 18004, 바이트 모드, EC L/M) — 순수 모듈, 외부 패키지 0 ──
// 용도: 2단계 인증 등록용 otpauth:// URI 를 인증 앱이 스캔할 QR 로 만든다.
// 폐쇄망 오프라인 빌드에서 qrcode 패키지 반입을 피하려고 직접 구현했다. 표준(버전 1~40, 마스크 8종,
// 페널티 기반 마스크 선택, Reed-Solomon GF(256) 0x11D)을 그대로 따르며 tests/qr.test.ts 가 표 불변식과
// 실제 디코더 대조 골든 값을 고정한다. 알파뉴메릭/숫자 모드는 만들지 않는다(URI 는 바이트 모드로 충분).
//
// 출력은 모듈 행렬(boolean[][]) 과 SVG path 문자열. 클라이언트는 <svg><path d=…/></svg> 로 그리면 된다.

export type EcLevel = "L" | "M";

// ── 버전별 EC 블록 구조: [블록당 EC 코드워드, 그룹1 블록 수, 그룹1 데이터, 그룹2 블록 수, 그룹2 데이터] ──
// 인덱스 = 버전(1~40). 총 코드워드 = ec*(g1+g2) + g1*d1 + g2*d2 이어야 하며 테스트가 이를 검증한다.
const EC_TABLE: Record<EcLevel, ReadonlyArray<readonly [number, number, number, number, number]>> = {
  L: [
    [0, 0, 0, 0, 0],
    [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0],
    [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69],
    [20, 4, 81, 0, 0], [24, 2, 92, 2, 93], [26, 4, 107, 0, 0], [30, 3, 115, 1, 116], [22, 5, 87, 1, 88],
    [24, 5, 98, 1, 99], [28, 1, 107, 5, 108], [30, 5, 120, 1, 121], [28, 3, 113, 4, 114], [28, 3, 107, 5, 108],
    [28, 4, 116, 4, 117], [28, 2, 111, 7, 112], [30, 4, 121, 5, 122], [30, 6, 117, 4, 118], [26, 8, 106, 4, 107],
    [28, 10, 114, 2, 115], [30, 8, 122, 4, 123], [30, 3, 117, 10, 118], [30, 7, 116, 7, 117], [30, 5, 115, 10, 116],
    [30, 13, 115, 3, 116], [30, 17, 115, 0, 0], [30, 17, 115, 1, 116], [30, 13, 115, 6, 116], [30, 12, 121, 7, 122],
    [30, 6, 121, 14, 122], [30, 17, 122, 4, 123], [30, 4, 122, 18, 123], [30, 20, 117, 4, 118], [30, 19, 118, 6, 119],
  ],
  M: [
    [0, 0, 0, 0, 0],
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
    [30, 1, 50, 4, 51], [22, 6, 36, 2, 37], [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42],
    [28, 7, 45, 3, 46], [28, 10, 46, 1, 47], [26, 9, 43, 4, 44], [26, 3, 44, 11, 45], [26, 3, 41, 13, 42],
    [26, 17, 42, 0, 0], [28, 17, 46, 0, 0], [28, 4, 47, 14, 48], [28, 6, 45, 14, 46], [28, 8, 47, 13, 48],
    [28, 19, 46, 4, 47], [28, 22, 45, 3, 46], [28, 3, 45, 23, 46], [28, 21, 45, 7, 46], [28, 19, 47, 10, 48],
    [28, 2, 46, 29, 47], [28, 10, 46, 23, 47], [28, 14, 46, 21, 47], [28, 14, 46, 23, 47], [28, 12, 47, 26, 48],
    [28, 6, 47, 34, 48], [28, 29, 46, 14, 47], [28, 13, 46, 32, 47], [28, 40, 47, 7, 48], [28, 18, 47, 31, 48],
  ],
};

/** 버전별 총 코드워드 수 (EC 레벨 무관). 테이블 불변식 검증용으로 export. */
export const TOTAL_CODEWORDS: readonly number[] = [
  0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
  1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706,
];

export function ecBlocks(version: number, level: EcLevel) {
  const [ecPerBlock, g1, d1, g2, d2] = EC_TABLE[level][version];
  return { ecPerBlock, g1, d1, g2, d2, dataCodewords: g1 * d1 + g2 * d2, totalCodewords: ecPerBlock * (g1 + g2) + g1 * d1 + g2 * d2 };
}

// ── GF(256) Reed-Solomon (primitive polynomial 0x11D) ──
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}
/** 차수 degree 의 생성 다항식 계수 (최고차 항 계수 1 은 제외, 낮은 차수부터가 아니라 높은 차수부터 저장). */
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly.slice(1); // 선두 1 제거
}
function rsEncode(data: Uint8Array, degree: number): Uint8Array {
  const gen = rsGenerator(degree);
  const result = new Uint8Array(degree);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let i = 0; i < degree; i++) result[i] ^= gfMul(gen[i], factor);
  }
  return result;
}

// ── 비트 버퍼 ──
class BitBuffer {
  bits: number[] = [];
  append(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

/** 바이트 모드 데이터가 들어가는 최소 버전. 없으면 -1. */
export function minVersionFor(byteLength: number, level: EcLevel): number {
  for (let v = 1; v <= 40; v++) {
    const cc = v <= 9 ? 8 : 16;
    const need = 4 + cc + byteLength * 8;
    if (ecBlocks(v, level).dataCodewords * 8 >= need) return v;
  }
  return -1;
}

/** 데이터 코드워드 생성 (모드·길이·데이터·종결·패딩) → EC 계산·인터리브 → 최종 코드워드 열 */
function buildCodewords(bytes: Uint8Array, version: number, level: EcLevel): Uint8Array {
  const { ecPerBlock, g1, d1, g2, d2, dataCodewords } = ecBlocks(version, level);
  const bb = new BitBuffer();
  bb.append(0b0100, 4);                       // 바이트 모드
  bb.append(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) bb.append(b, 8);
  const cap = dataCodewords * 8;
  bb.append(0, Math.min(4, cap - bb.bits.length)); // 종결자
  while (bb.bits.length % 8 !== 0) bb.bits.push(0);
  for (let pad = 0xec; bb.bits.length < cap; pad ^= 0xec ^ 0x11) bb.append(pad, 8);

  const data = new Uint8Array(dataCodewords);
  for (let i = 0; i < cap; i++) data[i >>> 3] |= bb.bits[i] << (7 - (i & 7));

  // 블록 분할 + EC
  const blocks: { data: Uint8Array; ec: Uint8Array }[] = [];
  let off = 0;
  for (let b = 0; b < g1 + g2; b++) {
    const len = b < g1 ? d1 : d2;
    const chunk = data.slice(off, off + len);
    off += len;
    blocks.push({ data: chunk, ec: rsEncode(chunk, ecPerBlock) });
  }
  // 인터리브
  const out: number[] = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i++) for (const blk of blocks) if (i < blk.data.length) out.push(blk.data[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const blk of blocks) out.push(blk.ec[i]);
  return Uint8Array.from(out);
}

// ── 행렬 구성 ──
function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const n = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.floor((version * 4 + n * 2 + 1) / (n * 2 - 2)) * 2;
  const result: number[] = [];
  for (let i = 0, pos = size - 7; i < n - 1; i++, pos -= step) result.unshift(pos);
  result.unshift(6);
  return result;
}

/** 포맷 정보 15비트 (BCH 15,5 + 마스크 0x5412). export: 테스트가 알려진 값과 대조. */
export function formatBits(level: EcLevel, mask: number): number {
  const lv = level === "L" ? 1 : 0; // L=01, M=00
  const data = (lv << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 버전 정보 18비트 (v≥7, BCH 18,6). */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

type Matrix = boolean[][];

function makeMatrix(size: number): Matrix {
  return Array.from({ length: size }, () => Array<boolean>(size).fill(false));
}

/** 기능 패턴(파인더·타이밍·정렬·포맷/버전 영역·다크 모듈)을 그리고 isFunction 맵을 돌려준다. */
function drawFunctionPatterns(m: Matrix, fn: Matrix, version: number, level: EcLevel) {
  const size = m.length;
  const set = (x: number, y: number, dark: boolean) => { m[y][x] = dark; fn[y][x] = true; };
  // 타이밍
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // 파인더 3개 (+ 분리자)
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  // 정렬 패턴 (파인더와 겹치는 세 모서리 제외)
  const ap = alignmentPositions(version);
  for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
    const cx = ap[i], cy = ap[j];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // 포맷 영역 예약 (값은 마스크 결정 후 기록) + 다크 모듈
  drawFormat(m, fn, level, 0);
  // 버전 정보
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, bit); set(b, a, bit);
    }
  }
}

function drawFormat(m: Matrix, fn: Matrix, level: EcLevel, mask: number) {
  const size = m.length;
  const bits = formatBits(level, mask);
  const set = (x: number, y: number, dark: boolean) => { m[y][x] = dark; fn[y][x] = true; };
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  // 첫 번째 사본 (좌상단)
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  // 두 번째 사본 (우상단 + 좌하단)
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true); // 다크 모듈
}

function drawCodewords(m: Matrix, fn: Matrix, data: Uint8Array) {
  const size = m.length;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && i < data.length * 8) {
          m[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
}

const MASKS: ReadonlyArray<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m: Matrix, fn: Matrix, mask: number) {
  const size = m.length;
  const f = MASKS[mask];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && f(x, y)) m[y][x] = !m[y][x];
}

/** 표준 페널티 점수(N1=3, N2=3, N3=40, N4=10) — 낮을수록 좋다. */
function penalty(m: Matrix): number {
  const size = m.length;
  let score = 0;
  // 규칙 1: 행/열 연속 5+ 동일 모듈
  for (let y = 0; y < size; y++) {
    let run = 1;
    for (let x = 1; x < size; x++) {
      if (m[y][x] === m[y][x - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; } else run = 1;
    }
  }
  for (let x = 0; x < size; x++) {
    let run = 1;
    for (let y = 1; y < size; y++) {
      if (m[y][x] === m[y - 1][x]) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; } else run = 1;
    }
  }
  // 규칙 2: 2x2 동일 블록
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
  }
  // 규칙 3: 파인더 유사 패턴 1011101 + 4칸 여백
  const pat = [true, false, true, true, true, false, true];
  const hasPat = (get: (i: number) => boolean | undefined, start: number) => {
    for (let k = 0; k < 7; k++) if (get(start + k) !== pat[k]) return false;
    return true;
  };
  const lightRun = (get: (i: number) => boolean | undefined, start: number, dir: 1 | -1) => {
    for (let k = 1; k <= 4; k++) { const v = get(start + dir * k); if (v === undefined || v) return false; }
    return true;
  };
  for (let y = 0; y < size; y++) {
    const row = (i: number) => (i >= 0 && i < size ? m[y][i] : undefined);
    for (let x = 0; x <= size - 7; x++) {
      if (hasPat(row, x) && (lightRun(row, x, -1) || lightRun(row, x + 6, 1))) score += 40;
    }
  }
  for (let x = 0; x < size; x++) {
    const col = (i: number) => (i >= 0 && i < size ? m[i][x] : undefined);
    for (let y = 0; y <= size - 7; y++) {
      if (hasPat(col, y) && (lightRun(col, y, -1) || lightRun(col, y + 6, 1))) score += 40;
    }
  }
  // 규칙 4: 어두운 모듈 비율
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const pct = (dark * 100) / (size * size);
  const prev5 = Math.floor(pct / 5) * 5, next5 = prev5 + 5;
  score += Math.min(Math.abs(prev5 - 50) / 5, Math.abs(next5 - 50) / 5) * 10;
  return score;
}

export interface QrCode {
  version: number;
  level: EcLevel;
  mask: number;
  size: number;
  /** modules[y][x] === true 이면 어두운 모듈 */
  modules: boolean[][];
}

/**
 * 문자열(UTF-8) → QR. level 기본 M (인증 앱 스캔에 충분한 복원력, 크기 절충).
 * 40 버전으로도 안 들어가면 오류.
 */
export function encodeQr(text: string, level: EcLevel = "M"): QrCode {
  const bytes = new TextEncoder().encode(text);
  const version = minVersionFor(bytes.length, level);
  if (version < 0) throw new Error(`QR 용량 초과: ${bytes.length} bytes`);
  const size = version * 4 + 17;
  const codewords = buildCodewords(bytes, version, level);

  const m = makeMatrix(size);
  const fn = makeMatrix(size);
  drawFunctionPatterns(m, fn, version, level);
  drawCodewords(m, fn, codewords);

  // 마스크 8종 중 페널티 최소 선택
  let best = 0, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(m, fn, mask);
    drawFormat(m, fn, level, mask);
    const s = penalty(m);
    if (s < bestScore) { bestScore = s; best = mask; }
    applyMask(m, fn, mask); // 되돌리기 (XOR)
  }
  applyMask(m, fn, best);
  drawFormat(m, fn, level, best);

  return { version, level, mask: best, size, modules: m };
}

/**
 * SVG path 데이터 — 어두운 모듈을 1x1 사각형으로. quiet zone 4모듈 포함한 viewBox 크기도 돌려준다.
 * 클라이언트: <svg viewBox={`0 0 ${viewBox} ${viewBox}`}><rect width="100%" height="100%" fill="#fff"/><path d={path} fill="#000"/></svg>
 */
export function qrSvgPath(qr: QrCode, quiet = 4): { path: string; viewBox: number } {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.modules[y][x]) { x++; continue; }
      let run = 1;
      while (x + run < qr.size && qr.modules[y][x + run]) run++;
      parts.push(`M${x + quiet} ${y + quiet}h${run}v1h-${run}z`);
      x += run;
    }
  }
  return { path: parts.join(""), viewBox: qr.size + quiet * 2 };
}
