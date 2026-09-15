import { useCampaignStore } from "../state/campaignStore";
import { resolveWorldWeather, type WorldWeather } from "../domain/worldWeather";

export function WorldWeatherPanel() {
  const map=useCampaignStore(state=>state.campaign.map),update=useCampaignStore(state=>state.updateMapWeather);
  if(!map.world || ["interior","dungeon"].includes(map.generation?.blueprint.kind??""))return null;
  const weather=resolveWorldWeather(map.weather);
  return <details className="tool-section"><summary>Sky & weather</summary>
    <label>Time of day <input aria-label="World time of day" type="range" min="0" max="24" step=".25" value={weather.hour} onChange={e=>update({hour:Number(e.target.value)})}/><span>{String(Math.floor(weather.hour)%24).padStart(2,"0")}:{String(Math.round(weather.hour%1*60)).padStart(2,"0")}</span></label>
    <label>Cloud cover <input aria-label="World cloud cover" type="range" min="0" max="1" step=".05" value={weather.cloudCover} onChange={e=>update({cloudCover:Number(e.target.value)})}/></label>
    <label>Precipitation <select value={weather.precipitation} onChange={e=>update({precipitation:e.target.value as WorldWeather["precipitation"],intensity:e.target.value==="none"?0:.7,temperatureC:e.target.value==="snow"?-5:16,cloudCover:e.target.value==="none"?.4:.92})}><option value="none">Dry</option><option value="rain">Rain</option><option value="snow">Snow</option></select></label>
    <label>Wind <input aria-label="World wind speed" type="range" min="0" max="20" step="1" value={weather.windSpeed} onChange={e=>update({windSpeed:Number(e.target.value)})}/></label>
  </details>;
}
