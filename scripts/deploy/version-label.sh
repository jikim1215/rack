# 배포 출력용 버전 표기 "v1.1.1 (0083391)" — deploy.sh · upgrade-inplace.sh 가 source 한다.
# 입력은 문자열(파일 내용·HTTP 응답)만 받는다: 파일·curl 은 호출하는 쪽에서 — 그래서 tests/deploy-version-label.test.ts 가 그대로 검증한다.
# (rollback.sh 는 구판 트리에서도 혼자 돌아야 해서 이 파일을 쓰지 않는다.)

# 번들/설치본 VERSION 파일 내용(version=… / commit=… / built_at=…)
ver_label_kv() {
  local v c
  v="$(sed -n 's/^version=//p' <<<"${1-}")"
  c="$(sed -n 's/^commit=//p' <<<"${1-}")"
  if [[ -n "$v" ]]; then echo "v${v}${c:+ (${c})}"; else echo "(버전 정보 없음)"; fi
}

# /api/health JSON (버전 표기 이전 판은 commit 이 없고 version 이 늘 1.0.0)
ver_label_json() {
  local v c
  v="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' <<<"${1-}")"
  c="$(sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' <<<"${1-}")"
  if [[ -n "$v" ]]; then echo "v${v}${c:+ (${c})}"; else echo "(응답 없음)"; fi
}
