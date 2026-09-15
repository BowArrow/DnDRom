// Building-local metres, persistent seed, age and climate moisture. No camera/time
// randomness. Stochastic sampling is shared by albedo, normal and roughness.
struct SurfaceField {
 float hash(float2 p) {uint2 q=uint2(int2(p));uint h=q.x*1597334677u^q.y*3812015801u;h=(h^(h>>16))*2246822519u;return float(h&0xffffffu)/16777216.;}
 float noise(float2 p){float2 i=floor(p),f=frac(p);f=f*f*(3-2*f);return lerp(lerp(hash(i),hash(i+float2(1,0)),f.x),lerp(hash(i+float2(0,1)),hash(i+1),f.x),f.y);}
};SurfaceField s;
float seed=floor(Profile.y+.00001),moisture=saturate(frac(Profile.y)/.49),age=Age;
float2 p=UV,offset=float2(seed,seed*3.17),macro=p*.19+offset;
float variation=s.noise(macro)*.65+s.noise(p*.71+offset)*.35;
float3 color=0,arm=0;float2 gradient=0;
float2 uv=p*.72+offset;
if(Mode<2.5){
 // Isotropic scanned grain, triangular patches. Construction joints are a
 // separate coherent field below, so blending cannot double mortar lines.
 float2 lattice=float2(uv.x-uv.y*.577350269,uv.y*1.154700538),cell=floor(lattice),f=frac(lattice);
 float2 cells[3];float3 weights;
 if(f.x+f.y<1){cells[0]=cell;cells[1]=cell+float2(1,0);cells[2]=cell+float2(0,1);weights=float3(1-f.x-f.y,f.x,f.y);}
 else{cells[0]=cell+1;cells[1]=cell+float2(0,1);cells[2]=cell+float2(1,0);weights=float3(f.x+f.y-1,1-f.x,1-f.y);}
 weights=pow(max(weights,.0001),3);weights/=dot(weights,1);
 [unroll]for(int i=0;i<3;i++){
  float2 shift=float2(s.hash(cells[i]),s.hash(cells[i]+71))*19.7;
  float2 q=uv+shift;float w=weights[i];
  color+=Texture2DSampleGrad(ColorTex,ColorTexSampler,q,ddx(uv),ddy(uv)).rgb*w;
  float2 n=Texture2DSampleGrad(NormalTex,NormalTexSampler,q,ddx(uv),ddy(uv)).rg*2-1;gradient+=n*w;
  arm+=Texture2DSampleGrad(ArmTex,ArmTexSampler,q,ddx(uv),ddy(uv)).rgb*w;
 }
}else{
 // Keep grain, boards and roof courses aligned. Their construction repeats;
 // stains and per-board/tile color do not repeat on that period.
 color=Texture2DSampleGrad(ColorTex,ColorTexSampler,uv,ddx(uv),ddy(uv)).rgb;
 gradient=Texture2DSampleGrad(NormalTex,NormalTexSampler,uv,ddx(uv),ddy(uv)).rg*2-1;
 arm=Texture2DSampleGrad(ArmTex,ArmTexSampler,uv,ddx(uv),ddy(uv)).rgb;
 float row=floor(p.y*4),unit=floor(p.x*(Mode>4.5?3:5)+s.hash(float2(row,seed)));
 color*=.91+.18*s.hash(float2(unit+seed,row));
}
if(Mode<.5){
 float row=floor(p.y/.32),x=p.x/(.48+s.hash(float2(row,seed))*.25)+s.hash(float2(row,seed+19));
 float2 cell=float2(floor(x),row),f=float2(frac(x),frac(p.y/.32));
 float edge=min(min(f.x,1-f.x)*.6,min(f.y,1-f.y)*.32);
 float aa=max(fwidth(edge),.0004),joint=1-smoothstep(.009-aa,.019+aa,edge);
 color*=.72+.6*s.hash(cell+offset);color=lerp(color,float3(.24,.22,.18),joint*.85);gradient*=1-joint*.9;
}else if(Mode<2.5){
 color=lerp(color,Mode<1.5?float3(.68,.64,.53):float3(.43,.31,.19),.45);
 // Worn plaster reveals the rough substrate in irregular patches.
 float chip=smoothstep(.68,.84,s.noise(p*3.7+offset))*age*.28;
 color=lerp(color,float3(.25,.22,.18),chip);arm.g=lerp(arm.g,.94,chip);
}
float upright=1-abs(WorldNormal.z),height=max(0,Profile.x);
float damp=(1-smoothstep(.08,1.2+moisture*.6,height))*moisture*upright;
float streak=smoothstep(.53,.8,s.noise(float2(p.x*5.2,p.y*.16)+offset))*upright;
float dirt=age*(.08+streak*.24+damp*.45);
float moss=age*moisture*smoothstep(.45,.72,s.noise(p*2.1+offset))*(damp+max(0,WorldNormal.z)*.2);
color*=lerp(.82,1.14,variation)*(1-dirt*.5);
color=lerp(color,float3(.07,.105,.028),saturate(moss*.68));
gradient*=Mode<2.5?.32:.65;
Normal=normalize(float3(gradient*(1-damp*.25),sqrt(saturate(1-dot(gradient,gradient)))));
ARM=float3(saturate(arm.r*(1-dirt*.12)),clamp(arm.g+age*.13+moss*.12-damp*.14,.38,.98),0);
return saturate(color*Tint);
