float2 p=WaterWindow.xy+UV*WaterWindow.z;
float4 info=Texture2DSampleLevel(CoastalInfo,CoastalInfoSampler,UV,0);
float texel=1./512.;
float2 gradient=float2(
 Texture2DSampleLevel(CoastalInfo,CoastalInfoSampler,UV+float2(texel,0),0).g-Texture2DSampleLevel(CoastalInfo,CoastalInfoSampler,UV-float2(texel,0),0).g,
 Texture2DSampleLevel(CoastalInfo,CoastalInfoSampler,UV+float2(0,texel),0).g-Texture2DSampleLevel(CoastalInfo,CoastalInfoSampler,UV-float2(0,texel),0).g);
gradient/=max(length(gradient),.01);
float2 velocity;float birth;
coast.motion(p,info.r,info.g,gradient,WaveTime,velocity,birth);
float energy=coast.energy(CoastalInfo,CoastalInfoSampler,UV,WaterWindow.z);
birth*=energy;velocity*=energy*info.a;
float2 previousUV=(p-velocity*DeltaTime-PreviousWindow.xy)/PreviousWindow.z;
float inside=all(previousUV>texel)&&all(previousUV<1-texel)?HistoryReady:0;
float2 old=Texture2DSampleLevel(FoamState,FoamStateSampler,previousUV,0).rg*inside;
// A temporarily missing coastal field during LOD handoff is not dry land.
// Keep bounded, decaying history until authoritative samples return.
if(info.a<.5)return float3(old.r*exp(-DeltaTime*.42),old.g*exp(-DeltaTime*.08),0);
float h=coast.height(p,info.r,info.g,WaveTime)*energy;
float wet=smoothstep(0.,.045,info.r+h);
float foam=saturate(old.r*exp(-DeltaTime*.42)+birth*FoamEmission*DeltaTime)*info.a;
foam*=exp(-DeltaTime*2.5*(1-wet));
// Sand wetness stays on the terrain instead of being advected with the foam.
float2 unadvected=(p-PreviousWindow.xy)/PreviousWindow.z;
float oldWet=Texture2DSampleLevel(FoamState,FoamStateSampler,unadvected,0).g;
float priorInside=all(unadvected>0)&&all(unadvected<1)?HistoryReady:0;
float wetSand=max(oldWet*priorInside*exp(-DeltaTime*.08),wet)*info.a;
return float3(foam,wetSand,0);
