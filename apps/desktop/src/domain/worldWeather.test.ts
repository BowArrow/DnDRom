import {describe,it,expect} from "vitest";
import {DEFAULT_WORLD_WEATHER,resolveWorldWeather,weatherFromDescription,weatherSurfaceState,worldWeatherSchema} from "./worldWeather";
describe("shared world weather",()=>{
  it("provides validated defaults for old saves and rejects invalid model values",()=>{
    expect(resolveWorldWeather()).toEqual(DEFAULT_WORLD_WEATHER);
    expect(worldWeatherSchema.safeParse({...DEFAULT_WORLD_WEATHER,windSpeed:Infinity}).success).toBe(false);
    expect(resolveWorldWeather({cloudCover:NaN})).toEqual(DEFAULT_WORLD_WEATHER);
  });
  it("connects snow, temperature and wind to surface state",()=>{
    const weather=weatherFromDescription("A moonlit village in a winter blizzard");
    expect(weather.hour).toBe(0);expect(weather.temperatureC).toBeLessThan(0);
    expect(weatherSurfaceState(weather).snowCover).toBeGreaterThan(0);
    expect(weatherSurfaceState({...weather,temperatureC:12}).snowCover).toBe(0);
    const rain=weatherSurfaceState({...DEFAULT_WORLD_WEATHER,precipitation:"rain",intensity:.8,windDirection:90,windSpeed:6});
    expect(rain.wetness).toBe(.8);expect(rain.windX).toBeCloseTo(0);expect(rain.windZ).toBeCloseTo(6);
  });
});
