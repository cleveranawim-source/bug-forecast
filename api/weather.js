// 기상청 단기예보 프록시 — Vercel 서버리스 함수
// 인증키(KMA_KEY)를 서버 환경변수에만 두어 클라이언트 번들·네트워크 노출을 막는다.
// 사용: GET /api/weather?nx=60&ny=127  (nx/ny = 기상청 격자 좌표)

const BASE_URL =
  'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';

// KST 기준 가장 최근 발표회차(02·05·…·23시, 발표 후 10분 여유).
// Vercel 함수는 UTC로 돌므로 +9시간 보정 후 UTC 게터로 읽는다.
function getBaseDateTime(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const slots = [2, 5, 8, 11, 14, 17, 20, 23];
  const hour = kst.getUTCHours();
  const minute = kst.getUTCMinutes();

  let slot = null;
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    if (hour > slots[i] || (hour === slots[i] && minute >= 10)) {
      slot = slots[i];
      break;
    }
  }
  if (slot === null) {
    kst.setUTCDate(kst.getUTCDate() - 1);
    slot = 23;
  }

  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return { baseDate: `${yyyy}${mm}${dd}`, baseTime: `${String(slot).padStart(2, '0')}00` };
}

// 직전 발표회차 — 기상청이 현재 회차 데이터를 늦게 올리는 일이 흔해 폴백에 쓴다.
export function prevSlot(baseDate, baseTime) {
  const slots = ['0200', '0500', '0800', '1100', '1400', '1700', '2000', '2300'];
  const i = slots.indexOf(baseTime);
  if (i > 0) return { baseDate, baseTime: slots[i - 1] };
  // 0200의 이전 회차 = 전날 2300
  const d = new Date(Date.UTC(
    Number(baseDate.slice(0, 4)),
    Number(baseDate.slice(4, 6)) - 1,
    Number(baseDate.slice(6, 8))
  ));
  d.setUTCDate(d.getUTCDate() - 1);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return { baseDate: `${yyyy}${mm}${dd}`, baseTime: '2300' };
}

// 한 회차 조회. 성공 시 { json }, 실패 시 { error } — HTTP 오류·타임아웃·비JSON(키 오류 시
// XML 반환)·빈 items를 모두 실패로 처리해 폴백이 판단할 수 있게 한다.
async function fetchSlot(key, nx, ny, baseDate, baseTime) {
  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: '1',
    numOfRows: '1000',
    dataType: 'JSON',
    base_date: baseDate,
    base_time: baseTime,
    nx: String(nx),
    ny: String(ny),
  });
  try {
    const upstream = await fetch(`${BASE_URL}?${params}`, { signal: AbortSignal.timeout(7000) });
    if (!upstream.ok) return { error: `기상청 응답 오류: ${upstream.status}` };
    const text = await upstream.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { error: '기상청 비정상 응답(JSON 아님)' };
    }
    const items = json?.response?.body?.items?.item;
    if (!Array.isArray(items) || items.length === 0) {
      return { error: json?.response?.header?.resultMsg ?? '해당 회차 데이터 없음' };
    }
    return { json };
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? '기상청 응답 시간 초과' : `요청 실패: ${e.message}` };
  }
}

export default async function handler(req, res) {
  // 네이티브(Capacitor) 앱은 capacitor:// 오리진에서 호출하므로 CORS를 연다.
  // 응답은 공개 기상 데이터뿐이라 오리진 제한 없이 허용해도 키는 노출되지 않는다.
  res.setHeader('Access-Control-Allow-Origin', '*');

  const key = process.env.KMA_KEY;
  if (!key) {
    return res.status(500).json({ error: 'KMA_KEY 환경변수가 설정되지 않았습니다.' });
  }

  const nx = Number(req.query.nx);
  const ny = Number(req.query.ny);
  // 기상청 격자 범위(한반도 1~149 / 1~253) 밖이면 거부 — 프록시 오남용 방지
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 1 || nx > 149 || ny < 1 || ny > 253) {
    return res.status(400).json({ error: 'nx/ny 격자 좌표가 필요합니다.' });
  }

  // 현재 회차 → 실패 시 직전 회차 1회 폴백(발표 지연 대비).
  const current = getBaseDateTime();
  let result = await fetchSlot(key, nx, ny, current.baseDate, current.baseTime);
  if (result.error) {
    const prev = prevSlot(current.baseDate, current.baseTime);
    const fallback = await fetchSlot(key, nx, ny, prev.baseDate, prev.baseTime);
    if (fallback.json) {
      result = fallback;
    } else {
      return res.status(502).json({
        error: `현재 회차: ${result.error} / 직전 회차: ${fallback.error}`,
      });
    }
  }

  // 같은 격자·같은 발표회차 요청은 엣지에서 10분 캐시 — 사용자 수와 무관하게
  // 기상청 실호출은 격자당 1회 수준으로 흡수된다(일일 쿼터 보호).
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  return res.status(200).json(result.json);
}
