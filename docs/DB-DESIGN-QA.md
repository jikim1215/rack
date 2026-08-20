# 단일 파일 DB(SQLite) 설계 질의응답 — 심의·기술협상 대응 자료

> 목적: "왜 Oracle/PostgreSQL이 아닌가"라는 심의 질의에 대한 공식 답변. 코드·설정 근거 병기.

## Q1. SQLite는 장난감 DB 아닌가?
아니다. 항공기(에어버스), 스마트폰 전체(iOS/Android), 브라우저 전체가 SQLite를 운영 DB로 쓴다.
본 시스템의 특성 — **폐쇄망 · 단일 서버 · 동시 사용자 ~10명 · 쓰기 빈도 낮음(자산 변경은 하루 수십 건)** — 은 SQLite의 설계 목표(sqlite.org/whentouse)와 정확히 일치한다.
오히려 별도 DBMS는 폐쇄망에서 **패치·계정·포트 관리 대상**을 하나 더 만드는 보안 부채다.

## Q2. 동시성은?
- WAL(Write-Ahead Logging) 모드: 읽기와 쓰기가 서로를 차단하지 않는다 (`src/lib/db.ts` pragma).
- 쓰기는 직렬화되지만, 본 시스템의 쓰기는 ms 단위 단건 트랜잭션이라 10명 규모에서 대기 체감 없음 (성능 기준선: OPERATIONS.md §6).
- 대량 작업(임포트·병합·롤백)은 모두 **단일 트랜잭션**으로 묶여 부분 실패 상태가 존재하지 않는다.

## Q3. 장애·손상 시 복구는?
- 일 1회 자동 백업 (systemd `asset-backup.timer` → `backup.sh`, 무결성 검증 포함).
- 복구는 파일 복사 수준의 단순성: `restore.sh <백업파일>` — DBMS 기동/계정/테이블스페이스 절차가 없다.
- 월 1회 복구 리허설 절차 + 기록 양식이 운영 매뉴얼에 포함 (OPERATIONS.md §4).
- `db-verify.mjs`가 PRAGMA integrity_check로 언제든 무결성 판정.
- 감사로그가 append-only(DB 트리거 강제)라 복구 후 유실 구간을 로그 시각으로 특정할 수 있다.

## Q4. 데이터가 커지면?
| 규모 | 판정 |
|---|---|
| 현재 (자산 866 · 로그 7천행) | DB 파일 수십 MB — 여유 |
| 자산 1만 · 로그 연 10만행 | 검증된 인덱스 구성으로 대응 (감사 조회 TEMP B-TREE 없는 인덱스 스캔 실측). 자산 API는 서버측 페이지네이션 경로 제공 |
| SQLite 이론 한계 | 281TB / 단일 테이블 수십억 행 — 본 도메인에서 도달 불가 |

## Q5. 여러 서버로 확장해야 하면?
전제가 바뀌는 경우(다중 기관 중앙 집중 등)는 DB 교체가 아니라 **아키텍처 재설계 사안**이다.
다만 스키마는 표준 SQL(FK/CHECK/뷰/트리거)로 작성돼 있어 PostgreSQL 이관 장벽이 낮고,
전 데이터가 단일 파일이라 이관 시 추출 절차도 단순하다 (ARCHITECTURE.md 참조).

## Q6. 백업 중 쓰기가 일어나면?
백업·보존 프루닝·앱은 공용 lockfile로 상호배제하며(`retention-runner.ts`), 백업은 SQLite online backup API 기반이라 서비스 중단이 없다.

## Q7. 점검 기준 (하자검수 시)
1. `PRAGMA integrity_check` = ok
2. WAL 파일 크기가 비정상 증식하지 않는가 (checkpoint 동작)
3. 백업 타이머 최근 실행 이력 (`systemctl list-timers`)
4. 성능 기준선(OPERATIONS.md §6) 대비 열화 여부
