// tests/feedback.test.ts — 개선의견 접수: 입력 검증·권한 정책(순수) + 스키마/투표 토글(임시 DB)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateFeedbackInput, validateModeration,
  canEditFeedback, canDeleteFeedback, canModerateFeedback, canVoteFeedback,
  TITLE_MAX, CONTENT_MAX,
} from "../src/lib/feedback.ts";
import type { Actor } from "../src/lib/authz.ts";

const admin: Actor = { userId: 1, username: "admin", role: "admin", teamId: null, perms: {} };
const alice: Actor = { userId: 2, username: "alice", role: "team", teamId: 10, perms: {} };
const bob: Actor = { userId: 3, username: "bob", role: "viewer", teamId: null, perms: {} };

// ── 입력 검증 ──
test("validateFeedbackInput: 정상 입력은 trim 후 통과", () => {
  const r = validateFeedbackInput({ category: "bug", title: "  제목 ", content: " 내용 ", page_path: "/assets?q=1" });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value, { category: "bug", title: "제목", content: "내용", page_path: "/assets?q=1" });
});

test("validateFeedbackInput: 유형 누락은 불편사항 기본값, 잘못된 유형은 거부", () => {
  const ok = validateFeedbackInput({ title: "t", content: "c" });
  assert.ok(ok.ok && ok.value.category === "inconvenience");
  const bad = validateFeedbackInput({ category: "hack", title: "t", content: "c" });
  assert.ok(!bad.ok);
});

test("validateFeedbackInput: 제목/내용 공백·길이 초과 거부", () => {
  assert.ok(!validateFeedbackInput({ title: "   ", content: "c" }).ok);
  assert.ok(!validateFeedbackInput({ title: "t", content: "" }).ok);
  assert.ok(!validateFeedbackInput({ title: "x".repeat(TITLE_MAX + 1), content: "c" }).ok);
  assert.ok(!validateFeedbackInput({ title: "t", content: "x".repeat(CONTENT_MAX + 1) }).ok);
});

test("validateFeedbackInput: 화면 경로는 앱 내부 절대경로만 — 외부 URL/프로토콜 상대경로는 비움", () => {
  for (const bad of ["https://evil.example", "//evil.example/x", "javascript:alert(1)", "assets"]) {
    const r = validateFeedbackInput({ title: "t", content: "c", page_path: bad });
    assert.ok(r.ok && r.value.page_path === "", `page_path=${bad} 는 비워져야 함`);
  }
});

test("validateModeration: 지정 필드만 반환, 잘못된 enum 거부, 빈 요청 거부", () => {
  const r = validateModeration({ status: "done", admin_reply: " 반영했습니다 " });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value, { status: "done", admin_reply: "반영했습니다" });
  assert.ok(!validateModeration({ status: "closed" }).ok);
  assert.ok(!validateModeration({ priority: "urgent" }).ok);
  assert.ok(!validateModeration({}).ok);
});

// ── 권한 정책 ──
test("처리(상태/답변)는 총괄만", () => {
  assert.equal(canModerateFeedback(admin), true);
  assert.equal(canModerateFeedback(alice), false);
  assert.equal(canModerateFeedback(bob), false);
  assert.equal(canModerateFeedback(null), false);
});

test("수정/삭제: 작성자는 접수 상태에서만, 검토 시작 후 잠금, 총괄은 항상, 타인은 불가", () => {
  const mineOpen = { user_id: 2, status: "open" };
  const mineReview = { user_id: 2, status: "in_review" };
  assert.equal(canEditFeedback(alice, mineOpen), true);
  assert.equal(canEditFeedback(alice, mineReview), false);
  assert.equal(canEditFeedback(bob, mineOpen), false);
  assert.equal(canEditFeedback(admin, mineReview), true);
  assert.equal(canDeleteFeedback(alice, mineOpen), true);
  assert.equal(canDeleteFeedback(alice, mineReview), false);
  assert.equal(canEditFeedback(null, mineOpen), false);
  // 계정 삭제로 user_id NULL 이 된 글은 총괄만
  assert.equal(canEditFeedback(alice, { user_id: null, status: "open" }), false);
  assert.equal(canEditFeedback(admin, { user_id: null, status: "open" }), true);
});

