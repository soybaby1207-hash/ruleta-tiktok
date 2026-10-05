process.on('uncaughtException',e=>console.error('uncaught',e&&e.message));
process.on('unhandledRejection',e=>console.error('unhandled',e&&e.message||e));

const express=require('express'),http=require('http'),crypto=require('crypto'),{WebSocketServer}=require('ws');
let Conn;const ready=import('tiktok-live-connector/legacy').then(m=>{Conn=m.WebcastPushConnection});

const bestPic=u=>{const l=[u.avatarLarge,u.avatarMedium,u.avatarThumb].flatMap(a=>(a&&a.urlList)||[]);
  return l.find(x=>/100x100/.test(x)&&/\.(webp|jpe?g|png)/.test(x))||l.find(x=>/\.(webp|jpe?g|png)/.test(x)&&!/heic/.test(x))||l.find(x=>!/heic/.test(x))||l[0]||''};

const KEY=process.env.EULER_API_KEY||undefined,rnd=n=>crypto.randomInt(n);

const COINS={
  rose:1,tiktok:1,'ice cream cone':1,'heart me':1,'finger heart':5,perfume:20,doughnut:30,cap:99,
  'paper crane':99,'little crown':99,'hat and mustache':99,confetti:100,'hand hearts':100,
  sunglasses:199,'gold boxing gloves':299,corgi:299,'money gun':500,swan:699,train:899,
  galaxy:1000,fireworks:1088,'whale diving':2150,'leon the kitten':4888,'drama queen':5000,
  'sports car':7000,lion:29999,'tiktok universe':44999
};

const NM=['maria','carlos','lucia','juan','sofia','diego','ana','pablo','laura','javi','carmen','alex','paula','david','marta','sergio','elena','raul','nuria','ivan'],
      SF=['_xx','.oficial','88','_17','_tv','.mx','_rd','23','_vip','_09'];

const fake=()=>({id:'t'+crypto.randomUUID(),name:NM[rnd(NM.length)]+SF[rnd(SF.length)],avatar:`https://randomuser.me/api/portraits/${rnd(2)?'women':'men'}/${rnd(99)}.jpg`});

const app=express();
app.get('/',(q,r)=>r.redirect('/ruleta.html'));
app.use(express.static('public'));

app.get('/debug',(q,res)=>{
  const u=String(q.query.user||'').replace('@','').trim().toLowerCase(),r=rooms[u];
  if(!r)return res.json({error:'No hay sala para '+u+'. Abre la pagina, escribe el usuario y pulsa Conectar primero.',salas:Object.keys(rooms)});
  res.json({
    usuario:u,
    conectadoATikTok:!!(r.conn&&r.conn.isConnected),
    claveEulerConfigurada:!!KEY,
    ultimoEstado:r.status,
    pantallasConectadas:r.clients.size,
    mensajesRecibidosDeTikTok:r.methods,
    registroDeRegalos:r.log
  });
});

const srv=http.createServer(app),wss=new WebSocketServer({server:srv}),rooms={};

