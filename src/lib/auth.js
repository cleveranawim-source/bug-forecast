// Google 로그인 — Firebase Authentication
import { auth } from './firebase.js';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';

const provider = new GoogleAuthProvider();

// Google 팝업 로그인. 성공 시 Firebase User(uid, displayName, email, photoURL)를 반환.
export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export function signOutUser() {
  return signOut(auth);
}

// 로그인 상태 변화 구독. callback(user|null), 반환값은 해제 함수.
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}
