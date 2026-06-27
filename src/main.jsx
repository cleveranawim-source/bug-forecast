import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  Bell,
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
import seoulAreas from './seoul_areas.json';
import aiMap from './seoul_ai_map.json';
import { getRisk } from './lib/risk.js';
import { addReport, subscribeReports, countByDong } from './lib/reports.js';
import { fetchAllDistricts } from './lib/weather.js';
import { signInWithGoogle, signOutUser } from './lib/auth.js';

const CITIZEN_SESSION_KEY = 'neighborhood-bug-forecast-citizen';

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
    trend: '+11',
    map: { col: 2, row: 3 },
    note: '비 온 뒤 아파트 단지 조명 주변 출몰이 늘었어요.',
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
    trend: '+3',
    map: { col: 5, row: 1 },
    note: '산지와 주거지 경계에서 산발 제보가 들어오고 있어요.',
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
    trend: '+6',
    map: { col: 6, row: 1 },
    note: '하천 주변과 단지 조명 주변 관찰이 조금 늘었어요.',
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
    trend: '+4',
    map: { col: 4, row: 2 },
    note: '주택가 골목 조명과 공원 입구에서 제보가 있어요.',
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
    trend: '+2',
    map: { col: 5, row: 2 },
    note: '대학가와 공원 주변으로 보통 수준의 관찰이 있어요.',
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
    trend: '+2',
    map: { col: 4, row: 3 },
    note: '공원 입구와 골목 조명 근처에서 산발 제보가 있어요.',
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
    trend: '+5',
    map: { col: 5, row: 3 },
    note: '청계천 주변과 상가 조명 주변 출몰 가능성이 있어요.',
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
    trend: '+7',
    map: { col: 6, row: 3 },
    note: '중랑천 산책로 중심으로 저녁 시간대 주의가 필요해요.',
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
    trend: '+6',
    map: { col: 3, row: 4 },
    note: '학교와 주거지 사이 녹지 주변에서 제보가 많아요.',
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
    trend: '+1',
    map: { col: 4, row: 4 },
    note: '도심권은 낮지만 조명 밀집 구역은 부분 주의가 필요해요.',
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
    trend: '+8',
    map: { col: 5, row: 4 },
    note: '한강과 중랑천 인접 구역에서 위험도가 올라가고 있어요.',
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
    trend: '+10',
    map: { col: 6, row: 4 },
    note: '한강변 공원과 주거지 조명 주변 제보가 늘었어요.',
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
    trend: '+7',
    map: { col: 2, row: 5 },
    note: '하천 산책로와 밝은 상가 주변 제보가 많아요.',
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
    trend: '+3',
    map: { col: 4, row: 5 },
    note: '한강 접근부와 공원 주변에서 보통 수준으로 관찰돼요.',
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
    trend: '+12',
    map: { col: 8, row: 5 },
    note: '고덕천과 한강변 중심으로 높은 위험도가 예상돼요.',
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
    trend: '+13',
    map: { col: 1, row: 6 },
    note: '습도가 높고 하천 주변 제보가 많아 강한 주의가 필요해요.',
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
    trend: '+7',
    map: { col: 2, row: 6 },
    note: '안양천 주변과 아파트 단지 조명 주변 위험도가 높아요.',
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
    trend: '+6',
    map: { col: 3, row: 6 },
    note: '한강변과 상업지 조명 주변에서 제보가 이어져요.',
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
    trend: '+4',
    map: { col: 4, row: 6 },
    note: '학교 주변과 산책로 중심으로 보통 수준의 주의가 필요해요.',
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
    trend: '+3',
    map: { col: 5, row: 6 },
    note: '도심 열기와 공원 주변 조건이 겹치는 구간을 살펴야 해요.',
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
    trend: '+5',
    map: { col: 6, row: 6 },
    note: '상가 조명과 탄천 주변으로 저녁 제보가 늘 수 있어요.',
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
    trend: '+12',
    map: { col: 7, row: 6 },
    note: '탄천과 한강변 영향으로 매우 높은 위험도가 예상돼요.',
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
    trend: '+6',
    map: { col: 2, row: 7 },
    note: '안양천 인접 구역과 주거지 조명 주변을 확인해 주세요.',
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
    trend: '+3',
    map: { col: 3, row: 7 },
    note: '전반적으로 보통이지만 하천 산책로는 부분 주의가 필요해요.',
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
    trend: '+5',
    map: { col: 4, row: 7 },
    note: '공원과 학교 주변에서 산발 제보가 이어지고 있어요.',
  },
];

