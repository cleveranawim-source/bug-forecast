// 익명 인증 — Firebase Authentication
// 제보자 식별용 고유 uid만 발급한다(구글 등 개인정보 수집 없음).
// 제보 신빙성은 GPS 위치 인증 + uid 규칙 + 쿨다운이 담보한다.
//
// ⚠️ 이전의 signInWithPopup(구글 팝업)은 iOS 앱(WKWebView)에서 팝업이 열리지 않아
// 심사 반려(2.1a "No response for Google login button")됨 → 익명 인증으로 교체.
// v1.1에서 네이티브 구글/Apple 로그인으로 승격(linkWithCredential) 예정 — 익명 uid의
// 제보 기록은 계정 연동 시 그대로 이어진다.
import { auth } from './firebase.js';
import { signInAnonymously, signOut, onAuthStateChanged } from 'firebase/auth';

// 익명 로그인. 성공 시 Firebase User(uid) 반환 — 같은 기기에서는 uid가 유지된다.
export async function signInAnonymous() {
  const result = await signInAnonymously(auth);
  return result.user;
}

export function signOutUser() {
  return signOut(auth);
}

// 로그인 상태 변화 구독. callback(user|null), 반환값은 해제 함수.
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}
