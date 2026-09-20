// 러브버그(붉은등우단털파리) 출몰 위험 모델
// -----------------------------------------------------------------------------
// 입력 필드는 기상청 단기예보(getVilageFcst) 응답과 1:1로 정렬한다.
//   temp   ← TMP (1시간 기온, ℃)
//   humidity ← REH (습도, %)
//   rain   ← POP (강수확률, %)        ※ recentRainMm가 있으면 그쪽을 우선 사용
//   wind   ← WSD (풍속, m/s)
//   recentRainMm (선택) ← 최근 1~3일 누적 강수량(mm). 우화(羽化) 타이밍 신호.
//   reports ← 시민 관측 누적 제보 수 (실측 보정)
//   id     ← 자치구 id (산지 인접 지형 가중)
//
// 출력: { score:0~100, label, tone, factors } — 기존 getRisk와 호환되는 형태.
//
// 생태 근거(요약):
//  - 6월 중순~7월 초, 25~30℃·고습(70%+)에서 대발생
//  - 비가 적당히 온 "직후 갬"에 성충이 한꺼번에 우화 → 폭증의 핵심 트리거
//  - 약한 바람(≤1.5m/s)에서 활동, 강풍(5m/s+)이면 거의 날지 못함
//  - 북한산·관악산 등 산지 인접 도시지역이 발생원
//  계수는 초기 추정치이며, 시민 제보가 쌓이면 실측으로 보정한다.

// 산지 인접 가중(0~1): 발생원(산자락)에 가까운 구일수록 높음.
const TERRAIN_WEIGHT = {
  eunpyeong: 1.0,   // 북한산
  gangbuk: 0.95,    // 북한산·우이
  dobong: 0.95,     // 도봉산·북한산
  gwanak: 0.9,      // 관악산
  jongno: 0.85,     // 북악·인왕·북한산 자락
  seodaemun: 0.85,  // 안산·인왕
  seongbuk: 0.85,   // 북악·정릉(북한산)
  nowon: 0.8,       // 수락산·불암산
  jungnang: 0.7,    // 망우산·봉화산
  gwangjin: 0.7,    // 아차산·용마산
  geumcheon: 0.65,  // 호암산·관악 자락
  guro: 0.6,        // 호암산 자락
  gangdong: 0.6,    // 고덕산·일자산
  seocho: 0.6,      // 우면산·청계산
  dongjak: 0.55,    // 국사봉·서달산
  gangseo: 0.55,    // 개화산
  seongdong: 0.5,   // 응봉 언덕
  dongdaemun: 0.5,  // 배봉산
  gangnam: 0.5,     // 대모산·구룡산
  jung: 0.45,       // 남산
  yongsan: 0.45,    // 남산
  mapo: 0.45,
  yangcheon: 0.45,  // 갈산
  songpa: 0.45,     // 남한산 자락
  yeongdeungpo: 0.35, // 평지
};

const DEFAULT_TERRAIN = 0.6;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// 기온: 25~30℃ 최적, 16℃ 이하·36℃ 이상에서 활동 정지(사다리꼴).
function tempFactor(t) {
  if (t <= 16 || t >= 36) return 0;
  if (t >= 25 && t <= 30) return 1;
  if (t < 25) return clamp01((t - 16) / (25 - 16));
  return clamp01((36 - t) / (36 - 30));
}

// 습도: 50%부터 상승해 85%+에서 포화.
function humidityFactor(h) {
  return clamp01((h - 50) / (85 - 50));
}

// 바람: 약풍 선호. 1.5m/s 이하 최적, 5m/s 이상이면 거의 비행 불가.
function windFactor(w) {
  if (w <= 1.5) return 1;
  if (w >= 5) return 0.05;
  return clamp01(1 - (w - 1.5) / (5 - 1.5));
}

// 우화 트리거: "비 직후 갬"이 폭증의 핵심.
// 최근 누적 강수(recentRainMm)가 있으면 그것으로, 없으면 강수확률(POP)로 근사한다.
function rainTriggerFactor(rainProb, recentRainMm) {
  if (typeof recentRainMm === 'number') {
    if (recentRainMm <= 0) return 0.2;        // 가뭄: 우화 적음
    if (recentRainMm >= 60) return 0.55;      // 폭우: 유충이 쓸려나가 오히려 감소
    return clamp01(0.2 + recentRainMm / 35);  // 5~40mm 구간이 최적
  }
  // POP 근사: 비구름이 지나간 뒤 형성되는 다습 환경을 대리 신호로.
  return clamp01(0.05 + (rainProb / 100) * 0.7); // 0.05 ~ 0.75
}

