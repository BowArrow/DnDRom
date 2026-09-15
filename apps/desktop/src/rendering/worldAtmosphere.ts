import { resolveWorldWeather, weatherSurfaceState, type WorldWeather } from "../domain/worldWeather";
import * as pc from "playcanvas";

const glsl = `
uniform sampler2D uSceneDepthMap;
uniform vec3 uWorldCamera;
uniform vec3 uWorldRight;
uniform vec3 uWorldUp;
uniform vec3 uWorldForward;
uniform vec3 uWorldSun;
uniform vec4 uWorldView;
uniform vec4 uWorldReveal;
uniform vec4 uWorldWeather;
float worldNoise(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  vec3 k=vec3(17.17,127.1,311.7);
  float n=dot(i,k);
  return mix(mix(mix(fract(sin(n)*43758.5453),fract(sin(n+k.x)*43758.5453),f.x),mix(fract(sin(n+k.y)*43758.5453),fract(sin(n+k.x+k.y)*43758.5453),f.x),f.y),mix(mix(fract(sin(n+k.z)*43758.5453),fract(sin(n+k.x+k.z)*43758.5453),f.x),mix(fract(sin(n+k.y+k.z)*43758.5453),fract(sin(n+k.x+k.y+k.z)*43758.5453),f.x),f.y),f.z);
}
vec3 worldAtmosphere(vec3 color,vec2 uv) {
  if(uWorldWeather.w<.5) return color;
  vec2 ndc=uv*2.0-1.0;
  vec3 ray=normalize(uWorldForward+uWorldRight*ndc.x*uWorldView.x*uWorldView.y+uWorldUp*ndc.y*uWorldView.x);
  float depth=texture2D(uSceneDepthMap,uv).r;
  float distance=min(uWorldView.z,depth/max(.001,dot(ray,uWorldForward)));
  vec3 hit=uWorldCamera+ray*distance;
  float light=pow(max(0.0,dot(ray,uWorldSun)),12.0);
  vec3 mist=mix(vec3(.34,.44,.52),vec3(.83,.76,.61),light*.5)*mix(.12,1.0,uWorldWeather.z);
  float haze=1.0-exp(-distance*.00007);
  color=mix(color,mist,haze);
  // March a true volume at the reveal boundary, using scene depth to stop
  // before visible geometry. The safety margin keeps unloaded terrain opaque.
  float optical=0.0;
  for(int i=0;i<16;i++) {
    float t=distance-(float(i)+.5)*min(distance,180.0)/16.0;
    vec3 p=uWorldCamera+ray*t;
    float edge=length(p.xz-uWorldReveal.xy)-uWorldReveal.z;
    float noise=worldNoise(p*.045+vec3(uWorldWeather.x*.12,0.0,uWorldWeather.x*.05));
    optical+=smoothstep(-3.0,10.0,edge+noise*5.0)*min(distance,180.0)/16.0*.085;
  }
  float hidden=smoothstep(0.0,10.0,length(hit.xz-uWorldReveal.xy)-uWorldReveal.z);
  color=mix(color,mist,max(1.0-exp(-optical),hidden)*uWorldReveal.w);
  if(ray.y>.005) {
    float begin=max(0.0,(850.0-uWorldCamera.y)/ray.y),end=min(distance,(1550.0-uWorldCamera.y)/ray.y);
    float trans=1.0;vec3 cloud=vec3(0.0);
    for(int i=0;i<24;i++) {
      float t=mix(begin,max(begin,end),(float(i)+.5)/24.0);vec3 p=uWorldCamera+ray*t;
      float profile=smoothstep(850.0,990.0,p.y)*(1.0-smoothstep(1320.0,1550.0,p.y));
      vec3 q=p*.0018+vec3(uWorldWeather.x*.004,0.0,uWorldWeather.x*.001);
      float density=max(0.0,(worldNoise(q)*.75+worldNoise(q*2.7)*.25)*profile-(.78-uWorldWeather.y*.62));
      float shade=exp(-max(0.0,worldNoise(q+uWorldSun*.3)-.5)*3.0);
      float alpha=1.0-exp(-density*max(0.0,end-begin)/24.0*.018);
      cloud+=trans*alpha*mix(vec3(.33,.39,.45),vec3(.98,.97,.93),shade)*mix(.12,1.0,uWorldWeather.z);trans*=1.0-alpha;
    }
    color=color*trans+cloud;
    color+=vec3(1.0,.8,.48)*smoothstep(.99982,.99994,dot(ray,uWorldSun))*trans;
  }
  return color;
}`;
const wgsl = `
var uSceneDepthMap:texture_2d<uff>;
uniform uWorldCamera:vec3f; uniform uWorldRight:vec3f; uniform uWorldUp:vec3f; uniform uWorldForward:vec3f; uniform uWorldSun:vec3f;
uniform uWorldView:vec4f; uniform uWorldReveal:vec4f; uniform uWorldWeather:vec4f;
fn worldNoise(p:vec3f)->f32 {
  let i=floor(p);var f=fract(p);f=f*f*(vec3f(3.0)-2.0*f);let k=vec3f(17.17,127.1,311.7);let n=dot(i,k);
  return mix(mix(mix(fract(sin(n)*43758.5453),fract(sin(n+k.x)*43758.5453),f.x),mix(fract(sin(n+k.y)*43758.5453),fract(sin(n+k.x+k.y)*43758.5453),f.x),f.y),mix(mix(fract(sin(n+k.z)*43758.5453),fract(sin(n+k.x+k.z)*43758.5453),f.x),mix(fract(sin(n+k.y+k.z)*43758.5453),fract(sin(n+k.x+k.y+k.z)*43758.5453),f.x),f.y),f.z);
}
fn worldAtmosphere(source:vec3f,uv:vec2f)->vec3f {
  if(uniform.uWorldWeather.w<.5){return source;}var color=source;
  let ndc=uv*2.0-vec2f(1.0);let ray=normalize(uniform.uWorldForward+uniform.uWorldRight*ndc.x*uniform.uWorldView.x*uniform.uWorldView.y+uniform.uWorldUp*ndc.y*uniform.uWorldView.x);
  let depth=textureLoad(uSceneDepthMap,vec2i(uv*vec2f(textureDimensions(uSceneDepthMap))),0).r;
  let distance=min(uniform.uWorldView.z,depth/max(.001,dot(ray,uniform.uWorldForward)));let hit=uniform.uWorldCamera+ray*distance;
  let light=pow(max(0.0,dot(ray,uniform.uWorldSun)),12.0);let mist=mix(vec3f(.34,.44,.52),vec3f(.83,.76,.61),light*.5)*mix(.12,1.0,uniform.uWorldWeather.z);
  color=mix(color,mist,1.0-exp(-distance*.00007));var optical=0.0;
  for(var i=0;i<16;i++){let t=distance-(f32(i)+.5)*min(distance,180.0)/16.0;let p=uniform.uWorldCamera+ray*t;let edge=length(p.xz-uniform.uWorldReveal.xy)-uniform.uWorldReveal.z;let noise=worldNoise(p*.045+vec3f(uniform.uWorldWeather.x*.12,0.0,uniform.uWorldWeather.x*.05));optical+=smoothstep(-3.0,10.0,edge+noise*5.0)*min(distance,180.0)/16.0*.085;}
  let hidden=smoothstep(0.0,10.0,length(hit.xz-uniform.uWorldReveal.xy)-uniform.uWorldReveal.z);color=mix(color,mist,max(1.0-exp(-optical),hidden)*uniform.uWorldReveal.w);
  if(ray.y>.005){
    let begin=max(0.0,(850.0-uniform.uWorldCamera.y)/ray.y);let end=min(distance,(1550.0-uniform.uWorldCamera.y)/ray.y);var trans=1.0;var cloud=vec3f(0.0);
    for(var i=0;i<24;i++){let t=mix(begin,max(begin,end),(f32(i)+.5)/24.0);let p=uniform.uWorldCamera+ray*t;let profile=smoothstep(850.0,990.0,p.y)*(1.0-smoothstep(1320.0,1550.0,p.y));let q=p*.0018+vec3f(uniform.uWorldWeather.x*.004,0.0,uniform.uWorldWeather.x*.001);let density=max(0.0,(worldNoise(q)*.75+worldNoise(q*2.7)*.25)*profile-(.78-uniform.uWorldWeather.y*.62));let shade=exp(-max(0.0,worldNoise(q+uniform.uWorldSun*.3)-.5)*3.0);let alpha=1.0-exp(-density*max(0.0,end-begin)/24.0*.018);cloud+=trans*alpha*mix(vec3f(.33,.39,.45),vec3f(.98,.97,.93),shade)*mix(.12,1.0,uniform.uWorldWeather.z);trans*=1.0-alpha;}
    color=color*trans+cloud;color+=vec3f(1.0,.8,.48)*smoothstep(.99982,.99994,dot(ray,uniform.uWorldSun))*trans;
  }return color;
}`;
export function installWorldAtmosphere(device:pc.GraphicsDevice):void {
  pc.ShaderChunks.get(device,pc.SHADERLANGUAGE_GLSL).set("composeDeclarationsPS",glsl);
  pc.ShaderChunks.get(device,pc.SHADERLANGUAGE_GLSL).set("composeMainEndPS","result = worldAtmosphere(result, uv);");
  pc.ShaderChunks.get(device,pc.SHADERLANGUAGE_WGSL).set("composeDeclarationsPS",wgsl);
  pc.ShaderChunks.get(device,pc.SHADERLANGUAGE_WGSL).set("composeMainEndPS","result = worldAtmosphere(result, uv);");
  device.scope.resolve("uWorldWeather").setValue([0,.6,0,0]);
  device.scope.resolve("uWorldSurfaceWeather").setValue([0,0,2400,1]);
  device.scope.resolve("uWorldWind").setValue([1,1]);
}
export function updateWorldAtmosphere(app:pc.Application,camera:pc.Entity,sun:pc.Entity,seconds:number,radius:number,enabled:boolean,weatherInput?:WorldWeather,center={x:0,z:0}):void {
  const scope=app.graphicsDevice.scope,c=camera.camera!,weather=resolveWorldWeather(weatherInput),surface=weatherSurfaceState(weather);
  const daylight=Math.max(0,Math.sin((weather.hour-6)*Math.PI/12));
  if(enabled) { sun.setEulerAngles(0,0,(weather.hour-12)*15); if(sun.light) sun.light.intensity=daylight*2.2+.06; }
  const vector=(key:string,value:pc.Vec3)=>scope.resolve(key).setValue([value.x,value.y,value.z]);
  vector("uWorldCamera",camera.getPosition());vector("uWorldRight",camera.right);vector("uWorldUp",camera.up);vector("uWorldForward",camera.forward);vector("uWorldSun",sun.up);
  scope.resolve("uWorldView").setValue([Math.tan(c.fov*Math.PI/360),c.aspectRatio,c.farClip,0]);
  scope.resolve("uWorldWeather").setValue([seconds,weather.cloudCover,daylight,enabled?1:0]);
  scope.resolve("uWorldSurfaceWeather").setValue([surface.wetness,surface.snowCover,surface.snowLine,weather.windSpeed/3]);
  scope.resolve("uWorldWind").setValue([surface.windX,surface.windZ]);
  scope.resolve("uWorldReveal").setValue([center.x,center.z,radius,enabled&&radius<50000?1:0]);
}
