// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {SettlementUpgradeNotice} from './SettlementUpgradeNotice';
const state=vi.hoisted(()=>({campaign:{map:{locationId:'town'},world:{manifest:{locations:[{id:'town',settlement:{version:undefined as number|undefined,buildings:[{}]}}]}}},matches:true,rebuild:vi.fn(),enter:vi.fn()}));
vi.mock('../state/campaignStore',()=>({useCampaignStore:(selector:(s:unknown)=>unknown)=>selector({campaign:state.campaign})}));
vi.mock('../state/worldGeneration',()=>({rebuildCurrentSettlement:state.rebuild,enterWorldLocation:state.enter}));
vi.mock('../domain/sharedSceneLayout',()=>({sharedSceneMatchesLayout:()=>state.matches}));
beforeEach(()=>{vi.clearAllMocks();state.matches=true;state.campaign.world.manifest.locations[0].settlement.version=undefined;state.rebuild.mockResolvedValue(undefined);});afterEach(cleanup);
it('offers an explicit upgrade for preserved legacy towns without rebuilding on mount',async()=>{
 render(<SettlementUpgradeNotice/>);expect(state.rebuild).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Upgrade town layout'));
 await waitFor(()=>expect(state.rebuild).toHaveBeenCalledOnce());expect(state.enter).not.toHaveBeenCalled();
});
it('opens the accepted town when an obsolete cache already claims the current version',async()=>{
 state.campaign.world.manifest.locations[0].settlement.version=2;state.matches=false;render(<SettlementUpgradeNotice/>);
 fireEvent.click(screen.getByText('Open current town'));await waitFor(()=>expect(state.enter).toHaveBeenCalledWith('town'));expect(state.rebuild).not.toHaveBeenCalled();
});
it('shows a protected-edit failure and keeps the upgrade available',async()=>{
 state.rebuild.mockRejectedValue(new Error('Edited buildings are preserved'));render(<SettlementUpgradeNotice/>);fireEvent.click(screen.getByText('Upgrade town layout'));
 expect((await screen.findByRole('alert')).textContent).toContain('Edited buildings are preserved');
});
