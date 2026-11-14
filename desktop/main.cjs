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
  win.once('ready-to-show',()=>win.show());
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('will-redirect',event=>event.preventDefault());
  win.loadURL('sgmotion://motion/index.html');
}
app.whenReady().then(()=>{
  protocol.handle('sgmotion',(req)=>{
    const uri=new URL(req.url);
    if(uri.host!=='motion')return new Response('Not found',{status:404});
    const pathname=decodeURIComponent(uri.pathname);
    const resolved=path.resolve(ROOT, '.'+pathname);
    const relative=path.relative(ROOT,resolved);
    if(relative.startsWith('..')||path.isAbsolute(relative))return new Response('Forbidden',{status:403});
    // Optional offline companion assets are kept beside the portable EXE.
    // This avoids publishing Blood Petals models/textures/music in a public repo.
    // Only the following fixed file names are allowed, and they are never executed.
    const sidecarNames=new Set(['SweaterUniformRIGGED.fbx','FemaleHead.png','WhiteBodyBls.jpg','BloodMenu.mp3']);
    const assetMatch=pathname.match(/^\/assets\/([^/]+)$/);
    if(assetMatch && sidecarNames.has(assetMatch[1]) && !fs.existsSync(resolved)){
      const portableDir=process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
      const companionPath=path.join(portableDir,'assets',assetMatch[1]);
      if(fs.existsSync(companionPath)) return net.fetch(pathToFileURL(companionPath).toString());
      return new Response('Recurso não encontrado. Extraia o EXE junto da pasta assets do pacote completo.',{status:404});
    }
    return net.fetch(pathToFileURL(resolved).toString());
  });
  registerIpc();
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});