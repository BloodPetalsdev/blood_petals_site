
/* Silent Garden Motion Studio — versão alpha 0.8 · Blood Petals Female Rig
   Editor de poses/keyframes em Three.js para exportação FBX via Blender local.
   O FBX é processado no navegador. Exportar FBX exige server.py + Blender. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const formatTime = (t) => `00:${String(Math.floor(t)).padStart(2, '0')}.${String(Math.round((t % 1) * 100)).padStart(2, '0')}`;
const tidy = (s) => (s || 'animation').replace(/[^a-z0-9_\-.]/gi, '_').slice(0, 70);
const deg = THREE.MathUtils.radToDeg;
const rad = THREE.MathUtils.degToRad;
let toastTimer;
function toast(msg, error = false) {
  const el = $('toast'); el.textContent = msg; el.classList.toggle('error', error); el.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), error ? 7500 : 4500);
}
function status(message) { $('statusText').textContent = message; }
function loading(show, title = '', desc = '') {
  $('loadingOverlay').classList.toggle('hidden', !show);
  if (title) $('loadingTitle').textContent = title;
  if (desc) $('loadingDescription').textContent = desc;
}
async function download(blob, name) {
  if (window.motionDesktop) {
    const result = await window.motionDesktop.saveFile(await blob.arrayBuffer(), name);
    if (result?.cancelled) return false;
    if (!result?.ok) throw new Error(result?.error || 'Não foi possível salvar o arquivo.');
    return true;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  return true;
}
const Vec = (x = 0, y = 0, z = 0) => new THREE.Vector3(x,y,z);

const state = {
  model: null, modelIsDemo: true, modelFilename: null,
  bones: [], boneMap: new Map(), rest: new Map(), selected: null, handles: [],
  sourceClips: [], clips: [], clipIndex: 0, time: 0, playing: false,
  loop: true, rigVisible: true, gridVisible: true, editMode: 'rotate',
  sceneScale: 1.9, skeletonHelper: null, converterReady: false,
  importedFile: null, lastFrameAt: performance.now(), exportBusy: false,
  selectedMesh: null, selectedMaterialSlot: 0, outlinerMode: 'bones', inspectorTab: 'pose', workspaceMode: 'animation',
};
function currentClip() { return state.clips[state.clipIndex]; }
function makeClip(name, duration=3, fps=30) {
  return { name: name || 'new_animation', duration, fps, tracks: {} };
}
const scene = new THREE.Scene();
scene.background = new THREE.Color('#1e1a25');
// Sem fog: FBXs em unidades maiores não ficam encobertos à distância.
scene.fog = null;
// A escala de apresentação não altera o FBX ou os keyframes originais.
const displayRoot = new THREE.Group();
displayRoot.name = 'SG_Motion_ViewportOnly';
scene.add(displayRoot);
const viewport = $('viewport');
const renderer = new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'default'});
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, matchMedia('(max-width:790px)').matches ? 1.25 : 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Width/height must reflect the real desktop viewport, never a stale portrait canvas.
const initialViewportWidth = Math.max(1, Math.round(viewport.clientWidth));
const initialViewportHeight = Math.max(1, Math.round(viewport.clientHeight));
renderer.setSize(initialViewportWidth, initialViewportHeight, false);
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = '100%';
renderer.domElement.style.position = 'absolute';
renderer.domElement.style.inset = '0';
renderer.shadowMap.enabled = false;
viewport.prepend(renderer.domElement);
const camera = new THREE.PerspectiveCamera(43, initialViewportWidth / initialViewportHeight, .01, 5000);
camera.position.set(3, 2.2, 4.5);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
renderer.domElement.style.touchAction = 'none';
orbit.enableDamping = true; orbit.dampingFactor = .07; orbit.minDistance = .2; orbit.maxDistance = 2000;
const hemi = new THREE.HemisphereLight('#e0d8ff', '#57435c', 2.05); scene.add(hemi);
const keyLight = new THREE.DirectionalLight('#fff5f0', 2.2); keyLight.position.set(4, 7, 5); scene.add(keyLight);
const fillLight = new THREE.DirectionalLight('#c8addd', .8); fillLight.position.set(-5,3,-3); scene.add(fillLight);
const grid = new THREE.GridHelper(20,20,'#655367','#45394a');
grid.material.opacity = .14; grid.material.transparent = true; scene.add(grid);
const axis = new THREE.AxesHelper(.35); axis.visible = false; scene.add(axis);
const transform = new TransformControls(camera, renderer.domElement);
transform.setMode('rotate'); transform.setSpace('local'); transform.setSize(.8);
scene.add(transform.getHelper());
transform.addEventListener('dragging-changed', (evt) => {orbit.enabled = !evt.value;});
transform.addEventListener('objectChange', () => {
  sgMarkDirty();
  if (!state.selected) return;
  syncFields();
  if(rigAssist.control && transform.object===rigAssist.control){rigSolve(rigAssist.selected);status('Rig Assist: alvo reposicionado. Pressione K para gravar.');return;}
  if(skirtAssist.enabled && /^(leftupleg|rightupleg)$/.test(rigPartName(state.selected)))skirtApply();
  status(`Pose alterada: ${state.selected.name}. Pressione K para registrar o keyframe.`);
});
// === Rig Assist IK: virtual targets, original FBX bone transforms ===
// Only two-segment chains are supported. No bones are inserted into the FBX.
const rigAssist={enabled:false,chains:[],selected:null,control:null,solving:false,groundClamp:true};
const rigVector=()=>new THREE.Vector3();
function rigPartName(bone){return String(bone?.name||'').split(':').pop().toLowerCase().replace(/[^a-z0-9]/g,'');}
function rigSide(name){if(/left|^l(?:upper|lower|fore|hand|arm|leg|foot|thigh|shin|wrist)/.test(name))return 'L';if(/right|^r(?:upper|lower|fore|hand|arm|leg|foot|thigh|shin|wrist)/.test(name))return 'R';return '?';}
function rigBetween(parent,child){
  if(!parent||!child||parent===child)return false;
  let node=child.parent,depth=0;
  while(node&&node!==parent&&depth<4){
    if(!node.isBone||!/roll|twist/i.test(node.name))return false;
    node=node.parent;depth++;
  }
  return node===parent;
}
function rigValidChain(upper,middle,end){
  if(!upper?.isBone||!middle?.isBone||!end?.isBone)return false;
  // O rig feminino Blood Petals possui os segmentos LeftArmRoll/LeftForeArmRoll
  // entre os ossos do braço. Aceitar até dois intermediários de twist/roll,
  // sem alterar sua hierarquia, mantém a importação FBX compatível com Unity.
  if(!rigBetween(upper,middle)||!rigBetween(middle,end))return false;
  upper.updateWorldMatrix(true,true);
  const a=upper.getWorldPosition(rigVector());
  const b=middle.getWorldPosition(rigVector());
  const c=end.getWorldPosition(rigVector());
  return a.distanceTo(b)>1e-6&&b.distanceTo(c)>1e-6;
}
function rigWorldPos(object){return object.getWorldPosition(rigVector());}
function rigPolePosition(upper,middle,end){
  const a=rigWorldPos(upper),b=rigWorldPos(middle),c=rigWorldPos(end);
  const axis=c.clone().sub(a).normalize();
  let perp=b.clone().sub(a);perp.addScaledVector(axis,-perp.dot(axis));
  if(perp.lengthSq()<1e-10){perp=new THREE.Vector3(0,0,1).addScaledVector(axis,-axis.z);}
  if(perp.lengthSq()<1e-10){perp=new THREE.Vector3(1,0,0).addScaledVector(axis,-axis.x);}
  return b.clone().addScaledVector(perp.normalize(),Math.max(a.distanceTo(b)*.55,.03));
}
function rigCreateChain(upper,middle,end,label){
  if(!rigValidChain(upper,middle,end))return null;
  const id=[upper.userData.sgId,middle.userData.sgId,end.userData.sgId].join('::');
  if(rigAssist.chains.some(c=>c.id===id))return null;
  const hand=/hand|wrist/.test(rigPartName(end)) || label.toLowerCase().includes('mão');
  const mat=new THREE.MeshBasicMaterial({color:hand?'#79dbdf':'#f5b7dc',depthTest:false,transparent:true,opacity:.95});
  const goal=new THREE.Mesh(new THREE.OctahedronGeometry(Math.max(state.sceneScale*.026,.027)),mat);
  goal.name='SG IK Goal '+label;goal.position.copy(rigWorldPos(end));goal.renderOrder=1001;
  goal.userData.sgIk='goal';goal.visible=false;scene.add(goal);
  const pole=new THREE.Mesh(new THREE.OctahedronGeometry(Math.max(state.sceneScale*.018,.018)),new THREE.MeshBasicMaterial({color:'#ffd486',depthTest:false,transparent:true,opacity:.9}));
  pole.name='SG IK Pole '+label;pole.position.copy(rigPolePosition(upper,middle,end));pole.renderOrder=1002;
  pole.userData.sgIk='pole';pole.visible=false;scene.add(pole);
  const chain={id,label,upper,middle,end,goal,pole,kind:hand?'arm':'leg'};
  goal.userData.rigChain=chain;pole.userData.rigChain=chain;
  rigAssist.chains.push(chain);return chain;
}
// Perfil elaborado a partir do FBX real SweaterUniformRIGGED.fbx:
// pernas com ligação direta e braços com ossos de rotação intermediários.
const BP_FEMALE_IK={
  leftArm:['LeftArm','LeftForeArm','LeftHand','Mão esquerda'],
  rightArm:['RightArm','RightForeArm','RightHand','Mão direita'],
  leftLeg:['LeftUpLeg','LeftLeg','LeftFoot','Pé esquerdo'],
  rightLeg:['RightUpLeg','RightLeg','RightFoot','Pé direito']
};
function rigBone(name){return state.bones.find(b=>rigPartName(b)===name.toLowerCase())||null;}
function rigDetectChains(){
  let found=0;
  // Caminhos exatos do modelo feminino, sem mudar nomes nem ossos Roll.
  for(const names of Object.values(BP_FEMALE_IK)){
    const [upper,middle,end]=names.map((n,i)=>i<3?rigBone(n):n);
    if(rigCreateChain(upper,middle,end,names[3]))found++;
  }
  // Fallback para esqueletos de outros personagens.
  const hands=state.bones.filter(b=>/hand|wrist/.test(rigPartName(b))&&!/thumb|index|finger|pinky|middle|ring/.test(rigPartName(b)));
  const feet=state.bones.filter(b=>/foot|ankle/.test(rigPartName(b))&&!/toe/.test(rigPartName(b)));
  for(const [ends,kind] of [[hands,'arm'],[feet,'leg']]){
    for(const end of ends){
      let mid=end.parent,upper=mid?.parent;
      while(mid&&/roll|twist/i.test(mid.name))mid=mid.parent;
      if(mid){upper=mid.parent;while(upper&&/roll|twist/i.test(upper.name))upper=upper.parent;}
      if(!rigValidChain(upper,mid,end))continue;
      const m=rigPartName(mid),u=rigPartName(upper);
      if(kind==='arm'&&(!/forearm|lowerarm|elbow/.test(m)||!/arm/.test(u)))continue;
      if(kind==='leg'&&(!/leg|shin|calf|knee/.test(m)||!/leg|thigh/.test(u)))continue;
      const side=rigSide(rigPartName(end))!=='?'?rigSide(rigPartName(end)):rigSide(rigPartName(upper));
      const label=(kind==='arm'?'Mão ':'Pé ')+(side==='L'?'esquerda':side==='R'?'direita':end.name);
      if(rigCreateChain(upper,mid,end,label))found++;
    }
  }
  return found;
}
function rigSyncTargets(){
  if(!rigAssist.chains.length||rigAssist.solving)return;
  for(const chain of rigAssist.chains){
    chain.goal.position.copy(rigWorldPos(chain.end));
    chain.pole.position.copy(rigPolePosition(chain.upper,chain.middle,chain.end));
  }
}
function rigClear(){
  if(rigAssist.control && (transform.object===rigAssist.control))transform.detach();
  for(const chain of rigAssist.chains){
    scene.remove(chain.goal,chain.pole);chain.goal.geometry.dispose();chain.goal.material.dispose();chain.pole.geometry.dispose();chain.pole.material.dispose();
  }
  rigAssist.chains=[];rigAssist.selected=null;rigAssist.control=null;rigAssist.enabled=false;rigAssist.solving=false;
  skirtAssist.enabled=false;skirtAssist.groups={};skirtAssist.legs=[];skirtAssist.detected=false;
  if($('rigAssistToggle'))rigRefreshUI();
}
function rigRefreshUI(){
  const select=$('rigChainSelect');if(!select)return;
  const current=rigAssist.selected?.id||'';
  select.replaceChildren();
  if(!rigAssist.chains.length)select.add(new Option('Nenhuma cadeia identificada',''));
  else for(const c of rigAssist.chains)select.add(new Option(c.label,c.id));
  select.value=current||rigAssist.chains[0]?.id||'';
  $('rigAssistToggle').classList.toggle('active',rigAssist.enabled);
  $('rigAssistToggle').setAttribute('aria-pressed',String(rigAssist.enabled));
  $('rigAssistToggle').textContent=rigAssist.enabled?'✥ Desativar IK (voltar ao FK)':'✥ Ativar controles IK';
  $('rigAssistToolbarBtn').classList.toggle('active',rigAssist.enabled);
  $('rigAssistInfo').textContent=rigAssist.chains.length
    ? (rigAssist.enabled?`IK ativo · ${rigAssist.chains.length} controle(s). Mova o alvo no 3D, ajuste o cotovelo/joelho e grave a pose.`:`${rigAssist.chains.length} controles detectados. Ative IK para começar.`)
    : 'Não foram encontrados braços/pernas de três ossos. Abra “Configuração manual de ossos”.';
  $('rigSelectGoalBtn').classList.toggle('active',rigAssist.control===rigAssist.selected?.goal);
  $('rigSelectPoleBtn').classList.toggle('active',rigAssist.control===rigAssist.selected?.pole);
  for(const chain of rigAssist.chains){
    chain.goal.visible=rigAssist.enabled&&state.workspaceMode!=='shading'&&state.rigVisible;
    chain.pole.visible=rigAssist.enabled&&chain===rigAssist.selected&&state.workspaceMode!=='shading'&&state.rigVisible;
  }
}
function rigSelect(chain,part='goal'){
  if(!chain)return;
  if(!rigAssist.enabled)rigSetEnabled(true);
  rigAssist.selected=chain;
  rigAssist.control=part==='pole'?chain.pole:chain.goal;
  state.playing=false;$('playBtn').textContent='▶';
  transform.attach(rigAssist.control);transform.setMode('translate');transform.setSpace('world');
  rigRefreshUI();$('selectedName').textContent='IK · '+chain.label;status(`Rig Assist: ${chain.label} · ${part==='pole'?'cotovelo/joelho':'alvo de mão/pé'}.`);
  if(matchMedia('(max-width:790px)').matches){setWorkspace('animation');}
  rigRefreshUI();
}
function rigSetEnabled(value){
  rigAssist.enabled=Boolean(value);
  if(rigAssist.enabled){
    if(!rigAssist.chains.length){rigAssist.enabled=false;toast('Nenhuma cadeia IK detectada. Configure três ossos manualmente.',true);}
    else{rigSyncTargets();rigSelect(rigAssist.selected||rigAssist.chains[0],'goal');}
  }else{
    if(rigAssist.control&&transform.object===rigAssist.control)transform.detach();
    rigAssist.control=null;rigAssist.selected=null;
    if(state.selected){$('selectedName').textContent=state.selected.name||'Unnamed Bone';}
    if(state.selected&&state.workspaceMode!=='shading'){transform.attach(state.selected);transform.setMode(state.editMode==='rotate'?'rotate':'translate');transform.setSpace('local');}
  }
  rigRefreshUI();
}
function rigAlignJoint(bone,child,desired){
  const root=rigWorldPos(bone),effector=rigWorldPos(child);
  const from=effector.sub(root),to=desired.clone().sub(root);
  if(from.lengthSq()<1e-12||to.lengthSq()<1e-12)return;
  const dq=new THREE.Quaternion().setFromUnitVectors(from.normalize(),to.normalize());
  const oldWorld=bone.getWorldQuaternion(new THREE.Quaternion());
  const parentWorld=bone.parent?.getWorldQuaternion(new THREE.Quaternion())||new THREE.Quaternion();
  bone.quaternion.copy(parentWorld.invert().multiply(dq.multiply(oldWorld))).normalize();
  bone.updateWorldMatrix(true,true);
}
// ---- Blood Petals Female Skirt Assist ---------------------------------
// A malha única SweaterUniform tem clusters de skin nos 12 skart bones.
// Não introduz esqueleto auxiliar: anima rotações originais de 4 cadeias.
const skirtAssist={enabled:false,strength:.55,spread:.35,groups:{},legs:[],detected:false};
const BP_SKART_GROUPS=['Front','Back','Left','Right'];
function skirtSetupModel(){
  skirtAssist.enabled=false;skirtAssist.groups={};skirtAssist.legs=[];skirtAssist.detected=false;
  const hips=rigBone('Hips'), left=rigBone('LeftUpLeg'),right=rigBone('RightUpLeg');
  for(const dir of BP_SKART_GROUPS){
    const bones=[1,2,3].map(i=>rigBone(dir+'_skart'+i));
    if(bones.every(Boolean)&&bones[0].parent===hips&&bones[1].parent===bones[0]&&bones[2].parent===bones[1])skirtAssist.groups[dir]=bones;
  }
  skirtAssist.legs=[left,right];
  skirtAssist.detected=Boolean(left&&right&&Object.keys(skirtAssist.groups).length===4);
  $('skirtAssistEnabled').checked=false;
  $('skirtAssistEnabled').disabled=!skirtAssist.detected;
  for(const id of ['skirtUpdateBtn','skirtKeyBtn','skirtRestoreBtn'])$(id).disabled=!skirtAssist.detected;
  skirtRefresh();
}
function skirtRefresh(){
  const names=Object.keys(skirtAssist.groups);
  const matched=skirtAssist.detected && rigAssist.chains.filter(c=>c.kind==='leg').length>=2;
  $('skirtProfileStatus').textContent=matched
    ? '✓ Rig feminino detectado: 4 IK + 12 ossos de saia · LeftUpLeg / RightUpLeg'
    : names.length ? names.length+' de 4 cadeias da saia detectadas; confira os nomes dos ossos.'
    : 'Saia não encontrada. Este assistente requer *_skart1, *_skart2, *_skart3 e as duas coxas.';
  $('skirtStrengthLabel').textContent=Math.round(skirtAssist.strength*100)+'%';
  $('skirtSpreadLabel').textContent=Math.round(skirtAssist.spread*100)+'%';
}
function skirtLegAngles(bone){
  const rest=state.rest.get(bone?.userData.sgId);
  if(!rest)return {x:0,z:0};
  const q0=new THREE.Quaternion().fromArray(rest.quaternion);
  const relative=q0.clone().invert().multiply(bone.quaternion).normalize();
  const e=new THREE.Euler().setFromQuaternion(relative,'XYZ');
  return {x:clamp(e.x,-.9,.9),z:clamp(e.z,-.7,.7)};
}
function skirtApply(){
  if(!skirtAssist.enabled||!skirtAssist.detected||state.playing)return;
  const [l,r]=skirtAssist.legs.map(skirtLegAngles);
  const s=skirtAssist.strength,spread=skirtAssist.spread;
  const flex=(l.x+r.x)*.5;
  const stride=Math.abs(l.x-r.x);
  const configs={
    Front:[(.55*flex+.18*stride)*s,0],
    Back:[(.38*flex-.12*stride)*s,0],
    Left:[l.x*.35*s,(l.z*.42 + Math.abs(l.z)*.16*spread)*s],
    Right:[r.x*.35*s,(r.z*.42 - Math.abs(r.z)*.16*spread)*s]
  };
  for(const dir of BP_SKART_GROUPS){
    const bones=skirtAssist.groups[dir];if(!bones)continue;
    const [baseX,baseZ]=configs[dir];
    const rootX=clamp(baseX,-.42,.42),rootZ=clamp(baseZ,-.35,.35);
    for(let i=0;i<3;i++){
      const bone=bones[i],rest=state.rest.get(bone.userData.sgId);if(!rest)continue;
      const factor=[1,.62,.32][i];
      const x=clamp(rootX*factor,-.45,.45);
      const z=clamp(rootZ*factor,-.35,.35);
      const localOffset=new THREE.Quaternion().setFromEuler(new THREE.Euler(x,0,z,'XYZ'));
      bone.quaternion.fromArray(rest.quaternion).multiply(localOffset).normalize();
    }
  }
  state.model?.updateMatrixWorld(true);
}
function skirtKeyframe(showToast=true){
  if(!skirtAssist.detected){if(showToast)toast('Importe o rig feminino antes de gravar a saia.',true);return 0;}
  const clip=currentClip(),time=Math.round(state.time*clip.fps)/clip.fps;
  let count=0;
  for(const bones of Object.values(skirtAssist.groups)) for(const bone of bones){
    const id=bone.userData.sgId,list=clip.tracks[id]||(clip.tracks[id]=[]);
    const key={time,pose:capture(bone)},index=list.findIndex(x=>Math.abs(x.time-time)<.0005);
    if(index>=0)list[index]=key;else list.push(key);
    list.sort((a,b)=>a.time-b.time);count++;
  }
  renderTimeline();
  if(showToast)toast('◆ '+count+' ossos da saia gravados no FBX original.');
  return count;
}
function skirtRestore(){
  if(!skirtAssist.detected)return;
  for(const bones of Object.values(skirtAssist.groups))for(const bone of bones){
    const original=state.rest.get(bone.userData.sgId);
    if(original)bone.quaternion.fromArray(original.quaternion);
  }
  state.model?.updateMatrixWorld(true);
  toast('Saia retornou à pose original. Use Gravar saia para salvar o novo estado.');
}
function skirtWire(){
  $('skirtAssistEnabled').onchange=e=>{skirtAssist.enabled=e.target.checked;skirtRefresh();if(skirtAssist.enabled)skirtApply();};
  $('skirtAssistStrength').oninput=e=>{skirtAssist.strength=Number(e.target.value)/100;skirtRefresh();skirtApply();};
  $('skirtAssistSpread').oninput=e=>{skirtAssist.spread=Number(e.target.value)/100;skirtRefresh();skirtApply();};
  $('skirtUpdateBtn').onclick=()=>{skirtApply();toast(skirtAssist.enabled?'Saia ajustada às coxas.':'Ative Saia acompanhar as pernas.',!skirtAssist.enabled);};
  $('skirtKeyBtn').onclick=()=>skirtKeyframe(true);
  $('skirtRestoreBtn').onclick=skirtRestore;
}
// -----------------------------------------------------------------------
function rigSolve(chain){
  if(!chain||rigAssist.solving)return;
  rigAssist.solving=true;
  try{
    const a=rigWorldPos(chain.upper),b=rigWorldPos(chain.middle),c=rigWorldPos(chain.end);
    const l1=a.distanceTo(b),l2=b.distanceTo(c);
    if(l1<1e-6||l2<1e-6)return;
    if(rigAssist.groundClamp&&chain.kind==='leg')chain.goal.position.y=Math.max(chain.goal.position.y,grid.position.y);
    const target=chain.goal.position.clone();
    const delta=target.clone().sub(a);let rawDist=delta.length();
    if(rawDist<1e-8)delta.copy(c.sub(a));
    if(delta.lengthSq()<1e-12)delta.set(0,-1,0);
    const direction=delta.normalize();
    const reach=clamp(rawDist,Math.abs(l1-l2)+.00001,l1+l2-.00001);
    const along=(l1*l1-l2*l2+reach*reach)/(2*reach);
    const height=Math.sqrt(Math.max(0,l1*l1-along*along));
    const poleDir=chain.pole.position.clone().sub(a);
    poleDir.addScaledVector(direction,-poleDir.dot(direction));
    if(poleDir.lengthSq()<1e-9){poleDir.copy(b).sub(a);poleDir.addScaledVector(direction,-poleDir.dot(direction));}
    if(poleDir.lengthSq()<1e-9){poleDir.set(0,0,1).addScaledVector(direction,-direction.z);}
    if(poleDir.lengthSq()<1e-9){poleDir.set(1,0,0).addScaledVector(direction,-direction.x);}
    poleDir.normalize();
    const desiredB=a.clone().addScaledVector(direction,along).addScaledVector(poleDir,height);
    const clampedTarget=a.clone().addScaledVector(direction,reach);
    rigAlignJoint(chain.upper,chain.middle,desiredB);
    rigAlignJoint(chain.middle,chain.end,clampedTarget);
    state.model?.updateMatrixWorld(true);
    if(chain.kind==='leg')skirtApply();
    syncFields();
  }finally{rigAssist.solving=false;}
}
function rigKeyframe(){
  sgMarkDirty();
  const chain=rigAssist.selected;
  if(!chain){toast('Selecione uma mão ou pé no Rig Assist.',true);return;}
  const clip=currentClip(),time=Math.round(state.time*clip.fps)/clip.fps;
  for(const bone of [chain.upper,chain.middle,chain.end]){
    const id=bone.userData.sgId,list=clip.tracks[id]||(clip.tracks[id]=[]);
    const pose={time,pose:capture(bone)};
    const ix=list.findIndex(k=>Math.abs(k.time-time)<.0005);
    if(ix>=0)list[ix]=pose;else list.push(pose);
    list.sort((a,b)=>a.time-b.time);
  }
  const skirtCount=chain.kind==='leg' && skirtAssist.enabled?skirtKeyframe(false):0;
  renderTimeline();toast(`◆ IK gravado em 3 ossos${skirtCount?' + '+skirtCount+' ossos da saia':''} · ${chain.label}`);status(`Rig Assist: keyframe gravado em ${time.toFixed(2)}s (FBX original).`);
}
function rigNudge(axis,sign){
  if(!rigAssist.enabled||!rigAssist.control){toast('Ative o Rig Assist e selecione uma mão ou pé.',true);return;}
  rigAssist.control.position[axis]+=sign*Math.max(state.sceneScale*.045,.015);
  rigSolve(rigAssist.selected);status(`Rig Assist: ${rigAssist.selected?.label||'Alvo'} movido no eixo ${axis.toUpperCase()}. Grave a pose IK.`);
}
function rigSetupModel(){
  rigClear();
  const options=['rigManualUpper','rigManualMiddle','rigManualEnd'];
  for(const id of options){const sel=$(id);sel.replaceChildren();sel.add(new Option('Selecione um osso',''));for(const bone of state.bones){sel.add(new Option(bone.userData.sgId,bone.userData.sgId));}}
  rigDetectChains();rigRefreshUI();skirtSetupModel();
}
function rigWire(){
  $('rigAssistToggle').onclick=()=>rigSetEnabled(!rigAssist.enabled);
  $('rigAssistToolbarBtn').onclick=()=>{setWorkspace('animation');setInspectorTab('pose');rigSetEnabled(!rigAssist.enabled);};
  $('rigChainSelect').onchange=e=>{const c=rigAssist.chains.find(x=>x.id===e.target.value);rigSelect(c,'goal');};
  $('rigSelectGoalBtn').onclick=()=>rigSelect(rigAssist.selected||rigAssist.chains[0],'goal');
  $('rigSelectPoleBtn').onclick=()=>rigSelect(rigAssist.selected||rigAssist.chains[0],'pole');
  $('rigGroundCheck').onchange=e=>{rigAssist.groundClamp=e.target.checked;if(rigAssist.selected)rigSolve(rigAssist.selected);};
  $('rigKeyframeBtn').onclick=rigKeyframe;
  $('rigSnapBtn').onclick=()=>{rigSyncTargets();toast('Controles IK alinhados à pose atual.');};
  for(const b of document.querySelectorAll('[data-rig-nudge]'))b.onclick=()=>{const [axis,sign]=b.dataset.rigNudge.split(':');rigNudge(axis,Number(sign));};
  $('rigManualCreateBtn').onclick=()=>{
    const u=state.boneMap.get($('rigManualUpper').value),m=state.boneMap.get($('rigManualMiddle').value),e=state.boneMap.get($('rigManualEnd').value);
    if(!rigValidChain(u,m,e)){toast('Escolha três ossos conectados: superior → intermediário → mão/pé.',true);return;}
    const chain=rigCreateChain(u,m,e,`Controle ${e.name}`);
    if(!chain){toast('Essa cadeia já existe.',true);return;}
    rigRefreshUI();rigSelect(chain,'goal');toast('Controle IK criado.');
  };
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const sphereGeometry = new THREE.SphereGeometry(1, 10, 8);
const UP = Vec(0,1,0);
const scratchVector = new THREE.Vector3();
let pendingBounds = null;

function mesh(parent, geom, material, position = [0,0,0], rotation = null) {
  const m = new THREE.Mesh(geom, material); m.position.set(...position);
  if (rotation) m.rotation.set(...rotation);
  m.castShadow = false; parent.add(m); return m;
}
function createDemoModel() {
  const root = new THREE.Group(); root.name = 'Ayame_Demo';
  const mat = (color, roughness=.8) => new THREE.MeshStandardMaterial({color, roughness,metalness:0,flatShading:false});
  const skin = mat('#edc6ad'), shirt = mat('#e8dce6'), blue = mat('#35425e'), dark = mat('#222032'), hair = mat('#282031'), rose = mat('#bb7896');
  const joint = (parent, name, x,y,z) => {const b = new THREE.Bone(); b.name=name;b.position.set(x,y,z);parent.add(b);return b;};
  const hips = joint(root,'Hips',0,1.03,0);
  const spine = joint(hips,'Spine',0,.22,0);
  const chest = joint(spine,'Chest',0,.26,0);
  const neck = joint(chest,'Neck',0,.21,0);
  const head = joint(neck,'Head',0,.16,0);
  const lShoulder = joint(chest,'LeftShoulder',-.19,.14,0);
  const lUpper = joint(lShoulder,'LeftArm',-.08,-.04,0);
  const lFore = joint(lUpper,'LeftForeArm',-.05,-.30,0);
  const lHand = joint(lFore,'LeftHand',-.02,-.28,0);
  const rShoulder = joint(chest,'RightShoulder',.19,.14,0);
  const rUpper = joint(rShoulder,'RightArm',.08,-.04,0);
  const rFore = joint(rUpper,'RightForeArm',.05,-.30,0);
  const rHand = joint(rFore,'RightHand',.02,-.28,0);
  const lLeg = joint(hips,'LeftUpLeg',-.105,-.08,0);
  const lLow = joint(lLeg,'LeftLeg',0,-.47,0);
  const lFoot = joint(lLow,'LeftFoot',0,-.46,.05);
  const rLeg = joint(hips,'RightUpLeg',.105,-.08,0);
  const rLow = joint(rLeg,'RightLeg',0,-.47,0);
  const rFoot = joint(rLow,'RightFoot',0,-.46,.05);
  // Malha de exemplo simples, presa aos bones para mostrar as edições em tempo real.
  mesh(hips,new THREE.CylinderGeometry(.17,.20,.24,16),blue,[0,.10,0]);
  mesh(spine,new THREE.CylinderGeometry(.21,.145,.43,16),shirt,[0,.19,0]);
  mesh(spine,new THREE.CylinderGeometry(.12,.245,.24,4),blue,[0,-.15,0],[0,Math.PI/4,0]);
  mesh(chest,new THREE.CylinderGeometry(.12,.13,.17,12),shirt,[0,.09,0]);
  mesh(chest,new THREE.BoxGeometry(.1,.14,.023),rose,[0,.03,.178]);
  mesh(head,new THREE.SphereGeometry(.137,20,14),skin,[0,.04,0]);
  mesh(head,new THREE.SphereGeometry(.148,20,14,0,Math.PI*2,0,Math.PI*.54),hair,[0,.09,0]);
  mesh(head,new THREE.SphereGeometry(.041,9,8),hair,[-.117,.03,-.012]);
  mesh(head,new THREE.SphereGeometry(.041,9,8),hair,[.117,.03,-.012]);
  const eye = mat('#31263b');
  for (const x of [-.05,.05]) mesh(head,new THREE.SphereGeometry(.012,8,8),eye,[x,.046,.129]);
  const limb = (bone, radius, length, material) => mesh(bone,new THREE.CylinderGeometry(radius*.85,radius,length,12),material,[0,-length/2,0]);
  limb(lUpper,.079,.31,shirt); limb(rUpper,.079,.31,shirt);
  limb(lFore,.052,.29,skin); limb(rFore,.052,.29,skin);
  mesh(lHand,new THREE.SphereGeometry(.052,10,8),skin); mesh(rHand,new THREE.SphereGeometry(.052,10,8),skin);
  limb(lLeg,.095,.44,skin); limb(rLeg,.095,.44,skin);
  limb(lLow,.066,.46,skin); limb(rLow,.066,.46,skin);
  mesh(lFoot,new THREE.BoxGeometry(.145,.10,.27),dark,[0,-.025,.07]);
  mesh(rFoot,new THREE.BoxGeometry(.145,.10,.27),dark,[0,-.025,.07]);
  // Detalhes do uniforme, ancorados ao peito.
  mesh(chest,new THREE.BoxGeometry(.27,.065,.02),blue,[0,.14,.15]);
  root.updateMatrixWorld(true);
  return root;
}
function getBoneId(bone) {
  const chain=[]; let p=bone;
  while(p && p!==state.model){if(p.isBone) chain.unshift(p.name||'Bone');p=p.parent;}
  return chain.join('/');
}
function capture(bone) {
  return { position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray() };
}
function applyTransform(bone, pose) {
  bone.position.fromArray(pose.position);
  bone.quaternion.fromArray(pose.quaternion);
  bone.scale.fromArray(pose.scale);
}
function uniqueNamesCheck() {
  const seen = new Set(); let repeat=0;
  for (const b of state.bones) {if(seen.has(b.name)) repeat++;seen.add(b.name);}
  if(repeat) toast(`${repeat} nomes de ossos duplicados: a exportação de animação pode ficar ambígua.`,true);
}
function clearModel() {
  sgClearMaterialPreview();
  state.playing=false;
  transform.detach();
  rigClear();
  if(state.model) displayRoot.remove(state.model);
  displayRoot.scale.setScalar(1);
  if(state.skeletonHelper){scene.remove(state.skeletonHelper);state.skeletonHelper.dispose?.();state.skeletonHelper=null;}
  for(const h of state.handles){scene.remove(h);h.material.dispose();}
  state.handles.length=0;
  state.bones=[];state.boneMap.clear();state.rest.clear();state.selected=null;
  // Evita aplicar texturas à malha da demo após importar outro FBX.
  state.selectedMesh=null;state.selectedMaterialSlot=0;state.importedFile=null;pendingBounds=null;
  state.selectedMesh=null;state.selectedMaterialSlot=0;
}
// Calcula limites apenas das malhas VISÍVEIS (não do esqueleto completo).
// Importadores FBX podem conter bones/controladores enormes e afastados da malha.
function getVisibleCharacterBounds(root) {
  root.updateWorldMatrix(true,true);
  const bounds = new THREE.Box3();
  let found = 0;
  root.traverseVisible(object => {
    if(!object.isMesh || !object.geometry) return;
    const meshBounds = new THREE.Box3().setFromObject(object);
    if(meshBounds.isEmpty()) return;
    if (![meshBounds.min.x,meshBounds.min.y,meshBounds.min.z,
          meshBounds.max.x,meshBounds.max.y,meshBounds.max.z].every(Number.isFinite)) return;
    bounds.union(meshBounds);
    found++;
  });
  return found ? bounds : new THREE.Box3().setFromObject(root);
}
function installModel(model, filename=null, isDemo=false) {
  clearModel();
  state.model = model;state.modelFilename=filename;state.modelIsDemo=isDemo;
  // Apenas a APRESENTAÇÃO do modelo no viewport é normalizada (~1,9 unidade).
  // Os valores do FBX continuam intocados para animar/exportar no Unity.
  const nativeBounds = getVisibleCharacterBounds(model);
  const nativeHeight = nativeBounds.isEmpty() ? 1.9 : Math.max(nativeBounds.getSize(Vec()).y, 0.000001);
  const viewScale = 1.9 / nativeHeight;
  displayRoot.scale.setScalar(viewScale);
  displayRoot.add(model);
  displayRoot.updateWorldMatrix(true,true);
  model.traverse(o => {if(o.isBone){state.bones.push(o);}});
  if(!state.bones.length){displayRoot.remove(model);state.model=null;throw new Error('O FBX não contém ossos detectáveis. Importe um personagem com Armature/Skeleton.');}
  for(const bone of state.bones){const id=getBoneId(bone);bone.userData.sgId=id;state.boneMap.set(id,bone);state.rest.set(id,capture(bone));}
  uniqueNamesCheck();
  const bbox=getVisibleCharacterBounds(model);
  if(bbox.isEmpty()) bbox.set(Vec(-.4,0,-.4),Vec(.4,1.9,.4));
  const size=bbox.getSize(Vec()); const center=bbox.getCenter(Vec());
  const height=Math.max(size.y,.01);const radius=Math.max(size.x,size.y,size.z)*.5;
  pendingBounds={center,radius,height,size,ground:bbox.min.y};
  state.sceneScale=height;
  grid.position.y=bbox.min.y;
  state.skeletonHelper=new THREE.SkeletonHelper(model);
  state.skeletonHelper.material.color.set('#c285aa');
  state.skeletonHelper.material.opacity=.5;
  state.skeletonHelper.material.transparent=true;
  state.skeletonHelper.visible=state.rigVisible;
  scene.add(state.skeletonHelper);
  const handleSize=clamp(height*.013,.008,height*.045);
  for(const bone of state.bones){
    const handle=new THREE.Mesh(sphereGeometry,new THREE.MeshBasicMaterial({color:'#e6a2c6',depthTest:false,transparent:true,opacity:.85}));
    handle.scale.setScalar(handleSize);handle.renderOrder=999;handle.userData.bone=bone;handle.visible=state.rigVisible;
    state.handles.push(handle);scene.add(handle);
  }
  frameModel();
  rigSetupModel();
  state.clips=[makeClip(isDemo?'demo_wave':'new_animation')];state.clipIndex=0;state.time=0;
  state.sourceClips = isDemo ? [] : (model.animations||[]).slice();
  state.selectedMesh=visibleModelMeshes()[0]||null;
  state.selectedMaterialSlot=0;
  if (isDemo) createDemoWave();
  $('modelName').textContent=isDemo?'Ayame · modelo de demonstração':filename;
  $('modelInfo').textContent=isDemo?'Importe o FBX original para exportar':`${state.bones.length} ossos · FBX importado`;
  $('viewportLabel').textContent=isDemo?'Ayame · Demo Rig':filename;
  $('statsText').textContent=`${state.bones.length} bones`;
  $('boneCount').textContent=state.bones.length;
  updateClipSelectors();renderBoneTree();renderTimeline();refreshMaterials();
  $('originalClipsPanel').classList.toggle('hidden',state.sourceClips.length===0);
  updateSourceClips();selectBone(state.bones.find(b=>/rightarm/i.test(b.name))||state.bones[0]);
  refreshMaterials();
  seek(0); status(isDemo?'Modelo de demonstração pronto. Selecione um osso e pressione K.':`${filename} carregado! Crie animações e exporte para a Unity.`);
}
function createDemoWave() {
  const clip=currentClip();clip.duration=2;
  const r=state.bones.find(b=>b.name==='RightArm');
  const elbow=state.bones.find(b=>b.name==='RightForeArm');
  if(!r||!elbow) return;
  function q(x,y,z){const quat=new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(x),rad(y),rad(z),'XYZ'));return quat.toArray();}
  const rid=r.userData.sgId,eid=elbow.userData.sgId;
  const base=state.rest.get(rid),baseE=state.rest.get(eid);
  clip.tracks[rid]=[
    {time:0,pose:{...structuredClone(base),quaternion:q(0,0,0)}},
    {time:.5,pose:{...structuredClone(base),quaternion:q(-8,0,-115)}},
    {time:1.1,pose:{...structuredClone(base),quaternion:q(-5,0,-105)}},
    {time:1.5,pose:{...structuredClone(base),quaternion:q(-8,0,-115)}},
    {time:2,pose:{...structuredClone(base),quaternion:q(0,0,0)}}
  ];
  clip.tracks[eid]=[
    {time:0,pose:structuredClone(baseE)},
    {time:.5,pose:{...structuredClone(baseE),quaternion:q(0,0,-25)}},
    {time:1,pose:{...structuredClone(baseE),quaternion:q(0,0,15)}},
    {time:1.5,pose:{...structuredClone(baseE),quaternion:q(0,0,-25)}},
    {time:2,pose:structuredClone(baseE)}
  ];
}
function frameModel(){
  if(!state.model)return;
  const bounds=getVisibleCharacterBounds(state.model);
  if(bounds.isEmpty())return;
  sgCameraFrame(bounds,matchMedia('(max-width:790px)').matches?1.36:1.19);
}
function zoomCamera(multiplier) {
  const offset=camera.position.clone().sub(orbit.target);
  const distance=clamp(offset.length()*multiplier,orbit.minDistance,orbit.maxDistance);
  if(offset.lengthSq()<1e-12) return;
  camera.position.copy(orbit.target).add(offset.normalize().multiplyScalar(distance));
  orbit.update();
}
function selectBone(bone) {
  if(!bone) return;
  state.selected=bone;
  if(rigAssist.control){rigAssist.control=null;rigAssist.selected=null;rigRefreshUI();}
  if(state.workspaceMode!=='shading'){transform.attach(bone);transform.setMode(state.editMode==='rotate'?'rotate':'translate');transform.setSpace('local');}
  $('selectedName').textContent=bone.name||'Unnamed Bone';
  $('mobileBoneName').textContent=bone.name||'Osso';
  syncFields();renderBoneTree();renderTimeline();
  if (matchMedia('(max-width:790px)').matches && document.querySelector('.app').classList.contains('mobile-open-left')) setMobilePanel('editor');
}
function syncFields(){
  if(!state.selected) return;
  const bone=state.selected;const e=new THREE.Euler().setFromQuaternion(bone.quaternion,'XYZ');
  const angle=deg(e[mobileAxis]);
  const range=$('mobileAngle');if(document.activeElement!==range)range.value=String(Math.round(clamp(angle,-180,180)));
  $('mobileAngleLabel').textContent=`${Math.round(angle)}°`;
  for(const [key,value] of [['rx',deg(e.x)],['ry',deg(e.y)],['rz',deg(e.z)],['px',bone.position.x],['py',bone.position.y],['pz',bone.position.z]]){
    const el=$(key);el.disabled=false;if(document.activeElement!==el)el.value=Number(value.toFixed(key.startsWith('r')?1:3));
  }
}
function renderBoneTree(){
  const host=$('boneTree');host.replaceChildren();
  if(state.outlinerMode==='meshes'){renderMeshOutliner();return;}
  const search=$('boneSearch').value.trim().toLowerCase();
  for(const bone of state.bones){
    const id=bone.userData.sgId;if(search && !bone.name.toLowerCase().includes(search)) continue;
    const depth=Math.min(4,id.split('/').length-1);
    const row=document.createElement('div');row.className='bone-row'+(state.selected===bone?' selected':'');
    row.style.paddingLeft=`${8+depth*11}px`;row.title=id;
    const ico=document.createElement('span');ico.className='bone-ic';ico.textContent=depth?'◇':'♧';
    const name=document.createElement('span');name.textContent=bone.name||'Unnamed Bone';
    row.append(ico,name);row.addEventListener('click',()=>selectBone(bone));host.append(row);
  }
  if(!host.children.length)host.textContent='Nenhum osso encontrado.';
}
function updateClipSelectors(){
  const sel=$('clipSelect');sel.replaceChildren();
  state.clips.forEach((clip,i)=>{const o=new Option(clip.name, String(i));sel.add(o);});
  sel.value=String(state.clipIndex);
  const mobile=$('mobileClipSelect');mobile.replaceChildren();
  state.clips.forEach((clip,i)=>mobile.add(new Option(clip.name,String(i))));mobile.value=String(state.clipIndex);
  const clip=currentClip();$('timelineClipName').textContent=clip.name;
  if($('mobileClipSelect').value!==String(state.clipIndex))$('mobileClipSelect').value=String(state.clipIndex);
  $('durationInput').value=clip.duration;$('fpsInput').value=String(clip.fps);
}
function updateSourceClips(){
  const select=$('originalClipSelect');select.replaceChildren();
  state.sourceClips.forEach((c,i)=>select.add(new Option(`${c.name||'Clip '+(i+1)} (${c.duration.toFixed(1)}s)`,String(i))));
}
function poseAt(id, time, clip=currentClip()) {
  const rest=state.rest.get(id);
  if(!rest) return null;
  const arr=clip.tracks[id];if(!arr?.length) return rest;
  if(time<=arr[0].time) return arr[0].pose;
  if(time>=arr[arr.length-1].time) return arr[arr.length-1].pose;
  let a=arr[0],b=arr[arr.length-1];
  for(let i=0;i<arr.length-1;i++){if(time>=arr[i].time&&time<=arr[i+1].time){a=arr[i];b=arr[i+1];break;}}
  const t=clamp((time-a.time)/Math.max(.0001,b.time-a.time),0,1);
  const v=t*t*(3-2*t);
  const position=new THREE.Vector3().fromArray(a.pose.position).lerp(new THREE.Vector3().fromArray(b.pose.position),v).toArray();
  const scale=new THREE.Vector3().fromArray(a.pose.scale).lerp(new THREE.Vector3().fromArray(b.pose.scale),v).toArray();
  const quaternion=new THREE.Quaternion().fromArray(a.pose.quaternion).slerp(new THREE.Quaternion().fromArray(b.pose.quaternion),v).toArray();
  return {position,quaternion,scale};
}
function applyPose(time){
  for(const bone of state.bones){const pose=poseAt(bone.userData.sgId,time);if(pose)applyTransform(bone,pose);}
  state.model?.updateMatrixWorld(true);
  rigSyncTargets();
  syncFields();
}
function seek(next){
  state.time=clamp(Number(next)||0,0,currentClip().duration);
  applyPose(state.time);
  updatePlayhead();
}
function updatePlayhead(){
  const d=Math.max(.01,currentClip().duration),t=state.time;
  $('playhead').style.left=`${(100*t/d).toFixed(4)}%`;
  $('timeLabel').textContent=formatTime(t);
  const ms=$('mobileScrub');ms.max=String(d);if(document.activeElement!==ms)ms.value=String(t);
  $('mobileTimeLabel').textContent=`${t.toFixed(2)}s`;
  $('mobileDurationLabel').textContent=`${d.toFixed(2)}s`;
}
function keyframe(bone=state.selected){
  sgMarkDirty();
  if(rigAssist.enabled && rigAssist.control && rigAssist.selected){rigKeyframe();return;}
  if(!bone){toast('Selecione um osso primeiro.',true);return;}
  const clip=currentClip(), id=bone.userData.sgId;
  const frames=clip.tracks[id]||(clip.tracks[id]=[]);
  const time=Math.round(state.time*clip.fps)/clip.fps;
  const key={time,pose:capture(bone)};
  const ix=frames.findIndex(k=>Math.abs(k.time-time)<.0005);
  if(ix>=0) frames[ix]=key;else frames.push(key);
  frames.sort((a,b)=>a.time-b.time);
  renderTimeline();status(`◆ Keyframe de ${bone.name} criado em ${time.toFixed(2)}s.`);
  toast(`◆ Keyframe salvo: ${bone.name} · ${time.toFixed(2)}s`);
}
function removeKey(boneId,time){
  sgMarkDirty();
  const list=currentClip().tracks[boneId];if(!list)return;
  const i=list.findIndex(k=>Math.abs(k.time-time)<.0005);
  if(i>=0){list.splice(i,1);if(!list.length)delete currentClip().tracks[boneId];renderTimeline();seek(state.time);toast('Keyframe removido.');}
}
function renderTimeline(){
  if(!state.clips.length)return;
  const clip=currentClip();$('timelineClipName').textContent=clip.name;
  if($('mobileClipSelect').value!==String(state.clipIndex))$('mobileClipSelect').value=String(state.clipIndex);
  const total=Object.values(clip.tracks).reduce((sum,frames)=>sum+frames.length,0);
  $('keyCount').textContent=`${total} keys`;
  const names=$('timelineTrackNames'),rows=$('timelineRows'),ruler=$('timelineRuler');
  names.replaceChildren();rows.replaceChildren();ruler.replaceChildren();
  const pad=document.createElement('div');pad.className='ruler-pad';pad.textContent='BONES / TRACKS';names.append(pad);
  const ticks=Math.min(12,Math.max(2,Math.round(clip.duration)));
  for(let i=0;i<=ticks;i++){
    const mark=document.createElement('span');mark.className='ruler-label';mark.style.left=`${i/ticks*100}%`;
    mark.textContent=`${(clip.duration*i/ticks).toFixed(1)}s`;ruler.append(mark);
  }
  for(const bone of state.bones){
    const id=bone.userData.sgId,selected=state.selected===bone;
    const label=document.createElement('div');label.className='track-name'+(selected?' selected':'');
    label.textContent=(id.split('/').length>1?'· ':'')+(bone.name||'Bone');label.title=id;
    label.addEventListener('click',()=>selectBone(bone));names.append(label);
    const row=document.createElement('div');row.className='timeline-row'+(selected?' selected':'');
    row.addEventListener('click',(evt)=>{
      if(evt.target.closest('.key-marker'))return;
      state.playing=false;const rect=row.getBoundingClientRect();seek(((evt.clientX-rect.left)/rect.width)*clip.duration);
      selectBone(bone);
    });
    for(const k of clip.tracks[id]||[]){
      const dot=document.createElement('div');dot.className='key-marker';dot.style.left=`${100*k.time/clip.duration}%`;
      dot.title=`${bone.name}: ${k.time.toFixed(2)}s. Clique para selecionar; botão direito para remover.`;
      dot.addEventListener('click',(evt)=>{evt.stopPropagation();state.playing=false;seek(k.time);selectBone(bone);});
      dot.addEventListener('contextmenu',(evt)=>{evt.preventDefault();evt.stopPropagation();removeKey(id,k.time);});
      row.append(dot);
    }
    rows.append(row);
  }
  // Rolar nomes e trilhas juntos.
  rows.onscroll=()=>{names.scrollTop=rows.scrollTop;};
  updatePlayhead();
}
function togglePlay(){
  state.playing=!state.playing;state.lastFrameAt=performance.now();
  if(state.playing&&state.time>=currentClip().duration)seek(0);
  $('playBtn').textContent=state.playing?'Ⅱ':'▶';
}
function changeMode(mode){
  state.editMode=mode;if(rigAssist.control){transform.setMode('translate');}else{transform.setMode(mode==='rotate'?'rotate':'translate');}
  $('rotateBtn').classList.toggle('active',mode==='rotate');$('moveBtn').classList.toggle('active',mode==='translate');
  status(mode==='rotate'?'Gizmo de rotação ativo.':'Gizmo de movimento ativo.');
}
let prevViewportAspect=null;
function updateSize(){
  // Skip zero-size viewports while switching screens.
  const cssW=viewport.clientWidth, cssH=viewport.clientHeight;
  if(cssW<2||cssH<2)return;
  const w=Math.max(2,Math.round(cssW)),h=Math.max(2,Math.round(cssH));
  // Keep WebGL draw buffer, CSS canvas rectangle and camera projection synchronized.
  renderer.setSize(w,h,false);
  renderer.domElement.style.width='100%';
  renderer.domElement.style.height='100%';
  const nextAspect=w/h;
  const aspectChanged=Math.abs(camera.aspect-nextAspect)>1e-4;
  if(aspectChanged){camera.aspect=nextAspect;camera.updateProjectionMatrix();}
  if(pendingBounds&&(prevViewportAspect===null||Math.abs(prevViewportAspect-nextAspect)>.18))frameModel();
  prevViewportAspect=nextAspect;
}
new ResizeObserver(updateSize).observe(viewport);
window.addEventListener('resize',updateSize);
// Ensure aspect is correct before installing and framing the first model.
updateSize();
function animate(now){
  requestAnimationFrame(animate);
  const elapsed=Math.min(.1,(now-state.lastFrameAt)/1000);
  state.lastFrameAt=now;
  if(state.playing){
    const end=currentClip().duration;let t=state.time+elapsed;
    if(t>=end){if(state.loop){t=t%end;}else{t=end;state.playing=false;$('playBtn').textContent='▶';}}
    seek(t);
  }
  transform.enabled=!state.playing;
  orbit.update();
  for(const h of state.handles){h.userData.bone.getWorldPosition(scratchVector);h.position.copy(scratchVector);const selected=h.userData.bone===state.selected;h.material.color.set(selected?'#ffe1f0':'#d698b5');h.material.opacity=selected?1:.72;h.scale.setScalar(clamp(state.sceneScale*(selected?.019:.012),.008,state.sceneScale*.045));}
  renderer.render(scene,camera);
}

async function importFBX(file){
  if(!file||!file.name.toLowerCase().endsWith('.fbx')){toast('Escolha um arquivo .FBX válido.',true);return;}
  if(file.size>120*1024*1024){toast('Este FBX tem mais de 120 MB. Simplifique o modelo antes de abrir.',true);return;}
  loading(true,'Abrindo personagem FBX…','Lendo malha, esqueleto e animações locais');
  await new Promise(resolve=>setTimeout(resolve,40));
  try{
    const bytes=await file.arrayBuffer();
    const group=new FBXLoader().parse(bytes,'');
    group.name=group.name||file.name.replace(/\.fbx$/i,'');
    installModel(group,file.name,false);
    state.importedFile=file;
    if(state.sourceClips.length)toast(`${file.name} importado! ${state.sourceClips.length} animação(ões) original(is) detectada(s).`);
    else toast(`${file.name} importado com sucesso!`);
  }catch(e){console.error(e);toast('Não foi possível ler o FBX: '+e.message,true);status('Erro de importação. Verifique se o FBX contém Armature.');}
  finally{loading(false);}
}

function serializeProject(){
  return {app:'SilentGardenMotionStudio',version:1,modelFilename:state.modelFilename,clipIndex:state.clipIndex,
    clips:state.clips.map(c=>({name:c.name,duration:c.duration,fps:c.fps,tracks:c.tracks})),
    boneNames:state.bones.map(b=>({path:b.userData.sgId,name:b.name})),
    materials:serializeMaterials(),
    rigAssist:{enabled:rigAssist.enabled,groundClamp:rigAssist.groundClamp,chains:rigAssist.chains.map(c=>({label:c.label,upper:c.upper.userData.sgId,middle:c.middle.userData.sgId,end:c.end.userData.sgId}))}};
}
async function saveProject(){
  sgClearMaterialPreview();
  const project=serializeProject();const name=tidy(state.modelFilename?.replace(/\.fbx$/i,'')||'demo');
  const json=JSON.stringify(project,null,2);
  try{
    const ok=await download(new Blob([json],{type:'application/json'}),`${name}_silentgarden.sgmotion.json`);
    if(ok===false)return;
    await sgRememberProject(json);sgSetClean();
    toast('Projeto salvo com animações e texturas. Guarde também o FBX original!');
  }catch(e){toast('Não foi possível salvar: '+e.message,true);}
}
async function openProject(file){
  try{
    const p=JSON.parse(await file.text());
    if(p.app!=='SilentGardenMotionStudio'||p.version!==1||!Array.isArray(p.clips)||!p.clips.length)throw new Error('Formato de projeto não reconhecido.');
    if(p.modelFilename&&p.modelFilename!==state.modelFilename)throw new Error(`Este projeto pertence ao modelo “${p.modelFilename}”. Importe esse FBX primeiro.`);
    const imported=p.clips.map(c=>({name:String(c.name||'animation'),duration:clamp(Number(c.duration)||3,.1,120),fps:[24,30,60].includes(Number(c.fps))?Number(c.fps):30,tracks:{}}));
    let loaded=0,unmatched=0;
    p.clips.forEach((c,i)=>{
      for(const [id,frames] of Object.entries(c.tracks||{})){
        let bone=state.boneMap.get(id);
        if(!bone){const n=id.split('/').at(-1);bone=state.bones.find(b=>b.name===n);}
        if(!bone){unmatched++;continue;}
        if(!Array.isArray(frames))continue;
        imported[i].tracks[bone.userData.sgId]=frames.filter(f=>Number.isFinite(f.time)&&f.pose&&
          f.pose.position?.length===3&&f.pose.quaternion?.length===4&&f.pose.scale?.length===3)
          .map(f=>({time:clamp(f.time,0,imported[i].duration),pose:f.pose})).sort((a,b)=>a.time-b.time);
        loaded++;
      }
    });
    state.clips=imported;state.clipIndex=clamp(p.clipIndex||0,0,imported.length-1);state.playing=false;
    updateClipSelectors();renderTimeline();seek(0);
    if(p.rigAssist && Array.isArray(p.rigAssist.chains)){
      rigAssist.groundClamp=p.rigAssist.groundClamp!==false;
      $('rigGroundCheck').checked=rigAssist.groundClamp;
      for(const saved of p.rigAssist.chains){
        const upper=state.boneMap.get(saved.upper),middle=state.boneMap.get(saved.middle),end=state.boneMap.get(saved.end);
        if(rigValidChain(upper,middle,end))rigCreateChain(upper,middle,end,String(saved.label||end.name));
      }
      rigRefreshUI();
      if(p.rigAssist.enabled&&rigAssist.chains.length)rigSetEnabled(true);
    }
    if(Array.isArray(p.materials))await restoreMaterials(p.materials);
    toast(`Projeto aberto: ${loaded} trilhas restauradas.${unmatched?' '+unmatched+' ossos não correspondem.':''}`);
    sgSetClean();return true;
  }catch(e){toast(`Não foi possível abrir o projeto: ${e.message}`,true);return false;}
}
function createAnimationClip(){
  const c=currentClip();const times=[];
  const tracks=[];const frameCount=Math.max(2,Math.ceil(c.duration*c.fps)+1);
  for(let i=0;i<frameCount;i++)times.push(Math.min(c.duration,i/c.fps));
  for(const bone of state.bones){
    const id=bone.userData.sgId;
    if(!(c.tracks[id]||[]).length)continue;
    const pos=[],quat=[],sca=[];
    for(const time of times){
      const p=poseAt(id,time,c);
      pos.push(...p.position);quat.push(...p.quaternion);sca.push(...p.scale);
    }
    // GLTFExporter associa tracks ao node pelo nome (bones do FBX).
    const bName=bone.name;
    tracks.push(new THREE.VectorKeyframeTrack(`${bName}.position`,times,pos));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bName}.quaternion`,times,quat));
    tracks.push(new THREE.VectorKeyframeTrack(`${bName}.scale`,times,sca));
  }
  if(!tracks.length)throw new Error('Esta animação está vazia. Selecione um osso e adicione keyframes.');
  return new THREE.AnimationClip(c.name,c.duration,tracks);
}
async function makeGlb(){
  sgClearMaterialPreview();
  if(state.modelIsDemo)throw new Error('Importe o FBX da Ayame antes de exportar. O Demo Rig é apenas um exercício.');
  const clip=createAnimationClip();
  // O modelo exportado carrega posições base; as keyframes animam a pose de repouso.
  const old=state.bones.map(b=>capture(b));
  // Suspende a escala apenas VISUAL antes de criar o arquivo animado.
  const visualParent=state.model.parent;
  visualParent?.remove(state.model);
  scene.add(state.model);
  try{
    for(const bone of state.bones)applyTransform(bone,state.rest.get(bone.userData.sgId));
    state.model.updateMatrixWorld(true);
    // Se um FBX contiver tracks antigos, só exportamos a animação nova.
    const result=await new GLTFExporter().parseAsync(state.model,{binary:true,animations:[clip],onlyVisible:false,trs:true,maxTextureSize:4096});
    if(!(result instanceof ArrayBuffer))throw new Error('Exportação GLB não gerou dados binários.');
    return new Blob([result],{type:'model/gltf-binary'});
  }finally{
    state.bones.forEach((b,i)=>applyTransform(b,old[i]));
    scene.remove(state.model);
    (visualParent||displayRoot).add(state.model);
    state.model.updateMatrixWorld(true);
  }
}
async function exportGlb(){
  if(state.exportBusy)return;state.exportBusy=true;
  loading(true,'Preparando GLB animado…','Bake dos keyframes');
  try{
    const blob=await makeGlb();
    download(blob,`${tidy(currentClip().name)}.glb`);
    toast('GLB exportado! Para a Unity Legacy, use o botão Exportar FBX.');
  }catch(e){console.error(e);toast(e.message,true);}finally{state.exportBusy=false;loading(false);}
}
const SETTINGS_URL_KEY='sgmotion_backend_url';
let backendToken='';
let mobileAxis='x';
let backendBase=(localStorage.getItem(SETTINGS_URL_KEY)||'').replace(/\/$/,'');
function backendApi(path){return backendBase+path;}
function backendHeaders(){return backendToken?{'Authorization':`Bearer ${backendToken}`}:{ };}
function setBackendPill(textValue, ready){
  const pill=$('backendPill');pill.classList.toggle('ready',ready);pill.classList.toggle('offline',!ready);
  pill.replaceChildren();const dot=document.createElement('i');pill.append(dot,document.createTextNode(' '+textValue));
}
async function checkBackend(){
  if(window.motionDesktop){
    try{
      const local=await window.motionDesktop.blenderStatus();
      state.converterReady=Boolean(local.found);
      setBackendPill(state.converterReady?'Blender local encontrado':'FBX: escolher Blender',state.converterReady);
    }catch(error){state.converterReady=false;setBackendPill('Blender indisponível',false);}
    return;
  }
  const ctrl=new AbortController();const stop=setTimeout(()=>ctrl.abort(),5000);
  try{
    const r=await fetch(backendApi('/api/status'),{cache:'no-store',signal:ctrl.signal,headers:backendHeaders()});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const data=await r.json();state.converterReady=Boolean(data.blenderFound);
    setBackendPill(state.converterReady?'Conversor FBX pronto':'Blender não disponível',state.converterReady);
  }catch(e){state.converterReady=false;setBackendPill('FBX precisa de servidor',false);}
  finally{clearTimeout(stop);}
}
async function exportFbx(){
  if(state.exportBusy)return;
  if(window.motionDesktop){
    if(!state.converterReady){
      const selected=await window.motionDesktop.chooseBlender();
      state.converterReady=Boolean(selected?.found);
      setBackendPill(state.converterReady?'Blender local encontrado':'FBX: escolher Blender',state.converterReady);
      if(!state.converterReady){toast('Para exportar FBX, selecione o blender.exe instalado no computador.',true);return;}
    }
    state.exportBusy=true;
    loading(true,'Exportando FBX no Windows…','Usando o Blender instalado neste computador');
    try{
      const glb=await makeGlb();
      const result=await window.motionDesktop.exportFbx(await glb.arrayBuffer(),{
        fps:currentClip().fps, name:tidy(currentClip().name)
      });
      if(result?.cancelled)toast('Exportação cancelada.');
      else if(result?.ok)toast('✿ FBX exportado! Importe na Unity e configure como Legacy.');
      else throw new Error(result?.error||'Falha no conversor Blender.');
    }catch(e){console.error(e);toast(`Falha na exportação: ${e.message}`,true);}
    finally{state.exportBusy=false;loading(false);}
    return;
  }
  if(!state.converterReady){
    toast('Conecte um servidor com Blender para exportar FBX.',true);
    $('backendDialog').showModal();return;
  }
  state.exportBusy=true;
  loading(true,'Exportando animação FBX…','Preparando modelo e enviando ao conversor autorizado');
  try{
    const glb=await makeGlb();const form=new FormData();
    form.append('model',glb,`${tidy(currentClip().name)}.glb`);
    form.append('fps',String(currentClip().fps));
    form.append('name',tidy(currentClip().name));
    const r=await fetch(backendApi('/api/export-fbx'),{method:'POST',body:form,headers:backendHeaders()});
    if(!r.ok){let info;try{info=await r.json();}catch{info={error:`HTTP ${r.status}`};}throw new Error(info.error||`HTTP ${r.status}`);}
    const fbx=await r.blob();await download(fbx,`${tidy(currentClip().name)}.fbx`);
    toast('✿ Animação FBX exportada! Importe na Unity e configure como Legacy.');
  }catch(e){console.error(e);toast(`Falha na exportação: ${e.message}`,true);}finally{state.exportBusy=false;loading(false);}
}
function setMobilePanel(panel){
  const app=document.querySelector('.app');
  app.classList.toggle('mobile-open-left',panel==='bones');
  app.classList.toggle('mobile-open-right',panel==='pose'||panel==='rig'||panel==='export'||panel==='materials');
  $('mobileBackdrop').classList.toggle('hidden',panel==='editor');
  for(const button of document.querySelectorAll('[data-mobile-panel]')) button.classList.toggle('active',button.dataset.mobilePanel===panel);
  if(panel==='materials'){setWorkspace('shading');setInspectorTab('materials');}
  if(panel==='pose'||panel==='rig'){setWorkspace('animation');setInspectorTab('pose');}
  if(panel==='rig')requestAnimationFrame(()=>$('rigAssistPanel').scrollIntoView({block:'start',behavior:'smooth'}));
  if(panel==='export')setInspectorTab('export');
  if(panel==='export') requestAnimationFrame(()=>{const target=$('connectBackendBtn');target?.scrollIntoView({block:'end',behavior:'smooth'});});
}
function setMobileAngle(value){
  const bone=state.selected;if(!bone){toast('Selecione um osso na tela ou em Ossos.',true);return;}
  const a=clamp(Number(value)||0,-180,180);
  const e=new THREE.Euler().setFromQuaternion(bone.quaternion,'XYZ');e[mobileAxis]=rad(a);
  bone.quaternion.setFromEuler(e);bone.updateMatrixWorld(true);
  if(skirtAssist.enabled && /^(leftupleg|rightupleg)$/.test(rigPartName(bone)))skirtApply();
  syncFields();
  $('mobileAngle').value=String(Math.round(a));$('mobileAngleLabel').textContent=`${Math.round(a)}°`;
  status(`Pose: ${bone.name}, eixo ${mobileAxis.toUpperCase()} = ${Math.round(a)}°. Toque em Keyframe para gravar.`);
}
function wireMobile(){
  for(const btn of document.querySelectorAll('[data-mobile-panel]'))btn.addEventListener('click',()=>setMobilePanel(btn.dataset.mobilePanel));
  $('mobileBackdrop').onclick=()=>setMobilePanel('editor');
  $('mobileOpenProjectBtn').onclick=()=>$('projectInput').click();
  $('mobileCenterBtn').onclick=frameModel;
  $('mobileZoomOutBtn').onclick=()=>zoomCamera(1.25);
  $('mobileZoomInBtn').onclick=()=>zoomCamera(.55);
  $('mobileScrub').addEventListener('input',e=>{state.playing=false;$('playBtn').textContent='▶';seek(Number(e.target.value));});
  $('mobileKeyBtn').onclick=()=>keyframe();
  $('mobileResetBtn').onclick=()=>{if(!state.selected)return;applyTransform(state.selected,state.rest.get(state.selected.userData.sgId));syncFields();};
  for(const btn of document.querySelectorAll('[data-mobile-axis]')){
    btn.onclick=()=>{mobileAxis=btn.dataset.mobileAxis;for(const b of document.querySelectorAll('[data-mobile-axis]'))b.classList.toggle('selected',b===btn);syncFields();};
  }
  $('mobileAngle').addEventListener('input',e=>setMobileAngle(e.target.value));
  $('mobileMinus').onclick=()=>setMobileAngle(Number($('mobileAngle').value)-5);
  $('mobilePlus').onclick=()=>setMobileAngle(Number($('mobileAngle').value)+5);
  $('mobileClipSelect').onchange=e=>{state.playing=false;state.clipIndex=Number(e.target.value);updateClipSelectors();renderTimeline();seek(0);};
  $('mobileNewClipBtn').onclick=()=>$('newClipBtn').click();
  const dlg=$('backendDialog');
  $('connectBackendBtn').onclick=async()=>{
    if(window.motionDesktop){
      const selected=await window.motionDesktop.chooseBlender();
      if(selected?.found)toast('Blender configurado para exportar FBX.');
      await checkBackend();return;
    }
    $('backendUrl').value=backendBase;$('backendToken').value=backendToken;dlg.showModal();
  };
  $('backendCloseBtn').onclick=()=>dlg.close();
  $('backendConnectBtn').onclick=async()=>{
    const input=$('backendUrl').value.trim().replace(/\/$/,'');
    if(input){
      try{const url=new URL(input);if(url.protocol!=='https:'&&!(['localhost','127.0.0.1'].includes(url.hostname)&&url.protocol==='http:'))throw new Error('HTTPS obrigatório, exceto localhost');
      if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Informe apenas a origem do servidor (sem caminho).');}
      catch(e){toast(`URL inválida: ${e.message}`,true);return;}
    }
    backendBase=input;backendToken=$('backendToken').value.trim();localStorage.setItem(SETTINGS_URL_KEY,backendBase);dlg.close();
    await checkBackend();toast(state.converterReady?'Conversor conectado!':'Não foi possível conectar o Blender. Confira URL e configuração.',!state.converterReady);
  };
}

async function importOriginalClip(){
  const clip=state.sourceClips[Number($('originalClipSelect').value)];
  if(!clip)return;
  if(clip.duration>60){toast('Clips maiores que 60s ainda não são suportados nesta versão.',true);return;}
  loading(true,'Convertendo clip original…','Lendo quadros e poses');
  await new Promise(resolve=>setTimeout(resolve,30));
  try{
    const sampler=new THREE.AnimationMixer(state.model);
    const rest=state.bones.map(b=>capture(b));
    const anim=makeClip(clip.name||'imported_animation',Math.max(.1,clip.duration),30);
    const action=sampler.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const frameCount=Math.min(601,Math.ceil(anim.duration*15)+1);
    for(let frame=0;frame<frameCount;frame++){
      const t=(frame/(frameCount-1))*anim.duration;
      sampler.setTime(t);
      for(const bone of state.bones){
        const id=bone.userData.sgId;
        (anim.tracks[id]||(anim.tracks[id]=[])).push({time:t,pose:capture(bone)});
      }
    }
    action.stop();sampler.stopAllAction();
    state.bones.forEach((b,i)=>applyTransform(b,rest[i]));
    state.clips.push(anim);state.clipIndex=state.clips.length-1;
    updateClipSelectors();renderTimeline();seek(0);
    toast(`Clip “${anim.name}” copiado para a timeline (${frameCount} amostras).`);
  }catch(e){console.error(e);toast(`Não foi possível importar o clip: ${e.message}`,true);}
  finally{loading(false);}
}


// ======================= SHADING / MATERIAL EDITOR =======================
// Material overrides persist in the .sgmotion.json project (images embedded as data URLs).
function visibleModelMeshes(){
  const out=[];
  state.model?.traverseVisible(o=>{if(o.isMesh&&o.geometry)out.push(o);});
  return out;
}
function allModelMeshes(){
  const out=[];state.model?.traverse(o=>{if(o.isMesh&&o.geometry)out.push(o);});return out;
}
function meshPath(mesh){
  const keys=[];let node=mesh;
  while(node&&node!==state.model){if(!node.parent)break;keys.unshift(node.parent.children.indexOf(node));node=node.parent;}
  return keys.join('.');
}
function meshForPath(path){return allModelMeshes().find(m=>meshPath(m)===path);}
function meshMaterials(mesh){return !mesh||!mesh.material?[]:(Array.isArray(mesh.material)?mesh.material:[mesh.material]);}
function activeMaterial(){return meshMaterials(state.selectedMesh)[state.selectedMaterialSlot]||null;}
function defaultMeshSelection(){
  if(state.selectedMesh && allModelMeshes().includes(state.selectedMesh))return state.selectedMesh;
  const next=visibleModelMeshes()[0]||allModelMeshes()[0]||null;
  state.selectedMesh=next;state.selectedMaterialSlot=0;
  return next;
}
function assignMaterialToMesh(mesh,slot,material,{clearTextures=true}={}){
  if(!mesh||!material)return;
  const previous=meshMaterials(mesh);
  if(Array.isArray(mesh.material)){
    const updated=mesh.material.slice();updated[slot]=material;mesh.material=updated;
  }else mesh.material=material;
  mesh.userData.sgOwnedSlots ||= {};
  mesh.userData.sgOwnedSlots[slot]=true;
  mesh.userData.sgEditedSlots ||= {};
  mesh.userData.sgEditedSlots[slot]=true;
  mesh.userData.sgTextureInfo ||= {};
  if(clearTextures)mesh.userData.sgTextureInfo[slot]={};
  material.needsUpdate=true;
}
function createNewMaterial({duplicate=false,silent=false}={}){
  sgClearMaterialPreview();sgMarkDirty();
  const mesh=defaultMeshSelection();
  if(!mesh){if(!silent)toast('Importe um modelo FBX ou abra a demo para criar um material.',true);return null;}
  let slot=state.selectedMaterialSlot;
  if(slot>=meshMaterials(mesh).length)slot=0;
  state.selectedMaterialSlot=slot;
  const current=activeMaterial();
  const number=(mesh.userData.sgMaterialSequence=(mesh.userData.sgMaterialSequence||0)+1);
  const mat=duplicate&&current?current.clone():new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.72,metalness:0,side:THREE.FrontSide});
  mat.name=duplicate ? `${current?.name||'Material'}_Copy_${number}`:`SG_Material_${number}`;
  const previousInfo=duplicate?structuredClone(activeMaterialData()||{}):{};
  assignMaterialToMesh(mesh,slot,mat);
  if(duplicate)mesh.userData.sgTextureInfo[slot]=previousInfo;
  refreshMaterials();renderBoneTree();
  if(!silent){toast(`${duplicate?'Material duplicado':'Material criado'} e aplicado em ${mesh.name||'malha'}.`);status(`Material ${mat.name} atribuído à malha.`);}
  return mat;
}
function activeMaterialData(){
  const mesh=state.selectedMesh;if(!mesh)return null;
  mesh.userData.sgTextureInfo ||= {};
  mesh.userData.sgTextureInfo[state.selectedMaterialSlot] ||= {};
  return mesh.userData.sgTextureInfo[state.selectedMaterialSlot];
}
function markMaterialEdited(){
  if(!state.selectedMesh)return;
  const mesh=state.selectedMesh;
  mesh.userData.sgEditedSlots ||= {};
  mesh.userData.sgEditedSlots[state.selectedMaterialSlot]=true;
}
function cloneWritableMaterial(){
  sgClearMaterialPreview();sgMarkDirty();
  let mat=activeMaterial();if(!mat)return null;
  const mesh=state.selectedMesh;
  mesh.userData.sgOwnedSlots ||= {};
  if(!mesh.userData.sgOwnedSlots[state.selectedMaterialSlot]){
    // Clone per selected mesh to prevent unintentional global changes to shared FBX materials.
    const std=new THREE.MeshStandardMaterial({
      name:mat.name||'Material',color:mat.color?.clone()||new THREE.Color('#ffffff'),
      map:mat.map||null,normalMap:mat.normalMap||null,emissiveMap:mat.emissiveMap||null,
      roughnessMap:mat.roughnessMap||null,metalnessMap:mat.metalnessMap||null,alphaMap:mat.alphaMap||null,
      emissive:mat.emissive?.clone()||new THREE.Color('#000000'),
      roughness:typeof mat.roughness==='number'?mat.roughness:.7,
      metalness:typeof mat.metalness==='number'?mat.metalness:0,
      opacity:typeof mat.opacity==='number'?mat.opacity:1,
      transparent:!!mat.transparent,side:mat.side,alphaTest:mat.alphaTest||0,
      vertexColors:!!mat.vertexColors,wireframe:!!mat.wireframe,
      flatShading:!!mat.flatShading,depthWrite:mat.depthWrite,
    });
    if(Array.isArray(mesh.material)){const a=mesh.material.slice();a[state.selectedMaterialSlot]=std;mesh.material=a;}
    else mesh.material=std;
    mesh.userData.sgOwnedSlots[state.selectedMaterialSlot]=true;
    mat=std;
  }
  markMaterialEdited();return mat;
}
function setWorkspace(mode){
  if(!['layout','animation','shading'].includes(mode))return;
  state.workspaceMode=mode;
  document.querySelectorAll('[data-workspace]').forEach(b=>b.classList.toggle('active',b.dataset.workspace===mode));
  $('viewportModeLabel').textContent='PERSPECTIVE · '+(mode==='shading'?'MATERIAL MODE':mode==='layout'?'OBJECT MODE':'POSE MODE');
  $('viewport').classList.toggle('viewport-shading',mode==='shading');
  if(mode==='shading'){
    if(rigAssist.control){transform.detach();rigAssist.control=null;rigAssist.selected=null;}
    state.outlinerMode='meshes';setInspectorTab('materials');transform.detach();
    defaultMeshSelection();
  }else if(mode==='animation'){
    state.outlinerMode='bones';setInspectorTab('pose');
    if(rigAssist.enabled&&rigAssist.control){transform.attach(rigAssist.control);transform.setMode('translate');transform.setSpace('world');}
    else if(state.selected)transform.attach(state.selected);
  }else{
    state.outlinerMode='meshes';setInspectorTab('materials');transform.detach();
  }
  refreshOutlinerButtons();renderBoneTree();refreshMaterials();rigRefreshUI();
}
function setInspectorTab(mode){
  state.inspectorTab=mode;
  for(const b of document.querySelectorAll('[data-inspector-tab]')){
    b.classList.toggle('active',b.dataset.inspectorTab===mode);
    b.setAttribute('aria-selected',String(b.dataset.inspectorTab===mode));
  }
  for(const kind of ['pose','materials','export']){
    const el=$(kind+'Inspector');if(el)el.classList.toggle('hidden',kind!==mode);
  }
  $('inspectorHeading').textContent=mode==='pose'?'Transformações':mode==='materials'?'Materiais & Texturas':'Exportação';
}
function setupInspectorPages(){
  const scroll=document.querySelector('.inspector-scroll');
  const material=$('materialInspector');
  const sections=Array.from(scroll.children).filter(e=>e!==material);
  const pose=document.createElement('section');pose.id='poseInspector';pose.className='inspector-page';
  const exporting=document.createElement('section');exporting.id='exportInspector';exporting.className='inspector-page hidden';
  for(const el of sections){
    if(el.textContent.includes('EXPORTAR PARA O JOGO'))exporting.append(el);
    else pose.append(el);
  }
  scroll.prepend(pose);scroll.append(exporting);
  setInspectorTab('pose');
}
function refreshOutlinerButtons(){
  document.querySelectorAll('[data-outliner]').forEach(b=>b.classList.toggle('active',b.dataset.outliner===state.outlinerMode));
  $('boneSearch').placeholder=state.outlinerMode==='meshes'?'Buscar malha…':'Buscar osso…';
}
function renderMeshOutliner(){
  const host=$('boneTree');const search=$('boneSearch').value.trim().toLowerCase();
  const meshes=allModelMeshes();
  for(const [i,mesh] of meshes.entries()){
    const name=mesh.name||`Mesh_${i+1}`;if(search&&!name.toLowerCase().includes(search))continue;
    const row=document.createElement('button');row.type='button';
    row.className='bone-row mesh-row'+(state.selectedMesh===mesh?' selected':'');
    row.style.width='100%';row.style.border='0';row.style.textAlign='left';
    const ico=document.createElement('span');ico.className='bone-ic';ico.textContent='▧';
    const label=document.createElement('span');label.textContent=name;
    row.append(ico,label);row.title=`${name} · ${mesh.geometry?.attributes?.position?.count||0} vértices`;
    row.onclick=()=>selectMesh(mesh);host.append(row);
  }
  if(!host.children.length)host.textContent='Nenhuma malha encontrada.';
}
function selectMesh(mesh){
  sgClearMaterialPreview();
  if(!mesh)return;
  state.selectedMesh=mesh;state.selectedMaterialSlot=0;
  if(state.workspaceMode!=='shading')setWorkspace('shading');
  else{setInspectorTab('materials');renderBoneTree();refreshMaterials();}
  status(`Malha: ${mesh.name||mesh.uuid}. Escolha um material ou uma textura.`);
}
function getPreviewTextureInfo(){return activeMaterialData()?.[$('textureChannel').value]||null;}
function materialPreviewInfo(){
  const mat=activeMaterial();if(!mat)return;
  const mColor=mat.color?.getHexString()||'ffffff';
  $('materialSwatch').style.backgroundColor='#'+mColor;
  const tex=state.selectedMesh?.userData?.sgTextureInfo?.[state.selectedMaterialSlot]?.map;
  $('materialSwatch').style.backgroundImage=tex?.dataUrl?`url("${tex.dataUrl}")`:'none';
  $('materialActiveName').textContent=mat.name||'Material';
}
function refreshMaterials(){
  const mesh=state.selectedMesh;
  const slots=$('materialSlots');slots.replaceChildren();
  $('selectedMeshName').textContent=mesh?(mesh.name||'Malha sem nome'):'Escolha uma malha';
  const uv=!!mesh?.geometry?.attributes?.uv;
  $('meshUVStatus').textContent=mesh?`${mesh.geometry?.attributes?.position?.count||0} vértices · ${uv?'UV disponível ✓':'Sem coordenadas UV ⚠'}`:'Selecione cabelo, rosto ou uniforme no modelo.';
  $('meshUVStatus').classList.toggle('uv-warning',Boolean(mesh&&!uv));
  $('textureUVHint').textContent=uv?'Coordenadas UV detectadas. Ajuste a repetição se necessário.':'⚠ Sem UV: a textura pode não aparecer corretamente. Prepare o UV no Blender.';
  const materials=meshMaterials(mesh);
  const meshPicker=$('materialMeshSelect');
  // Visível no celular: não é necessário abrir a lista de objetos escondida.
  const all=allModelMeshes(),currentPath=mesh?meshPath(mesh):'';
  meshPicker.replaceChildren();
  if(!all.length){const opt=new Option('Nenhuma malha disponível','');meshPicker.add(opt);meshPicker.disabled=true;}
  else{meshPicker.disabled=false;all.forEach((m,i)=>meshPicker.add(new Option(`${m.name||`Malha ${i+1}`}${m.geometry?.attributes?.uv?' · UV ✓':' · sem UV'}`,meshPath(m))));meshPicker.value=currentPath;}
  $('materialCount').textContent=materials.length;
  $('duplicateMaterialBtn').disabled=!activeMaterial();
  $('materialProperties').classList.toggle('hidden',!materials.length);
  materials.forEach((mat,i)=>{
    const b=document.createElement('button');b.type='button';b.className='material-slot'+(i===state.selectedMaterialSlot?' active':'');
    const swatch=document.createElement('i');swatch.className='slot-dot';swatch.style.backgroundColor='#'+(mat?.color?.getHexString()||'ffffff');
    const label=document.createElement('span');label.className='slot-label';label.textContent=mat?.name||`Material ${i+1}`;
    const counts=sgFaceCounts(mesh).counts; const suffix=document.createElement('small'); suffix.className='sg-slot-faces'; suffix.textContent=`${counts[i]||0} faces`;
    b.append(swatch,label,suffix);b.onclick=()=>{sgClearMaterialPreview();state.selectedMaterialSlot=i;refreshMaterials();};slots.append(b);
  });
  if(!materials.length){const empty=document.createElement('div');empty.className='mat-empty';empty.textContent='A malha não possui material.';slots.append(empty);return;}
  const mat=activeMaterial();
  if(!mat){$('materialProperties').classList.add('hidden');return;}
  $('materialName').value=mat.name||'Material';
  $('materialColor').value='#'+(mat.color?.getHexString()||'ffffff');
  for(const [input,valField,prop,defaultValue] of [['materialRoughness','roughnessValue','roughness',.7],['materialMetalness','metalnessValue','metalness',0],['materialOpacity','opacityValue','opacity',1]]){
    const value=typeof mat[prop]==='number'?mat[prop]:defaultValue;$(input).value=String(value);$(valField).textContent=value.toFixed(2);
  }
  $('materialDoubleSide').checked=mat.side===THREE.DoubleSide;
  $('materialWireframe').checked=!!mat.wireframe;
  materialPreviewInfo();refreshTexturePreview();sgRefreshFaceUI();
}
function refreshTexturePreview(){
  const mat=activeMaterial();const channel=$('textureChannel').value;
  const info=getPreviewTextureInfo();const tex=mat?.[channel];
  const thumbnail=$('textureThumbnail');const show=Boolean(info?.dataUrl);
  thumbnail.hidden=!show;thumbnail.src=show?info.dataUrl:'';
  $('texturePlaceholder').hidden=show;
  $('textureName').textContent=info?.filename|| (tex?'Textura original do FBX (sem arquivo separado)':'Nenhuma textura neste canal');
  $('textureRepeatU').value=tex?String(Number(tex.repeat.x.toFixed(2))):'1';
  $('textureRepeatV').value=tex?String(Number(tex.repeat.y.toFixed(2))):'1';
  $('textureFlipY').checked=tex?tex.flipY:true;
}
async function makeTexture(dataUrl, channel, previous){
  return await new Promise((resolve,reject)=>{
    new THREE.TextureLoader().load(dataUrl, texture=>{
      texture.colorSpace=['map','emissiveMap'].includes(channel)?THREE.SRGBColorSpace:THREE.NoColorSpace;
      texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
      if(previous){texture.repeat.copy(previous.repeat);texture.offset.copy(previous.offset);texture.flipY=previous.flipY;}
      texture.needsUpdate=true;resolve(texture);
    },undefined,()=>reject(new Error('Não foi possível carregar a imagem.')));
  });
}
function readImageDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Falha ao ler imagem.'));reader.readAsDataURL(file);
  });
}
async function applyTextureFile(file){
  if(!defaultMeshSelection()){setWorkspace('shading');toast('Importe um FBX com malha antes de aplicar a textura.',true);return;}
  const types=['image/png','image/jpeg','image/webp'];
  if(!types.includes(file?.type)&& !/\.(png|jpg|jpeg|webp)$/i.test(file?.name||'')){toast('Formato inválido. Use PNG, JPG ou WebP.',true);return;}
  if(file.size>8*1024*1024){toast('Imagem acima de 8 MB. Reduza antes de importar para não travar o celular.',true);return;}
  const selectedMesh=state.selectedMesh,selectedSlot=state.selectedMaterialSlot,channel=$('textureChannel').value;
  try{
    loading(true,'Carregando textura…',file.name);
    const dataUrl=await readImageDataUrl(file);
    const original=activeMaterial()?.[channel];
    const texture=await makeTexture(dataUrl,channel,original);
    if(state.selectedMesh!==selectedMesh||state.selectedMaterialSlot!==selectedSlot){texture.dispose();throw new Error('A seleção mudou durante a importação. Tente novamente.');}
    if(!activeMaterial())createNewMaterial({silent:true});
    const mat=cloneWritableMaterial();if(!mat)throw new Error('Não foi possível atribuir material à malha.');
    // Mat shared textures untouched. Loaded images only belong to this material instance.
    mat[channel]=texture;
    if(channel==='alphaMap')mat.transparent=true;
    if(channel==='emissiveMap'&&mat.emissive.getHex()===0)mat.emissive.set('#ffffff');
    mat.needsUpdate=true;
    const info=activeMaterialData();info[channel]={filename:file.name,dataUrl};
    refreshMaterials();toast(`${file.name} aplicada em ${selectedMesh.name||'malha'} (${channel}).`);
  }catch(e){console.error(e);toast(e.message,true);}
  finally{loading(false);}
}
function clearActiveTexture(){
  const mat=cloneWritableMaterial();if(!mat)return;
  const channel=$('textureChannel').value;
  const old=mat[channel];mat[channel]=null;
  if(old && activeMaterialData()?.[channel]?.dataUrl)old.dispose();
  activeMaterialData()[channel]={removed:true};
  mat.needsUpdate=true;refreshMaterials();toast('Textura removida do canal selecionado.');
}
function updateTextureSettings(){
  const channel=$('textureChannel').value;const mat=cloneWritableMaterial();
  if(!mat?.[channel])return;
  let t=mat[channel];
  // Duplicar para que repetição/flip de um material não altere outra peça.
  t=t.clone();t.needsUpdate=true;mat[channel]=t;
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.repeat.set(clamp(Number($('textureRepeatU').value)||1,.01,32),clamp(Number($('textureRepeatV').value)||1,.01,32));
  t.flipY=$('textureFlipY').checked;t.needsUpdate=true;mat.needsUpdate=true;
  const info=activeMaterialData();if(info[channel]){info[channel].repeat=[t.repeat.x,t.repeat.y];info[channel].flipY=t.flipY;}
}
function serializeMaterials(){
  sgClearMaterialPreview();
  const out=[];
  for(const mesh of allModelMeshes()){
    const edited=mesh.userData.sgEditedSlots;
    if(!edited)continue;
    for(const slotKey of Object.keys(edited)){
      const slot=Number(slotKey),mat=meshMaterials(mesh)[slot];if(!mat)continue;
      const data=mesh.userData.sgTextureInfo?.[slot]||{};
      out.push({meshPath:meshPath(mesh),slot,props:{name:mat.name||'Material',color:'#'+(mat.color?.getHexString()||'ffffff'),roughness:mat.roughness,metalness:mat.metalness,opacity:mat.opacity,side:mat.side,wireframe:mat.wireframe},textures:data});
    }
  }
  return out;
}
async function restoreMaterials(materials){
  let count=0;
  for(const entry of materials.slice(0,1000)){
    const mesh=meshForPath(entry.meshPath);if(!mesh)continue;
    const slot=Math.floor(Number(entry.slot));if(slot<0||slot>Math.max(meshMaterials(mesh).length-1,0))continue;
    state.selectedMesh=mesh;state.selectedMaterialSlot=slot;
    if(!activeMaterial())createNewMaterial({silent:true});
    const mat=cloneWritableMaterial();if(!mat)continue;
    const p=entry.props||{};
    if(typeof p.name==='string')mat.name=p.name.slice(0,90);
    if(/^#[0-9a-f]{6}$/i.test(p.color))mat.color.set(p.color);
    for(const prop of ['roughness','metalness','opacity'])if(Number.isFinite(p[prop]))mat[prop]=clamp(p[prop],0,1);
    if(p.side===THREE.DoubleSide||p.side===THREE.FrontSide)mat.side=p.side;
    mat.transparent=mat.opacity<.999;
    mat.wireframe=Boolean(p.wireframe);mat.needsUpdate=true;
    for(const [channel,info] of Object.entries(entry.textures||{})){
      if(!['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap'].includes(channel))continue;
      if(info?.removed){mat[channel]=null;mat.needsUpdate=true;activeMaterialData()[channel]={removed:true};continue;}
      if(typeof info?.dataUrl!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(info.dataUrl)||info.dataUrl.length>12000000)continue;
      try{
        const tex=await makeTexture(info.dataUrl,channel,mat[channel]);
        if(Array.isArray(info.repeat))tex.repeat.set(clamp(Number(info.repeat[0])||1,.01,32),clamp(Number(info.repeat[1])||1,.01,32));
        if(typeof info.flipY==='boolean')tex.flipY=info.flipY;tex.needsUpdate=true;
        mat[channel]=tex;activeMaterialData()[channel]=info;
      }catch(err){console.warn('Textura não restaurada:',err);}
    }
    count++;
  }
  state.selectedMesh=visibleModelMeshes()[0]||null;state.selectedMaterialSlot=0;
  refreshMaterials();renderBoneTree();
  if(count)status(`${count} materiais do projeto foram restaurados.`);
}
function wireShading(){
  setupInspectorPages();
  document.querySelectorAll('[data-workspace]').forEach(b=>b.onclick=()=>setWorkspace(b.dataset.workspace));
  document.querySelectorAll('[data-inspector-tab]').forEach(b=>b.onclick=()=>setInspectorTab(b.dataset.inspectorTab));
  document.querySelectorAll('[data-outliner]').forEach(b=>b.onclick=()=>{
    state.outlinerMode=b.dataset.outliner;refreshOutlinerButtons();renderBoneTree();
  });
  $('materialFindBtn').onclick=()=>{
    setWorkspace('shading');const meshes=allModelMeshes();if(!meshes.length)return;
    const i=meshes.indexOf(state.selectedMesh);selectMesh(meshes[(i+1)%meshes.length]);
  };
  $('materialMeshSelect').onchange=e=>{const mesh=meshForPath(e.target.value);if(mesh)selectMesh(mesh);};
  $('newMaterialBtn').onclick=()=>createNewMaterial();
  $('duplicateMaterialBtn').onclick=()=>createNewMaterial({duplicate:true});
  $('textureChannel').onchange=refreshTexturePreview;
  $('pickTextureBtn').onclick=()=>{
    if(!defaultMeshSelection()){toast('Importe um personagem FBX primeiro.',true);return;}
    $('textureInput').click();
  };
  $('textureInput').onchange=async evt=>{const f=evt.target.files?.[0];if(f)await applyTextureFile(f);evt.target.value='';};
  $('clearTextureBtn').onclick=clearActiveTexture;
  $('materialName').onchange=e=>{const mat=cloneWritableMaterial();if(mat){mat.name=e.target.value.trim()||'Material';refreshMaterials();}};
  $('materialColor').oninput=e=>{const mat=cloneWritableMaterial();if(mat){mat.color.set(e.target.value);materialPreviewInfo();}};
  for(const [id,prop,val] of [['materialRoughness','roughness','roughnessValue'],['materialMetalness','metalness','metalnessValue'],['materialOpacity','opacity','opacityValue']]){
    $(id).oninput=e=>{const mat=cloneWritableMaterial();if(!mat)return;const v=clamp(Number(e.target.value),0,1);
      mat[prop]=v;if(prop==='opacity'){mat.transparent=v<.999;mat.needsUpdate=true;}
      $(val).textContent=v.toFixed(2);
    };
  }
  $('materialDoubleSide').onchange=e=>{const mat=cloneWritableMaterial();if(mat){mat.side=e.target.checked?THREE.DoubleSide:THREE.FrontSide;mat.needsUpdate=true;}};
  $('materialWireframe').onchange=e=>{const mat=cloneWritableMaterial();if(mat){mat.wireframe=e.target.checked;mat.needsUpdate=true;}};
  for(const id of ['textureRepeatU','textureRepeatV','textureFlipY'])$(id).onchange=updateTextureSettings;
  refreshOutlinerButtons();
}

function wire(){
  $('importBtn').onclick=()=>$('fbxInput').click();
  $('quickImportBtn').onclick=()=>$('fbxInput').click();
  $('quickSaveBtn').onclick=saveProject;
  $('fbxInput').onchange=async(evt)=>{const f=evt.target.files?.[0];evt.target.value='';if(f)await sgLoadFBX(f);};
  $('saveBtn').onclick=saveProject;
  $('openProjectBtn').onclick=()=>$('projectInput').click();
  $('projectInput').onchange=async(evt)=>{const f=evt.target.files?.[0];evt.target.value='';if(f)await sgLoadProjectFile(f);};
  $('helpBtn').onclick=()=>$('helpDialog').showModal();
  $('closeHelpBtn').onclick=$('gotItBtn').onclick=()=>$('helpDialog').close();
  $('boneSearch').oninput=renderBoneTree;
  $('expandBonesBtn').onclick=()=>{$('boneSearch').value='';renderBoneTree();};
  $('rotateBtn').onclick=()=>changeMode('rotate');$('moveBtn').onclick=()=>changeMode('translate');
  $('rigBtn').onclick=()=>{state.rigVisible=!state.rigVisible;$('rigBtn').classList.toggle('active',state.rigVisible);for(const h of state.handles)h.visible=state.rigVisible;if(state.skeletonHelper)state.skeletonHelper.visible=state.rigVisible;rigRefreshUI();};
  $('gridBtn').onclick=()=>{state.gridVisible=!state.gridVisible;grid.visible=state.gridVisible;$('gridBtn').classList.toggle('active',state.gridVisible);};
  $('resetCameraBtn').onclick=frameModel;
  $('viewportMaterialBtn').onclick=()=>setWorkspace('shading');
  for(const key of ['rx','ry','rz','px','py','pz']) {
    $(key).addEventListener('change',()=>{
      const bone=state.selected;if(!bone)return;
      const value=Number($(key).value);if(!Number.isFinite(value))return;
      if(key[0]==='r'){
        const e=new THREE.Euler().setFromQuaternion(bone.quaternion,'XYZ');e['xyz'['rx ry rz'.split(' ').indexOf(key)]]=rad(value);bone.quaternion.setFromEuler(e);
      }else bone.position['xyz'['px py pz'.split(' ').indexOf(key)]]=value;
      bone.updateMatrixWorld(true);
      if(skirtAssist.enabled && /^(leftupleg|rightupleg)$/.test(rigPartName(bone)))skirtApply();
      syncFields();status(`Alteração em ${bone.name}. Pressione K para registrar.`);
    });
  }
  $('keyframeSideBtn').onclick=$('addKeyBtn').onclick=()=>keyframe();
  $('resetBoneBtn').onclick=()=>{if(!state.selected)return;applyTransform(state.selected,state.rest.get(state.selected.userData.sgId));syncFields();status('Osso restaurado. Pressione K para registrar essa pose.');};
  $('clipSelect').onchange=(evt)=>{state.playing=false;state.clipIndex=Number(evt.target.value);updateClipSelectors();renderTimeline();seek(0);};
  $('newClipBtn').onclick=()=>{const name=prompt('Nome da nova animação (ex.: f02_talking_00):',`animation_${String(state.clips.length+1).padStart(2,'0')}`);if(name===null)return;
    const clean=tidy(name.trim());if(!clean){toast('Informe um nome de animação.',true);return;}
    state.clips.push(makeClip(clean));state.clipIndex=state.clips.length-1;state.playing=false;updateClipSelectors();renderTimeline();seek(0);toast(`Nova animação “${clean}” criada.`);
  };
  $('durationInput').onchange=(evt)=>{const d=clamp(Number(evt.target.value)||3,.1,120);currentClip().duration=d;
    for(const frames of Object.values(currentClip().tracks))for(const f of frames)f.time=Math.min(f.time,d);
    for(const frames of Object.values(currentClip().tracks))frames.sort((a,b)=>a.time-b.time);
    evt.target.value=d;seek(state.time);renderTimeline();};
  $('fpsInput').onchange=(evt)=>{currentClip().fps=Number(evt.target.value);};
  $('loadOriginalBtn').onclick=importOriginalClip;
  $('exportGlbBtn').onclick=exportGlb;$('exportFbxBtn').onclick=exportFbx;
  $('loopBtn').onclick=()=>{state.loop=!state.loop;$('loopBtn').classList.toggle('active',state.loop);};
  $('playBtn').onclick=togglePlay;
  $('firstFrameBtn').onclick=()=>{state.playing=false;$('playBtn').textContent='▶';seek(0);};
  $('lastFrameBtn').onclick=()=>{state.playing=false;$('playBtn').textContent='▶';seek(currentClip().duration);};
  $('prevFrameBtn').onclick=()=>{state.playing=false;$('playBtn').textContent='▶';seek(state.time-1/currentClip().fps);};
  $('nextFrameBtn').onclick=()=>{state.playing=false;$('playBtn').textContent='▶';seek(state.time+1/currentClip().fps);};
  $('timelineRuler').addEventListener('click',(evt)=>{state.playing=false;const rect=$('timelineRuler').getBoundingClientRect();seek((evt.clientX-rect.left)/rect.width*currentClip().duration);});
  renderer.domElement.addEventListener('pointerdown',(evt)=>{
    if(evt.button!==0||transform.dragging)return;
    if(state.workspaceMode==='shading'||state.outlinerMode==='meshes'){
      const rect=renderer.domElement.getBoundingClientRect();pointer.x=(evt.clientX-rect.left)/rect.width*2-1;pointer.y=-(evt.clientY-rect.top)/rect.height*2+1;
      raycaster.setFromCamera(pointer,camera);
      const hits=raycaster.intersectObjects(visibleModelMeshes(),false);
      if(hits.length){sgSelectMaterialSlotFromHit(hits[0].object,hits[0].faceIndex);return;}
    }
    if(!state.rigVisible)return;
    const rect=renderer.domElement.getBoundingClientRect();pointer.x=(evt.clientX-rect.left)/rect.width*2-1;pointer.y=-(evt.clientY-rect.top)/rect.height*2+1;
    raycaster.setFromCamera(pointer,camera);
    if(rigAssist.enabled){
      const goals=rigAssist.chains.flatMap(c=>[c.goal,c.pole]).filter(m=>m.visible);
      const hit=raycaster.intersectObjects(goals,false)[0];
      if(hit){rigSelect(hit.object.userData.rigChain,hit.object.userData.sgIk);return;}
    }
    const hits=raycaster.intersectObjects(state.handles.filter(h=>h.visible),false);
    if(hits.length)selectBone(hits[0].object.userData.bone);
  });
  document.addEventListener('keydown',(evt)=>{
    if(evt.target instanceof HTMLInputElement||evt.target instanceof HTMLSelectElement||evt.target instanceof HTMLTextAreaElement||$('helpDialog').open)return;
    if(evt.ctrlKey||evt.metaKey||evt.altKey)return;
    if(evt.code==='Space'){evt.preventDefault();togglePlay();}
    else if(evt.key.toLowerCase()==='k'){evt.preventDefault();keyframe();}
    else if(evt.key.toLowerCase()==='r')changeMode('rotate');
    else if(evt.key.toLowerCase()==='g')changeMode('translate');
  });
  const dz=$('dropZone');
  document.addEventListener('dragenter',(evt)=>{if(evt.dataTransfer?.types?.includes('Files')){evt.preventDefault();dz.classList.remove('hidden');}});
  document.addEventListener('dragover',(evt)=>{if(evt.dataTransfer?.types?.includes('Files'))evt.preventDefault();});
  document.addEventListener('dragleave',(evt)=>{if(!evt.relatedTarget||evt.relatedTarget===document.documentElement)dz.classList.add('hidden');});
  document.addEventListener('drop',(evt)=>{
    evt.preventDefault();dz.classList.add('hidden');const f=evt.dataTransfer?.files?.[0];
    if(f){if(f.name.toLowerCase().endsWith('.fbx'))importFBX(f);else if(f.name.toLowerCase().endsWith('.json'))openProject(f);else if(/^image\/(png|jpeg|webp)$/.test(f.type))applyTextureFile(f);else toast('Solte um FBX, JSON ou imagem PNG/JPG/WebP.',true);}
  });
}
function syncDesktopWorkbench(){
  const modelName=$('modelName')?.textContent?.trim()||'—';
  const selected=$('selectedName')?.textContent?.trim()||'None';
  const clip=$('timelineClipName')?.textContent?.trim()||'—';
  const statusLabel=$('statusText')?.textContent?.trim()||'Ready';
  const activeWorkspace=document.querySelector('.workspace-tab.active')?.dataset.workspace||'animation';
  const workspaceLabel=activeWorkspace.charAt(0).toUpperCase()+activeWorkspace.slice(1);
  if($('pcModelChip')) $('pcModelChip').textContent=modelName;
  if($('pcSelectedChip')) $('pcSelectedChip').textContent=selected;
  if($('pcClipChip')) $('pcClipChip').textContent=clip;
  if($('pcFooterStatus')) $('pcFooterStatus').textContent=statusLabel;
  if($('pcFooterSelected')) $('pcFooterSelected').textContent=selected;
  if($('pcFooterClip')) $('pcFooterClip').textContent=clip;
  if($('pcFooterWorkspace')) $('pcFooterWorkspace').textContent=workspaceLabel;
}
function wireDesktopWorkbench(){
  if(!$('pcImportBtn')) return;
  $('pcImportBtn').onclick=()=>$('importBtn')?.click();
  $('pcOpenProjectBtn').onclick=()=>$('openProjectBtn')?.click();
  $('pcSaveBtn').onclick=()=>$('saveBtn')?.click();
  $('pcAnimationBtn').onclick=()=>{setWorkspace('animation');setInspectorTab('pose');syncDesktopWorkbench();};
  $('pcShadingBtn').onclick=()=>{setWorkspace('shading');setInspectorTab('materials');syncDesktopWorkbench();};
  $('pcFrameBtn').onclick=()=>{frameModel();syncDesktopWorkbench();};
  $('pcKeyBtn').onclick=()=>$('addKeyBtn')?.click();
  $('pcCreateMaterialBtn').onclick=()=>{setWorkspace('shading');setInspectorTab('materials');$('newMaterialBtn')?.click();syncDesktopWorkbench();};
  for(const id of ['statusText','selectedName','timelineClipName','modelName']){
    const el=$(id); if(el) new MutationObserver(syncDesktopWorkbench).observe(el,{characterData:true,childList:true,subtree:true});
  }
  for(const btn of document.querySelectorAll('.workspace-tab')) btn.addEventListener('click',()=>requestAnimationFrame(syncDesktopWorkbench));
  syncDesktopWorkbench();
}

// ===================== ALPHA 0.9: WORKSPACE + MATERIAL FACE VIEW =====================
// Virtual material highlights never modify geometry, UV, bind matrices or skin weights.
const sgAppState={screen:'menu',dirty:false,preview:null,pendingProject:null,zoomDragging:false,zoomY:0};
let sgSettings={compact:false,showGrid:true,zoomSensitivity:1};
try{sgSettings={...sgSettings,...JSON.parse(localStorage.getItem('sg-motion-settings-v09')||'{}')};}catch{}
function sgMarkDirty(){
  if(sgAppState.screen!=='editor')return;
  sgAppState.dirty=true;
  sgRefreshDirty();
}
function sgSetClean(){sgAppState.dirty=false;sgRefreshDirty();}
function sgRefreshDirty(){
  const label=$('sgDirtyLabel');if(label)label.textContent=sgAppState.dirty?'● Alterações não salvas':'✓ Projeto salvo';
  document.title=(sgAppState.dirty?'● ':'')+'Silent Garden Motion Studio — Alpha 0.9';
}
function sgEnterEditor(){
  sgAppState.screen='editor';$('sgMainMenu').classList.add('sg-hidden');
  requestAnimationFrame(()=>{updateSize();orbit.update();sgRefreshDirty();});
}
function sgShowMenu(){
  if(sgAppState.screen==='editor'&&sgAppState.dirty&&!confirm('Você tem alterações não salvas. Voltar ao menu sem salvar?'))return;
  state.playing=false;
  sgClearMaterialPreview();sgAppState.screen='menu';$('sgMainMenu').classList.remove('sg-hidden');
  sgRefreshRecent();
}
function sgNewProject(){
  if(sgAppState.screen==='editor'&&sgAppState.dirty&&!confirm('Descartar alterações não salvas e criar um novo projeto?'))return;
  sgClearMaterialPreview();installModel(createDemoModel(),null,true);sgSetClean();sgEnterEditor();
  toast('Novo projeto criado. Importe o FBX para começar.');
}
function sgOpenProjectFromMenu(){$('projectInput').click();}
function sgDatabase(){
  return new Promise((resolve,reject)=>{
    if(!indexedDB){reject(Error('Armazenamento local indisponível'));return;}
    const request=indexedDB.open('SilentGardenMotionStudio-v09',1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('projects'))db.createObjectStore('projects',{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
async function sgReadRecents(){
  try{const db=await sgDatabase();return await new Promise((resolve,reject)=>{
    const tx=db.transaction('projects','readonly'),req=tx.objectStore('projects').getAll();
    req.onsuccess=()=>resolve(req.result.sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,8));
    req.onerror=()=>reject(req.error);
    tx.oncomplete=()=>db.close();
  });}catch(e){console.warn('Recent projects unavailable',e);return [];}
}
async function sgRememberProject(json){
  try{
    const p=JSON.parse(json),db=await sgDatabase();const id=String(p.modelFilename||'demo')+':'+String(p.clips?.[p.clipIndex||0]?.name||'animation');
    const tx=db.transaction('projects','readwrite'),store=tx.objectStore('projects');
    store.put({id,modelFilename:p.modelFilename||null,clipName:p.clips?.[p.clipIndex||0]?.name||'animation',updatedAt:Date.now(),json});
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  }catch(e){console.warn('Snapshot recente não salvo:',e);}
}
async function sgRefreshRecent(){
  const host=$('sgRecentList');if(!host)return;host.replaceChildren();
  const rows=await sgReadRecents();if(!rows.length){
    const empty=document.createElement('div');empty.className='sg-empty-recent';
    const icon=document.createElement('span');icon.textContent='◇';const strong=document.createElement('strong');strong.textContent='Nenhum projeto recente';
    const note=document.createElement('small');note.textContent='Seus projetos salvos aparecerão aqui. Para um projeto FBX, guarde também o modelo original.';
    empty.append(icon,strong,note);host.append(empty);return;
  }
  for(const record of rows){
    const row=document.createElement('button');row.type='button';row.className='sg-recent-item';
    const icon=document.createElement('span');icon.className='sg-recent-icon';icon.textContent='▧';
    const info=document.createElement('div');info.className='sg-recent-content';
    const name=document.createElement('strong');name.textContent=record.modelFilename||'Projeto de demonstração';
    const detail=document.createElement('small');detail.textContent=`${record.clipName} · ${new Date(record.updatedAt).toLocaleString('pt-BR')}`;
    const arrow=document.createElement('span');arrow.className='sg-recent-arrow';arrow.textContent='›';
    info.append(name,detail);row.append(icon,info,arrow);row.onclick=()=>sgRestoreRecent(record);host.append(row);
  }
}
async function sgRestoreRecent(record){
  if(sgAppState.screen==='editor'&&sgAppState.dirty&&!confirm('Substituir o projeto atual e perder alterações não salvas?'))return;
  await sgLoadProjectJSON(record.json);
}
async function sgLoadProjectFile(file){
  if(!file)return;
  try{await sgLoadProjectJSON(await file.text());}catch(e){toast('Arquivo de projeto inválido: '+e.message,true);}
}
async function sgLoadProjectJSON(json){
  let p;
  try{p=JSON.parse(json);if(p.app!=='SilentGardenMotionStudio'||!Array.isArray(p.clips))throw Error('Projeto inválido');}
  catch(e){toast('Não foi possível ler o projeto: '+e.message,true);return;}
  if(p.modelFilename && state.modelFilename!==p.modelFilename){
    sgAppState.pendingProject={json,filename:p.modelFilename};
    toast('Para abrir este projeto, selecione primeiro o modelo original: '+p.modelFilename);
    $('fbxInput').click();return;
  }
  const success=await openProject(new File([json],'project.sgmotion.json',{type:'application/json'}));
  if(success){sgSetClean();sgEnterEditor();}
}
async function sgLoadFBX(file){
  if(!file)return;
  sgClearMaterialPreview();await importFBX(file);
  if(state.modelFilename!==file.name)return;
  sgEnterEditor();
  const pending=sgAppState.pendingProject;
  if(pending){sgAppState.pendingProject=null;if(file.name===pending.filename){
    const success=await openProject(new File([pending.json],'recent.sgmotion.json',{type:'application/json'}));
    if(success){sgSetClean();toast('Modelo e projeto recente restaurados.');return;}
  } else toast('O FBX selecionado não corresponde ao projeto: '+pending.filename,true);}
  sgMarkDirty();sgFocusAll();
}
function sgApplySettings(){
  document.body.classList.toggle('sg-compact-ui',Boolean(sgSettings.compact));
  grid.visible=Boolean(sgSettings.showGrid);
  state.gridVisible=Boolean(sgSettings.showGrid);
  $('gridBtn').classList.toggle('active',Boolean(sgSettings.showGrid));
  if($('sgSettingCompact'))$('sgSettingCompact').checked=Boolean(sgSettings.compact);
  if($('sgSettingGrid'))$('sgSettingGrid').checked=Boolean(sgSettings.showGrid);
  if($('sgSettingZoom'))$('sgSettingZoom').value=String(sgSettings.zoomSensitivity||1);
}
function sgOpenSettings(){sgApplySettings();$('sgSettingsDialog').showModal();}
function sgPersistSettings(){try{localStorage.setItem('sg-motion-settings-v09',JSON.stringify(sgSettings));}catch{}sgApplySettings();}
// Bounding-box fit with a camera-oriented sphere avoids clipping on wide, tiny or enormous FBX assets.
function sgCameraFrame(box,padding=1.22){
  if(!box||box.isEmpty())return;
  const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const radius=Math.max(size.length()*.5,1e-5);
  const fovY=THREE.MathUtils.degToRad(camera.fov),fovX=2*Math.atan(Math.tan(fovY/2)*Math.max(.15,camera.aspect));
  const halfFov=Math.max(.075,Math.min(fovX,fovY)*.5);
  const dist=radius/Math.sin(halfFov)*padding;
  const offset=camera.position.clone().sub(orbit.target);
  if(offset.lengthSq()<1e-12)offset.set(.35,.12,1);
  offset.normalize();orbit.target.copy(center);camera.position.copy(center).addScaledVector(offset,dist);
  camera.near=Math.max(0.000001,radius*.00008);
  camera.far=Math.max(radius*1100,dist*300,camera.near*1000);
  orbit.minDistance=Math.max(radius*.00015,.000001);
  orbit.maxDistance=Math.max(dist*200,radius*1000);
  camera.updateProjectionMatrix();orbit.update();
}
function sgFocusAll(){
  if(!state.model)return;
  const bounds=getVisibleCharacterBounds(state.model);
  if(bounds.isEmpty())return;
  sgCameraFrame(bounds,matchMedia('(max-width:790px)').matches?1.38:1.19);
  status('Modelo inteiro enquadrado. Home = enquadrar novamente.');
}
function sgFocusSelection(){
  let box=null;
  if(state.workspaceMode==='shading'&&state.selectedMesh){box=new THREE.Box3().setFromObject(state.selectedMesh);}
  else if(rigAssist?.control){const p=rigAssist.control.getWorldPosition(Vec());const radius=Math.max((pendingBounds?.height||1.9)*.065,.01);box=new THREE.Box3(p.clone().addScalar(-radius),p.clone().addScalar(radius));}
  else if(state.selected){
    const bone=state.selected,p=bone.getWorldPosition(Vec());let radius=Math.max((pendingBounds?.height||1.9)*.085,.015);
    for(const child of bone.children||[]){if(child.isBone)radius=Math.max(radius,p.distanceTo(child.getWorldPosition(Vec()))*.8);}
    box=new THREE.Box3(p.clone().addScalar(-radius),p.clone().addScalar(radius));
  }
  if(!box||box.isEmpty())return sgFocusAll();
  sgCameraFrame(box,1.8);status('Seleção enquadrada. Tecla F para focar novamente.');
}
function sgZoom(mult){
  if(!Number.isFinite(mult)||mult<=0)return;
  const sensitivity=clamp(Number(sgSettings.zoomSensitivity)||1,.25,3);
  zoomCamera(Math.pow(mult,sensitivity));
}
function sgBindZoomDrag(){
  const canvas=renderer.domElement;
  canvas.addEventListener('pointerdown',evt=>{
    if(sgAppState.screen!=='editor'||!evt.altKey||evt.button!==2)return;
    sgAppState.zoomDragging=true;sgAppState.zoomY=evt.clientY;
    orbit.enabled=false;canvas.setPointerCapture?.(evt.pointerId);
    evt.preventDefault();evt.stopImmediatePropagation();
  },true);
  canvas.addEventListener('pointermove',evt=>{
    if(!sgAppState.zoomDragging)return;
    const dy=evt.clientY-sgAppState.zoomY;sgAppState.zoomY=evt.clientY;
    sgZoom(Math.exp(dy*.012));evt.preventDefault();evt.stopImmediatePropagation();
  },true);
  function end(evt){if(!sgAppState.zoomDragging)return;sgAppState.zoomDragging=false;orbit.enabled=!transform.dragging;evt?.preventDefault?.();}
  canvas.addEventListener('pointerup',end,true);canvas.addEventListener('pointercancel',end,true);window.addEventListener('blur',end);
  canvas.addEventListener('contextmenu',evt=>{if(evt.altKey||sgAppState.zoomDragging)evt.preventDefault();},true);
}
// FBX geometry.groups are per-draw material assignments. Do not infer missing assignments.
function sgFaceCounts(mesh){
  const geom=mesh?.geometry,materials=meshMaterials(mesh),out=materials.map(()=>0);
  if(!geom||!materials.length)return {counts:out,grouped:false,valid:false};
  const total=geom.index?.count||geom.attributes.position?.count||0;
  const groups=geom.groups||[];
  if(groups.length){
    let valid=true;
    for(const group of groups){const index=Math.trunc(group.materialIndex||0);
      if(index>=0&&index<out.length)out[index]+=Math.max(0,Math.floor(group.count/3));
      else valid=false;
    }
    return {counts:out,grouped:true,valid};
  }
  if(out.length===1){out[0]=Math.floor(total/3);return {counts:out,grouped:false,valid:true};}
  return {counts:out,grouped:false,valid:false};
}
function sgSlotForFace(mesh,faceIndex){
  if(!mesh?.geometry||!Number.isFinite(faceIndex))return 0;
  const pos=faceIndex*3,groups=mesh.geometry.groups||[];
  if(!groups.length)return 0;
  for(const group of groups){if(pos>=group.start&&pos<group.start+group.count)return Math.trunc(group.materialIndex||0);}
  return 0;
}
function sgClearMaterialPreview(){
  const view=sgAppState.preview;if(!view)return;
  view.mesh.material=view.original;
  for(const mat of view.temporary)mat?.dispose?.();
  sgAppState.preview=null;
  for(const id of ['sgHighlightFaces','sgIsolateFaces'])$(id)?.classList.remove('active');
}
function sgMaterialPreview(mode){
  sgClearMaterialPreview();const mesh=state.selectedMesh,slot=state.selectedMaterialSlot;
  if(!mesh){toast('Selecione uma malha com material.',true);return;}
  const {counts,valid}=sgFaceCounts(mesh),materials=meshMaterials(mesh);
  if(!valid||!counts[slot]){toast('O FBX não fornece faces atribuídas a esse slot.',true);return;}
  const original=mesh.material,temporary=[];
  const display=materials.map((mat,i)=>{
    if(i===slot)return mat;
    const clone=mat.clone();temporary.push(clone);
    if(mode==='isolate')clone.visible=false;
    else{clone.transparent=true;clone.opacity=.09;clone.depthWrite=false;clone.needsUpdate=true;}
    return clone;
  });
  // With one material, everything belongs to it; no separate faces can be isolated.
  mesh.material=Array.isArray(original)?display:display[0];
  sgAppState.preview={mesh,original,temporary,mode};
  $(mode==='isolate'?'sgIsolateFaces':'sgHighlightFaces')?.classList.add('active');
  status(`${mode==='isolate'?'Isoladas':'Destacadas'} ${counts[slot]} faces de ${materials[slot]?.name||'Material'}. Original intacto.`);
}
function sgRefreshFaceUI(){
  const mesh=state.selectedMesh,stats=sgFaceCounts(mesh),slot=state.selectedMaterialSlot;
  const name=meshMaterials(mesh)[slot]?.name||'Material';
  const label=$('sgFaceSummary');if(label){
    label.textContent=mesh?`${name} · ${stats.counts[slot]||0} faces · ${stats.grouped?'Grupos FBX detectados':'Material único ou sem grupos'}`:'Selecione uma malha para identificar as faces';
  }
  const possible=Boolean(mesh&&stats.valid&&stats.counts[slot]>0&&meshMaterials(mesh).length>1);
  for(const id of ['sgHighlightFaces','sgIsolateFaces'])if($(id))$(id).disabled=!possible;
  if($('sgFaceHint'))$('sgFaceHint').textContent=!mesh?'Selecione uma malha no Outliner.':(!stats.valid?'O FBX não traz atribuições de faces utilizáveis para todos os slots. É necessário definir os grupos no Blender.':meshMaterials(mesh).length===1?'Material único: todas as faces pertencem a esse slot.':'Clique numa face na viewport ou selecione um slot para destacá-lo.');
}
function sgSelectMaterialSlotFromHit(mesh,faceIndex){
  sgClearMaterialPreview();selectMesh(mesh);
  const slot=sgSlotForFace(mesh,faceIndex),materials=meshMaterials(mesh);
  if(slot>=0&&slot<materials.length){state.selectedMaterialSlot=slot;refreshMaterials();}
}
function sgSetupMaterialClicks(){
  const canvas=renderer.domElement;
  // Capturing pointer handler finds the face material before the existing object selector.
  canvas.addEventListener('pointerdown',evt=>{
    if(sgAppState.screen!=='editor'||evt.button!==0||state.workspaceMode!=='shading'||transform.dragging)return;
    const box=canvas.getBoundingClientRect();if(!box.width||!box.height)return;
    pointer.x=(evt.clientX-box.left)/box.width*2-1;pointer.y=-(evt.clientY-box.top)/box.height*2+1;
    raycaster.setFromCamera(pointer,camera);
    const hit=raycaster.intersectObjects(visibleModelMeshes(),false)[0];
    if(hit){sgSelectMaterialSlotFromHit(hit.object,hit.faceIndex);evt.stopImmediatePropagation();}
  },true);
}
function sgWireWorkspace09(){
  $('sgMenuNew').onclick=sgNewProject;$('sgMenuOpen').onclick=sgOpenProjectFromMenu;
  $('sgMenuSettings').onclick=sgOpenSettings;$('sgBackToMenu').onclick=sgShowMenu;
  $('sgSettingsClose').onclick=()=>$('sgSettingsDialog').close();
  $('sgSettingCompact').onchange=e=>{sgSettings.compact=e.target.checked;sgPersistSettings();};
  $('sgSettingGrid').onchange=e=>{sgSettings.showGrid=e.target.checked;sgPersistSettings();};
  $('sgSettingZoom').onchange=e=>{sgSettings.zoomSensitivity=Number(e.target.value);sgPersistSettings();};
  $('sgNavView').onclick=sgFocusAll;
  $('sgNavRig').onclick=()=>{sgEnterEditor();setWorkspace('animation');setInspectorTab('pose');$('rigAssistPanel')?.scrollIntoView({block:'nearest'});};
  $('sgNavAnimation').onclick=()=>setWorkspace('animation');
  $('sgZoomIn').onclick=()=>sgZoom(.75);$('sgZoomOut').onclick=()=>sgZoom(1.33);
  $('sgZoomFocus').onclick=sgFocusSelection;$('sgZoomAll').onclick=sgFocusAll;
  $('sgHighlightFaces').onclick=()=>sgMaterialPreview('highlight');
  $('sgIsolateFaces').onclick=()=>sgMaterialPreview('isolate');
  $('sgRestoreFaces').onclick=()=>{sgClearMaterialPreview();status('Visualização de material restaurada.');};
  sgBindZoomDrag();sgSetupMaterialClicks();sgApplySettings();sgRefreshFaceUI();sgRefreshRecent();
  document.addEventListener('keydown',evt=>{
    if(sgAppState.screen!=='editor'||evt.ctrlKey||evt.metaKey||evt.altKey||
      evt.target instanceof HTMLInputElement||evt.target instanceof HTMLSelectElement||evt.target instanceof HTMLTextAreaElement||
      [...document.querySelectorAll('dialog')].some(d=>d.open))return;
    if(['+','=','NumpadAdd'].includes(evt.key)||evt.code==='NumpadAdd'){evt.preventDefault();sgZoom(.78);}
    else if(['-','NumpadSubtract'].includes(evt.key)||evt.code==='NumpadSubtract'){evt.preventDefault();sgZoom(1.28);}
    else if(evt.key.toLowerCase()==='f'){evt.preventDefault();sgFocusSelection();}
    else if(evt.code==='Home'){evt.preventDefault();sgFocusAll();}
  },true);
  document.addEventListener('input',evt=>{
    if(sgAppState.screen!=='editor')return;
    const e=evt.target;
    if(e?.closest?.('#materialInspector')||e?.closest?.('#rotationFields')||e?.closest?.('#positionFields')||
      ['durationInput','fpsInput','mobileAngle'].includes(e?.id))sgMarkDirty();
  });
  document.addEventListener('change',evt=>{
    if(sgAppState.screen!=='editor')return;
    const e=evt.target;
    if(['durationInput','fpsInput','rigGroundCheck','skirtFollowCheck','skirtStrength','skirtSpread'].includes(e?.id))sgMarkDirty();
  });
  document.addEventListener('click',evt=>{
    if(sgAppState.screen!=='editor')return;
    if(evt.target?.closest?.('#newClipBtn,#mobileNewClipBtn,#rigManualCreateBtn,#skirtKeyframeBtn,#rigKeyframeBtn'))sgMarkDirty();
  });
  document.addEventListener('keydown',evt=>{
    if(sgAppState.screen!=='editor'||!(evt.ctrlKey||evt.metaKey)||evt.altKey)return;
    if(evt.key.toLowerCase()==='s'){evt.preventDefault();saveProject();}
    if(evt.key.toLowerCase()==='o'){evt.preventDefault();$('projectInput').click();}
  },true);
  window.addEventListener('beforeunload',evt=>{if(sgAppState.dirty){evt.preventDefault();evt.returnValue='';}});
  sgSetClean();
}

wireShading();
wire();
wireMobile();
rigWire();
skirtWire();
wireDesktopWorkbench();
sgWireWorkspace09();
installModel(createDemoModel(),null,true);
checkBackend();
requestAnimationFrame(animate);

