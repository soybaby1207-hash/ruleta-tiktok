// Servidor: una sala por usuario de TikTok. La página se conecta con ?user=NOMBRE y recibe los regalos.
const express=require('express'),http=require('http'),{WebSocketServer}=require('ws');
process.on('uncaughtException',e=>console.error('uncaught',e&&e.message));process.on('unhandledRejection',e=>console.error('unhandled',e&&e.message||e));
let Conn;const ready=import('tiktok-live-connector/legacy').then(m=>{Conn=m.WebcastPushConnection});
const KEY=process.env.EULER_API_KEY||undefined;
const app=express();app.get('/',(q,r)=>r.redirect('/ruleta.html'));app.use(express.static('public'));
const srv=http.createServer(app),wss=new WebSocketServer({server:srv}),rooms={};
function room(user){
  if(rooms[user])return rooms[user];
  const r=rooms[user]={clients:new Set(),conn:null,dead:false};
  const send=o=>{const m=JSON.stringify(o);r.clients.forEach(c=>c.readyState===1&&c.send(m))};
  const retry=()=>{if(!r.dead)setTimeout(connect,15000)};
  async function connect(){
    await ready;
    if(r.dead||!r.clients.size)return retry();
    r.conn=new Conn(user,{signApiKey:KEY});
    r.conn.on('gift',d=>send({event:'gift',data:{giftName:d.giftName,giftType:d.giftType,repeatEnd:d.repeatEnd,repeatCount:d.repeatCount,
      diamondCount:d.diamondCount,userId:d.userId,uniqueId:d.uniqueId,nickname:d.nickname,profilePictureUrl:d.profilePictureUrl,giftPictureUrl:d.giftPictureUrl}}));
    r.conn.on('error',e=>console.error('conn error',e&&e.message||e));
    r.conn.on('disconnected',()=>{send({event:'status',data:{ok:false,msg:'Desconectado, reintentando…'}});retry()});
    r.conn.on('streamEnd',()=>send({event:'status',data:{ok:false,msg:'El live terminó'}}));
    r.conn.connect().then(()=>send({event:'status',data:{ok:true,msg:'Conectado a @'+user}}))
      .catch(e=>{send({event:'status',data:{ok:false,msg:'No se pudo conectar a @'+user+' ('+String(e.message||e).slice(0,160)+')'+(KEY?'':' · Si es un error de firma/403, añade la variable EULER_API_KEY en Render.')}});retry()});
  }
  r.start=connect;return r;
}
wss.on('connection',(ws,req)=>{
  const user=(new URL(req.url,'http://x').searchParams.get('user')||'').replace('@','').trim().toLowerCase();
  if(!user)return ws.close();
  const fresh=!rooms[user],r=room(user);r.clients.add(ws);if(fresh)r.start();
  else ws.send(JSON.stringify({event:'status',data:{ok:true,msg:'Conectado a @'+user}}));
  ws.on('close',()=>{r.clients.delete(ws);if(!r.clients.size)setTimeout(()=>{if(!r.clients.size){r.dead=true;try{r.conn.disconnect()}catch(e){}delete rooms[user]}},30000)});
});
srv.listen(process.env.PORT||3000,()=>console.log('Abre: http://localhost:'+(process.env.PORT||3000)+'/ruleta.html'));
