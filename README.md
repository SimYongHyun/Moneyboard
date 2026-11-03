# 우리집 머니보드

`index.html`의 A안 화면과 CSS를 유지한 Firebase 기반 부부 공동 가계부·공동 배달 수익 앱입니다. 정적 페이지는 GitHub Pages에서 제공하고, 데이터는 Firebase Authentication과 Cloud Firestore가 관리합니다.

전체 문서 경로·필드·UID 등록 순서는 [Firestore 스키마](docs/firestore-schema.md)에 정리했습니다.

## 현재 상태

- 화면의 시연용 `localStorage` 저장과 실제 금액 상수는 제거했습니다. **로그인 및 UID 권한 확인 전에는 거래 금액을 렌더링하지 않습니다.** 기존 브라우저 배달 기록은 사용자가 `가져오기`를 눌러야만 Firestore로 이동합니다.
- 가계부 거래, 반복 거래, 납부 처리, 연간 지출 그래프, JSON 백업·가져오기, 연간 CSV, 공동 배달 수익·운영비·투자비의 CRUD, 개인 설정과 실시간 동기화를 구현했습니다.
- 원본 구매비 15건은 공개 코드 대신 로컬의 `private-data/investments.private.json`에 보관했습니다. 해당 폴더는 Git에서 제외됩니다. 구매일은 원본에 없어 공란으로 두었으며, 초기 투자비로 모든 선택 월의 회수 계산에 포함됩니다.
- Firebase 프로젝트와 승인 UID는 설정됐습니다. GitHub 저장소를 연결하고 Pages를 한 번 게시하면 실제 URL에서도 동작합니다.

## 1. Firebase 준비

1. Firebase 콘솔에서 프로젝트와 웹 앱을 만들고 Cloud Firestore를 생성합니다. 프로덕션 모드를 사용합니다.
2. Authentication → 로그인 방법에서 **Google** 공급자를 켭니다.
3. Authentication → 설정 → 승인된 도메인에 GitHub Pages의 실제 호스트 이름을 추가합니다. 로컬 테스트 시 `localhost`도 확인합니다.
4. 프로젝트 설정 → 웹 앱의 `apiKey`, `authDomain`, `projectId`, `appId`를 확인합니다. 이 작업 폴더의 [firebase-config.js](firebase-config.js)와 [.firebaserc](.firebaserc)는 `moneyboard-3fdf4`에 연결되어 있습니다. 이 웹 구성은 비밀키가 아니지만, 서비스 계정 키나 Admin SDK 자격 증명을 이 저장소에 넣으면 안 됩니다.
5. Node.js 24와 Firebase CLI를 준비하고 `npm.cmd install` (PowerShell 스크립트 정책이 허용되면 `npm install`), `npx.cmd firebase login`, `npx.cmd firebase use --add`를 실행합니다. 원하는 프로젝트 ID를 선택합니다.
6. **사용자를 초대하거나 거래를 넣기 전에** `npm.cmd run deploy:rules`로 [firestore.rules](firestore.rules)를 배포합니다. 이 명령은 `--project moneyboard-3fdf4`를 포함하므로 현재 Firebase CLI 선택값과 관계없이 해당 프로젝트에만 배포합니다. 콘솔에서 직접 붙여넣어 배포해도 됩니다.

로컬 미리보기는 `npm.cmd run serve` 후 `http://127.0.0.1:4173`을 여세요. 로컬 서버는 앱 파일만 제공하고 `private-data/`를 제공하지 않습니다.

## 2. 두 사용자와 가구 문서 등록

1. 두 사람이 각자 앱에서 Google 로그인합니다. 아직 승인 문서가 없으므로 접근 상태 화면에 본인의 **UID**가 표시됩니다. Firebase Authentication → 사용자 목록에서도 확인할 수 있습니다.
2. 관리자만 Firebase 콘솔의 Firestore에서 다음 문서를 만듭니다. UID나 이메일을 임의로 추정하지 마세요.

| 문서 경로 | 필드 |
| --- | --- |
| `households/실제_가구_ID` | `name`(문자열), `ownerUid`(배달 소유자 UID), `members`(두 UID의 배열) |
| `allowedUsers/용현_UID` | `householdId`(위 ID), `deliveryEnabled: true` |
| `allowedUsers/선영_UID` | `householdId`(위 ID), `deliveryEnabled: true` |

3. 새로고침하면 두 계정이 부부 가계부와 `households/{householdId}.ownerUid` 경로의 공동 배달 장부를 함께 사용합니다. 미승인 계정의 직접 Firestore 요청은 규칙에서 거부됩니다. `allowedUsers`와 `households` 문서는 클라이언트가 쓰지 못하며 관리자만 콘솔/Admin SDK로 관리합니다.

## 3. 개인 데이터 가져오기

용현 계정으로 로그인 → 부부 가계부 → **가져오기** → 로컬의 `private-data/investments.private.json` 선택 → 건수 확인 후 저장합니다. 15건은 문서 ID가 고정되어 있어 같은 파일을 다시 가져와도 중복되지 않습니다. 원본 가계부 월별 수치는 자동으로 추가되지 않습니다.

