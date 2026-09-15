// World-anchored stochastic hex tiling and surface-gradient normal blending.
// Original implementation of the algorithms discussed in Mikkelsen, JCGT 2022.
// No frame/camera seed and no per-mesh UV reset. All PBR channels share patches.
struct TerrainSampler {
    float3 hash(int2 p) {
        uint h = uint(p.x)*1597334677u ^ uint(p.y)*3812015801u;
        h = (h ^ (h >> 16))*2246822519u;
        uint a = (h ^ (h >> 13))*3266489917u;
        uint b = (a ^ (a >> 16))*2246822519u;
        return float3(h & 0xffffffu, a & 0xffffffu, b & 0xffffffu)/16777216.0;
    }
    float noise(float2 p) {
        int2 i = int2(floor(p)); float2 f = frac(p); f=f*f*(3-2*f);
        return lerp(lerp(hash(i).x,hash(i+int2(1,0)).x,f.x),lerp(hash(i+int2(0,1)).x,hash(i+1).x,f.x),f.y);
    }
    void plane(Texture2D C, SamplerState CS, Texture2D N, SamplerState NS,
               Texture2D A, SamplerState AS, float2 uv, float2 dx, float2 dy,
               out float3 color, out float2 gradient, out float3 arm) {
        float2 lattice=float2(uv.x-uv.y*.577350269,uv.y*1.154700538);
        int2 cell=int2(floor(lattice)); float2 f=frac(lattice);
        int2 ids[3]; float3 weights;
        if(f.x+f.y<1) {
            ids[0]=cell; ids[1]=cell+int2(1,0); ids[2]=cell+int2(0,1);
            weights=float3(1-f.x-f.y,f.x,f.y);
        } else {
            ids[0]=cell+1; ids[1]=cell+int2(0,1); ids[2]=cell+int2(1,0);
            weights=float3(f.x+f.y-1,1-f.x,1-f.y);
        }
        float3 colors[3],arms[3]; float2 gradients[3];
        [unroll] for(int i=0;i<3;i++) {
            float3 random=hash(ids[i]); float s,c; sincos(random.z*6.283185307,s,c);
            float2 centre=float2(ids[i].x+ids[i].y*.5,ids[i].y*.866025404);
            float2 q=uv-centre;
            float2 sampleUV=float2(c*q.x-s*q.y,s*q.x+c*q.y)+random.xy;
            float2 gx=float2(c*dx.x-s*dx.y,s*dx.x+c*dx.y);
            float2 gy=float2(c*dy.x-s*dy.y,s*dy.x+c*dy.y);
            colors[i]=C.SampleGrad(CS,sampleUV,gx,gy).rgb;
            arms[i]=A.SampleGrad(AS,sampleUV,gx,gy).rgb;
            float2 normalXY=N.SampleGrad(NS,sampleUV,gx,gy).rg*2-1;
            float normalZ=sqrt(saturate(1-dot(normalXY,normalXY)));
            float2 g=-normalXY/max(normalZ,.25);
            gradients[i]=float2(c*g.x+s*g.y,-s*g.x+c*g.y);
            // Diffuse patch boundaries with source luminance, sharpen weights
            // instead of washing the scanned material into an average color.
            weights[i]=pow(max(weights[i],0),6)*(.4+.6*dot(colors[i],float3(.299,.587,.114)));
        }
        weights/=max(dot(weights,1),1e-8);
        color=0;gradient=0;arm=0;
        [unroll] for(int i=0;i<3;i++){color+=weights[i]*colors[i];gradient+=weights[i]*gradients[i];arm+=weights[i]*arms[i];}
    }
    void surface(Texture2D C, SamplerState CS, Texture2D N, SamplerState NS,
                 Texture2D A, SamplerState AS, float3 p, float3 n,
                 float3 dx, float3 dy, out float3 color, out float3 gradient, out float3 arm) {
        float3 weights=pow(abs(n),8);weights/=max(dot(weights,1),1e-6);
        color=0;gradient=0;arm=0;
        [unroll] for(int axis=0;axis<3;axis++) {
            if(weights[axis]<.005)continue;
            float2 uv=axis==0?p.yz:axis==1?p.xz:p.xy;
            float2 gx=axis==0?dx.yz:axis==1?dx.xz:dx.xy;
            float2 gy=axis==0?dy.yz:axis==1?dy.xz:dy.xy;
            float3 c,a;float2 g;plane(C,CS,N,NS,A,AS,uv,gx,gy,c,g,a);
            float3 worldGradient=axis==0?float3(0,g.x,g.y):axis==1?float3(g.x,0,g.y):float3(g.x,g.y,0);
            worldGradient-=n*dot(n,worldGradient);
            color+=c*weights[axis];gradient+=worldGradient*weights[axis];arm+=a*weights[axis];
        }
    }
};
TerrainSampler terrain;
float3 p=BiomeUV.x>=.99?float3(GlobalUV.xy,BiomeUV.y):WorldPosition/750.0,n=normalize(WorldNormal),dx=ddx(p),dy=ddy(p);
float snow=saturate(Weights.g),road=saturate(Weights.b),rock=saturate(Weights.r);
float3 blend=float3((1-rock)*(1-road),rock*(1-road),road)*(1-snow);
float3 color=snow*float3(.83,.88,.92),gradient=0,arm=snow*float3(1,.82,0);
float3 c,g,a;
float sharedClimate=step(.99,BiomeUV.x),dry=saturate(BiomeUV.x-1)*sharedClimate;
if(blend.x>.002){terrain.surface(GrassColor,GrassColorSampler,GrassNormal,GrassNormalSampler,GrassARM,GrassARMSampler,p,n,dx,dy,c,g,a);color+=c*VegetationTint*blend.x;gradient+=g*blend.x;arm+=a*blend.x;}
if(blend.y>.002){terrain.surface(RockColor,RockColorSampler,RockNormal,RockNormalSampler,RockARM,RockARMSampler,p*.7,n,dx*.7,dy*.7,c,g,a);color+=c*blend.y;gradient+=g*blend.y;arm+=a*blend.y;}
if(blend.z>.002){terrain.surface(RoadColor,RoadColorSampler,RoadNormal,RoadNormalSampler,RoadARM,RoadARMSampler,p,n,dx,dy,c,g,a);color+=c*blend.z;gradient+=g*blend.z;arm+=a*blend.z;}
// Shared climate comes from the same CPU field for local and distant terrain.
// Dry soils keep scanned microstructure while shedding temperate green tint.
float soilMask=smoothstep(.35,.92,dry)*blend.x;
float luminance=dot(color,float3(.299,.587,.114));
color=lerp(color,float3(.68,.49,.27)*max(.18,luminance*2.3),soilMask);
float macro=.84+.22*terrain.noise(p.xy/19)+.14*terrain.noise(p.xy/73+12.7);
// Beyond individually resolved crowns, integrate woodland coverage into the
// land material. It cannot spill over snow or exposed rock like an opaque fan.
float forest=(1-saturate(ForestAlpha))*blend.x*smoothstep(30000.,150000.,distance(CameraPosition,WorldPosition));
float crowns=.75+.25*terrain.noise(WorldPosition.xy/430.);
color=lerp(color,float3(.045,.09,.026)*crowns,forest*.85);
Normal=normalize(n-gradient*.65);
float2 waterUV=(WorldPosition.xy*.01-WaterWindow.xy)/WaterWindow.z;
float4 coastInfo=Texture2DSampleLevel(CoastalInfo,CoastalInfoSampler,waterUV,0);
float wet=Texture2DSampleLevel(FoamState,FoamStateSampler,waterUV,0).g;
float coastValid=WaterReady*coastInfo.a*(all(waterUV>0)&&all(waterUV<1)?1:0);
float actualBed=coastInfo.b-coastInfo.r;
float fieldEdge=saturate(min(min(waterUV.x,waterUV.y),min(1-waterUV.x,1-waterUV.y))*16);
float sediment=coastValid*fieldEdge*(1-smoothstep(6.,14.,abs(coastInfo.g)))*(1-smoothstep(.2,.6,abs(WorldPosition.z*.01-actualBed)))*smoothstep(.985,.998,n.z)*(1-smoothstep(.4,.95,-coastInfo.r))*(1-snow)*(1-road)*(1-rock);
float sandGrain=.83+.24*terrain.noise(p.xy*3.7)+.1*terrain.noise(p.xy*19.3);
color=lerp(color,float3(.44,.36,.23)*sandGrain,sediment*CoastalSediment);
float wetSand=wet*coastValid*(1-smoothstep(.08,.3,abs(WorldPosition.z*.01-actualBed)))*(1-smoothstep(.25,.5,-coastInfo.r))*(1-snow);
color*=1-wetSand*.32;
arm.g=lerp(arm.g,.24,wetSand*.8);
ARM=saturate(arm);
return saturate(color*lerp(macro,1,snow));
