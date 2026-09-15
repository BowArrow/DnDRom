// Receiver-space optics for the custom water mesh. All distances below are m.
float3 source=SceneColor.rgb;
float3 camera=CameraPosition*.01,ray=normalize(-CameraVector);
float receiverDistance=min(200000.,max(0.,SceneDepth*.01)/max(.001,dot(ray,ResolvedView.ViewForward)));
float3 receiver=camera+ray*receiverDistance;
float2 cameraUV=(camera.xy-WaterWindow.xy)/WaterWindow.z;
float wave=coast.height(camera.xy,CameraWater.y,CameraWater.z,WaveTime);
if(all(cameraUV>0)&&all(cameraUV<1))wave*=coast.energy(CoastalInfo,CoastalInfoSampler,cameraUV,WaterWindow.z);
float surface=CameraWater.x+wave,submersion=surface-camera.z;
float blend=smoothstep(-.025,.055,submersion-ray.z*.08)*smoothstep(0.,.005,CameraWater.y);
if(blend<=0)return source;
float distanceToReceiver=min(300.,receiverDistance);
float surfaceT=ray.z>.001?max(0.,submersion)/ray.z:1e6;
// Refine the intersection against the same displaced surface as the waves.
if(ray.z>.02){[unroll]for(int j=0;j<3;j++){
 float2 sampleXY=camera.xy+ray.xy*surfaceT,uv=(sampleXY-WaterWindow.xy)/WaterWindow.z;
 float4 field=Texture2DSampleLevel(CoastalInfo,CoastalInfoSampler,saturate(uv),0);
 float valid=(all(uv>0)&&all(uv<1)&&field.a>.5)?1:0;
 float h=lerp(CameraWater.x,field.b,valid)+coast.height(sampleXY,lerp(CameraWater.y,field.r,valid),lerp(CameraWater.z,field.g,valid),WaveTime);
 surfaceT=max(0.,(h-camera.z)/ray.z);
}}
float3 surfacePoint=camera+ray*surfaceT;
float2 waterUV=(surfacePoint.xy-WaterWindow.xy)/WaterWindow.z;
float4 water=Texture2DSampleLevel(CoastalInfo,CoastalInfoSampler,waterUV,0);
float exitWater=surfaceT<distanceToReceiver&&ray.z>0 ? 1:0;
// A nearby bank must not be mistaken for an air/water boundary.
if(all(waterUV>0)&&all(waterUV<1)&&water.a>.5)exitWater*=smoothstep(0.,.12,water.r);
float travel=lerp(distanceToReceiver,min(distanceToReceiver,surfaceT),exitWater);
// RGB clear/coastal approximation, metres. Not a measured universal water type.
float3 extinction=lerp(float3(.16,.055,.035),float3(.23,.085,.065),CoastalSediment);
float3 transmission=exp(-extinction*travel);
float3 waterLight=float3(.013,.05,.064)*WaterRadiance*exp(-max(0,submersion)*.06);
float3 result=source;
if(exitWater>.5){
    float2 slope;float3 curvature;
    coast.fine(surfacePoint.xy,WaveTime,max(length(ddx(surfacePoint.xy)),length(ddy(surfacePoint.xy))),slope,curvature);
    float3 normal=normalize(float3(-slope,1));
    float cosine=saturate(dot(ray,normal));
    float sin2=1.333*1.333*(1-cosine*cosine);
    float tir=smoothstep(.995,1.005,sin2);
    float transmittedCos=sqrt(max(0.,1-sin2));
    float rs=(1.333*cosine-transmittedCos)/max(.0001,1.333*cosine+transmittedCos);
    float rp=(cosine-1.333*transmittedCos)/max(.0001,cosine+1.333*transmittedCos);
    float fresnel=lerp(saturate((rs*rs+rp*rp)*.5),1.,tir);
    // Existing scene provides transmitted sky. Reproject the refracted ray
    // where screen coverage permits; bounded fallback avoids edge smearing.
    float3 refracted=refract(ray,-normal,1.333);
    float4 clip=mul(float4(refracted,0),ResolvedView.TranslatedWorldToClip);
    float2 uv=clip.xy/max(.0001,clip.w)*float2(.5,-.5)+.5;
    float margin=min(min(uv.x,uv.y),min(1-uv.x,1-uv.y));
    float inside=smoothstep(.015,.16,margin)*(clip.w>0?1:0);
    float3 air=SceneTextureLookup(Parameters,ViewportUVToSceneTextureUV(clamp(uv,.015,.985),14),14,false).rgb;
    // Retain the established high-resolution sky path. A cubemap sky can
    // contain view-dependent atmosphere seams even with cloud capture off.
    // Missing screen directions fall back to the undistorted scene, rather
    // than introducing discontinuous cube faces inside Snell's window.
    result=lerp(source,air,inside*(1-tir));
    float3 reflected=reflect(ray,normal);
    // Direction-only screen lookup reflected the wrong receivers and caused
    // horizontal smears. The low-resolution world capture stays view-stable.
    float3 reflection=TextureCubeSampleLevel(UnderwaterEnvironment,UnderwaterEnvironmentSampler,reflected,0).rgb;
    reflection=lerp(waterLight,reflection,EnvironmentReady);
    // Approximate the reflected path through the same water column.
    float reflectedTravel=min(60.,max(.2,CameraWater.y)/max(.08,-reflected.z));
    float3 reflectedTransmission=exp(-extinction*reflectedTravel);
    reflection=reflection*reflectedTransmission+waterLight*(1-reflectedTransmission);
    result=lerp(result,reflection,fresnel);
}else{
    // No caustic receiver exists at infinite sky depth. Avoid undefined
    // derivatives/normalization leaking black horizontal pixels into fog.
    if(receiverDistance>=300.)return lerp(source,source*transmission+waterLight*(1-transmission),blend);
    // Same wave Hessian as the accepted above-water caustics, evaluated at
    // the submerged receiver. Only shallow, sunlit, upward-facing receivers.
    float2 uv=(receiver.xy-WaterWindow.xy)/WaterWindow.z;
    float4 field=Texture2DSampleLevel(CoastalInfo,CoastalInfoSampler,uv,0);
    float depth=field.b-receiver.z;
    float3 gradient=cross(ddy(receiver),ddx(receiver));
    float3 normal=gradient*rsqrt(max(1.e-12,dot(gradient,gradient)));
    float mask=(all(uv>0)&&all(uv<1)?field.a:0)*smoothstep(.12,.45,depth)*(1-smoothstep(2.5,5.,depth))*SunStrength*abs(normal.z);
    float2 slope;float3 curvature;
    coast.fine(receiver.xy,WaveTime,max(.055,max(length(ddx(receiver.xy)),length(ddy(receiver.xy)))),slope,curvature);
    float focus=min(max(depth,0),2.5)*.35;
    float determinant=(1+focus*curvature.x)*(1+focus*curvature.z)-pow(focus*curvature.y,2);
    float width=max(.045,fwidth(determinant)*.65);
    float focal=1-smoothstep(width,width*2.2,abs(determinant));
    result*=lerp(1.,.97+focal*.9,mask);
}
float3 output=lerp(source,result*transmission+waterLight*(1-transmission),blend);
// Derivatives can be undefined at a water/terrain/sky discontinuity. Never
// feed a NaN into the tonemapper (which displayed it as black pixel streaks).
return all(isfinite(output))?output:waterLight;
