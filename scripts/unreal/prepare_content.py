"""Run with UnrealEditor-Cmd -run=pythonscript. No external Python packages.

Creates only missing assets. Existing authored UE materials/maps are preserved.
All source textures stay in the repository's existing CC0 library.
"""
import math
import json
import os
import pathlib
import struct
import unreal as u

ROOT = pathlib.Path(os.environ["DNDROM_REPO_ROOT"])
TOOLS = u.AssetToolsHelpers.get_asset_tools()
EDIT = u.MaterialEditingLibrary
ASSETS = u.EditorAssetLibrary


def asset(name, folder, cls, factory):
    existing = u.load_asset(folder + "/" + name)
    if existing:
        return existing, False
    result = TOOLS.create_asset(name, folder, cls, factory)
    if not result:
        raise RuntimeError("Could not create " + folder + "/" + name)
    return result, True


def texture(filename, normal=False, masks=False):
    name = pathlib.Path(filename).stem
    existing = u.load_asset("/Game/DnDRom/Textures/" + name)
    if existing:
        return existing
    task = u.AssetImportTask()
    for key, value in dict(filename=str(filename), destination_path="/Game/DnDRom/Textures", automated=True, save=True, replace_existing=False).items():
        task.set_editor_property(key, value)
    TOOLS.import_asset_tasks([task])
    imported = task.get_editor_property("imported_object_paths")
    if not imported:
        raise RuntimeError("Texture import failed: " + str(filename))
    result = u.load_asset(imported[0])
    if normal:
        result.set_editor_property("compression_settings", u.TextureCompressionSettings.TC_NORMALMAP)
        result.set_editor_property("flip_green_channel", True)  # source OpenGL -> UE DirectX normals
    if masks:
        result.set_editor_property("compression_settings", u.TextureCompressionSettings.TC_MASKS)
    result.set_editor_property("srgb", not normal and not masks)
    ASSETS.save_loaded_asset(result)
    return result


def node(material, cls, **properties):
    result = EDIT.create_material_expression(material, cls)
    for key, value in properties.items():
        result.set_editor_property(key, value)
    return result


def link(source, output, target, input_name):
    if output == "RGB" and isinstance(source, u.MaterialExpressionVertexColor):
        output = ""  # VertexColor's combined output is unnamed in UE 5.8.
    if not EDIT.connect_material_expressions(source, output, target, input_name):
        raise RuntimeError("Material connection failed: " + output + " -> " + input_name)


def prop(source, output, target):
    if not EDIT.connect_material_property(source, output, target):
        raise RuntimeError("Material property connection failed")


def clear_material(material):
    # UE 5.8 DeleteAllMaterialExpressions iterates a view while removing its
    # elements. Delete a snapshot so repeated generation cannot leave old
    # custom-output nodes behind (Single Layer Water permits exactly one).
    for expression in list(EDIT.get_material_expressions(material)):
        EDIT.delete_material_expression(material, expression)
    if EDIT.get_num_material_expressions(material):
        raise RuntimeError("Generated material graph did not clear")


def pbr_nodes(material, source_id):
    folder = ROOT / "apps/desktop/public/materials/polyhaven" / source_id
    outputs = []
    for suffix, normal, masks in [("diff", False, False), ("nor_gl", True, False), ("arm", False, True)]:
        image = texture(folder / (source_id + "_" + suffix + "_1k.jpg"), normal, masks)
        sample = node(material, u.MaterialExpressionTextureSample, texture=image)
        if normal:
            sample.set_editor_property("sampler_type", u.MaterialSamplerType.SAMPLERTYPE_NORMAL)
        elif masks:
            sample.set_editor_property("sampler_type", u.MaterialSamplerType.SAMPLERTYPE_MASKS)
        outputs.append(sample)
    return outputs


def finish(material):
    EDIT.set_material_usage(material, u.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES)
    EDIT.recompile_material(material)
    ASSETS.save_loaded_asset(material)


def make_surface(role, source_id):
    material, fresh = asset("M_" + role, "/Game/DnDRom/Materials", u.Material, u.MaterialFactoryNew())
    if not fresh:
        return
    material.set_editor_property("two_sided", role == "roof")
    color, normal, arm = pbr_nodes(material, source_id)
    vertex = node(material, u.MaterialExpressionVertexColor)
    multiply = node(material, u.MaterialExpressionMultiply)
    link(color, "RGB", multiply, "A"); link(vertex, "RGB", multiply, "B")
    prop(multiply, "", u.MaterialProperty.MP_BASE_COLOR)
    prop(normal, "RGB", u.MaterialProperty.MP_NORMAL)
    for channel, target in [("R", u.MaterialProperty.MP_AMBIENT_OCCLUSION), ("G", u.MaterialProperty.MP_ROUGHNESS), ("B", u.MaterialProperty.MP_METALLIC)]:
        prop(arm, channel, target)
    finish(material)



