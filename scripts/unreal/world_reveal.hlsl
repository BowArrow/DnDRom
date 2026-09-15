// World-anchored loading mist, in metres. No finite height slab: its end caps
// projected into a sharp wall at the horizon. Density instead tends to zero.
float3 c=CameraPosition*.01,d=normalize(-CameraVector);
float distanceToSurface=min(200000.,max(0.,SceneDepth*.01)/max(.001,dot(d,ResolvedView.ViewForward)));
float3 p=c+d*distanceToSurface;
float a=dot(d.xy,d.xy),b=dot(c.xy,d.xy),q=dot(c.xy,c.xy)-RevealRadius*RevealRadius;
float disc=max(0.,b*b-a*q);
float start=length(c.xy)<RevealRadius?max(0.,(-b+sqrt(disc))/max(1e-7,a)):0.;
float3 entry=c+d*start;
// Derivatives must precede divergent branches. Distant pixels cover tens of
// metres: unfiltered metre-scale billows become a repeating moire pattern.
float footprint=max(length(ddx(entry)),length(ddy(entry)));
float detail=1-smoothstep(2.,12.,footprint);
if(RevealOpacity<=0||SceneDepth>=10000000.||start>=distanceToSurface)return SceneColor.rgb;
// Loading mist never becomes a permanent horizon curtain. Far scenery uses
// the existing atmosphere; only receivers inside the reveal cohort are masked.
float receiverMask=(1-smoothstep(10000.,12000.,length(p.xy)))*smoothstep(max(0.,RevealRadius-24.),max(.01,RevealRadius),length(p.xy));
float skyMask=1-smoothstep(.08,.3,d.z);
if(receiverMask<=0||skyMask<=0)return SceneColor.rgb;
// Fixed world-space steps make an opaque ray independent of receiver depth.
float step=4.;
float transmittance=1.;float3 light=0;
[loop] for(int i=0;i<48;i++){
 float segment=min(step,distanceToSurface-start-i*step);if(segment<=0)break;
 float3 s=c+d*(start+i*step+segment*.5);
 float3 n=s*.014+float3(RevealTime*.035,RevealTime*.017,0);
 float billow=.5+detail*(.22*sin(n.x+sin(n.y*.71))+.18*sin(n.y+n.z*.8)+.1*sin(n.z+n.x*.63));
 // Noise pulls fog inward but cannot open holes beyond ready coverage.
 float edge=smoothstep(RevealRadius-12.,RevealRadius+12.,length(s.xy)+billow*8.);
 float height=max(0.,s.z)/500.;
 float vertical=exp(-.5*height*height);
 float extinction=edge*vertical*(.25+.16*billow);
 float absorb=1-exp(-extinction*segment);
 float3 color=lerp(float3(.48,.55,.58),float3(.72,.76,.77),saturate(billow))*(.32+.68*saturate(FogRadiance/1000.));
 light+=transmittance*absorb*color;transmittance*=1-absorb;
 if(transmittance<.001)break;
}
float3 result=lerp(SceneColor.rgb,SceneColor.rgb*transmittance+light,receiverMask*RevealOpacity*skyMask);
return all(isfinite(result))?result:SceneColor.rgb;
