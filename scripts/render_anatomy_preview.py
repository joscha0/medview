import argparse
import json
import os
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    argv = os.sys.argv[os.sys.argv.index("--") + 1 :] if "--" in os.sys.argv else []
    return parser.parse_args(argv)


args = parse_args()
input_path = Path(args.input).expanduser().resolve()
output_path = Path(args.output).expanduser().resolve()
output_path.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(input_path))

mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if not mesh_objects:
    raise RuntimeError(f"No mesh objects imported from {input_path}")

corners = [obj.matrix_world @ Vector(corner) for obj in mesh_objects for corner in obj.bound_box]
minimum = Vector(tuple(min(point[i] for point in corners) for i in range(3)))
maximum = Vector(tuple(max(point[i] for point in corners) for i in range(3)))
center = (minimum + maximum) * 0.5
dimensions = maximum - minimum
model_size = max(dimensions)

camera_data = bpy.data.cameras.new("Validation camera")
camera = bpy.data.objects.new("Validation camera", camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = center + Vector((model_size * 1.35, -model_size * 2.4, model_size * 0.55))
camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
camera_data.type = "ORTHO"
camera_data.ortho_scale = max(dimensions.x, dimensions.z) * 1.12
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.studio_light = "paint.sl"
scene.display.shading.color_type = "MATERIAL"
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = "WORLD"
scene.display.shading.show_specular_highlight = True
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.filepath = str(output_path)

bpy.ops.wm.save_as_mainfile(filepath="/tmp/anatomy-preview-validation.blend")
bpy.ops.render.render(write_still=True)

print("ANATOMY_PREVIEW_VALIDATION")
print(
    json.dumps(
        {
            "input": str(input_path),
            "output": str(output_path),
            "mesh_objects": len(mesh_objects),
            "bounds_min": list(minimum),
            "bounds_max": list(maximum),
            "dimensions": list(dimensions),
        },
        indent=2,
    )
)
