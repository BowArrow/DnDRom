// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import {BasePlateStudio} from './BasePlateStudio';
import {createStarterCampaign} from '../domain/seed';
import {DEFAULT_SCENE_LIGHTING} from '../domain/lighting';
const mocks=vi.hoisted(()=>({store:{} as Record<string,unknown>,generate:vi.fn(),ensure:vi.fn()}));
vi.mock('../state/campaignStore',()=>({useCampaignStore:(selector:(s:unknown)=>unknown)=>selector(mocks.store)}));
vi.mock('./TokenModelPreview',()=>({TokenModelPreview:()=>null}));
vi.mock('./StoredAssetPreview',()=>({BasePlateAssetPreview:()=>null}));
vi.mock('../ai/scenicImageGuide',()=>({createScenicImageGuide:async()=>new File(['guide'],'guide.png',{type:'image/png'}),SCENIC_IMAGE_NEGATIVE:'tall scenery'}));
vi.mock('../ai/localRuntime',()=>({ensureLocalRuntime:mocks.ensure,runtimeProgressPercent:()=>0}));
vi.mock('../ai/comfyWorkflowPreset',()=>({loadBundledWorkflow:async()=>({})}));
vi.mock('../ai/propImageClient',()=>({generateLocalPropCandidate:mocks.generate,generateHostedKreaCandidate:vi.fn(),resolvePropImageRoute:()=>({feature:'sana',workflow:'sana'})}));
const props={model:null,characterName:'Toadie',kind:'player',shape:'round',baseColor:'#111111',accentColor:'#888888',footprint:.55,modelScale:1,placementScale:1,lighting:DEFAULT_SCENE_LIGHTING,onClose:vi.fn(),onNotify:vi.fn()} as Parameters<typeof BasePlateStudio>[0];
beforeEach(()=>{localStorage.clear();mocks.store={campaign:createStarterCampaign(),basePlateLibrary:[],propLibrary:[],materialLibrary:[],updateSettings:vi.fn()};mocks.generate.mockReset().mockImplementation(async()=>new File(['image'],'concept.png',{type:'image/png'}));mocks.ensure.mockReset().mockResolvedValue({endpoint:'http://127.0.0.1:8188'});URL.createObjectURL=vi.fn(()=>`blob:${Math.random()}`);URL.revokeObjectURL=vi.fn();});
afterEach(cleanup);
it('updates both requests and cards from the current brief, including the second selection',async()=>{
 const view=render(<BasePlateStudio {...props}/>),brief='Giant lily pad floating on a pond';
 expect(view.queryByText('Concept 2: Tavern floorboards')).toBeNull();
 fireEvent.change(view.getByLabelText('Describe the complete base'),{target:{value:brief}});
 fireEvent.change(view.getByLabelText('Scenery height'),{target:{value:'.08'}});
 fireEvent.click(view.getByText('Generate two base concepts'));
 await waitFor(()=>expect(mocks.generate).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(view.getByText(`Concept 2: ${brief}`).closest('button')!.disabled).toBe(false));
 for(const call of mocks.generate.mock.calls){expect(call[1]).toContain(brief);expect(call[1]).toContain('8 percent');expect(call[1]).not.toMatch(/tavern|floorboards/i);expect(call[6]).toBeInstanceOf(File);expect(call[8]).toEqual({strength:.9,negativePrompt:'tall scenery'});}
 fireEvent.click(view.getByText(`Concept 2: ${brief}`));expect((view.getByLabelText('Describe the complete base') as HTMLTextAreaElement).value).toBe(brief);
 fireEvent.click(view.getByText('Approve this image'));
 fireEvent.change(view.getByLabelText('Describe the complete base'),{target:{value:'A shattered crystal moon'}});
 expect(view.queryByText('Approved for Pixal3D')).toBeNull();expect(view.queryByAltText('Selected scenic base concept')).toBeNull();
 fireEvent.click(view.getByText('Generate two base concepts'));await waitFor(()=>expect(mocks.generate).toHaveBeenCalledTimes(4));
 expect(mocks.generate.mock.calls[3][1]).toContain('A shattered crystal moon');expect(mocks.generate.mock.calls[3][1]).not.toContain('lily');
});
it('does not accept a late image response after cancellation',async()=>{
 let finish!:(file:File)=>void;mocks.generate.mockImplementationOnce(()=>new Promise<File>(resolve=>{finish=resolve;}));
 const view=render(<BasePlateStudio {...props}/>);fireEvent.change(view.getByLabelText('Describe the complete base'),{target:{value:'Lily pad'}});fireEvent.click(view.getByText('Generate two base concepts'));
 await waitFor(()=>expect(mocks.generate).toHaveBeenCalledOnce());fireEvent.click(view.getByText('Cancel current job'));
 await act(async()=>finish(new File(['old'],'old.png',{type:'image/png'})));
 await waitFor(()=>expect(view.queryByText('Cancel current job')).toBeNull());expect(view.queryByAltText('Selected scenic base concept')).toBeNull();expect(mocks.generate).toHaveBeenCalledOnce();
});