function room(user){
  if(rooms[user])return rooms[user];

  const r=rooms[user]={clients:new Set(),conn:null,dead:false,configured:false,methods:{},log:[],status:'',pics:{}};
  const g={players:[],phase:'open',joinEnd:0,autoAt:0,autoSec:0,gifts:0,coins:0,entries:0,mode:'free',gift:'Rose',up:false,sec:60,au:15,im:'',min:1,cv:0,gu:{}};
  let joinT,autoT,busy=false;

  const send=(event,data)=>{
    if(event==='status')r.status=data.msg;
    const m=JSON.stringify({event,data});
    r.clients.forEach(c=>c.readyState===1&&c.send(m));
  };

  const state=()=>{const{players,...s}=g;send('state',{...s,now:Date.now()})};
  const plist=()=>send('players',{players:g.players});

  const auto=s=>{
    clearTimeout(autoT);
    s=+s||0;
    g.autoSec=s;
    if(!s){g.autoAt=0;return state()}
    g.autoAt=Date.now()+s*1000;
    state();
    autoT=setTimeout(()=>{if(g.players.length>1&&!busy){g.autoAt=0;spin()}else auto(s)},s*1000);
  };

  const open=s=>{
    clearTimeout(joinT);
    auto(0);
    s=+s||60;
    g.phase='joining';
    g.joinEnd=Date.now()+s*1000;
    state();
    joinT=setTimeout(()=>{g.phase='closed';auto(g.au)},s*1000);
  };

  function spin(){
    if(busy||!g.players.length)return;
    if(g.players.length===1)return send('win',{p:g.players[0]});
    busy=true;
    const t=g.players[rnd(g.players.length)],life=t.lives>1;
    send('spin',{id:t.id,life});
    const end=()=>{
      busy=false;
      if(g.players.length===1){send('win',{p:g.players[0]});auto(0)}
      else if(g.autoSec)auto(g.autoSec);
      else state();
    };
    if(life)setTimeout(()=>{t.lives--;plist();setTimeout(end,1100)},1400);
    else setTimeout(()=>{g.players=g.players.filter(x=>x!==t);plist();state();setTimeout(end,1500)},1750);
  }

  const add=(p,c,n)=>{
    if(!['open','joining'].includes(g.phase))return;
    n=n||1;
    g.gifts+=n;
    g.coins+=c;
    g.entries++;
    const ex=g.players.find(a=>a.id===p.id);
    if(ex){ex.lives+=n;if(p.avatar&&!ex.avatar)ex.avatar=p.avatar}
    else{p.lives=n;g.players.push(p)}
    send('toast',{p:ex||p,n,k:ex?'add':'new'});
    plist();
    state();
  };

  const cfg=(c,soft)=>{
    if(soft&&r.configured)return;
    r.configured=true;
    g.mode=c.mode==='lock'?'lock':'free';
    g.gift=c.gift===undefined?g.gift:String(c.gift);
    g.up=!!c.up;
    g.im=c.im||'';
    g.sec=+c.sec||60;
    g.min=Math.max(1,+c.min||1);
    if(c.au!==undefined)g.au=+c.au||0;
    g.cv++;
    if(c.restart){
      clearTimeout(joinT);
      g.joinEnd=0;
      if(g.mode==='lock')open(g.sec);
      else{g.phase='open';auto(g.au)}
    }
    state();
  };

  r.cmd={
    cfg:m=>cfg(m,m.soft),
    open:m=>open(m.sec||g.sec),
    auto:m=>auto(m.sec),
    spin,
    reset:()=>{g.players=[];g.gifts=g.coins=g.entries=0;cfg({...g,restart:true});plist()},
    test:m=>{for(let i=0;i<Math.min(+m.n||1,100);i++)setTimeout(()=>add(fake(),(+m.c||1)*(+m.mult||1),+m.mult||1),i*90)}
  };

  r.sync=()=>{state();plist()};
  r.stop=()=>{clearTimeout(joinT);clearTimeout(autoT)};

  const retry=()=>{if(!r.dead)setTimeout(connect,15000)};

  async function connect(){
    await ready;
    if(r.dead)return;
    if(!r.clients.size)return retry();

    r.conn=new Conn(user,{signApiKey:KEY});

    const orig=r.conn.processProtoMessageFetchResult.bind(r.conn);
    r.conn.processProtoMessageFetchResult=async fr=>{
      try{
        fr.messages.forEach(m=>{
          const u=m.decodedData&&m.decodedData.data&&m.decodedData.data.user;
          if(u&&u.idStr){const p=bestPic(u);if(p)r.pics[u.idStr]=p}
        });
      }catch(e){}
      return orig(fr);
    };

    // ============ AQUÍ ESTÁ EL ARREGLO DEL REGALO ============
    r.conn.on('gift',d=>{
      const nm=(d.giftName||'').toLowerCase(),want=g.gift.toLowerCase(),min=COINS[want]||0,who=d.nickname||d.uniqueId||'?';
      
      const info=m=>{
        const line=new Date().toISOString().slice(11,19)+' '+who+' '+(d.giftName||'?')+' tipo='+d.giftType+' fin='+d.repeatEnd+' x'+d.repeatCount+' -> '+m;
        r.log.push(line);
        if(r.log.length>30)r.log.shift();
        console.log('gift',line);
        send('status',{ok:true,msg:'🎁 '+(d.giftName||'?')+' de '+who+' → '+m});
      };

      // Combos en curso
      if(d.giftType===1&&!d.repeatEnd)return info('combo en curso, espera a que termine');

      // Regalo específico configurado
      if(want){
        if(nm!==want&&!(g.up&&min&&(d.diamondCount||0)>=min)){
          return info('ignorado: tu regalo configurado es "'+g.gift+'"');
        }
      }
      // Modo "Cualquier regalo" → solo rechaza si SÍ viene el valor y es menor al mínimo
      else if(d.diamondCount != null && d.diamondCount < g.min){
        return info('ignorado: vale menos de '+g.min+' moneda(s)');
      }

      // Entradas cerradas
      if(!['open','joining'].includes(g.phase)){
        send('toast',{
          p:{
            id:String(d.userId||d.uniqueId),
            name:who,
            avatar:r.pics[String(d.userId)]||d.profilePictureUrl||(d.userDetails&&d.userDetails.profilePictureUrls)||'',
            lives:0
          },
          n:0,
          k:'locked'
        });
        return info('ignorado: entradas cerradas');
      }

      const n=d.repeatCount||1;
      if(d.giftPictureUrl)g.gu[nm]=g.gu['*']=d.giftPictureUrl;

      // Si no trae diamondCount, lo contamos como 1
      const diamonds=(d.diamondCount!=null?d.diamondCount:1)*n;

      add({
        id:String(d.userId||d.uniqueId),
        name:d.nickname||d.uniqueId||'?',
        avatar:r.pics[String(d.userId)]||d.profilePictureUrl||(d.userDetails&&d.userDetails.profilePictureUrls)||''
      },diamonds,n);

      info('entró ✅');
    });
    // ========================================================

    r.conn.on('rawData',m=>{r.methods[m]=(r.methods[m]||0)+1});
    r.conn.on('error',e=>console.error('conn error',e&&e.message||e));
    r.conn.on('disconnected',()=>{send('status',{ok:false,msg:'Desconectado, reintentando…'});retry()});
    r.conn.on('streamEnd',()=>send('status',{ok:false,msg:'El live terminó'}));

    r.conn.connect().then(st=>{
      let o=null;
      try{
        const ow=st&&st.roomInfo&&st.roomInfo.owner;
        if(ow){
          const al=ow.avatar_thumb||ow.avatarThumb||ow.avatar_large||ow.avatarLarge,
                ul=al&&(al.url_list||al.urlList);
          o={name:ow.nickname||'',avatar:(ul&&ul[0])||''};
        }
      }catch(e){}
      r.owner=o;
      if(o)send('owner',o);
      send('status',{ok:true,msg:'Conectado a @'+user+(o&&o.name?' ('+o.name+')':'')});
    }).catch(e=>{
      send('status',{ok:false,msg:'No se pudo conectar a @'+user+' ('+String(e.message||e).slice(0,160)+')'+(KEY?'':' · Si es error de firma/403, añade EULER_API_KEY en Render.')});
      retry();
    });
  }

  r.start=connect;
  auto(15);
  return r;
}

