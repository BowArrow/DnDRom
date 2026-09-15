float2 p=WorldPosition.xy*.01,uv=(p-WaterWindow.xy)/WaterWindow.z;
float4 info=Texture2DSampleLevel(CoastalInfo,CoastalInfoSampler,uv,0);
float valid=WaterReady*info.a*(all(uv>0)&&all(uv<1)?1:0)*(1-smoothstep(.5,1.,abs(WorldPosition.z*.01-info.b)));
float edge=saturate(min(min(uv.x,uv.y),min(1-uv.x,1-uv.y))*16);
float d=lerp(WaterData.r*4,info.r,valid),s=lerp(WaterData.g*24,info.g,valid);
float offshore=coast.strength*(1-smoothstep(10000.,18000.,distance(CameraPosition,WorldPosition)))*smoothstep(.3,2.8,d);
float swell=.08*sin(dot(p,float2(.94,.342))*.06544985-WaveTime*.8013)+.045*sin(dot(p,float2(.66,.751))*.036319-WaveTime*.5969+1.731);
return float3(0,0,100*(offshore*swell+valid*edge*coast.height(p,d,s,WaveTime)*coast.energy(CoastalInfo,CoastalInfoSampler,uv,WaterWindow.z)));
