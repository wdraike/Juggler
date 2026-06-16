/**
 * WeatherBadge tests
 */

import React from 'react';
import { render } from '@testing-library/react';
import WeatherBadge from '../WeatherBadge';

describe('WeatherBadge', () => {
  const mockWeatherDay = {
    high: 75,
    low: 60,
    code: 1, // Clear
    precipPct: 20
  };

  it('renders null when weatherDay is missing', () => {
    const { container } = render(<WeatherBadge />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when weatherDay.high is missing', () => {
    const { container } = render(<WeatherBadge weatherDay={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders compact version when compact prop is true', () => {
    const { getByText } = render(
      <WeatherBadge weatherDay={mockWeatherDay} compact unit="F" />
    );
    expect(getByText('75°F')).toBeInTheDocument();
  });

  it('renders high and low when showLow is true', () => {
    const { getByText } = render(
      <WeatherBadge weatherDay={mockWeatherDay} showLow unit="F" />
    );
    expect(getByText('75°F')).toBeInTheDocument();
    expect(getByText('/ 60°F')).toBeInTheDocument();
  });

  it('renders with Celsius unit when specified', () => {
    const { getByText } = render(
      <WeatherBadge weatherDay={mockWeatherDay} unit="C" />
    );
    // The component displays the temperature as provided (already converted by useWeather)
    expect(getByText('75°C')).toBeInTheDocument();
  });

  it('shows precipitation when precipPct >= 30', () => {
    const highPrecipWeather = { ...mockWeatherDay, precipPct: 40 };
    const { getByText } = render(
      <WeatherBadge weatherDay={highPrecipWeather} unit="F" />
    );
    expect(getByText('40%')).toBeInTheDocument();
  });

  it('does not show precipitation when precipPct < 30', () => {
    const { queryByText } = render(
      <WeatherBadge weatherDay={mockWeatherDay} unit="F" />
    );
    expect(queryByText('20%')).toBeNull();
  });

  it('handles missing temperature values gracefully', () => {
    const { container } = render(
      <WeatherBadge weatherDay={{ high: null, low: null, code: 1 }} unit="F" />
    );
    // When high is null, WeatherBadge returns null
    expect(container.firstChild).toBeNull();
  });
});