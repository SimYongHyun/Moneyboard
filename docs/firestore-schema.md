# Firestore 스키마

프로젝트 `moneyboard-3fdf4`의 `(default)` 데이터베이스에 적용하는 구조입니다. 컬렉션은 문서를 처음 만들 때 생성합니다. 두 사람의 실제 Firebase UID를 받기 전에는 어떤 문서도 만들지 않습니다.

## 관리자만 만드는 초기 문서

클라이언트 보안 규칙은 아래 두 경로의 쓰기를 모두 거부합니다. Firebase 콘솔 또는 Admin SDK로만 만듭니다.

| 문서 경로 | 필수 필드 | 용도 |
| --- | --- | --- |
| `households/{householdId}` | `name: string`, `ownerUid: string`, `members: [uidA, uidB]` | 두 UID가 정확히 들어 있는 공동 가구 |
| `allowedUsers/{uidA}` | `householdId: string`, `deliveryEnabled: true` | 공동 가계부·공동 배달 장부 사용자 |
| `allowedUsers/{uidB}` | `householdId: string`, `deliveryEnabled: true` | 공동 가계부·공동 배달 장부 사용자 |

`members` 배열은 반드시 두 UID만 넣습니다. `ownerUid`는 공동 배달 장부가 저장될 사용자 UID입니다. 두 사용자 모두 이 소유자 경로의 배달 장부를 읽고 씁니다.

## 공동 가계부

| 컬렉션 | 문서 필드 |
| --- | --- |
| `households/{householdId}/transactions/{transactionId}` | `person`, `type`, `title`, `amount`, `date`, `category`, `paymentMethod`, `account`, `memo`, `paid`, `paidDate`, `recurringRuleId`, `createdAt`, `updatedAt` |
| `households/{householdId}/recurringRules/{ruleId}` | `person`, `type`, `title`, `amount`, `category`, `paymentMethod`, `account`, `memo`, `startMonth`, `endMonth`, `day`, `installments`, `createdAt`, `updatedAt` |

`person`은 `y` 또는 `s`이고, `type`은 `income`, `expense`, `savings`, `transfer`, `loanPrincipal`, `loanInterest` 중 하나입니다. 내부 이체·저축·대출 원금은 지출 통계에서 제외합니다.

## 공동 배달 자료

| 컬렉션 | 문서 필드 |
| --- | --- |
| `users/{ownerUid}/deliveryEarnings/{earningId}` | `ownerUid`, `kind: "income"`, `platform`, `workDate`, `workMonth`, `grossIncome`, `settlementDeduction`, `deliveryCount`, `workHours`, `distanceKm`, `memo`, `createdAt`, `updatedAt` |
| `users/{ownerUid}/deliveryExpenses/{expenseId}` | `ownerUid`, `kind: "expense"`, `workDate`, `workMonth`, `amount`, `category`, `memo`, `createdAt`, `updatedAt` |
| `users/{ownerUid}/deliveryInvestments/{investmentId}` | `ownerUid`, `kind: "investment"`, `workDate`, `workMonth`, `amount`, `category`, `memo`, `createdAt`, `updatedAt` |
| `users/{uid}/settings/app` | `ownerUid`, `displayName`, `defaultPlatform`, `createdAt`, `updatedAt` |

`workDate`는 한국 기준의 `YYYY-MM-DD`, `workMonth`는 `YYYY-MM`입니다. 구매일을 모르는 초기 투자비만 빈 문자열을 허용합니다.

## 보안 원칙

- 인증되지 않은 요청과 `allowedUsers/{uid}` 문서가 없는 사용자 요청은 모두 거부합니다.
- 두 승인 사용자는 같은 `householdId`와 `members` 배열을 통해서만 공동 가계부에 접근합니다.
- 공동 배달 자료는 가구 문서의 `ownerUid` 경로에 저장하며, 가구의 두 승인 구성원만 읽고 씁니다.
- 클라이언트는 `allowedUsers`나 `households`를 생성·수정할 수 없습니다.
- 현재 앱의 조회는 각 컬렉션의 제한된 구독이므로 복합 Firestore 색인이 필요하지 않습니다.

## UID를 받은 뒤 등록 순서

1. 두 사람이 Google 로그인 후 Firebase Authentication에서 UID를 확인합니다.
2. Firebase 콘솔에서 `households/{householdId}` 문서를 만들고 `members`에 두 UID를 넣습니다.
3. 두 `allowedUsers/{uid}` 문서를 만들고 같은 `householdId`를 설정합니다.
4. 두 브라우저에서 로그인한 뒤 공동 가계부와 공동 배달 장부의 실시간 동기화를 확인합니다.
