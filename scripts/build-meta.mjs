// 빌드 메타(버전·커밋·빌드 시각) 단일 계산처 — next.config.ts(화면·/api/health 에 박음)와
// scripts/deploy/build-release.sh(번들 VERSION 파일)가 같은 값을 쓰도록 여기서만 만든다.
//   version : package.json 의 version (SemVer — 올리는 규칙은 CHANGELOG.md 머리말)
//   commit  : APP_COMMIT(빌드 스크립트가 지정) > git(APP_GIT_DIR 또는 소스 루트). 작업 트리에 미커밋 변경이 있으면 "-dirty".
//             git 이 없으면 "" — 지어내지 않는다.
//   builtAt : APP_BUILT_AT > 지금(ISO UTC). next build 의 여러 워커가 같은 값을 쓰도록 호출자가 env 에 고정한다.
// 사용: node scripts/build-meta.mjs  → APP_VERSION=… / APP_COMMIT=… / APP_BUILT_AT=… (셸 eval 용)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const COMMIT = /^[0-9a-f]{7,40}(?:-dirty)?$/;

function git(dir, args) {
  return execFileSync("git", ["-c", "safe.directory=*", "-C", dir, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000, windowsHide: true,
  }).trim();
}

/** 소스 git 에서 "abc1234" 또는 "abc1234-dirty". git 이 없거나 저장소가 아니면 "". */
export function gitCommit(dir) {
  try {
    const sha = git(dir, ["rev-parse", "--short=7", "HEAD"]);
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return "";
    return git(dir, ["status", "--porcelain"]) ? `${sha}-dirty` : sha;
  } catch {
    return "";
  }
}

/**
 * @param {{ root: string, env?: Record<string, string | undefined>, now?: () => Date }} opts
 * @returns {{ version: string, commit: string, builtAt: string }}
 */
export function resolveBuildMeta({ root, env = process.env, now = () => new Date() }) {
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  if (typeof version !== "string" || !SEMVER.test(version)) throw new Error(`package.json version 이 SemVer 가 아님: ${version}`);

  let commit;
  if (env.APP_COMMIT !== undefined) {
    commit = env.APP_COMMIT.trim();
    if (commit && !COMMIT.test(commit)) throw new Error(`APP_COMMIT 형식 오류(7~40자리 16진수[-dirty]): ${commit}`);
  } else {
    commit = gitCommit(env.APP_GIT_DIR || root);
  }

  const builtAt = env.APP_BUILT_AT || now().toISOString();
  if (Number.isNaN(Date.parse(builtAt))) throw new Error(`APP_BUILT_AT 이 날짜가 아님: ${builtAt}`);
  return { version, commit, builtAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const m = resolveBuildMeta({ root });
  process.stdout.write(`APP_VERSION=${m.version}\nAPP_COMMIT=${m.commit}\nAPP_BUILT_AT=${m.builtAt}\n`);
}
