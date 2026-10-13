(function(global){
  "use strict";
  const VERSION=2,UNIT="staff-line",LANES=["beforeScore","afterScore","afterLyrics","afterVocal"],addressCache=new WeakMap();
  const round=value=>Math.round(Math.max(0,Number(value)||0)*1000000)/1000000,signedRound=value=>Math.round((Number(value)||0)*1000000)/1000000;
  const key=(row,lane)=>`${Math.max(0,Math.trunc(Number(row)||0))}:${LANES.includes(lane)?lane:"afterScore"}`;
  function normalize(raw){
    const boundaries={};
    Object.entries(raw?.boundaries||{}).forEach(([name,value])=>{
      if(!/^\d+:(beforeScore|afterScore|afterLyrics|afterVocal)$/.test(name))return;
      const gap=round(typeof value==="number"?value:value?.gap);
      if(gap>0)boundaries[name]={gap:Math.max(gap,Number(boundaries[name]?.gap)||0)};
    });
    return{version:VERSION,unit:UNIT,boundaries};
  }
  function fromPixelGaps(entries){
    const boundaries={};
    (entries||[]).forEach(entry=>{
      const line=Math.max(1,Number(entry.lineSpacing)||18),gap=round((Number(entry.gapPx)||0)/line),name=key(entry.row,entry.lane);
      if(gap>0)boundaries[name]={gap:Math.max(gap,Number(boundaries[name]?.gap)||0)};
    });
    return{version:VERSION,unit:UNIT,boundaries};
  }
  function rawGap(layout,row,lane){return Number(normalize(layout).boundaries[key(row,lane)]?.gap)||0}
  function rowGaps(layout,row,{lyricsVisible=true,vocalVisible=true}={}){
    const source={beforeScore:rawGap(layout,row,"beforeScore"),afterScore:rawGap(layout,row,"afterScore"),afterLyrics:rawGap(layout,row,"afterLyrics"),afterVocal:rawGap(layout,row,"afterVocal")};
    const result={beforeScore:source.beforeScore,afterScore:source.afterScore,afterLyrics:0,afterVocal:0};
    if(lyricsVisible)result.afterLyrics=source.afterLyrics;else result.afterScore=Math.max(result.afterScore,source.afterLyrics);
    if(vocalVisible)result.afterVocal=source.afterVocal;else if(lyricsVisible)result.afterLyrics=Math.max(result.afterLyrics,source.afterVocal);else result.afterScore=Math.max(result.afterScore,source.afterVocal);
    return result;
  }
  function pixelGaps(layout,row,visibility,lineSpacing){
    const unit=Math.max(1,Number(lineSpacing)||18),gaps=rowGaps(layout,row,visibility);
    return Object.fromEntries(LANES.map(lane=>[lane,round(gaps[lane]*unit)]));
  }
  function rowRegions(row){
    return{score:row?.scoreRect?{top:row.lineTop,bottom:row.lineBottom,left:row.scoreRect.left,right:row.scoreRect.right}:null,lyrics:row?.lyrics?.getBoundingClientRect()||null,vocal:row?.vocal?.getBoundingClientRect()||null};
  }
  function domAddresses(geometry){
    if(!geometry?.rows?.length)return[];
    if(addressCache.has(geometry))return addressCache.get(geometry);
    const elements=[];geometry.rows.forEach(row=>{const regions=rowRegions(row);if(regions.score)elements.push({id:`score:${row.row}`,kind:"score",row:row.row,rect:regions.score});if(regions.lyrics)elements.push({id:`lyrics:${row.row}`,kind:"lyrics",row:row.row,rect:regions.lyrics});if(regions.vocal)elements.push({id:`vocal:${row.row}`,kind:"vocal",row:row.row,rect:regions.vocal})});
    elements.sort((a,b)=>a.rect.top-b.rect.top);const byId=new Map(elements.map(element=>[element.id,element])),addresses=[];
    const firstRow=geometry.rows[0],firstScore=byId.get("score:0"),firstSpace=firstRow?.staff?.querySelector?.('[data-annotation-boundary="beforeScore"]'),metaRect=global.document?.querySelector?.(".paper .meta")?.getBoundingClientRect?.();
    if(firstSpace&&firstScore){const previousRect=metaRect||{top:firstScore.rect.top-firstRow.lineSpacing*2,bottom:firstScore.rect.top-firstRow.lineSpacing*2,left:firstScore.rect.left,right:firstScore.rect.right};addresses.push({key:key(0,"beforeScore"),row:0,lane:"beforeScore",space:firstSpace,previous:{id:"page:header",kind:"header",row:-1,rect:previousRect},next:firstScore,baselinePreviousTop:previousRect.top,baselinePreviousBottom:previousRect.bottom,baselineNextTop:firstScore.rect.top,baselineNextBottom:firstScore.rect.bottom,lineSpacing:firstRow.lineSpacing||18})}
    geometry.rows.forEach((row,index)=>{
      const nextScore=geometry.rows[index+1]?`score:${index+1}`:null,regions=rowRegions(row),definitions=[
        ["afterScore",`score:${index}`,regions.lyrics?`lyrics:${index}`:regions.vocal?`vocal:${index}`:nextScore],
        ["afterLyrics",`lyrics:${index}`,regions.vocal?`vocal:${index}`:nextScore],
        ["afterVocal",regions.vocal?`vocal:${index}`:regions.lyrics?`lyrics:${index}`:`score:${index}`,nextScore]
      ];
      definitions.forEach(([lane,previousId,nextId])=>{const space=row.staff?.querySelector?.(`[data-annotation-boundary="${lane}"]`),previous=byId.get(previousId),next=byId.get(nextId);if(!space||!previous)return;const fallback=geometry.rows[index+1]?.lineTop??row.rect?.bottom??previous.rect.bottom;addresses.push({key:key(index,lane),row:index,lane,space,previous,next,baselinePreviousTop:previous.rect.top,baselinePreviousBottom:previous.rect.bottom,baselineNextTop:next?.rect.top??fallback,baselineNextBottom:next?.rect.bottom??fallback,lineSpacing:row.lineSpacing||18})});
    });
    const result=addresses.sort((a,b)=>a.baselinePreviousBottom-b.baselinePreviousBottom||a.baselineNextTop-b.baselineNextTop);addressCache.set(geometry,result);return result;
  }
  function addressForBounds(addresses,bounds){
    if(!addresses?.length||!bounds)return null;const top=Number(bounds.top),bottom=Number(bounds.bottom),center=(top+bottom)/2;
    return addresses.reduce((best,address)=>{const low=address.baselinePreviousBottom,high=Math.max(low,address.baselineNextTop),distance=center<low?low-center:center>high?center-high:0,centerDistance=Math.abs(center-(low+high)/2),rank=distance*10000+centerDistance;return!best||rank<best.rank?{address,rank}:best},null)?.address||null;
  }
  function placementFromBounds(address,bounds,clearance={top:0,bottom:0}){
    if(!address||!bounds)return null;const line=Math.max(1,Number(address.lineSpacing)||18),width=Math.max(0,Number(bounds.right)-Number(bounds.left)),height=Math.max(0,Number(bounds.bottom)-Number(bounds.top));
    return{version:2,boundaryKey:address.key,row:address.row,lane:address.lane,previous:address.previous.id,next:address.next?.id||"page:end",offsetTop:signedRound((Number(bounds.top)-address.baselinePreviousBottom)/line),offsetFromNextTop:signedRound((Number(bounds.top)-address.baselineNextTop)/line),widthRatio:round(width/Math.max(1,Number(address.previous.rect.right)-Number(address.previous.rect.left))),heightLines:round(height/line),clearanceTop:round((Number(clearance.top)||0)/line),clearanceBottom:round((Number(clearance.bottom)||0)/line)};
  }
  function resolveAddress(addresses,placement){
    if(!placement)return null;let found=addresses.find(address=>address.key===placement.boundaryKey);if(found)return found;const row=Math.max(0,Math.trunc(Number(placement.row)||0));for(const lane of placement.lane==="beforeScore"?["beforeScore","afterScore"]:placement.lane==="afterVocal"?["afterVocal","afterLyrics","afterScore"]:placement.lane==="afterLyrics"?["afterLyrics","afterScore"]:["afterScore"]){found=addresses.find(address=>address.row===row&&address.lane===lane);if(found)return found}return null;
  }
  function placementTop(geometry,placement){const address=resolveAddress(domAddresses(geometry),placement);if(!address)return null;const line=Math.max(1,address.lineSpacing||18);return address.lane==="beforeScore"?address.next.rect.top+(Number(placement.offsetFromNextTop)||0)*line:address.previous.rect.bottom+(Number(placement.offsetTop)||0)*line}
  function placementTopWithClearance(geometry,placement){
    const address=resolveAddress(domAddresses(geometry),placement),savedTop=placementTop(geometry,placement);
    if(!address||!Number.isFinite(savedTop)||address.lane==="beforeScore")return savedTop;
    const line=Math.max(1,Number(address.lineSpacing)||18),clearance=Math.max(0,Number(placement?.clearanceTop)||0)*line;
    return Math.max(savedTop,address.previous.rect.bottom+clearance);
  }
  function effectivePixelGaps(geometry,layout,items){
    const addresses=domAddresses(geometry),gaps=new Map();
    (geometry?.rows||[]).forEach(row=>{
      const saved=pixelGaps(layout,row.row,{lyricsVisible:Boolean(row.lyrics),vocalVisible:Boolean(row.vocal)},row.lineSpacing);
      LANES.forEach(lane=>gaps.set(key(row.row,lane),Math.max(0,Number(saved[lane])||0)));
    });
    (items||[]).forEach(item=>{
      if(item?.type!=="text"||!item.layoutPlacement)return;
      const placement=item.layoutPlacement,address=resolveAddress(addresses,placement);if(!address||address.lane==="beforeScore")return;
      const line=Math.max(1,Number(address.lineSpacing)||18),offset=Math.max(Number(placement.offsetTop)||0,Number(placement.clearanceTop)||0),height=Math.max(0,Number(placement.heightLines)||0),bottomClearance=Math.max(0,Number(placement.clearanceBottom)||0),natural=Math.max(0,address.baselineNextTop-address.baselinePreviousBottom),required=Math.max(0,(offset+height+bottomClearance)*line-natural);
      gaps.set(address.key,Math.max(gaps.get(address.key)||0,required));
    });
    return{addresses,gaps};
  }
  function capturePageReferenceSize(element){
    const rect=element?.getBoundingClientRect?.();
    if(!rect?.width||!rect.height)return null;
    return{width:Number(rect.width),height:Number(rect.height)};
  }
  function pageReferenceRect(element,referenceSize){
    const rect=element?.getBoundingClientRect?.();
    if(!rect)return null;
    const left=Number(rect.left)||0,top=Number(rect.top)||0;
    const width=Math.max(1,Number(referenceSize?.width)||Number(rect.width)||1),height=Math.max(1,Number(referenceSize?.height)||Number(rect.height)||1);
    return{left,top,width,height,right:left+width,bottom:top+height};
  }
  function equal(a,b){return JSON.stringify(normalize(a))===JSON.stringify(normalize(b))}
  global.ShianAnnotationLayout={VERSION,UNIT,LANES,key,normalize,fromPixelGaps,rowGaps,pixelGaps,rowRegions,domAddresses,addressForBounds,placementFromBounds,resolveAddress,placementTop,placementTopWithClearance,effectivePixelGaps,capturePageReferenceSize,pageReferenceRect,equal};
})(window);