// 시민 제보: 실측 신호. 0~35건 구간을 선형으로 0~1 매핑(35건+ 포화).
function citizenFactor(reports) {
  const n = Math.max(0, reports ?? 0);
  return clamp01(n / 35);
}

// 시즌 계수 — 러브버그 성충 활동기(6월 중순~7월 초 대발생) 기준으로 지수를 감쇠.
// 한여름·가을·겨울에 날씨만 맞다고 높은 지수가 나오면 신뢰를 잃으므로, 발생 생태 달력을 반영한다.
export function seasonFactor(date = new Date()) {
  const key = (date.getMonth() + 1) * 100 + date.getDate(); // 월일 → 예: 7월 2일 = 702
  if (key >= 615 && key <= 710) return 1;    // 대발생 피크
  if (key >= 601 && key < 615) return 0.8;   // 증가기
  if (key >= 711 && key <= 725) return 0.6;  // 감소기
  if (key >= 516 && key <= 531) return 0.4;  // 초기 출현
  if (key >= 726 && key <= 810) return 0.25; // 잔존 개체
  return 0.08;                               // 비시즌
}

function band(score) {
  if (score >= 75) return { label: '매우 높음', tone: 'danger' };
  if (score >= 55) return { label: '높음', tone: 'warning' };
  if (score >= 35) return { label: '보통', tone: 'notice' };
  return { label: '낮음', tone: 'calm' };
}

// 가중치: 환경 잠재력(기온·습도·바람·우화·지형)을 합쳐 60%,
// 실측인 시민 제보를 40%로 둔다. 제보가 쌓일수록 모델이 현실에 수렴.
// 기온은 시즌 내 구별 차이가 작아 비중을 낮추고, 변별이 큰 습도·지형에 무게를 둔다.
const ENV_WEIGHTS = { temp: 0.2, humidity: 0.3, wind: 0.15, rain: 0.15, terrain: 0.2 };

export function computeRisk(region, date = new Date()) {
  const factors = {
    temp: tempFactor(region.temp),
    humidity: humidityFactor(region.humidity),
    wind: windFactor(region.wind),
    rain: rainTriggerFactor(region.rain, region.recentRainMm),
    terrain: TERRAIN_WEIGHT[region.id] ?? DEFAULT_TERRAIN,
    citizen: citizenFactor(region.reports),
    season: seasonFactor(date),
  };

  const environment =
    ENV_WEIGHTS.temp * factors.temp +
    ENV_WEIGHTS.humidity * factors.humidity +
    ENV_WEIGHTS.wind * factors.wind +
    ENV_WEIGHTS.rain * factors.rain +
    ENV_WEIGHTS.terrain * factors.terrain;

  // 시즌 계수는 전체에 곱한다 — 비시즌엔 날씨가 완벽해도 실제 개체가 없기 때문.
  const raw = (0.6 * environment + 0.4 * factors.citizen) * factors.season;
  const score = Math.round(clamp01(raw) * 100);

  return { score, ...band(score), factors };
}

// 시드(추정 기준선)와 실제 제보의 블렌딩.
// REGIONS의 seed reports는 실측이 아니라 지형·경험 기반 추정 기준선이다.
// 실제 제보가 쌓일수록 시드 가중치가 줄어 10건에 도달하면 완전히 실측으로 대체된다
// — 초기(제보 0건)엔 기존과 동일하게 동작하고, 데이터가 모이면 모델이 현실에 수렴.
export function blendReports(seedReports, liveCount) {
  const live = Math.max(0, liveCount ?? 0);
  const seedWeight = Math.max(0, 1 - live / 10);
  return (seedReports ?? 0) * seedWeight + live;
}

// 기존 호출부 호환을 위한 별칭.
export const getRisk = computeRisk;

