---
name: "세차 희석비율 계산기 (carwash.yunseok.kr)"
description: "셀프 세차장 물 용량 고정 기준 케미컬 원액 투입량 계산 및 프리셋 유틸리티"
colors:
  primary: "#1B64DA"
  primary-hover: "#1554B8"
  primary-bright: "#529DFF"
  secondary-aqua: "#20C997"
  danger: "#F04452"
  bg-base: "#0B0D11"
  bg-surface: "#151921"
  bg-elevated: "#1D232E"
  bg-interactive: "#252C3A"
  text-primary: "#F2F5FA"
  text-secondary: "#B4C0D4"
  text-muted: "#93A2B8"
typography:
  display:
    fontFamily: "Pretendard Variable, Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "clamp(3.25rem, 9vw, 4.5rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Pretendard Variable, Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 800
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Pretendard Variable, Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "Pretendard Variable, Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.5
  label:
    fontFamily: "Pretendard Variable, Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  sm: "10px"
  md: "12px"
  lg: "18px"
  xl: "24px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "22px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-ghost:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "9px 14px"
  chip-quick:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
---

# Design System: 세차 희석비율 계산기 (carwash.yunseok.kr)

## Overview

**Creative North Star: "The Night Bay Precision Calculator"**

셀프 세차장의 반실내·야간 조명 환경과 젖은 손이라는 실제 현장 조건에 맞춰, 토스(Toss)와 애플 기본 계산기(Apple Calculator)의 정교한 다크 유틸리티 감각을 결합한 디자인 시스템입니다. 장식적인 그래픽이나 불필요한 대시보드 위젯을 배제하고, 사용자가 물을 받은 즉시 넣어야 할 원액 용량(`ml`)을 3초 안에 판독·조작할 수 있도록 명확한 표면 위계와 큼직한 터치 타겟에 집중합니다.

**Key Characteristics:**
- 깊은 옵시디언 베이스(`#0B0D11`)와 슬레이트 표면(`#151921`, `#1D232E`)의 3단계 명도 레이어링
- 모든 수치 및 계산 결과에 `tabular-nums`를 강제한 흔들림 없는 숫자 판독성
- 젖은 손이나 한 손 엄지 조작을 배려한 최소 `48px~54px` 높이의 넉넉한 스테퍼 및 퀵 칩 타겟
- 실시간 계량컵 눈금 게이지(`30ml`/`50ml`/`100ml`/`250ml`)를 통한 직관적인 물리 계량 연결

## Colors

야간 워시 베이에서도 눈부심 없이 숫자와 활성 상태만 선명하게 떠오르는 고대비 다크 팔레트입니다.

### Primary
- **Toss Deep Action Blue** (`#1B64DA`): 주요 저장 버튼 및 확정 액션 배경에 사용하며 흰색 텍스트(`#FFFFFF`)와 4.5:1 이상의 명도 대비를 보장합니다.
- **Luminous Readout Blue** (`#529DFF`): 다크 표면 위의 단위 표시(`ml`), 포커스 링, 계량컵 게이지의 기본 채움 바에 사용합니다.

### Secondary
- **Metering Aqua** (`#20C997`): 프리셋 항목의 예상 원액 산출량 강조, 상태 표시 점, 그리고 단일 계량컵 용량을 초과했을 때의 멀티컵 채움 게이지에 사용합니다.

### Tertiary
- **Crimson Alert** (`#F04452`): 입력 폼 유효성 오류 안내 및 프리셋 삭제 버튼의 호버 경고 상태에 사용합니다.

### Neutral
- **Obsidian Wash Bay** (`#0B0D11`): 페이지 최하단 기본 배경 및 입력 필드/계량컵 박스의 오목한(recessed) 바닥면으로 사용합니다.
- **Elevated Slate Surface** (`#151921`): 계산 결과 판독창, 조절 패널, 내 케미컬 보관함 등 최상위 컨테이너 표면에 사용합니다.
- **Interactive Slate** (`#1D232E` / `#252C3A`): 스테퍼 버튼, 퀵 프리셋 칩, 케미컬 리스트 아이템의 기본 및 호버 상태에 사용합니다.
- **Crisp Ice White** (`#F2F5FA`): 원액 용량 숫자, 제목, 입력값 등 최우선 판독 텍스트에 사용합니다.
- **Cool Steel Secondary & Muted** (`#B4C0D4` / `#93A2B8`): 계산 공식, 보조 단위, 칩 하단 용기 설명 등 보조 텍스트에 사용하되 모든 배경 위에서 WCAG AA(4.5:1 이상) 대비를 유지합니다.

### Named Rules
**The Wet-Hand Contrast Rule.** 모든 보조 라벨과 플레이스홀더 텍스트는 가장 밝은 카드 표면(`#1D232E`) 위에서도 최소 4.5:1 이상의 명도 대비를 유지해야 하며, 흐릿한 회색 텍스트를 절대 사용하지 않습니다.

## Typography

**Display & Body Font:** `Pretendard Variable` (with `-apple-system, BlinkMacSystemFont, system-ui, sans-serif` fallback)

**Character:** 기하학적인 숫자 비례와 한글 가독성이 뛰어난 Pretendard 단일 패밀리를 사용하며, 전역 `tabular-nums` 설정을 통해 숫자가 실시간으로 변할 때도 레이아웃이 좌우로 흔들리지 않습니다.

### Hierarchy
- **Display** (`800`, `clamp(3.25rem, 9vw, 4.5rem)`, `1.02`): 최상단 원액 투입량(`ml`) 메인 판독 숫자에 사용합니다.
- **Headline** (`800`, `1.375rem`, `1.3`): 상단 브랜드 타이틀(`h1`)에 사용합니다.
- **Title** (`700`, `1.0625rem`, `1.4`): 각 조작 섹션 및 내 케미컬 보관함 제목(`h2`)에 사용합니다.
- **Body** (`600~700`, `0.9375rem`, `1.5`): 환산 수치, 프리셋 카드 이름, 일반 본문에 사용합니다.
- **Label** (`600`, `0.75rem~0.8125rem`, `1.3`): 단위 토글, 퀵 칩 보조 설명, 계량컵 눈금 라벨에 사용합니다.

### Named Rules
**The Tabular Numerals Rule.** 물 용량, 희석 비율, 원액 산출량, 펌프 횟수 등 숫자가 표시되는 모든 요소는 `font-variant-numeric: tabular-nums`를 유지해야 합니다.

## Layout

모바일 퍼스트 단일 컬럼에서 데스크톱(`840px` 이상) 2컬럼(`1.12fr : 0.88fr`) 비대칭 작업 공간으로 자연스럽게 확장됩니다. 최대 컨테이너 폭은 `1060px`이며, 좌측에는 실시간 원액 판독창과 물 용량·희석 비율 조작부를, 우측에는 로컬 스토리지 기반 '내 케미컬 보관함'을 배치합니다.

## Elevation & Depth

다크 서피스 간의 명도 차이(`#0B0D11` → `#151921` → `#1D232E`)와 미세한 반투명 보더(`rgba(214, 226, 245, 0.09)`)를 결합한 하이브리드 레이어링을 사용합니다.

### Shadow Vocabulary
- **Surface Rest Shadow** (`box-shadow: 0 12px 32px -8px rgba(4, 7, 13, 0.65)`): 주요 섹션 컨테이너의 깊이감을 형성합니다.
- **Floating Toast Shadow** (`box-shadow: 0 18px 40px -10px rgba(4, 7, 13, 0.8)`): 하단 플로팅 토스트 알림에 사용합니다.

### Named Rules
**The Recessed Input Rule.** 숫자를 직접 입력하는 필드와 계량컵 트랙은 상위 카드(`#151921`)보다 한 단계 더 어두운 베이스 컬러(`#0B0D11`)로 파여 보이게 처리하여 조작 영역과 표시 영역을 명확히 구분합니다.

## Shapes

부드럽고 손끝에 감기는 라운드 코너 체계를 사용합니다. 최상위 패널은 `24px`(`--radius-xl`), 내부 박스와 프리셋 아이템은 `18px`(`--radius-lg`), 버튼과 입력창 및 퀵 칩은 `12px`(`--radius-md`), 상태 배지와 게이지 바는 완전한 캡슐형(`999px`)을 적용합니다.

## Components

### Buttons & Steppers
- **Shape:** 부드러운 사각형(`12px` radius), 스테퍼 버튼은 `54px` 고정 높이로 넉넉한 터치 면적 확보
- **Primary:** `#1B64DA` 배경에 `#FFFFFF` 굵은 텍스트(`700`), 호버 시 `#1554B8`, 클릭 시 `scale(0.97)` 햅틱 축소 피드백
- **Hover / Focus:** `cubic-bezier(0.16, 1, 0.3, 1)` 이징과 `2px solid #529DFF` 포커스 링

### Quick Preset Chips
- **Style:** `#1D232E` 배경, `#B4C0D4` 텍스트, 상단 주 수치와 하단 용도 설명(`small`)의 2단 구성, 최소 높이 `48px`
- **State:** 선택된(`is-active`) 칩은 `rgba(49, 130, 246, 0.16)` 배경과 `rgba(76, 154, 255, 0.6)` 보더, `#99C6FF` 텍스트로 즉시 식별

### Cards / Containers
- **Corner Style:** `24px` 외곽 반경
- **Background:** `#151921`
- **Border:** `1px solid rgba(214, 226, 245, 0.09)`
- **Internal Padding:** `22px 20px` ( 판독창은 `24px 22px 22px`)

### Inputs / Fields
- **Style:** `#0B0D11` 배경, `1.5px solid rgba(214, 226, 245, 0.09)` 보더, `12px` 반경, 우측 정렬된 `1.5rem` 굵은 숫자
- **Focus:** 보더가 `#529DFF`로 전환

### Measuring Cup Gauge (Signature Component)
- **Style:** 선택한 계량컵 규격(`30ml`, `50ml`, `100ml`, `250ml`)에 맞춰 원액 투입량이 차지하는 비율을 캡슐형 프로그레스 트랙(`18px` 높이, 내부 `2px` 인셋 패딩)과 하단 5분할 눈금(`0%`, `25%`, `50%`, `75%`, `100%`)으로 시각화합니다. 1컵 용량을 초과하면 게이지가 아쿠아(`#20C997`) 색상으로 전환되며 몇 번 가득 채우고 몇 ml를 추가해야 하는지 안내합니다.

## Do's and Don'ts

### Do:
- **Do** 모든 계산식을 '받아둔 물 용량 기준(`원액 ml = 물 ml ÷ N`)'으로 일관되게 유지하세요.
- **Do** 버튼과 퀵 칩의 터치 타겟 높이를 최소 `44px` 이상(`48px~54px` 권장)으로 유지해 세차장에서 한 손으로 오작동 없이 누를 수 있게 하세요.
- **Do** 새로운 상태나 보조 텍스트를 추가할 때 `#1D232E` 배경 대비 최소 4.5:1 명도비를 확인하세요.

### Don't:
- **Don't** 제목(`h1`, `h2`) 위에 장식적인 영문 Kicker나 Eyebrow 라벨을 추가하지 마세요.
- **Don't** 카드 좌측이나 우측에 두꺼운 컬러 보더(`border-left: 3px~4px`)를 넣는 클리셰를 사용하지 마세요.
- **Don't** 그라디언트 텍스트나 네온 글로우 효과를 사용하지 마세요.
