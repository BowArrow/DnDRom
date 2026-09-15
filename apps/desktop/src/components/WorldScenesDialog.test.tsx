// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {fireEvent,render,waitFor} from '@testing-library/react';
import {WorldScenesDialog} from './WorldScenesDialog';
const fixture=vi.hoisted(()=>({enter:vi.fn().mockResolvedValue(true),campaign:{id:'campaign',map:{locationId:'harbor',journey:{level:'settlement'}},scenes:[],world:{name:'Lake world',manifest:{locations:[{id:'harbor',requestId:'harbor',name:'Harbor town',position:{y:5},biome:'temperate-forest',settlement:{buildings:[{}]}},{id:'mainland',requestId:'mainland',name:'Mainland village',position:{y:8},biome:'steppe',settlement:{buildings:[]}}],requests:[],transport:[{id:'ferry',from:'harbor',to:'mainland',mode:'ferry',length:1500,bridges:[]}]}}},pending:{campaignId:'campaign',status:'running',requests:[{id:'shrine',name:'Mountain shrine',status:'pending'}]}}));
vi.mock('../state/campaignStore',()=>({useCampaignStore:(select:(s:unknown)=>unknown)=>select({campaign:fixture.campaign})}));
vi.mock('../state/worldGeneration',()=>({enterWorldLocation:fixture.enter,useWorldGeneration:()=>fixture.pending}));
it('lists accepted and pending locations with connections and opens only accepted geography',async()=>{
  HTMLDialogElement.prototype.showModal=vi.fn();HTMLDialogElement.prototype.close=vi.fn();
  const close=vi.fn(),view=render(<WorldScenesDialog open onClose={close}/>);
  expect(view.getByText('Harbor town')).toBeTruthy();expect(view.getByText(/Ferry to Mainland village/)).toBeTruthy();
  expect((view.getByText('Awaiting accepted geography') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByText('Open scene'));
  await waitFor(()=>expect(fixture.enter).toHaveBeenCalledWith('mainland',expect.any(AbortSignal)));
  await waitFor(()=>expect(close).toHaveBeenCalled());
});