test("공감: 본인 글 제외 전원 가능(viewer 포함)", () => {
  const byAlice = { user_id: 2, status: "open" };
  assert.equal(canVoteFeedback(alice, byAlice), false);
  assert.equal(canVoteFeedback(bob, byAlice), true);
  assert.equal(canVoteFeedback(admin, byAlice), true);
  assert.equal(canVoteFeedback(null, byAlice), false);
});

// ── 스키마 + 투표 토글 (임시 DB) ──
const dir = mkdtempSync(join(tmpdir(), "asset-feedback-"));
process.env.ASSET_DB_PATH = join(dir, "test.db");
const { getDb } = await import("../src/lib/db.ts");
const db = getDb();

let feedbackId = 0;
before(() => {
  db.prepare("INSERT INTO users (id, username, password_hash, display_name, role) VALUES (2,'alice','x','앨리스','team'),(3,'bob','x','밥','viewer')").run();
  feedbackId = Number(db.prepare(
    "INSERT INTO feedback (category, title, content, page_path, user_id, created_by, created_by_name) VALUES ('bug','t','c','/assets',2,'alice','앨리스')",
  ).run().lastInsertRowid);
});
after(() => {
  try { db.close(); } catch { /* noop */ }
  rmSync(dir, { recursive: true, force: true });
});

test("schema: feedback 메뉴 권한이 3역할 모두 시드되고 viewer도 쓰기 가능", () => {
  const rows = db.prepare("SELECT role, can_access, can_write, can_approve FROM menu_permissions WHERE menu_key = 'feedback' ORDER BY role").all() as
    { role: string; can_access: number; can_write: number; can_approve: number }[];
  assert.deepEqual(rows, [
    { role: "admin", can_access: 1, can_write: 1, can_approve: 1 },
    { role: "team", can_access: 1, can_write: 1, can_approve: 0 },
    { role: "viewer", can_access: 1, can_write: 1, can_approve: 0 },
  ]);
});

test("schema: CHECK 제약 — 잘못된 status/category 는 DB 단에서도 거부", () => {
  assert.throws(() => db.prepare("INSERT INTO feedback (category, title) VALUES ('nope','t')").run());
  assert.throws(() => db.prepare("UPDATE feedback SET status = 'closed' WHERE id = ?").run(feedbackId));
});

test("votes: 사용자당 1표(PK) + 글 삭제 시 CASCADE, 계정 삭제 시 작성자 NULL 로 표기 유지", () => {
  db.prepare("INSERT INTO feedback_votes (feedback_id, user_id) VALUES (?, 3)").run(feedbackId);
  assert.throws(() => db.prepare("INSERT INTO feedback_votes (feedback_id, user_id) VALUES (?, 3)").run(feedbackId), "중복 투표는 PK 위반");
  const votes = () => (db.prepare("SELECT COUNT(*) c FROM feedback_votes WHERE feedback_id = ?").get(feedbackId) as { c: number }).c;
  assert.equal(votes(), 1);

  // 작성자 계정 삭제 → user_id NULL, 스냅샷 이름은 유지
  db.prepare("DELETE FROM users WHERE id = 2").run();
  const row = db.prepare("SELECT user_id, created_by_name FROM feedback WHERE id = ?").get(feedbackId) as { user_id: number | null; created_by_name: string };
  assert.equal(row.user_id, null);
  assert.equal(row.created_by_name, "앨리스");

  // 글 삭제 → 투표 CASCADE
  db.prepare("DELETE FROM feedback WHERE id = ?").run(feedbackId);
  assert.equal(votes(), 0);
});
