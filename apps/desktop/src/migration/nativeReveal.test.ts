import{it,expect}from'vitest';import{readyRevealRadius,revealCoverageComplete,revealVisibleCoverageComplete}from'./nativeReveal';import{selectAtlasTiles,tileKey}from'../domain/worldAtlas';
it('holds the fog before missing coverage and advances only when covering geometry is ready',()=>{
 const s=selectAtlasTiles(0,0,{width:256,depth:256}),desired=new Set(s.desired.map(tileKey)),ready=new Set<string>();
 expect(readyRevealRadius(s.roots,desired,ready,256,256)).toBe(80);
 for(const t of s.desired)ready.add(tileKey(t));expect(readyRevealRadius(s.roots,desired,ready,256,256)).toBeGreaterThan(60000);
});
it('does not finish on empty, partial, or ancestor-only acknowledgements',()=>{
 const desired=new Set(['1/0/0','1/1/0']);
 expect(revealCoverageComplete(new Set(),new Set())).toBe(false);
 expect(revealCoverageComplete(desired,new Set(['2/0/0']))).toBe(false);
 expect(revealCoverageComplete(desired,new Set(['1/0/0']))).toBe(false);
 expect(revealCoverageComplete(desired,new Set([...desired,'2/0/0']))).toBe(true);
});
it('unmasks complete covering parents while refinement continues',()=>{
 const s=selectAtlasTiles(0,0,{width:256,depth:256}),desired=new Set(s.desired.map(tileKey));
 const ready=new Set(s.desired.filter(t=>Math.abs(t.x*32*2**t.level)<512&&Math.abs(t.z*32*2**t.level)<512).map(tileKey));
 const before=readyRevealRadius(s.roots,desired,ready,256,256);
 for(const t of s.roots)ready.add(tileKey(t));
 expect(readyRevealRadius(s.roots,desired,ready,256,256)).toBeGreaterThan(before);
 expect(revealCoverageComplete(desired,ready)).toBe(false);
});
it('advances over acknowledged nearby covering geometry',()=>{
 const s=selectAtlasTiles(0,0,{width:256,depth:256}),desired=new Set(s.desired.map(tileKey));
 const ready=new Set(['3/-1/-1','3/-1/0','3/0/-1','3/0/0']);
 expect(readyRevealRadius(s.roots,desired,ready,256,256)).toBe(208);
});

it('finishes nearby reveal without waiting on invisible far regions, but never on a local hole',()=>{
 const roots=[{level:1,x:0,z:0},{level:1,x:100,z:100}],desired=new Set(roots.map(tileKey));
 expect(revealVisibleCoverageComplete(roots,desired,new Set(['1/0/0']),0,0,100)).toBe(true);
 expect(revealVisibleCoverageComplete(roots,desired,new Set(['1/100/100']),0,0,100)).toBe(false);
 expect(revealVisibleCoverageComplete([],desired,new Set(),0,0,100)).toBe(false);
});
