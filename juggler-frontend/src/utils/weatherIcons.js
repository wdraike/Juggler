var WMO_TO_METEO = {
  0:  'clear-day',
  1:  'mostly-clear-day',
  2:  'partly-cloudy-day',
  3:  'overcast',
  45: 'fog-day',
  48: 'fog-day',
  51: 'partly-cloudy-day-drizzle',
  53: 'overcast-drizzle',
  55: 'overcast-drizzle',
  56: 'sleet',
  57: 'sleet',
  61: 'overcast-day-rain',
  63: 'overcast-rain',
  65: 'extreme-rain',
  66: 'sleet',
  67: 'extreme-sleet',
  71: 'partly-cloudy-day-snow',
  73: 'overcast-snow',
  75: 'extreme-snow',
  77: 'snowflake',
  80: 'partly-cloudy-day-rain',
  81: 'overcast-day-rain',
  82: 'extreme-day-rain',
  85: 'partly-cloudy-day-snow',
  86: 'overcast-day-snow',
  95: 'thunderstorms-overcast',
  96: 'thunderstorms-overcast-hail',
  99: 'thunderstorms-extreme',
};

export function weatherIconUrl(code) {
  var name = WMO_TO_METEO[code] || 'overcast';
  return '/icons/weather/fill/' + name + '.svg';
}

export var RAINDROP_URL = '/icons/weather/fill/raindrop.svg';
