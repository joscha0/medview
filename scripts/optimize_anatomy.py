import argparse
import json
import os
import struct
import subprocess
from pathlib import Path

import bpy


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend-output", required=True)
    parser.add_argument("--glb-output", required=True)
    parser.add_argument("--gltfpack", required=True)
    parser.add_argument("--simplify", type=float, default=0.18)
    parser.add_argument("--report", required=True)
    parser.add_argument("--skip-blend-save", action="store_true")
    args = []
    if "--" in os.sys.argv:
        args = os.sys.argv[os.sys.argv.index("--") + 1 :]
    return parser.parse_args(args)


def read_glb_json(path):
    with open(path, "rb") as glb_file:
        header = glb_file.read(20)
        if len(header) != 20 or header[:4] != b"glTF":
            raise RuntimeError(f"{path} is not a valid GLB file")
        json_length = struct.unpack_from("<I", header, 12)[0]
        json_data = glb_file.read(json_length)
    return json.loads(json_data.decode("utf-8"))


def summarize_glb(path):
    gltf = read_glb_json(path)
    accessors = gltf.get("accessors", [])
    primitives = [
        primitive
        for mesh in gltf.get("meshes", [])
        for primitive in mesh.get("primitives", [])
    ]
    triangles = 0
    vertices = 0
    for primitive in primitives:
        position_index = primitive.get("attributes", {}).get("POSITION")
        if position_index is not None:
            vertices += accessors[position_index].get("count", 0)
        index_accessor = primitive.get("indices")
        if index_accessor is not None and primitive.get("mode", 4) == 4:
            triangles += accessors[index_accessor].get("count", 0) // 3
    return {
        "bytes": os.path.getsize(path),
        "nodes": len(gltf.get("nodes", [])),
        "meshes": len(gltf.get("meshes", [])),
        "primitives": len(primitives),
        "vertices": vertices,
        "triangles": triangles,
        "materials": len(gltf.get("materials", [])),
        "extensions_used": gltf.get("extensionsUsed", []),
        "extensions_required": gltf.get("extensionsRequired", []),
    }


def enable_layer_collection(layer_collection):
    layer_collection.exclude = False
    layer_collection.hide_viewport = False
    for child in layer_collection.children:
        enable_layer_collection(child)


def color_value(socket):
    value = getattr(socket, "default_value", None)
    if value is None or not hasattr(value, "__len__") or len(value) != 4:
        return None
    return tuple(float(component) for component in value)


def direct_material_color(material):
    if not material.node_tree:
        return None

    nodes = list(material.node_tree.nodes)
    for node in nodes:
        if node.type == "BSDF_PRINCIPLED":
            color = color_value(node.inputs.get("Base Color"))
            if color:
                return color

    # Z-Anatomy's reusable shader groups are not representable in glTF. Their
    # intended base palette is exposed through RGB, Gamma, or group sockets.
    for node in nodes:
        if node.type == "RGB":
            color = color_value(node.outputs.get("Color"))
            if color:
                return color

    for node in nodes:
        if node.type == "GAMMA":
            color = color_value(node.inputs.get("Color"))
            if color:
                return color

    for node in nodes:
        if node.type != "GROUP":
            continue
        for socket_name in ("Color", "Color1", "Color2"):
            color = color_value(node.inputs.get(socket_name))
            if color and color[:3] != (0.5, 0.5, 0.5):
                return color

    return None


def web_material_colors():
    direct_colors = {
        material.name: direct_material_color(material)
        for material in bpy.data.materials
    }
    resolved = {}

    for material in bpy.data.materials:
        color = direct_colors[material.name]
        if color is None:
            family_name = material.name.rstrip("'")
            if "-" in family_name:
                family_name = family_name.rsplit("-", 1)[0]
            color = direct_colors.get(family_name)
        if color is None:
            color = tuple(float(component) for component in material.diffuse_color)
        resolved[material.name] = color

    return resolved


def convert_materials_for_web():
    colors = web_material_colors()
    converted = 0

    for material in bpy.data.materials:
        color = colors[material.name]
        material.use_nodes = True
        nodes = material.node_tree.nodes
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        shader.inputs["Base Color"].default_value = color
        shader.inputs["Metallic"].default_value = 0.0
        shader.inputs["Roughness"].default_value = 0.62
        shader.inputs["Alpha"].default_value = color[3]
        material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
        material.diffuse_color = color
        if color[3] < 0.999 and hasattr(material, "surface_render_method"):
            material.surface_render_method = "DITHERED"
        converted += 1

    return converted


args = parse_args()
blend_output = Path(args.blend_output).expanduser().resolve()
glb_output = Path(args.glb_output).expanduser().resolve()
gltfpack_path = Path(args.gltfpack).expanduser().resolve()
report_path = Path(args.report).expanduser().resolve()
raw_glb = Path("/tmp/anatomy-web-raw.glb")

for output in (blend_output, glb_output, report_path):
    output.parent.mkdir(parents=True, exist_ok=True)

source_stats = {
    "objects": len(bpy.data.objects),
    "mesh_objects": sum(obj.type == "MESH" for obj in bpy.data.objects),
    "curve_objects": sum(obj.type == "CURVE" for obj in bpy.data.objects),
    "font_objects": sum(obj.type == "FONT" for obj in bpy.data.objects),
    "materials": len(bpy.data.materials),
}

