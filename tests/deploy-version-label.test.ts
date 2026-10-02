// tests/deploy-version-label.test.ts — 배포·업그레이드 출력의 버전 표기 (scripts/deploy/version-label.sh)
// 반입 담당자가 폐쇄망 서버에서 읽는 줄이라 실제 bash 로 돌려 본다. bash 가 없는 환경이면 건너뛴다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LIB = readFileSync(join(ROOT, "scripts/deploy/version-label.sh"), "utf8");
const hasBash = (() => {
  try { execFileSync("bash", ["-c", "true"], { stdio: "ignore" }); return true; } catch { return false; }
})();

/**
 * 라이브러리를 stdin 으로 싣고 함수 하나를 인자 하나로 호출 — 파일 경로를 넘기지 않아 Git Bash·리눅스 모두 같다.
 * 인자는 스크립트 안에 bash $'…' 리터럴로 넣는다: Windows 는 명령줄 인자·환경변수의 줄바꿈을 온전히 넘기지 못한다
 * (VERSION 내용이 첫 줄만 가거나 비어 버린다).
 */
const ansiC = (s: string) =>
  "$'" + [...Buffer.from(s, "utf8")].map((b) => (b >= 0x20 && b < 0x7f && b !== 0x27 && b !== 0x5c ? String.fromCharCode(b) : "\\x" + b.toString(16).padStart(2, "0"))).join("") + "'";
function call(fn: "ver_label_kv" | "ver_label_json", arg: string): string {
  return execFileSync("bash", ["-s"], { input: `${LIB}\n${fn} ${ansiC(arg)}\n` }).toString().replace(/\n$/, "");
}

const skip = !hasBash && "bash 없음";

test("VERSION 파일 → v버전 (커밋), 커밋 없으면 버전만, 내용 없으면 안내", { skip }, () => {
  assert.equal(call("ver_label_kv", "version=1.1.1\ncommit=0083391\nbuilt_at=2026-10-02T06:10:32.447Z\n"), "v1.1.1 (0083391)");
  assert.equal(call("ver_label_kv", "version=1.1.1\ncommit=\nbuilt_at=2026-10-02T06:10:32.447Z\n"), "v1.1.1");
  assert.equal(call("ver_label_kv", "version=1.1.1\ncommit=0083391-dirty\n"), "v1.1.1 (0083391-dirty)");
  assert.equal(call("ver_label_kv", ""), "(버전 정보 없음)", "버전 표기 이전 번들(VERSION 없음)");
});

test("/api/health → 같은 형식, 버전 표기 이전 판(commit 없음)은 v1.0.0, 무응답은 안내", { skip }, () => {
  const now = JSON.stringify({ ok: true, db: "ok", schema: 2, version: "1.1.1", commit: "0083391", builtAt: "2026-10-02T06:10:32.447Z", uptimeSec: 2 });
  assert.equal(call("ver_label_json", now), "v1.1.1 (0083391)");
  assert.equal(call("ver_label_json", JSON.stringify({ ok: true, db: "ok", schema: 2, version: "1.0.0", uptimeSec: 9 })), "v1.0.0");
  assert.equal(call("ver_label_json", ""), "(응답 없음)");
  assert.equal(call("ver_label_json", "<html>502 Bad Gateway</html>"), "(응답 없음)");
});

test("번들 VERSION 과 가동 중 health 가 같은 판이면 두 표기가 정확히 같다 (업그레이드의 ✓/✗ 판정 근거)", { skip }, () => {
  const kv = call("ver_label_kv", "version=1.1.1\ncommit=0083391\nbuilt_at=x\n");
  const live = call("ver_label_json", JSON.stringify({ version: "1.1.1", commit: "0083391" }));
  assert.equal(kv, live);
});

test("deploy.sh · upgrade-inplace.sh 는 표기를 직접 만들지 않고 version-label.sh 를 쓴다", () => {
  for (const f of ["deploy.sh", "upgrade-inplace.sh"]) {
    const src = readFileSync(join(ROOT, "scripts/deploy", f), "utf8");
    assert.match(src, /^source ".*version-label\.sh"$/m, `${f}: source`);
    assert.doesNotMatch(src, /"version":"\\\(/, `${f}: health JSON 을 직접 파싱하지 않는다`);
  }
});
