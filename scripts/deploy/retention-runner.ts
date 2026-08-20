#!/usr/bin/env node
// 로그 보존 프루닝 실행기 (AC-20). systemd timer가 1일 1회 호출. 백업과 공용 lockfile로 상호배제.
// 실행: node --experimental-strip-types scripts/deploy/retention-runner.ts
// 환경변수: ASSET_DB_CWD(앱 cwd, data.db 위치), ASSET_LOCK_PATH(lock 경로), RETENTION_DAYS(기본 365)
import { pathToFileURL, fileURLToPath } from "url";
import { join, dirname } from "path";

// 라이브러리는 앱과 함께 배포(이 파일 기준 ../../src/lib). data.db 위치만 ASSET_DB_CWD로 가변.
const libDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "lib");
const cwd = process.env.ASSET_DB_CWD || process.cwd();
process.chdir(cwd);
const lockPath = process.env.ASSET_LOCK_PATH || "/var/lib/asset-inventory/maintenance.lock";
const days = Number(process.env.RETENTION_DAYS || "365") || 365;

const { getDb } = await import(pathToFileURL(join(libDir, "db.ts")).href);
const { pruneOldLogs, withLock } = await import(pathToFileURL(join(libDir, "retention.ts")).href);

const outcome = withLock(lockPath, () => pruneOldLogs(getDb(), days));
if (!outcome.ran) {
  console.error(`[retention] lock busy (${lockPath}); 백업 등 다른 유지보수 작업 진행 중 — 건너뜀`);
  process.exit(0);
}
const r = outcome.result;
console.log(`[retention] cutoff=${r.cutoff} audit_deleted=${r.auditDeleted} access_deleted=${r.accessDeleted}`);
