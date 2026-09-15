import type { WorldRegionManifest } from "./types";

/** A connected circular opening stays inside the uploaded region. This mask
 * is presentation readiness, deliberately independent of gameplay visibility. */
export class WorldReveal {
  radius = 0;
  center = {x:0,z:0};
  private revealed = new Set<string>();
  private complete = false;
  follow(x:number,z:number):void {
    // Camera movement is not a generation event. Keep the revealed region
    // anchored in world space; streaming LOD changes must never replay it.
    void x;void z;
  }
  update(dt:number,manifest:WorldRegionManifest,isReady:(id:string)=>boolean,horizonReady:boolean):number {
    if(this.complete)return this.radius;
    for(const chunk of manifest.chunks)if(isReady(chunk.id))this.revealed.add(chunk.id);
    let safe = horizonReady ? 60000 : Math.max(32, this.radius+12);
    for(const chunk of manifest.chunks) if(!this.revealed.has(chunk.id)) {
      const b=chunk.bounds;
      safe=Math.min(safe,Math.hypot(Math.max(b.min.x-this.center.x,0,this.center.x-b.max.x),Math.max(b.min.z-this.center.z,0,this.center.z-b.max.z)));
    }
    // Reveal is monotonic, including after residency changes. Leave one full
    // soft-edge width hidden ahead of the first visible generation front.
    const target=Math.max(0,safe-12);
    this.radius=Math.max(this.radius,Math.min(target,this.radius+Math.min(.1,dt)*Math.max(18,this.radius*.8)));
    this.complete=this.radius>=59988;
    return this.radius;
  }
}
