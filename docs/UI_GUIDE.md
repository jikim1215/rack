# UI 디자인 가이드

## 디자인 원칙
1. "매일 쓰는 업무 도구처럼 보여야 한다. 마케팅 페이지가 아니라 관리자 대시보드."
2. "데이터가 주인공이다. 장식은 최소화하고 정보 밀도를 높인다."
3. "공공기관 업무 환경에 적합한 절제된 디자인. 밝고 깔끔하게."

## AI 슬롭 안티패턴 — 하지 마라
| 금지 사항 | 이유 |
|-----------|------|
| backdrop-filter: blur() | glass morphism은 AI 템플릿의 가장 흔한 징후 |
| gradient-text | AI가 만든 SaaS 랜딩의 1번 특징 |
| box-shadow 글로우 애니메이션 | 네온 글로우 = AI 슬롭 |
| 보라/인디고 브랜드 색상 | "AI = 보라색" 클리셰 |
| 모든 카드에 동일한 rounded-2xl | 균일한 둥근 모서리는 템플릿 느낌 |
| 배경 gradient orb | 모든 AI 랜딩 페이지에 있는 장식 |
| 불필요한 애니메이션 | 업무 도구에 산만한 효과 금지 |

## 색상
### 배경
| 용도 | 값 |
|------|------|
| 페이지 | #f8fafc (slate-50) |
| 카드 | #ffffff (white) |
| 사이드바 | #0f172a (slate-900) |

### 텍스트
| 용도 | 값 |
|------|------|
| 주 텍스트 | #0f172a (slate-900) |
| 본문 | #334155 (slate-700) |
| 보조 | #64748b (slate-500) |
| 비활성 | #94a3b8 (slate-400) |
| 사이드바 텍스트 | #cbd5e1 (slate-300) |

### 시맨틱 색상
| 용도 | 값 |
|------|------|
| 액센트/주요 | #2563eb (blue-600) |
| 성공/운용중 | #16a34a (green-600) |
| 경고/점검중 | #f59e0b (amber-500) |
| 위험/EoS | #dc2626 (red-600) |
| 네트워크 | #22c55e (green-500) |
| 보안 | #ef4444 (red-500) |
| 스토리지 | #a855f7 (purple-500) |
| 서버 | #3b82f6 (blue-500) |

## 컴포넌트
### 카드
```
bg-white rounded-lg border p-5
요약 카드: bg-white rounded-lg border border-l-4 border-l-{color}-500 p-4
```

### 버튼
```
Primary: bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700
Secondary: border px-3 py-2 rounded-lg text-sm hover:bg-slate-50 text-slate-600
Danger: text-slate-400 hover:text-red-600
```

### 입력 필드
```
.form-input: w-full px-3 py-2 border rounded-lg text-sm outline-none
focus: ring-2 ring-blue-500/30 border-blue-600
```

### 테이블
```
thead: bg-slate-50 border-b text-left text-slate-600
tbody tr: border-b last:border-0 hover:bg-slate-50
td: p-3 text-sm
```

## 레이아웃
- 사이드바: 고정 w-60, 다크 네이비
- 콘텐츠: flex-1, overflow-y-auto, p-6
- 그리드: grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4
- 간격: gap-3~6, mb-4~8

## 타이포그래피
| 용도 | 스타일 |
|------|--------|
| 페이지 제목 | text-2xl font-bold text-slate-900 |
| 섹션 제목 | font-semibold text-slate-900 |
| 카드 값 | text-2xl font-bold |
| 본문 | text-sm text-slate-700 |
| 보조 | text-xs text-slate-500 |
| 라벨 | text-xs text-slate-500 uppercase |

## 애니메이션
- transition-colors (호버 색상 전환) — 허용
- 그 외 모든 애니메이션 금지

## 아이콘
- Lucide React, size={16~18}
- 아이콘 컨테이너(둥근 배경 박스)는 유형 표시용으로만 사용
- strokeWidth 기본값 유지
