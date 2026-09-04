import type { BasePlateAsset, Campaign, MaterialAsset, PropAsset, SceneTemplateAsset, TokenAsset } from "../domain/types";

export const EMPTY_TOKEN_ASSETS: TokenAsset[] = [];
Object.freeze(EMPTY_TOKEN_ASSETS);
export const EMPTY_PROP_ASSETS: PropAsset[] = [];
export const EMPTY_MATERIAL_ASSETS: MaterialAsset[] = [];
export const EMPTY_BASE_PLATE_ASSETS: BasePlateAsset[] = [];
export const EMPTY_SCENE_TEMPLATES: SceneTemplateAsset[] = [];
export const EMPTY_TOKEN_CHARACTER_LINKS: Readonly<Record<string, string>> = Object.freeze({});
Object.freeze(EMPTY_PROP_ASSETS);
Object.freeze(EMPTY_MATERIAL_ASSETS);
Object.freeze(EMPTY_BASE_PLATE_ASSETS);
Object.freeze(EMPTY_SCENE_TEMPLATES);

/** Tokens explicitly enabled for the active campaign and therefore placeable. */
export const selectTokenAssets = (state: { campaign: Campaign }): TokenAsset[] => state.campaign.tokenAssets ?? EMPTY_TOKEN_ASSETS;

/** Every reusable miniature stored on this computer, across campaigns. */
export const selectMiniatureLibrary = (state: { miniatureLibrary?: TokenAsset[] }): TokenAsset[] => state.miniatureLibrary ?? EMPTY_TOKEN_ASSETS;
export const selectPropAssets = (state: { campaign: Campaign }): PropAsset[] => state.campaign.propAssets ?? EMPTY_PROP_ASSETS;
export const selectMaterialAssets = (state: { campaign: Campaign }): MaterialAsset[] => state.campaign.materialAssets ?? EMPTY_MATERIAL_ASSETS;
export const selectPropLibrary = (state: { propLibrary?: PropAsset[] }): PropAsset[] => state.propLibrary ?? EMPTY_PROP_ASSETS;
export const selectMaterialLibrary = (state: { materialLibrary?: MaterialAsset[] }): MaterialAsset[] => state.materialLibrary ?? EMPTY_MATERIAL_ASSETS;
export const selectBasePlateAssets = (state: { campaign: Campaign }): BasePlateAsset[] => state.campaign.basePlateAssets ?? EMPTY_BASE_PLATE_ASSETS;
export const selectBasePlateLibrary = (state: { basePlateLibrary?: BasePlateAsset[] }): BasePlateAsset[] => state.basePlateLibrary ?? EMPTY_BASE_PLATE_ASSETS;
export const selectSceneTemplates = (state: { campaign: Campaign }): SceneTemplateAsset[] => state.campaign.sceneTemplates ?? EMPTY_SCENE_TEMPLATES;
export const selectSceneLibrary = (state: { sceneLibrary?: SceneTemplateAsset[] }): SceneTemplateAsset[] => state.sceneLibrary ?? EMPTY_SCENE_TEMPLATES;
export const selectTokenCharacterLinks = (state: { campaign: Campaign }): Readonly<Record<string, string>> => state.campaign.tokenCharacterLinks ?? EMPTY_TOKEN_CHARACTER_LINKS;
