// 서울시 모기예보제 프록시 — Vercel 서버리스 함수
// 서울시 열린데이터광장 오픈API(무료, 키 발급 필요)를 서버에서 호출해 키를 숨긴다.
// 사용: GET /api/mosquito         (오늘 기준 최신 1건)
//
// 서울시는 모기활동지수(0~1000)를 4단계로 발표한다:
//   1단계 쾌적(0~250) / 2단계 관심(251~500) / 3단계 주의(501~750) / 4단계 불쾌(751~1000)
// 지역 구분: 수변부·주거지·공원 — 우리 앱의 riverside/urban/mountain 환경 보정과 대응한다.
//
// SEOUL_API_KEY가 없으면 501을 반환하고, 클라이언트는 조용히 자체 추정치만 쓴다(기능 저하 없음).

const BASE = 'http://openapi.seoul.go.kr:8088';
const SERVICE = 'MosquitoStatus';

// 서울시 단계 라벨(지수 → 단계)
function stageOf(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  if (v > 750) return { step: 4, label: '불쾌' };
  if (v > 500) return { step: 3, label: '주의' };
  if (v > 250) return { step: 2, label: '관심' };
  return { step: 1, label: '쾌적' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const key = process.env.SEOUL_API_KEY;
  if (!key) {
    // 키 미설정은 '오류'가 아니라 '기능 미활성' — 클라이언트가 조용히 넘어가도록 501.
    return res.status(501).json({ error: 'SEOUL_API_KEY 미설정', enabled: false });
  }

  try {
    const url = `${BASE}/${key}/json/${SERVICE}/1/5/`;
    const upstream = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!upstream.ok) {
      return res.status(502).json({ error: `서울시 API 응답 오류: ${upstream.status}` });
    }
    const json = await upstream.json();

    const rows = json?.[SERVICE]?.row;
    if (!Array.isArray(rows) || rows.length === 0) {
      const msg = json?.RESULT?.MESSAGE ?? json?.[SERVICE]?.RESULT?.MESSAGE ?? '데이터 없음';
      return res.status(502).json({ error: `서울시 API: ${msg}` });
    }

    // 가장 최근 일자 1건. 필드명은 서비스 스펙에 따라 대소문자가 섞여 있어 유연하게 읽는다.
    const pick = (row, ...names) => {
      for (const n of names) {
        const hit = Object.keys(row).find((k) => k.toUpperCase() === n.toUpperCase());
        if (hit && row[hit] != null && row[hit] !== '') return row[hit];
      }
      return null;
    };
    const latest = rows[0];
    const water = pick(latest, 'MOSQUITO_VALUE_WATER', 'MOSQUITO_VALUE_waterside');
    const house = pick(latest, 'MOSQUITO_VALUE_HOUSE', 'MOSQUITO_VALUE_residential');
    const park = pick(latest, 'MOSQUITO_VALUE_PARK');
    const date = pick(latest, 'MOSQUITO_DATE', 'ANALYSIS_DATE', 'MSR_DATE');

    const result = {
      enabled: true,
      date,
      source: '서울시 모기예보제',
      // riverside/urban/mountain — 앱의 장소 환경 키와 맞춰 둔다(공원≈산자락/녹지).
      riverside: water == null ? null : { value: Number(water), ...stageOf(water) },
      urban: house == null ? null : { value: Number(house), ...stageOf(house) },
      mountain: park == null ? null : { value: Number(park), ...stageOf(park) },
    };

    // 하루 단위 발표이므로 엣지에서 1시간 캐시.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(result);
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? '서울시 API 응답 시간 초과' : e.message;
    return res.status(502).json({ error: msg });
  }
}
