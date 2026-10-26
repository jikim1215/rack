// tests/feedback-mail.test.ts — 개선의견 알림 메일 본문(접수 → 총괄, 답변 → 작성자)
import { test } from "node:test";
import assert from "node:assert/strict";
import { newFeedbackMail, feedbackReplyMail, type FeedbackMailSource } from "../src/lib/feedback-mail.ts";
import type { MailRelayConfig } from "../src/lib/mail-config.ts";

const config: MailRelayConfig = {
  host: "relay.example.go.kr", port: 25, security: "NONE",
  fromAddress: "noreply@example.go.kr", fromName: "자산관리",
  baseUrl: "https://itam.example.go.kr/", enabled: true,
};

const base: FeedbackMailSource = {
  id: 7, category: "improvement", title: "IP관리 쓰기 권한", content: "스팸정책팀도 대역을\n등록하게 해 주세요",
  page_path: "/ipam", status: "open", created_by: "kim@example.go.kr", created_by_name: "김직원",
  team_name: "스팸정책팀", admin_reply: "", replied_by: "",
};

test("접수 메일: 유형·제목·작성자(이름·ID·팀)·화면·본문·처리 링크", () => {
  const m = newFeedbackMail(config, base);
  assert.equal(m.subject, "[자산관리] 개선의견 접수 — IP관리 쓰기 권한");
  assert.match(m.text, /유형   : 개선제안/);
  assert.match(m.text, /작성자 : 김직원 \(kim@example\.go\.kr\) · 스팸정책팀/);
  assert.match(m.text, /화면   : \/ipam/);
  assert.ok(m.text.includes("스팸정책팀도 대역을\n등록하게 해 주세요"), "본문 줄바꿈 보존");
  assert.ok(m.text.endsWith("처리하기: https://itam.example.go.kr/feedback"), "기준 URL 끝 슬래시 정규화");
});

test("접수 메일: 이름·팀·화면 경로가 비면 해당 표기 생략", () => {
  const m = newFeedbackMail(config, { ...base, created_by_name: "", team_name: null, page_path: "" });
  assert.match(m.text, /작성자 : kim@example\.go\.kr\n/);
  assert.ok(!m.text.includes("화면"));
});

test("제목 개행은 한 줄로 접는다 (메일 헤더 주입 방지)", () => {
  const m = newFeedbackMail(config, { ...base, title: "제목\r\nBcc: evil@example.com" });
  assert.ok(!/[\r\n]/.test(m.subject));
  assert.equal(m.subject, "[자산관리] 개선의견 접수 — 제목 Bcc: evil@example.com");
});

test("답변 메일: 처리상태 라벨·답변자·답변·원문·내 의견 링크", () => {
  const m = feedbackReplyMail(config, { ...base, status: "planned", admin_reply: "다음 배포에 반영합니다.", replied_by: "admin@example.go.kr" });
  assert.equal(m.subject, "[자산관리] 개선의견 답변 — IP관리 쓰기 권한");
  assert.match(m.text, /처리상태 : 반영예정/);
  assert.match(m.text, /답변자   : admin@example\.go\.kr/);
  assert.ok(m.text.includes("[답변]\n다음 배포에 반영합니다."));
  assert.ok(m.text.includes("[보내주신 내용]\n스팸정책팀도 대역을\n등록하게 해 주세요"));
  assert.ok(m.text.endsWith("확인하기: https://itam.example.go.kr/feedback?mine=1"));
});
