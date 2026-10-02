"use client";
import { useEffect, useRef, useState } from "react";
export function useControlRoomWindow(){
  const child=useRef<Window|null>(null);const [container,setContainer]=useState<HTMLElement|null>(null);const [error,setError]=useState("");
  useEffect(()=>()=>child.current?.close(),[]);
  useEffect(()=>{if(!container)return;const timer=setInterval(()=>{if(child.current?.closed){child.current=null;setContainer(null);}},500);return()=>clearInterval(timer);},[container]);
  function open(){
    if(child.current&&!child.current.closed){child.current.focus();return;}
    const popup=window.open("","_blank","popup=yes,width=1500,height=950");
    if(!popup){setError("O navegador bloqueou a janela. Permita pop-ups para este aplicativo ou use Tela ampla.");return;}
    popup.document.title="AluPilot · Sala de controle";
    const base=popup.document.createElement("base");base.href=window.location.href;popup.document.head.append(base);
    document.querySelectorAll('link[rel="stylesheet"],style').forEach(node=>popup.document.head.append(node.cloneNode(true)));
    popup.document.documentElement.className=document.documentElement.className;
    popup.document.body.className="bg-slate-100 text-slate-950";
    const root=popup.document.createElement("main");root.className="p-4";popup.document.body.append(root);
    child.current=popup;setContainer(root);setError("");
  }
  function close(){child.current?.close();child.current=null;setContainer(null);}
  async function expand(){
    const target=child.current?.document;if(!target)return;
    try{if(target.fullscreenElement)await target.exitFullscreen();else await target.documentElement.requestFullscreen();}
    catch{setError("Tela cheia não permitida neste navegador. Você pode maximizar a janela pelos controles da própria janela.");}
  }
  return {container,error,open,close,expand};
}
