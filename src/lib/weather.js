// 기상청 단기예보(getVilageFcst) 클라이언트
// 위경도를 격자로 변환해 가장 최근 발표예보를 받아, 위험모델 입력 형태로 정규화한다.
// 인증키는 환경변수 VITE_KMA_KEY (.env). 발급: 공공데이터포털 "기상청_단기예보 조회서비스".

import { latLonToGrid } from './grid.js';

const BASE_URL =
  'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';

// 단기예보 발표시각(02·05·08·11·14·17·20·23시). 현재시각 기준 가장 최근 발표분을 고른다.
// 발표 후 약 10분 뒤 제공되므로, 정시+10분 이전이면 직전 회차를 사용한다.
export function getBaseDateTime(now = new Date()) {
  const slots = [2, 5, 8, 11, 14, 17, 20, 23];
  const d = new Date(now);
  const hour = d.getHours();
  const minute = d.getMinutes();

  let slot = null;
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    if (hour > slots[i] || (hour === slots[i] && minute >= 10)) {
      slot = slots[i];
      break;
    }
  }
  if (slot === null) {
    // 자정~02:10 이전 → 전날 23시 회차
    d.setDate(d.getDate() - 1);
    slot = 23;
  }

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return { baseDate: `${yyyy}${mm}${dd}`, baseTime: `${String(slot).padStart(2, '0')}00` };
}

// 기상청 카테고리 → 위험모델 입력 필드
const CATEGORY_MAP = {
  TMP: 'temp',     // 1시간 기온(℃)
  REH: 'humidity', // 습도(%)
  POP: 'rain',     // 강수확률(%)
  WSD: 'wind',     // 풍속(m/s)
  PTY: 'pty',      // 강수형태(0없음/1비/2비눈/3눈/4소나기)
  SKY: 'sky',      // 하늘상태(1맑음/3구름많음/4흐림)
};

// items를 예보시각별로 묶고, 가장 이른(현재에 가까운) 시각의 조건을 반환. (순수함수: 테스트 가능)
export function normalizeForecast(items, meta = {}) {
  const byTime = new Map();
  for (const it of items) {
    const stamp = `${it.fcstDate}${it.fcstTime}`;
    if (!byTime.has(stamp)) byTime.set(stamp, {});
    const field = CATEGORY_MAP[it.category];
    if (field) byTime.get(stamp)[field] = Number(it.fcstValue);
  }
  const stamps = [...byTime.keys()].sort();
  const current = stamps.length ? byTime.get(stamps[0]) : {};
  return {
    ...meta,
    temp: current.temp ?? null,
    humidity: current.humidity ?? null,
    rain: current.rain ?? null, // POP 강수확률(%)
    wind: current.wind ?? null, // WSD 풍속(m/s)
    fcstStamp: stamps[0] ?? null,
    raw: current,
  };
}

// PCP(1시간 강수량) 문자열 → mm 숫자. "강수없음"/"1mm 미만"/"30.0~50.0mm"/"50.0mm 이상" 형태를 처리한다.
function parsePcp(value) {
  if (!value || value === '강수없음') return 0;
  if (String(value).includes('미만')) return 0.5;
  if (String(value).includes('이상')) return 60;
  if (String(value).includes('~')) return 40;
  const n = parseFloat(value);
  return Number.isNaN(n) ? 0 : n;
}

// 하늘상태(SKY)+강수형태(PTY) → 사람이 읽는 날씨 라벨
function weatherLabel(sky, pty) {
  if (pty === 1 || pty === 4) return '비';
  if (pty === 2) return '비/눈';
  if (pty === 3) return '눈';
  if (sky >= 4) return '흐림';
  if (sky >= 3) return '구름 많음';
  return '맑음';
}

// items를 날짜별로 묶어 일 대표값으로 요약(오늘~모레 최대 3일).
// 기온=14시(러브버그 활동 시간대) 없으면 그날 최고, 습도·바람=평균, 강수확률=최대, 강수량=합.
export function normalizeDaily(items) {
  const days = new Map();
  for (const it of items) {
    if (!days.has(it.fcstDate)) days.set(it.fcstDate, {});
    const day = days.get(it.fcstDate);
    const push = (k, v) => {
      (day[k] ??= []).push(v);
    };
    if (it.category === 'TMP') {
      push('temps', Number(it.fcstValue));
      if (it.fcstTime === '1400') day.temp14 = Number(it.fcstValue);
    } else if (it.category === 'REH') push('rehs', Number(it.fcstValue));
    else if (it.category === 'WSD') push('wsds', Number(it.fcstValue));
    else if (it.category === 'POP') push('pops', Number(it.fcstValue));
    else if (it.category === 'PCP') push('pcps', parsePcp(it.fcstValue));
    else if (it.category === 'SKY') {
      if (it.fcstTime === '1400' || day.sky == null) day.sky = Number(it.fcstValue);
    } else if (it.category === 'PTY') {
      const p = Number(it.fcstValue);
      if (p > 0) day.pty = p;
    }
  }
  const avg = (arr) => (arr && arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, d]) => ({
      date,
      temp: d.temp14 ?? (d.temps ? Math.max(...d.temps) : null),
      humidity: avg(d.rehs) == null ? null : Math.round(avg(d.rehs)),
      wind: avg(d.wsds) == null ? null : Math.round(avg(d.wsds) * 10) / 10,
      rain: d.pops ? Math.max(...d.pops) : null,
      precip: d.pcps ? Math.round(d.pcps.reduce((s, v) => s + v, 0) * 10) / 10 : 0,
      label: weatherLabel(d.sky ?? 1, d.pty ?? 0),
    }))
    .filter((d) => d.temp != null && d.humidity != null)
    .slice(0, 3);
}