// =============================================================================
// 다종(多種) 예보 — 종별 프로필
// -----------------------------------------------------------------------------
// 러브버그는 위의 computeRisk를 그대로 쓰고(무회귀), 모기·진드기·말벌은 각자의
// 생태 프로필로 계산한다. 출력 형태는 모두 { score, label, tone, factors }로 같아
// 화면 코드가 종을 가리지 않고 쓸 수 있다.
//
// kind: 'index' = 날씨 기반 0~100 지수(러브버그·모기 — 기상 반응이 뚜렷한 종)
//       'grade' = 계절·지형 위주 주의 등급(진드기·말벌 — 날씨로 정밀 예측하는 척하지 않음)
// =============================================================================

// 월일(MMDD) 키로 시즌 창 조회. windows=[{from,to,f}], 없으면 off.
function seasonFromWindows(windows, off, date) {
  const key = (date.getMonth() + 1) * 100 + date.getDate();
  for (const w of windows) if (key >= w.from && key <= w.to) return w.f;
  return off;
}

// 사다리꼴 기온 반응(종별 임계값)
function trapezoid(t, lo, optLo, optHi, hi) {
  if (t == null) return 0.5;
  if (t <= lo || t >= hi) return 0;
  if (t >= optLo && t <= optHi) return 1;
  if (t < optLo) return clamp01((t - lo) / (optLo - lo));
  return clamp01((hi - t) / (hi - optHi));
}

// 물가·저지대 인접 가중(모기): 하천·한강·정체수가 많은 구일수록 높음.
const TERRAIN_MOSQUITO = {
  songpa: 1.0, gangdong: 0.95, gwangjin: 0.95, seongdong: 0.9, mapo: 0.9,
  yeongdeungpo: 0.9, gangseo: 0.9, yangcheon: 0.85, guro: 0.85, dongjak: 0.8,
  yongsan: 0.8, jungnang: 0.8, dongdaemun: 0.75, seocho: 0.75, gangnam: 0.7,
  eunpyeong: 0.7, seongbuk: 0.65, nowon: 0.65, dobong: 0.6, gangbuk: 0.6,
  seodaemun: 0.6, jongno: 0.55, jung: 0.55, gwanak: 0.6, geumcheon: 0.7,
};

