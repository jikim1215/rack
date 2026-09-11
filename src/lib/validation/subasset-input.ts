// ── 부속자산 등록/수정 본문 정규화 (순수 모듈) ──
// POST /api/sub-assets 와 PUT /api/sub-assets/[id] 가 같은 규칙을 공유한다 (라우트 간 중복 제거, 비평 반영).
import { str, oneOf } from "./input.ts";

/** 요청 본문에서 부속자산 업무 필드를 정규화한다 (status 는 active/disposed 화이트리스트). */
export function parseSubAssetBody(b: Record<string, unknown>) {
  return {
    asset_code: str(b, "asset_code", { max: 100 }),
    category_major: str(b, "category_major", { max: 100 }),
    category_mid: str(b, "category_mid", { max: 100 }),
    category_minor: str(b, "category_minor", { max: 100 }),
    sub_name: str(b, "sub_name", { required: true, max: 200, label: "자산명" }),
    spec: str(b, "spec", { max: 500 }),
    serial_number: str(b, "serial_number", { max: 200 }),
    acquired_date: str(b, "acquired_date", { max: 20 }),
    user_name: str(b, "user_name", { max: 100 }),
    place: str(b, "place", { max: 200 }),
    purpose: str(b, "purpose", { max: 500 }),
    note: str(b, "note", { max: 1000 }),
    status: oneOf(b, "status", ["active", "disposed"] as const, { default: "active" }),
  };
}
