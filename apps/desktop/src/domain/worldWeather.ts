import { z } from "zod";

export const worldWeatherSchema = z.object({
  hour: z.number().min(0).max(24),
  cloudCover: z.number().min(0).max(1),
  precipitation: z.enum(["none", "rain", "snow"]),
  intensity: z.number().min(0).max(1),
  temperatureC: z.number().min(-60).max(60),
  windSpeed: z.number().min(0).max(40),
  windDirection: z.number().min(0).max(360),
});
export type WorldWeather = z.infer<typeof worldWeatherSchema>;
export const DEFAULT_WORLD_WEATHER: WorldWeather = { hour: 15, cloudCover: .55, precipitation: "none", intensity: 0, temperatureC: 16, windSpeed: 3, windDirection: 65 };

export function weatherFromDescription(description:string):WorldWeather {
  const snow=/\b(snow|snowy|blizzard|winter|frozen)\b/i.test(description),rain=/\b(rain|rainy|rainstorm|storm|downpour)\b/i.test(description);
  return { ...DEFAULT_WORLD_WEATHER, hour:/\b(night|midnight|moonlit)\b/i.test(description)?0:/\b(dawn|sunrise)\b/i.test(description)?7:/\b(dusk|sunset)\b/i.test(description)?18:15,
    cloudCover:rain||snow?.92:/\b(clear|sunny|cloudless)\b/i.test(description)?.15:.55,
    precipitation:snow?"snow":rain?"rain":"none",intensity:rain||snow?.7:0,temperatureC:snow?-5:16,windSpeed:/\b(storm|blizzard|windy)\b/i.test(description)?12:3 };
}
export function resolveWorldWeather(input?:Partial<WorldWeather>):WorldWeather {
  const parsed=worldWeatherSchema.safeParse({...DEFAULT_WORLD_WEATHER,...input});
  return parsed.success?parsed.data:{...DEFAULT_WORLD_WEATHER};
}
export function weatherSurfaceState(weather:WorldWeather) {
  return { wetness:weather.precipitation==="rain"?weather.intensity:0,
    snowCover:weather.precipitation==="snow"&&weather.temperatureC<2?weather.intensity:0,
    // Terrain uses compressed vertical relief. Apply the same scale to the
    // atmospheric lapse rate so alpine peaks, not only 2.5 km summits, freeze.
    snowLine:Math.max(0,weather.temperatureC/.035), windX:Math.cos(weather.windDirection*Math.PI/180)*weather.windSpeed,windZ:Math.sin(weather.windDirection*Math.PI/180)*weather.windSpeed };
}
