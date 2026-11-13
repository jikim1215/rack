// 사용자 계정 엑셀 일괄 등록 — 양식 생성 + 행 검증 (순수 모듈, 단위테스트 대상)
// 규약:
//   - 비밀번호 칸은 없다. 초기 비밀번호 = 이메일(로그인 ID) + 첫 로그인 시 변경 강제 — 관리자 비밀번호 초기화와 같은 규약.
//     평문 비밀번호가 담긴 엑셀이 돌아다니지 않게 하고, 서버가 평문을 받지 않는 규약(sha512 프리해시)도 지킨다.
//   - 역할은 팀·전체열람만. 총괄은 권한 상승 경로가 되므로 한 명씩 화면에서 만든다.
//   - 팀은 이름으로 받아 기존 팀에 연결한다(오타로 팀이 새로 생기지 않게 자동 생성하지 않는다).
//   - 한 행이라도 오류면 아무것도 등록하지 않는다(라우트가 오류 목록을 돌려준다) — 부분 등록은 어디까지 들어갔는지 추적이 어렵다.
import ExcelJS from "exceljs";
import { validateEmail, normalizeEmail } from "./user-admin.ts";
import { isValidRule, parseRules } from "./ip-access.ts";

export const USER_IMPORT_MAX_ROWS = 500;

export const USER_IMPORT_HEADERS = ["이메일", "이름", "역할", "팀", "허용IP"] as const;
type HeaderKey = "username" | "display_name" | "role" | "team" | "allowed_ips";
const HEADER_KEYS: Record<(typeof USER_IMPORT_HEADERS)[number], HeaderKey> = {
  "이메일": "username", "이름": "display_name", "역할": "role", "팀": "team", "허용IP": "allowed_ips",
};

const ROLE_ALIASES: Record<string, "team" | "viewer" | "admin"> = {
  "팀": "team", "team": "team",
  "전체열람": "viewer", "열람": "viewer", "viewer": "viewer",
  "총괄": "admin", "admin": "admin",
};

export interface ImportUser {
  /** 엑셀 행 번호(1부터, 헤더 포함) — 오류 보고용 */
  row: number;
  username: string;
  display_name: string;
  role: "team" | "viewer";
  team_id: number | null;
  team_name: string;
  allowed_ips: string;
}

export interface ImportError {
  row: number;
  username: string;
  message: string;
}

export interface ImportContext {
  /** 이미 등록된 이메일(정규화된 소문자) */
  existingUsernames: ReadonlySet<string>;
  /** 팀 이름 → id */
  teams: ReadonlyArray<{ id: number; team_name: string }>;
}

const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, "").toLowerCase();

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && v && "text" in v) return String((v as { text: unknown }).text ?? "").trim(); // 하이퍼링크 셀(이메일 자동 링크)
  return String(v).trim();
}

