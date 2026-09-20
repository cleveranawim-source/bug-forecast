import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  Bug,
  CloudRain,
  Droplets,
  MapPin,
  Navigation,
  Plus,
  Search,
  Sun,
  ThermometerSun,
  Wind,
} from 'lucide-react';
import './styles.css';
import seoulGeo from './seoul_municipalities_geo_simple.json';
import seoulSubGeo from './seoul_submunicipalities_geo_simple.json';
import aiMap from './seoul_ai_map.json';
import metroGeo from './metro_municipalities_geo.json';
import {
  getRisk,
  blendReports,
  SPECIES,
  SPECIES_ORDER,
  computeSpeciesRisk,
  speciesSeason,
  speciesPlaceRisk,
  speciesAlerts,
} from './lib/risk.js';
import {
  addReport,
  subscribeReports,
  countByRegion,
  weightedCountByRegion,
  weightedCountByDong,
} from './lib/reports.js';
import { fetchAllDistricts, fetchSeoulMosquito } from './lib/weather.js';
import { Capacitor } from '@capacitor/core';
import { signInAnonymous, signOutUser } from './lib/auth.js';

const CITIZEN_SESSION_KEY = 'neighborhood-bug-forecast-citizen';

// 제보 쿨다운(같은 기기 기준) — 연속 제보로 구 지수를 조작하는 것을 막는다.
const REPORT_COOLDOWN_MS = 5 * 60 * 1000;

// 제보 좌표는 소수 3자리(약 110m)로 반올림해 저장 — reports는 공개 읽기라
// 정밀 좌표(제보자가 서 있던 지점)를 그대로 남기지 않는다. 동네 인증엔 110m면 충분.
const roundCoord = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : null);

// 종별 서사 꼬리말 — 왜 조심해야 하는지가 종마다 다르다.
const NARRATIVE_TAIL = {
  lovebug: {
    danger: '조명·밝은 벽 주변에 몰릴 수 있어요.',
    warning: '활동이 활발한 편이에요. 밝은 조명 주변을 주의하세요.',
    notice: '조명 주변만 가볍게 주의하세요.',
    off: '러브버그 활동 시기가 아니에요. 지수는 낮게 유지돼요.',
  },
  mosquito: {
    danger: '해질녘~밤 야외활동은 긴 옷과 기피제를 꼭 챙기세요.',
    warning: '저녁 물가·공원에서 물릴 수 있어요. 기피제를 권해요.',
    notice: '해질녘 물가만 조금 주의하면 무난해요.',
    off: '모기 활동 시기가 아니에요.',
  },
  tick: {
    danger: '풀밭에 앉지 말고, 귀가 후 바로 샤워하세요.',
    warning: '산행·벌초 때 긴 옷과 기피제를 챙기세요.',
    notice: '풀밭에 오래 앉지만 않으면 무난해요.',
    off: '진드기 활동 시기가 아니에요.',
  },
  wasp: {
    danger: '벌집을 발견하면 건드리지 말고 119에 신고하세요.',
    warning: '검은 옷·향수를 피하고 주변을 살피세요.',
    notice: '산길에서 벌집만 조심하면 무난해요.',
    off: '말벌 활동 시기가 아니에요.',
  },
};

// 위험모델 factors로 오늘의 한 줄 설명을 만든다 — REGIONS의 하드코딩 문구(창작 서사)를
// 대체해, 화면의 설명이 항상 실제 계산 근거(습도·비·바람·시즌)와 일치하게 한다.
function riskNarrative(risk, speciesId = 'lovebug') {
  const f = risk.factors;
  const tail = NARRATIVE_TAIL[speciesId] ?? NARRATIVE_TAIL.lovebug;
  if (f.season <= 0.1) return tail.off;

  const boosters = [];
  if (f.rain >= 0.55) boosters.push('비 온 뒤 우화 조건');
  if (f.humidity >= 0.7) boosters.push('높은 습도');
  if (f.temp >= 0.9) boosters.push('활동하기 좋은 기온');
  if (f.wind >= 0.9 && boosters.length < 2) boosters.push('잔잔한 바람');

  const suppressors = [];
  if (f.wind <= 0.3) suppressors.push('강한 바람');
  if (f.temp <= 0.35) suppressors.push('활동이 어려운 기온');
  if (f.rain <= 0.25) suppressors.push('건조한 날씨');
  if (f.season <= 0.3) suppressors.push('활동기가 지나가는 시기');

  const why = boosters.slice(0, 2).join('·');
  const calmWhy = suppressors[0];

  switch (risk.tone) {
    case 'danger':
      return `${why || '활동 조건이 두루 좋은 날'} 영향으로 ${tail.danger}`;
    case 'warning':
      return `${why || '무난한 활동 조건'} 영향으로 ${tail.warning}`;
    case 'notice':
      return calmWhy
        ? `${calmWhy} 영향으로 아주 많지는 않겠어요. ${tail.notice}`
        : `활동 조건이 보통이에요. ${tail.notice}`;
    default:
      return calmWhy
        ? `${calmWhy} 영향으로 활동이 잦아드는 날이에요. 쾌적하게 다녀오세요.`
        : '활동 조건이 낮아요. 쾌적하게 다녀오세요.';
  }
}

// 계절 이벤트 — 그 시기에만 뜨는 안내(벌초·성묘철 등). 날짜(MMDD) 범위로 노출.
const SEASON_EVENTS = [
  {
    id: 'chuseok',
    from: 901,
    to: 1015,
    title: '🌾 벌초·성묘·가을 산행철이에요',
    desc:
      '풀밭·산소 주변은 진드기와 말벌이 가장 많은 시기예요. 긴 옷·기피제를 챙기고, 벌집을 보면 직접 건드리지 말고 119에 신고하세요. 귀가 후엔 바로 샤워하고, 2주 안에 열이 나면 병원에 야외활동 사실을 꼭 알리세요.',
  },
  {
    id: 'lovebug-peak',
    from: 610,
    to: 715,
    title: '🐞 러브버그 대발생 시기예요',
    desc:
      '6월 중순~7월 초가 절정이고 7월 중순이면 대부분 사라져요. 사람을 물지 않는 익충이니, 옷에 붙으면 털어내고 물로 씻어내면 돼요.',
  },
];

function currentSeasonEvent(date = new Date()) {
  const key = (date.getMonth() + 1) * 100 + date.getDate();
  return SEASON_EVENTS.find((e) => key >= e.from && key <= e.to) ?? null;
}

// 날씨 라벨 → 이모지 (홈 3일 스트립)
const WEATHER_EMOJI = { 비: '🌧️', '비/눈': '🌨️', 눈: '❄️', 흐림: '☁️', '구름 많음': '⛅', 맑음: '☀️' };

