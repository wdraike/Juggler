/**
 * Theme colors — dark and light palettes
 */

export const THEME_DARK = {
  bg: '#0B1120',
  bgSecondary: '#1A2744',
  bgTertiary: '#334155',
  text: '#F1F5F9',
  textSecondary: '#B0BEC5',
  textMuted: '#7E8FA6',
  border: '#2A3A52',
  borderLight: '#4A5D78',
  accent: '#3B82F6',
  accentHover: '#2563EB',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  card: '#1A2744',
  cardHover: '#253552',
  input: '#141E33',
  inputBorder: '#4A5D78',
  headerBg: '#0B1120',
  shadow: 'rgba(0,0,0,0.3)',
};

export const THEME_LIGHT = {
  bg: '#F8FAFC',
  bgSecondary: '#FFFFFF',
  bgTertiary: '#F1F5F9',
  text: '#1E293B',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  border: '#E2E8F0',
  borderLight: '#CBD5E1',
  accent: '#3B82F6',
  accentHover: '#2563EB',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  card: '#FFFFFF',
  cardHover: '#F1F5F9',
  input: '#FFFFFF',
  inputBorder: '#CBD5E1',
  headerBg: '#FFFFFF',
  shadow: 'rgba(0,0,0,0.1)',
};

export function getTheme(darkMode) {
  return darkMode ? THEME_DARK : THEME_LIGHT;
}