const DISTRICT_DONGS = {
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

const FORECAST_OFFSETS = [
  { day: '오늘', temp: 0, humidity: 0, rain: 0, reports: 0, weather: '습도 관찰' },
  { day: '내일', temp: -1, humidity: 2, rain: 5, reports: 1, weather: '흐림' },
  { day: '3일 뒤', temp: 1, humidity: 6, rain: 12, reports: 2, weather: '비 뒤 갬' },
  { day: '4일 뒤', temp: 2, humidity: -4, rain: -10, reports: -2, weather: '맑음' },
  { day: '5일 뒤', temp: 0, humidity: -1, rain: -4, reports: -1, weather: '구름' },
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
    desc: '피를 빨고 일본뇌염 같은 병을 옮길 수 있어요. 고인 물에 알을 낳아 빠르게 늘어나요.',
    tip: '집 주변 고인 물(화분 받침·빈 그릇)을 비워요. 해질녘부터 밤까지는 긴 옷이나 기피제로 막아요.',
  },
  {
    icon: '🕷️', name: '진드기', good: false, tag: '주의',
    desc: '풀숲에 숨어 피를 빨고, 중증열성혈소판감소증(SFTS) 같은 감염병을 옮길 수 있어 특히 조심해야 해요.',
    tip: '풀밭에선 긴 옷·양말을 신고 돗자리를 깔아요. 물렸다면 비비지 말고 핀셋으로 천천히 빼낸 뒤 병원에 가요.',
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
const DISTRICT_PLACES = {
  gangseo: [
    { name: '가양·방화 한강공원', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '궁산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '서울식물원', act: '👶 나들이', env: 'urban' },
  ],
  yangcheon: [
    { name: '안양천 산책로', act: '🏃 러닝·라이딩', env: 'riverside' },
    { name: '신정산 근린공원', act: '🚶 산책', env: 'mountain' },
    { name: '파리공원', act: '👶 나들이', env: 'urban' },
  ],
  guro: [
    { name: '안양천 자전거길', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '천왕산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '푸른수목원', act: '👶 나들이', env: 'urban' },
  ],
  geumcheon: [
    { name: '안양천 산책로', act: '🏃 러닝', env: 'riverside' },
    { name: '호암산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '금천한내근린공원', act: '👶 나들이', env: 'urban' },
  ],
  yeongdeungpo: [
    { name: '여의도 한강공원', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '선유도공원', act: '👶 나들이', env: 'riverside' },
    { name: '영등포공원', act: '🚶 산책', env: 'urban' },
  ],
  dongjak: [
    { name: '보라매공원', act: '🏃 러닝·나들이', env: 'urban' },
    { name: '국사봉 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '노들나루공원', act: '🚶 산책', env: 'riverside' },
  ],
  gwanak: [
    { name: '관악산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '도림천 산책로', act: '🏃 러닝', env: 'riverside' },
    { name: '낙성대공원', act: '👶 나들이', env: 'urban' },
  ],
  seocho: [
    { name: '양재천 산책로', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '우면산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '양재시민의숲', act: '👶 나들이', env: 'urban' },
  ],
  gangnam: [
    { name: '양재천 산책로', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '대모산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '도산공원', act: '👶 나들이', env: 'urban' },
  ],
  songpa: [
    { name: '잠실 한강공원', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '석촌호수', act: '🚶 산책·나들이', env: 'urban' },
    { name: '송파둘레길', act: '🏃 러닝·산책', env: 'riverside' },
    { name: '성내천 산책로', act: '🚶 산책', env: 'riverside' },
    { name: '올림픽공원', act: '👶 나들이', env: 'urban' },
  ],
  gangdong: [
    { name: '암사 한강공원', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '일자산 허브천문공원', act: '🚶 산책', env: 'mountain' },
    { name: '고덕수변생태공원', act: '👶 나들이', env: 'riverside' },
  ],
  gwangjin: [
    { name: '뚝섬 한강공원', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '아차산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '어린이대공원', act: '👶 나들이', env: 'urban' },
  ],
  seongdong: [
    { name: '서울숲', act: '🏃 러닝·나들이', env: 'urban' },
    { name: '응봉산 팔각정', act: '🚶 산책', env: 'mountain' },
    { name: '살곶이체육공원', act: '🚴 라이딩', env: 'riverside' },
  ],
  jungnang: [
    { name: '중랑천 자전거길', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '봉화산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '용마폭포공원', act: '👶 나들이', env: 'urban' },
  ],
  dongdaemun: [
    { name: '중랑천 산책로', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '배봉산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '청계천 산책로', act: '🚶 산책', env: 'riverside' },
  ],
  seongbuk: [
    { name: '성북천 산책로', act: '🚶 산책', env: 'riverside' },
    { name: '북악산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '오동근린공원', act: '👶 나들이', env: 'urban' },
  ],
  jongno: [
    { name: '청계천 산책로', act: '🚶 산책', env: 'riverside' },
    { name: '인왕산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '삼청공원', act: '👶 나들이', env: 'urban' },
  ],
  jung: [
    { name: '청계천 산책로', act: '🏃 러닝·산책', env: 'riverside' },
    { name: '남산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '장충단공원', act: '👶 나들이', env: 'urban' },
  ],
  yongsan: [
    { name: '이촌 한강공원', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '남산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '용산가족공원', act: '👶 나들이', env: 'urban' },
  ],
  seodaemun: [
    { name: '홍제천 산책로', act: '🏃 러닝·산책', env: 'riverside' },
    { name: '안산 자락길', act: '🚶 산책', env: 'mountain' },
    { name: '서대문독립공원', act: '👶 나들이', env: 'urban' },
  ],
  mapo: [
    { name: '망원 한강공원', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '경의선숲길', act: '🚶 산책·러닝', env: 'urban' },
    { name: '하늘공원', act: '👶 나들이', env: 'urban' },
  ],
  eunpyeong: [
    { name: '불광천 산책로', act: '🏃 러닝·산책', env: 'riverside' },
    { name: '북한산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '진관근린공원', act: '👶 나들이', env: 'urban' },
  ],
  gangbuk: [
    { name: '우이천 산책로', act: '🚶 산책', env: 'riverside' },
    { name: '북한산 우이령길', act: '🚶 산책', env: 'mountain' },
    { name: '북서울꿈의숲', act: '👶 나들이', env: 'urban' },
  ],
  dobong: [
    { name: '중랑천 자전거길', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '도봉산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '서울창포원', act: '👶 나들이', env: 'urban' },
  ],
  nowon: [
    { name: '중랑천 산책로', act: '🚴 라이딩·러닝', env: 'riverside' },
    { name: '불암산 둘레길', act: '🚶 산책', env: 'mountain' },
    { name: '경춘선숲길', act: '🚶 산책', env: 'urban' },
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

// 상위 탭 3개 + 각 그룹 안의 세그먼트(서브탭). activeTab은 세그먼트 id(기존 값) 그대로 유지.
const TAB_GROUPS = [
  {
    id: 'home',
    label: '📍 우리동네',
    segs: [
      { id: 'main', label: '요약' },
      { id: 'map', label: '지도' },
      { id: 'forecast', label: '예보' },
      { id: 'spots', label: '장소' },
    ],
  },
  {
    id: 'guideGroup',
    label: '🐞 가이드',
    segs: [
      { id: 'places', label: '출몰장소' },
      { id: 'bugs', label: '벌레도감' },
      { id: 'guide', label: '행동요령' },
    ],
  },
  {
    id: 'report',
    label: '✍️ 제보',
    segs: [{ id: 'report', label: '제보' }],
  },
];

const MAP_WIDTH = 940;
const MAP_HEIGHT = 620;
const MAP_PADDING = 28;

// 서울시 공식 지도 이미지(map_0.png) 크기 — area 좌표계 및 SVG 오버레이 viewBox
const MAP_IMG_W = 533;
const MAP_IMG_H = 437;

// 한강 중심선(서→동, 주요 다리 위경도). 구 경계와 같은 투영으로 그려 정확히 맞물린다.
const HAN_RIVER = [
  [126.818, 37.601], [126.857, 37.567], [126.891, 37.552], [126.901, 37.539],
  [126.928, 37.531], [126.937, 37.527], [126.958, 37.517], [126.979, 37.512],
  [126.996, 37.512], [127.009, 37.523], [127.024, 37.530], [127.042, 37.527],
  [127.054, 37.524], [127.082, 37.520], [127.094, 37.527], [127.103, 37.544],
  [127.127, 37.560],
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

function projectPoint([lon, lat], bounds) {
  const usableWidth = MAP_WIDTH - MAP_PADDING * 2;
  const usableHeight = MAP_HEIGHT - MAP_PADDING * 2;
  const rawX = (lon - bounds.minLon) / (bounds.maxLon - bounds.minLon);
  const rawY = (bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat);
  return [MAP_PADDING + rawX * usableWidth, MAP_PADDING + rawY * usableHeight];
}

function geometryToPath(geometry, bounds) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons
    .map((polygon) =>
      polygon
        .map((ring) =>
          ring
            .map((point, index) => {
              const [x, y] = projectPoint(point, bounds);
              return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ') + ' Z'
        )
        .join(' ')
    )
    .join(' ');
}

function getFeatureCenter(geometry, bounds) {
  const points = flattenCoordinates(geometry.coordinates).map((point) => projectPoint(point, bounds));
  const totals = points.reduce((sum, [x, y]) => ({ x: sum.x + x, y: sum.y + y }), { x: 0, y: 0 });
  return [totals.x / points.length, totals.y / points.length];
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

function getForecastRiskLabel(risk) {
  if (risk.tone === 'danger') return '🔴 출몰 많음';
  if (risk.tone === 'warning') return '🟠 출몰 주의';
  if (risk.tone === 'notice') return '🟡 출몰 보통';
  return '🟢 출몰 적음';
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

function makeForecast(region, reportCount, dongRisk) {
  return FORECAST_OFFSETS.map((day) => {
    const dongAdjustment = dongRisk ? Math.round((dongRisk.score - 55) / 8) : 0;
    const simulated = {
      ...region,
      temp: region.temp + day.temp,
      humidity: Math.max(35, Math.min(95, region.humidity + day.humidity)),
      rain: Math.max(0, Math.min(100, region.rain + day.rain)),
      reports: Math.max(0, reportCount + day.reports + dongAdjustment),
    };
    return {
      ...day,
      temp: simulated.temp,
      risk: getRisk(simulated),
    };
  });
}

function getDongRisk(region, reportCount, dongCounts = {}) {
  const dongs = DISTRICT_DONGS[region.id] ?? [`${region.name.replace(/구$/, '')}1동`];
  return dongs.map((name) => {
    const dongReports = dongCounts[name] ?? 0;
    // 동은 구의 환경·관측수준을 그대로 물려받고(=구 지수가 기본값), 실제 동 제보가 있으면
    // 그 위로 가산한다. → 제보 전엔 동=구로 일치하고, 상·하위 지수가 어긋나지 않는다.
    const reports = reportCount + dongReports * 3;
    return {
      name,
      risk: getRisk({ ...region, reports }),
      reports: dongReports,
    };
  });
}

function readCitizenSession() {
  try {
    const saved = window.sessionStorage.getItem(CITIZEN_SESSION_KEY);
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
  const [forecastRegionId, setForecastRegionId] = useState('eunpyeong');
  const [forecastDong, setForecastDong] = useState('녹번동');
  const [citizen, setCitizen] = useState(null);
  const [reports, setReports] = useState([]);
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
  const totalReports = selected.reports + reports.filter((item) => item.regionId === selected.id).length;
  const updatedSelected = { ...selected, reports: totalReports };
  const updatedRisk = getRisk(updatedSelected);
  const selectedDongs = getDongRisk(selected, totalReports, countByDong(reports, selected.id));
  const forecastRegion = regions.find((region) => region.id === forecastRegionId) ?? selected;
  const forecastTotalReports =
    forecastRegion.reports + reports.filter((item) => item.regionId === forecastRegion.id).length;
  const forecastDongs = getDongRisk(forecastRegion, forecastTotalReports, countByDong(reports, forecastRegion.id));
  const sortedForecastRegions = useMemo(
    () => [...REGIONS].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    []
  );
  const loginRegion = regions.find((region) => region.id === loginForm.regionId) ?? selected;
  const loginDongs = useMemo(
    () => getDongRisk(loginRegion, loginRegion.reports).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [loginRegion]
  );
  const sortedForecastDongs = useMemo(
    () => [...forecastDongs].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [forecastDongs]
  );
  const activeForecastDong = forecastDongs.some((dong) => dong.name === forecastDong)
    ? forecastDong
    : forecastDongs[0]?.name;
  const activeForecastDongRisk = forecastDongs.find((dong) => dong.name === activeForecastDong)?.risk;
  const forecast = makeForecast(forecastRegion, forecastTotalReports, activeForecastDongRisk);
  const riskSummary = regions.reduce(
    (summary, region) => {
      const regionRisk = getRisk({
        ...region,
        reports: region.reports + reports.filter((item) => item.regionId === region.id).length,
      });
      summary[regionRisk.tone] += 1;
      return summary;
    },
    { calm: 0, notice: 0, warning: 0, danger: 0 }
  );
  const geoBounds = useMemo(() => getGeoBounds(seoulGeo), []);
  const hanRiverPath = useMemo(() => {
    return HAN_RIVER.map((point, index) => {
      const [x, y] = projectPoint(point, geoBounds);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }, [geoBounds]);
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
        const reportCount =
          region.reports + reports.filter((item) => item.regionId === region.id).length;
        const risk = getRisk({ ...region, reports: reportCount });
        return { region, risk, reportCount, d: d.d, labelX: d.labelX, labelY: d.labelY };
      })
      .filter(Boolean);
  }, [regionByName, reports]);

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
      const risk = info ? info.risk : getRisk(selected);
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
  const geoFeatures = useMemo(
    () =>
      seoulGeo.features
        .map((feature) => {
          const region = regionByName[feature.properties.name];
          if (!region) return null;
          const regionReportCount =
            region.reports + reports.filter((item) => item.regionId === region.id).length;
          const risk = getRisk({ ...region, reports: regionReportCount });
          const [labelX, labelY] = getFeatureCenter(feature.geometry, geoBounds);
          return {
            feature,
            region,
            regionReportCount,
            risk,
            path: geometryToPath(feature.geometry, geoBounds),
            labelX,
            labelY,
          };
        })
        .filter(Boolean),
    [geoBounds, regionByName, reports]
  );

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
    fetchAllDistricts()
      .then((data) => setLiveWeather(data))
      .catch((error) => console.warn('기상청 일괄 조회 실패:', error.message));
  }, []);

  useEffect(() => {
    // 실날씨가 7초 안에 안 오면(폰 지연·실패) 시드값으로라도 표시 — 지도가 계속 회색으로 남지 않게.
    const timeout = setTimeout(() => setWeatherTimedOut(true), 7000);
    return () => clearTimeout(timeout);
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
    if (!citizen || locationAuth.status !== 'verified') return;
    try {
      await addReport({
        uid: citizen.uid,
        regionId: selected.id,
        regionName: selected.name,
        reporterName: citizen.nickname || citizen.name || '동네관찰러',
        reporterDong: `${citizen.regionName} ${citizen.dong}`,
        locationVerified: true,
        locationLabel: locationAuth.coords
          ? `위치 인증 ${locationAuth.coords.latitude.toFixed(3)}, ${locationAuth.coords.longitude.toFixed(3)}`
          : '위치 인증 완료',
        lat: locationAuth.coords?.latitude ?? null,
        lng: locationAuth.coords?.longitude ?? null,
        place: reportForm.place,
        amount: reportForm.amount,
        memo: reportForm.memo,
        dong: reportForm.dong || selectedDongs[0]?.name || selected.name,
      });
      setReportForm({ dong: '', place: '학교 주변', amount: '많음', memo: '' });
    } catch (error) {
      console.error('제보 저장 실패:', error);
      alert('제보 저장에 실패했어요. 잠시 후 다시 시도해 주세요.');
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    try {
      const user = await signInWithGoogle();
      const region = regions.find((item) => item.id === loginForm.regionId) ?? selected;
      const nextCitizen = {
        uid: user.uid,
        nickname: loginForm.nickname.trim() || user.displayName || '동네관찰러',
        provider: 'Google',
        email: user.email ?? null,
        photoURL: user.photoURL ?? null,
        regionId: loginForm.regionId,
        regionName: region.name,
        dong: loginForm.dong,
        verifiedAt: new Date().toISOString(),
      };
      window.sessionStorage.setItem(CITIZEN_SESSION_KEY, JSON.stringify(nextCitizen));
      setCitizen(nextCitizen);
    } catch (error) {
      // 사용자가 팝업을 닫은 경우는 조용히 넘어간다.
      if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
        console.error('Google 로그인 실패:', error);
        alert('Google 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.');
      }
    }
  }

  function logoutCitizen() {
    signOutUser().catch((error) => console.error('로그아웃 실패:', error));
    window.sessionStorage.removeItem(CITIZEN_SESSION_KEY);
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
      <section className="topbar" aria-label="앱 상단">
        <div>
          <p className="eyebrow">지역 제보 기반 예측</p>
          <h1>🐞 우리동네 벌레예보</h1>
        </div>
        <button className="icon-button" aria-label="알림 설정">
          <Bell size={21} />
        </button>
      </section>

      <nav className="app-tabs" aria-label="앱 화면 탭">
        {TAB_GROUPS.map((group) => {
          const active = group.id === activeTab || group.segs.some((seg) => seg.id === activeTab);
          return (
            <button
              className={active ? 'active' : ''}
              key={group.id}
              onClick={() => setActiveTab(group.segs[0]?.id ?? group.id)}
            >
              {group.label}
            </button>
          );
        })}
      </nav>

      {(() => {
        const group = TAB_GROUPS.find(
          (g) => g.id === activeTab || g.segs.some((seg) => seg.id === activeTab)
        );
        if (!group || group.segs.length <= 1) return null;
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
      <section className={`hero risk-${updatedRisk.tone}`}>
        <div className="hero-copy">
          <div className="location-pill">
            <MapPin size={17} />
            {selected.name} · {selected.zone}
          </div>
          <h2>오늘 {getForecastRiskLabel(updatedRisk)}</h2>
          <p>{selected.note}</p>
          <div className="hero-actions">
            <button
              className="secondary-action"
              onClick={verifyCurrentLocation}
              disabled={locationAuth.status === 'checking'}
            >
              <MapPin size={18} />
              현재 위치 적용
            </button>
            <button className="primary-action" onClick={openNearby}>
              <Navigation size={18} />
              내 주변 보기
            </button>
          </div>
          <span className={`location-status ${locationAuth.status}`}>{locationAuth.message}</span>
        </div>
        <div className="risk-gauge" aria-label={`위험도 ${updatedRisk.score}점`}>
          <span className="gauge-eyebrow">현재 위치 기준</span>
          <div className="gauge-ring" style={{ '--score': `${updatedRisk.score}%` }}>
            <div className="gauge-core">
              <Bug size={35} />
              <strong>{updatedRisk.score}</strong>
            </div>
          </div>
          <span className="gauge-label">위험 지수</span>
          <b className={`gauge-status ${updatedRisk.tone}`}>{getForecastRiskLabel(updatedRisk)}</b>
        </div>
      </section>

      <section className="metric-grid" aria-label="현재 조건">
        <Metric icon={<ThermometerSun />} label="기온" value={`${selected.temp}°C`} />
        <Metric icon={<Droplets />} label="습도" value={`${selected.humidity}%`} />
        <Metric icon={<CloudRain />} label="강수 가능" value={`${selected.rain}%`} />
        <Metric icon={<Wind />} label="바람" value={`${selected.wind}m/s`} />
      </section>

      <section className={`nearby-panel ${showNearby ? 'open' : ''}`} ref={nearbyRef} aria-label="내 주변 현황">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">선택 지역 기준</p>
            <h3>내 주변 보기</h3>
          </div>
          <Navigation size={20} />
        </div>
        <div className="nearby-grid">
          <div className="nearby-main">
            <span className={`risk-dot ${updatedRisk.tone}`} />
            <div>
              <strong>{selected.name} 주변 {getForecastRiskLabel(updatedRisk)}</strong>
              <p>위치 권한 없이 선택한 구를 기준으로 동별 위험지수와 제보 수를 보여줘요.</p>
            </div>
          </div>
          <div className="nearby-stat">
            <b>{totalReports}</b>
            <span>현재 제보</span>
          </div>
          <div className="nearby-stat">
            <b>{HOTSPOTS[0].place}</b>
            <span>가장 많은 장소</span>
          </div>
        </div>
        <div className="nearby-dong-board" aria-label={`${selected.name} 동별 수치`}>
          {selectedDongs.map((dong) => (
            <button
              className="nearby-dong-row"
              key={dong.name}
              onClick={() => setReportForm({ ...reportForm, dong: dong.name })}
            >
              <span className={`legend-dot ${dong.risk.tone}`} />
              <strong>{dong.name}</strong>
              <b>{dong.risk.score}</b>
              <small>{getForecastRiskLabel(dong.risk)} · 제보 {dong.reports}건</small>
            </button>
          ))}
        </div>
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

          <div className="seoul-map-wrap">
            <div className="map-summary" aria-label="서울시 위험도 요약">
              {weatherReady ? (
                <>
                  <span><b>{riskSummary.danger}개 구</b> 🔴 출몰 많음</span>
                  <span><b>{riskSummary.warning}개 구</b> 🟠 출몰 주의</span>
                  <span><b>{riskSummary.notice}개 구</b> 🟡 출몰 보통</span>
                  <span><b>{riskSummary.calm}개 구</b> 🟢 출몰 적음</span>
                </>
              ) : (
                <span className="map-loading">⏳ 기상청 예보를 불러오는 중… 잠시 후 실시간 지수가 표시돼요</span>
              )}
            </div>
            <div className="seoul-map seoul-map-ai" role="group" aria-label="서울시 구별 벌레예보 지도">
              <svg
                className="seoul-map-svg"
                viewBox="20 2 1268 1032"
                role="img"
                aria-label="서울시 자치구 벌레예보"
              >
                {aiMap.river && <path className="ai-river" d={aiMap.river} />}
                {aiFeatures.map(({ region, risk, reportCount, d, labelX, labelY }) => {
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
                        aria-label={weatherReady ? `${region.name} ${getForecastRiskLabel(risk)} 제보 ${reportCount}건` : `${region.name} 예보 준비 중`}
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
            <div className="map-legend" aria-label="위험도 범례">
              <span><i className="legend-dot calm" />출몰 적음</span>
              <span><i className="legend-dot notice" />출몰 보통</span>
              <span><i className="legend-dot warning" />출몰 주의</span>
              <span><i className="legend-dot danger" />출몰 많음</span>
            </div>
          </div>

          <div className="selected-district">
            <div>
              <p className="eyebrow">선택 지역</p>
              <strong>{selected.name}</strong>
              <span>{selected.zone} · 제보 {totalReports}건</span>
            </div>
            <b className={`selected-risk ${updatedRisk.tone}`}>{getForecastRiskLabel(updatedRisk)}</b>
          </div>

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
                  <h3>{citizen ? '현재위치 인증 후 제보하기' : 'Google 로그인으로 시작하기'}</h3>
                </div>
              </div>

              {!citizen ? (
                <form onSubmit={submitLogin} className="login-form">
                  <p className="trust-copy">
                    신뢰할 수 있는 관측 정보로 쓰기 위해 Google 계정 인증과 현재위치 인증을 거친 뒤 기록해요. 공개 화면에는 닉네임만 표시됩니다.
                  </p>
                  <div className="google-auth-preview">
                    <span>G</span>
                    <div>
                      <strong>Google 계정 인증</strong>
                      <small>Google 계정으로 안전하게 로그인해요. 공개 화면엔 닉네임만 보여요.</small>
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
                    <span className="google-mark">G</span>
                    Google로 로그인
                  </button>
                </form>
              ) : (
                <>
                  <div className="citizen-card">
                    <div>
                      <p className="eyebrow">Google 인증 제보자</p>
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
                      />
                    </label>
                    <button
                      className="primary-action full"
                      type="submit"
                      disabled={locationAuth.status !== 'verified'}
                    >
                      <Plus size={18} />
                      {locationAuth.status === 'verified' ? `${selected.name} 인증 제보 등록` : '현재위치 인증 후 등록 가능'}
                    </button>
                  </form>
                </>
              )}

              <div className="recent-reports">
                {(reports.length ? reports : [
                  { id: 'sample-1', regionName: selected.name, place: '하천 산책로', amount: '많음', time: '오후 7:20', memo: '가로등 주변', reporterName: '동네관찰러', verified: true, locationVerified: true },
                  { id: 'sample-2', regionName: selected.name, place: '아파트 단지', amount: '조금', time: '오후 6:45', memo: '현관 근처', reporterName: '초록알림이', verified: true, locationVerified: true },
                ]).slice(0, 3).map((item) => (
                  <div className="report-item" key={item.id}>
                    <Bug size={18} />
                    <span>
                      <strong>{item.regionName}{item.dong ? ` ${item.dong}` : ''} · {item.place}</strong>
                      <small>
                        {item.verified ? '✅ 인증 제보' : '제보'}{item.locationVerified ? ' · 📍 위치 인증' : ''} · {item.reporterName ? `${item.reporterName} · ` : ''}
                        {item.amount} · {item.time}{item.memo ? ` · ${item.memo}` : ''}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'forecast' && (
            <div className="tab-pane">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">5일 예보 · 샘플 모델</p>
                  <h3>{forecastRegion.name} {activeForecastDong} 출몰위험도 예보</h3>
                  <p className="forecast-note">
                    기준: 선택한 구·동의 기온, 습도, 강수 가능성, 바람, 누적 제보 수를 조합해 위험도를 계산해요.
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
                  <p className="spots-intro">오늘 날씨로 계산한 위험도와 추천 시간이에요. <b>회피보다 대안</b> — 위험한 곳 대신 같은 동네 안전한 곳을 골라보세요.</p>
                  <div className="spots-list">
                    {(DISTRICT_PLACES[selectedId] ?? []).map((place) => {
                      const placeRisk = getPlaceRisk(updatedRisk.score, place.env);
                      return (
                        <div className={`spot-card ${placeRisk.tone}`} key={place.name}>
                          <div className="spot-head">
                            <div className="spot-title">
                              <strong>{place.name}</strong>
                              <span className="spot-meta">{place.act} · {PLACE_ENV[place.env]?.label}</span>
                            </div>
                            <b className={`spot-badge ${placeRisk.tone}`}>{placeRisk.label}<i>{placeRisk.score}</i></b>
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
                  더 정확해집니다. 같은 구라도 제보가 많은 동이 더 높게 표시돼요.
                </p>
              </div>
            </div>
          )}
        </section>
      )}
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
