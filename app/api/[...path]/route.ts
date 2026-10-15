import { prepare, submit, feed, olderFeed, db, reconcile, publicLaunch, setupStatus, sameOrigin, runtime, type Launch } from '../../lib/launches';
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request) {
  try {
    const url=new URL(req.url), path=url.pathname;
    if(path==='/api/feed') return json(url.searchParams.has('before')?await olderFeed(Math.max(1,Number(url.searchParams.get('before'))||1)):await feed());
    if(path.startsWith('/api/launch/')) {
      await reconcile();
      const row=await db().prepare('SELECT * FROM launches WHERE id=?').bind(path.split('/').pop()).first<Launch>();
      return row?json({...publicLaunch(row),...await setupStatus(row)}):json({error:'Launch not found'},404);
    }
    return json({error:'Not found'},404);
  } catch(e) { return json({error:e instanceof Error?e.message:'Service temporarily unavailable'},503); }
}
export async function POST(req:Request) {
  try {
    const path=new URL(req.url).pathname;
    if(path==='/api/prepare') return json(await prepare(req));
    if(path==='/api/submit') return json(await submit(req));
    if(path==='/api/upload') {
      sameOrigin(req);
      const jwt=runtime().PINATA_JWT;
      if(!jwt) return json({error:'Artwork uploads need a Pinata integration. Use a public metadata URI to launch now.'},409);
      if(Number(req.headers.get('content-length')||0)>4500000) throw new Error('Use artwork smaller than 4 MB.');
      const form=await req.formData(),file=form.get('file');
      if(!(file instanceof File)||file.size>4*1024*1024||!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)) throw new Error('Use a PNG, JPEG, WebP, or GIF smaller than 4 MB.');
      const name=String(form.get('name')||'').slice(0,32),symbol=String(form.get('symbol')||'').slice(0,13),description=String(form.get('description')||'').slice(0,1000);
      const upload=new FormData();upload.append('file',file);
      const imageResponse=await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS',{method:'POST',headers:{Authorization:`Bearer ${jwt}`},body:upload});
      if(!imageResponse.ok) throw new Error('Artwork upload failed. Check the Pinata integration and try again.');
      const image=`https://ipfs.io/ipfs/${(await imageResponse.json() as {IpfsHash:string}).IpfsHash}`;
      const metadataResponse=await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS',{method:'POST',headers:{Authorization:`Bearer ${jwt}`,'Content-Type':'application/json'},body:JSON.stringify({pinataContent:{name,symbol,description,image,showName:true,createdOn:'https://pump.fun'},pinataMetadata:{name:`${symbol} metadata`}})});
      if(!metadataResponse.ok) throw new Error('Metadata upload failed. Please try again.');
      const cid=(await metadataResponse.json() as {IpfsHash:string}).IpfsHash;
      return json({uri:`https://ipfs.io/ipfs/${cid}`,image});
    }
    return json({error:'Not found'},404);
  } catch(e) { return json({error:e instanceof Error?e.message:'Launch request failed'},400); }
}
