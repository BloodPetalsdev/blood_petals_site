/* Silent Garden Motion Studio 0.9.7 — early startup / resilient menu audio.
   Runs independently of the 3D module: audio and diagnostics still work if WebGL fails. */
(()=>{
  'use strict';
  const failures=[];
  let reported=false;
  const $=id=>document.getElementById(id);
  const state={ready:false,errors:failures,
    markReady(){this.ready=true;const problem=$('sgStartupProblem');if(problem)problem.remove();},
    reportError(err){
      const msg=String(err?.message||err||'Erro desconhecido no motor 3D');
      failures.push(msg);
      if(!this.ready)showProblem(msg);
    }
  };
  window.sgStartup=state;
  function showProblem(reason){
    const original=String(reason||failures.at(-1)||'O motor de renderização não iniciou.');
    if(reported&&$('sgStartupProblem')){
      $('sgStartupProblemMessage').textContent=original;return;
    }
    reported=true;
    const alert=document.createElement('section');
    alert.id='sgStartupProblem';
    alert.style.cssText='position:fixed;bottom:20px;left:20px;right:20px;max-width:720px;z-index:9999;background:#31202f;border:2px solid #cb8aab;color:#fff2fa;padding:16px 20px;border-radius:13px;box-shadow:0 12px 40px #000b;font:13px/1.5 Segoe UI,Arial,sans-serif';
    const title=document.createElement('strong');title.textContent='Motion Studio: falha ao iniciar o motor 3D';
    const description=document.createElement('p');description.id='sgStartupProblemMessage';description.textContent=original;
    const hint=document.createElement('p');hint.textContent='Verifique se você extraiu o ZIP completo. Em PCs com GPU antiga, abra pelo arquivo MODO_COMPATIBILIDADE.bat. A música do menu continua disponível.';
    const button=document.createElement('button');button.textContent='Tentar novamente';button.style.cssText='background:#bc81a6;color:#160c14;border:0;border-radius:7px;padding:8px 15px;cursor:pointer';button.onclick=()=>location.reload();
    alert.append(title,description,hint,button);
    document.body.appendChild(alert);
  }
  window.addEventListener('error',ev=>{
    const message=ev?.error?.message||ev?.message;
    if(message)state.reportError(message);
  });
  window.addEventListener('unhandledrejection',ev=>{
    if(ev?.reason)state.reportError(ev.reason);
  });
  function menuVisible(){return !$('sgMainMenu')?.classList.contains('sg-hidden');}
  function initAudio(){
    const audio=$('sgMenuMusic'),toggle=$('sgMenuMusicToggle'),volume=$('sgMenuMusicVolume');
    if(!audio||!toggle)return;
    let enabled=localStorage.getItem('sgMenuMusicEnabled')!=='off';
    let level=Number(localStorage.getItem('sgMenuMusicVolume')||0.48);
    if(!Number.isFinite(level))level=.48;
    level=Math.max(0,Math.min(1,level));
    audio.loop=true;audio.volume=level;
    if(volume)volume.value=String(Math.round(level*100));
    function sync(note=''){
      const playing=!audio.paused&&!audio.ended;
      toggle.textContent=!enabled?'♪ Música desligada':playing?'♫ Música ligada':note||'♪ Ativar música';
      toggle.setAttribute('aria-pressed',String(enabled));
      toggle.title=playing?'Pausar música do MainMenu':'Ativar música do menu';
    }
    async function start(){
      if(!enabled||!menuVisible()){audio.pause();sync();return;}
      try{await audio.play();sync();}catch(e){sync('♪ Clique para ouvir');}
    }
    toggle.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      if(enabled&&!audio.paused){enabled=false;audio.pause();}
      else{enabled=true;start();}
      localStorage.setItem('sgMenuMusicEnabled',enabled?'on':'off');sync();
    });
    if(volume)volume.addEventListener('input',event=>{
      level=Math.max(0,Math.min(1,Number(event.target.value)/100));
      audio.volume=level;localStorage.setItem('sgMenuMusicVolume',String(level));
    });
    document.addEventListener('pointerdown',event=>{
      if(event.target?.closest?.('#sgMenuMusicToggle'))return;
      if(enabled&&menuVisible()&&audio.paused)start();
    },{passive:true});
    document.addEventListener('keydown',()=>{
      if(enabled&&menuVisible()&&audio.paused)start();
    });
    audio.addEventListener('error',()=>{
      sync('♪ Áudio não encontrado');
      console.warn('Não foi possível ler BloodMenu.mp3. Mantenha a pasta assets ao lado do EXE.');
    });
    audio.addEventListener('play',()=>sync());
    audio.addEventListener('pause',()=>sync());
    new MutationObserver(()=>{if(menuVisible())start();else audio.pause();}).observe($('sgMainMenu'),{attributes:true,attributeFilter:['class']});
    sync();start();
  }
  function init(){
    initAudio();
    // The menu must not appear interactive if the engine failed to start.
    for(const id of ['sgMenuNew','sgMenuOpen']){
      const btn=$(id);
      btn?.addEventListener('click',()=>{if(!state.ready)showProblem(failures.at(-1)||'O editor 3D ainda não iniciou.');});
    }
    setTimeout(()=>{if(!state.ready)showProblem(failures.at(-1)||'WebGL/Three.js indisponível ou erro ao carregar bibliotecas 3D.');},7000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
