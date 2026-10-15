---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# index.html Surface Brief

## Scope and Mode
- **Target**: `index.html`
- **Mode**: Operate
- **Audience & Job**: 셀프 세차장 워시 베이에서 버킷/분무기에 받아둔 물 용량(L)을 기준으로 투입할 세차 케미컬 원액 용량(ml)을 즉시 산출하고, 자주 쓰는 개인 케미컬 프리셋을 불러오거나 저장하는 세차인.

## Direction contract

- **THESIS**: 물 용량을 먼저 받고 원액을 계량해 넣는 실제 세차 동선을 토스·애플 기본 계산기 수준의 정교한 다크 유틸리티 인터페이스로 직결하며, 불필요한 혼합 총량 역산이나 장식적인 대시보드 카드 나열을 거부한다.
- **OWN-WORLD**: 딥 옵시디언 다크 지면(`#0B0D11`)과 엘리베이티드 슬레이트 패널(`#151921`, `#1E2430`), 선명한 토스 블루 액센트(`#3182F6`)와 청량한 아쿠아 보조 지표(`#20C997`), `tabular-nums`가 적용된 고대비 대형 산세리프 숫자 타이포그래피와 넉넉한 터치 반경(`16px~20px`)의 햅틱 감각 버튼 체계.
- **STORY**: 사용자는 접속 즉시 현재 물 용량(L)과 희석비율(1:N)에 따른 투입 원액(ml) 결과를 최상단 대형 판독창에서 읽고, 퀵 칩이나 직접 입력 또는 저장된 내 케미컬 프리셋 터치 한 번으로 즉시 계량값을 확정한다.
- **FIRST VIEWPORT**: 상단에는 간결한 앱 타이틀과 현재 선택된 케미컬 배지가 놓이고, 그 아래 화면의 중심부에 초대형 투입 원액 용량(`ml`) 판독 디스플레이와 계량 보조 눈금(소분 캡/펌프 환산 및 물+원액 합산 참고치)이 자리잡는다. 이어서 좌우/상하 분할된 '물 용량(L) 조절 및 버킷/분무기 퀵 버튼' 영역과 '희석 비율(1:N) 조절 및 퀵 버튼' 영역이 한눈에 들어오며, 바로 아래에서 '나만의 케미컬 프리셋' 칩 바와 추가 버튼으로 즉시 전환·저장할 수 있다.
- **FORM**: Standing exit (Canon) — 토스(Toss) / 애플 기본 계산기(Apple Calculator) 레퍼런스 기반 클린 다크 유틸리티. Seed key `300d2e20`.
- **FINISH**: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
