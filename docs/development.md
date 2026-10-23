# 로컬 개발 및 검증

먼저 [Docker 실행 준비](deployment.md#별도-docker-서버-실행)에 따라 `.env.example`을 `.env`로 복사하고 `POSTGRES_PASSWORD`를 설정합니다. 로컬 패스키 설정은 아래 주소를 사용합니다.

```bash
corepack enable
pnpm install --frozen-lockfile
# .env의 ORIGIN=http://localhost:8766, RP_ID=localhost로 설정
docker compose up -d --build
CARWASH_API_BASE=http://localhost:8787/api pnpm build
python3 -m http.server 8766 --directory dist
```

별도 터미널에서 실행합니다. 통합 테스트는 테스트 전용 PostgreSQL 연결을 요구하며 임시로 생성한 보관함을 정리합니다.

```bash
pnpm test
TEST_DATABASE_URL=postgres://사용자:비밀번호@테스트DB호스트:5432/테스트DB pnpm test:api
```

통합 테스트는 실제 공개키 검증을 수행하는 소프트웨어 인증기를 사용합니다. 기기별 지문·Face ID·보안 키의 실제 등록 및 설치 동작은 지원 브라우저에서 확인해야 합니다.

정적 화면만 확인할 때는 API 없이 빌드 후 `dist/`를 제공할 수 있습니다. 저장소 루트나 `src/client/`를 정적 서버에 직접 공개하지 마세요. API가 없으면 로그인·최신 카탈로그 조회는 사용할 수 없지만 계산과 기기 내 저장은 가능합니다.

`npm run dev`와 `npm start`는 `src/server/index.js`를 실행합니다. `npm run import:products -- <파일경로>`는 `scripts/import-products.mjs`를 실행합니다. 서버 시작 시 `db/migrations/`의 SQL을 적용합니다.

기존 사용자의 Compose 환경과 임시 검증 환경을 구분하세요. 별도 검증은 고유한 프로젝트명과 포트를 사용하고, 종료 시 생성에 사용한 동일한 `-p`/`-f`로 `docker compose ... down --volumes --remove-orphans`를 실행합니다. 기존·외부·영구 볼륨을 삭제하지 않습니다.

현재 구조와 경로 이동 검증은 [구조 결정 기록](architecture.md), 운영 설정과 백업은 [배포 안내](deployment.md)를 참고하세요.
