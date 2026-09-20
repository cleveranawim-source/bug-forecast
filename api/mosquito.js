// 서울시 모기예보제 프록시 — Vercel 서버리스 함수
// 서울시 열린데이터광장 오픈API를 서버에서 호출해 키(SEOUL_API_KEY)를 숨긴다.
// 사용: GET /api/mosquito
//
// ── 실측으로 확인한 API 사양(2026-09) ─────────────────────────────────────────
//  · URL: http://openapi.seoul.go.kr:8088/{KEY}/json/MosquitoStatus/1/1/{YYYY-MM-DD}
//    날짜는 **필수**. 빠뜨리면 ERROR-300(필수 값 누락), YYYYMMDD 형식은 INFO-200(없음).
//  · 필드: MOSQUITO_VALUE_WATER(수변부) / _HOUSE(주거지) / _PARK(공원)
//  · **지수 스케일은 0~100** — 한여름 수변부가 정확히 100.0에서 상한에 걸리는 것으로 확인.
//    (문서의 4단계 0~250/251~500/501~750/751~1000은 원지수 0~1000 기준이라 그대로 쓰면
//     전부 '쾌적'으로 잘못 나온다. 여기서는 100 기준으로 4등분한다.)
//  · 당일 데이터는 대개 아직 없음 → 최근 날짜로 며칠 거슬러 올라가며 찾는다.
//
// SEOUL_API_KEY가 없으면 501(enabled:false)을 반환하고, 클라이언트는 조용히 자체 추정치만 쓴다.

const BASE = 'http://openapi.seoul.go.kr:8088';
const SERVICE = 'MosquitoStatus';

// 0~100 지수 → 서울시 4단계
function stageOf(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  if (v > 75) return { step: 4, label: '불쾌' };
  if (v > 50) return { step: 3, label: '주의' };
  if (v > 25) return { step: 2, label: '관심' };
  return { step: 1, label: '쾌적' };
}

// KST 기준 날짜 문자열(Vercel 함수는 UTC로 돌아 +9h 보정)
function kstDate(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

async function fetchDay(key, date) {
  const res = await fetch(`${BASE}/${key}/json/${SERVICE}/1/1/${date}`, {
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const row = json?.[SERVICE]?.row?.[0];
  return row ?? null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const key = process.env.SEOUL_API_KEY;
  if (!key) {
    // 키 미설정은 '오류'가 아니라 '기능 미활성' — 클라이언트가 조용히 넘어가도록 501.
    return res.status(501).json({ error: 'SEOUL_API_KEY 미설정', enabled: false });
  }

  try {
    // 당일→최대 5일 전까지 거슬러 올라가며 가장 최근 발표분을 찾는다.
    let row = null;
    let usedDate = null;
    for (let i = 0; i < 6 && !row; i += 1) {
      const date = kstDate(i);
      // eslint-disable-next-line no-await-in-loop
      row = await fetchDay(key, date);
      if (row) usedDate = date;
    }
    if (!row) {
      return res.status(502).json({ error: '최근 6일간 서울시 모기예보 데이터 없음' });
    }

    const build = (v) => (v == null || v === '' ? null : { value: Number(v), ...stageOf(v) });
    const result = {
      enabled: true,
      date: row.MOSQUITO_DATE ?? usedDate,
      source: '서울시 모기예보제',
      // 앱의 장소 환경 키와 맞춰 둔다(공원 ≈ 산자락/녹지).
      riverside: build(row.MOSQUITO_VALUE_WATER),
      urban: build(row.MOSQUITO_VALUE_HOUSE),
      mountain: build(row.MOSQUITO_VALUE_PARK),
    };

    // 하루 단위 발표이므로 엣지에서 1시간 캐시.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(result);
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? '서울시 API 응답 시간 초과' : e.message;
    return res.status(502).json({ error: msg });
  }
}
