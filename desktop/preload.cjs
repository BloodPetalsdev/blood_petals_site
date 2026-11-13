"use strict";
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('motionDesktop',Object.freeze({
  blenderStatus:()=>ipcRenderer.invoke('sg:blender-status'),
  chooseBlender:()=>ipcRenderer.invoke('sg:choose-blender'),
  saveFile:(bytes,name)=>ipcRenderer.invoke('sg:save-file',{bytes,name}),
  exportFbx:(bytes,{name,fps})=>ipcRenderer.invoke('sg:export-fbx',{bytes,name,fps})
}));
