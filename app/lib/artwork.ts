import {Buffer} from 'node:buffer';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {db,runtime,sameOrigin} from './launches';
const limit=4*1024*1024;
export async function uploadArtwork(req:Request){
  sameOrigin(req);
  const bucket=runtime().BUCKET;if(!bucket)throw new Error('Artwork storage is temporarily unavailable.');
  if(Number(req.headers.get('content-length')||0)>limit+20000)throw new Error('Use an image smaller than 4 MB.');
  const reader=req.body?.getReader();if(!reader)throw new Error('Choose an image.');
  let size=0;const chunks:Uint8Array[]=[];
  while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>limit+20000){await reader.cancel();throw new Error('Use an image smaller than 4 MB.');}chunks.push(r.value);}
  const raw=Buffer.concat(chunks);
  const form=await new Response(raw,{headers:{'Content-Type':req.headers.get('content-type')||''}}).formData();
  const file=form.get('file'),payload=form.get('payload'),signature=form.get('signature');
  if(!(file instanceof File)||file.size>limit||file.size===0||typeof payload!=='string'||payload.length>10000||typeof signature!=='string'||signature.length>100)throw new Error('Choose a PNG, JPEG, WebP, or GIF smaller than 4 MB.');
  const p=JSON.parse(payload),user=new PublicKey(p.wallet);
  if(p.domain!==new URL(req.url).origin||p.action!=='Upload Infinite Pairs artwork'||!Number.isFinite(p.timestamp)||Math.abs(Date.now()-p.timestamp)>300000)throw new Error('Artwork authorization expired. Please try again.');
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),user.toBuffer()]),format:'der',type:'spki'});
  if(!verify(null,Buffer.from(payload),key,Buffer.from(signature,'base64')))throw new Error('Artwork wallet authorization failed.');
  const {name,symbol,description=''}=p;
  if(typeof name!=='string'||!name.trim()||Buffer.byteLength(name)>32||typeof symbol!=='string'||!symbol.trim()||Buffer.byteLength(symbol)>13||typeof description!=='string'||description.length>1000)throw new Error('Add a token name and ticker before importing artwork.');
  const bytes=Buffer.from(await file.arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==p.imageHash)throw new Error('The imported image does not match the wallet authorization.');
  let extension='',type='';
  if(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))){extension='png';type='image/png';}
  else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){extension='jpg';type='image/jpeg';}
  else if(['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString())){extension='gif';type='image/gif';}
  else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'){extension='webp';type='image/webp';}
  else throw new Error('Import a PNG, JPEG, WebP, or GIF image.');
  const id=crypto.randomUUID(),authHash=createHash('sha256').update(payload).digest('hex'),origin=new URL(req.url).origin;
  const image=`${origin}/api/assets/${id}.${extension}`,uri=`${origin}/api/assets/${id}.json`;
  const reserved=await db().prepare('INSERT INTO uploads(id,auth_hash,owner,wallet_window,name,symbol,description,image,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM uploads WHERE owner=? AND created_at>?)<10')
    .bind(id,authHash,user.toBase58(),authHash,name,symbol,description,image,Date.now(),user.toBase58(),Date.now()-600000).run();
  if(!reserved.meta.changes)throw new Error('Artwork upload limit reached. Try again in a few minutes.');
  await bucket.put(`${id}.${extension}`,bytes,{httpMetadata:{contentType:type,cacheControl:'public, max-age=31536000, immutable'}});
  await bucket.put(`${id}.json`,JSON.stringify({name,symbol,description,image,showName:true,createdOn:'https://pump.fun'}),{httpMetadata:{contentType:'application/json',cacheControl:'public, max-age=31536000, immutable'}});
  return {uri,image};
}
export async function artwork(path:string){
  const key=path.slice('/api/assets/'.length);
  if(!/^[a-f0-9-]{36}\.(json|png|jpg|gif|webp)$/.test(key))return new Response('Not found',{status:404});
  const object=await runtime().BUCKET?.get(key);if(!object)return new Response('Not found',{status:404});
  const headers=new Headers({'X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*','Content-Security-Policy':"default-src 'none'"});object.writeHttpMetadata(headers);
  return new Response(object.body,{headers});
}
