// 홈 — '날씨 앱형' (2026-10-11)
// 화면 전체 하늘색이 오늘 위험도(calm·notice·warning·danger)를 따라 바뀌고, 큰 숫자 하나 + 한 줄 결론,
// 그 아래 반투명 카드(시간별 곡선·3일·오늘 우리 동네 벌레·왜/대처·계절·장소·제보)를 둔다.
// 움직임: 숫자 올라가기, 카드 떠오르기, 곡선 그리기, 하늘 크로스페이드, 스크롤 시 숫자 접힘, 빛 속 먼지.
// '동작 줄이기'를 켠 기기에선 움직임을 끈다.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import './home-sky.css';

const TONES = ['calm', 'notice', 'warning', 'danger'];
const DUST = { calm: 12, notice: 20, warning: 30, danger: 42 };

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// 앞에 붙은 이모지 한 덩어리를 뗀다(카드 안에서는 글자만 쓴다).
const stripEmoji = (s) => String(s ?? '').replace(/^\p{Extended_Pictographic}\S*\s*/u, '');

function useCountUp(target, ms = 900) {
  const [value, setValue] = useState(reduceMotion() ? target : 0);
  const fromRef = useRef(reduceMotion() ? target : 0);
  useEffect(() => {
    if (reduceMotion()) {
      setValue(target);
      return undefined;
    }
    const from = fromRef.current;
    const t0 = performance.now();
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(from + (target - from) * e);
      setValue(v);
      fromRef.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

// 카드가 화면에 들어오면 떠오르게
function Card({ className = '', delay = 0, children, onClick, label }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(reduceMotion());
  useEffect(() => {
    if (inView || !ref.current) return undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [inView]);
  const Tag = onClick ? 'button' : 'section';
  return (
    <Tag
      ref={ref}
      className={`sky-card ${inView ? 'in' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
      onClick={onClick}
      aria-label={label}
      type={onClick ? 'button' : undefined}
    >
      {children}
    </Tag>
  );
}

function CardLabel({ icon, children }) {
  return (
    <div className="sky-label">
      {icon}
      <span>{children}</span>
    </div>
  );
}

const I = {
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  ),
  cal: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
  ),
  list: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
  ),
  thermo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z" /></svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3 2 21h20z" /><path d="M12 10v5M12 18v.5" /></svg>
  ),
  leaf: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 19c8 0 14-6 14-14-8 0-14 6-14 14z" /><path d="M5 19 13 11" /></svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
  ),
  grid: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>
  ),
};

function WeatherIcon({ label }) {
  const l = String(label ?? '');
  if (/비|눈/.test(l))
    return (
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#bfe3ff" strokeWidth="1.8" aria-hidden="true"><path d="M7 15h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 15z" /><path d="M9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5" /></svg>
    );
  if (/흐림|구름/.test(l))
    return (
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#fff" strokeWidth="1.8" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 18z" /></svg>
    );
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#ffd98a" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="4.3" /><path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></svg>
  );
}

// 시간별 곡선 — 기상청 시간별 예보로 지수를 다시 계산한 값
function HourlyChart({ points }) {
  const W = 330;
  const H = 108;
  const pad = 10;
  if (points.length < 3) return null;
  const vals = points.map((p) => p.score);
  const lo = Math.min(...vals) - 6;
  const hi = Math.max(...vals) + 6;
  const xy = vals.map((v, i) => [pad + ((W - pad * 2) * i) / (vals.length - 1), H - 14 - ((H - 28) * (v - lo)) / Math.max(1, hi - lo)]);
  let d = `M${xy[0][0]},${xy[0][1]}`;
  for (let i = 1; i < xy.length; i += 1) {
    const [x0, y0] = xy[i - 1];
    const [x1, y1] = xy[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  const minI = vals.indexOf(Math.min(...vals));
  return (
    <div className="sky-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="skyArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".28" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="area" d={`${d} L${xy[xy.length - 1][0]},${H} L${xy[0][0]},${H} Z`} fill="url(#skyArea)" />
        <path className="ln" d={d} />
        <circle cx={xy[0][0]} cy={xy[0][1]} r="4.5" fill="#fff" />
        {minI > 0 && <circle cx={xy[minI][0]} cy={xy[minI][1]} r="4.5" fill="#a8f0cf" stroke="#fff" strokeWidth="1.5" />}
      </svg>
      <span className="sky-chart-now" style={{ left: `${(xy[0][0] / W) * 100}%`, top: xy[0][1] - 24 }}>{vals[0]}</span>
      {minI > 0 && (
        <span className="sky-chart-min" style={{ left: `${(xy[minI][0] / W) * 100}%`, top: xy[minI][1] + 8 }}>{vals[minI]}</span>
      )}
      <div className="sky-ticks">
        {points.map((p, i) => (
          <span key={p.stamp ?? i}>{i % 4 === 0 ? (i === 0 ? '지금' : `${p.hour}시`) : ''}</span>
        ))}
      </div>
    </div>
  );
}

// 빛 속 먼지 — 위험도가 높을수록 조금 더 많이, 아주 옅게
function Dust({ tone }) {
  const ref = useRef(null);
  const toneRef = useRef(tone);
  toneRef.current = tone;
  useEffect(() => {
    if (reduceMotion()) return undefined;
    const cv = ref.current;
    const cx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    let raf;
    let parts = [];
    const size = () => {
      cv.width = window.innerWidth * dpr;
      cv.height = window.innerHeight * dpr;
    };
    const spawn = () => ({
      x: Math.random() * cv.width,
      y: Math.random() * cv.height,
      r: (0.6 + Math.random() * 1.6) * dpr,
      vx: (Math.random() - 0.5) * 0.18 * dpr,
      vy: (-0.08 - Math.random() * 0.22) * dpr,
      a: 0.12 + Math.random() * 0.3,
      t: Math.random() * 6.28,
    });
    const tick = () => {
      const want = DUST[toneRef.current] ?? 20;
      while (parts.length < want) parts.push(spawn());
      if (parts.length > want) parts.length = want;
      cx.clearRect(0, 0, cv.width, cv.height);
      for (const p of parts) {
        p.t += 0.01;
        p.x += p.vx + Math.sin(p.t) * 0.15;
        p.y += p.vy;
        if (p.y < -10) {
          p.y = cv.height + 10;
          p.x = Math.random() * cv.width;
        }
        cx.beginPath();
        cx.arc(p.x, p.y, p.r, 0, 6.283);
        cx.fillStyle = `rgba(255,244,225,${p.a * (0.7 + 0.3 * Math.sin(p.t * 2))})`;
        cx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    size();
    window.addEventListener('resize', size);
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
    };
  }, []);
  return <canvas ref={ref} className="sky-dust" aria-hidden="true" />;
}

export default function HomeSky({
  regionName,
  region,
  risk,
  levelLabel,
  narrative,
  species,
  speciesId,
  speciesList,
  onPickSpecies,
  riskFn,
  hint,
  forecast,
  dayLabel,
  whyChips,
  care,
  seasonEvent,
  alerts,
  officialIndex,
  dongs,
  places,
  favoritesMode,
  placeAdvice,
  sourceLabel,
  stale,
  onNav,
}) {
  const tone = TONES.includes(risk.tone) ? risk.tone : 'notice';
  const level = stripEmoji(levelLabel);
  const score = useCountUp(risk.score);
  const heroRef = useRef(null);
  const [compact, setCompact] = useState(false);

  // 스크롤하면 큰 숫자가 접히고 위에 요약 줄이 붙는다
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setCompact(y > 200);
      if (reduceMotion() || !heroRef.current) return;
      const k = Math.min(1, y / 220);
      heroRef.current.style.transform = `translateY(${y * 0.35}px) scale(${1 - k * 0.12})`;
      heroRef.current.style.opacity = String(Math.max(0, 1 - k * 1.1));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 시간별 예보로 다시 계산한 지수(24시간)
  const hourly = useMemo(() => {
    const hours = region.hourly ?? [];
    return hours.map((h) => ({
      stamp: h.stamp,
      hour: h.hour,
      score: riskFn({ ...region, temp: h.temp, humidity: h.humidity, wind: h.wind, rain: h.rain }).score,
    }));
  }, [region, riskFn]);

  const dongsVary = dongs.length > 1 && new Set(dongs.map((d) => d.risk.score)).size > 1;

  return (
    <div className="home-sky" data-lv={tone}>
      <div className="sky-bg" aria-hidden="true">
        {TONES.map((t) => (
          <i key={t} className={`${t} ${t === tone ? 'on' : ''}`} />
        ))}
      </div>
      <div className="sky-grain" aria-hidden="true" />
      <Dust tone={tone} />

      <div className={`sky-compact ${compact ? 'show' : ''}`} aria-hidden={!compact}>
        {regionName}
        <b>·</b>
        <span className="num">{risk.score}</span>
        <b>·</b>
        {level}
      </div>

      <section className="sky-hero" ref={heroRef} aria-label={`오늘 ${species.name} 위험도 ${risk.score}점, ${level}`}>
        <p className="sky-place">{regionName}</p>
        <div className="sky-score" aria-hidden="true">{score}</div>
        <p className="sky-level">
          <img src={`/bugs/${species.img}.webp`} alt="" width="28" height="28" />
          {level}
        </p>
        <p className="sky-verdict">{narrative}</p>
        {(alerts.length > 0 || officialIndex) && (
          <div className="sky-pills">
            {alerts.map((a) => (
              <span key={a.label}>
                {a.label} · {a.source}
              </span>
            ))}
            {officialIndex && <span>{officialIndex}</span>}
          </div>
        )}
        <p className="sky-src">{stale ? '실시간 예보 연결이 늦어 임시 추정치를 보여 드려요' : sourceLabel}</p>
      </section>

      <div className="sky-cards">
        {hourly.length >= 3 && (
          <Card delay={0}>
            <CardLabel icon={I.clock}>시간별 {species.name} 지수</CardLabel>
            <HourlyChart points={hourly} />
            <p className="sky-best">
              <i />
              {hint ? stripEmoji(hint) : '앞으로 24시간 동안 큰 변화는 없어요'}
            </p>
          </Card>
        )}

        <Card delay={80} onClick={() => onNav('forecast')} label="3일 예보 자세히 보기">
          <CardLabel icon={I.cal}>3일 예보</CardLabel>
          {forecast.map((d, i) => (
            <div className="sky-day" key={String(d.day)}>
              <span className="d">{dayLabel(d.day, i).replace(/\(.\)/, '')}</span>
              <span className="w"><WeatherIcon label={d.weather} /></span>
              <span className="rng"><i style={{ width: `${Math.max(4, d.risk.score)}%` }} /></span>
              <span className="n">{d.risk.score}</span>
            </div>
          ))}
        </Card>

        <Card delay={160}>
          <CardLabel icon={I.list}>오늘 우리 동네 벌레</CardLabel>
          <div className="sky-bugs" role="tablist" aria-label="벌레 고르기">
            {speciesList.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={s.id === speciesId}
                className={`sky-bug ${s.id === speciesId ? 'on' : ''} ${s.risk ? '' : 'off'}`}
                onClick={() => s.risk && onPickSpecies(s.id)}
                disabled={!s.risk}
              >
                <img src={`/bugs/${s.img}.webp`} alt="" width="44" height="44" />
                <span className="nm">{s.name}</span>
                <span className="sc">{s.risk ? s.risk.score : '–'}</span>
              </button>
            ))}
          </div>
        </Card>

        <div className="sky-grid2">
          <Card delay={0} label="왜 이 지수일까">
            <CardLabel icon={I.thermo}>왜 이 지수일까</CardLabel>
            <div className="sky-big">{Math.round(region.temp)}°</div>
            <ul className="sky-why">
              {(whyChips.map((c) => stripEmoji(c)).filter((c) => !/°C/.test(c)).length
                ? whyChips.map((c) => stripEmoji(c)).filter((c) => !/°C/.test(c))
                : [`습도 ${region.humidity}%`, `바람 ${region.wind}m/s`]
              ).map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Card>
          <Card delay={80} onClick={() => onNav('guide')} label={`${care.title} 대처 자세히 보기`}>
            <CardLabel icon={I.alert}>{care.title}</CardLabel>
            <div className="sky-big sm">{care.short}</div>
            <div className="sky-small">{care.shortNote}</div>
          </Card>
        </div>

        <Card delay={0}>
          <CardLabel icon={I.leaf}>{species.name} · 지금 이 계절</CardLabel>
          <p className="sky-lead">{species.seasonNote}</p>
          <ul className="sky-tips">
            {species.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {seasonEvent && (
            <div className="sky-event">
              <b>{stripEmoji(seasonEvent.title)}</b>
              <span>{seasonEvent.desc}</span>
            </div>
          )}
        </Card>

        {dongsVary && (
          <Card delay={0} onClick={() => onNav('map')} label="동네별 지도 보기">
            <CardLabel icon={I.grid}>{regionName} 동네별</CardLabel>
            {dongs.map((dg) => (
              <div className="sky-row" key={dg.name}>
                <span className="t">{dg.name}</span>
                <span className="n">{dg.risk.score}</span>
              </div>
            ))}
          </Card>
        )}

        <Card delay={0} onClick={() => onNav('spots')} label="추천 장소 전체 보기">
          <CardLabel icon={I.pin}>{favoritesMode ? '내 즐겨찾기' : '오늘 갈 만한 곳'}</CardLabel>
          {places.length === 0 && <p className="sky-small">이 지역의 장소 정보가 아직 없어요.</p>}
          {places.map((p) => (
            <div className="sky-row" key={p.key}>
              <span>
                <span className="t">{p.name}</span>
                <span className="s">
                  {p.sub} · {placeAdvice(p.r.tone)}
                </span>
              </span>
              <span className="n">{p.r.score}</span>
            </div>
          ))}
          <span className="sky-more">장소 전체 보기</span>
        </Card>

        <Card delay={0} className="sky-cta" onClick={() => onNav('report')} label="벌레 제보하기">
          <span>
            <b>지금 밖에 계세요?</b>
            <small>30초 제보로 우리 동네 예보가 더 정확해져요</small>
          </span>
          <span className="sky-cta-btn">제보하기</span>
        </Card>
      </div>
    </div>
  );
}
