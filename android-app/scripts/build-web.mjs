import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';

// The renderer is the *same* 1.1 application used by Windows, with touch/native adapters.
// Private character/audio assets are deliberately NOT stored in the public repository.
// They can be injected only into the locally signed distribution APK.
const root=resolve(import.meta.dirname,'..');
const renderer=resolve(root,'renderer');
const output=resolve(root,'www');
const original=await readFile(join(renderer,'index.html'),'utf8');
let editor=await readFile(join(renderer,'app.js'),'utf8');
if(!original.includes('sg11-theme-choice')||!original.includes('sgMenuMusic')||!editor.includes('function rigSolve(chain)')||!editor.includes('sgStudio')||!editor.includes('wireShading()'))throw Error('Windows 1.1 source lacks key features');
const replacement=`
async function download(blob, name){
  if(!nativeAndroid){
    const url=URL.createObjectURL(blob);const a=document.createElement('a');
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),120000);return true;
  }
  try{
    const safe=String(name||'animation.glb').replace(/[^a-z0-9._-]/gi,'_').slice(0,100);
    const encoded=await new Promise((resolve,reject)=>{
      const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);
      r.onerror=()=>reject(new Error('Falha ao preparar o arquivo'));r.readAsDataURL(blob);
    });
    const entry=await Filesystem.writeFile({directory:Directory.Cache,path:'exports/'+safe,data:encoded,recursive:true});
    await Share.share({title:safe,url:entry.uri,dialogTitle:'Salvar ou compartilhar '+safe});
    return true;
  }catch(err){
    console.error('Native Android share',err);
    toast('Erro ao compartilhar: '+(err?.message||err),true);
    return false;
  }
}
`;
const downloadPattern=/async function download\(blob, name\)\s*\{[\s\S]*?\n\}\nconst Vec =/;
if(!downloadPattern.test(editor))throw Error('Download adapter location not found: editor changed');
editor=editor.replace(downloadPattern,replacement+'\nconst Vec =');
const nativePrelude=`import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
const nativeAndroid=Capacitor.isNativePlatform();
if(nativeAndroid)document.documentElement.classList.add('sg-native-android');
`;
editor=nativePrelude+editor;
// Local Blender bridge is Windows-only. On Android, FBX output requires a separate converter.
const fbxStart='async function exportFbx(){';
if(!editor.includes(fbxStart))throw Error('Export FBX handler missing');
editor=editor.replace(fbxStart,`async function exportFbx(){
  if(nativeAndroid){toast('No Android, exporte GLB e converta em FBX no Blender do PC.',true);return;}`);

// Standalone native layout: portrait + landscape, desktop theme colors stay intact.
const touchCSS=`
/* Native Android single-version 1.1 touch layout */
html.sg-native-android,html.sg-native-android body{width:100%;min-width:0!important;max-width:100%;overflow-x:hidden!important;overscroll-behavior:none}
html.sg-native-android .app{min-width:0!important;width:100vw!important;max-width:100vw!important;height:auto!important;min-height:100dvh!important;padding-bottom:calc(78px + env(safe-area-inset-bottom))!important;overflow:visible!important}
html.sg-native-android .desktop-commandbar,html.sg-native-android .workspace-tabs,html.sg-native-android .sg11-tool-rail,html.sg-native-android .sg11-viewport-watermark,html.sg-native-android .app-footer{display:none!important}
html.sg-native-android .workspace{display:flex!important;flex-direction:column!important;width:100%!important;min-height:0!important;max-height:none!important;overflow:visible!important;gap:0!important;grid-template-columns:none!important;grid-template-rows:none!important}
html.sg-native-android .workspace>.sidebar{display:none!important;position:fixed!important;z-index:35!important;left:8px;right:8px;top:auto;bottom:calc(75px + env(safe-area-inset-bottom));max-height:72dvh!important;min-height:0!important;width:auto!important;max-width:none!important;background:var(--sg11-panel)!important;border:1px solid var(--sg11-border)!important;border-radius:15px!important;overflow-y:auto!important}
html.sg-native-android .app.mobile-open-left .sidebar.left,html.sg-native-android .app.mobile-open-right .sidebar.right{display:flex!important}
html.sg-native-android .workspace>.viewport-panel{display:flex!important;order:0!important;width:100%!important;min-width:0!important;max-height:none!important;height:clamp(300px,64dvh,630px)!important;min-height:300px!important;flex:none!important;overflow:hidden!important}
html.sg-native-android .viewport-panel>.viewport{min-height:0!important;min-width:0!important;flex:1!important;overflow:hidden!important}
html.sg-native-android .viewport>canvas{width:100%!important;height:100%!important;display:block!important;touch-action:none!important}
html.sg-native-android .timeline-panel{display:flex!important;order:2!important;flex:none!important;width:100%!important;min-height:170px!important;height:205px!important;max-height:270px!important;overflow:hidden!important}
html.sg-native-android .mobile-only{display:flex!important}
html.sg-native-android .mobile-dock{display:flex!important;position:fixed!important;bottom:0!important;left:0!important;right:0!important;z-index:45!important}
html.sg-native-android .topbar{height:auto!important;min-height:54px!important;padding:6px 10px!important;gap:6px!important;position:sticky!important;top:0!important;z-index:12!important}
html.sg-native-android .topbar .brand-title{font-size:11px!important;max-width:155px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
html.sg-native-android .viewport-toolbar{overflow-x:auto!important;flex-wrap:nowrap!important;min-height:39px!important;scrollbar-width:none}
html.sg-native-android #sgMainMenu{max-width:100vw!important;overflow-x:hidden!important}
html.sg-native-android #sgSettingsDialog{max-width:calc(100vw - 24px)!important;max-height:84dvh!important;padding:14px!important}
html.sg-native-android button,html.sg-native-android select{touch-action:manipulation}
@media(orientation:landscape){html.sg-native-android .workspace>.viewport-panel{height:calc(100dvh - 130px)!important;min-height:200px!important}html.sg-native-android .timeline-panel{height:185px!important}}
`;
let html=original
 .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '')
 .replace(/<script\s+type="importmap">[\s\S]*?<\/script>/i,'')
 .replace('<script type="module" src="./app.js"></script>','<script type="module" src="./motion-editor.js"></script>')
 .replace('content="width=device-width, initial-scale=1"','content="width=device-width, initial-scale=1, viewport-fit=cover"')
 .replace('</style>',touchCSS+'\n</style>')
 .replace(/<title>[^<]*<\/title>/,'<title>Silent Garden Motion Studio 1.1 · Android</title>')
 .replaceAll('1.1.0 · WINDOWS','1.1.0 · ANDROID');
if(html.includes('<script type="importmap">')||!html.includes('motion-editor.js')||!html.includes('sg-native-android'))throw Error('Android HTML transformation failed');
await mkdir(output,{recursive:true});
await writeFile(join(output,'index.html'),html,'utf8');
await copyFile(join(renderer,'theme.js'),join(output,'theme.js'));
await copyFile(join(renderer,'startup.js'),join(output,'startup.js'));
// An original icon is allowed to be public: the model, body/head textures and audio are not.
await copyFile(resolve(root,'icon.png'),join(output,'icon.png'));
await build({stdin:{contents:editor,resolveDir:root,sourcefile:'motion-android.js',loader:'js'},outfile:join(output,'motion-editor.js'),bundle:true,format:'esm',platform:'browser',target:['chrome110'],minify:false,legalComments:'none',logLevel:'info'});
console.log('Android 1.1 web + themes + Three.js bundled offline; private user files supplied at distribution signing stage.');
