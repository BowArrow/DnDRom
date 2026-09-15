import {describe,it,expect} from "vitest";
import {visibleAtlasTiles} from "./nativeAtlasVisibility";
import {tileChildren,tileKey} from "../domain/worldAtlas";
describe("bounded native world visibility",()=>{
  it("keeps finer terrain visible while a coarser replacement is building",()=>{
    const root={x:-1,z:-1,level:2},children=tileChildren(root),grandchildren=tileChildren(children[0]);
    const ready=new Set([...children.slice(1),...grandchildren].map(tileKey));
    expect(new Set(visibleAtlasTiles([root],new Set([tileKey(root)]),ready,()=>false))).toEqual(ready);
    ready.add(tileKey(root));
    expect(visibleAtlasTiles([root],new Set([tileKey(root)]),ready,()=>false)).toEqual([tileKey(root)]);
  });
  it("retains partial coverage during coarsening without traversing empty subtrees",()=>{
    const root={x:0,z:0,level:10},ready=new Set(["0/0/0"]);let calls=0;
    expect(visibleAtlasTiles([root],new Set([tileKey(root)]),ready,()=>{calls++;return false;})).toEqual(["0/0/0"]);
    expect(calls).toBeLessThan(80);
  });
  it("does not expand an unavailable distant leaf into millions of cells",()=>{
    const root={x:2,z:2,level:10};let visits=0;
    const visible=visibleAtlasTiles([root],new Set([tileKey(root)]),new Set(),()=>{if(++visits>10)throw new Error("Unbounded traversal");return false;});
    expect(visible).toEqual([]);expect(visits).toBe(1);
  });
  it("shows available nearby children when their parent has not arrived",()=>{
    const root={x:0,z:0,level:1},children=tileChildren(root),desired=new Set(children.map(tileKey));
    expect(visibleAtlasTiles([root],desired,new Set([tileKey(children[0])]),()=>false)).toEqual([tileKey(children[0])]);
  });
  it("retains parent coverage until every replacement is available",()=>{
    const root={x:0,z:0,level:1},children=tileChildren(root),desired=new Set(children.map(tileKey));
    expect(visibleAtlasTiles([root],desired,new Set([tileKey(root),tileKey(children[0])]),()=>false)).toEqual([tileKey(root)]);
    expect(visibleAtlasTiles([root],desired,new Set([tileKey(root),...children.map(tileKey)]),()=>false)).toEqual(children.map(tileKey));
  });
});
