---
name: "세차 희석비율 계산기"
description: "흰 배경과 검은 글자 중심의 간결한 계산 도구"
colors:
  background: "#FFFFFF"
  foreground: "#171717"
  secondary: "#525252"
  muted: "#626262"
  border: "#E5E5E5"
  input-border: "#CCCCCC"
  surface: "#F5F5F5"
  hover: "#EDEDED"
  hover-strong: "#E5E5E5"
  selected-row: "#F7F7F7"
  selected: "#F2F2F2"
  selection: "#DEDEDE"
  primary-hover: "#333333"
  danger: "#B42318"
rounded:
  track: "4px"
  sm: "6px"
  md: "8px"
typography:
  display:
    fontSize: "64px"
  display-mobile:
    fontSize: "56px"
  input:
    fontSize: "24px"
  headline:
    fontSize: "23px"
  headline-mobile:
    fontSize: "21px"
  title:
    fontSize: "16px"
  body:
    fontSize: "14px"
  control:
    fontSize: "13px"
  label:
    fontSize: "12px"
  caption:
    fontSize: "11px"
---

# Design System

사용자가 요청한 흰색 배경, 검은색 글자, 심플하고 모던한 계산기.

## Layout

최대 너비 720px의 한 열 구성. 물 용량 → 희석비율 → 넣을 원액 → 저장한 비율 순서로 읽는다.
데스크톱 좌우 패널과 중첩 카드를 사용하지 않는다. 구역은 여백과 1px 구분선으로 나눈다.
모바일 좌우 여백은 20px, 데스크톱은 28px. 빠른 선택은 데스크톱 8열, 모바일 4열이다.

## Type and color

Pretendard와 시스템 산세리프를 사용한다. 결과는 64px, 모바일은 56px이며 숫자는 tabular-nums를 적용한다.
본문은 #171717, 보조 설명은 #525252 또는 #626262. 흰 바탕 위에서 읽을 수 있는 대비를 유지한다.
검은 채움은 선택한 비율과 저장 동작에만 사용한다. 오류에만 붉은색을 허용한다.
밝은 디자인을 고정하며 운영체제 다크 모드에서도 색상을 유지한다.

## Controls and states

입력창은 1px 테두리와 8px 모서리, 작은 버튼은 6px 모서리를 사용한다.
빠른 선택의 활성 상태는 검은 배경과 흰 글자로 표시한다.
포커스는 검은 2px 외곽선으로 표시한다. 기본 버튼, 호버, 폼 오류, 빈 목록, 토스트를 지원한다.
계량컵과 펌프 환산은 기본 접힌 details로 제공한다.
저장 목록은 행과 구분선으로 구성하며 수정·삭제 버튼을 유지한다.
reduced-motion 설정에서는 전환 효과를 끈다.

홈 화면 설치와 오프라인 안내는 페이지 하단의 접힌 details로 제공한다.
설치 버튼은 기존 검은색 기본 버튼을 재사용하고 브라우저가 설치 프롬프트를 제공할 때 표시한다.
준비 상태 문구는 13px 보조 글자색을 사용한다.
