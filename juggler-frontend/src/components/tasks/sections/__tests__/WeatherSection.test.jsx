import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WeatherSection from '../WeatherSection';

const TH = { accent: '#4f46e5', btnBorder: '#ccc', textMuted: '#888', bgCard: '#fff', inputBorder: '#ccc', inputBg: '#fff' };

const BASE = {
  weatherPrecip: 'any', weatherCloud: 'any',
  weatherTempMin: '', weatherTempMax: '',
  weatherHumidityMin: '', weatherHumidityMax: '',
};

it('renders precipitation buttons', () => {
  render(<WeatherSection {...BASE} onChange={() => {}} TH={TH} isMobile={false} tempUnitPref="F" />);
  expect(screen.getByText(/Dry only/)).toBeInTheDocument();
});

it('calls onChange with updated precip when button clicked', () => {
  const onChange = jest.fn();
  render(<WeatherSection {...BASE} onChange={onChange} TH={TH} isMobile={false} tempUnitPref="F" />);
  fireEvent.click(screen.getByText(/Dry only/));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ weatherPrecip: 'dry_only' }));
});

it('renders sky cover buttons', () => {
  render(<WeatherSection {...BASE} onChange={() => {}} TH={TH} isMobile={false} tempUnitPref="F" />);
  expect(screen.getByText(/Clear/)).toBeInTheDocument();
});