export const SPECIES = {
  lovebug: {
    id: 'lovebug', name: '러브버그', emoji: '🐞', kind: 'index',
    // 장소 환경 보정(구 지수 대비 ±점) — 물가·산자락에서 많고 도심에서 적다
    envAdj: { riverside: 8, mountain: 5, urban: -10 },
    seasonWindows: [
      { from: 615, to: 710, f: 1 }, { from: 601, to: 614, f: 0.8 }, { from: 711, to: 725, f: 0.6 },
      { from: 516, to: 531, f: 0.4 }, { from: 726, to: 810, f: 0.25 },
    ],
    seasonOff: 0.08,
    labels: { danger: '출몰 많음', warning: '출몰 주의', notice: '출몰 보통', calm: '출몰 적음' },
    seasonNote: '6월 중순~7월 초 대발생, 7월 중순이면 대부분 사라져요.',
    tips: [
      '해 뜬 직후 이른 아침(6~8시)이 가장 적어요',
      '밝은 조명·흰 벽에 몰리니 저녁엔 조명 주변을 피하세요',
      '사람을 물지 않아요 — 옷에 붙으면 털어내면 돼요',
    ],
  },
  mosquito: {
    id: 'mosquito', name: '모기', emoji: '🦟', kind: 'index',
    envAdj: { riverside: 12, urban: 3, mountain: -6 },
    // 5월 시작, 한여름, 8월 중순~10월 중순 '가을 모기' 피크(일본뇌염 환자 9~10월 집중), 11월 초까지
    seasonWindows: [
      { from: 816, to: 1015, f: 1 }, { from: 616, to: 815, f: 0.85 }, { from: 501, to: 615, f: 0.55 },
      { from: 1016, to: 1110, f: 0.6 }, { from: 1111, to: 1130, f: 0.3 }, { from: 401, to: 430, f: 0.2 },
    ],
    seasonOff: 0.05,
    labels: { danger: '모기 많음', warning: '모기 주의', notice: '모기 보통', calm: '모기 적음' },
    seasonNote: '가을 모기는 11월 초까지 활동해요. 일본뇌염 환자는 9~10월에 집중돼요.',
    tips: [
      '해질녘~밤 외출엔 긴 옷과 기피제',
      '집 주변 고인 물(화분 받침·배수구)을 비우세요',
      '일본뇌염 예방접종(특히 어린이) 확인',
    ],
    // 공식 경보(정적 기록 — 출처·날짜 명시). 시즌 창 안에서만 표시.
    alerts: [{ label: '일본뇌염 경보 발령 중', source: '질병관리청', since: '2026-06-17', until: '1130' }],
  },
  tick: {
    id: 'tick', name: '진드기', emoji: '🕷️', kind: 'grade',
    envAdj: { mountain: 15, riverside: 5, urban: -15 },
    // 가을(SFTS·쯔쯔가무시) 10~11월 집중, 봄 SFTS 4~6월
    seasonWindows: [
      { from: 1001, to: 1115, f: 1 }, { from: 901, to: 930, f: 0.8 }, { from: 1116, to: 1130, f: 0.6 },
      { from: 401, to: 630, f: 0.55 }, { from: 701, to: 831, f: 0.35 },
    ],
    seasonOff: 0.05,
    labels: { danger: '진드기 경보', warning: '진드기 주의', notice: '진드기 관심', calm: '진드기 낮음' },
    seasonNote: '벌초·성묘·산행철(9~11월)에 SFTS·쯔쯔가무시 감염이 집중돼요.',
    tips: [
      '긴 소매·긴 바지, 밝은 색 옷 + 기피제',
      '풀밭에 앉거나 눕지 않기, 돗자리 사용',
      '귀가 후 바로 샤워하고 옷 세탁',
      '2주 안에 발열·두통이 오면 병원에 야외활동을 알리세요',
    ],
  },
  wasp: {
    id: 'wasp', name: '말벌', emoji: '🐝', kind: 'grade',
    envAdj: { mountain: 12, riverside: 2, urban: -8 },
    // 벌 쏘임 119 이송의 29%가 9월(연중 최다), 8~10월 벌초·산행철
    seasonWindows: [
      { from: 901, to: 930, f: 1 }, { from: 801, to: 831, f: 0.8 }, { from: 1001, to: 1031, f: 0.7 },
      { from: 701, to: 731, f: 0.5 }, { from: 1101, to: 1115, f: 0.3 },
    ],
    seasonOff: 0.05,
    labels: { danger: '말벌 경보', warning: '말벌 주의', notice: '말벌 관심', calm: '말벌 낮음' },
    seasonNote: '벌 쏘임 사고의 30%가 9월에 몰려요. 벌초·성묘·산행 때 특히 조심.',
    tips: [
      '검은 옷·향수·화려한 색 피하기',
      '벌집을 발견하면 건드리지 말고 119',
      '쏘이면 카드로 침을 긁어내고 냉찜질',
      '어지럼·호흡곤란이 오면 즉시 119(과민반응)',
    ],
  },
};

export const SPECIES_ORDER = ['lovebug', 'mosquito', 'tick', 'wasp'];

// 종별 시즌 계수
export function speciesSeason(speciesId, date = new Date()) {
  const p = SPECIES[speciesId];
  if (!p) return 0;
  if (speciesId === 'lovebug') return seasonFactor(date);
  return seasonFromWindows(p.seasonWindows, p.seasonOff, date);
}

function bandFor(speciesId, score) {
  const b = band(score);
  return { ...b, label: SPECIES[speciesId]?.labels?.[b.tone] ?? b.label };
}

