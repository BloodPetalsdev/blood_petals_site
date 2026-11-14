"use strict";
const {readFileSync}=require("node:fs");
const {spawnSync}=require("node:child_process");
const {join}=require("node:path");
for(const rel of ["renderer/app.js","renderer/startup.js"]){
  const source=readFileSync(join(__dirname,"..",rel));
  const result=spawnSync(process.execPath,["--input-type=module","--check"],{input:source,encoding:"utf8",maxBuffer:8*1024*1024});
  if(result.status!==0){
    process.stderr.write("Falha no JavaScript de módulo: "+rel+"\n"+(result.stderr||""));
    process.exit(1);
  }
  console.log("ES MODULE OK:",rel);
}