def make_settlement_surface(role, source_id, mode):
    material, fresh = asset("M_"+role, "/Game/DnDRom/Materials", u.Material, u.MaterialFactoryNew())
    if not fresh:
        if ASSETS.get_metadata_tag(material,"DnDRomSettlementVersion")=="2": return
        clear_material(material)
    material.set_editor_property("two_sided", role.startswith("roof"))
    folder=ROOT/"apps/desktop/public/materials/polyhaven"/source_id
    inputs={}
    for name,suffix,normal,masks in [("ColorTex","diff",False,False),("NormalTex","nor_gl",True,False),("ArmTex","arm",False,True)]:
        inputs[name]=node(material,u.MaterialExpressionTextureObject,texture=texture(folder/(source_id+"_"+suffix+"_1k.jpg"),normal,masks))
    vertex=node(material,u.MaterialExpressionVertexColor)
    inputs.update({"UV":node(material,u.MaterialExpressionTextureCoordinate,coordinate_index=0),"Profile":node(material,u.MaterialExpressionTextureCoordinate,coordinate_index=1),"Tint":vertex,"Age":vertex,"WorldNormal":node(material,u.MaterialExpressionVertexNormalWS),"Mode":node(material,u.MaterialExpressionConstant,r=mode)})
    custom=node(material,u.MaterialExpressionCustom,code=(ROOT/"scripts/unreal/settlement_surface.hlsl").read_text(),output_type=u.CustomMaterialOutputType.CMOT_FLOAT3)
    pins=[]
    for name in inputs:
        item=u.CustomInput();item.set_editor_property("input_name",name);pins.append(item)
    custom.set_editor_property("inputs",pins)
    outputs=[]
    for name in ["Normal","ARM"]:
        item=u.CustomOutput();item.set_editor_property("output_name",name);item.set_editor_property("output_type",u.CustomMaterialOutputType.CMOT_FLOAT3);outputs.append(item)
    custom.set_editor_property("additional_outputs",outputs)
    for name,source in inputs.items():link(source,"A" if name=="Age" else "",custom,name)
    prop(custom,"",u.MaterialProperty.MP_BASE_COLOR);prop(custom,"Normal",u.MaterialProperty.MP_NORMAL)
    for channel,target in [("r",u.MaterialProperty.MP_AMBIENT_OCCLUSION),("g",u.MaterialProperty.MP_ROUGHNESS)]:
        mask=node(material,u.MaterialExpressionComponentMask,r=channel=="r",g=channel=="g",b=False,a=False);link(custom,"ARM",mask,"");prop(mask,"",target)
    finish(material);ASSETS.set_metadata_tag(material,"DnDRomSettlementVersion","2");ASSETS.save_loaded_asset(material)


def make_settlement_flora():
    material,fresh=asset("M_settlement_flora","/Game/DnDRom/Materials",u.Material,u.MaterialFactoryNew())
    if not fresh:return
    material.set_editor_property("two_sided",True)
    material.set_editor_property("blend_mode",u.BlendMode.BLEND_MASKED)
    material.set_editor_property("shading_model",u.MaterialShadingModel.MSM_TWO_SIDED_FOLIAGE)
    vertex=node(material,u.MaterialExpressionVertexColor);prop(vertex,"",u.MaterialProperty.MP_BASE_COLOR)
    sub=node(material,u.MaterialExpressionMultiply,const_b=.2);link(vertex,"",sub,"A");prop(sub,"",u.MaterialProperty.MP_SUBSURFACE_COLOR)
    prop(node(material,u.MaterialExpressionConstant,r=.86),"",u.MaterialProperty.MP_ROUGHNESS)
    distance=node(material,u.MaterialExpressionDistance);link(node(material,u.MaterialExpressionWorldPosition),"",distance,"A");link(node(material,u.MaterialExpressionCameraPositionWS),"",distance,"B")
    start=node(material,u.MaterialExpressionSubtract,const_b=6500);link(distance,"",start,"A")
    divide=node(material,u.MaterialExpressionDivide,const_b=4500);link(start,"",divide,"A")
    clamp=node(material,u.MaterialExpressionSaturate);link(divide,"",clamp,"")
    inverse=node(material,u.MaterialExpressionOneMinus);link(clamp,"",inverse,"")
    fade=node(material,u.MaterialExpressionMaterialFunctionCall,material_function=u.load_asset("/Engine/Functions/Engine_MaterialFunctions02/Utility/DitherTemporalAA"))
    link(inverse,"",fade,"Alpha Threshold");prop(fade,"",u.MaterialProperty.MP_OPACITY_MASK)
    finish(material)

