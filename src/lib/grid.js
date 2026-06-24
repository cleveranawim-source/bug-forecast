// 위경도 ↔ 기상청 격자(nx, ny) 변환
// 기상청이 공개한 Lambert Conformal Conic 투영 공식. 단기예보 API는 위경도가 아니라
// 이 격자 좌표(5km 격자)를 받는다.
// 검증값: 서울시청(37.5665, 126.9780) → { nx: 60, ny: 127 }

const RE = 6371.00877; // 지구 반경(km)
const GRID = 5.0;      // 격자 간격(km)
const SLAT1 = 30.0;    // 표준위도 1
const SLAT2 = 60.0;    // 표준위도 2
const OLON = 126.0;    // 기준점 경도
const OLAT = 38.0;     // 기준점 위도
const XO = 43;         // 기준점 X좌표(격자)
const YO = 136;        // 기준점 Y좌표(격자)
const DEGRAD = Math.PI / 180.0;

export function latLonToGrid(lat, lon) {
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}
