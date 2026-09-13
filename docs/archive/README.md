# 보관 문서

정본으로 통합되어 더 이상 갱신하지 않는 문서입니다. 내용 중 아직 유효한 것은 정본에 반영돼 있습니다.

| 파일 | 왜 보관 | 정본 |
|---|---|---|
| USER-MANUAL.md | 영문판, 사용자매뉴얼과 중복 | `../사용자매뉴얼.md` |
| OPERATIONS.md, 운영매뉴얼.md | 운영 절차 중복(24h 세션 등 구정보 포함) | `../관리자매뉴얼.md` 5~7장 |
| README-설치.md, deploy-tls.md, 배포-리허설-VMware.md, 실서버-반입-최종점검.md | install.sh(삭제됨)·Node TLS 단독 구성 등 구 배포 흐름 | `../DEPLOY.md`, 번들의 `scripts/deploy/README-반입.md` |
| itam-공존-작업정리.md | 기관 실명 포함 — **저장소 미포함(로컬 보관)**. 인증서 공유 결정은 DEPLOY.md 3절에 반영 | `../DEPLOY.md` |
| DB-DESIGN-QA.md | 설계 Q&A → ADR 로 승격 | `../ADR.md` |
| UI_GUIDE.md | 디자인 토큰 설명 → ARCHITECTURE 로 | `../ARCHITECTURE.md` |

역사적 기록이 필요할 때만 참고하세요. 여기 있는 절차를 실서버에 그대로 적용하지 마세요.