// 종별 위험 계산. 러브버그는 기존 computeRisk 그대로(라벨만 종 표기).
export function computeSpeciesRisk(speciesId, region, date = new Date()) {
  if (speciesId === 'lovebug') {
    const r = computeRisk(region, date);
    return { ...r, ...bandFor('lovebug', r.score) };
  }
  const season = speciesSeason(speciesId, date);
  const citizen = citizenFactor(region.reports);

  if (speciesId === 'mosquito') {
    const factors = {
      temp: trapezoid(region.temp, 13, 24, 30, 37),
      humidity: clamp01(((region.humidity ?? 50) - 40) / 40), // 40%→0, 80%+→1
      wind: region.wind == null ? 0.7 : region.wind <= 2 ? 1 : region.wind >= 6 ? 0.1 : clamp01(1 - (region.wind - 2) / 4),
      // 비 온 뒤 며칠 정체수↑ — 우화 트리거보다 완만하게
      rain: typeof region.recentRainMm === 'number'
        ? clamp01(0.3 + Math.min(region.recentRainMm, 40) / 60)
        : clamp01(0.3 + ((region.rain ?? 0) / 100) * 0.4),
      terrain: TERRAIN_MOSQUITO[region.id] ?? 0.7,
      citizen, season,
    };
    const env = 0.35 * factors.temp + 0.25 * factors.humidity + 0.15 * factors.wind + 0.1 * factors.rain + 0.15 * factors.terrain;
    const score = Math.round(clamp01((0.7 * env + 0.3 * citizen) * season) * 100);
    return { score, ...bandFor('mosquito', score), factors };
  }

  if (speciesId === 'tick') {
    // 계절·지형 위주. 날씨는 보조(따뜻하고 습한 풀밭에서 활발).
    const factors = {
      temp: trapezoid(region.temp, 8, 15, 28, 34),
      humidity: clamp01(((region.humidity ?? 50) - 40) / 40),
      terrain: TERRAIN_WEIGHT[region.id] ?? DEFAULT_TERRAIN,
      citizen, season,
    };
    const env = 0.55 * factors.terrain + 0.25 * factors.temp + 0.2 * factors.humidity;
    // 등급형은 환경만으로는 '주의'(≤74)까지 — '경보'는 실제 제보(물림·목격)가 쌓일 때만.
    const score = Math.round(clamp01((0.75 * env + 0.25 * citizen) * season) * 100);
    return { score, ...bandFor('tick', score), factors };
  }

  if (speciesId === 'wasp') {
    // 맑고 따뜻하고 바람 없는 날 + 산지 인접. 비 오는 날은 활동 감소.
    const factors = {
      temp: trapezoid(region.temp, 15, 22, 32, 38),
      rain: clamp01(1 - (region.rain ?? 0) / 100),
      wind: region.wind == null ? 0.7 : region.wind <= 2 ? 1 : clamp01(1 - (region.wind - 2) / 5),
      terrain: TERRAIN_WEIGHT[region.id] ?? DEFAULT_TERRAIN,
      citizen, season,
    };
    const env = 0.35 * factors.temp + 0.2 * factors.rain + 0.15 * factors.wind + 0.3 * factors.terrain;
    // 등급형은 환경만으로는 '주의'까지 — '경보'는 말벌집·쏘임 제보가 쌓일 때만.
    const score = Math.round(clamp01((0.75 * env + 0.25 * citizen) * season) * 100);
    return { score, ...bandFor('wasp', score), factors };
  }

  return { score: 0, label: '정보 없음', tone: 'calm', factors: { season } };
}

// 오늘 활동 중인 종(시즌 계수 ≥ 0.3)을 위험 순으로. 홈 히어로가 첫 번째를 보여준다.
export function activeSpeciesToday(region, date = new Date(), minSeason = 0.3) {
  return SPECIES_ORDER
    .filter((id) => speciesSeason(id, date) >= minSeason)
    .map((id) => ({ id, risk: computeSpeciesRisk(id, region, date) }))
    .sort((a, b) => b.risk.score - a.risk.score);
}

// 종별 장소 위험(구 지수 + 환경 보정). 기존 getPlaceRisk와 같은 밴드 기준.
export function speciesPlaceRisk(speciesId, regionScore, env) {
  const adj = SPECIES[speciesId]?.envAdj?.[env] ?? 0;
  const score = Math.max(0, Math.min(100, regionScore + adj));
  const b = band(score);
  return { score, tone: b.tone, label: b.label };
}

// 시즌 안에서만 유효한 공식 경보 목록
export function speciesAlerts(speciesId, date = new Date()) {
  const p = SPECIES[speciesId];
  if (!p?.alerts) return [];
  const key = (date.getMonth() + 1) * 100 + date.getDate();
  return p.alerts.filter((a) => {
    const untilKey = Number(a.until);
    const sinceKey = Number(a.since.slice(5, 7)) * 100 + Number(a.since.slice(8, 10));
    return key >= sinceKey && key <= untilKey;
  });
}
