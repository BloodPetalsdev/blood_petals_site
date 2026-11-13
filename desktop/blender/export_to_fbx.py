"""Executado pelo Blender em segundo plano.
Converte um GLB animado feito pelo editor web para FBX com action/bake.
Uso: blender --background --factory-startup --python export_to_fbx.py -- input.glb output.fbx 30
"""
import bpy
import os
import sys
import traceback


def main():
    if '--' not in sys.argv:
        raise ValueError('Faltam parâmetros de entrada.')
    args = sys.argv[sys.argv.index('--') + 1:]
    if len(args) != 3:
        raise ValueError('Uso: arquivo.glb arquivo.fbx FPS')
    glb, fbx, fps_raw = args
    fps = int(fps_raw)
    if fps not in (24, 30, 60):
        raise ValueError('FPS inválido.')
    if not os.path.isfile(glb):
        raise FileNotFoundError(glb)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.fps = fps
    scene.render.fps_base = 1.0
    bpy.ops.import_scene.gltf(filepath=glb)
    objects = list(bpy.context.scene.objects)
    if not objects:
        raise ValueError('Nenhum objeto foi importado do GLB.')
    armatures = [o for o in objects if o.type == 'ARMATURE']
    actions = list(bpy.data.actions)
    print('Silent Garden: objetos=',len(objects),'armatures=',len(armatures),'actions=',len(actions))
    if not actions:
        raise ValueError('O GLB não contém animações reconhecidas pelo Blender.')
    frame_end = 1
    for action in actions:
        frame_end = max(frame_end, int(action.frame_range[1]) + 1)
    scene.frame_start = 0
    scene.frame_end = frame_end
    # Exporta todas as actions como takes/clips dentro do FBX, com amostragem por frame.
    bpy.ops.export_scene.fbx(
        filepath=fbx,
        use_selection=False,
        object_types={'ARMATURE', 'MESH', 'EMPTY', 'OTHER'},
        use_mesh_modifiers=True,
        use_armature_deform_only=False,
        add_leaf_bones=False,
        bake_anim=True,
        bake_anim_use_all_bones=True,
        bake_anim_use_nla_strips=False,
        bake_anim_use_all_actions=True,
        bake_anim_force_startend_keying=True,
        bake_anim_step=1.0,
        bake_anim_simplify_factor=0.0,
        path_mode='AUTO',
        axis_forward='-Z',
        axis_up='Y',
    )
    if not os.path.isfile(fbx):
        raise RuntimeError('Arquivo FBX não foi criado.')
    print('Silent Garden: exportação concluída:',fbx)


try:
    main()
except Exception:
    traceback.print_exc()
    sys.exit(1)
