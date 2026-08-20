// SHA-512 (서버 비밀번호 prehash 규약과 동일). 클라이언트 전용 유틸.
// HTTPS/localhost(보안 컨텍스트)는 WebCrypto, http://<IP> 등 비보안 컨텍스트
// (crypto.subtle 미제공)는 순수 JS 폴백 — 동일 해시값.
// LoginForm / 비밀번호 변경 폼 / 설정 화면이 공유한다(중복 제거).
function sha512Js(str: string): string {
  const K = ["428a2f98d728ae22","7137449123ef65cd","b5c0fbcfec4d3b2f","e9b5dba58189dbbc","3956c25bf348b538","59f111f1b605d019","923f82a4af194f9b","ab1c5ed5da6d8118","d807aa98a3030242","12835b0145706fbe","243185be4ee4b28c","550c7dc3d5ffb4e2","72be5d74f27b896f","80deb1fe3b1696b1","9bdc06a725c71235","c19bf174cf692694","e49b69c19ef14ad2","efbe4786384f25e3","0fc19dc68b8cd5b5","240ca1cc77ac9c65","2de92c6f592b0275","4a7484aa6ea6e483","5cb0a9dcbd41fbd4","76f988da831153b5","983e5152ee66dfab","a831c66d2db43210","b00327c898fb213f","bf597fc7beef0ee4","c6e00bf33da88fc2","d5a79147930aa725","06ca6351e003826f","142929670a0e6e70","27b70a8546d22ffc","2e1b21385c26c926","4d2c6dfc5ac42aed","53380d139d95b3df","650a73548baf63de","766a0abb3c77b2a8","81c2c92e47edaee6","92722c851482353b","a2bfe8a14cf10364","a81a664bbc423001","c24b8b70d0f89791","c76c51a30654be30","d192e819d6ef5218","d69906245565a910","f40e35855771202a","106aa07032bbd1b8","19a4c116b8d2d0c8","1e376c085141ab53","2748774cdf8eeb99","34b0bcb5e19b48a8","391c0cb3c5c95a63","4ed8aa4ae3418acb","5b9cca4f7763e373","682e6ff3d6b2b8a3","748f82ee5defb2fc","78a5636f43172f60","84c87814a1f0ab72","8cc702081a6439ec","90befffa23631e28","a4506cebde82bde9","bef9a3f7b2c67915","c67178f2e372532b","ca273eceea26619c","d186b8c721c0c207","eada7dd6cde0eb1e","f57d4f7fee6ed178","06f067aa72176fba","0a637dc5a2c898a6","113f9804bef90dae","1b710b35131c471b","28db77f523047d84","32caab7b40c72493","3c9ebe0a15c9bebc","431d67c49c100d4c","4cc5d4becb3e42b6","597f299cfc657e2a","5fcb6fab3ad6faec","6c44198c4a475817"].map(h => BigInt("0x" + h));
  // ES2017 타깃이라 BigInt 리터럴(1n) 불가 → BigInt() 사용 (런타임 동작 동일).
  const bn = (n: number) => BigInt(n);
  const M = (bn(1) << bn(64)) - bn(1);
  const ror = (x: bigint, n: bigint) => ((x >> n) | (x << (bn(64) - n))) & M;
  const shr = (x: bigint, n: bigint) => x >> n;
  let H = ["6a09e667f3bcc908","bb67ae8584caa73b","3c6ef372fe94f82b","a54ff53a5f1d36f1","510e527fade682d1","9b05688c2b3e6c1f","1f83d9abfb41bd6b","5be0cd19137e2179"].map(h => BigInt("0x" + h));
  const bytes = new TextEncoder().encode(str);
  let padLen = (112 - (bytes.length % 128) + 128) % 128; if (padLen === 0) padLen = 128;
  const total = bytes.length + padLen + 16;
  const buf = new Uint8Array(total); buf.set(bytes); buf[bytes.length] = 0x80;
  let bl = bn(bytes.length * 8); for (let i = 0; i < 8; i++) { buf[total - 1 - i] = Number(bl & bn(0xff)); bl >>= bn(8); }
  for (let off = 0; off < total; off += 128) {
    const w = new Array<bigint>(80);
    for (let i = 0; i < 16; i++) { let v = bn(0); for (let j = 0; j < 8; j++) v = (v << bn(8)) | bn(buf[off + i * 8 + j]); w[i] = v; }
    for (let i = 16; i < 80; i++) { const s0 = ror(w[i - 15], bn(1)) ^ ror(w[i - 15], bn(8)) ^ shr(w[i - 15], bn(7)); const s1 = ror(w[i - 2], bn(19)) ^ ror(w[i - 2], bn(61)) ^ shr(w[i - 2], bn(6)); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & M; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 80; i++) { const S1 = ror(e, bn(14)) ^ ror(e, bn(18)) ^ ror(e, bn(41)); const ch = (e & f) ^ ((~e & M) & g); const t1 = (h + S1 + ch + K[i] + w[i]) & M; const S0 = ror(a, bn(28)) ^ ror(a, bn(34)) ^ ror(a, bn(39)); const maj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + maj) & M; h = g; g = f; f = e; e = (d + t1) & M; d = c; c = b; b = a; a = (t1 + t2) & M; }
    H = [(H[0] + a) & M, (H[1] + b) & M, (H[2] + c) & M, (H[3] + d) & M, (H[4] + e) & M, (H[5] + f) & M, (H[6] + g) & M, (H[7] + h) & M];
  }
  return H.map(x => x.toString(16).padStart(16, "0")).join("");
}

export async function sha512(message: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const data = new TextEncoder().encode(message);
    const hash = await crypto.subtle.digest("SHA-512", data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  // 비보안 컨텍스트(http://<IP> 등): WebCrypto 미제공 → 동일 결과의 JS 폴백
  return sha512Js(message);
}
