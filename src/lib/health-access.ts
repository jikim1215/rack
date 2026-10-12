// /api/health 상세(버전·커밋·빌드 시각·스키마·가동 시간)를 낼지 판정 — 순수 함수(테스트 대상).
//
// 상세는 서버 안에서 앱 포트(127.0.0.1:<PORT>)로 직접 부른 요청에만 준다(배포·업그레이드·롤백 스크립트).
// 근거(운영 배치):
//   - 앱은 127.0.0.1 에만 바인딩(HOSTNAME=127.0.0.1)되고 외부 요청은 전부 nginx 를 거친다.
//   - nginx(itam.conf)는 X-Real-IP 를 $remote_addr 로 "항상" 덮어쓴다 → 클라이언트가 이 헤더를 지울 수 없다.
//   - Next 서버는 X-Forwarded-For 가 없을 때만 소켓 주소로 채운다(base-server: `??=`) → 앱 포트 직접 호출이면 루프백.
// 따라서 TRUST_PROXY=true + X-Real-IP 없음 + X-Forwarded-For 가 루프백 = nginx 를 거치지 않은 서버 내부 호출.
// TRUST_PROXY 가 true 가 아니면(프록시 없이 직접 노출 가능) 헤더로 출처를 가릴 수 없어 상세를 주지 않는다.
// (TRUST_PROXY 신뢰 모델은 lib/access-log.ts clientMeta 와 같다.)
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLocalHealthProbe(headers: Headers, trustProxy: string | undefined): boolean {
  if (trustProxy !== "true") return false;
  if (headers.has("x-real-ip")) return false;
  const xff = (headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  return xff.length === 1 && LOOPBACK.has(xff[0]);
}
