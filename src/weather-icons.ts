/**
 * WMO weather code -> lucide icon, colour and label.
 *
 * Mirrors weather.mgt.moe's `WeatherIconLane` so the card strip and the embedded
 * dashboard speak the same visual language. The dashboard picks a day/night
 * variant per hour; the strip only shows daily aggregates, so it always uses the
 * daytime variant. Colours reuse the dashboard's semantic palette, flattened to
 * hex because the dashboard's CSS custom properties do not exist here.
 */

import CircleQuestionMark from 'lucide/dist/esm/icons/circle-question-mark.mjs';
import Cloud from 'lucide/dist/esm/icons/cloud.mjs';
import CloudDrizzle from 'lucide/dist/esm/icons/cloud-drizzle.mjs';
import CloudFog from 'lucide/dist/esm/icons/cloud-fog.mjs';
import CloudHail from 'lucide/dist/esm/icons/cloud-hail.mjs';
import CloudLightning from 'lucide/dist/esm/icons/cloud-lightning.mjs';
import CloudRain from 'lucide/dist/esm/icons/cloud-rain.mjs';
import CloudRainWind from 'lucide/dist/esm/icons/cloud-rain-wind.mjs';
import CloudSnow from 'lucide/dist/esm/icons/cloud-snow.mjs';
import CloudSun from 'lucide/dist/esm/icons/cloud-sun.mjs';
import CloudSunRain from 'lucide/dist/esm/icons/cloud-sun-rain.mjs';
import Sun from 'lucide/dist/esm/icons/sun.mjs';

export type WeatherCondition = {
  icon: LucideIcon;
  color: string;
  label: string;
};

const CLEAR = '#e69c00';
const MAINLY_CLEAR = '#deba37';
const CLOUDY = '#64748b';
const OVERCAST = '#94a3b8';
const FOG = '#94a3b8';
const DRIZZLE = '#38bdf8';
const RAIN = '#0ea5e9';
const FREEZING = '#7dd3fc';
const SNOW = '#a5b4fc';
const THUNDER = '#8b5cf6';
const UNKNOWN = '#94a3b8';

export function weatherCondition(code: number | null): WeatherCondition {
  if (code === 0) return { icon: Sun, color: CLEAR, label: 'Clear sky' };
  if (code === 1) return { icon: CloudSun, color: MAINLY_CLEAR, label: 'Mainly clear' };
  if (code === 2) return { icon: Cloud, color: CLOUDY, label: 'Partly cloudy' };
  if (code === 3) return { icon: Cloud, color: OVERCAST, label: 'Overcast' };
  if (code === 45) return { icon: CloudFog, color: FOG, label: 'Fog' };
  if (code === 48) return { icon: CloudFog, color: FOG, label: 'Depositing rime fog' };

  if (code === 51) return { icon: CloudDrizzle, color: DRIZZLE, label: 'Light drizzle' };
  if (code === 53) return { icon: CloudDrizzle, color: DRIZZLE, label: 'Drizzle' };
  if (code === 55) return { icon: CloudDrizzle, color: RAIN, label: 'Dense drizzle' };
  if (code === 56) return { icon: CloudDrizzle, color: FREEZING, label: 'Light freezing drizzle' };
  if (code === 57) return { icon: CloudDrizzle, color: FREEZING, label: 'Dense freezing drizzle' };

  if (code === 61) return { icon: CloudSunRain, color: DRIZZLE, label: 'Slight rain' };
  if (code === 63) return { icon: CloudRain, color: RAIN, label: 'Rain' };
  if (code === 65) return { icon: CloudRainWind, color: RAIN, label: 'Heavy rain' };
  if (code === 66) return { icon: CloudRain, color: FREEZING, label: 'Light freezing rain' };
  if (code === 67) return { icon: CloudRainWind, color: FREEZING, label: 'Heavy freezing rain' };

  if (code === 71) return { icon: CloudSnow, color: SNOW, label: 'Slight snow' };
  if (code === 73) return { icon: CloudSnow, color: SNOW, label: 'Snow' };
  if (code === 75) return { icon: CloudSnow, color: SNOW, label: 'Heavy snow' };
  if (code === 77) return { icon: CloudSnow, color: SNOW, label: 'Snow grains' };

  if (code === 80) return { icon: CloudSunRain, color: DRIZZLE, label: 'Slight rain showers' };
  if (code === 81) return { icon: CloudRain, color: RAIN, label: 'Rain showers' };
  if (code === 82) return { icon: CloudRainWind, color: RAIN, label: 'Violent rain showers' };
  if (code === 85) return { icon: CloudSnow, color: SNOW, label: 'Slight snow showers' };
  if (code === 86) return { icon: CloudSnow, color: SNOW, label: 'Heavy snow showers' };

  if (code === 95) return { icon: CloudLightning, color: THUNDER, label: 'Thunderstorm' };
  if (code === 96) return { icon: CloudHail, color: THUNDER, label: 'Thunderstorm with slight hail' };
  if (code === 99) return { icon: CloudHail, color: THUNDER, label: 'Thunderstorm with heavy hail' };

  return { icon: CircleQuestionMark, color: UNKNOWN, label: 'Unknown conditions' };
}
