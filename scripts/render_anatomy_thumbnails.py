import argparse
import os
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


LAYERS = (
    (1, "skeletal-system"),
    (2, "muscular-insertions"),
    (3, "joints"),
    (4, "muscular-system"),
    (5, "cardiovascular-system"),
    (6, "lymphoid-organs"),
    (7, "nervous-system-sense-organs"),
    (8, "visceral-systems"),
)
HIDDEN_MUSCLE_COVERINGS = {
    "Articular capsule",
    "Bursa",
    "Cartilage",
    "Fascia",
    "Ligament",
}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", default="/tmp")
    parser.add_argument("--output-dir", required=True)
    args = []
    if "--" in os.sys.argv:
        args = os.sys.argv[os.sys.argv.index("--") + 1 :]
    return parser.parse_args(args)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for data_collection in (bpy.data.meshes, bpy.data.curves, bpy.data.materials):
        for data in list(data_collection):
            if data.users == 0:
                data_collection.remove(data)


def remove_hidden_muscle_coverings():
    processed_meshes = set()
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.data in processed_meshes:
            continue
        processed_meshes.add(obj.data)
        blocked = {
            index
            for index, material in enumerate(obj.data.materials)
            if material and material.name in HIDDEN_MUSCLE_COVERINGS
        }
        if not blocked:
            continue
        mesh = bmesh.new()
        mesh.from_mesh(obj.data)
        bmesh.ops.delete(
            mesh,
            geom=[face for face in mesh.faces if face.material_index in blocked],
            context="FACES",
        )
        mesh.to_mesh(obj.data)
        mesh.free()


def add_camera(objects):
    points = [
        obj.matrix_world @ Vector(corner)
        for obj in objects
        for corner in obj.bound_box
    ]
    minimum = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    maximum = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    center = (minimum + maximum) * 0.5
    size = maximum - minimum

    camera_data = bpy.data.cameras.new("Thumbnail camera")
    camera = bpy.data.objects.new("Thumbnail camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = center + Vector((0, -max(size.z, size.x) * 2, 0))
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(size.z, size.x) * 1.08
    bpy.context.scene.camera = camera


args = parse_args()
raw_dir = Path(args.raw_dir).resolve()
output_dir = Path(args.output_dir).resolve()
output_dir.mkdir(parents=True, exist_ok=True)

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x = 256
scene.render.resolution_y = 256
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = True
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "MATERIAL"
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = "WORLD"
scene.display.shading.show_specular_highlight = True

for index, slug in LAYERS:
    clear_scene()
    source = raw_dir / f"anatomy-layer-{index}-raw.glb"
    if not source.exists():
        raise FileNotFoundError(source)
    bpy.ops.import_scene.gltf(filepath=str(source))
    if slug == "muscular-system":
        remove_hidden_muscle_coverings()
    anatomy_objects = [obj for obj in scene.objects if obj.type in {"MESH", "CURVE"}]
    add_camera(anatomy_objects)
    scene.render.filepath = str(output_dir / f"{slug}.png")
    bpy.ops.render.render(write_still=True)

print(f"Rendered {len(LAYERS)} anatomy thumbnails to {output_dir}")
