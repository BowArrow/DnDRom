import {beforeEach,expect,it,vi} from 'vitest';
import {enterWorldLocation,rebuildCurrentSettlement} from './worldGeneration';
const state=vi.hoisted(()=>({campaign:{} as any,scene:vi.fn(),rebuild:vi.fn(),commit:vi.fn(),switchScene:vi.fn(),addScene:vi.fn()}));
vi.mock('./campaignStore',()=>({useCampaignStore:{getState:()=>({campaign:state.campaign,switchScene:state.switchScene,addScene:state.addScene,commitSharedWorld:state.commit})}}));
vi.mock('./generationJobs',()=>({beginGenerationJob:()=> 'job',updateGenerationJob:vi.fn(),waitForGenerationJobTurn:async()=>true}));
vi.mock('../domain/sharedWorldClient',()=>({generateSharedScene:state.scene,rebuildSharedSettlement:state.rebuild}));
beforeEach(()=>{
 vi.clearAllMocks();const manifest={id:'world',revision:2,locations:[{id:'town',settlement:{buildings:[{id:'house',position:{x:25,y:0,z:0},yaw:0}],structures:[]}}]};
 const map={id:'map',name:'Town',locationId:'town',width:256,depth:256,world:{sharedWorld:manifest,site:{x:0,z:0,datum:0}},entities:[{id:'house',position:{x:25,y:0,z:0},rotation:{y:0},tags:['world:building']}]};
 state.campaign={id:'campaign',world:{id:'world',manifest},map,characters:[],scenes:[{id:'old-grid',map:structuredClone(map)},{id:'new-town',map:structuredClone(map)}]};
 state.campaign.scenes[0].map.entities[0].position.x=0;
 state.scene.mockResolvedValue(map);
});
it('skips a mislabeled grid cache when opening an accepted revised town',async()=>{
 await enterWorldLocation('town');expect(state.switchScene).toHaveBeenCalledWith('new-town');expect(state.scene).not.toHaveBeenCalled();
});
it('regenerates detail when only a mislabeled grid is cached, preserving its saved scene',async()=>{
 state.campaign.scenes.pop();await enterWorldLocation('town');expect(state.scene).toHaveBeenCalledOnce();expect(state.switchScene).not.toHaveBeenCalled();expect(state.addScene).toHaveBeenCalledOnce();expect(state.campaign.scenes[0].id).toBe('old-grid');
});
it('preserves authored lighting, weather and battle-grid settings during a layout upgrade',async()=>{
 Object.assign(state.campaign.map,{lighting:{exposure:.4},weather:{preset:'rain'},gridShape:'hex',gridSize:2});
 state.rebuild.mockResolvedValue(state.campaign.world);state.scene.mockResolvedValue({...state.campaign.map,lighting:{exposure:1},weather:{preset:'clear'},gridShape:'square',gridSize:1});
 await rebuildCurrentSettlement();expect(state.commit).toHaveBeenCalledWith(state.campaign.world,expect.objectContaining({lighting:{exposure:.4},weather:{preset:'rain'},gridShape:'hex',gridSize:2}));
});
