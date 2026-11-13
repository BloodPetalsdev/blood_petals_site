"use strict";
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'node_modules','three');
if(!fs.existsSync(path.join(root,'build','three.module.js'))){
  console.error('Three.js não instalado. Execute npm install antes.');process.exit(1);
}
const output=path.join(__dirname,'renderer','vendor','three');
fs.mkdirSync(output,{recursive:true});
for(const sub of ['build','examples/jsm']){
  const from=path.join(root,sub),to=path.join(output,sub);
  fs.cpSync(from,to,{recursive:true,force:true});
}
console.log('Three.js copiado para o aplicativo: agora ele funciona offline.');
