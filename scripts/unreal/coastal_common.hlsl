// Shared by vertex displacement, normals and persistent foam. Metres/seconds.
// A spilling-wave profile; this does not represent an overturning fluid sheet.
struct Coastal {
 float2 wind;float strength;
 float hash(float2 p){return frac(sin(dot(p,float2(127.1,311.7)))*43758.5453);}
 float noise(float2 p){float2 i=floor(p),f=frac(p),u=f*f*(3-2*f);return lerp(lerp(hash(i),hash(i+float2(1,0)),u.x),lerp(hash(i+float2(0,1)),hash(i+1),u.x),u.y);}
 float envelope(float d,float s){return (1-smoothstep(8.,18.,abs(s)))*(1-smoothstep(1.4,2.8,d))*smoothstep(-.5,-.3,d);}
 float pulse(float2 p,float shore,float t,float period,float speed){float shift=noise(p*.027)*2.1+dot(p,float2(-.57,.82))*.023;float age=frac((t+shore/speed+shift)/period)*period;return exp(-pow((age-period*.43)/.62,2));}
 float height(float2 p,float d,float s,float t){float packet=pulse(p,s,t,7.3,1.65)+.42*pulse(p+31.7,s,t,10.7,1.25);return strength*envelope(d,s)*(.30*packet-.028);}
 float energy(Texture2D info,SamplerState state,float2 uv,float span){
  float e=1./512.;
  float2 slope=float2(info.SampleLevel(state,uv+float2(e,0),0).b-info.SampleLevel(state,uv-float2(e,0),0).b,info.SampleLevel(state,uv+float2(0,e),0).b-info.SampleLevel(state,uv-float2(0,e),0).b)/(2*e*span);
  return 1-smoothstep(.006,.04,length(slope));
 }
 // C2-continuous capillary height fields. Analytic gradient and Hessian of
 // exactly the same field drive normals and refracted-light focusing. Rotated
 // octaves avoid the intersecting periodic sine lattice of the old shader.
 void fine(float2 p,float t,float footprint,out float2 slope,out float3 curvature){
  slope=0;curvature=0;
  const float lengths[5]={1.31,.73,.41,.229,.127};
  const float angles[5]={.23,1.91,-.86,.72,2.6};
  [unroll] for(int j=0;j<5;j++){
   float2 U=float2(cos(angles[j]),sin(angles[j])),V=float2(-U.y,U.x);
   float scale=1/lengths[j];float2 q=float2(dot(p,U),dot(p,V))*scale+float2(t*.47,-t*.31)/sqrt(lengths[j])+j*19.17;
   float2 i=floor(q),f=frac(q),u=f*f*f*(f*(f*6-15)+10);
   float2 du=30*f*f*(f*(f-2)+1),ddu=60*f*(2*f*f-3*f+1);
   float a=hash(i),b=hash(i+float2(1,0)),c=hash(i+float2(0,1)),d=hash(i+1),k=a-b-c+d;
   float2 g=float2(du.x*(b-a+k*u.y),du.y*(c-a+k*u.x));
   float xx=ddu.x*(b-a+k*u.y),xy=k*du.x*du.y,yy=ddu.y*(c-a+k*u.x);
   float amp=strength*lengths[j]*.055*(1-smoothstep(.35,.85,footprint*scale));
   slope+=amp*scale*(g.x*U+g.y*V);
   curvature+=amp*scale*scale*float3(xx*U.x*U.x+2*xy*U.x*V.x+yy*V.x*V.x,xx*U.x*U.y+xy*(U.x*V.y+V.x*U.y)+yy*V.x*V.y,xx*U.y*U.y+2*xy*U.y*V.y+yy*V.y*V.y);
  }
 }
 void motion(float2 p,float d,float s,float2 shoreNormal,float t,out float2 velocity,out float birth){
  float packet=saturate(pulse(p,s,t,7.3,1.65)+.42*pulse(p+31.7,s,t,10.7,1.25));
  float exposure=strength*(.25+.75*saturate(dot(-shoreNormal,wind)));
  float patches=smoothstep(.24,.68,noise(p*.29+float2(t*.013,0))+.25*noise(p*.81));
  velocity=-shoreNormal*(packet*1.8-(1-packet)*.20)+float2(.08,.045);
  birth=1.8*packet*patches*exposure*envelope(d,s)*smoothstep(-.05,.16,d)*(1-smoothstep(.45,.85,d));
 }
};
Coastal coast;
coast.wind=normalize(WaterWind.xy+float2(.00001,0));coast.strength=WaterWind.z;
