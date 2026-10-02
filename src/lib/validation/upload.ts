// ── 업로드 파일 상한 (순수 모듈) ──
// 엑셀 임포트 4종(자산·부속·유지관리대상·배선 일괄)이 공통으로 쓴다.
// 크기 상한은 XLSX.read 가 메모리에 전부 올리기 때문에 필요하고(실수로 올린 수십 MB 파일이 서비스를 세운다),
// 행 상한은 한 요청에서 트랜잭션·감사로그가 무한정 커지지 않게 한다. 정상 업무 범위(수천 행)는 넉넉히 통과.
import { inflateRawSync } from "node:zlib";
import { ValidationError } from "./input.ts";

export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;   // 20MB — 1만 행 xlsx 도 보통 2~3MB
export const UPLOAD_MAX_ROWS = 20_000;               // 헤더 제외 데이터 행
/**
 * xlsx(zip) 압축 해제 총량 상한. 크기 상한(20MB)만으로는 부족하다 — 같은 값을 반복한 20MB 파일이 풀리면
 * 3백만 셀이 되어 XLSX.read 가 1.7GB·23초를 쓰고(실측) 운영 VM(가용 메모리 약 750MB)에서 서비스가 죽는다.
 * 정상 상한(2만 행 × 40열, 실데이터 형태)은 압축 해제 약 40MB(실측) → 64MB 면 여유 있게 통과.
 */
export const UPLOAD_MAX_UNZIPPED_BYTES = 64 * 1024 * 1024;
const ZIP_MAX_ENTRIES = 2_000;

export function assertUploadSize(file: { size: number; name?: string } | null): asserts file is { size: number; name?: string } {
  if (!file) throw new ValidationError("파일이 없습니다.");
  if (file.size === 0) throw new ValidationError("빈 파일입니다.");
  if (file.size > UPLOAD_MAX_BYTES) {
    throw new ValidationError(
      `파일이 너무 큽니다 (${(file.size / 1048576).toFixed(1)}MB). 최대 ${UPLOAD_MAX_BYTES / 1048576}MB — 시트를 나눠 올리세요.`,
    );
  }
}

export function assertRowLimit(dataRowCount: number) {
  if (dataRowCount > UPLOAD_MAX_ROWS) {
    throw new ValidationError(`행이 너무 많습니다 (${dataRowCount.toLocaleString()}행). 한 번에 최대 ${UPLOAD_MAX_ROWS.toLocaleString()}행 — 나눠 올리세요.`);
  }
}

/**
 * xlsx(zip) 압축 폭탄 차단 — XLSX.read 전에 호출. 중앙 디렉터리를 직접 읽어 각 항목을 실제로 풀어 보되
 * (선언된 크기는 위조 가능하므로 믿지 않는다) 누적량이 상한을 넘는 순간 zlib maxOutputLength 로 중단한다.
 * 형식이 깨진 zip 은 "유효한 .xlsx 가 아님" 400. 암호화·미지원 압축 방식도 거부.
 */
export function assertXlsxExpansion(buf: Buffer, maxTotal = UPLOAD_MAX_UNZIPPED_BYTES): { entries: number; unzippedBytes: number } {
  const bad = () => new ValidationError("유효한 .xlsx 파일이 아닙니다 (손상되었거나 지원하지 않는 형식).");
  const tooBig = () => new ValidationError(
    `압축을 풀면 너무 큰 파일입니다 (최대 ${maxTotal / 1048576}MB). 빈 셀 서식이 시트 끝까지 채워졌는지 확인하거나 시트를 나눠 올리세요.`,
  );
  // EOCD(끝 22바이트 + 주석 최대 64KB 안)에서 중앙 디렉터리 위치를 찾는다
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw bad();
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > ZIP_MAX_ENTRIES) throw tooBig();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad();
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) throw bad(); // 암호화
    if (csize === 0xffffffff || local === 0xffffffff) throw tooBig(); // ZIP64 — 4GB 급, 업무 파일일 수 없다
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw bad();
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + csize);
    if (data.length !== csize) throw bad();
    if (method === 0) total += csize;
    else if (method === 8) {
      try {
        total += inflateRawSync(data, { maxOutputLength: maxTotal - total + 1 }).length;
      } catch (e) {
        if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw tooBig();
        throw bad();
      }
    } else throw bad();
    if (total > maxTotal) throw tooBig();
  }
  return { entries: count, unzippedBytes: total };
}
