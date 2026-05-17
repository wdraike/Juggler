import React, { useRef } from 'react';

var TEMP_RANGES = { F: { min: -20, max: 120 }, C: { min: -29, max: 49 } };

function fToUnit(f, unit) { if (f == null) return f; if (unit === 'C') return Math.round((f - 32) * 5 / 9); return f; }
function unitToF(v, unit) { if (v == null) return v; if (unit === 'C') return Math.round(v * 9 / 5 + 32); return v; }

export function WeatherTempSlider({ tempMin, tempMax, unit, onChange, TH }) {
  var displayUnit = unit === 'C' ? 'C' : 'F';
  var range = TEMP_RANGES[displayUnit];
  var totalSpan = range.max - range.min;
  var loF = (tempMin !== '' && tempMin !== null && tempMin !== undefined) ? Number(tempMin) : null;
  var hiF = (tempMax !== '' && tempMax !== null && tempMax !== undefined) ? Number(tempMax) : null;
  var lo = loF != null ? fToUnit(loF, displayUnit) : range.min;
  var hi = hiF != null ? fToUnit(hiF, displayUnit) : range.max;
  if (lo < range.min) lo = range.min;
  if (hi > range.max) hi = range.max;
  function pct(val) { return ((val - range.min) / totalSpan) * 100; }
  var noMin = lo <= range.min, noMax = hi >= range.max;
  var noRestriction = noMin && noMax;
  var loRef = useRef(null), hiRef = useRef(null);

  function handleMouseMove(e) {
    if (!loRef.current || !hiRef.current) return;
    var rect = e.currentTarget.getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width;
    var preferLo = Math.abs(x - pct(lo)/100) <= Math.abs(x - pct(hi)/100);
    loRef.current.style.zIndex = preferLo ? 4 : 2;
    hiRef.current.style.zIndex = preferLo ? 2 : 3;
  }

  function handleLoChange(e) {
    var v = Math.min(Number(e.target.value), hi - 1);
    onChange(v <= range.min ? null : unitToF(v, displayUnit), noMax ? null : unitToF(hi, displayUnit));
  }
  function handleHiChange(e) {
    var v = Math.max(Number(e.target.value), lo + 1);
    onChange(noMin ? null : unitToF(lo, displayUnit), v >= range.max ? null : unitToF(v, displayUnit));
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 9, color: TH.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        Temperature (°{displayUnit})
        {noRestriction ? <span style={{ fontWeight: 400, marginLeft: 6 }}>Any</span>
          : <span style={{ fontWeight: 400, marginLeft: 6 }}>{noMin ? `up to ${hi}°${displayUnit}` : noMax ? `${lo}°${displayUnit}+` : `${lo}–${hi}°${displayUnit}`}</span>}
      </div>
      <div style={{ position: 'relative', height: 20, marginBottom: 4 }} onMouseMove={handleMouseMove}>
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 4, background: TH.inputBorder, borderRadius: 2, transform: 'translateY(-50%)' }} />
        <div style={{
          position: 'absolute', top: '50%', transform: 'translateY(-50%)', height: 4,
          left: pct(lo) + '%', right: (100 - pct(hi)) + '%',
          background: noRestriction ? TH.inputBorder : TH.accent, borderRadius: 2
        }} />
        <input ref={loRef} type="range" min={range.min} max={range.max} value={lo} onChange={handleLoChange}
          style={{ position: 'absolute', width: '100%', opacity: 0, cursor: 'pointer', zIndex: 2, margin: 0, height: '100%' }} />
        <input ref={hiRef} type="range" min={range.min} max={range.max} value={hi} onChange={handleHiChange}
          style={{ position: 'absolute', width: '100%', opacity: 0, cursor: 'pointer', zIndex: 3, margin: 0, height: '100%' }} />
      </div>
    </div>
  );
}

