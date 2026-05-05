import { checkWeatherMatch, hasWeatherRestrictions } from '../weatherMatch';

var RAINY = { high: 64, low: 52, precipPct: 70, code: 61,
  hourly: Array.from({length:24}, (_,i) => ({ hour:i, temp:58, precipProb:70, cloudcover:85, code:61 })) };
var SUNNY = { high: 75, low: 58, precipPct: 5, code: 1,
  hourly: Array.from({length:24}, (_,i) => ({ hour:i, temp:68, precipProb:5, cloudcover:10, code:1 })) };

test('hasWeatherRestrictions false when all defaults', () => {
  expect(hasWeatherRestrictions({ weatherPrecip:'any', weatherCloud:'any', weatherTempMin:null, weatherTempMax:null })).toBe(false);
});
test('hasWeatherRestrictions true when precip set', () => {
  expect(hasWeatherRestrictions({ weatherPrecip:'dry_only', weatherCloud:'any', weatherTempMin:null, weatherTempMax:null })).toBe(true);
});
test('checkWeatherMatch returns neutral when no forecast', () => {
  var r = checkWeatherMatch({ weatherPrecip:'dry_only', weatherCloud:'any', weatherTempMin:null, weatherTempMax:null }, null);
  expect(r.ok).toBeNull();
});
test('dry_only fails on rainy day', () => {
  var r = checkWeatherMatch({ weatherPrecip:'dry_only', weatherCloud:'any', weatherTempMin:null, weatherTempMax:null }, RAINY);
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/rain/i);
});
test('dry_only passes on sunny day', () => {
  var r = checkWeatherMatch({ weatherPrecip:'dry_only', weatherCloud:'any', weatherTempMin:null, weatherTempMax:null }, SUNNY);
  expect(r.ok).toBe(true);
});
test('temp_min fails when low below min', () => {
  var r = checkWeatherMatch({ weatherPrecip:'any', weatherCloud:'any', weatherTempMin:60, weatherTempMax:null }, { ...SUNNY, low: 55 });
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/below/i);
});
test('temp_max fails when high above max', () => {
  var r = checkWeatherMatch({ weatherPrecip:'any', weatherCloud:'any', weatherTempMin:null, weatherTempMax:70 }, { ...SUNNY, high: 80 });
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/above/i);
});
test('all defaults returns ok true', () => {
  var r = checkWeatherMatch({ weatherPrecip:'any', weatherCloud:'any', weatherTempMin:null, weatherTempMax:null }, SUNNY);
  expect(r.ok).toBe(true);
});
