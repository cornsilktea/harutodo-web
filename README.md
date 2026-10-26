# 하루 할일 — 웹

아이폰 앱 [HaruTodo](../HaruTodo) 에 기록한 내용을 웹에서 보는 페이지입니다.
Firebase Realtime Database 를 사이에 두고 앱과 자료를 주고받습니다.

```
아이폰 앱  ──쓰기──▶  Firebase RTDB  ◀──읽기──  이 페이지
(SwiftData 원본)      /users/<uid>/…           (GitHub Pages)
```

포털(`cornsilktea.github.io`)과는 **다른 Firebase 프로젝트**를 씁니다.
개인 기록(담임업무·일기 등)이 들어 있어 학생용 공개 서비스와 섞지 않습니다.

## 처음 설정

1. [Firebase 콘솔](https://console.firebase.google.com) 에서 새 프로젝트를 만듭니다(예: `harutodo`).
2. **빌드 → Realtime Database → 데이터베이스 만들기** → 위치 `asia-southeast1` → **잠금 모드**.
3. **빌드 → Authentication → 시작하기 → Google** 사용 설정.
4. **프로젝트 설정 → 내 앱 → 웹 앱 추가** 후 나오는 값을 `firebase-config.js` 에 채웁니다.
5. 같은 화면에서 **iOS 앱도 추가**합니다. 번들 ID 는 `com.jeongilmug.harutodo`.
   내려받는 `GoogleService-Info.plist` 안의 `CLIENT_ID` / `REVERSED_CLIENT_ID` 를
   앱의 구글 로그인에 씁니다(웹과 같은 계정 → 같은 UID → 같은 자료).
6. Realtime Database → **규칙** 에 `데이터베이스규칙.json` 내용을 붙여 넣고 게시합니다.
   규칙이 UID 별로 갈라 주므로, 로그인한 사람은 자기 자료만 읽고 씁니다.
7. 아이폰 앱 설정에서 같은 계정으로 로그인하면 자료가 올라옵니다.

## 로그인 방식

앱과 웹이 **같은 구글 계정**으로 로그인해 UID 를 맞춥니다.
앱에는 Firebase SDK 를 넣지 않고, 표준 라이브러리만으로 처리합니다.

1. `ASWebAuthenticationSession` 으로 구글 OAuth(PKCE) → `id_token`
2. `identitytoolkit.googleapis.com/v1/accounts:signInWithIdp` → Firebase `idToken` + `refreshToken`
3. `refreshToken` 은 키체인에 두고, 만료되면 `securetoken.googleapis.com` 으로 갱신
4. Realtime Database REST 호출에 `?auth=<idToken>` 을 붙여 읽고 씁니다

CocoaPods 나 Swift Package 없이 지금의 순수 Xcode 프로젝트 구조를 그대로 씁니다.

## 자료 구조

`updatedAt` 은 밀리초 단위 정수, 날짜는 `yyyy-MM-dd` 문자열입니다.
지운 항목은 실제로 지우지 않고 `deletedAt` 만 남깁니다(안 그러면 동기화로 되살아납니다).

```
/users/<uid>/categories/<id> = { name, colorHex, symbolName, sortOrder,
                                 endDate|null, updatedAt, deletedAt|null }
/users/<uid>/tasks/<id>      = { title, note, categoryId, recurrence,
                                 weekdayMask, monthDay, startDate, endDate|null,
                                 sortOrder, isArchived, updatedAt, deletedAt|null }
/users/<uid>/instances/<id>  = { taskId, date, isDone, photoCount,
                                 updatedAt, deletedAt|null }
```

`recurrence` 는 `none | daily | weekly | monthly`,
`weekdayMask` 는 일요일이 1비트인 7비트 값입니다.

사진 자체는 올리지 않습니다(Realtime Database 로는 안 됩니다). `photoCount` 로 장수만 표시합니다.

## 진행 단계

- [x] **1단계** 새 Firebase 프로젝트 · 규칙 · 웹 보기 페이지
- [ ] 앱 → 서버 업로드
- [ ] **2단계** 웹에서 완료 토글 → 앱이 받아오기
- [ ] **3단계** 웹에서 추가 · 수정 · 삭제

## 교사 시간표 자동 입력 (컴시간알리미)

`timetable/` 의 스크립트가 컴시간 학생 서버(비공식 주소)에서 학교 시간표를 받아 내 수업만 골라
`수업준비` 카테고리에 할 일로 넣습니다. 이름은 컴시간이 끝 글자를 가려 보여 주므로 `config.json` 의 `teacher` 에 `정일*` 처럼 적습니다.

- **학기 달력은 `config.json` 의 `terms`**(월-일만 적으면 매년 반복): 1학기 3/1~7/25, 2학기 8/14~1/15. 방학에는 수업을 넣지 않습니다.
- **매일 아침 6시 30분(`daily`)**: 오늘부터 그 학기 끝까지 맞춥니다. 컴시간이 알려 주는 이번·다음 주는 실제 시간표(대체·교환은 `(변경)` 표시, 취소는 제거), 그 뒤는 원래 시간표를 요일마다 반복하고 공휴일은 뺍니다. 체크한 완료 표시와 직접 지운 수업은 건드리지 않습니다. 새 학기가 시작되면 알아서 그 학기를 채웁니다.
- **처음 한 번(`semester`)**: `daily` 와 같고, 추가로 카테고리에 있던 옛 반복 일정을 `startDate` 전날로 끝맺고 그 뒤 기록을 지웁니다.
- 수업 하나는 번호가 `tt-날짜-교시-학급` 인 할 일 + 기록이라 몇 번 돌려도 같은 결과입니다.

처음 설정(한 번):

1. Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → **새 비공개 키 생성** 으로 받은 JSON 전체를 저장소 Settings → Secrets → Actions 에 `FIREBASE_SERVICE_ACCOUNT` 로 넣습니다.
2. 같은 곳에 `HARU_UID` (웹 화면의 "내 UID") 를 넣습니다.
3. Actions 탭 → 교사 시간표 가져오기 → Run workflow → mode `semester`, dry_run 체크로 미리 본 뒤 체크를 풀고 한 번 더 돌립니다.

내 컴퓨터에서 시험: `cd timetable && npm install && node sync.mjs daily --dry-run` (키 없이 계획만 출력).
컴시간이 주소를 바꾸면 `comci-client.mjs` 가 접속할 때 `/st` 화면에서 다시 읽고, 그래도 안 되면 그 파일의 값을 고칩니다.

## 공개하기

GitHub Desktop 으로 이 폴더를 저장소로 만들어 올린 뒤,
GitHub 저장소 **Settings → Pages → Branch: main / root** 로 켜면
`https://<계정>.github.io/harutodo-web/` 에서 열립니다.

로그인한 본인만 자료를 볼 수 있으므로 저장소가 공개여도 기록은 보이지 않습니다.
다만 `firebase-config.js` 는 저장소에 그대로 들어갑니다 — 이 값들은 공개돼도 괜찮은 값이고,
실제 보호는 데이터베이스 규칙이 합니다.
