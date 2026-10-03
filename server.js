process.on('uncaughtException',e=>console.error('uncaught',e&&e.message));process.on('unhandledRejection',e=>console.error('unhandled',e&&e.message||e));
const express=require('express'),http=require('http'),crypto=require('crypto'),{WebSocketServer}=require('ws');
let Conn;const ready=import('tiktok-live-connector/legacy').then(m=>{Conn=m.WebcastPushConnection});
const KEY=process.env.EULER_API_KEY||undefined,rnd=n=>crypto.randomInt(n);
const COINS={rose:1,tiktok:1,'ice cream cone':1,'heart me':1,'finger heart':5,perfume:20,doughnut:30,cap:99,'paper crane':99,'little crown':99,'hat and mustache':99,confetti:100,'hand hearts':100,sunglasses:199,'gold boxing gloves':299,corgi:299,'money gun':500,swan:699,train:899,galaxy:1000,fireworks:1088,'whale diving':2150,'leon the kitten':4888,'drama queen':5000,'sports car':7000,lion:29999,'tiktok universe':44999};
const NM=['maria','carlos','lucia','juan','sofia','diego','ana','pablo','laura','javi','carmen','alex','paula','david','marta','sergio','elena','raul','nuria','ivan'],SF=['_xx','.oficial','88','_17','_tv','.mx','_rd','23','_vip','_09'];
const fake=()=>({id:'t'+crypto.randomUUID(),name:NM[rnd(NM.length)]+SF[rnd(SF.length)],avatar:`https://randomuser.me/api/portraits/${rnd(2)?'women':'men'}/${rnd(99)}.jpg`});
const app=express();app.get('/',(q,r)=>r.redirect('/ruleta.html'));app.use(express.static('public'));
const srv=http.createServer(app),wss=new WebSocketServer({server:srv}),rooms={};
function room(user){
  if(rooms[user])return rooms[user];
  const r=rooms[user]={clients:new Set(),conn:null,dead:false,configured:false};
  const g={players:[],phase:'open',joinEnd:0,autoAt:0,autoSec:0,gifts:0,coins:0,entries:0,mode:'free',gift:'Rose',up:false,sec:60,au:15,im:'',cv:0,gu:{}};
  let joinT,autoT,busy=false;
  const send=(event,data)=>{const m=JSON.stringify({event,data});r.clients.forEach(c=>c.readyState===1&&c.send(m))};
  const state=()=>{const{players,...s}=g;send('state',{...s,now:Date.now()})},plist=()=>send('players',{players:g.players});
  const auto=s=>{clearTimeout(autoT);s=+s||0;g.autoSec=s;if(!s){g.autoAt=0;return state()}
    g.autoAt=Date.now()+s*1000;state();autoT=setTimeout(()=>{if(g.players.length>1&&!busy){g.autoAt=0;spin()}else auto(s)},s*1000)};
  const open=s=>{clearTimeout(joinT);auto(0);s=+s||60;g.phase='joining';g.joinEnd=Date.now()+s*1000;state();
    joinT=setTimeout(()=>{g.phase='closed';auto(g.au)},s*1000)};
  function spin(){
    if(busy||!g.players.length)return;
    if(g.players.length===1)return send('win',{p:g.players[0]});
    busy=true;const t=g.players[rnd(g.players.length)],life=t.lives>1;send('spin',{id:t.id,life});
    const end=()=>{busy=false;if(g.players.length===1){send('win',{p:g.players[0]});auto(0)}else if(g.autoSec)auto(g.autoSec);else state()};
    if(life)setTimeout(()=>{t.lives--;plist();setTimeout(end,1100)},1400);
    else setTimeout(()=>{g.players=g.players.filter(x=>x!==t);plist();state();setTimeout(end,1500)},1750);
  }
  const add=(p,c,n)=>{if(!['open','joining'].includes(g.phase))return;n=n||1;g.gifts+=n;g.coins+=c;g.entries++;
    const ex=g.players.find(a=>a.id===p.id);
    if(ex){ex.lives+=n;if(p.avatar&&!ex.avatar)ex.avatar=p.avatar}else{p.lives=n;g.players.push(p)}
    send('toast',{p:ex||p,n,k:ex?'add':'new'});plist();state()};
  const cfg=(c,soft)=>{if(soft&&r.configured)return;r.configured=true;
    g.mode=c.mode==='lock'?'lock':'free';g.gift=c.gift===undefined?g.gift:String(c.gift);g.up=!!c.up;g.im=c.im||'';g.sec=+c.sec||60;if(c.au!==undefined)g.au=+c.au||0;g.cv++;
    if(c.restart){clearTimeout(joinT);g.joinEnd=0;if(g.mode==='lock')open(g.sec);else{g.phase='open';auto(g.au)}}state()};
  r.cmd={cfg:m=>cfg(m,m.soft),open:m=>open(m.sec||g.sec),auto:m=>auto(m.sec),spin,
    reset:()=>{g.players=[];g.gifts=g.coins=g.entries=0;cfg({...g,restart:true});plist()},
    test:m=>{for(let i=0;i<Math.min(+m.n||1,100);i++)setTimeout(()=>add(fake(),(+m.c||1)*(+m.mult||1),+m.mult||1),i*90)}};
  r.sync=()=>{state();plist()};r.stop=()=>{clearTimeout(joinT);clearTimeout(autoT)};
  const retry=()=>{if(!r.dead)setTimeout(connect,15000)};
  async function connect(){
    await ready;if(r.dead)return;if(!r.clients.size)return retry();
    r.conn=new Conn(user,{signApiKey:KEY});
    r.conn.on('gift',d=>{
      const nm=(d.giftName||'').toLowerCase(),want=g.gift.toLowerCase(),min=COINS[want]||0,who=d.nickname||d.uniqueId||'?';
      const info=m=>{console.log('gift',nm,who,m);send('status',{ok:true,msg:'🎁 '+(d.giftName||'?')+' de '+who+' → '+m})};
      if(d.giftType===1&&!d.repeatEnd)return info('combo en curso, espera a que termine');
      if(want&&nm!==want&&!(g.up&&min&&(d.diamondCount||0)>=min))return info('ignorado: tu regalo configurado es "'+g.gift+'"');
      if(!['open','joining'].includes(g.phase))return info('ignorado: entradas cerradas');
      const n=d.repeatCount||1;if(d.giftPictureUrl)g.gu[nm]=g.gu['*']=d.giftPictureUrl;
      add({id:String(d.userId||d.uniqueId),name:d.nickname||d.uniqueId||'?',avatar:d.profilePictureUrl||''},(d.diamondCount||0)*n,n);info('entró ✅')});
    let lastChat=0;r.conn.on('chat',d=>{if(Date.now()-lastChat>5000){lastChat=Date.now();send('status',{ok:true,msg:'💬 Conexión activa (chat de '+(d.nickname||d.uniqueId||'?')+')'})}});
    r.conn.on('error',e=>console.error('conn error',e&&e.message||e));
    r.conn.on('disconnected',()=>{send('status',{ok:false,msg:'Desconectado, reintentando…'});retry()});
    r.conn.on('streamEnd',()=>send('status',{ok:false,msg:'El live terminó'}));
    r.conn.connect().then(()=>send('status',{ok:true,msg:'Conectado a @'+user}))
      .catch(e=>{send('status',{ok:false,msg:'No se pudo conectar a @'+user+' ('+String(e.message||e).slice(0,160)+')'+(KEY?'':' · Si es error de firma/403, añade EULER_API_KEY en Render.')});retry()});
  }
  r.start=connect;auto(15);return r;
}
wss.on('connection',(ws,req)=>{
  const user=(new URL(req.url,'http://x').searchParams.get('user')||'').replace('@','').trim().toLowerCase();
  if(!user)return ws.close();
  const fresh=!rooms[user],r=room(user);r.clients.add(ws);if(fresh)r.start();else if(r.conn&&r.conn.isConnected)ws.send(JSON.stringify({event:'status',data:{ok:true,msg:'Conectado a @'+user}}));
  r.sync();
  ws.on('message',raw=>{try{const m=JSON.parse(raw),h=r.cmd[m.cmd];h&&h(m)}catch(e){console.error('cmd',e.message)}});
  ws.on('close',()=>{r.clients.delete(ws);if(!r.clients.size)setTimeout(()=>{if(!r.clients.size){r.dead=true;r.stop();try{r.conn.disconnect()}catch(e){}delete rooms[user]}},30000)});
});
srv.listen(process.env.PORT||3000,()=>console.log('Abre: http://localhost:'+(process.env.PORT||3000)+'/ruleta.html'));