`private-data/household-2026-11-draft.private.json`은 원본의 합계를 보존한 **검토용 초안**입니다. 수령일, `자동`·`월초`·존재하지 않는 `11월 31일`은 정확한 날짜가 없어 임시 날짜와 메모를 넣었습니다. 적금·대출·용돈 등도 원본 합계를 재현하기 위해 일단 지출로 옮겼습니다. **실제 날짜와 분류를 확인하고 수정한 뒤** 같은 가져오기 버튼으로 등록하세요. 초안 자체는 Git에서 제외되며 자동으로 업로드되지 않습니다.

이전 시연판에서 입력한 배달 기록이 현재 브라우저에 있다면 **이 브라우저의 이전 배달 기록 가져오기** 버튼을 누릅니다. 자동 전송하지 않습니다. 다른 브라우저의 `localStorage`는 읽을 수 없습니다.

가져오기 JSON 형식은 `{ "version": 1, "transactions": [], "recurringRules": [], "deliveryEarnings": [], "deliveryExpenses": [], "deliveryInvestments": [] }`입니다. 입력 검증 후 기존 ID는 건너뜁니다. JSON 백업 버튼으로 생성한 파일을 다시 가져올 수 있습니다. 백업에는 개인정보가 있으므로 공개 저장소에 올리지 마세요.

## 4. 회계와 날짜 정책

- 배달 수익은 **배달 수행일 `workDate`** 기준입니다. 실정산액은 총 수입에서 플랫폼 공제액을 뺍니다. 운영비와 투자비는 서로 별개입니다. 정산에서 이미 공제한 보험료를 운영비로 다시 넣지 마세요.
- 회수율은 선택 월 말까지의 `(누적 실정산액 − 누적 운영비) / 누적 투자비`를 0~100%로 제한합니다. 투자비를 운영비로 한 번 더 차감하지 않습니다. 날짜 미상 초기 투자비는 모든 선택 월의 기초 투자금으로 봅니다.
- 가계부의 `지출`과 `대출 이자`만 지출 통계에 들어갑니다. 카드 사용은 `지출`, 카드대금 납부는 `내부 이체`로 기록하세요. 저축, 내부 이체, 대출 원금은 지출 합계에서 제외합니다.
- 반복 거래는 기간·매월 일자·할부 회차에 따라 예정 항목으로 표시합니다. 납부 완료 또는 수정 시 해당 월에 실제 거래 문서가 만들어집니다. 반복 규칙을 삭제해도 이미 만들어진 거래는 유지됩니다.
- 연간 지출 그래프와 CSV는 실제 저장된 거래 문서만 집계합니다. 예정 반복 항목만 있는 달과 입력되지 않은 달은 그래프에서 `자료 없음`으로 표시합니다.

## 5. GitHub Pages 배포

1. GitHub에서 비공개 또는 공개 저장소를 만들고 이 폴더를 `main` 브랜치로 푸시합니다. `.gitignore`가 `private-data/`, `previews/`, 원본 지시서, 백업 파일을 제외하는지 확인하세요.
2. 저장소 → **Settings → Pages → Build and deployment**에서 Source를 **GitHub Actions**로 선택합니다.
3. 기본 브랜치에 푸시하면 [GitHub Pages 워크플로](.github/workflows/deploy-pages.yml)가 모델·Emulator·UI 테스트를 실행한 뒤 `index.html`, `src/`, `firebase-config.js`만 Pages에 게시합니다. Firebase 웹 설정은 브라우저 공개용 식별값이므로 Secrets에 넣을 필요가 없으며, 서비스 계정 키는 절대 저장소나 Secrets에 넣지 마세요.
4. Actions의 `Verify and deploy Moneyboard`가 성공하면 저장소 → **Settings → Pages**에서 실제 URL을 확인하고, 그 **호스트 이름**을 Firebase Authentication 승인된 도메인에 추가합니다. Pages 공개 여부와 무관하게 Firestore Rules는 계속 적용됩니다.

## 6. 검증

`node --test tests/model.test.mjs`는 날짜·금액·배달 월별 합계·회수율·가계 회계·반복 회차를 검사합니다. 의존성 설치와 **Java 21 이상** 준비 후 `npm.cmd run test:rules`는 Firestore Emulator에서 승인/미승인·부부 공유·공동 배달 장부 차단과 두 계정의 실시간 수신을 검사합니다. `npm.cmd run test:ui`는 Chrome/Playwright의 테스트용 가짜 데이터로 가계부·배달 입력, 날짜 수정·삭제, 360/390/430/1024/1440px 배치와 모바일 입력창을 검사합니다. GitHub Actions에서도 이 테스트를 실행한 뒤 Pages를 게시합니다. 실계정으로 두 브라우저 로그인, 새로고침, 실제 Firestore 동기화 및 최종 화면 비교는 Firebase 설정 및 배포 후 수행해야 합니다.

Firebase 설정과 GitHub 저장소가 없는 상태에서는 인증, 실시간 동기화, 실제 URL을 검증했다고 판단하면 안 됩니다.
