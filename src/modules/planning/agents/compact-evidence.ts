// Bounded, explicitly partial evidence. The simulator still calculates the entire load.
export function compactEvidence(value:unknown,offset=0,limit=2):unknown {
  if(typeof value==="string")return value.length>360?value.slice(0,360)+" [texto abreviado]":value;
  if(Array.isArray(value)){
    if(value.length===0)return [];
    const page=value.slice(offset,offset+limit);
    return {total:value.length,offset,items:page.map(v=>compactEvidence(v,0,limit)),nextOffset:offset+limit<value.length?offset+limit:null,partial:offset>0||offset+limit<value.length};
  }
  if(value instanceof Date)return value.toISOString();
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,compactEvidence(v,offset,limit)]));
  return value;
}
export function evidenceMessage(value:unknown,offset=0,limit=2) {
  let data=compactEvidence(value,offset,limit);
  if(JSON.stringify(data).length>3000)data=compactEvidence(value,offset,1);
  if(JSON.stringify(data).length>3000)return JSON.stringify({partial:true,aviso:"Resultado muito extenso. Consulte uma ordem específica por orderId; não conclua disponibilidade a partir desta resposta."});
  return JSON.stringify({aviso:"Listas paginadas: partial=true não representa a carga inteira. Consulte offset/limit ou orderId para investigar; não invente valores omitidos.",dados:data});
}
