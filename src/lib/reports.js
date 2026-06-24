// 시민 제보 — Firestore 저장·구독·집계
// 컬렉션 'reports' 한 문서 = 제보 한 건.
import { db } from './firebase.js';
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore';

const COLLECTION = 'reports';

// 제보 등록. report = { regionId, regionName, dong, place, amount, memo,
//   reporterName, locationVerified, lat, lng } — createdAt은 서버 시각으로 채운다.
export async function addReport(report) {
  return addDoc(collection(db, COLLECTION), {
    ...report,
    verified: true,
    createdAt: serverTimestamp(),
  });
}

// 실시간 구독. 최신순으로 받아 callback(reports[])를 호출한다. 반환값은 구독 해제 함수.
export function subscribeReports(callback, { max = 300 } = {}) {
  const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'), limit(max));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        // serverTimestamp가 반영되기 전(낙관적 표시) createdAt이 null일 수 있다.
        time: data.createdAt?.toDate
          ? data.createdAt.toDate().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
          : '방금',
      };
    });
    callback(rows);
  }, (error) => {
    console.warn('제보 구독 오류 — Firestore Database 생성/보안 규칙을 확인하세요:', error.code || error.message);
  });
}

// 구별 제보 수 집계 → { [regionId]: count }
export function countByRegion(reports) {
  const counts = {};
  for (const r of reports) {
    if (!r.regionId) continue;
    counts[r.regionId] = (counts[r.regionId] ?? 0) + 1;
  }
  return counts;
}

// 특정 구의 동별 제보 수 집계 → { [dong]: count }
export function countByDong(reports, regionId) {
  const counts = {};
  for (const r of reports) {
    if (r.regionId !== regionId || !r.dong) continue;
    counts[r.dong] = (counts[r.dong] ?? 0) + 1;
  }
  return counts;
}