export async function fetchWeather(lat, lon, { signal } = {}) {
  const key = import.meta.env.VITE_KMA_KEY;
  if (!key) {
    throw new Error('VITE_KMA_KEY 미설정: .env에 기상청 인증키를 넣어주세요.');
  }

  const { nx, ny } = latLonToGrid(lat, lon);
  const { baseDate, baseTime } = getBaseDateTime();
  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: '1',
    numOfRows: '1000', // 단기예보는 +3일치(시간×12카테고리)라 300으로는 하루치만 온다

    dataType: 'JSON',
    base_date: baseDate,
    base_time: baseTime,
    nx: String(nx),
    ny: String(ny),
  });

  const res = await fetch(`${BASE_URL}?${params}`, { signal });
  if (!res.ok) throw new Error(`기상청 응답 오류: ${res.status}`);

  const json = await res.json();
  const items = json?.response?.body?.items?.item;
  if (!Array.isArray(items)) {
    const msg = json?.response?.header?.resultMsg ?? '응답 형식 오류';
    throw new Error(`기상청 데이터 없음: ${msg}`);
  }

  return { ...normalizeForecast(items, { nx, ny }), daily: normalizeDaily(items) };
}

// 서울 25개 자치구 대표 좌표(구청 위치). REGIONS의 id와 키가 일치한다.
export const DISTRICT_COORDS = {
  jongno: { lat: 37.5735, lon: 126.979 },
  jung: { lat: 37.5639, lon: 126.9975 },
  yongsan: { lat: 37.5384, lon: 126.9654 },
  seongdong: { lat: 37.5634, lon: 127.0371 },
  gwangjin: { lat: 37.5384, lon: 127.0823 },
  dongdaemun: { lat: 37.5744, lon: 127.0396 },
  jungnang: { lat: 37.6063, lon: 127.0927 },
  seongbuk: { lat: 37.5894, lon: 127.0167 },
  gangbuk: { lat: 37.6398, lon: 127.0257 },
  dobong: { lat: 37.6688, lon: 127.0471 },
  nowon: { lat: 37.6542, lon: 127.0568 },
  eunpyeong: { lat: 37.6027, lon: 126.9291 },
  seodaemun: { lat: 37.5791, lon: 126.9368 },
  mapo: { lat: 37.5663, lon: 126.9019 },
  yangcheon: { lat: 37.517, lon: 126.8666 },
  gangseo: { lat: 37.5509, lon: 126.8495 },
  guro: { lat: 37.4954, lon: 126.8874 },
  geumcheon: { lat: 37.4568, lon: 126.8955 },
  yeongdeungpo: { lat: 37.5264, lon: 126.8962 },
  dongjak: { lat: 37.5124, lon: 126.9395 },
  gwanak: { lat: 37.4784, lon: 126.9516 },
  seocho: { lat: 37.4836, lon: 127.0327 },
  gangnam: { lat: 37.5172, lon: 127.0473 },
  songpa: { lat: 37.5145, lon: 127.1059 },
  gangdong: { lat: 37.5301, lon: 127.1238 },
};

// 동시 실행 수를 제한하며 매핑(기상청 순간 호출 제한 회피).
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// 발표시각(baseDate+baseTime) 단위 localStorage 캐시 — 같은 회차는 재호출하지 않는다.
function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeCache(key, value) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('kma') && k !== key) localStorage.removeItem(k); // 옛 회차·옛 버전 정리
    }
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 용량 초과 등은 무시 */
  }
}

// 25개 구의 현재 날씨를 한 번에 조회 → { [regionId]: { temp, humidity, rain, wind } }
// 같은 발표 회차면 캐시를 쓰고, 개별 구 실패는 건너뛴다(해당 구는 기존값 유지).
export async function fetchAllDistricts() {
  const { baseDate, baseTime } = getBaseDateTime();
  // kma2 = daily(3일 예보) 포함 버전. 옛 kma- 캐시(daily 없음)와 구분한다.
  const cacheKey = `kma2-${baseDate}-${baseTime}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const ids = Object.keys(DISTRICT_COORDS);
  const pairs = await mapLimit(ids, 4, async (id) => {
    try {
      const { lat, lon } = DISTRICT_COORDS[id];
      const w = await fetchWeather(lat, lon);
      return [id, { temp: w.temp, humidity: w.humidity, rain: w.rain, wind: w.wind, daily: w.daily }];
    } catch {
      return null;
    }
  });

  const result = Object.fromEntries(pairs.filter(Boolean));
  writeCache(cacheKey, result);
  return result;
}
