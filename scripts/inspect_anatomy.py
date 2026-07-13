import json
from collections import Counter

import bpy


def triangle_count(mesh):
    return sum(max(0, len(polygon.vertices) - 2) for polygon in mesh.polygons)


mesh_objects = [obj for obj in bpy.data.objects if obj.type == "MESH"]
object_types = Counter(obj.type for obj in bpy.data.objects)
modifier_types = Counter(
    modifier.type for obj in mesh_objects for modifier in obj.modifiers
)

object_rows = []
for obj in mesh_objects:
    mesh = obj.data
    object_rows.append(
        {
            "name": obj.name,
            "vertices": len(mesh.vertices),
            "triangles": triangle_count(mesh),
            "materials": len(obj.material_slots),
            "hidden_viewport": obj.hide_get(),
            "hidden_render": obj.hide_render,
            "collections": [collection.name for collection in obj.users_collection],
        }
    )

collection_rows = []
for collection in bpy.data.collections:
    objects = list(collection.objects)
    meshes = [obj for obj in objects if obj.type == "MESH"]
    collection_rows.append(
        {
            "name": collection.name,
            "objects_direct": len(objects),
            "meshes_direct": len(meshes),
            "triangles_direct": sum(triangle_count(obj.data) for obj in meshes),
            "hidden_viewport": collection.hide_viewport,
            "hidden_render": collection.hide_render,
            "children": [child.name for child in collection.children],
        }
    )


def collection_tree_row(collection):
    descendants = set()

    def collect(current):
        descendants.update(current.objects)
        for child in current.children:
            collect(child)

    collect(collection)
    meshes = [obj for obj in descendants if obj.type == "MESH"]
    return {
        "name": collection.name,
        "objects_recursive": len(descendants),
        "meshes_recursive": len(meshes),
        "triangles_recursive": sum(triangle_count(obj.data) for obj in meshes),
        "children": [collection_tree_row(child) for child in collection.children],
    }

report = {
    "blender_version": bpy.app.version_string,
    "source": bpy.data.filepath,
    "scenes": [scene.name for scene in bpy.data.scenes],
    "objects": len(bpy.data.objects),
    "object_types": dict(object_types),
    "mesh_datablocks": len(bpy.data.meshes),
    "materials": len(bpy.data.materials),
    "collections": len(bpy.data.collections),
    "libraries": [library.filepath for library in bpy.data.libraries],
    "scene_roots": [
        collection_tree_row(collection)
        for collection in bpy.context.scene.collection.children
    ],
    "mesh_vertices": sum(len(obj.data.vertices) for obj in mesh_objects),
    "mesh_triangles": sum(triangle_count(obj.data) for obj in mesh_objects),
    "hidden_mesh_objects": sum(
        obj.hide_get() or obj.hide_render for obj in mesh_objects
    ),
    "modifier_types": dict(modifier_types),
    "top_objects": sorted(
        object_rows, key=lambda row: row["triangles"], reverse=True
    )[:40],
    "top_collections": sorted(
        collection_rows,
        key=lambda row: row["triangles_direct"],
        reverse=True,
    )[:80],
}

print("ANATOMY_REPORT_BEGIN")
print(json.dumps(report, indent=2))
print("ANATOMY_REPORT_END")