/** 시트(2차원 배열, 첫 행 = 헤더) → 등록 후보 + 오류. 빈 행은 건너뛴다. */
export function validateUserRows(rows: unknown[][], ctx: ImportContext): { users: ImportUser[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const users: ImportUser[] = [];
  if (rows.length === 0) return { users, errors: [{ row: 1, username: "", message: "빈 시트입니다. 양식을 내려받아 작성하세요." }] };

  const col: Partial<Record<HeaderKey, number>> = {};
  (rows[0] ?? []).forEach((h, i) => {
    const n = norm(cellText(h));
    for (const label of USER_IMPORT_HEADERS) {
      const key = HEADER_KEYS[label];
      if (col[key] === undefined && n.startsWith(norm(label))) col[key] = i;
    }
  });
  if (col.username === undefined) {
    return { users, errors: [{ row: 1, username: "", message: "'이메일' 열이 없습니다. 양식을 내려받아 첫 행(헤더)을 그대로 두고 작성하세요." }] };
  }

  const teamByName = new Map(ctx.teams.map((t) => [norm(t.team_name), t]));
  const seen = new Map<string, number>();
  const get = (r: unknown[], k: HeaderKey) => (col[k] === undefined ? "" : cellText(r[col[k]!]));

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every((c) => cellText(c) === "")) continue;
    const rowNo = i + 1;
    const rawEmail = get(r, "username");
    const fail = (message: string) => errors.push({ row: rowNo, username: rawEmail, message });

    const emailError = validateEmail(rawEmail);
    if (emailError) { fail(emailError); continue; }
    const username = normalizeEmail(rawEmail);
    if (ctx.existingUsernames.has(username)) { fail("이미 등록된 이메일입니다."); continue; }
    const firstRow = seen.get(username);
    if (firstRow !== undefined) { fail(`파일 안에서 중복된 이메일입니다(${firstRow}행과 같음).`); continue; }
    seen.set(username, rowNo);

    const display_name = get(r, "display_name");
    if (display_name.length > 100) { fail("이름은 100자 이하여야 합니다."); continue; }

    const roleText = get(r, "role");
    const role = roleText === "" ? "team" : ROLE_ALIASES[norm(roleText)];
    if (!role) { fail(`역할 '${roleText}'을(를) 알 수 없습니다. 팀 또는 전체열람으로 적으세요.`); continue; }
    if (role === "admin") { fail("총괄 계정은 일괄 등록할 수 없습니다. 설정 → 사용자 관리에서 한 명씩 추가하세요."); continue; }

    const teamText = get(r, "team");
    let team: { id: number; team_name: string } | undefined;
    if (role === "team") {
      if (teamText === "") { fail("팀 역할은 소속 팀을 적어야 합니다."); continue; }
      team = teamByName.get(norm(teamText));
      if (!team) { fail(`팀 '${teamText}'이(가) 없습니다. 설정 → 팀 관리에서 먼저 만들거나 이름을 확인하세요.`); continue; }
    } else if (teamText !== "") {
      fail("전체열람 역할은 팀을 비워 두세요(팀에 소속되지 않습니다)."); continue;
    }

    const ipText = get(r, "allowed_ips");
    const ipTokens = ipText.split(/[\s,;\n]+/).filter(Boolean);
    const badIp = ipTokens.find((t) => !isValidRule(t));
    if (badIp) { fail(`허용IP '${badIp}' 형식이 올바르지 않습니다(예: 10.20.30.0/24).`); continue; }

    users.push({
      row: rowNo, username, display_name, role,
      team_id: team?.id ?? null, team_name: team?.team_name ?? "",
      allowed_ips: parseRules(ipText).join(","),
    });
  }

  if (users.length + errors.length === 0) errors.push({ row: 2, username: "", message: "등록할 행이 없습니다." });
  if (users.length + errors.length > USER_IMPORT_MAX_ROWS) {
    return { users: [], errors: [{ row: 1, username: "", message: `한 번에 최대 ${USER_IMPORT_MAX_ROWS}명까지 등록할 수 있습니다. 파일을 나눠 올리세요.` }] };
  }
  return { users, errors };
}

/** 등록 양식(.xlsx). 첫 시트 = 입력용(헤더만), 둘째 시트 = 작성 안내·예시·현재 팀 목록. */
export async function buildUserImportTemplate(teamNames: readonly string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("사용자등록");
  ws.columns = [{ width: 32 }, { width: 14 }, { width: 12 }, { width: 20 }, { width: 30 }];
  ws.addRow([...USER_IMPORT_HEADERS]);
  ws.getRow(1).font = { bold: true };

  const guide = wb.addWorksheet("작성안내");
  guide.columns = [{ width: 16 }, { width: 80 }];
  guide.addRows([
    ["항목", "설명"],
    ["이메일", "필수. 로그인 ID. 이미 등록된 이메일·파일 안 중복은 오류."],
    ["이름", "선택. 100자 이하."],
    ["역할", "팀 또는 전체열람 (비우면 팀). 총괄은 일괄 등록 불가 — 화면에서 한 명씩 추가."],
    ["팀", "역할이 팀이면 필수 — 아래 '현재 팀 목록'의 이름 그대로. 전체열람이면 비워 둠."],
    ["허용IP", "선택. 이 대역에서만 로그인 허용. 콤마로 여러 개 (예: 10.20.30.0/24, 10.20.31.5). 비우면 제한 없음."],
    [],
    ["초기 비밀번호", "각자의 이메일 주소. 첫 로그인 때 새 비밀번호를 설정해야 합니다."],
    ["오류 처리", "한 행이라도 오류가 있으면 아무 계정도 등록되지 않습니다. 오류 행을 고쳐 다시 올리세요."],
    ["상한", `한 번에 최대 ${USER_IMPORT_MAX_ROWS}명.`],
    [],
    ["예시", "hong@example.go.kr | 홍길동 | 팀 | 정보운영팀 | 10.20.30.0/24"],
    ["예시", "kim@example.go.kr | 김열람 | 전체열람 | (비움) | (비움)"],
    [],
    ["현재 팀 목록", teamNames.length ? "" : "(등록된 팀 없음 — 설정 → 팀 관리에서 먼저 만드세요)"],
    ...teamNames.map((n) => ["", n]),
  ]);
  guide.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
