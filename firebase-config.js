// Firebase 콘솔 → 프로젝트 설정 → 내 앱 → 웹 앱에서 나오는 값을 그대로 채워 넣습니다.
// 이 값들은 공개돼도 괜찮습니다. 실제 보호는 Realtime Database 규칙이 합니다.
window.HARU_FIREBASE = {
  apiKey: "여기에-apiKey",
  authDomain: "여기에-프로젝트.firebaseapp.com",
  databaseURL: "https://여기에-프로젝트-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "여기에-프로젝트",
  storageBucket: "여기에-프로젝트.appspot.com",
  messagingSenderId: "여기에-숫자",
  appId: "여기에-appId"
};

// 이 UID 를 가진 계정만 자기 자료를 봅니다. 처음에는 비워 두고,
// 로그인하면 화면에 내 UID 가 표시되므로 그 값을 여기에 적고 규칙에도 넣습니다.
window.HARU_OWNER_UID = "";
