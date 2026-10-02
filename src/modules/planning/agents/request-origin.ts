// Next may normalize request.url to localhost while the browser uses 127.0.0.1.
// Host is the requested authority; never accept an arbitrary forwarded origin.
export function sameRequestOrigin(request:Request) {
  const origin=request.headers.get("origin");
  if(!origin||origin==="null")return false;
  try{
    const source=new URL(origin);const target=new URL(request.url);
    return source.origin===origin && source.host===(request.headers.get("host")??target.host) && source.protocol===target.protocol;
  }catch{return false;}
}