export function WeatherHumiditySlider({ humidityMin, humidityMax, onChange, TH }) {
  var lo = humidityMin !== '' && humidityMin != null ? Number(humidityMin) : 0;
  var hi = humidityMax !== '' && humidityMax != null ? Number(humidityMax) : 100;
  var noRestriction = lo <= 0 && hi >= 100;
  var loRef = useRef(null), hiRef = useRef(null);

  function handleMouseMove(e) {
    if (!loRef.current || !hiRef.current) return;
    var rect = e.currentTarget.getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width;
    var preferLo = Math.abs(x - lo/100) <= Math.abs(x - hi/100);
    loRef.current.style.zIndex = preferLo ? 4 : 2;
    hiRef.current.style.zIndex = preferLo ? 2 : 3;
  }

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 9, color: TH.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        Humidity (%)
        {noRestriction ? <span style={{ fontWeight: 400, marginLeft: 6 }}>Any</span>
          : <span style={{ fontWeight: 400, marginLeft: 6 }}>{lo}–{hi}%</span>}
      </div>
      <div style={{ position: 'relative', height: 20 }} onMouseMove={handleMouseMove}>
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 4, background: TH.inputBorder, borderRadius: 2, transform: 'translateY(-50%)' }} />
        <div style={{
          position: 'absolute', top: '50%', transform: 'translateY(-50%)', height: 4,
          left: lo + '%', right: (100 - hi) + '%',
          background: noRestriction ? TH.inputBorder : TH.accent, borderRadius: 2
        }} />
        <input ref={loRef} type="range" min={0} max={100} value={lo}
          onChange={e => { var v = Math.min(Number(e.target.value), hi - 1); onChange(v <= 0 ? null : v, hi >= 100 ? null : hi); }}
          style={{ position: 'absolute', width: '100%', opacity: 0, cursor: 'pointer', zIndex: 2, margin: 0, height: '100%' }} />
        <input ref={hiRef} type="range" min={0} max={100} value={hi}
          onChange={e => { var v = Math.max(Number(e.target.value), lo + 1); onChange(lo <= 0 ? null : lo, v >= 100 ? null : v); }}
          style={{ position: 'absolute', width: '100%', opacity: 0, cursor: 'pointer', zIndex: 3, margin: 0, height: '100%' }} />
      </div>
    </div>
  );
}

export default function WeatherSection({
  weatherPrecip, weatherCloud,
  weatherTempMin, weatherTempMax,
  weatherHumidityMin, weatherHumidityMax,
  onChange, TH, isMobile, tempUnitPref
}) {
  var BTN_H = isMobile ? 30 : 26;
  function togStyle(on) {
    return {
      height: BTN_H, padding: '0 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
      fontWeight: on ? 600 : 400, fontFamily: 'inherit', boxSizing: 'border-box',
      border: on ? '2px solid ' + TH.accent : '1px solid ' + TH.btnBorder,
      background: on ? TH.accent + '22' : TH.bgCard,
      color: on ? TH.accent : TH.textMuted,
    };
  }

  var PRECIP = [
    { val: 'any', label: '🌦️ Any' },
    { val: 'wet_ok', label: '🌧️ Precip OK' },
    { val: 'light_ok', label: '🌂 Light OK' },
    { val: 'dry_only', label: '☀️ Dry only' },
  ];
  var CLOUD = [
    { val: 'any', label: '⛅ Any' },
    { val: 'overcast_ok', label: '☁️ Overcast OK' },
    { val: 'partly_ok', label: '🌤️ Partly OK' },
    { val: 'clear', label: '☀️ Clear' },
  ];

  return (
    <div>
      <div style={{ fontSize: 9, color: TH.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Precipitation</div>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8 }}>
        {PRECIP.map(function(o) {
          return <button key={o.val} onClick={() => onChange({ weatherPrecip: o.val })} style={togStyle(weatherPrecip === o.val)}>{o.label}</button>;
        })}
      </div>
      <div style={{ fontSize: 9, color: TH.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Sky cover</div>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8 }}>
        {CLOUD.map(function(o) {
          return <button key={o.val} onClick={() => onChange({ weatherCloud: o.val })} style={togStyle(weatherCloud === o.val)}>{o.label}</button>;
        })}
      </div>
      <WeatherTempSlider
        tempMin={weatherTempMin} tempMax={weatherTempMax}
        unit={tempUnitPref || 'F'}
        onChange={(min, max) => onChange({
          weatherTempMin: min !== null ? String(min) : '',
          weatherTempMax: max !== null ? String(max) : ''
        })}
        TH={TH}
      />
      <WeatherHumiditySlider
        humidityMin={weatherHumidityMin} humidityMax={weatherHumidityMax}
        onChange={(min, max) => onChange({
          weatherHumidityMin: min !== null ? String(min) : '',
          weatherHumidityMax: max !== null ? String(max) : ''
        })}
        TH={TH}
      />
    </div>
  );
}
