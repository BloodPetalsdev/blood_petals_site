"use strict";
const { app, BrowserWindow, dialog, ipcMain, protocol, net, shell } = require('electron');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, 'renderer');
const MAX_BYTES = 128 * 1024 * 1024;
const smokeTest = process.argv.includes('--sg-smoke-test');
const softwareRendering = smokeTest || process.argv.includes('--sg-software');
// Electron 45 / Chromium: enable SwiftShader only as a user-requested fallback.
if(softwareRendering){
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('use-angle','swiftshader');
}
// Menu music should start when opening the application; Chromium normally blocks autoplay.
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
let activeExport = false;

protocol.registerSchemesAsPrivileged([{
  scheme: 'sgmotion',
  privileges: { standard:true, secure:true, supportFetchAPI:true }
}]);

function safeName(s, extension) {
  const raw = path.basename(String(s||'animation').replace(/[\\/]/g,'_'));
  const tidy = raw.replace(/[^\w.\- ]/g,'_').slice(0,80) || 'animation';
  return extension && !tidy.toLowerCase().endsWith(extension) ? tidy + extension : tidy;
}
function settingsPath(){return path.join(app.getPath('userData'),'settings.json');}
function loadSettings(){try{return JSON.parse(fs.readFileSync(settingsPath(),'utf8'));}catch{return {};}}
async function saveSettings(obj){await fsp.mkdir(app.getPath('userData'),{recursive:true});await fsp.writeFile(settingsPath(),JSON.stringify(obj,null,2),'utf8');}
function isBlenderFile(p){return typeof p==='string' && path.basename(p).toLowerCase()==='blender.exe' && fs.existsSync(p);}
function detectBlender(){
  const custom=loadSettings().blenderPath;
  if(isBlenderFile(custom))return custom;
  if(isBlenderFile(process.env.BLENDER_PATH))return process.env.BLENDER_PATH;
  const roots=[process.env.ProgramFiles,process.env['ProgramFiles(x86)']].filter(Boolean);
  const matches=[];
  for(const root of roots){
    const base=path.join(root,'Blender Foundation');
    if(!fs.existsSync(base))continue;
    try{
      for(const child of fs.readdirSync(base)){
        const p=path.join(base,child,'blender.exe');
        if(isBlenderFile(p))matches.push(p);
      }
    }catch{}
  }
  matches.sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  return matches[0]||null;
}
async function chooseBlender(win){
  const selection=await dialog.showOpenDialog(win,{title:'Selecione o blender.exe instalado no Windows',properties:['openFile'],filters:[{name:'Blender',extensions:['exe']}],buttonLabel:'Usar este Blender'});
  if(selection.canceled)return {found:!!detectBlender(),cancelled:true};
  const file=selection.filePaths?.[0];
  if(!isBlenderFile(file))return {found:false,error:'Selecione um arquivo chamado blender.exe.'};
  await saveSettings({...loadSettings(),blenderPath:file});
  return {found:true,path:file};
}
function asBuffer(bytes){
  const buffer=bytes instanceof ArrayBuffer?Buffer.from(bytes):Buffer.isBuffer(bytes)?bytes:ArrayBuffer.isView(bytes)?Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength):null;
  if(!buffer||buffer.length===0||buffer.length>MAX_BYTES)throw Error('Arquivo vazio ou acima do limite de 128 MB.');
  return buffer;
}
function outputFilters(filename){
  const ext=path.extname(filename).toLowerCase().replace('.','');
  return ext? [{name:ext.toUpperCase(),extensions:[ext]}]:[];
}
async function chooseSave(win,filename){
  const safe=safeName(filename);
  return dialog.showSaveDialog(win,{title:'Salvar arquivo · Silent Garden Motion Studio',defaultPath:path.join(app.getPath('documents'),safe),buttonLabel:'Salvar',filters:outputFilters(safe)});
}
function runBlender(executable,script,source,dest,fps,cwd){
  return new Promise((resolve,reject)=>{
    const args=['--background','--factory-startup','--python',script,'--',source,dest,String(fps)];
    const processBlender=spawn(executable,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
    let output='';
    const collect=(chunk)=>{output=(output+chunk.toString()).slice(-5000);};
    processBlender.stdout.on('data',collect);
    processBlender.stderr.on('data',collect);
    const timeout=setTimeout(()=>processBlender.kill(),300000);
    processBlender.on('error',error=>{clearTimeout(timeout);reject(error);});
    processBlender.on('close',code=>{
      clearTimeout(timeout);
      if(code===0)resolve(output);
      else reject(Error(`O Blender não conseguiu converter (código ${code}). ${output.slice(-1200)}`));
    });
  });
}

function registerIpc(){
  ipcMain.handle('sg:blender-status',()=>({found:!!detectBlender()}));
  ipcMain.handle('sg:choose-blender',event=>chooseBlender(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle('sg:save-file',async(event,{bytes,name})=>{
    const buffer=asBuffer(bytes);
    const win=BrowserWindow.fromWebContents(event.sender);
    const result=await chooseSave(win,name);
    if(result.canceled||!result.filePath)return {cancelled:true};
    await fsp.writeFile(result.filePath,buffer,{flag:'w'});
    return {ok:true};
  });
  ipcMain.handle('sg:export-fbx',async(event,{bytes,name,fps})=>{
    if(activeExport)throw Error('O conversor Blender já está ocupado.');
    const blender=detectBlender();
    if(!blender)throw Error('Blender não encontrado. Instale ou selecione blender.exe.');
    const buffer=asBuffer(bytes);
    if(buffer.subarray(0,4).toString('utf8')!=='glTF')throw Error('GLB inválido.');
    if(![24,30,60].includes(Number(fps)))throw Error('FPS deve ser 24, 30 ou 60.');
    const win=BrowserWindow.fromWebContents(event.sender);
    const saved=await chooseSave(win,safeName(name||'animation','.fbx'));
    if(saved.canceled||!saved.filePath)return {cancelled:true};
    activeExport=true;
    const tmp=await fsp.mkdtemp(path.join(os.tmpdir(),'sg-motion-'));
    const input=path.join(tmp,'input.glb');
    const output=path.join(tmp,'output.fbx');
    try{
      await fsp.writeFile(input,buffer);
      await runBlender(blender,path.join(__dirname,'blender','export_to_fbx.py'),input,output,Number(fps),tmp);
      const stat=await fsp.stat(output);
      if(stat.size<100)throw Error('O Blender não gerou um arquivo FBX válido.');
      await fsp.copyFile(output,saved.filePath);
      return {ok:true};
    }finally{
      activeExport=false;
      await fsp.rm(tmp,{recursive:true,force:true}).catch(()=>{});
    }
  });
}
function createWindow(){
  const win=new BrowserWindow({
    title:'Silent Garden Motion Studio · Blood Petals',
    width:1440,height:900,minWidth:1060,minHeight:680,backgroundColor:'#14161c',
    show:false,autoHideMenuBar:true,
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,preload:path.join(__dirname,'preload.cjs')}
  });
  win.once('ready-to-show',()=>{if(!smokeTest)win.show();});
  win.webContents.on('did-fail-load',(_event,code,description,url)=>{
    console.error('Motion Studio load failure:',code,description,url);
    if(smokeTest)app.exit(1);
  });
  win.webContents.on('console-message',(_event,details)=>{
    if(smokeTest&&details?.level==='error')console.error('[renderer]',details.message);
  });
  if(smokeTest){
    win.webContents.once('did-finish-load',()=>{
      setTimeout(async()=>{
        try{
          const ready=await win.webContents.executeJavaScript(`({boot:!!window.sgEditorBooted,hasCanvas:!!document.querySelector('#viewport canvas'),menu:!!document.querySelector('#sgMainMenu'),error:document.querySelector('#sgStartupProblemMessage')?.textContent||''})`);
          console.log('SG_SMOKE_BOOT',JSON.stringify(ready));
          if(!ready.boot||!ready.hasCanvas||!ready.menu)throw Error('Editor JS did not initialize: '+ready.error);
          await win.webContents.executeJavaScript(`document.querySelector('#sgMenuNew').click()`);
          await new Promise(resolve=>setTimeout(resolve,2500));
          const next=await win.webContents.executeJavaScript(`({menuHidden:document.querySelector('#sgMainMenu').classList.contains('sg-hidden'),canvas:!!document.querySelector('#viewport canvas'),loading:!document.querySelector('#loadingOverlay')?.classList.contains('hidden')})`);
          console.log('SG_SMOKE_EDITOR',JSON.stringify(next));
          if(!next.menuHidden||!next.canvas)throw Error('3D Editor did not open');
          const regression=await win.webContents.executeJavaScript(`(() => {
            const diag=window.sgStudioDiagnostics;
            const ids=['sgResizeTimeline','sgResizeLeft','sgResizeRight','sgTimelineSeconds','sgTimelineFPS','sgTimelineFrames','sgModalTransformHint'];
            const controls=ids.every(id=>!!document.getElementById(id));
            if(!diag||!controls)return {ok:false,reason:'Missing interactive desktop UI or diagnostics',controls};
            const before=diag.camera();
            document.querySelector('[data-workspace="shading"]').click();
            document.querySelector('[data-workspace="animation"]').click();
            const after=diag.camera();
            const poseStable=[...before.position,...before.target,...before.quaternion].every((v,i)=>Math.abs(v-[...after.position,...after.target,...after.quaternion][i])<1e-5);
            const seconds=document.getElementById('sgTimelineSeconds');seconds.value='4';seconds.dispatchEvent(new Event('change',{bubbles:true}));
            const durationOk=Math.abs(diag.timing().seconds-4)<0.01&&diag.timing().frames===4*diag.timing().fps;
            const bone=document.querySelector('.bone-row');bone?.click();
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'g',code:'KeyG',bubbles:true}));
            const modalActive=diag.modal()==='translate';
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
            const modalCancelled=diag.modal()===null;
            return {ok:controls&&poseStable&&durationOk&&modalActive&&modalCancelled,controls,poseStable,durationOk,modalActive,modalCancelled};
          })()`);
          console.log('SG_SMOKE_REGRESSION',JSON.stringify(regression));
          if(!regression.ok)throw Error('Camera, duration, or modal G regression: '+JSON.stringify(regression));
          app.exit(0);
        }catch(error){console.error('SG_SMOKE_FAILED',error);app.exit(1);}
      },5000);
    });
    setTimeout(()=>{console.error('SG_SMOKE_TIMEOUT');app.exit(1);},45000);
  }
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('will-redirect',event=>event.preventDefault());
  win.loadURL('sgmotion://motion/index.html');
}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon',
  '.mp3':'audio/mpeg','.fbx':'application/octet-stream','.glb':'model/gltf-binary',
  '.wasm':'application/wasm','.svg':'image/svg+xml'};
const SIDECAR=new Set(['SweaterUniformRIGGED.fbx','FemaleHead.png','WhiteBodyBls.jpg','BloodMenu.mp3']);
const assetPath=()=>process.env.PORTABLE_EXECUTABLE_DIR||path.dirname(process.env.PORTABLE_EXECUTABLE_FILE||process.execPath);
async function handleMotionRequest(req){
  let pathname;
  try{const uri=new URL(req.url);if(uri.host!=='motion')return new Response('Not found',{status:404});pathname=decodeURIComponent(uri.pathname);}
  catch{return new Response('Invalid URL',{status:400});}
  const resolved=path.resolve(ROOT,'.'+pathname);
  const relative=path.relative(ROOT,resolved);
  if(relative.startsWith('..')||path.isAbsolute(relative))return new Response('Forbidden',{status:403});
  let file=resolved;
  const companion=pathname.match(/^\/assets\/([^/]+)$/);
  if(companion && SIDECAR.has(companion[1]) && !fs.existsSync(resolved)){
    file=path.join(assetPath(),'assets',companion[1]);
  }
  try{
    const data=await fsp.readFile(file); // Electron fs supports files inside app.asar and normal sidecars.
    const mime=MIME[path.extname(file).toLowerCase()]||'application/octet-stream';
    const range=req.headers.get('Range');
    if(range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if(match){
        let from=match[1]?Number(match[1]):0;
        let to=match[2]?Number(match[2]):data.length-1;
        if(!match[1]&&match[2]){from=Math.max(0,data.length-to);to=data.length-1;}
        if(from>=data.length || to<from)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${data.length}`}});
        to=Math.min(data.length-1,to);
        return new Response(data.subarray(from,to+1),{status:206,headers:{'Content-Type':mime,'Content-Length':String(to-from+1),'Content-Range':`bytes ${from}-${to}/${data.length}`,'Accept-Ranges':'bytes'}});
      }
    }
    return new Response(data,{status:200,headers:{'Content-Type':mime,'Content-Length':String(data.length),'Accept-Ranges':'bytes'}});
  }catch(error){
    if(error?.code==='ENOENT'){
      if(companion&&SIDECAR.has(companion[1]))console.warn('Missing companion asset:',file);
      return new Response('Arquivo não encontrado: '+pathname,{status:404});
    }
    console.error('Motion Studio file protocol error',pathname,error);
    return new Response('Falha ao ler arquivo local',{status:500});
  }
}
app.whenReady().then(()=>{
  protocol.handle('sgmotion',handleMotionRequest);
  registerIpc();
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});