def make_terrain():
    material, fresh = asset("M_terrain", "/Game/DnDRom/Materials", u.Material, u.MaterialFactoryNew())
    if not fresh:
        if ASSETS.get_metadata_tag(material, "DnDRomTerrainVersion") == "12":
            return
        clear_material(material)
    material.set_editor_property("tangent_space_normal", False)
    inputs = {}
    for prefix, source_id in [("Grass", "sparse_grass"), ("Rock", "rock_boulder_dry"), ("Road", "brown_mud")]:
        folder = ROOT / "apps/desktop/public/materials/polyhaven" / source_id
        for channel, suffix, normal, masks in [("Color", "diff", False, False), ("Normal", "nor_gl", True, False), ("ARM", "arm", False, True)]:
            image = texture(folder / (source_id + "_" + suffix + "_1k.jpg"), normal, masks)
            inputs[prefix + channel] = node(material, u.MaterialExpressionTextureObject, texture=image)
    inputs["WorldPosition"] = node(material, u.MaterialExpressionWorldPosition)
    inputs["CameraPosition"] = node(material, u.MaterialExpressionCameraPositionWS)
    inputs["WorldNormal"] = node(material, u.MaterialExpressionVertexNormalWS)
    inputs["Weights"] = node(material, u.MaterialExpressionVertexColor)
    inputs["ForestAlpha"] = inputs["Weights"]
    inputs["VegetationTint"] = node(material, u.MaterialExpressionVectorParameter, parameter_name="VegetationTint", default_value=u.LinearColor(.44, .68, .27))
    inputs["BiomeUV"] = node(material, u.MaterialExpressionTextureCoordinate, coordinate_index=1)
    inputs["GlobalUV"] = node(material, u.MaterialExpressionTextureCoordinate, coordinate_index=0)
    inputs.update(coastal_inputs(material))
    custom = node(material, u.MaterialExpressionCustom,
                  code=(ROOT / "scripts/unreal/terrain_stochastic.hlsl").read_text(),
                  output_type=u.CustomMaterialOutputType.CMOT_FLOAT3)
    custom_inputs = []
    for name in inputs:
        item = u.CustomInput(); item.set_editor_property("input_name", name); custom_inputs.append(item)
    custom.set_editor_property("inputs", custom_inputs)
    outputs = []
    for name in ["Normal", "ARM"]:
        item = u.CustomOutput(); item.set_editor_property("output_name", name)
        item.set_editor_property("output_type", u.CustomMaterialOutputType.CMOT_FLOAT3); outputs.append(item)
    custom.set_editor_property("additional_outputs", outputs)
    for name, source in inputs.items():
        link(source, "A" if name == "ForestAlpha" else "", custom, name)
    prop(custom, "", u.MaterialProperty.MP_BASE_COLOR)
    prop(custom, "Normal", u.MaterialProperty.MP_NORMAL)
    for channel, target in [("r", u.MaterialProperty.MP_AMBIENT_OCCLUSION), ("g", u.MaterialProperty.MP_ROUGHNESS), ("b", u.MaterialProperty.MP_METALLIC)]:
        mask = node(material, u.MaterialExpressionComponentMask, r=channel == "r", g=channel == "g", b=channel == "b", a=False)
        link(custom, "ARM", mask, ""); prop(mask, "", target)
    finish(material)
    ASSETS.set_metadata_tag(material, "DnDRomTerrainVersion", "12")
    ASSETS.save_loaded_asset(material)


def foliage_image(style):
    """Deterministic branchlet cutout; bake once, ordinary UE texture mips."""
    size = 128; pixels = bytearray()
    evergreen = style in ("pine", "cypress")
    for y in range(size):
        for x in range(size):
            coverage = max(0., 1.5 - abs(x - (64 + math.sin(y * .025) * 2))) if 6 < y < 123 else 0.
            if evergreen:
                for j in range(30):
                    cy = 116 - j * 3.4; length = (15 + 20 * math.sin(j * .1)) * (.65 if style == "cypress" else 1)
                    t = abs(x - 64) / length
                    if 0 < t < 1:
                        coverage = max(coverage, 1.7 - abs(y - (cy - 15 * t)))
            else:
                for j in range(10):
                    sign = 1 if j % 2 else -1; cx = 64 + sign * 14; cy = 110 - j * 9.5
                    dx, dy = x - cx, y - cy
                    along = dx * sign * .6 - dy * .8; across = dx * .8 + dy * sign * .6
                    coverage = max(coverage, (1 - (along / 17) ** 2 - (across / 7) ** 2) * 4)
            alpha = round(max(0, min(1, coverage)) * 255)
            shade = 205 + round(25 * math.sin(x * .2) ** 2)
            pixels.extend([shade - 12, shade, shade, alpha])
    destination = ROOT / "artifacts/unreal-source" / ("leaves_" + style + ".tga")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(struct.pack("<BBBHHBHHHHBB", 0, 0, 2, 0, 0, 0, 0, 0, size, size, 32, 0x28) + pixels)
    return destination


def make_foliage(style):
    role = "grass_blades" if style == "grass" else "leaves_" + style
    material, fresh = asset("M_" + role, "/Game/DnDRom/Materials", u.Material, u.MaterialFactoryNew())
    if not fresh:
        return
    material.set_editor_property("two_sided", True)
    material.set_editor_property("shading_model", u.MaterialShadingModel.MSM_TWO_SIDED_FOLIAGE)
    vertex = node(material, u.MaterialExpressionVertexColor)
    if style == "grass":
        base = node(material, u.MaterialExpressionConstant3Vector, constant=u.LinearColor(.10, .22, .04))
    else:
        material.set_editor_property("blend_mode", u.BlendMode.BLEND_MASKED)
        material.set_editor_property("opacity_mask_clip_value", .35)
        sample = node(material, u.MaterialExpressionTextureSample, texture=texture(foliage_image(style)))
        base = node(material, u.MaterialExpressionMultiply)
        link(sample, "RGB", base, "A"); link(vertex, "RGB", base, "B")
        prop(sample, "A", u.MaterialProperty.MP_OPACITY_MASK)
    prop(base, "", u.MaterialProperty.MP_BASE_COLOR)
    prop(base, "", u.MaterialProperty.MP_SUBSURFACE_COLOR)
    rough = node(material, u.MaterialExpressionConstant, r=.85)
    prop(rough, "", u.MaterialProperty.MP_ROUGHNESS)
    finish(material)


