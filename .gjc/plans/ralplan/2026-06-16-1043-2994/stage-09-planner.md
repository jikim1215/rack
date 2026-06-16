## Phase 5: 대시보드 확장 + 날짜필드 + 생명주기

5.1 대시보드통계 - src/app/page.tsx getStats(): byStatus(GROUP BY status), eosWarnings(eos_date 과거~90일이내), warrantyWarnings(warranty_date 동일), dataQuality(noIp/noAdmin/noRack/noOs SUM CASE), lifecycleCounts(도입/운용/점검/EoS/폐기 각 건수). statusLabels에 eos:'EoS(단종)'
5.2 대시보드UI 4패널 - 1)상태분포바: CSS flex 수평누적바, 상태별색상(active=green,inactive=gray,maintenance=amber,eos=red,decommissioned=slate)+범례 2)생명주기흐름: 5단계(도입->운용->점검->EoS->폐기) 화살표연결, 아이콘+건수, CSS flex+ChevronRight 3)EoS/보증경고: AlertTriangle, 자산명+날짜+D-day배지(만료=red,30일=red,90일=amber), 최대10건 4)데이터품질: 4항목 건수+비율, AlertCircle/CheckCircle, amber/green
5.3 AssetTable날짜 - Asset+emptyAsset에 purchase_date/warranty_date/eos_date, statusLabels에 eos:'EoS(단종)', 폼에 date입력3개(구매일/보증만료/EoS), startEdit복원, 확장상세에 날짜+D-day표시
5.4 자산API날짜 - assets/route.ts POST + assets/[id]/route.ts PUT에 purchase_date/warranty_date/eos_date 추가
검증: build, 대시보드 4패널, EoS경고, 날짜입력/표시, EoS상태
