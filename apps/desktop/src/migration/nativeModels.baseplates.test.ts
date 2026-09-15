import {it,expect,vi} from 'vitest';
import {loadNativeModels} from './nativeModels';
import {createBasePlateAsset,createBasePlateRecipe} from '../domain/baseplates';
import type {SceneViewportProps} from '../components/SceneViewport';
vi.mock('../persistence/tokenAssets',()=>({getStoredTokenModel:async()=>new ArrayBuffer(32)}));
vi.mock('../persistence/propAssets',()=>({getStoredPropModel:async()=>new ArrayBuffer(64)}));
vi.mock('./nativeBridge',()=>({nativeUpload:vi.fn()}));
it('resolves per-instance scenic assignments and shares matching native variants',async()=>{
 const recipe=createBasePlateRecipe('pond','Lily pad');recipe.layers=[recipe.layers[0],{...recipe.layers[0],id:'mesh',kind:'prop',name:'AI scenic mesh',propAssetId:'scenery'}];recipe.sceneryHeightRatio=.08;
 const base=createBasePlateAsset('Pond',recipe),other=createBasePlateAsset('High pond',{...recipe,sceneryHeightRatio:.3});
 const props={map:{entities:['a','b','c'].map(id=>({id,assetId:'token'}))},tokenAssets:[{id:'token',name:'Frog',storageKey:'token',modelScale:1,footprint:.55,base:{height:.14},defaultBasePlateAssetId:base.id}],propAssets:[{id:'scenery',storageKey:'scenery'}],basePlateAssets:[base,other],sceneBasePlateAssignments:{'entity:b':other.id}} as unknown as SceneViewportProps;
 const models=await loadNativeModels(props);expect(models.a.scenicBase).toMatchObject({diameter:1.1,heightRatio:.08});expect(models.b.scenicBase?.heightRatio).toBe(.3);expect(models.a).toBe(models.c);expect(models.a.cacheKey).not.toBe(models.b.cacheKey);
});