// 3일 스트립의 날짜 라벨: 'YYYYMMDD' → 오늘/내일(수)/모레(목). 폴백 라벨('오늘' 등)은 그대로.
function stripDayLabel(day, index) {
  const names = ['오늘', '내일', '모레'];
  if (!/^\d{8}$/.test(String(day))) return names[index] ?? String(day);
  if (index === 0) return '오늘';
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${names[index] ?? `${Number(day.slice(4, 6))}/${Number(day.slice(6, 8))}`}(${wd})`;
}

// 시간별 예보로 '언제 나가면 좋은지' 힌트를 만든다.
// 시간별 조건으로 위험지수를 재계산해 지금보다 눈에 띄게 낮아지는 시각을 찾는다.
// 의미 있는 변화가 없으면 null — 억지 조언을 만들지 않는다(정직 원칙).
function hourlyHint(region, baseRisk, riskFn = getRisk) {
  const hours = region.hourly;
  if (!hours || hours.length < 3) return null;
  if (baseRisk.tone === 'calm') return '☀️ 지금도 나가기 좋은 조건이에요';
  const scored = hours.map((h) => ({
    hour: h.hour,
    date: h.date,
    score: riskFn({ ...region, temp: h.temp, humidity: h.humidity, wind: h.wind, rain: h.rain }).score,
  }));
  const now = scored[0];
  const drop = scored.find((s) => now.score - s.score >= 12);
  if (drop) {
    const when = drop.date !== now.date ? `내일 ${drop.hour}시` : `${drop.hour}시`;
    return `🌙 ${when} 이후엔 잦아들 것으로 보여요 — 외출은 그때 추천`;
  }
  const min = scored.reduce((m, s) => (s.score < m.score ? s : m), scored[0]);
  if (now.score - min.score >= 6) {
    const when = min.date !== now.date ? `내일 ${min.hour}시` : `${min.hour}시`;
    return `🕐 앞으로 24시간 중엔 ${when}쯤이 가장 낮아요`;
  }
  return null;
}

// '왜 오늘 이 지수인가' 근거 칩(최대 3개) — 위험모델 factors에서 실제 기여 요인만 뽑는다.
function whyChips(risk, region) {
  const f = risk.factors;
  const chips = [];
  if (f.rain >= 0.55) chips.push('🌧️ 비 온 뒤 — 우화 최적 조건');
  if (f.humidity >= 0.7) chips.push(`💧 습도 ${region.humidity}% — 활동 최적`);
  else if (f.humidity <= 0.25) chips.push(`🏜️ 습도 ${region.humidity}% — 건조`);
  if (f.wind >= 0.9) chips.push(`🍃 바람 ${region.wind}m/s — 잔잔함`);
  else if (f.wind <= 0.3) chips.push(`💨 바람 ${region.wind}m/s — 비행 어려움`);
  if (f.temp >= 0.9) chips.push(`🌡️ ${region.temp}℃ — 최적 기온`);
  if (f.season >= 1) chips.push('🐞 6월 중순~7월 초 활동 피크');
  else if (f.season <= 0.3) chips.push('📉 활동기가 지나는 중');
  return chips.slice(0, 3);
}

const REGIONS = [
  {
    id: 'eunpyeong',
    name: '은평구',
    zone: '서울 서북권',
    temp: 26,
    humidity: 76,
    rain: 51,
    wind: 1.2,
    reports: 25,
    map: { col: 2, row: 3 },
  },
  {
    id: 'dobong',
    name: '도봉구',
    zone: '서울 동북권',
    temp: 25,
    humidity: 69,
    rain: 34,
    wind: 2,
    reports: 10,
    map: { col: 5, row: 1 },
  },
  {
    id: 'nowon',
    name: '노원구',
    zone: '서울 동북권',
    temp: 26,
    humidity: 71,
    rain: 39,
    wind: 1.8,
    reports: 17,
    map: { col: 6, row: 1 },
  },
  {
    id: 'gangbuk',
    name: '강북구',
    zone: '서울 동북권',
    temp: 25,
    humidity: 72,
    rain: 41,
    wind: 1.7,
    reports: 14,
    map: { col: 4, row: 2 },
  },
  {
    id: 'seongbuk',
    name: '성북구',
    zone: '서울 동북권',
    temp: 26,
    humidity: 68,
    rain: 33,
    wind: 2.1,
    reports: 12,
    map: { col: 5, row: 2 },
  },
  {
    id: 'jongno',
    name: '종로구',
    zone: '서울 도심권',
    temp: 28,
    humidity: 64,
    rain: 30,
    wind: 2.4,
    reports: 9,
    map: { col: 4, row: 3 },
  },
  {
    id: 'dongdaemun',
    name: '동대문구',
    zone: '서울 동북권',
    temp: 27,
    humidity: 70,
    rain: 38,
    wind: 1.9,
    reports: 16,
    map: { col: 5, row: 3 },
  },
  {
    id: 'jungnang',
    name: '중랑구',
    zone: '서울 동북권',
    temp: 27,
    humidity: 74,
    rain: 44,
    wind: 1.5,
    reports: 20,
    map: { col: 6, row: 3 },
  },
  {
    id: 'seodaemun',
    name: '서대문구',
    zone: '서울 서북권',
    temp: 27,
    humidity: 73,
    rain: 43,
    wind: 1.6,
    reports: 19,
    map: { col: 3, row: 4 },
  },
  {
    id: 'jung',
    name: '중구',
    zone: '서울 도심권',
    temp: 28,
    humidity: 62,
    rain: 27,
    wind: 2.5,
    reports: 8,
    map: { col: 4, row: 4 },
  },
  {
    id: 'seongdong',
    name: '성동구',
    zone: '서울 동북권',
    temp: 28,
    humidity: 72,
    rain: 41,
    wind: 1.7,
    reports: 22,
    map: { col: 5, row: 4 },
  },
  {
    id: 'gwangjin',
    name: '광진구',
    zone: '서울 동부권',
    temp: 28,
    humidity: 75,
    rain: 46,
    wind: 1.5,
    reports: 24,
    map: { col: 6, row: 4 },
  },
  {
    id: 'mapo',
    name: '마포구',
    zone: '서울 서북권',
    temp: 27,
    humidity: 72,
    rain: 42,
    wind: 1.8,
    reports: 18,
    map: { col: 2, row: 5 },
  },
  {
    id: 'yongsan',
    name: '용산구',
    zone: '서울 도심권',
    temp: 28,
    humidity: 66,
    rain: 32,
    wind: 2.2,
    reports: 11,
    map: { col: 4, row: 5 },
  },
  {
    id: 'gangdong',
    name: '강동구',
    zone: '서울 동부권',
    temp: 27,
    humidity: 68,
    rain: 50,
    wind: 1.3,
    reports: 28,
    map: { col: 8, row: 5 },
  },
  {
    id: 'gangseo',
    name: '강서구',
    zone: '서울 서남권',
    temp: 27,
    humidity: 78,
    rain: 55,
    wind: 1.4,
    reports: 30,
    map: { col: 1, row: 6 },
  },
  {
    id: 'yangcheon',
    name: '양천구',
    zone: '서울 서남권',
    temp: 27,
    humidity: 74,
    rain: 45,
    wind: 1.7,
    reports: 21,
    map: { col: 2, row: 6 },
  },
  {
    id: 'yeongdeungpo',
    name: '영등포구',
    zone: '서울 서남권',
    temp: 28,
    humidity: 71,
    rain: 40,
    wind: 1.9,
    reports: 18,
    map: { col: 3, row: 6 },
  },
  {
    id: 'dongjak',
    name: '동작구',
    zone: '서울 서남권',
    temp: 27,
    humidity: 70,
    rain: 37,
    wind: 2,
    reports: 15,
    map: { col: 4, row: 6 },
  },
  {
    id: 'seocho',
    name: '서초구',
    zone: '서울 동남권',
    temp: 29,
    humidity: 67,
    rain: 34,
    wind: 2.1,
    reports: 14,
    map: { col: 5, row: 6 },
  },
  {
    id: 'gangnam',
    name: '강남구',
    zone: '서울 동남권',
    temp: 29,
    humidity: 68,
    rain: 36,
    wind: 2,
    reports: 17,
    map: { col: 6, row: 6 },
  },
  {
    id: 'songpa',
    name: '송파구',
    zone: '서울 동남권',
    temp: 27,
    humidity: 68,
    rain: 49,
    wind: 1.4,
    reports: 29,
    map: { col: 7, row: 6 },
  },
  {
    id: 'guro',
    name: '구로구',
    zone: '서울 서남권',
    temp: 27,
    humidity: 73,
    rain: 42,
    wind: 1.8,
    reports: 19,
    map: { col: 2, row: 7 },
  },
  {
    id: 'geumcheon',
    name: '금천구',
    zone: '서울 서남권',
    temp: 27,
    humidity: 69,
    rain: 35,
    wind: 2.2,
    reports: 12,
    map: { col: 3, row: 7 },
  },
  {
    id: 'gwanak',
    name: '관악구',
    zone: '서울 서남권',
    temp: 26,
    humidity: 72,
    rain: 40,
    wind: 1.9,
    reports: 16,
    map: { col: 4, row: 7 },
  },
  // ── 수도권 확장(2026-09) — 러브버그 진앙지로 지목된 경기 서부·인천.
  // 서울 AI지도·행정동 GeoJSON은 서울 전용이라 이 지역은 지도 대신 목록·예보로 제공한다.
  {
    id: 'goyang',
    name: '고양시',
    zone: '경기 서북',
    temp: 25,
    humidity: 74,
    rain: 48,
    wind: 1.4,
    reports: 22,
  },
  {
    id: 'bucheon',
    name: '부천시',
    zone: '경기 서부',
    temp: 26,
    humidity: 72,
    rain: 45,
    wind: 1.6,
    reports: 20,
  },
  {
    id: 'gyeyang',
    name: '인천 계양구',
    zone: '인천 동북',
    temp: 25,
    humidity: 73,
    rain: 46,
    wind: 1.8,
    reports: 18,
  },
  {
    id: 'gwangmyeong',
    name: '광명시',
    zone: '경기 서남',
    temp: 26,
    humidity: 71,
    rain: 44,
    wind: 1.6,
    reports: 14,
  },
  {
    id: 'gimpo',
    name: '김포시',
    zone: '경기 서부',
    temp: 25,
    humidity: 75,
    rain: 47,
    wind: 2.0,
    reports: 12,
  },
  {
    id: 'incheonseo',
    name: '인천 서구',
    zone: '인천 서부',
    temp: 25,
    humidity: 74,
    rain: 45,
    wind: 2.2,
    reports: 10,
  },
];

const DISTRICT_DONGS = {
  goyang: ['행신동', '화정동', '원흥동', '능곡동', '주교동', '창릉동', '일산동', '정발산동', '마두동', '백석동', '장항동', '주엽동', '대화동', '탄현동', '송포동'],
  bucheon: ['원미동', '심곡동', '중동', '상동', '역곡동', '소사동', '괴안동', '범박동', '오정동', '신흥동', '성곡동', '대산동'],
  gyeyang: ['계산동', '작전동', '서운동', '효성동', '계양동', '병방동', '임학동'],
  gwangmyeong: ['광명동', '철산동', '하안동', '소하동', '학온동', '일직동'],
  gimpo: ['김포본동', '장기동', '구래동', '마산동', '운양동', '사우동', '풍무동', '고촌읍', '통진읍', '양촌읍'],
  incheonseo: ['청라동', '검단동', '가정동', '석남동', '검암동', '연희동', '당하동', '원당동', '불로동'],
  eunpyeong: ['녹번동', '불광1동', '불광2동', '갈현1동', '갈현2동', '구산동', '대조동', '응암1동', '응암2동', '응암3동', '역촌동', '신사1동', '신사2동', '증산동', '수색동', '진관동'],
  dobong: ['쌍문1동', '쌍문2동', '쌍문3동', '쌍문4동', '방학1동', '방학2동', '방학3동', '창1동', '창2동', '창3동', '창4동', '창5동', '도봉1동', '도봉2동'],
  nowon: ['월계1동', '월계2동', '월계3동', '공릉1동', '공릉2동', '하계1동', '하계2동', '중계본동', '중계1동', '중계2,3동', '중계4동', '상계1동', '상계2동', '상계3,4동', '상계5동', '상계6,7동', '상계8동', '상계9동', '상계10동'],
  gangbuk: ['삼양동', '미아동', '송중동', '송천동', '삼각산동', '번1동', '번2동', '번3동', '수유1동', '수유2동', '수유3동', '우이동', '인수동'],
  seongbuk: ['성북동', '삼선동', '동선동', '돈암1동', '돈암2동', '안암동', '보문동', '정릉1동', '정릉2동', '정릉3동', '정릉4동', '길음1동', '길음2동', '종암동', '월곡1동', '월곡2동', '장위1동', '장위2동', '장위3동', '석관동'],
  jongno: ['청운효자동', '사직동', '삼청동', '부암동', '평창동', '무악동', '교남동', '가회동', '종로1.2.3.4가동', '종로5.6가동', '이화동', '혜화동', '창신1동', '창신2동', '창신3동', '숭인1동', '숭인2동'],
  dongdaemun: ['신설동', '용두동', '제기동', '전농1동', '전농2동', '답십리1동', '답십리2동', '장안1동', '장안2동', '청량리동', '회기동', '휘경1동', '휘경2동', '이문1동', '이문2동'],
  jungnang: ['면목본동', '면목2동', '면목3.8동', '면목4동', '면목5동', '면목7동', '상봉1동', '상봉2동', '중화1동', '중화2동', '묵1동', '묵2동', '망우본동', '망우3동', '신내1동', '신내2동'],
  seodaemun: ['충현동', '천연동', '북아현동', '신촌동', '연희동', '홍제1동', '홍제2동', '홍제3동', '홍은1동', '홍은2동', '남가좌1동', '남가좌2동', '북가좌1동', '북가좌2동'],
  jung: ['소공동', '회현동', '명동', '필동', '장충동', '광희동', '을지로동', '신당동', '다산동', '약수동', '청구동', '신당5동', '동화동', '황학동', '중림동'],
  seongdong: ['왕십리2동', '왕십리도선동', '마장동', '사근동', '행당1동', '행당2동', '응봉동', '금호1가동', '금호2,3가동', '금호4가동', '옥수동', '성수1가1동', '성수1가2동', '성수2가1동', '성수2가3동', '송정동', '용답동'],
  gwangjin: ['중곡1동', '중곡2동', '중곡3동', '중곡4동', '능동', '구의1동', '구의2동', '구의3동', '광장동', '자양1동', '자양2동', '자양3동', '자양4동', '화양동', '군자동'],
  mapo: ['아현동', '공덕동', '도화동', '용강동', '대흥동', '염리동', '신수동', '서강동', '서교동', '합정동', '망원1동', '망원2동', '연남동', '성산1동', '성산2동', '상암동'],
  yongsan: ['후암동', '용산2가동', '남영동', '청파동', '원효로1동', '원효로2동', '효창동', '용문동', '한강로동', '이촌1동', '이촌2동', '이태원1동', '이태원2동', '한남동', '서빙고동', '보광동'],
  gangdong: ['강일동', '상일1동', '상일2동', '명일1동', '명일2동', '고덕1동', '고덕2동', '암사1동', '암사2동', '암사3동', '천호1동', '천호2동', '천호3동', '성내1동', '성내2동', '성내3동', '길동', '둔촌1동', '둔촌2동'],
  gangseo: ['염창동', '등촌1동', '등촌2동', '등촌3동', '화곡본동', '화곡1동', '화곡2동', '화곡3동', '화곡4동', '화곡6동', '화곡8동', '우장산동', '가양1동', '가양2동', '가양3동', '발산1동', '공항동', '방화1동', '방화2동', '방화3동'],
  yangcheon: ['목1동', '목2동', '목3동', '목4동', '목5동', '신월1동', '신월2동', '신월3동', '신월4동', '신월5동', '신월6동', '신월7동', '신정1동', '신정2동', '신정3동', '신정4동', '신정6동', '신정7동'],
  yeongdeungpo: ['영등포본동', '영등포동', '여의동', '당산1동', '당산2동', '도림동', '문래동', '양평1동', '양평2동', '신길1동', '신길3동', '신길4동', '신길5동', '신길6동', '신길7동', '대림1동', '대림2동', '대림3동'],
  dongjak: ['노량진1동', '노량진2동', '상도1동', '상도2동', '상도3동', '상도4동', '흑석동', '사당1동', '사당2동', '사당3동', '사당4동', '사당5동', '대방동', '신대방1동', '신대방2동'],
  seocho: ['서초1동', '서초2동', '서초3동', '서초4동', '잠원동', '반포본동', '반포1동', '반포2동', '반포3동', '반포4동', '방배본동', '방배1동', '방배2동', '방배3동', '방배4동', '양재1동', '양재2동', '내곡동'],
  gangnam: ['신사동', '논현1동', '논현2동', '압구정동', '청담동', '삼성1동', '삼성2동', '대치1동', '대치2동', '대치4동', '역삼1동', '역삼2동', '도곡1동', '도곡2동', '개포1동', '개포2동', '개포3동', '개포4동', '일원본동', '일원1동', '수서동', '세곡동'],
  songpa: ['풍납1동', '풍납2동', '거여1동', '거여2동', '마천1동', '마천2동', '방이1동', '방이2동', '오륜동', '오금동', '송파1동', '송파2동', '석촌동', '삼전동', '가락본동', '가락1동', '가락2동', '문정1동', '문정2동', '장지동', '위례동', '잠실본동', '잠실2동', '잠실3동', '잠실4동', '잠실6동', '잠실7동'],
  guro: ['신도림동', '구로1동', '구로2동', '구로3동', '구로4동', '구로5동', '가리봉동', '고척1동', '고척2동', '개봉1동', '개봉2동', '개봉3동', '오류1동', '오류2동', '항동', '수궁동'],
  geumcheon: ['가산동', '독산1동', '독산2동', '독산3동', '독산4동', '시흥1동', '시흥2동', '시흥3동', '시흥4동', '시흥5동'],
  gwanak: ['은천동', '성현동', '청룡동', '보라매동', '청림동', '행운동', '낙성대동', '중앙동', '인헌동', '남현동', '서원동', '신원동', '서림동', '난곡동', '신사동', '신림동', '삼성동', '난향동', '조원동', '대학동', '미성동'],
};

// 실예보(daily) 로드 전에만 쓰는 대체 오프셋 — 기상청 단기예보가 오면 실측 3일로 대체된다.
const FORECAST_OFFSETS = [
  { day: '오늘', temp: 0, humidity: 0, rain: 0, reports: 0, weather: '습도 관찰' },
  { day: '내일', temp: -1, humidity: 2, rain: 5, reports: 1, weather: '흐림' },
  { day: '모레', temp: 1, humidity: 6, rain: 12, reports: 2, weather: '비 뒤 갬' },
];

// 야외활동 장소별 러브버그 위험 — 나들이·런닝·자전거 타는 사람 기준
const HOTSPOTS = [
  { icon: '🌊', place: '한강공원·하천변', level: '🔴 많음', why: '물가의 습한 풀숲이라 러브버그가 가장 많이 모여요.', tip: '돗자리는 물에서 떨어진 트인 잔디에. 밝은 색 옷·텐트는 피해요.' },
  { icon: '⛰️', place: '산 둘레길·숲길', level: '🔴 많음', why: '러브버그 발생원인 산자락이라 떼로 날아다녀요.', tip: '북한산·관악산 자락은 한낮·해질녘을 피하고 버프로 얼굴을 가려요.' },
  { icon: '🚴', place: '자전거길(한강·안양천)', level: '🟠 주의', why: '하천변 자전거 도로는 물가라 달릴 때 얼굴에 부딪혀요.', tip: '고글·버프 착용, 빨라도 입은 다물기. 옷에 붙으면 물로 씻어내요.' },
  { icon: '🌳', place: '도심 공원', level: '🟡 보통', why: '물·산과 멀면 비교적 적지만 저녁 조명 주변은 모여요.', tip: '조명 켜진 정자·벤치보다 트인 잔디밭이 나아요.' },
  { icon: '🏟️', place: '운동장·아파트 단지', level: '🟡 보통', why: '밝은 외벽·운동장 조명에 끌려 몰려요.', tip: '형광·흰색 운동복은 더 꼬여요. 저녁 조명 옆은 피해요.' },
];

// 활동별 대비 팁
const ACTIVITY_TIPS = [
  { icon: '🏃', title: '러닝', detail: '러브버그는 한낮~해질녘에 가장 활발해요. 이른 아침이 벌레가 가장 적어요. 형광·밝은 운동복은 빛에 끌려 더 꼬이니 어두운 색이 나아요. 저녁엔 가로등·조명 주변을 피하세요.' },
  { icon: '🚴', title: '자전거', detail: '하천변 코스는 떼로 부딪혀요. 고글·버프로 눈·입을 막고, 속도 낼 땐 특히 입을 다물어요. 붙은 건 문지르지 말고 물로 씻어내요.' },
  { icon: '👨‍👩‍👧', title: '나들이·소풍', detail: '돗자리는 물가·풀숲·조명에서 떨어진 트인 곳에. 밝은 색 텐트·옷은 더 모여요. 음식은 덮어두고, 저녁 랜턴은 자리에서 떨어뜨려 둬요.' },
];

const ACTION_GUIDES = [
  { icon: '💡', title: '조명 낮추기', detail: '저녁 시간에는 현관, 베란다, 교실 창가 조명을 필요한 만큼만 켜요.' },
  { icon: '🪟', title: '방충망 확인', detail: '창문 틈, 방충망 찢어진 곳, 배수구 주변을 먼저 확인해요.' },
  { icon: '🚿', title: '물청소 우선', detail: '차량이나 창문에 붙었을 때는 오래 문지르기보다 물로 씻어내요.' },
  { icon: '🏫', title: '학교 주변 점검', detail: '운동장 조명, 급식실 출입구, 쓰레기장 주변을 하교 전후로 살펴요.' },
];

// 출몰 곤충 도감 — good:true 이로운 곤충(익충) / false 주의해야 할 곤충
const BUGS = [
  {
    icon: '🪲', name: '러브버그', sub: '붉은등우단털파리', good: true, tag: '익충',
    desc: '애벌레는 낙엽과 흙을 분해해 땅을 기름지게 하고, 어른벌레는 꽃가루받이를 도와요. 독이 없고 병도 옮기지 않아요.',
    tip: '사람을 물지 않아요. 2주쯤이면 자연히 사라지니, 징그러워도 죽이지 말고 기다려 주세요. 차나 옷에 붙으면 굳기 전에 물로 씻어내요.',
  },
  {
    icon: '🦋', name: '동양하루살이', sub: '팅커벨', good: true, tag: '무해',
    desc: '한강변(송파·강동·암사)에서 5~6월에 떼로 나타나요. 큰 날개에 긴 꼬리가 우아해 "팅커벨"이라 불려요. 입이 퇴화해 물지도 먹지도 못하고 며칠 살다 가요.',
    tip: '사람을 물거나 병을 옮기지 않아요. 깨끗한 2급수에만 살아서, 오히려 한강이 맑아졌다는 신호예요. 밤 불빛에 모이니 창문·조명만 관리하면 돼요.',
  },
  {
    icon: '🐞', name: '무당벌레', good: true, tag: '익충',
    desc: '하루에 진딧물 수십 마리를 잡아먹는 농사 친구예요. 텃밭과 화단을 지켜줘요.',
    tip: '손에 올라와도 해롭지 않아요. 그대로 두면 해충을 알아서 줄여줍니다.',
  },
  {
    icon: '🐝', name: '꿀벌', good: true, tag: '익충',
    desc: '꽃가루를 옮겨 열매와 채소가 맺히게 하는 고마운 곤충이에요. 먼저 건드리지 않으면 쏘지 않아요.',
    tip: '주변을 날아도 손을 휘젓지 말고 가만히 있다가 천천히 자리를 옮겨요. 벌집은 직접 건드리지 말고 어른이나 전문가에게 알려요.',
  },
  {
    icon: '🦋', name: '나비', good: true, tag: '익충',
    desc: '꿀벌과 함께 꽃가루받이를 돕는 곤충이에요. 깨끗한 환경일수록 잘 보여요.',
    tip: '물거나 쏘지 않아요. 손으로 잡으면 날개 가루가 상하니 눈으로만 구경해요.',
  },
  {
    icon: '🦗', name: '잠자리', good: true, tag: '익충',
    desc: '모기와 작은 날벌레를 잡아먹는 하늘의 사냥꾼이에요. 잠자리가 많다는 건 물가가 건강하다는 뜻이기도 해요.',
    tip: '사람을 물지 않아요. 가까이 와도 놀라지 말고 지나가게 두면 돼요.',
  },
  {
    icon: '🦋', name: '나방', good: true, tag: '무해',
    desc: '대부분의 나방은 물거나 쏘지 않아요. 밤에 꽃가루받이를 돕고 새·박쥐의 먹이가 되는 생태계 일꾼이에요. 빛에 모이는 습성이 있어요.',
    tip: '성충은 손대도 해롭지 않아요. 단, 털 달린 애벌레(쐐기·독나방 애벌레)는 독털이 있어 만지면 따갑고 발진이 나니 눈으로만 보세요.',
  },
  {
    icon: '🦟', name: '모기', good: false, tag: '해충',
    desc: '피를 빨고 일본뇌염 같은 병을 옮길 수 있어요. 고인 물에 알을 낳아 빠르게 늘어나요. 가을 모기는 11월 초까지 활동하고, 일본뇌염 환자는 9~10월에 가장 많아요.',
    tip: '집 주변 고인 물(화분 받침·빈 그릇)을 비워요. 해질녘부터 밤까지는 긴 옷이나 기피제로 막아요.',
  },
  {
    icon: '🕷️', name: '진드기', good: false, tag: '주의',
    desc: '풀숲에 숨어 피를 빨고, 중증열성혈소판감소증(SFTS)·쯔쯔가무시증 같은 감염병을 옮겨요. SFTS는 백신·치료제가 없어 더 조심해야 하고, 쯔쯔가무시는 10~11월에 가장 많아요.',
    tip: '풀밭에선 긴 옷·양말을 신고 돗자리를 깔아요. 물렸다면 비비지 말고 핀셋으로 천천히 빼낸 뒤 병원에 가요. 벌초·성묘 뒤 2주 안에 열이 나면 야외활동을 했다고 꼭 알려요.',
  },
  {
    icon: '🐝', name: '말벌', good: false, tag: '위험',
    desc: '벌 쏘임 사고의 30%가 9월에 몰려요. 꿀벌과 달리 여러 번 쏠 수 있고, 벌집을 건드리면 떼로 공격해요. 벌초·성묘·산행 때 특히 조심해야 해요.',
    tip: '검은 옷·향수·단 음료를 피해요. 벌집을 보면 절대 건드리지 말고 119에 신고해요. 쏘이면 카드로 침을 긁어내고 차갑게 식히되, 어지럽거나 숨이 차면 바로 119를 불러요.',
  },
  {
    icon: '🌰', name: '갈색여치', good: false, tag: '주의',
    desc: '따뜻한 겨울 뒤 일부 지역에서 갑자기 늘어나는 토종 곤충이에요. 과수·콩 같은 농작물을 갉아먹고, 손으로 잡으면 물 수도 있어요.',
    tip: '맨손으로 잡지 말고 도구를 써요. 농작물 피해가 크면 지자체 농업기술센터에 알려요.',
  },
  {
    icon: '🪰', name: '등에', good: false, tag: '주의',
    desc: '소나 사람의 피를 빠는 곤충이에요. 물리면 따갑고 부어올라요. 한여름 물가나 풀밭에 많아요.',
    tip: '물가·풀밭에선 살갗을 가리고, 물렸다면 깨끗이 씻고 차갑게 식혀요. 가려워도 긁지 말아요.',
  },
  {
    icon: '🐛', name: '깔따구', good: false, tag: '주의',
    desc: '물지는 않지만 떼로 날아다녀 불쾌하고, 사체 가루가 알레르기나 천식을 일으킬 수 있어요. 물이 더러운 곳에 많아요.',
    tip: '저녁 불빛에 모이니 창문과 조명을 관리해요. 떼를 만나면 입과 코를 막고 빠르게 벗어나요.',
  },
];

// 동네별 야외 활동 장소 — 구 id별 대표 장소. env: riverside(물가) / mountain(산자락) / urban(도심)
// 서울 25구 야외 코스 — 3개 자료(코스DB 좌표·종목적합도 / 활동핫스팟 CSV / 동네시드DB 벌레태그)
// 교차검증. env는 벌레 발생 환경(riverside 물가·습지 / mountain 산자락·숲 / urban 도심공원),
// act는 코스DB 종목 적합도(◎○△✕) 반영 — 산·둘레길은 라이딩 제외.
const DISTRICT_PLACES = {
  goyang: [
    { name: '일산호수공원', act: '🚶 산책·러닝', env: 'riverside' },
    { name: '고양 행주산성·한강', act: '🚴 라이딩', env: 'riverside' },
    { name: '북한산 둘레길(효자·사기막)', act: '🚶 산책', env: 'mountain' },
    { name: '고봉산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '창릉천 산책로', act: '🏃 러닝·산책', env: 'riverside' },
    { name: '정발산 근린공원', act: '👶 나들이', env: 'urban' },
    { name: '화정 중앙공원', act: '👶 나들이', env: 'urban' },
  ],
  bucheon: [
    { name: '원미산 진달래동산', act: '🚶 산책', env: 'mountain' },
    { name: '성주산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '부천중앙공원', act: '👶 나들이', env: 'urban' },
    { name: '굴포천 산책로', act: '🏃 러닝·산책', env: 'riverside' },
    { name: '상동호수공원', act: '🚶 산책', env: 'riverside' },
    { name: '도당산 벚꽃길', act: '🚶 산책', env: 'mountain' },
  ],
  gyeyang: [
    { name: '계양산 둘레길', act: '🚶 산책·등산', env: 'mountain' },
    { name: '굴포천 생태하천', act: '🏃 러닝·산책', env: 'riverside' },
    { name: '경인아라뱃길 자전거길', act: '🚴 라이딩', env: 'riverside' },
    { name: '계양체육공원', act: '👶 나들이', env: 'urban' },
    { name: '천마산 산책로', act: '🚶 산책', env: 'mountain' },
  ],
  gwangmyeong: [
    { name: '안양천 자전거길', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '도덕산공원', act: '🚶 산책', env: 'mountain' },
    { name: '구름산 둘레길', act: '🚶 산책·등산', env: 'mountain' },
    { name: '광명동굴 주변', act: '👶 나들이', env: 'urban' },
    { name: '목감천 산책로', act: '🏃 러닝·산책', env: 'riverside' },
  ],
  gimpo: [
    { name: '김포한강신도시 수변공원', act: '🚶 산책', env: 'riverside' },
    { name: '아라마루 아라뱃길', act: '🚴 라이딩', env: 'riverside' },
    { name: '문수산성 둘레길', act: '🚶 산책·등산', env: 'mountain' },
    { name: '라베니체 수변', act: '👶 나들이', env: 'riverside' },
    { name: '장릉산 산책로', act: '🚶 산책', env: 'mountain' },
  ],
  incheonseo: [
    { name: '청라호수공원', act: '🚶 산책·러닝', env: 'riverside' },
    { name: '경인아라뱃길(정서진)', act: '🚴 라이딩', env: 'riverside' },
    { name: '검단산 근린공원', act: '🚶 산책', env: 'mountain' },
    { name: '청라 커널웨이', act: '🚶 산책', env: 'riverside' },
    { name: '서구 중앙공원', act: '👶 나들이', env: 'urban' },
  ],
  gangseo: [
    { name: '강서 한강공원·가양', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '마곡나루 수변', act: '🚶 산책', env: 'riverside' },
    { name: '안양천 하류', act: '🚴 라이딩', env: 'riverside' },
    { name: '아라뱃길 갑문', act: '🚴 라이딩', env: 'riverside' },
    { name: '개화산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '우장산공원', act: '🚶 산책', env: 'mountain' },
    { name: '봉제산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '구암공원', act: '🚶 산책', env: 'urban' },
    { name: '허준공원', act: '🚶 산책', env: 'urban' },
    { name: '서울식물원', act: '👶 나들이', env: 'urban' },
  ],
  yangcheon: [
    { name: '안양천 산책로', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '용왕산', act: '🚶 산책', env: 'mountain' },
    { name: '지양산', act: '🚶 산책', env: 'mountain' },
    { name: '갈산공원', act: '🚶 산책', env: 'urban' },
    { name: '계남근린공원', act: '🚶 산책', env: 'urban' },
    { name: '서서울호수공원', act: '👶 나들이', env: 'urban' },
    { name: '파리공원', act: '🚶 산책', env: 'urban' },
    { name: '오목공원', act: '👶 나들이', env: 'urban' },
  ],
  guro: [
    { name: '안양천 자전거길', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '도림천 산책로', act: '🚶 산책', env: 'riverside' },
    { name: '오류천', act: '🚶 산책', env: 'riverside' },
    { name: '천왕산·개웅산', act: '🚶 산책', env: 'mountain' },
    { name: '항동철길', act: '🚶 산책', env: 'urban' },
    { name: '구로올레길', act: '🚶 산책', env: 'urban' },
    { name: '항동 푸른수목원', act: '👶 나들이', env: 'urban' },
    { name: '고척근린공원', act: '🚶 산책', env: 'urban' },
  ],
  geumcheon: [
    { name: '안양천 산책로', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '금천한내', act: '🚶 산책', env: 'riverside' },
    { name: '호암산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '시흥계곡', act: '🚶 산책', env: 'mountain' },
    { name: '금천체육공원', act: '👶 나들이', env: 'urban' },
    { name: '독산근린공원', act: '🚶 산책', env: 'urban' },
  ],
  yeongdeungpo: [
    { name: '여의도 한강공원', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '양화 한강공원', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '샛강생태공원', act: '🚶 산책·나들이', env: 'riverside' },
    { name: '안양천 합류부', act: '🚴 라이딩', env: 'riverside' },
    { name: '도림천', act: '🚶 산책', env: 'riverside' },
    { name: '여의도공원', act: '🏃 러닝·나들이', env: 'urban' },
    { name: '선유도공원', act: '👶 나들이', env: 'urban' },
    { name: '문래근린공원', act: '🚶 산책', env: 'urban' },
  ],
  dongjak: [
    { name: '노들섬·한강', act: '🚴 라이딩·산책', env: 'riverside' },
    { name: '사당천', act: '🚶 산책', env: 'riverside' },
    { name: '도림천', act: '🚴 라이딩', env: 'riverside' },
    { name: '서달산·현충원 둘레', act: '🚶 산책', env: 'mountain' },
    { name: '국사봉·상도근린공원', act: '🚶 산책', env: 'mountain' },
    { name: '관악산 자락', act: '🚶 산책', env: 'mountain' },
    { name: '까치산', act: '🚶 산책', env: 'mountain' },
    { name: '국립현충원', act: '👶 나들이', env: 'urban' },
    { name: '보라매공원', act: '🏃 러닝·나들이', env: 'urban' },
    { name: '사육신공원', act: '🚶 산책', env: 'urban' },
  ],
  gwanak: [
    { name: '도림천 산책로', act: '🏃 러닝·라이딩', env: 'riverside' },
    { name: '관악산 자락길', act: '🚶 산책', env: 'mountain' },
    { name: '삼성산 자락', act: '🚶 산책', env: 'mountain' },
    { name: '청룡산', act: '🚶 산책', env: 'mountain' },
    { name: '낙성대공원', act: '🚶 산책', env: 'urban' },
    { name: '보라매공원', act: '🏃 러닝·나들이', env: 'urban' },
  ],
  seocho: [
    { name: '반포 한강공원', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '잠원 한강공원', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '양재천 산책로', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '탄천', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '여의천', act: '🚶 산책', env: 'riverside' },
    { name: '반포천', act: '🚶 산책', env: 'riverside' },
    { name: '서래섬', act: '🚶 산책', env: 'riverside' },
    { name: '우면산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '청계산 자락', act: '🚶 산책', env: 'mountain' },
    { name: '서리풀공원', act: '🚶 산책', env: 'mountain' },
    { name: '몽마르뜨공원', act: '🚶 산책', env: 'urban' },
    { name: '양재시민의숲', act: '👶 나들이', env: 'urban' },
  ],
  gangnam: [
    { name: '양재천 산책로', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '탄천 자전거길', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '압구정·청담 한강', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '대모산·구룡산 숲길', act: '🚶 산책', env: 'mountain' },
    { name: '선정릉', act: '👶 나들이', env: 'urban' },
    { name: '청담근린공원', act: '🚶 산책', env: 'urban' },
    { name: '도산공원', act: '🚶 산책', env: 'urban' },
  ],
  songpa: [
    { name: '잠실 한강공원', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '탄천 자전거길', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '송파둘레길', act: '🏃 러닝·산책', env: 'riverside' },
    { name: '성내천', act: '🚶 산책', env: 'riverside' },
    { name: '장지천', act: '🚶 산책', env: 'riverside' },
    { name: '남한산성 자락', act: '🚶 산책', env: 'mountain' },
    { name: '석촌호수', act: '🚶 산책·나들이', env: 'urban' },
    { name: '올림픽공원', act: '👶 나들이', env: 'urban' },
  ],
  gangdong: [
    { name: '광나루 한강공원·암사', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '고덕천·고덕수변생태공원', act: '🚶 산책', env: 'riverside' },
    { name: '암사생태공원', act: '👶 나들이', env: 'riverside' },
    { name: '길동생태공원', act: '🚶 산책', env: 'riverside' },
    { name: '둔촌습지', act: '🚶 산책', env: 'riverside' },
    { name: '성내천', act: '🚶 산책', env: 'riverside' },
    { name: '일자산·강동그린웨이', act: '🚴 라이딩·산책', env: 'mountain' },
    { name: '고덕산', act: '🚶 산책', env: 'mountain' },
  ],
  gwangjin: [
    { name: '뚝섬 한강공원', act: '🏃 러닝·라이딩', env: 'riverside' },
    { name: '자양·광나루 한강', act: '🚴 라이딩', env: 'riverside' },
    { name: '중랑천', act: '🚴 라이딩', env: 'riverside' },
    { name: '아차산 생태공원·둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '용마산', act: '🚶 산책', env: 'mountain' },
    { name: '어린이대공원', act: '👶 나들이', env: 'urban' },
  ],
  seongdong: [
    { name: '성수·뚝섬 한강', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '중랑천', act: '🚴 라이딩', env: 'riverside' },
    { name: '청계천 하류', act: '🚶 산책', env: 'riverside' },
    { name: '살곶이체육공원', act: '🚴 라이딩', env: 'riverside' },
    { name: '응봉산', act: '🚶 산책', env: 'mountain' },
    { name: '서울숲', act: '🏃 러닝·나들이', env: 'urban' },
  ],
  jungnang: [
    { name: '중랑천 자전거길', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '묵동천', act: '🚶 산책', env: 'riverside' },
    { name: '용마산·망우산 사색의길', act: '🚶 산책', env: 'mountain' },
    { name: '봉화산', act: '🚶 산책', env: 'mountain' },
    { name: '용마폭포공원', act: '👶 나들이', env: 'mountain' },
    { name: '신내근린공원', act: '🚶 산책', env: 'urban' },
    { name: '망우역사문화공원', act: '🚶 산책', env: 'urban' },
    { name: '중랑캠핑숲', act: '👶 나들이', env: 'urban' },
  ],
  dongdaemun: [
    { name: '중랑천 산책로', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '청계천·정릉천', act: '🚶 산책', env: 'riverside' },
    { name: '장안벚꽃길', act: '🚶 산책', env: 'riverside' },
    { name: '배봉산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '홍릉숲', act: '👶 나들이', env: 'mountain' },
    { name: '홍릉 두물길', act: '🚶 산책', env: 'riverside' },
    { name: '홍릉수목원', act: '👶 나들이', env: 'urban' },
  ],
  seongbuk: [
    { name: '정릉천 산책로', act: '🏃 러닝·산책', env: 'riverside' },
    { name: '성북천 산책로', act: '🚶 산책', env: 'riverside' },
    { name: '우이천', act: '🚶 산책', env: 'riverside' },
    { name: '청계천 상류', act: '🚶 산책', env: 'riverside' },
    { name: '북한산 정릉계곡·둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '개운산', act: '🚶 산책', env: 'mountain' },
    { name: '월곡산', act: '🚶 산책', env: 'mountain' },
    { name: '낙산 성곽길', act: '🚶 산책', env: 'mountain' },
    { name: '북서울꿈의숲', act: '👶 나들이', env: 'urban' },
    { name: '오동근린공원', act: '🚶 산책', env: 'urban' },
  ],
  jongno: [
    { name: '청계천 상류', act: '🏃 러닝·산책', env: 'riverside' },
    { name: '인왕산 자락길', act: '🚶 산책', env: 'mountain' },
    { name: '낙산공원 성곽길', act: '🚶 산책', env: 'mountain' },
    { name: '북악산 자락', act: '🚶 산책', env: 'mountain' },
    { name: '수성동계곡', act: '🚶 산책', env: 'mountain' },
    { name: '삼청공원', act: '👶 나들이', env: 'urban' },
    { name: '북촌한옥마을', act: '🚶 산책', env: 'urban' },
  ],
  jung: [
    { name: '남산공원 순환로', act: '🏃 산책·러닝', env: 'mountain' },
    { name: '청계천', act: '🚶 산책', env: 'riverside' },
    { name: '장충단공원', act: '👶 나들이', env: 'urban' },
    { name: '서울로7017', act: '🚶 산책', env: 'urban' },
    { name: '덕수궁 돌담길', act: '🚶 산책', env: 'urban' },
    { name: '남산골한옥마을', act: '🚶 산책', env: 'urban' },
    { name: '손기정공원', act: '🚶 산책', env: 'urban' },
    { name: '동대문디자인플라자', act: '🚶 산책', env: 'urban' },
  ],
  yongsan: [
    { name: '이촌 한강공원', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '남산공원 남측순환로', act: '🚶 산책', env: 'mountain' },
    { name: '한남·이태원 언덕길', act: '🚶 산책', env: 'mountain' },
    { name: '한남근린공원', act: '🚶 산책', env: 'mountain' },
    { name: '용산가족공원', act: '👶 나들이', env: 'urban' },
    { name: '효창공원', act: '🚶 산책', env: 'urban' },
    { name: '국립중앙박물관 뜰', act: '👶 나들이', env: 'urban' },
    { name: '경의선숲길', act: '🚶 산책', env: 'urban' },
  ],
  seodaemun: [
    { name: '홍제천 산책로', act: '🏃 러닝·산책', env: 'riverside' },
    { name: '안산 자락길', act: '🚶 산책', env: 'mountain' },
    { name: '백련산', act: '🚶 산책', env: 'mountain' },
    { name: '서대문독립공원', act: '👶 나들이', env: 'urban' },
    { name: '경의선숲길', act: '🚶 산책', env: 'urban' },
    { name: '연희숲속쉼터', act: '🚶 산책', env: 'urban' },
  ],
  mapo: [
    { name: '망원 한강공원', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '난지 한강공원', act: '🚴 라이딩', env: 'riverside' },
    { name: '불광천·홍제천', act: '🚶 산책', env: 'riverside' },
    { name: '난지천공원', act: '🚶 산책', env: 'riverside' },
    { name: '월드컵공원·하늘공원', act: '👶 나들이', env: 'urban' },
    { name: '노을공원', act: '👶 나들이', env: 'urban' },
    { name: '경의선숲길', act: '🚶 산책·러닝', env: 'urban' },
    { name: '절두산·양화진', act: '🚶 산책', env: 'urban' },
  ],
  eunpyeong: [
    { name: '불광천 산책로', act: '🏃 러닝·산책', env: 'riverside' },
    { name: '북한산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '봉산 편백숲길', act: '🚶 산책', env: 'mountain' },
    { name: '앵봉산', act: '🚶 산책', env: 'mountain' },
    { name: '북한산생태공원', act: '🚶 산책', env: 'mountain' },
    { name: '북한산성 계곡', act: '🚶 산책', env: 'mountain' },
    { name: '은평한옥마을·진관', act: '👶 나들이', env: 'urban' },
  ],
  gangbuk: [
    { name: '우이천 산책로', act: '🏃 러닝·산책', env: 'riverside' },
    { name: '중랑천', act: '🚴 라이딩', env: 'riverside' },
    { name: '북한산 둘레길·우이령', act: '🚶 산책', env: 'mountain' },
    { name: '삼각산 자락', act: '🚶 산책', env: 'mountain' },
    { name: '북서울꿈의숲', act: '👶 나들이', env: 'urban' },
    { name: '오동근린공원', act: '🚶 산책', env: 'urban' },
    { name: '솔밭공원', act: '🚶 산책', env: 'urban' },
    { name: '4·19민주묘지 둘레', act: '🚶 산책', env: 'urban' },
  ],
  dobong: [
    { name: '중랑천 자전거길', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '우이천', act: '🚶 산책', env: 'riverside' },
    { name: '방학천', act: '🚶 산책', env: 'riverside' },
    { name: '도봉산·서울둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '초안산', act: '🚶 산책', env: 'mountain' },
    { name: '서울창포원', act: '👶 나들이', env: 'urban' },
    { name: '둘리뮤지엄 주변', act: '🚶 산책', env: 'urban' },
  ],
  nowon: [
    { name: '중랑천·당현천', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '우이천', act: '🚶 산책', env: 'riverside' },
    { name: '묵동천', act: '🚶 산책', env: 'riverside' },
    { name: '불암산·수락산 자락', act: '🚶 산책', env: 'mountain' },
    { name: '초안산', act: '🚶 산책', env: 'mountain' },
    { name: '경춘선숲길', act: '🚴 산책·라이딩', env: 'urban' },
    { name: '화랑대 철도공원', act: '👶 나들이', env: 'urban' },
    { name: '중계근린공원', act: '🚶 산책', env: 'urban' },
  ],
};

// 장소 환경별 러브버그 가중 — 물가·산자락은 발생원이라 구 지수에 가산, 도심은 감산
const PLACE_ENV = {
  riverside: { label: '물가', adj: 8 },
  mountain: { label: '산자락', adj: 5 },
  urban: { label: '도심', adj: -10 },
};

// 구 지수(0~100)에 장소 환경 보정을 더해 장소별 위험 산출(risk.js band와 동일 기준)
function getPlaceRisk(regionScore, env) {
  const score = Math.max(0, Math.min(100, regionScore + (PLACE_ENV[env]?.adj ?? 0)));
  if (score >= 75) return { score, tone: 'danger', label: '매우 높음' };
  if (score >= 55) return { score, tone: 'warning', label: '높음' };
  if (score >= 35) return { score, tone: 'notice', label: '보통' };
  return { score, tone: 'calm', label: '낮음' };
}

// 위험도별 추천 시간 안내
function placeTimeAdvice(tone) {
  if (tone === 'danger') return '오늘은 실내나 다른 날을 권해요. 굳이 간다면 해 뜬 직후 이른 아침(6~8시)이 벌레가 가장 적어요.';
  if (tone === 'warning') return '한낮~해질녘에 가장 많아요. 이른 아침(6~8시)이 제일 적고, 저녁 조명 주변은 빛에 꼬이니 특히 피하세요.';
  if (tone === 'notice') return '이른 아침이 가장 좋아요. 해질녘과 저녁 조명 주변만 피하면 무난해요.';
  return '오늘은 다녀오기 좋아요. 그래도 저녁 조명 주변은 살짝 주의하세요.';
}

// 홈 카드용 한 줄 요약 조언(자세한 문장은 placeTimeAdvice — 장소 탭에서 사용)
function shortPlaceAdvice(tone) {
  if (tone === 'danger') return '오늘은 피하는 게 좋아요';
  if (tone === 'warning') return '이른 아침(6~8시) 추천';
  if (tone === 'notice') return '아침이 가장 무난해요';
  return '다녀오기 좋아요';
}

// 하단 탭 4개. 홈은 원스크롤이라 세그먼트 없음(forecast·spots는 홈 안 링크로 진입,
// 하단 '홈'을 다시 누르면 segs[0]=main으로 복귀). 가이드만 세그먼트 유지(showSegs).
const TAB_GROUPS = [
  {
    id: 'home',
    label: '홈',
    icon: '🏠',
    segs: [
      { id: 'main', label: '홈' },
      { id: 'forecast', label: '예보' },
      { id: 'spots', label: '장소' },
    ],
  },
  {
    id: 'mapTab',
    label: '지도',
    icon: '🗺️',
    segs: [{ id: 'map', label: '지도' }],
  },
  {
    id: 'report',
    label: '제보',
    icon: '✍️',
    segs: [{ id: 'report', label: '제보' }],
  },
  {
    id: 'guideGroup',
    label: '가이드',
    icon: '📖',
    showSegs: true,
    segs: [
      { id: 'places', label: '출몰장소' },
      { id: 'bugs', label: '벌레도감' },
      { id: 'guide', label: '행동요령' },
    ],
  },
];

function getGeoBounds(geo) {
  const values = geo.features.flatMap((feature) => flattenCoordinates(feature.geometry.coordinates));
  return values.reduce(
    (bounds, [lon, lat]) => ({
      minLon: Math.min(bounds.minLon, lon),
      maxLon: Math.max(bounds.maxLon, lon),
      minLat: Math.min(bounds.minLat, lat),
      maxLat: Math.max(bounds.maxLat, lat),
    }),
    { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity }
  );
}

function flattenCoordinates(coordinates) {
  if (typeof coordinates[0][0] === 'number') return coordinates;
  return coordinates.flatMap((item) => flattenCoordinates(item));
}

// 동 지도용 투영 — 한 구만 종횡비를 유지하며 정사각 뷰박스 중앙에 배치(경도 cos 보정).
const DONG_VIEW = 600;

function makeDongView(features, size, pad) {
  const bounds = getGeoBounds({ features });
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const lonSpan = (bounds.maxLon - bounds.minLon) * cosLat;
  const latSpan = bounds.maxLat - bounds.minLat;
  const scale = Math.min((size - pad * 2) / lonSpan, (size - pad * 2) / latSpan);
  return {
    minLon: bounds.minLon,
    maxLat: bounds.maxLat,
    cosLat,
    scale,
    offsetX: (size - lonSpan * scale) / 2,
    offsetY: (size - latSpan * scale) / 2,
  };
}

function projectDong([lon, lat], proj) {
  return [
    proj.offsetX + (lon - proj.minLon) * proj.cosLat * proj.scale,
    proj.offsetY + (proj.maxLat - lat) * proj.scale,
  ];
}

function dongGeometryToPath(geometry, proj) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons
    .map((polygon) =>
      polygon
        .map((ring) =>
          ring
            .map((point, index) => {
              const [x, y] = projectDong(point, proj);
              return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ') + ' Z'
        )
        .join(' ')
    )
    .join(' ');
}

function dongCenter(geometry, proj) {
  const points = flattenCoordinates(geometry.coordinates).map((point) => projectDong(point, proj));
  const totals = points.reduce((sum, [x, y]) => ({ x: sum.x + x, y: sum.y + y }), { x: 0, y: 0 });
  return [totals.x / points.length, totals.y / points.length];
}

function isPointInRing([lon, lat], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lonI, latI] = ring[i];
    const [lonJ, latJ] = ring[j];
    const intersects =
      latI > lat !== latJ > lat &&
      lon < ((lonJ - lonI) * (lat - latI)) / (latJ - latI || Number.EPSILON) + lonI;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isPointInPolygon(point, polygon) {
  const [outerRing, ...holes] = polygon;
  return isPointInRing(point, outerRing) && !holes.some((ring) => isPointInRing(point, ring));
}

function geometryContainsPoint(geometry, point) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => isPointInPolygon(point, polygon));
}

function findFeatureByCoordinate(geo, longitude, latitude) {
  return geo.features.find((feature) => geometryContainsPoint(feature.geometry, [longitude, latitude]));
}

const TONE_EMOJI = { danger: '🔴', warning: '🟠', notice: '🟡', calm: '🟢' };
const LOVEBUG_LABELS = { danger: '출몰 많음', warning: '출몰 주의', notice: '출몰 보통', calm: '출몰 적음' };

// 종별 라벨을 담은 risk(computeSpeciesRisk 결과)면 그 라벨을, 아니면 러브버그 문구를 쓴다.
function getForecastRiskLabel(risk) {
  const tone = risk.tone ?? 'calm';
  const label = risk.label && !['매우 높음', '높음', '보통', '낮음'].includes(risk.label)
    ? risk.label
    : LOVEBUG_LABELS[tone];
  return `${TONE_EMOJI[tone]} ${label}`;
}

// 오늘로부터 index일 뒤의 표시 라벨. 오늘/내일은 상대표현, 그 외는 날짜(요일).
function formatForecastDay(index) {
  const date = new Date();
  date.setDate(date.getDate() + index);
  const md = `${date.getMonth() + 1}/${date.getDate()}`;
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  const relative = ['오늘', '내일'][index];
  return relative ? `${relative} ${md}` : `${md}(${weekday})`;
}

function makeForecast(region, reportCount, dongRisk, riskFn = getRisk) {
  const dongAdjustment = dongRisk ? Math.round((dongRisk.score - 55) / 8) : 0;

  // 예보일별 제보 기여 태이퍼 — 오늘 목격담이 미래 예보까지 같은 강도로 밀어올리지 않게.
  // 오늘 100% / 내일 50% / 모레 25%. 미래일수록 날씨(환경) 위주로 판단하게 한다.
  const REPORT_DAY_TAPER = [1, 0.5, 0.25];

  // 기상청 단기예보에서 뽑은 일별 실예보(오늘~모레)가 있으면 그 날씨로 계산한다.
  if (region.daily?.length) {
    return region.daily.map((day, index) => {
      const prev = index > 0 ? region.daily[index - 1] : null;
      const taper = REPORT_DAY_TAPER[index] ?? 0.25;
      const simulated = {
        ...region,
        temp: day.temp,
        humidity: day.humidity,
        rain: day.rain ?? region.rain,
        wind: day.wind ?? region.wind,
        // 전날 예보 강수량을 '비 온 뒤 갬' 우화 신호로 사용(첫날은 강수확률로 근사)
        recentRainMm: prev ? prev.precip : undefined,
        reports: Math.max(0, reportCount * taper + dongAdjustment),
      };
      return { day: day.date, temp: day.temp, weather: day.label, risk: riskFn(simulated) };
    });
  }

  // 실예보가 아직 없으면(로드 전·실패) 시드+오프셋 참고치로 대체한다.
  return FORECAST_OFFSETS.map((day, index) => {
    const taper = REPORT_DAY_TAPER[index] ?? 0.25;
    const simulated = {
      ...region,
      temp: region.temp + day.temp,
      humidity: Math.max(35, Math.min(95, region.humidity + day.humidity)),
      rain: Math.max(0, Math.min(100, region.rain + day.rain)),
      reports: Math.max(0, reportCount * taper + day.reports + dongAdjustment),
    };
    return {
      ...day,
      temp: simulated.temp,
      risk: riskFn(simulated),
    };
  });
}

function getDongRisk(region, reportCount, dongCounts = {}, riskFn = getRisk) {
  const dongs = DISTRICT_DONGS[region.id] ?? [`${region.name.replace(/구$/, '')}1동`];
  return dongs.map((name) => {
    const dongReports = dongCounts[name] ?? 0;
    // 동은 구의 환경·관측수준을 그대로 물려받고(=구 지수가 기본값), 실제 동 제보가 있으면
    // 그 위로 가산한다. → 제보 전엔 동=구로 일치하고, 상·하위 지수가 어긋나지 않는다.
    const reports = reportCount + dongReports * 3;
    return {
      name,
      risk: riskFn({ ...region, reports }),
      reports: dongReports,
    };
  });
}

// 관찰러 프로필은 localStorage에 보관 — 익명 uid가 기기에 유지되므로 프로필도 함께
// 유지해, 앱을 껐다 켤 때마다 재등록하는 마찰을 없앤다(이전엔 sessionStorage라 매번 초기화).
function readCitizenSession() {
  try {
    const saved = window.localStorage.getItem(CITIZEN_SESSION_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function App() {
  const [selectedId, setSelectedId] = useState('eunpyeong');
  const [query, setQuery] = useState('');
  const [showNearby, setShowNearby] = useState(false);
  const [activeTab, setActiveTab] = useState('main');
  const [forecastDong, setForecastDong] = useState('녹번동');
  const [forecastRegionId, setForecastRegionId] = useState('eunpyeong');
  const [citizen, setCitizen] = useState(null);
  const [reports, setReports] = useState([]);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  // 보고 있는 벌레 종. null = 오늘 위험이 가장 높은 종 자동 선택.
  const [speciesId, setSpeciesId] = useState(null);
  // 서울시 모기예보제 공식 수치(키 미설정이면 null — 화면은 자체 추정치만 사용)
  const [seoulMosquito, setSeoulMosquito] = useState(null);
  // 지도 보기 — 'seoul'(AI 일러스트, 25구) / 'metro'(수도권 GeoJSON, 경기·인천 포함)
  const [mapView, setMapView] = useState('seoul');
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('lovebug-favorites') || '[]');
    } catch {
      return [];
    }
  });
  // [인앱 알림] 지난 방문 때의 지수(즐겨찾기·현위치)를 저장해 이번 방문과 비교한다.
  const [lastSeen, setLastSeen] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('lovebug-lastseen') || '{}');
    } catch {
      return {};
    }
  });
  const [changeAlerts, setChangeAlerts] = useState(null);
  const [alertsDismissed, setAlertsDismissed] = useState(false);
  const [locationAuth, setLocationAuth] = useState({
    status: 'idle',
    message: '현재위치를 인증하면 시민관측을 등록할 수 있어요.',
    coords: null,
  });
  const nearbyRef = useRef(null);
  const [loginForm, setLoginForm] = useState({
    nickname: '',
    regionId: 'eunpyeong',
    dong: '녹번동',
  });
  const [reportForm, setReportForm] = useState({
    species: 'lovebug',
    dong: '',
    place: '학교 주변',
    amount: '많음',
    memo: '',
  });
  const [liveWeather, setLiveWeather] = useState({});
  const [weatherTimedOut, setWeatherTimedOut] = useState(false);
  // 실날씨가 로드됐거나(정상) 일정 시간이 지나면(폰에서 지연·실패 시) 시드값으로라도 표시한다.
  // 로딩(회색)이 무한정 유지돼 지도가 '모두 회색'으로 남던 문제 방지. 시드는 현실화돼 있어 안전.
  const weatherReady = Object.keys(liveWeather).length > 0 || weatherTimedOut;
  // 타임아웃으로만 열린 상태(실날씨 0건) = 시드 추정치를 보여주는 중 — 화면에 정직하게 안내한다.
  const usingFallbackWeather = weatherTimedOut && Object.keys(liveWeather).length === 0;

  // 기상청 실날씨를 머지한 자치구 목록. liveWeather가 채워지면 해당 구의 날씨를 덮어쓴다.
  const regions = useMemo(
    () => REGIONS.map((region) => (liveWeather[region.id] ? { ...region, ...liveWeather[region.id] } : region)),
    [liveWeather]
  );
  const selected = regions.find((region) => region.id === selectedId);

  const filteredRegions = useMemo(() => {
    return REGIONS.filter((region) =>
      `${region.name} ${region.zone}`.toLowerCase().includes(query.toLowerCase())
    );
  }, [query]);

  const filteredIds = new Set(filteredRegions.map((region) => region.id));

  // ── 다종 예보 ──────────────────────────────────────────────────────────────
  // speciesId가 null이면 '오늘 가장 위험한 종'을 자동 선택(계절에 따라 히어로가 바뀐다).
  // 각 종의 점수는 그 종의 제보만으로 계산한다(시드 제보는 러브버그 기준선이라 타 종엔 미적용)
  // — 그래야 칩 점수와 히어로 점수가 일치한다.
  const todaySpecies = useMemo(
    () =>
      SPECIES_ORDER.filter((id) => speciesSeason(id) >= 0.3)
        .map((id) => {
          const weighted = weightedCountByRegion(reports, id)[selected.id] ?? 0;
          const rc = blendReports(id === 'lovebug' ? selected.reports : 0, weighted);
          return { id, risk: computeSpeciesRisk(id, { ...selected, reports: rc }) };
        })
        .sort((a, b) => b.risk.score - a.risk.score),
    [selected, reports]
  );
  const activeSpeciesId = speciesId ?? todaySpecies[0]?.id ?? 'lovebug';
  const species = SPECIES[activeSpeciesId];
  // 시드 제보(REGIONS.reports)는 러브버그 기준선이라 다른 종엔 쓰지 않는다.
  const seedFor = (region) => (activeSpeciesId === 'lovebug' ? region.reports : 0);
  const riskFn = (region) => computeSpeciesRisk(activeSpeciesId, region);

  // 실제 제보 집계 — 선택한 종의 제보만 센다(종 필드가 없는 과거 제보는 러브버그로 간주).
  // 지수 계산엔 최근성 가중치(weighted), 화면 표시엔 원시 건수(raw)를 쓴다.
  const liveReportsByRegion = useMemo(
    () => weightedCountByRegion(reports, activeSpeciesId),
    [reports, activeSpeciesId]
  );
  const liveCountsByRegion = useMemo(
    () => countByRegion(reports, activeSpeciesId),
    [reports, activeSpeciesId]
  );
  const selectedLiveCount = liveCountsByRegion[selected.id] ?? 0;
  const totalReports = blendReports(seedFor(selected), liveReportsByRegion[selected.id] ?? 0);
  const updatedSelected = { ...selected, reports: totalReports };
  const updatedRisk = riskFn(updatedSelected);
  const activeAlerts = speciesAlerts(activeSpeciesId);
  const seasonEvent = currentSeasonEvent();

  // 즐겨찾기 — 각 구의 오늘 지수를 미리 계산(즐겨찾기 카드는 원래 구 기준으로 표시).
  const guScoreById = useMemo(() => {
    const map = {};
    regions.forEach((region) => {
      const rc = blendReports(
        activeSpeciesId === 'lovebug' ? region.reports : 0,
        liveReportsByRegion[region.id] ?? 0
      );
      map[region.id] = computeSpeciesRisk(activeSpeciesId, { ...region, reports: rc }).score;
    });
    return map;
  }, [regions, liveReportsByRegion, activeSpeciesId]);
  const regionNameById = useMemo(
    () => Object.fromEntries(REGIONS.map((r) => [r.id, r.name])),
    []
  );
  useEffect(() => {
    try {
      localStorage.setItem('lovebug-favorites', JSON.stringify(favorites));
    } catch {
      /* 저장 실패는 무시 */
    }
  }, [favorites]);
  const isFav = (gu, name) => favorites.some((f) => f.gu === gu && f.name === name);
  const toggleFav = (gu, name, act, env) => {
    setFavorites((cur) =>
      isFav(gu, name)
        ? cur.filter((f) => !(f.gu === gu && f.name === name))
        : [...cur, { gu, name, act, env }]
    );
  };

  // [인앱 알림] 실날씨가 로드되면 한 번, 즐겨찾기·현재위치 지수를 지난 방문값과 비교해
  // 8점 이상 변한 곳을 배너로 알린다. 비교 후 현재값을 저장(다음 방문 기준선).
  useEffect(() => {
    if (!weatherReady || changeAlerts !== null) return;
    const scores = {};
    favorites.forEach((f) => {
      scores[`fav:${f.gu}:${f.name}`] = speciesPlaceRisk(activeSpeciesId, guScoreById[f.gu] ?? 0, f.env).score;
    });
    scores[`gu:${selectedId}`] = updatedRisk.score;

    const list = [];
    for (const [key, score] of Object.entries(scores)) {
      const prev = lastSeen[key];
      if (prev != null && Math.abs(score - prev) >= 8) {
        const label = key.startsWith('fav:')
          ? `⭐ ${key.split(':')[2]}`
          : `📍 ${regionNameById[selectedId] ?? '우리동네'} 현재 위치`;
        list.push({ key, label, prev, score, up: score > prev });
      }
    }
    setChangeAlerts(list);
    const next = { ...lastSeen, ...scores };
    setLastSeen(next);
    try {
      localStorage.setItem('lovebug-lastseen', JSON.stringify(next));
    } catch {
      /* 저장 실패 무시 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherReady, changeAlerts]);
  const selectedDongs = getDongRisk(selected, totalReports, weightedCountByDong(reports, selected.id, activeSpeciesId), riskFn);
  // 예보 기준 구: 드롭다운 선택값(forecastRegionId), 없으면 현재 위치(selected)를 기본으로.
  const forecastRegion = regions.find((region) => region.id === forecastRegionId) ?? selected;
  const forecastTotalReports = blendReports(
    seedFor(forecastRegion),
    liveReportsByRegion[forecastRegion.id] ?? 0
  );
  const forecastDongs = getDongRisk(forecastRegion, forecastTotalReports, weightedCountByDong(reports, forecastRegion.id, activeSpeciesId), riskFn);
  const sortedForecastRegions = useMemo(
    () => [...REGIONS].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    []
  );
  const loginRegion = regions.find((region) => region.id === loginForm.regionId) ?? selected;
  const loginDongs = useMemo(
    () =>
      getDongRisk(loginRegion, blendReports(seedFor(loginRegion), liveReportsByRegion[loginRegion.id] ?? 0), {}, riskFn).sort(
        (a, b) => a.name.localeCompare(b.name, 'ko')
      ),
    [loginRegion, liveReportsByRegion, activeSpeciesId]
  );
  const sortedForecastDongs = useMemo(
    () => [...forecastDongs].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [forecastDongs]
  );
  const activeForecastDong = forecastDongs.some((dong) => dong.name === forecastDong)
    ? forecastDong
    : forecastDongs[0]?.name;
  const activeForecastDongRisk = forecastDongs.find((dong) => dong.name === activeForecastDong)?.risk;
  const forecast = makeForecast(forecastRegion, forecastTotalReports, activeForecastDongRisk, riskFn);

  // 홈(원스크롤) 파생값 — 현재 선택 구 기준
  const homeForecast = makeForecast(updatedSelected, totalReports, undefined, riskFn);
  const homeHint = hourlyHint(updatedSelected, updatedRisk, riskFn);
  const homeChips = whyChips(updatedRisk, selected);
  const homeDongs = [...selectedDongs].sort((a, b) => b.risk.score - a.risk.score).slice(0, 4);
  const homePlaces = favorites.length
    ? favorites.slice(0, 3).map((f) => ({
        key: `${f.gu}:${f.name}`,
        name: f.name,
        fav: true,
        sub: `${regionNameById[f.gu] ?? ''} · ${PLACE_ENV[f.env]?.label ?? ''}`,
        r: speciesPlaceRisk(activeSpeciesId, guScoreById[f.gu] ?? 0, f.env),
      }))
    : (DISTRICT_PLACES[selectedId] ?? [])
        .map((p) => ({
          key: p.name,
          name: p.name,
          fav: false,
          sub: `${p.act} · ${PLACE_ENV[p.env]?.label ?? ''}`,
          r: speciesPlaceRisk(activeSpeciesId, updatedRisk.score, p.env),
        }))
        .sort((a, b) => a.r.score - b.r.score)
        .slice(0, 3);
  const riskSummary = regions.reduce(
    (summary, region) => {
      const regionRisk = riskFn({
        ...region,
        reports: blendReports(seedFor(region), liveReportsByRegion[region.id] ?? 0),
      });
      summary[regionRisk.tone] += 1;
      return summary;
    },
    { calm: 0, notice: 0, warning: 0, danger: 0 }
  );
  const regionByName = useMemo(
    () => Object.fromEntries(regions.map((region) => [region.name, region])),
    [regions]
  );

  // 사용자 AI 지도(무제-2.svg)의 구 path + 위험도. 좌표계는 1310×1055.
  const aiFeatures = useMemo(() => {
    return aiMap.districts
      .map((d) => {
        const region = regionByName[d.name];
        if (!region) return null;
        const reportCount = blendReports(seedFor(region), liveReportsByRegion[region.id] ?? 0);
        const liveCount = liveCountsByRegion[region.id] ?? 0;
        const risk = computeSpeciesRisk(activeSpeciesId, { ...region, reports: reportCount });
        return { region, risk, liveCount, d: d.d, labelX: d.labelX, labelY: d.labelY };
      })
      .filter(Boolean);
  }, [regionByName, liveReportsByRegion, liveCountsByRegion, activeSpeciesId]);

  // 수도권 GeoJSON 지도(서울 일러스트에 없는 경기·인천 포함). 커버 지역은 위험도 색,
  // 맥락 지역(우리가 예보하지 않는 인접 시군구)은 회색으로 빈틈만 메운다.
  const metroFeatures = useMemo(() => {
    const MAP_SIZE = 600;
    const proj = makeDongView(metroGeo.features, MAP_SIZE, 16);
    return metroGeo.features.map((feature) => {
      const rid = feature.properties.regionId;
      const region = rid ? regions.find((r) => r.id === rid) : null;
      const risk = region
        ? computeSpeciesRisk(activeSpeciesId, {
            ...region,
            reports: blendReports(
              activeSpeciesId === 'lovebug' ? region.reports : 0,
              liveReportsByRegion[region.id] ?? 0
            ),
          })
        : null;
      const [cx, cy] = dongCenter(feature.geometry, proj);
      return {
        key: feature.properties.code,
        name: feature.properties.name,
        regionId: rid,
        region,
        risk,
        d: dongGeometryToPath(feature.geometry, proj),
        cx,
        cy,
      };
    });
  }, [regions, liveReportsByRegion, activeSpeciesId]);

  // region.id → 자치구 코드(동 코드 앞 5자리와 매칭하기 위함)
  const regionCodeById = useMemo(() => {
    const map = {};
    seoulGeo.features.forEach((feature) => {
      const region = regionByName[feature.properties.name];
      if (region) map[region.id] = feature.properties.code;
    });
    return map;
  }, [regionByName]);

  // 선택한 구의 행정동을 확대 투영한 동 지도 데이터
  const selectedDongMap = useMemo(() => {
    const code = regionCodeById[selectedId];
    if (!code) return null;
    const features = seoulSubGeo.features.filter(
      (feature) => feature.properties.code.slice(0, 5) === code
    );
    if (!features.length) return null;
    const proj = makeDongView(features, DONG_VIEW, 22);
    const infoByName = Object.fromEntries(selectedDongs.map((dong) => [dong.name, dong]));
    return features.map((feature) => {
      const name = feature.properties.name;
      const info = infoByName[name];
      // 이름이 안 맞는 동(통폐합 등)은 구 지수를 그대로 따른다(상·하위 어긋남 방지).
      const risk = info ? info.risk : riskFn(selected);
      const [cx, cy] = dongCenter(feature.geometry, proj);
      return {
        name,
        path: dongGeometryToPath(feature.geometry, proj),
        risk,
        reports: info?.reports ?? 0,
        cx,
        cy,
      };
    });
  }, [selectedId, regionCodeById, selectedDongs, selected]);
  useEffect(() => {
    const savedCitizen = readCitizenSession();
    if (savedCitizen) {
      setCitizen(savedCitizen);
    }
  }, []);

  useEffect(() => {
    // Firestore 제보를 실시간 구독. 화면을 떠나면 자동 해제.
    const unsubscribe = subscribeReports(setReports);
    return unsubscribe;
  }, []);

  useEffect(() => {
    // 25개 구 기상청 실날씨를 일괄 조회해 머지. 실패해도 기존(하드코딩) 값으로 동작.
    // 현재 보고 있는 구를 먼저, 그리고 도착하는 대로 하나씩 반영한다.
    // (31개를 다 받을 때까지 기다리면 느린 회선에서 '연결 지연' 안내가 길게 떴다)
    fetchAllDistricts({
      priorityId: selectedId,
      onPartial: (id, entry) => setLiveWeather((prev) => ({ ...prev, [id]: entry })),
    })
      .then((data) => setLiveWeather((prev) => ({ ...prev, ...data })))
      .catch((error) => console.warn('기상청 일괄 조회 실패:', error.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 실날씨가 안 오면(폰 지연·실패) 시드값으로라도 표시 — 지도가 계속 회색으로 남지 않게.
    // 25개 구 일괄 조회가 느린 회선에서 20초 가까이 걸릴 수 있어, 임시 안내가 성급히 뜨지 않도록 12초로 둔다.
    const timeout = setTimeout(() => setWeatherTimedOut(true), 12000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    // 모기 시즌에만 서울시 공식 모기예보를 받아온다(비시즌엔 불필요한 호출을 하지 않음).
    if (speciesSeason('mosquito') < 0.3) return;
    fetchSeoulMosquito().then(setSeoulMosquito).catch(() => {});
  }, []);

  useEffect(() => {
    // 보고 있는 종을 제보 폼 기본값으로 — 모기 화면에서 제보하면 모기 제보가 되도록.
    setReportForm((f) => ({ ...f, species: activeSpeciesId }));
  }, [activeSpeciesId]);

  useEffect(() => {
    // 네이티브(Capacitor) 앱에서만 안전영역 바닥값 CSS를 켠다 — 일부 iOS 구성에서
    // env(safe-area-inset-top)가 0으로 와 상태바(다이내믹 아일랜드)와 헤더가 겹치는 것 방지.
    if (Capacitor.isNativePlatform()) {
      document.documentElement.classList.add('cap-native');
    }
  }, []);

  function scrollToRef(ref) {
    window.requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function openNearby() {
    setActiveTab('main');
    setShowNearby(true);
    scrollToRef(nearbyRef);
  }

  async function submitReport(event) {
    event.preventDefault();
    if (!citizen || locationAuth.status !== 'verified' || reportSubmitting) return;
    // 스팸 가드: 같은 기기에서 5분에 1건. 지수의 40%가 제보라 연속 등록으로 조작되는 것을 막는다.
    const lastAt = Number(localStorage.getItem('lovebug-last-report') || 0);
    const elapsed = Date.now() - lastAt;
    if (elapsed < REPORT_COOLDOWN_MS) {
      const remainMin = Math.ceil((REPORT_COOLDOWN_MS - elapsed) / 60000);
      alert(`제보는 5분에 한 번 등록할 수 있어요. 약 ${remainMin}분 후 다시 시도해 주세요.`);
      return;
    }
    setReportSubmitting(true);
    try {
      await addReport({
        uid: citizen.uid,
        regionId: selected.id,
        regionName: selected.name,
        reporterName: citizen.nickname || citizen.name || '동네관찰러',
        // 공개 DB에 거주 동까지 남기지 않는다 — 구 단위면 충분(닉네임+거주동 조합 노출 방지).
        reporterDong: citizen.regionName,
        locationVerified: true,
        locationLabel: locationAuth.coords
          ? `위치 인증 ${locationAuth.coords.latitude.toFixed(3)}, ${locationAuth.coords.longitude.toFixed(3)}`
          : '위치 인증 완료',
        lat: roundCoord(locationAuth.coords?.latitude),
        lng: roundCoord(locationAuth.coords?.longitude),
        species: reportForm.species,
        place: reportForm.place,
        amount: reportForm.amount,
        memo: reportForm.memo,
        dong: reportForm.dong || selectedDongs[0]?.name || selected.name,
      });
      setReportForm({ species: activeSpeciesId, dong: '', place: '학교 주변', amount: '많음', memo: '' });
      try {
        localStorage.setItem('lovebug-last-report', String(Date.now()));
      } catch {
        /* 저장 실패 무시 */
      }
    } catch (error) {
      console.error('제보 저장 실패:', error);
      alert('제보 저장에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setReportSubmitting(false);
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    try {
      // 익명 인증 — 팝업 없이 고유 uid만 발급(iOS WKWebView에서도 동작).
      const user = await signInAnonymous();
      const region = regions.find((item) => item.id === loginForm.regionId) ?? selected;
      const nextCitizen = {
        uid: user.uid,
        nickname: loginForm.nickname.trim() || '동네관찰러',
        provider: 'anonymous',
        regionId: loginForm.regionId,
        regionName: region.name,
        dong: loginForm.dong,
        verifiedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(CITIZEN_SESSION_KEY, JSON.stringify(nextCitizen));
      setCitizen(nextCitizen);
    } catch (error) {
      console.error('관찰러 등록 실패:', error);
      alert('관찰러 등록에 실패했어요. 네트워크 확인 후 다시 시도해 주세요.');
    }
  }

  function logoutCitizen() {
    signOutUser().catch((error) => console.error('로그아웃 실패:', error));
    window.localStorage.removeItem(CITIZEN_SESSION_KEY);
    setCitizen(null);
    setLocationAuth({
      status: 'idle',
      message: '현재위치를 인증하면 시민관측을 등록할 수 있어요.',
      coords: null,
    });
  }

  function applyCurrentLocation(position) {
    const coords = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
    const feature = findFeatureByCoordinate(seoulGeo, coords.longitude, coords.latitude);
    const matchedRegion = feature ? regionByName[feature.properties.name] : null;

    if (!matchedRegion) {
      setLocationAuth({
        status: 'error',
        message: '현재 위치가 서울 자치구 경계 밖으로 확인되어 지역 예보에 적용하지 않았어요.',
        coords,
      });
      return;
    }

    const nextDongs = getDongRisk(matchedRegion, matchedRegion.reports).sort((a, b) =>
      a.name.localeCompare(b.name, 'ko')
    );
    setSelectedId(matchedRegion.id);
    setForecastRegionId(matchedRegion.id);
    setForecastDong(nextDongs[0]?.name ?? '');
    setLoginForm((current) => ({
      ...current,
      regionId: matchedRegion.id,
      dong: nextDongs[0]?.name ?? current.dong,
    }));
    setLocationAuth({
      status: 'verified',
      message: `${matchedRegion.name} 현재위치가 인증되어 예보와 제보 기준에 적용됐어요.`,
      coords,
    });
  }

  function verifyCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationAuth({
        status: 'error',
        message: '이 브라우저에서는 현재위치 인증을 사용할 수 없어요.',
        coords: null,
      });
      return;
    }

    setLocationAuth({
      status: 'checking',
      message: '현재위치로 지역을 찾는 중이에요.',
      coords: null,
    });

    navigator.geolocation.getCurrentPosition(
      applyCurrentLocation,
      () => {
        setLocationAuth({
          status: 'error',
          message: '위치 권한이 허용되지 않아 제보 등록을 잠시 막아두었어요.',
          coords: null,
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <button
          className="logo-btn"
          onClick={() => {
            setActiveTab('main');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          aria-label="홈으로 이동"
        >
          <img src="/logo-mark.png" alt="우리동네 벌레예보" width="38" height="38" />
        </button>
        <div className="app-header-loc">
          <strong>{selected.name}</strong>
          <small>
            {locationAuth.status === 'verified'
              ? '현재 위치 인증됨'
              : locationAuth.status === 'checking'
                ? '위치 확인 중…'
                : "옆의 '내 위치'를 눌러 동네 인증"}
          </small>
        </div>
        <button
          className="loc-button"
          onClick={verifyCurrentLocation}
          disabled={locationAuth.status === 'checking'}
        >
          <MapPin size={15} />
          내 위치
        </button>
      </header>

      {changeAlerts && changeAlerts.length > 0 && !alertsDismissed && (
        <div className="change-banner" role="status">
          <div className="change-banner-body">
            <strong>📢 지난 방문보다 달라졌어요</strong>
            <ul>
              {changeAlerts.map((a) => (
                <li key={a.key}>
                  {a.up ? '🔺' : '🔻'} {a.label} <span>{a.prev} → <b>{a.score}</b></span>{' '}
                  {a.up ? '상승, 주의하세요' : '완화됐어요'}
                </li>
              ))}
            </ul>
          </div>
          <button className="change-banner-close" onClick={() => setAlertsDismissed(true)} aria-label="알림 닫기">
            ✕
          </button>
        </div>
      )}

      <nav className="app-tabs" aria-label="주요 화면 탭">
        {TAB_GROUPS.map((group) => {
          const active = group.id === activeTab || group.segs.some((seg) => seg.id === activeTab);
          return (
            <button
              className={active ? 'active' : ''}
              key={group.id}
              onClick={() => setActiveTab(group.segs[0]?.id ?? group.id)}
            >
              <span className="tab-icon" aria-hidden="true">{group.icon}</span>
              {group.label}
            </button>
          );
        })}
      </nav>

      {(() => {
        const group = TAB_GROUPS.find(
          (g) => g.id === activeTab || g.segs.some((seg) => seg.id === activeTab)
        );
        if (!group || !group.showSegs) return null;
        return (
          <nav className="app-segments" aria-label={`${group.label} 세부 화면`}>
            {group.segs.map((seg) => (
              <button
                className={activeTab === seg.id ? 'active' : ''}
                key={seg.id}
                onClick={() => setActiveTab(seg.id)}
              >
                {seg.label}
              </button>
            ))}
          </nav>
        );
      })()}

      {activeTab === 'main' && (
        <>
      {usingFallbackWeather && (
        <p className="stale-notice" role="status">
          ⚠️ 실시간 예보 연결이 지연되고 있어요 — 임시 추정치를 표시 중입니다.
        </p>
      )}

      {/* ⓪ 오늘 조심할 벌레 — 계절에 따라 활동 종이 바뀐다(탭하면 그 종으로 전환) */}
      {todaySpecies.length > 0 && (
        <div className="species-bar" role="tablist" aria-label="오늘 조심할 벌레">
          {todaySpecies.map((s) => {
            const sp = SPECIES[s.id];
            const on = s.id === activeSpeciesId;
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={on}
                className={`species-chip ${on ? 'on' : ''} ${s.risk.tone}`}
                onClick={() => setSpeciesId(s.id)}
              >
                <span className="sp-emoji" aria-hidden="true">{sp.emoji}</span>
                <span className="sp-name">{sp.name}</span>
                <b className="sp-score">{s.risk.score}</b>
              </button>
            );
          })}
        </div>
      )}

      {/* ① 3초 답: 지수 + 한 줄 + 시간 힌트 */}
      <section className="hcard home-hero" aria-label={`오늘 ${species.name} 위험도 ${updatedRisk.score}점`}>
        <div className="home-hero-row">
          <div>
            <p className="home-species">{species.emoji} {species.name}</p>
            <div className="home-score">
              {updatedRisk.score}
              <small> /100</small>
            </div>
            <b className={`home-badge ${updatedRisk.tone}`}>{getForecastRiskLabel(updatedRisk)}</b>
          </div>
          <div className="gauge-ring home-ring" style={{ '--score': `${updatedRisk.score}%` }}>
            <div className="gauge-core">
              <Bug size={26} />
            </div>
          </div>
        </div>
        {activeAlerts.map((a) => (
          <div className="official-alert" key={a.label}>
            📢 <b>{a.label}</b> · {a.source}
          </div>
        ))}
        {activeSpeciesId === 'mosquito' && seoulMosquito && (
          <div className="official-index">
            <b>서울시 모기예보</b>
            <span>
              {['riverside', 'urban', 'mountain'].map((k) => {
                const v = seoulMosquito[k];
                if (!v) return null;
                const name = k === 'riverside' ? '수변부' : k === 'urban' ? '주거지' : '공원';
                return (
                  <i key={k}>
                    {name} {v.step}단계 {v.label}
                  </i>
                );
              })}
            </span>
          </div>
        )}
        <p className="home-narr">{riskNarrative(updatedRisk, activeSpeciesId)}</p>
        {homeHint && <div className="time-hint">{homeHint}</div>}
        <span className="hero-src">
          {selectedLiveCount > 0 ? `이웃 제보 ${selectedLiveCount}건 반영 · ` : ''}
          {weatherReady && !usingFallbackWeather ? '기상청 실시간 예보 기준' : '날씨·지형 기반 추정치'}
        </span>
      </section>

      {/* ①-b 계절 안내 + 종별 안전수칙 */}
      <section className="hcard season-card" aria-label={`${species.name} 계절 안내`}>
        <div className="hsec-head">
          <h3>{species.emoji} {species.name} — 지금 이 계절</h3>
        </div>
        <p className="season-note">{species.seasonNote}</p>
        <ul className="safety-list">
          {species.tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        {seasonEvent && (
          <div className="season-event">
            <strong>{seasonEvent.title}</strong>
            <p>{seasonEvent.desc}</p>
          </div>
        )}
      </section>

      {/* ② 앞으로 3일 */}
      <section className="hcard" aria-label="3일 예보">
        <div className="hsec-head">
          <h3>앞으로 3일</h3>
          <button className="link-btn" onClick={() => setActiveTab('forecast')}>시간대별 →</button>
        </div>
        <div className="day-strip">
          {homeForecast.map((d, i) => (
            <div className="day-cell" key={String(d.day)}>
              <b>{stripDayLabel(d.day, i)}</b>
              <span className="day-w">{WEATHER_EMOJI[d.weather] ?? '🌤️'}</span>
              <span className="day-s">
                <span className={`legend-dot ${d.risk.tone}`} />
                {d.risk.score}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ③ 근거 칩 */}
      {homeChips.length > 0 && (
        <section className="hcard" aria-label="지수 근거">
          <div className="hsec-head">
            <h3>왜 이 지수일까?</h3>
          </div>
          <div className="why-chips">
            {homeChips.map((c) => (
              <span className="chip" key={c}>{c}</span>
            ))}
          </div>
        </section>
      )}

      {/* ④ 내 주변 동네 */}
      <section className="hcard" aria-label="동네별 위험도">
        <div className="hsec-head">
          <h3>{selected.name} 동네별</h3>
          <button className="link-btn" onClick={() => setActiveTab('map')}>지도에서 보기 →</button>
        </div>
        <div className="home-dongs">
          {homeDongs.map((dong) => (
            <div className="home-dong-row" key={dong.name}>
              <span>{dong.name}</span>
              <b>
                <span className={`legend-dot ${dong.risk.tone}`} />
                {dong.risk.score}
              </b>
            </div>
          ))}
        </div>
      </section>

      {/* ⑤ 추천 장소 (즐겨찾기 우선) */}
      <section className="hcard" aria-label="추천 장소">
        <div className="hsec-head">
          <h3>{favorites.length ? '⭐ 내 즐겨찾기' : '오늘 어디로 나갈까?'}</h3>
          <button className="link-btn" onClick={() => setActiveTab('spots')}>전체 →</button>
        </div>
        <div className="home-places">
          {homePlaces.length === 0 && (
            <p className="home-places-empty">이 지역의 장소 정보가 아직 없어요 — 전체에서 다른 구를 볼 수 있어요.</p>
          )}
          {homePlaces.map((p) => (
            <div className="home-place-row" key={p.key}>
              <div className="hp-name">
                {p.fav && <span className="hp-star">★</span>}
                {p.name}
                <small>{p.sub} — {shortPlaceAdvice(p.r.tone)}</small>
              </div>
              <div className={`hp-score ${p.r.tone}`}>
                {p.r.score}
                <small>{p.r.label}</small>
              </div>
            </div>
          ))}
        </div>
        <button className="card-more" onClick={() => setActiveTab('spots')}>
          🗂️ 구별 장소 전체 보기 — 다른 동네도 확인해요 →
        </button>
      </section>

      {/* ⑥ 제보 루프 */}
      <section className="hcard report-cta" aria-label="시민 제보 안내">
        <p>
          지금 밖에 계세요?
          <small>30초 제보로 우리 동네 예보가 더 정확해져요</small>
        </p>
        <button onClick={() => setActiveTab('report')}>🐞 제보하기</button>
      </section>
        </>
      )}

      {activeTab === 'map' && (
      <div className="content-grid single-view">
        <section className="panel region-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">지역별 현황</p>
              <h3>벌레예보 지도</h3>
            </div>
            <div className="search-box">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="지역 검색"
                aria-label="지역 검색"
              />
            </div>
          </div>

          <label className="map-region-select">
            <span>구 선택</span>
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              aria-label="구 선택"
            >
              {sortedForecastRegions.map((region) => (
                <option value={region.id} key={region.id}>{region.name}</option>
              ))}
            </select>
          </label>

          {/* 지도 보기 전환 — 서울(AI 일러스트) / 수도권(경기·인천 포함) */}
          <div className="map-view-switch" role="tablist" aria-label="지도 범위">
            <button
              role="tab"
              aria-selected={mapView === 'seoul'}
              className={mapView === 'seoul' ? 'on' : ''}
              onClick={() => setMapView('seoul')}
            >
              서울
            </button>
            <button
              role="tab"
              aria-selected={mapView === 'metro'}
              className={mapView === 'metro' ? 'on' : ''}
              onClick={() => setMapView('metro')}
            >
              수도권
            </button>
          </div>

          <div className="seoul-map-wrap">
            <div className="map-summary" aria-label="위험도 요약">
              {weatherReady ? (
                <>
                  <span><b>{riskSummary.danger}곳</b> 🔴 {species.labels.danger}</span>
                  <span><b>{riskSummary.warning}곳</b> 🟠 {species.labels.warning}</span>
                  <span><b>{riskSummary.notice}곳</b> 🟡 {species.labels.notice}</span>
                  <span><b>{riskSummary.calm}곳</b> 🟢 {species.labels.calm}</span>
                </>
              ) : (
                <span className="map-loading">⏳ 기상청 예보를 불러오는 중… 잠시 후 실시간 지수가 표시돼요</span>
              )}
            </div>

            {mapView === 'metro' && (
              <div className="seoul-map metro-map" role="group" aria-label="수도권 벌레예보 지도">
                <svg viewBox="0 0 600 600" className="seoul-map-svg" role="img">
                  {metroFeatures.map((f) => {
                    const on = f.regionId === selectedId;
                    if (!f.regionId) {
                      // 예보하지 않는 인접 지역 — 빈틈만 메우는 맥락(클릭 불가)
                      return <path key={f.key} className="metro-shape context" d={f.d} />;
                    }
                    return (
                      <g className={`district-group ${on ? 'selected' : ''}`} key={f.key}>
                        <path
                          className={`metro-shape ${weatherReady ? f.risk.tone : 'loading'}`}
                          d={f.d}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedId(f.regionId)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedId(f.regionId);
                            }
                          }}
                          aria-label={
                            weatherReady
                              ? `${f.region.name} ${getForecastRiskLabel(f.risk)}`
                              : `${f.region.name} 예보 준비 중`
                          }
                        />
                        {on && (
                          <text className="metro-label" x={f.cx} y={f.cy}>
                            {f.region.name}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
                <p className="metro-note">
                  탭하면 그 지역 예보로 바뀌어요. 회색은 아직 예보하지 않는 지역이에요.
                </p>
              </div>
            )}
            {mapView === 'seoul' && (
            <div className="seoul-map seoul-map-ai" role="group" aria-label="서울시 구별 벌레예보 지도">
              <svg
                className="seoul-map-svg"
                viewBox="20 2 1268 1032"
                role="img"
                aria-label="서울시 자치구 벌레예보"
              >
                {aiMap.river && <path className="ai-river" d={aiMap.river} />}
                {aiFeatures.map(({ region, risk, liveCount, d, labelX, labelY }) => {
                  const isFilteredOut = query && !filteredIds.has(region.id);
                  return (
                    <g
                      className={`district-group ${region.id === selectedId ? 'selected' : ''} ${
                        isFilteredOut ? 'muted' : ''
                      }`}
                      key={region.id}
                    >
                      <path
                        className={`district-shape ${weatherReady ? risk.tone : 'loading'}`}
                        d={d}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedId(region.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedId(region.id);
                          }
                        }}
                        aria-label={weatherReady ? `${region.name} ${getForecastRiskLabel(risk)} 제보 ${liveCount}건` : `${region.name} 예보 준비 중`}
                      />
                      <text className="district-label" x={labelX} y={labelY}>
                        {region.name.replace(/구$/, '')}
                      </text>
                      <text className="district-score" x={labelX} y={labelY + 24}>
                        {weatherReady ? risk.score : ''}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            )}
            <div className="map-legend" aria-label="위험도 범례">
              <span><i className="legend-dot calm" />{species.labels.calm}</span>
              <span><i className="legend-dot notice" />{species.labels.notice}</span>
              <span><i className="legend-dot warning" />{species.labels.warning}</span>
              <span><i className="legend-dot danger" />{species.labels.danger}</span>
            </div>
          </div>

          <div className="selected-district">
            <div>
              <p className="eyebrow">선택 지역</p>
              <strong>{selected.name}</strong>
              <span>{selected.zone} · 제보 {selectedLiveCount}건</span>
            </div>
            <b className={`selected-risk ${updatedRisk.tone}`}>{getForecastRiskLabel(updatedRisk)}</b>
          </div>
          {/* 지도에서 고른 구 → 바로 그 동네 추천 장소로 (selectedId 공유) */}
          <button className="card-more" onClick={() => setActiveTab('spots')}>
            📍 {selected.name} 추천 장소 보기 →
          </button>

          {/* 동 지도는 서울 행정동 GeoJSON 기반이라 경기·인천은 없다 — 대신 동네별 목록을 제공 */}
          {!selectedDongMap && (
            <div className="dong-map-block">
              <p className="eyebrow">{selected.name} 동네별 지수</p>
              <p className="dong-fallback-note">
                이 지역은 아직 동별 지도가 없어요. 예보·추천 장소는 정상 제공됩니다.
              </p>
              <div className="home-dongs">
                {[...selectedDongs]
                  .sort((a, b) => b.risk.score - a.risk.score)
                  .slice(0, 8)
                  .map((dong) => (
                    <div className="home-dong-row" key={dong.name}>
                      <span>{dong.name}</span>
                      <b>
                        <span className={`legend-dot ${dong.risk.tone}`} />
                        {dong.risk.score}
                      </b>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {selectedDongMap && (
            <div className="dong-map-block">
              <p className="eyebrow">{selected.name} 동별 지도 · 탭하면 발견 동으로 선택돼요</p>
              <div className="seoul-map-scroll">
                <div className="seoul-map dong-map">
                  <svg
                    className="seoul-map-svg"
                    viewBox={`0 0 ${DONG_VIEW} ${DONG_VIEW}`}
                    role="img"
                    aria-label={`${selected.name} 동별 위험도 지도`}
                  >
                    {selectedDongMap.map((dong) => (
                      <g className="district-group" key={dong.name}>
                        <path
                          className={`district-shape ${dong.risk.tone}`}
                          d={dong.path}
                          role="button"
                          tabIndex={0}
                          onClick={() => setReportForm({ ...reportForm, dong: dong.name })}
                          aria-label={`${dong.name} ${getForecastRiskLabel(dong.risk)}`}
                        />
                        <text className="district-label dong-label" x={dong.cx} y={dong.cy - 1}>
                          {dong.name}
                        </text>
                        <text className="district-score" x={dong.cx} y={dong.cy + 10}>
                          {dong.risk.score}
                        </text>
                      </g>
                    ))}
                  </svg>
                </div>
              </div>
            </div>
          )}

          <div className="dong-list" aria-label={`${selected.name} 동별 위험도`}>
            {selectedDongs.map((dong) => (
              <button className="dong-chip" key={dong.name} onClick={() => setReportForm({ ...reportForm, dong: dong.name })}>
                <span className={`legend-dot ${dong.risk.tone}`} />
                <strong>{dong.name}</strong>
                <small>{getForecastRiskLabel(dong.risk)} · 제보 {dong.reports}건</small>
              </button>
            ))}
          </div>

        </section>
      </div>
      )}

      {['report', 'forecast', 'places', 'spots', 'bugs', 'guide'].includes(activeTab) && (
        <section className="panel action-panel single-panel">
          {activeTab === 'report' && (
            <div className="tab-pane">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">시민 관측</p>
                  <h3>{citizen ? '현재위치 인증 후 제보하기' : '동네 관찰러로 시작하기'}</h3>
                </div>
              </div>

              {!citizen ? (
                <form onSubmit={submitLogin} className="login-form">
                  <p className="trust-copy">
                    신뢰할 수 있는 관측 정보로 쓰기 위해 현재위치 인증(GPS)을 거친 뒤 기록해요. 공개 화면에는 닉네임만 표시됩니다.
                  </p>
                  <div className="google-auth-preview">
                    <span>📍</span>
                    <div>
                      <strong>위치 인증 기반 제보</strong>
                      <small>계정 가입 없이 바로 시작해요. 제보는 현재위치가 인증된 동네에서만 등록돼요.</small>
                    </div>
                  </div>
                  <label>
                    닉네임
                    <input
                      value={loginForm.nickname}
                      onChange={(event) => setLoginForm({ ...loginForm, nickname: event.target.value })}
                      placeholder="예: 은평관찰러"
                      required
                    />
                  </label>
                  <label>
                    거주 구
                    <select
                      value={loginForm.regionId}
                      onChange={(event) => {
                        const nextRegion = REGIONS.find((region) => region.id === event.target.value);
                        const nextDongs = getDongRisk(nextRegion, nextRegion.reports).sort((a, b) =>
                          a.name.localeCompare(b.name, 'ko')
                        );
                        setLoginForm({
                          ...loginForm,
                          regionId: event.target.value,
                          dong: nextDongs[0]?.name ?? '',
                        });
                      }}
                    >
                      {sortedForecastRegions.map((region) => (
                        <option value={region.id} key={region.id}>{region.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    거주 동
                    <select
                      value={loginForm.dong}
                      onChange={(event) => setLoginForm({ ...loginForm, dong: event.target.value })}
                    >
                      {loginDongs.map((dong) => (
                        <option value={dong.name} key={dong.name}>{dong.name}</option>
                      ))}
                    </select>
                  </label>
                  <button className="primary-action full" type="submit">
                    <Plus size={18} />
                    관찰러 등록하고 시작하기
                  </button>
                </form>
              ) : (
                <>
                  <div className="citizen-card">
                    <div>
                      <p className="eyebrow">동네 관찰러</p>
                      <strong>{citizen.nickname || citizen.name || '동네관찰러'}</strong>
                      <span>{citizen.regionName} {citizen.dong} · 닉네임으로 공개</span>
                    </div>
                    <button className="text-action" onClick={logoutCitizen}>로그아웃</button>
                  </div>

                  <div className={`location-verification ${locationAuth.status}`}>
                    <div>
                      <p className="eyebrow">현재위치 인증</p>
                      <strong>
                        {locationAuth.status === 'verified'
                          ? '인증 완료'
                          : locationAuth.status === 'checking'
                            ? '확인 중'
                            : '인증 필요'}
                      </strong>
                      <span>{locationAuth.message}</span>
                    </div>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={verifyCurrentLocation}
                      disabled={locationAuth.status === 'checking'}
                    >
                      <MapPin size={17} />
                      현재위치 인증
                    </button>
                  </div>

                  <form onSubmit={submitReport} className="report-form">
                    <label>
                      발견 동
                      <select
                        value={reportForm.dong}
                        onChange={(event) => setReportForm({ ...reportForm, dong: event.target.value })}
                      >
                        <option value="">대표 동 선택</option>
                        {selectedDongs.map((dong) => (
                          <option value={dong.name} key={dong.name}>{dong.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      무슨 벌레인가요?
                      <select
                        value={reportForm.species}
                        onChange={(event) => setReportForm({ ...reportForm, species: event.target.value })}
                      >
                        {SPECIES_ORDER.map((id) => (
                          <option value={id} key={id}>
                            {SPECIES[id].emoji} {SPECIES[id].name}
                            {id === 'wasp' ? '집' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    {reportForm.species === 'wasp' && (
                      <p className="wasp-warn">
                        ⚠️ 벌집은 절대 직접 건드리지 마세요. 위험하면 먼저 <b>119</b>에 신고하고, 안전한 곳에서 제보해 주세요.
                      </p>
                    )}
                    <label>
                      발견 위치
                      <select
                        value={reportForm.place}
                        onChange={(event) => setReportForm({ ...reportForm, place: event.target.value })}
                      >
                        <option>학교 주변</option>
                        <option>하천 산책로</option>
                        <option>아파트 단지</option>
                        <option>버스정류장</option>
                        <option>상가 조명 주변</option>
                      </select>
                    </label>
                    <label>
                      체감 규모
                      <select
                        value={reportForm.amount}
                        onChange={(event) => setReportForm({ ...reportForm, amount: event.target.value })}
                      >
                        <option>조금</option>
                        <option>많음</option>
                        <option>매우 많음</option>
                      </select>
                    </label>
                    <label>
                      메모
                      <input
                        value={reportForm.memo}
                        onChange={(event) => setReportForm({ ...reportForm, memo: event.target.value })}
                        placeholder="예: 운동장 조명 근처"
                        maxLength={120}
                      />
                    </label>
                    <button
                      className="primary-action full"
                      type="submit"
                      disabled={locationAuth.status !== 'verified' || reportSubmitting}
                    >
                      <Plus size={18} />
                      {reportSubmitting
                        ? '등록 중…'
                        : locationAuth.status === 'verified'
                          ? `${selected.name} 인증 제보 등록`
                          : '현재위치 인증 후 등록 가능'}
                    </button>
                  </form>
                </>
              )}

              <div className="recent-reports">
                {reports.length === 0 && (
                  <div className="report-empty">
                    아직 등록된 제보가 없어요 — 첫 번째 동네 관찰러가 되어 주세요 🐞
                  </div>
                )}
                {reports.slice(0, 5).map((item) => {
                  const sp = SPECIES[item.species ?? 'lovebug'] ?? SPECIES.lovebug;
                  const isWasp = (item.species ?? 'lovebug') === 'wasp';
                  return (
                    <div className={`report-item ${isWasp ? 'wasp' : ''}`} key={item.id}>
                      <span className="report-emoji" aria-hidden="true">{sp.emoji}</span>
                      <span>
                        <strong>
                          {sp.name}{isWasp ? '집' : ''} · {item.regionName}{item.dong ? ` ${item.dong}` : ''} · {item.place}
                        </strong>
                        <small>
                          {item.verified ? '✅ 인증 제보' : '제보'}{item.locationVerified ? ' · 📍 위치 인증' : ''} · {item.reporterName ? `${item.reporterName} · ` : ''}
                          {item.amount} · {item.time}{item.memo ? ` · ${item.memo}` : ''}
                        </small>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'forecast' && (
            <div className="tab-pane">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">현재 위치 예보</p>
                  <h3>{forecastRegion.name} {activeForecastDong} 출몰위험도 예보</h3>
                  <p className="forecast-note">
                    기상청 단기예보(오늘~모레)의 기온·습도·강수·바람에 우리 동네 제보 수를 조합해 위험도를 계산해요.
                  </p>
                </div>
              </div>
              <div className="forecast-picker" aria-label="예보 동네 선택">
                <label>
                  구 선택
                  <select
                    value={forecastRegionId}
                    onChange={(event) => {
                      const nextRegion = REGIONS.find((region) => region.id === event.target.value);
                      const nextDongs = getDongRisk(nextRegion, nextRegion.reports).sort((a, b) =>
                        a.name.localeCompare(b.name, 'ko')
                      );
                      setForecastRegionId(event.target.value);
                      setForecastDong(nextDongs[0]?.name ?? '');
                    }}
                  >
                    {sortedForecastRegions.map((region) => (
                      <option value={region.id} key={region.id}>{region.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  동 선택
                  <select value={activeForecastDong} onChange={(event) => setForecastDong(event.target.value)}>
                    {sortedForecastDongs.map((dong) => (
                      <option value={dong.name} key={dong.name}>{dong.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="forecast-list">
                {forecast.map((day, index) => (
                  <div className="forecast-card" key={day.day}>
                    {day.weather.includes('비') ? <CloudRain size={21} /> : <Sun size={21} />}
                    <strong>{formatForecastDay(index)}</strong>
                    <span>{day.temp}°C</span>
                    <small>{day.weather}</small>
                    <b>{getForecastRiskLabel(day.risk)} · 지수 {day.risk.score}</b>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'places' && (
            <div className="tab-pane">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">야외 나들이 가이드</p>
                  <h3>오늘 어디가 위험할까?</h3>
                </div>
                <AlertTriangle size={20} />
              </div>
              <div className="outdoor-list">
                {HOTSPOTS.map((spot) => (
                  <div className="outdoor-card" key={spot.place}>
                    <div className="outdoor-head">
                      <strong><span className="outdoor-icon" aria-hidden="true">{spot.icon}</span>{spot.place}</strong>
                      <b className="outdoor-level">{spot.level}</b>
                    </div>
                    <p className="outdoor-why">{spot.why}</p>
                    <p className="outdoor-tip">💡 {spot.tip}</p>
                  </div>
                ))}
              </div>

              <p className="eyebrow activity-eyebrow">활동별 대비 팁</p>
              <div className="activity-list">
                {ACTIVITY_TIPS.map((act) => (
                  <div className="activity-card" key={act.title}>
                    <strong><span className="activity-icon" aria-hidden="true">{act.icon}</span>{act.title}</strong>
                    <p>{act.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'spots' && (
            <div className="tab-pane">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">우리동네 야외장소</p>
                  <h3>오늘, {selected.name} 어디가 좋을까?</h3>
                </div>
                <MapPin size={20} />
              </div>
              <label className="map-region-select spots-select">
                <span>구 선택</span>
                <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                  {sortedForecastRegions.map((region) => (
                    <option key={region.id} value={region.id}>{region.name}</option>
                  ))}
                </select>
              </label>
              {!weatherReady ? (
                <p className="spots-loading">⏳ 기상청 예보를 불러오는 중… 잠시만요</p>
              ) : (
                <>
                  {favorites.length > 0 && (
                    <div className="fav-section">
                      <p className="eyebrow">⭐ 내 즐겨찾기 · {favorites.length}곳</p>
                      <div className="spots-list">
                        {favorites.map((f) => {
                          const risk = speciesPlaceRisk(activeSpeciesId, guScoreById[f.gu] ?? 0, f.env);
                          return (
                            <div className={`spot-card ${risk.tone}`} key={`${f.gu}|${f.name}`}>
                              <div className="spot-head">
                                <div className="spot-title">
                                  <strong>{f.name}</strong>
                                  <span className="spot-meta">{regionNameById[f.gu] ?? f.gu} · {PLACE_ENV[f.env]?.label}</span>
                                </div>
                                <div className="spot-right">
                                  <b className={`spot-badge ${risk.tone}`}>{risk.label}<i>{risk.score}</i></b>
                                  <button
                                    type="button"
                                    className="spot-fav on"
                                    onClick={() => toggleFav(f.gu, f.name, f.act, f.env)}
                                    aria-label="즐겨찾기 해제"
                                  >
                                    ★
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <p className="spots-intro">오늘 날씨로 계산한 위험도와 추천 시간이에요. <b>회피보다 대안</b> — 위험한 곳 대신 같은 동네 안전한 곳을 골라보세요. 자주 가는 곳은 ☆를 눌러 즐겨찾기하세요.</p>
                  <div className="spots-list">
                    {(DISTRICT_PLACES[selectedId] ?? []).map((place) => {
                      const placeRisk = speciesPlaceRisk(activeSpeciesId, updatedRisk.score, place.env);
                      return (
                        <div className={`spot-card ${placeRisk.tone}`} key={place.name}>
                          <div className="spot-head">
                            <div className="spot-title">
                              <strong>{place.name}</strong>
                              <span className="spot-meta">{place.act} · {PLACE_ENV[place.env]?.label}</span>
                            </div>
                            <div className="spot-right">
                              <b className={`spot-badge ${placeRisk.tone}`}>{placeRisk.label}<i>{placeRisk.score}</i></b>
                              <button
                                type="button"
                                className={`spot-fav ${isFav(selectedId, place.name) ? 'on' : ''}`}
                                onClick={() => toggleFav(selectedId, place.name, place.act, place.env)}
                                aria-label={isFav(selectedId, place.name) ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                              >
                                {isFav(selectedId, place.name) ? '★' : '☆'}
                              </button>
                            </div>
                          </div>
                          <p className="spot-time">🕒 {placeTimeAdvice(placeRisk.tone)}</p>
                        </div>
                      );
                    })}
                  </div>
                  {!DISTRICT_PLACES[selectedId] && (
                    <p className="spots-empty">이 구의 장소는 곧 추가할게요.</p>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'bugs' && (
            <div className="tab-pane">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">벌레 도감</p>
                  <h3>이 벌레, 익충일까 해충일까?</h3>
                </div>
                <Bug size={20} />
              </div>
              <p className="bug-intro">러브버그처럼 징그러워도 사람에게 이로운 곤충이 많아요. 미리 알아두면 덜 무섭고, 함부로 죽이지 않게 돼요.</p>

              <p className="eyebrow bug-group good">🟢 이로운 곤충 · 익충</p>
              <div className="bug-list">
                {BUGS.filter((b) => b.good).map((bug) => (
                  <div className="bug-card good" key={bug.name}>
                    <div className="bug-head">
                      <strong>
                        <span className="bug-icon" aria-hidden="true">{bug.icon}</span>{bug.name}
                        {bug.sub && <span className="bug-sub">{bug.sub}</span>}
                      </strong>
                      <b className="bug-tag good">{bug.tag}</b>
                    </div>
                    <p className="bug-desc">{bug.desc}</p>
                    <p className="bug-tip">💡 {bug.tip}</p>
                  </div>
                ))}
              </div>

              <p className="eyebrow bug-group bad">🔴 주의할 곤충</p>
              <div className="bug-list">
                {BUGS.filter((b) => !b.good).map((bug) => (
                  <div className="bug-card bad" key={bug.name}>
                    <div className="bug-head">
                      <strong>
                        <span className="bug-icon" aria-hidden="true">{bug.icon}</span>{bug.name}
                        {bug.sub && <span className="bug-sub">{bug.sub}</span>}
                      </strong>
                      <b className="bug-tag bad">{bug.tag}</b>
                    </div>
                    <p className="bug-desc">{bug.desc}</p>
                    <p className="bug-tip">💡 {bug.tip}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'guide' && (
            <div className="tab-pane">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">행동 안내</p>
                  <h3>오늘의 대응 가이드</h3>
                </div>
                <Bug size={20} />
              </div>
              <div className="guide-list">
                {ACTION_GUIDES.map((item) => (
                  <div className="guide-card" key={item.title}>
                    <strong><span aria-hidden="true">{item.icon}</span> {item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                ))}
              </div>

              <div className="index-explainer">
                <h4>🐞 출몰지수는 어떻게 나오나요?</h4>
                <p>
                  각 동네의 <b>날씨</b>(기온·습도·강수·바람)와 <b>지형</b>(산자락 인접도), 그리고
                  <b> 시민 제보</b>를 합쳐 0~100으로 계산해요. 러브버그는 25~30℃·고습·약풍·비 온
                  직후·산 근처에서 많이 나오는 특성을 반영합니다.
                </p>
                <ul className="index-factors">
                  <li><b>🌡️ 날씨·지형 60%</b> — 기상청 실시간 예보로 ‘오늘 나오기 좋은 조건인지’ 판단</li>
                  <li><b>📝 시민 제보 40%</b> — 실제 목격담. 쌓일수록 추정이 실측으로 바뀌어 정확해져요</li>
                </ul>
                <p className="index-note">
                  💡 지금은 제보 초기라 날씨·지형 비중이 커요. <b>제보가 모일수록</b> 우리 동네 예보가
                  더 정확해집니다. 같은 구라도 제보가 많은 동이 더 높게 표시돼요. 그리고 러브버그
                  활동기(6월 중순~7월 초)에서 멀어질수록 지수는 자연히 낮아져요.
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      <footer className="app-footer">
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
          개인정보 처리방침
        </a>
        <span className="app-footer-dot">·</span>
        <span>© 2026 Yeol Studio</span>
      </footer>
    </main>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="metric-card">
      {React.cloneElement(icon, { size: 22 })}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
