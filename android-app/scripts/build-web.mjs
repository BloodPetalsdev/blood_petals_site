import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const inputPath = resolve(root, 'renderer/index.html');
const outputDir = resolve(root, 'www');
const original = await readFile(inputPath, 'utf8');
const inlineModule = /<script\s+type=["']module["']\s*>([\s\S]*?)<\/script>/i;
const found = original.match(inlineModule);
if (!found) throw new Error('Editor JS não encontrado no HTML de origem');
if (!found[1].includes('FBXLoader') || !found[1].includes('wireShading()')) {
  throw new Error('A origem não contém os recursos necessários de FBX e materiais');
}

const nativeAdapter = `
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
const nativeAndroid = Capacitor.isNativePlatform();
if (nativeAndroid) document.documentElement.classList.add('sg-native-android');
`;
let editorScript = nativeAdapter + found[1];

const legacyDownload = /function download\(blob, name\)\s*\{[\s\S]*?\n\}/;
const downloadReplacement = `
async function download(blob, name) {
  if (!nativeAndroid) {
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a'); link.href=url; link.download=name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),120000);
    return;
  }
  try {
    const safe=(name || 'motion-export').replace(/[^a-z0-9._-]/gi,'_').slice(0,100);
    const base64=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result).split(',')[1]);
      reader.onerror=()=>reject(new Error('Falha ao preparar arquivo'));
      reader.readAsDataURL(blob);
    });
    const output=await Filesystem.writeFile({path:'exports/'+safe,data:base64,directory:Directory.Cache,recursive:true});
    await Share.share({title:safe,url:output.uri,dialogTitle:'Salvar ou compartilhar '+safe});
  } catch(err) {
    console.error('Android export',err);
    toast('Não foi possível compartilhar o arquivo: '+(err?.message || err),true);
  }
}`;
if (!legacyDownload.test(editorScript)) throw new Error('Função de exportação original não encontrada');
editorScript = editorScript.replace(legacyDownload, downloadReplacement);

const backendStart = 'async function checkBackend(){';
if (!editorScript.includes(backendStart)) throw new Error('Backend status não encontrado');
editorScript = editorScript.replace(backendStart, `async function checkBackend(){
  if (nativeAndroid && !backendBase) {
    state.converterReady=false;
    setBackendPill('FBX precisa de conversor externo',false);
    return;
  }`);

await mkdir(outputDir, {recursive:true});
const html = original
  .replace(/<script\s+type=["']importmap["']\s*>[\s\S]*?<\/script>/i,'')
  .replace(inlineModule, '<script type="module" src="./motion-editor.js"></script>')
  .replace(/<title>.*?<\/title>/i, '<title>Silent Garden Motion Studio — Android</title>')
  .replace('content="width=device-width, initial-scale=1"','content="width=device-width, initial-scale=1, viewport-fit=cover"')
  .replace('ALPHA 0.6','ANDROID ALPHA 0.1');
await writeFile(resolve(outputDir,'index.html'), html,'utf8');

await build({
  stdin: {contents: editorScript, resolveDir: root, sourcefile:'editor-android.js', loader:'js'},
  outfile: resolve(outputDir,'motion-editor.js'),
  bundle: true, format:'esm', platform:'browser',
  target:['chrome110'], minify:false, legalComments:'none', logLevel:'info'
});
console.log('Silent Garden Android: HTML, Three.js e plugins nativos empacotados para uso offline.');
