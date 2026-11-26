정보시스템 자산관리 (asset-inventory) — Windows 번들
================================================================

대상: Windows 10/11 · Windows Server 2016 이상, x64. 인터넷·Node 설치·관리자 권한 불필요
      (Node 22 와 SQLite 모듈이 번들에 들어 있다).
판: 같은 폴더의 VERSION 파일 (version · commit · built_at)


1. 받기·확인
------------
  PowerShell 에서 체크섬 확인 (SHA256SUMS-windows-v<버전>.txt 의 값과 같아야 함):
    Get-FileHash .\asset-inventory-windows-v<버전>.zip -Algorithm SHA256

  zip 을 원하는 위치(예: C:\asset-inventory)에 풀면 asset-inventory 폴더가 생긴다.
  인터넷에서 받은 zip 이면 풀기 전에 [속성] → [차단 해제] 를 체크한다.


2. 실행
-------
  start.cmd 를 실행(더블클릭)한다. 처음 실행하면:
    - .env       : 설정 파일(무작위 AUTH_SECRET) 생성
    - data.db    : DB 생성 — 계정 3개
                   admin@example.go.kr / admin123   (총괄)
                   user@example.go.kr  / user123
                   viewer@example.go.kr / viewer123
  브라우저에서 http://127.0.0.1:3100 으로 접속. 총괄 계정은 첫 로그인 때 비밀번호 변경과
  2단계 인증(스마트폰 인증 앱) 등록을 마쳐야 다른 메뉴를 쓸 수 있다.
  쓰지 않는 계정은 [설정 → 사용자 관리] 에서 비활성화한다.
  종료: 콘솔 창에서 Ctrl+C.
  처음 기동하기 전에 설정부터 바꾸려면: node\node.exe scripts\deploy\windows\start.mjs init
  (.env 와 data.db 만 만들고 끝난다)


3. 설정 (.env — 바꾼 뒤 start.cmd 다시 실행)
--------------------------------------------
  PORT=3100            접속 포트
  HOSTNAME=127.0.0.1   이 PC 에서만 접속. 다른 PC 에서 접속하려면 0.0.0.0 으로 바꾸고
                       Windows 방화벽에서 그 포트의 인바운드를 허용한다.
  사내망에 열 때는 HTTPS 를 켠다(HTTP 는 비밀번호·세션이 평문으로 오간다):
    TLS_CERT_PATH=C:\asset-inventory-tls\cert.pem   (PEM 인증서, 중간 인증서 포함)
    TLS_KEY_PATH=C:\asset-inventory-tls\key.pem
    HTTPS_PORT=443 · HTTP_PORT=80 (HTTP 는 HTTPS 로 넘김)
  인증서는 앱 폴더 밖에 두면 업그레이드 때 폴더를 통째로 바꿔도 그대로 남는다.


4. 백업
-------
  backup.cmd — 실행 중에도 안전하게 backups\data-<시각>.db 로 복사한다.
  정기 백업은 작업 스케줄러에 backup.cmd 를 등록한다. 백업 파일은 다른 디스크에도 보관한다.


5. 업그레이드
-------------
  1) start.cmd 창에서 Ctrl+C 로 종료 → backup.cmd 실행
  2) 새 zip 을 다른 폴더에 풀고, 기존 폴더의 .env · data.db (그리고 backups\) 를 새 폴더로 복사
  3) 새 폴더의 start.cmd 실행 — DB 스키마는 첫 기동 때 자동으로 올라간다
  되돌리기: 새 폴더를 종료하고 기존 폴더의 start.cmd 를 실행 (기존 폴더의 data.db 는 1) 시점 그대로)


6. 부팅 시 자동 실행
--------------------
  작업 스케줄러 → 작업 만들기:
    트리거: 시스템 시작 시 · 동작: 프로그램 시작 = <폴더>\start.cmd, 시작 위치 = <폴더>
    [사용자가 로그온할 때만 실행] 해제, [가장 높은 권한으로 실행] 은 443/80 포트를 쓸 때만.


참고
----
  - Linux(Rocky 8.10) 운영 서버용은 asset-inventory-offline-v<버전>.tar.gz 이다. 이 번들은 nginx·systemd 없이
    앱 하나로 동작하며, 감사·접속 로그 보존기간 정리(retention 타이머)는 포함하지 않는다.
  - 사용법: docs\사용자매뉴얼.md · 관리 기능: docs\관리자매뉴얼.md (서버 운영 절차는 Linux 기준)
