// tests/app-version.test.ts — 빌드 메타(버전·커밋·빌드 시각) 계산과 화면 표기
// 정본 계산은 scripts/build-meta.mjs 하나 — next.config.ts(화면·/api/health)와 build-release.sh(번들 VERSION)가 같은 값을 써야
// "화면에 보이는 버전 = 반입한 번들 = git 태그" 가 성립한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBuildMeta, gitCommit } from "../scripts/build-meta.mjs";
import { buildLabel, kstMinute } from "../src/lib/app-version.ts";
import { isLocalHealthProbe } from "../src/lib/health-access.ts";

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const NO_GIT = { APP_COMMIT: "" };

const hasGit = (() => {
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
})();

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "build-meta-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "2.3.4" }));
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-C", dir, ...a], { stdio: "pipe" }).toString().trim();
  g("init", "-q");
  g("add", "-A");
  g("commit", "-q", "-m", "init");
  return { dir, sha: g("rev-parse", "--short=7", "HEAD"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("버전은 package.json 하나가 정본 — lockfile 두 자리도 같은 값, SemVer", () => {
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, pkg.version, "package-lock.json version");
  assert.equal(lock.packages[""].version, pkg.version, "package-lock.json packages[''].version");
  assert.equal(resolveBuildMeta({ root: ROOT, env: NO_GIT }).version, pkg.version);
});

test("릴리스 문서가 현재 버전을 가리킨다 — CHANGELOG 맨 위 항목·배포방법.txt 변경 요약", () => {
  const log = readFileSync(join(ROOT, "docs/CHANGELOG.md"), "utf8");
  assert.equal(log.match(/^## v(\S+)/m)?.[1], pkg.version, "docs/CHANGELOG.md 첫 항목 = package.json version (버전을 올렸으면 이력도)");
  const howto = readFileSync(join(ROOT, "scripts/deploy/배포방법.txt"), "utf8");
  assert.equal(howto.match(/^\[v(\S+) 변경 요약\]/m)?.[1], pkg.version, "배포방법.txt [vX.Y.Z 변경 요약]");
});

test("빌드 스크립트가 지정한 APP_COMMIT·APP_BUILT_AT 을 그대로 쓴다 (워커·VERSION 파일과 같은 값)", () => {
  const m = resolveBuildMeta({ root: ROOT, env: { APP_COMMIT: "abc1234-dirty", APP_BUILT_AT: "2026-10-02T06:00:00.000Z" } });
  assert.deepEqual(m, { version: pkg.version, commit: "abc1234-dirty", builtAt: "2026-10-02T06:00:00.000Z" });
});

test("APP_BUILT_AT 이 없으면 지금 시각, 형식이 틀린 값은 빌드를 멈춘다", () => {
  const fixed = new Date("2026-10-02T01:02:03.000Z");
  assert.equal(resolveBuildMeta({ root: ROOT, env: NO_GIT, now: () => fixed }).builtAt, "2026-10-02T01:02:03.000Z");
  assert.throws(() => resolveBuildMeta({ root: ROOT, env: { ...NO_GIT, APP_BUILT_AT: "어제" } }), /APP_BUILT_AT/);
  // 셸 eval 로 읽히는 값이라 커밋 형식은 16진수[-dirty] 만 통과
  for (const bad of ["x;rm -rf /", "ABC1234", "abc12", "abc1234-clean"]) {
    assert.throws(() => resolveBuildMeta({ root: ROOT, env: { APP_COMMIT: bad } }), /APP_COMMIT/, bad);
  }
});

test("package.json version 이 SemVer 가 아니면 빌드를 멈춘다", () => {
  const dir = mkdtempSync(join(tmpdir(), "build-meta-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.1" }));
    assert.throws(() => resolveBuildMeta({ root: dir, env: NO_GIT }), /SemVer/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("git: 깨끗한 트리는 커밋 7자리, 미커밋 변경(수정·새 파일)은 -dirty", { skip: !hasGit && "git 없음" }, () => {
  const r = tempRepo();
  try {
    assert.match(r.sha, /^[0-9a-f]{7}$/);
    assert.equal(gitCommit(r.dir), r.sha);
    assert.equal(resolveBuildMeta({ root: r.dir, env: {} }).commit, r.sha);
    writeFileSync(join(r.dir, "package.json"), JSON.stringify({ name: "x", version: "2.3.5" }));
    assert.equal(gitCommit(r.dir), `${r.sha}-dirty`, "수정");
    execFileSync("git", ["-C", r.dir, "checkout", "-q", "--", "package.json"]);
    assert.equal(gitCommit(r.dir), r.sha, "되돌리면 다시 깨끗");
    writeFileSync(join(r.dir, "new.ts"), "export {};\n");
    assert.equal(gitCommit(r.dir), `${r.sha}-dirty`, "새 파일");
  } finally { r.cleanup(); }
});

test("git: 소스를 복사해 빌드하면 APP_GIT_DIR 의 원본 저장소 커밋을 쓴다", { skip: !hasGit && "git 없음" }, () => {
  const r = tempRepo();
  const copy = mkdtempSync(join(tmpdir(), "build-meta-copy-"));
  try {
    writeFileSync(join(copy, "package.json"), JSON.stringify({ name: "x", version: "2.3.4" }));
    assert.equal(resolveBuildMeta({ root: copy, env: {} }).commit, "", "저장소가 아니면 지어내지 않는다");
    assert.equal(resolveBuildMeta({ root: copy, env: { APP_GIT_DIR: r.dir } }).commit, r.sha);
    assert.equal(resolveBuildMeta({ root: copy, env: { APP_GIT_DIR: r.dir, APP_COMMIT: "" } }).commit, "", "APP_COMMIT 지정이 우선(빈 값 포함)");
  } finally { r.cleanup(); rmSync(copy, { recursive: true, force: true }); }
});

test("CLI 출력은 build-release.sh 가 읽는 KEY=값 세 줄", () => {
  const out = execFileSync(process.execPath, [join(ROOT, "scripts/build-meta.mjs")], {
    env: { ...process.env, APP_COMMIT: "e2999fd", APP_BUILT_AT: "2026-10-02T06:00:00.000Z" },
  }).toString();
  assert.equal(out, `APP_VERSION=${pkg.version}\nAPP_COMMIT=e2999fd\nAPP_BUILT_AT=2026-10-02T06:00:00.000Z\n`);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

test("빌드 메타는 서버 전용 — 클라이언트 컴포넌트·로그인 화면이 app-build 를 import 하면 무인증 JS 청크에 커밋이 박힌다", () => {
  const offenders: string[] = [];
  for (const f of sourceFiles(join(ROOT, "src"))) {
    const src = readFileSync(f, "utf8");
    const importsBuild = /from\s+["'][^"']*app-build["']/.test(src) || /process\.env\.APP_(COMMIT|BUILT_AT|VERSION)/.test(src);
    if (!importsBuild || f.endsWith(join("lib", "app-build.ts"))) continue;
    if (/^\s*["']use client["']/m.test(src) || f.includes(join("app", "login"))) offenders.push(f.slice(ROOT.length + 1));
  }
  assert.deepEqual(offenders, [], "빌드 메타는 /api/auth/me 의 build 로 받는다");
  const login = readFileSync(join(ROOT, "src/app/login/page.tsx"), "utf8");
  assert.doesNotMatch(login, /buildLabel|APP_BUILD/, "로그인 전 화면은 버전 미표기");
});

test("/api/health 상세는 nginx 를 거치지 않은 서버 내부 호출에만 (TRUST_PROXY=true + X-Real-IP 없음 + 루프백)", () => {
  const h = (o: Record<string, string> = {}) => new Headers(o);
  // Next 서버는 XFF 가 없으면 소켓 주소로 채운다 — 앱 포트 직접 호출은 루프백 한 개
  assert.equal(isLocalHealthProbe(h({ "x-forwarded-for": "127.0.0.1" }), "true"), true, "배포 스크립트: 127.0.0.1:<PORT> 직접");
  assert.equal(isLocalHealthProbe(h({ "x-forwarded-for": "::1" }), "true"), true, "IPv6 루프백");
  assert.equal(isLocalHealthProbe(h({ "x-forwarded-for": "::ffff:127.0.0.1" }), "true"), true, "IPv4-mapped 루프백");
  assert.equal(isLocalHealthProbe(h({ "x-real-ip": "10.0.0.5", "x-forwarded-for": "10.0.0.5" }), "true"), false, "nginx 경유(외부)");
  assert.equal(isLocalHealthProbe(h({ "x-real-ip": "127.0.0.1", "x-forwarded-for": "127.0.0.1" }), "true"), false, "X-Real-IP 가 있으면 값과 무관하게 외부(nginx 가 붙인다)");
  assert.equal(isLocalHealthProbe(h({ "x-forwarded-for": "10.0.0.5" }), "true"), false, "루프백이 아닌 출처");
  assert.equal(isLocalHealthProbe(h({ "x-forwarded-for": "10.0.0.5, 127.0.0.1" }), "true"), false, "다단 홉");
  assert.equal(isLocalHealthProbe(h(), "true"), false, "출처 불명");
  for (const tp of [undefined, "", "false", "TRUE"]) {
    assert.equal(isLocalHealthProbe(h({ "x-forwarded-for": "127.0.0.1" }), tp), false, `TRUST_PROXY=${tp}: 프록시 없이 직접 노출될 수 있어 출처 판별 불가 → 상세 없음`);
  }
});

test("외부 /api/health 는 ok 만 — 버전·커밋·빌드 시각·스키마·가동 시간은 내부 호출 분기에만", () => {
  const src = readFileSync(join(ROOT, "src/app/api/health/route.ts"), "utf8");
  const pub = src.match(/if \(!isLocalHealthProbe\([^)]*\)\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(pub, "외부 분기(isLocalHealthProbe 부정)가 있어야 한다");
  assert.match(pub[1], /NextResponse\.json\(\{ ok \}/);
  assert.doesNotMatch(pub[1], /version|commit|builtAt|schema|uptime|latency|db:/);
});

test("화면 표기: 버전·커밋 — 값이 없으면 아무것도 안 보인다", () => {
  const b = { version: "1.1.0", commit: "e2999fd", builtAt: "2026-10-02T06:00:00.000Z" };
  assert.equal(buildLabel(b), "v1.1.0");
  assert.equal(buildLabel(b, { withCommit: true }), "v1.1.0 · e2999fd");
  assert.equal(buildLabel({ ...b, commit: "" }, { withCommit: true }), "v1.1.0");
  assert.equal(buildLabel({ version: "", commit: "e2999fd", builtAt: "" }, { withCommit: true }), "");
});

test("빌드 시각은 서버 TZ 와 무관하게 KST 분 단위", () => {
  assert.equal(kstMinute("2026-10-02T06:00:59.999Z"), "2026-10-02 15:00 (KST)");
  assert.equal(kstMinute("2026-12-31T15:30:00.000Z"), "2027-01-01 00:30 (KST)", "자정 넘김");
  assert.equal(kstMinute(""), "");
  assert.equal(kstMinute("not-a-date"), "");
});