wss.on('connection',(ws,req)=>{
  const user=(new URL(req.url,'http://x').searchParams.get('user')||'').replace('@','').trim().toLowerCase();
  if(!user)return ws.close();

  const fresh=!rooms[user],r=room(user);
  r.clients.add(ws);

  if(fresh)r.start();
  else if(r.conn&&r.conn.isConnected)ws.send(JSON.stringify({event:'status',data:{ok:true,msg:'Conectado a @'+user}}));

  if(r.owner)ws.send(JSON.stringify({event:'owner',data:r.owner}));
  r.sync();

  ws.on('message',raw=>{
    try{
      const m=JSON.parse(raw),h=r.cmd[m.cmd];
      h&&h(m);
    }catch(e){console.error('cmd',e.message)}
  });

  ws.on('close',()=>{
    r.clients.delete(ws);
    if(!r.clients.size)setTimeout(()=>{
      if(!r.clients.size){
        r.dead=true;
        r.stop();
        try{r.conn.disconnect()}catch(e){}
        delete rooms[user];
      }
    },30000);
  });
});

console.log(KEY?'Clave EULER_API_KEY detectada.':'AVISO: sin EULER_API_KEY. TikTok puede rechazar o limitar la conexion (ver LEEME).');
srv.listen(process.env.PORT||3000,()=>console.log('Abre: http://localhost:'+(process.env.PORT||3000)+'/ruleta.html'));
