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

export function computeRisk(region) {
  const factors = {
    temp: tempFactor(region.temp),
    humidity: humidityFactor(region.humidity),
    wind: windFactor(region.wind),
    rain: rainTriggerFactor(region.rain, region.recentRainMm),
    terrain: TERRAIN_WEIGHT[region.id] ?? DEFAULT_TERRAIN,
    citizen: citizenFactor(region.reports),
    season: seasonFactor(),
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

// 기존 호출부 호환을 위한 별칭.
export const getRisk = computeRisk;