def coastal_inputs(material):
    filename=ROOT / "artifacts/unreal-source/coastal_blank.tga"
    filename.parent.mkdir(parents=True,exist_ok=True)
    if not filename.exists(): filename.write_bytes(struct.pack("<BBBHHBHHHHBB",0,0,2,0,0,0,0,0,4,4,32,0x28)+bytes(64))
    blank=texture(filename,masks=True)
    blank.set_editor_property("compression_settings",u.TextureCompressionSettings.TC_VECTOR_DISPLACEMENTMAP)
    blank.set_editor_property("srgb",False);ASSETS.save_loaded_asset(blank)
    inputs={}
    for name in ["CoastalInfo","FoamState"]:
        inputs[name]=node(material,u.MaterialExpressionTextureObjectParameter,parameter_name=name,texture=blank,sampler_type=u.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
    inputs["WaterWindow"]=node(material,u.MaterialExpressionVectorParameter,parameter_name="WaterWindow",default_value=u.LinearColor(0,0,256,0))
    inputs["WaterWind"]=node(material,u.MaterialExpressionVectorParameter,parameter_name="WaterWind",default_value=u.LinearColor(.82,.57,1,0))
    for name,value in [("WaterReady",0),("WaveTime",0),("CoastalSediment",0)]:inputs[name]=node(material,u.MaterialExpressionScalarParameter,parameter_name=name,default_value=value)
    return inputs


def make_foam_update():
    material,fresh=asset("M_foam_update","/Game/DnDRom/Materials",u.Material,u.MaterialFactoryNew())
    if not fresh:
        if ASSETS.get_metadata_tag(material,"DnDRomFoamVersion")=="5":return
        clear_material(material)
    material.set_editor_property("shading_model",u.MaterialShadingModel.MSM_UNLIT)
    inputs=coastal_inputs(material)
    inputs["UV"]=node(material,u.MaterialExpressionTextureCoordinate)
    inputs["PreviousWindow"]=node(material,u.MaterialExpressionVectorParameter,parameter_name="PreviousWindow",default_value=u.LinearColor(0,0,256,0))
    for name,value in [("DeltaTime",1/30),("FoamEmission",1),("HistoryReady",0)]:inputs[name]=node(material,u.MaterialExpressionScalarParameter,parameter_name=name,default_value=value)
    code=(ROOT/"scripts/unreal/coastal_common.hlsl").read_text()+(ROOT/"scripts/unreal/foam_update.hlsl").read_text()
    custom=node(material,u.MaterialExpressionCustom,code=code,output_type=u.CustomMaterialOutputType.CMOT_FLOAT3)
    pins=[]
    for name in inputs:
        item=u.CustomInput();item.set_editor_property("input_name",name);pins.append(item)
    custom.set_editor_property("inputs",pins)
    for name,source in inputs.items():link(source,"",custom,name)
    prop(custom,"",u.MaterialProperty.MP_EMISSIVE_COLOR)
    finish(material);ASSETS.set_metadata_tag(material,"DnDRomFoamVersion","5");ASSETS.save_loaded_asset(material)


def make_water():
    material, fresh = asset("M_water", "/Game/DnDRom/Materials", u.Material, u.MaterialFactoryNew())
    if not fresh:
        if ASSETS.get_metadata_tag(material, "DnDRomWaterVersion") == "13":
            return
        clear_material(material)
    material.set_editor_property("shading_model", u.MaterialShadingModel.MSM_SINGLE_LAYER_WATER)
    material.set_editor_property("blend_mode", u.BlendMode.BLEND_MASKED)
    material.set_editor_property("tangent_space_normal", True)
    material.set_editor_property("max_world_position_offset_displacement", 64.)
    material.set_editor_property("refraction_method", u.RefractionMode.RM_PIXEL_NORMAL_OFFSET)
    inputs = {"WorldPosition": node(material, u.MaterialExpressionWorldPosition),
              "CameraPosition": node(material, u.MaterialExpressionCameraPositionWS),
              "WaterData": node(material, u.MaterialExpressionVertexColor)}
    inputs.update(coastal_inputs(material))
    vertex_inputs=dict(inputs)
    inputs["BehindDepth"]=node(material,u.MaterialExpressionSceneDepthWithoutWater,fallback_depth=1.e8)
    inputs["SurfaceDepth"]=node(material,u.MaterialExpressionPixelDepth)
    inputs["SunStrength"]=node(material,u.MaterialExpressionScalarParameter,parameter_name="SunStrength",default_value=1.)
    common=(ROOT/"scripts/unreal/coastal_common.hlsl").read_text()
    custom = node(material, u.MaterialExpressionCustom, code=common+(ROOT / "scripts/unreal/water_surface.hlsl").read_text(), output_type=u.CustomMaterialOutputType.CMOT_FLOAT3)
    custom_inputs = []
    for name in inputs:
        item = u.CustomInput(); item.set_editor_property("input_name", name); custom_inputs.append(item)
    custom.set_editor_property("inputs", custom_inputs)
    outputs = []
    for name, kind in [("Normal", u.CustomMaterialOutputType.CMOT_FLOAT3), ("Foam", u.CustomMaterialOutputType.CMOT_FLOAT1), ("Caustics",u.CustomMaterialOutputType.CMOT_FLOAT1),("WetMask",u.CustomMaterialOutputType.CMOT_FLOAT1)]:
        item = u.CustomOutput(); item.set_editor_property("output_name", name); item.set_editor_property("output_type", kind); outputs.append(item)
    custom.set_editor_property("additional_outputs", outputs)
    for name, source in inputs.items(): link(source, "", custom, name)
    prop(custom, "", u.MaterialProperty.MP_BASE_COLOR)
    prop(custom,"WetMask",u.MaterialProperty.MP_OPACITY_MASK)
    tangent = node(material,u.MaterialExpressionTransform,transform_source_type=u.MaterialVectorCoordTransformSource.TRANSFORMSOURCE_WORLD,transform_type=u.MaterialVectorCoordTransform.TRANSFORM_TANGENT)
    link(custom,"Normal",tangent,""); prop(tangent,"",u.MaterialProperty.MP_NORMAL)
    # Separate vertex expression: pixel derivatives cannot compile in WPO.
    wave = node(material, u.MaterialExpressionCustom, output_type=u.CustomMaterialOutputType.CMOT_FLOAT3,
        code=common+(ROOT/"scripts/unreal/water_displacement.hlsl").read_text())
    vertex_pins=[]
    for name in vertex_inputs:
        item=u.CustomInput();item.set_editor_property("input_name",name);vertex_pins.append(item)
    wave.set_editor_property("inputs", vertex_pins)
    for name, source in vertex_inputs.items(): link(source, "", wave, name)
    prop(wave, "", u.MaterialProperty.MP_WORLD_POSITION_OFFSET)
    for value, target in [(.5,u.MaterialProperty.MP_SPECULAR),(1.05,u.MaterialProperty.MP_REFRACTION)]:
        prop(node(material,u.MaterialExpressionConstant,r=value), "", target)
    for a,b,target in [(.27,.82,u.MaterialProperty.MP_ROUGHNESS),(.12,.96,u.MaterialProperty.MP_OPACITY)]:
        mix=node(material,u.MaterialExpressionLinearInterpolate,const_a=a,const_b=b);link(custom,"Foam",mix,"Alpha");prop(mix,"",target)
    volume = node(material, u.MaterialExpressionSingleLayerWaterMaterialOutput)
    # Raw UE 5.8 output pins use 1/cm, NOT 1/metre (installed header).
    for name, color in [("ScatteringCoefficients",(.00008,.00018,.00020)),("AbsorptionCoefficients",(.0024,.00065,.00030))]:
        link(node(material,u.MaterialExpressionConstant3Vector,constant=u.LinearColor(*color)), "", volume, name)
    link(custom,"Caustics",volume,"ColorScaleBehindWater")
    link(node(material,u.MaterialExpressionConstant,r=.25), "", volume, "PhaseG")
    finish(material)
    ASSETS.set_metadata_tag(material, "DnDRomWaterVersion", "13"); ASSETS.save_loaded_asset(material)



def make_world_reveal():
    material,fresh=asset("M_world_reveal","/Game/DnDRom/Materials",u.Material,u.MaterialFactoryNew())
    if not fresh:
        if ASSETS.get_metadata_tag(material,"DnDRomRevealVersion")=="9":return
        clear_material(material)
    material.set_editor_property("material_domain",u.MaterialDomain.MD_POST_PROCESS)
    material.set_editor_property("blendable_location",u.BlendableLocation.BL_SCENE_COLOR_AFTER_TONEMAPPING)
    inputs={"WorldPosition":node(material,u.MaterialExpressionWorldPosition),"CameraPosition":node(material,u.MaterialExpressionCameraPositionWS),"SceneColor":node(material,u.MaterialExpressionSceneTexture,scene_texture_id=u.SceneTextureId.PPI_POST_PROCESS_INPUT0)}
    inputs["CameraVector"]=node(material,u.MaterialExpressionCameraVectorWS)
    inputs["SceneDepth"]=node(material,u.MaterialExpressionSceneDepth)
    for name,value in [("RevealRadius",0),("RevealTime",0),("RevealOpacity",0),("FogRadiance",1000)]:inputs[name]=node(material,u.MaterialExpressionScalarParameter,parameter_name=name,default_value=value)
    custom=node(material,u.MaterialExpressionCustom,code=(ROOT/"scripts/unreal/world_reveal.hlsl").read_text(encoding="utf-8-sig"),output_type=u.CustomMaterialOutputType.CMOT_FLOAT3)
    pins=[]
    for name in inputs:
        item=u.CustomInput();item.set_editor_property("input_name",name);pins.append(item)
    custom.set_editor_property("inputs",pins)
    for name,source in inputs.items():link(source,"Color" if name=="SceneColor" else "",custom,name)
    prop(custom,"",u.MaterialProperty.MP_EMISSIVE_COLOR)
    finish(material);ASSETS.set_metadata_tag(material,"DnDRomRevealVersion","9");ASSETS.save_loaded_asset(material)

def make_underwater():
    material,fresh=asset("M_underwater","/Game/DnDRom/Materials",u.Material,u.MaterialFactoryNew())
    if not fresh:
        if ASSETS.get_metadata_tag(material,"DnDRomUnderwaterVersion")=="8":return
        clear_material(material)
    material.set_editor_property("material_domain",u.MaterialDomain.MD_POST_PROCESS)
    material.set_editor_property("blendable_location",u.BlendableLocation.BL_SCENE_COLOR_BEFORE_BLOOM)
    inputs=coastal_inputs(material)
    inputs["WorldPosition"]=node(material,u.MaterialExpressionWorldPosition)
    inputs["CameraPosition"]=node(material,u.MaterialExpressionCameraPositionWS)
    inputs["SceneColor"]=node(material,u.MaterialExpressionSceneTexture,scene_texture_id=u.SceneTextureId.PPI_POST_PROCESS_INPUT0)
    inputs["CameraWater"]=node(material,u.MaterialExpressionVectorParameter,parameter_name="CameraWater",default_value=u.LinearColor(0,0,0,0))
    inputs["CameraVector"]=node(material,u.MaterialExpressionCameraVectorWS)
    inputs["SceneDepth"]=node(material,u.MaterialExpressionSceneDepth)
    inputs["UnderwaterEnvironment"]=node(material,u.MaterialExpressionTextureObjectParameter,parameter_name="UnderwaterEnvironment",texture=u.load_asset("/Engine/EngineResources/DefaultTextureCube.DefaultTextureCube"),sampler_type=u.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
    inputs["EnvironmentReady"]=node(material,u.MaterialExpressionScalarParameter,parameter_name="EnvironmentReady",default_value=0.)
    inputs["SunStrength"]=node(material,u.MaterialExpressionScalarParameter,parameter_name="SunStrength",default_value=1.)
    inputs["WaterRadiance"]=node(material,u.MaterialExpressionScalarParameter,parameter_name="WaterRadiance",default_value=1500.)
    custom=node(material,u.MaterialExpressionCustom,code=(ROOT/"scripts/unreal/coastal_common.hlsl").read_text()+(ROOT/"scripts/unreal/underwater.hlsl").read_text(),output_type=u.CustomMaterialOutputType.CMOT_FLOAT3)
    pins=[]
    for name in inputs:
        item=u.CustomInput();item.set_editor_property("input_name",name);pins.append(item)
    custom.set_editor_property("inputs",pins)
    for name,source in inputs.items():link(source,"Color" if name=="SceneColor" else "",custom,name)
    prop(custom,"",u.MaterialProperty.MP_EMISSIVE_COLOR)
    finish(material);ASSETS.set_metadata_tag(material,"DnDRomUnderwaterVersion","8");ASSETS.save_loaded_asset(material)

def make_canopy():
    material, fresh = asset("M_forest_crown", "/Game/DnDRom/Materials", u.Material, u.MaterialFactoryNew())
    if not fresh:
        if ASSETS.get_metadata_tag(material,"DnDRomCrownVersion") == "3": return
        clear_material(material)
    material.set_editor_property("shading_model", u.MaterialShadingModel.MSM_TWO_SIDED_FOLIAGE)
    vertex=node(material,u.MaterialExpressionVertexColor)
    detail=node(material,u.MaterialExpressionCustom,code="float3 q=P*.055;float grain=frac(sin(dot(floor(q),float3(127.1,311.7,74.7)))*43758.5453);return Color*(.85+.15*grain);",output_type=u.CustomMaterialOutputType.CMOT_FLOAT3)
    inputs=[]
    for name in ["Color","P"]:
        item=u.CustomInput();item.set_editor_property("input_name",name);inputs.append(item)
    detail.set_editor_property("inputs",inputs)
    link(vertex,"",detail,"Color");link(node(material,u.MaterialExpressionWorldPosition),"",detail,"P")
    prop(detail,"",u.MaterialProperty.MP_BASE_COLOR)
    subsurface=node(material,u.MaterialExpressionMultiply,const_b=.12);link(vertex,"",subsurface,"A")
    prop(subsurface,"",u.MaterialProperty.MP_SUBSURFACE_COLOR)
    prop(node(material,u.MaterialExpressionConstant,r=.95),"",u.MaterialProperty.MP_ROUGHNESS)
    finish(material);ASSETS.set_metadata_tag(material,"DnDRomCrownVersion","3");ASSETS.save_loaded_asset(material)


def make_custom(masked=False, forest=False):
    material, fresh = asset("M_custom_forest" if forest else "M_custom_masked" if masked else "M_custom", "/Game/DnDRom/Materials", u.Material, u.MaterialFactoryNew())
    if not fresh:
        if ASSETS.get_metadata_tag(material, "DnDRomCustomVersion") == "3":
            return
        clear_material(material)
    if masked:
        material.set_editor_property("blend_mode", u.BlendMode.BLEND_MASKED)
        material.set_editor_property("two_sided", True)
    if forest:
        material.set_editor_property("shading_model",u.MaterialShadingModel.MSM_TWO_SIDED_FOLIAGE)
        prop(node(material,u.MaterialExpressionConstant3Vector,constant=u.LinearColor(.025,.045,.01)),"",u.MaterialProperty.MP_SUBSURFACE_COLOR)
    defaults = {}
    for name, rgba in [("native_white", (255, 255, 255, 255)), ("native_albedo", (255, 255, 255, 255)), ("native_normal", (128, 128, 255, 255))]:
        filename = ROOT / "artifacts/unreal-source" / (name + ".tga")
        filename.parent.mkdir(parents=True, exist_ok=True)
        r, g, b, a = rgba
        filename.write_bytes(struct.pack("<BBBHHBHHHHBB", 0, 0, 2, 0, 0, 0, 0, 0, 4, 4, 32, 0x28) + bytes([b, g, r, a]) * 16)
        defaults[name] = texture(filename, masks=name != "native_albedo")
    scale = node(material, u.MaterialExpressionScalarParameter, parameter_name="scaleValue", default_value=1.)
    rotation = node(material, u.MaterialExpressionScalarParameter, parameter_name="rotationValue", default_value=0.)
    uv = node(material, u.MaterialExpressionTextureCoordinate)
    tiled = node(material, u.MaterialExpressionMultiply)
    link(uv, "", tiled, "A"); link(scale, "", tiled, "B")
    rotated = node(material, u.MaterialExpressionRotator, speed=1.)
    link(tiled, "", rotated, "Coordinate"); link(rotation, "", rotated, "Time")
    for slot, target in [("albedo", u.MaterialProperty.MP_BASE_COLOR), ("normal", u.MaterialProperty.MP_NORMAL), ("roughness", u.MaterialProperty.MP_ROUGHNESS), ("metallic", u.MaterialProperty.MP_METALLIC), ("ambientOcclusion", u.MaterialProperty.MP_AMBIENT_OCCLUSION)]:
        sample = node(material, u.MaterialExpressionTextureSampleParameter2D, parameter_name=slot, texture=defaults["native_normal" if slot == "normal" else "native_albedo" if slot == "albedo" else "native_white"], sampler_type=u.MaterialSamplerType.SAMPLERTYPE_COLOR if slot == "albedo" else u.MaterialSamplerType.SAMPLERTYPE_MASKS)
        link(rotated, "", sample, "UVs")
        if slot == "normal":
            # Imported normal maps stay linear RGB; source OpenGL Y flips for UE.
            mult = node(material, u.MaterialExpressionMultiply)
            axes = node(material, u.MaterialExpressionConstant3Vector, constant=u.LinearColor(2, -2, 2))
            bias = node(material, u.MaterialExpressionConstant3Vector, constant=u.LinearColor(-1, 1, -1))
            add = node(material, u.MaterialExpressionAdd)
            link(sample, "RGB", mult, "A"); link(axes, "", mult, "B"); link(mult, "", add, "A"); link(bias, "", add, "B")
            strength = node(material, u.MaterialExpressionScalarParameter, parameter_name="normalStrengthValue", default_value=1.)
            flat = node(material, u.MaterialExpressionConstant3Vector, constant=u.LinearColor(0, 0, 1))
            blend = node(material, u.MaterialExpressionLinearInterpolate)
            link(flat, "", blend, "A"); link(add, "", blend, "B"); link(strength, "", blend, "Alpha")
            if forest:
                # Cancel automatic backface normal reversal: both sides of an
                # upright billboard approximate the same outward canopy normal.
                corrected=node(material,u.MaterialExpressionMultiply)
                link(blend,"",corrected,"A");link(node(material,u.MaterialExpressionTwoSidedSign),"",corrected,"B");prop(corrected,"",target)
            else: prop(blend, "", target)
        elif slot in ("roughness", "metallic"):
            factor = node(material, u.MaterialExpressionScalarParameter, parameter_name=slot + "Value", default_value=.8 if slot == "roughness" else 0.)
            mult = node(material, u.MaterialExpressionMultiply); link(sample, "R", mult, "A"); link(factor, "", mult, "B"); prop(mult, "", target)
        else:
            if slot == "albedo":
                vertex = node(material, u.MaterialExpressionVertexColor)
                color = node(material, u.MaterialExpressionMultiply)
                link(sample, "RGB", color, "A"); link(vertex, "RGB", color, "B"); prop(color, "", target)
            else:
                prop(sample, "R", target)
            if masked and slot == "albedo":
                if forest:
                    fade=node(material,u.MaterialExpressionCustom,code="float top=smoothstep(.55,.88,abs(Camera.z));float3 side=normalize(cross(Tangent,float3(0,0,1))+float3(.00001,0,0));float facing=smoothstep(.65,.92,abs(dot(side,normalize(float3(Camera.xy,.00001)))));return lerp(top,(1-top)*facing,SidePlane);",output_type=u.CustomMaterialOutputType.CMOT_FLOAT1)
                    args=[]
                    for name in ["Camera","Tangent","SidePlane"]:
                        item=u.CustomInput();item.set_editor_property("input_name",name);args.append(item)
                    fade.set_editor_property("inputs",args)
                    link(node(material,u.MaterialExpressionCameraVectorWS),"",fade,"Camera");link(node(material,u.MaterialExpressionVertexTangentWS),"",fade,"Tangent");link(vertex,"A",fade,"SidePlane")
                    mask=node(material,u.MaterialExpressionMultiply);link(sample,"A",mask,"A");link(fade,"",mask,"B");prop(mask,"",u.MaterialProperty.MP_OPACITY_MASK)
                else: prop(sample, "A", u.MaterialProperty.MP_OPACITY_MASK)
    ASSETS.set_metadata_tag(material, "DnDRomCustomVersion", "3")
    finish(material)


def make_map():
    saved = u.load_asset("/Game/Maps/World")
    if saved and ASSETS.get_metadata_tag(saved, "DnDRomPrepared") == "1":
        return
    levels = u.get_editor_subsystem(u.LevelEditorSubsystem)
    if not (levels.load_level("/Game/Maps/World") if saved else levels.new_level("/Game/Maps/World")):
        raise RuntimeError("Could not create the Unreal boot map")
    actors = u.get_editor_subsystem(u.EditorActorSubsystem)
    def ensure_actor(cls, location=u.Vector(), rotation=u.Rotator()):
        existing = next((a for a in actors.get_all_level_actors() if isinstance(a, cls)), None)
        return existing or actors.spawn_actor_from_class(cls, location, rotation)
    ensure_actor(u.SkyAtmosphere)
    sun = ensure_actor(u.DirectionalLight, u.Vector(0, 0, 2000), u.Rotator(-38, -35, 0))
    sun.light_component.set_editor_property("mobility", u.ComponentMobility.MOVABLE)
    sun.light_component.set_editor_property("intensity", 70000.)
    sun.light_component.set_editor_property("atmosphere_sun_light", True)
    sky = ensure_actor(u.SkyLight)
    sky.light_component.set_editor_property("mobility", u.ComponentMobility.MOVABLE)
    sky.light_component.set_editor_property("real_time_capture", True)
    fog = ensure_actor(u.ExponentialHeightFog, u.Vector(0, 0, -200))
    fog.component.set_editor_property("enable_volumetric_fog", True)
    fog.component.set_editor_property("fog_density", .004)
    clouds = ensure_actor(u.VolumetricCloud)
    component = clouds.get_component_by_class(u.VolumetricCloudComponent)
    cloud_material = u.load_asset("/Engine/EngineSky/VolumetricClouds/m_SimpleVolumetricCloud_Inst")
    if not cloud_material:
        raise RuntimeError("Engine volumetric cloud material missing; do not ship an empty sky")
    component.set_editor_property("material", cloud_material)
    component.set_editor_property("layer_bottom_altitude", 1.2)
    component.set_editor_property("layer_height", 2.0)
    world = u.get_editor_subsystem(u.UnrealEditorSubsystem).get_editor_world()
    ASSETS.set_metadata_tag(world, "DnDRomPrepared", "1")
    if not levels.save_current_level():
        raise RuntimeError("Could not save the Unreal boot map")


for role, source in {"ground": "brown_mud", "road": "brown_mud", "masonry": "medieval_blocks_03", "timber": "dark_wood", "roof": "roof_tiles", "bark": "bark_brown_01", "foliage": "sparse_grass"}.items():
    make_surface(role, source)
for role,source,mode in [("masonry_aged_0","rock_boulder_dry",0),("masonry_aged_1","plastered_wall",1),("masonry_aged_2","plastered_wall",2),("timber_aged_0","dark_wood",3),("timber_aged_1","weathered_planks",4),("roof_aged_0","roof_tiles",5),("roof_aged_1","weathered_planks",6)]:
    make_settlement_surface(role,source,mode)
make_settlement_flora(); make_foam_update(); make_terrain(); make_water(); make_underwater(); make_world_reveal(); make_canopy(); make_custom(); make_custom(True); make_custom(True, True)
for style in ["pine", "cypress", "broadleaf", "dead", "none", "grass"]:
    make_foliage(style)
make_map()
pathlib.Path(os.environ["DNDROM_PREPARE_RECEIPT"]).write_text(json.dumps({"ready": True, "version": 1}), encoding="utf-8")
u.log("DNDROM_CONTENT_READY")