# Labels and authoring-only scene objects account for a large part of the scene
# graph, but do not contribute to the web anatomy visualization.
remove_objects = [
    obj
    for obj in bpy.data.objects
    if obj.type in {"FONT", "CAMERA", "LIGHT"}
]
bpy.data.batch_remove(remove_objects)

# Curves represent vessels, nerves, and ducts. Keep them, but cap their render
# tessellation before glTF conversion.
for curve in bpy.data.curves:
    if hasattr(curve, "resolution_u"):
        curve.resolution_u = min(curve.resolution_u, 2)
    if hasattr(curve, "render_resolution_u") and curve.render_resolution_u > 0:
        curve.render_resolution_u = min(curve.render_resolution_u, 2)
    if hasattr(curve, "bevel_resolution"):
        curve.bevel_resolution = min(curve.bevel_resolution, 1)
    if hasattr(curve, "resolution_v"):
        curve.resolution_v = min(curve.resolution_v, 1)

# Prevent high render-only subdivision levels from creating geometry that is
# immediately discarded by the web simplifier.
subdivision_modifiers_reduced = 0
for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    for modifier in obj.modifiers:
        if modifier.type == "SUBSURF":
            modifier.levels = min(modifier.levels, 1)
            modifier.render_levels = min(modifier.render_levels, 1)
            subdivision_modifiers_reduced += 1

enable_layer_collection(bpy.context.view_layer.layer_collection)

# Z-Anatomy links the real anatomical objects into the numbered top-level
# collections. The separate "Bonus collection" also contains the authoring UI,
# labels, reference planes, and taxonomy helpers, so exporting the entire scene
# produces a model surrounded by text and large planes.
anatomy_collections = [
    collection
    for collection in bpy.context.scene.collection.children
    if collection.name[:2] in {"1:", "2:", "3:", "4:", "5:", "6:", "7:", "8:"}
]
if len(anatomy_collections) != 8:
    raise RuntimeError(
        "Expected the eight numbered Z-Anatomy system collections; found "
        + ", ".join(collection.name for collection in anatomy_collections)
    )

anatomy_objects = {
    obj
    for collection in anatomy_collections
    for obj in collection.objects
    if obj.type in {"MESH", "CURVE"} and not obj.name.endswith(".g")
}
excluded_group_labels = {
    obj
    for collection in anatomy_collections
    for obj in collection.objects
    if obj.name.endswith(".g")
}

bpy.ops.object.select_all(action="DESELECT")
export_objects = []
for obj in bpy.context.scene.objects:
    if obj not in anatomy_objects:
        obj.hide_render = True
        obj.hide_set(True)
        continue
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.hide_render = False
    obj.select_set(True)
    export_objects.append(obj)

if not export_objects:
    raise RuntimeError("No mesh or curve objects remain to export")

bpy.context.view_layer.objects.active = export_objects[0]
if remove_objects:
    bpy.data.orphans_purge(do_recursive=True)

materials_converted_for_web = convert_materials_for_web()

# Save a clean, non-destructive web source. The original Startup.blend remains
# untouched, while this copy retains editable anatomy and capped modifiers.
if not args.skip_blend_save:
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_output), check_existing=False)

export_result = bpy.ops.export_scene.gltf(
    filepath=str(raw_glb),
    check_existing=False,
    export_format="GLB",
    use_selection=True,
    use_active_scene=True,
    use_visible=False,
    use_renderable=False,
    export_apply=True,
    export_yup=True,
    export_texcoords=False,
    export_normals=True,
    export_tangents=False,
    export_attributes=False,
    export_all_vertex_colors=True,
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
    export_animations=False,
    export_extras=False,
    export_skins=False,
    export_morph=False,
    use_mesh_edges=False,
    use_mesh_vertices=False,
)
if export_result != {"FINISHED"}:
    raise RuntimeError(f"Blender glTF export failed: {export_result}")

raw_stats = summarize_glb(raw_glb)

# gltfpack simplifies each anatomical component with a quality/error bound,
# merges compatible scene data, quantizes attributes, and adds Meshopt stream
# compression. Named nodes are intentionally not locked because this GLB is a
# lightweight visual context model rather than an interactive anatomy atlas.
command = [
    str(gltfpack_path),
    "-i",
    str(raw_glb),
    "-o",
    str(glb_output),
    "-c",
    "-si",
    str(args.simplify),
    "-sp",
    # The source uses a very large coordinate range. Floating-point position
    # compression avoids visible quantization error while retaining Meshopt
    # stream compression for transfer size.
    "-vpf",
    "-vn",
    "10",
    "-r",
    str(report_path),
    "-v",
]
subprocess.run(command, check=True)

optimized_stats = summarize_glb(glb_output)
report = {
    "source_blend": bpy.data.filepath,
    "source_stats": source_stats,
    "removed_objects": len(remove_objects),
    "subdivision_modifiers_reduced": subdivision_modifiers_reduced,
    "anatomy_collections": [collection.name for collection in anatomy_collections],
    "excluded_group_labels": len(excluded_group_labels),
    "materials_converted_for_web": materials_converted_for_web,
    "export_objects": len(export_objects),
    "simplify_ratio": args.simplify,
    "raw_glb": raw_stats,
    "optimized_glb": optimized_stats,
}

summary_path = report_path.with_name(f"{report_path.stem}-summary.json")
summary_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

print("ANATOMY_OPTIMIZATION_BEGIN")
print(json.dumps(report, indent=2))
print("ANATOMY_OPTIMIZATION_END")
