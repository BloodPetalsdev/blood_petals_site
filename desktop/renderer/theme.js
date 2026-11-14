/* Silent Garden Motion Studio 1.1 — Studio Themes
   Independent of the 3D engine so Appearance works even when WebGL fails.
   No project data or meshes/materials are changed by this UI-only system. */
(()=>{
  'use strict';
  const KEY='sg-motion-v11-studio-theme';
  const $=(id)=>document.getElementById(id);
  const palettes={
    graphite:{background:'#111319',header:'#17191f',panel:'#20232b',panel2:'#262a33',well:'#171b23',border:'#353a44',text:'#e9edf4',muted:'#9da5b3',accent:'#b597ee',ink:'#1c1825',viewport:'#202630'},
    sakura:{background:'#151118',header:'#1b1620',panel:'#241d27',panel2:'#302533',well:'#1d1720',border:'#49394a',text:'#f3eaf1',muted:'#bba7b9',accent:'#f0a6c6',ink:'#291621',viewport:'#2a2131'},
    pearl:{background:'#eff1f6',header:'#e7ebf2',panel:'#ffffff',panel2:'#e9edf4',well:'#f5f7fb',border:'#c6ccda',text:'#283244',muted:'#6c788a',accent:'#8c6cc5',ink:'#ffffff',viewport:'#ccd3de'},
    midnight:{background:'#0b1220',header:'#101b2b',panel:'#182638',panel2:'#22334a',well:'#111d2c',border:'#344760',text:'#e8effa',muted:'#a2b3c9',accent:'#80b6f6',ink:'#0f2039',viewport:'#1c2c43'}
  };
  const safeColor=(value,fallback)=>typeof value==='string'&&/^#[0-9a-fA-F]{6}$/.test(value)?value:fallback;
  const maxScale=(v)=>[0.9,1,1.1,1.2].includes(Number(v))?Number(v):1;
  const initial={name:'graphite',custom:{accent:'#b597ee',background:'#15171d',panel:'#242730',text:'#eef0f6'},scale:1,followSystem:false};
  let settings={...initial,custom:{...initial.custom}};
  try{
    const saved=JSON.parse(localStorage.getItem(KEY)||'null');
    if(saved&&typeof saved==='object'){
      if(['graphite','sakura','pearl','midnight','custom'].includes(saved.name))settings.name=saved.name;
      for(const k of Object.keys(initial.custom))settings.custom[k]=safeColor(saved.custom?.[k],initial.custom[k]);
      settings.scale=maxScale(saved.scale);
      settings.followSystem=Boolean(saved.followSystem);
    }
  }catch{}
  const systemLight=()=>{try{return window.matchMedia('(prefers-color-scheme: light)').matches}catch{return false}};
  function mix(a,b,ratio){
    const h=(x)=>[1,3,5].map(i=>parseInt(x.slice(i,i+2),16));
    const c=h(a),d=h(b);return '#'+c.map((v,i)=>Math.round(v*(1-ratio)+d[i]*ratio).toString(16).padStart(2,'0')).join('');
  }
  function currentName(){return settings.followSystem?(systemLight()?'pearl':'graphite'):settings.name}
  function currentPalette(){
    const name=currentName();
    if(name!=='custom')return palettes[name];
    const b=settings.custom.background,p=settings.custom.panel,t=settings.custom.text,a=settings.custom.accent;
    const isLight=parseInt(b.slice(1,3),16)*.2126+parseInt(b.slice(3,5),16)*.7152+parseInt(b.slice(5,7),16)*.0722>145;
    const direction=isLight?'#000000':'#ffffff';
    return {background:b,header:mix(b,p,.42),panel:p,panel2:mix(p,direction,isLight?.06:.09),well:mix(b,p,.24),border:mix(p,direction,isLight?.18:.2),text:t,muted:mix(t,p,.46),accent:a,ink:isLight?'#ffffff':'#191320',viewport:mix(b,p,.6)};
  }
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(settings))}catch{}}
  function apply(){
    const effective=currentName(),palette=currentPalette(),html=document.documentElement;
    html.setAttribute('data-sg-theme',effective);
    html.style.setProperty('--sg11-scale',String(settings.scale));
    for(const [key,value] of Object.entries(palette)){
      const name=key==='background'?'bg':key==='ink'?'accent-ink':key;
      html.style.setProperty('--sg11-'+name,value);
    }
    html.style.setProperty('--bg',palette.background);html.style.setProperty('--panel',palette.panel);
    html.style.setProperty('--panel2',palette.panel2);html.style.setProperty('--deep',palette.well);
    html.style.setProperty('--line',palette.border);html.style.setProperty('--text',palette.text);
    html.style.setProperty('--muted',palette.muted);html.style.setProperty('--rose',palette.accent);
    html.style.setProperty('--pink',palette.accent);html.style.setProperty('--bright',palette.accent);
    for(const btn of document.querySelectorAll('[data-sg11-theme]')){
      const selected=settings.name===btn.dataset.sg11Theme&&!settings.followSystem;
      btn.setAttribute('aria-checked',String(selected));
    }
    const custom=$('sg11CustomFields');if(custom)custom.classList.toggle('sg11-visible',settings.name==='custom'&&!settings.followSystem);
    const system=$('sg11FollowSystem');if(system)system.checked=settings.followSystem;
    const scale=$('sg11Scale');if(scale)scale.value=String(settings.scale);
    for(const [field,id] of [['accent','sg11Accent'],['background','sg11Background'],['panel','sg11Panel'],['text','sg11Text']]){
      if($(id)&&$(id).value!==settings.custom[field])$(id).value=settings.custom[field];
    }
    if($('sg11HeaderTheme'))$('sg11HeaderTheme').title='Appearance · '+(settings.followSystem?'Follow system':settings.name);
    document.dispatchEvent(new CustomEvent('sg:themechange',{detail:{name:effective,settings:{...settings}}}));
  }
  function choose(name){if(!palettes[name]&&name!=='custom')return;settings.name=name;settings.followSystem=false;persist();apply()}
  function open(){const dlg=$('sgSettingsDialog');if(!dlg)return;if(!dlg.open)dlg.showModal();$('sg11Appearance')?.scrollIntoView({behavior:'smooth',block:'start'})}
  function wire(){
    for(const btn of document.querySelectorAll('[data-sg11-theme]'))btn.addEventListener('click',()=>choose(btn.dataset.sg11Theme));
    $('sg11HeaderTheme')?.addEventListener('click',open);$('sg11MenuTheme')?.addEventListener('click',open);
    $('sg11ResetTheme')?.addEventListener('click',()=>{settings={...initial,custom:{...initial.custom}};persist();apply()});
    $('sg11FollowSystem')?.addEventListener('change',e=>{settings.followSystem=e.target.checked;persist();apply()});
    $('sg11Scale')?.addEventListener('change',e=>{settings.scale=maxScale(e.target.value);persist();apply()});
    for(const [field,id] of [['accent','sg11Accent'],['background','sg11Background'],['panel','sg11Panel'],['text','sg11Text']])
      $(id)?.addEventListener('input',e=>{settings.custom[field]=safeColor(e.target.value,initial.custom[field]);settings.name='custom';settings.followSystem=false;persist();apply()});
    $('sg11RailMove')?.addEventListener('click',()=>$('moveBtn')?.click());
    $('sg11RailRotate')?.addEventListener('click',()=>$('rotateBtn')?.click());
    $('sg11RailScale')?.addEventListener('click',()=>$('sgScaleBtn')?.click());
    $('sg11RailFrame')?.addEventListener('click',()=>$('resetCameraBtn')?.click());
    $('sg11RailCamera')?.addEventListener('click',()=>document.querySelector('[data-sg-view="front"]')?.click());
    $('sg11RailSelect')?.addEventListener('click',()=>{
      for(const btn of document.querySelectorAll('.sg11-rail-btn'))btn.classList.remove('active');
      $('sg11RailSelect').classList.add('active');
      document.getElementById('statusText')&&(document.getElementById('statusText').textContent='Seleção ativa · clique no osso ou no controlador IK.');
    });
    $('sg11HelpMenu')?.addEventListener('click',()=>$('helpBtn')?.click());
    const sourceTargets=[['moveBtn','sg11RailMove'],['rotateBtn','sg11RailRotate'],['sgScaleBtn','sg11RailScale']];
    const syncTools=()=>{for(const [src,dst] of sourceTargets){$(dst)?.classList.toggle('active',$(src)?.classList.contains('active'));}};
    for(const [src] of sourceTargets)if($(src))new MutationObserver(syncTools).observe($(src),{attributes:true,attributeFilter:['class']});
    syncTools();
    try{window.matchMedia('(prefers-color-scheme: light)').addEventListener('change',()=>{if(settings.followSystem)apply()})}catch{}
    apply();
  }
  window.sgStudioThemes=Object.freeze({get:()=>JSON.parse(JSON.stringify(settings)),set:choose,reset:()=>{$('sg11ResetTheme')?.click()},apply,open});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire,{once:true});else wire();
})();
