/*
  Player adapter for the culture-score editor's v3 annotation geometry.
  Source: sianhu/index.html annotationGeometry / annotationClientFromAnchor,
          and sianhu/annotation-layout.js (used unmodified).
  This is display-only.  Never writes to score JSON, playback timelines or marks.
*/
(function(global){
  'use strict';
  const Layout=global.ShianAnnotationLayout;
  const number=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;
  // Source editor uses approximately 18 CSS px per staff interval.
  // Keep the player's 32px string pitches unchanged; use this unit only for
  // annotation clearances beyond the three strings.
  const OUTSIDE_LINE_UNIT=18;
  function layoutGeometry(g){return {...g,rows:g.rows.map(row=>({...row,lineSpacing:Math.min(row.lineSpacing,OUTSIDE_LINE_UNIT)}))};}

  function geometry(paper){
    if(!paper)return null;
    const paperRect=paper.getBoundingClientRect();
    const systems=[...paper.querySelectorAll('.score-system')];
    if(!systems.length)return null;
    const rows=systems.map((system,row)=>{
      const score=system.querySelector('.score-row');
      const scoreRect=score?.getBoundingClientRect();
      const measures=[...system.querySelectorAll('.score-row>.measure[data-measure]')]
        .map(element=>({m:Number(element.dataset.measure),element,rect:element.getBoundingClientRect()}));
      const strings=[...(measures[0]?.element.querySelectorAll('.string-line')||[])].map(el=>el.getBoundingClientRect());
      const top=strings.find((r,i)=>i===0);const bottom=strings.find((r,i)=>i===2);
      const lineTop=top?top.top+top.height/2:(scoreRect?.top||0);
      const lineBottom=bottom?bottom.top+bottom.height/2:lineTop+64;
      const lineSpacing=Math.max(1,(lineBottom-lineTop)/2);
      // Match the editor's actual DOM: each lane is a real spacing element
      // at its own boundary, not a synthesized system margin.
      const staff={querySelector(selector){return system.querySelector(selector);}};
      return {row,staff,system,rect:system.getBoundingClientRect(),score,scoreRect,measures,
        lineTop,lineBottom,lineSpacing,
        lyrics:system.querySelector('.lyrics-line'),vocal:system.querySelector('.vocal-track')};
    });
    const measureMap=new Map();rows.forEach(row=>row.measures.forEach(measure=>measureMap.set(measure.m,{row,measure})));
    return {rows,measureMap,paperRect,pageRect:Layout.pageReferenceRect(paper,Layout.capturePageReferenceSize(paper)),svgRect:paperRect};
  }
  // This conversion follows sianhu annotationClientFromAnchor() exactly,
  // substituting the player's actual measure, staff, lyrics and vocal DOM.
  function clientFromAnchor(anchor,geometry,target,fallbackRow){
    if(target==='page'){
      const rect=geometry?.pageRect;
      return rect?{x:rect.left+Number(anchor.pageX)*rect.width,y:rect.top+Number(anchor.pageY)*rect.height}:null;
    }
    const located=geometry.measureMap.get(Number(anchor.m));
    const row=located?.row||geometry.rows[Number(fallbackRow)];
    const measure=located?.measure||row?.measures?.[0];
    const element=target==='lyrics'?row?.lyrics:target==='vocal'?row?.vocal:row?.score;
    const rect=element?.getBoundingClientRect();
    if(!row||!measure||!rect)return null;
    const x=Number.isFinite(Number(anchor.x))
      ?measure.rect.left+Number(anchor.x)*measure.rect.width
      :row.scoreRect.left+Number(anchor.rowX||0)*row.scoreRect.width;
    const staffY=Number(anchor.staffY);
    const logicalY=Number.isFinite(staffY)?staffY:Number(anchor.y||0)-2;
    // Within the actual three strings, retain the true 32px player spacing.
    // Beyond top/bottom strings, respect the editor's stored line units,
    // avoiding inflated comment offsets and marker dimensions.
    const staffClientY=logicalY< -2
      ?row.lineTop+(logicalY+2)*Math.min(row.lineSpacing,OUTSIDE_LINE_UNIT)
      :logicalY>0
      ?row.lineBottom+logicalY*Math.min(row.lineSpacing,OUTSIDE_LINE_UNIT)
      :row.lineBottom+logicalY*row.lineSpacing;
    const y=target==='staff'
      ?staffClientY
      :rect.top+Number(anchor.y||0)*rect.height;
    return {x,y,row:row.row};
  }
  function sourcePoints(item){
    const type=String(item.type||'').toLowerCase();
    if(['pen','free','freehand','path'].includes(type)&&Array.isArray(item.points))
      return item.points.map(p=>Array.isArray(p)?{x:number(p[0]),y:number(p[1])}:{x:number(p?.x),y:number(p?.y)});
    if(type==='text'||type==='comment'||type==='symbol')return [{x:number(item.x),y:number(item.y)}];
    return [{x:number(item.x1),y:number(item.y1)},{x:number(item.x2),y:number(item.y2)}];
  }
  function hasV3(item){return item?.layoutAnchorVersion===3&&Array.isArray(item.layoutAnchors)&&item.layoutAnchors.length>0;}
  function mapFromAnchor(item,x,y,g){
    if(!hasV3(item))return null;
    const points=sourcePoints(item),anchors=item.layoutAnchors;
    if(points.length!==anchors.length)return null;
    // Source points are used only to identify which saved anchor corresponds
    // to this endpoint.  The coordinates themselves never drive v3 layout.
    let index=0,best=Infinity;
    points.forEach((point,i)=>{const distance=Math.hypot(point.x-number(x),point.y-number(y));if(distance<best){best=distance;index=i;}});
    if(best>1)return null;
    const target=item.layoutTarget||'staff';
    const client=clientFromAnchor(anchors[index],g,target,item.layoutRow);
    return client?{x:client.x-g.paperRect.left,y:client.y-g.paperRect.top}:null;
  }
  function placementTop(item,g){
    if(!item?.layoutPlacement||!Layout)return null;
    const client=Layout.placementTopWithClearance(layoutGeometry(g),item.layoutPlacement);
    // In the editor, placementTop is the item's bounding top minus 4 SVG units.
    // Match its actual text-top rather than treating this as the baseline.
    return Number.isFinite(client)?client-g.paperRect.top+4*g.paperRect.width/1000:null;
  }
  function activeItems(layers){return (layers||[]).filter(layer=>layer.visible!==false).flatMap(layer=>layer.items||[]);}
  function appendBoundaryNodes(paper){
    for(const [index,system] of [...paper.querySelectorAll('.score-system')].entries()){
      const lanes=index===0?['beforeScore','afterScore','afterLyrics','afterVocal']:['afterScore','afterLyrics','afterVocal'];
      for(const lane of lanes){
        // The source editor only creates afterLyrics/afterVocal when the
        // corresponding area is present. The other cases use fallback lanes.
        if(lane==='afterLyrics'&&!system.querySelector('.lyrics-line'))continue;
        if(lane==='afterVocal'&&!system.querySelector('.vocal-track'))continue;
        let node=system.querySelector(`[data-annotation-boundary="${lane}"]`);
        if(!node){node=document.createElement('div');node.className='annotation-boundary-space';node.dataset.annotationBoundary=lane;node.setAttribute('aria-hidden','true');system.append(node);}
        node.style.gridColumn='1 / -1';node.style.height='0px';node.style.pointerEvents='none';
      }
    }
  }
  function reserve(paper,layers,annotationLayout){
    if(!Layout)return;
    appendBoundaryNodes(paper);
    const g=geometry(paper);if(!g)return;
    const items=activeItems(layers).filter(item=>item.layoutTarget!=='page');
    const visibleKeys=new Set(items.map(item=>item.layoutPlacement?.boundaryKey||item.layoutBoundaryKey).filter(Boolean));
    const boundaries=Object.fromEntries(Object.entries(annotationLayout?.boundaries||{}).filter(([key])=>visibleKeys.has(key)));
    const adapted=layoutGeometry(g);
    const effective=Layout.effectivePixelGaps(adapted,{version:2,unit:'staff-line',boundaries},items);
    // Map gaps into the same boundary in which the editor inserts them.
    // The CSS grid tracks make each gap independent, so a comment in the
    // vocal lane cannot add height twice to an entire score-system.
    g.rows.forEach((row,i)=>{
      const hasLyrics=!!row.lyrics,hasVocal=!!row.vocal;
      const raw=lane=>Math.max(0,Math.ceil(number(effective.gaps.get(`${i}:${lane}`))));
      const before= i===0?raw('beforeScore'):0;
      const afterScore=raw('afterScore');
      const afterLyrics=hasLyrics?raw('afterLyrics'):0;
      const afterVocal=hasVocal?raw('afterVocal'):0;
      const parts=[`${before}px`,'138px',`${afterScore}px`];
      let rowIndex=4;
      const positions={beforeScore:1,score:2,afterScore:3};
      if(hasLyrics){positions.lyrics=rowIndex;parts.push('46px');rowIndex++;positions.afterLyrics=rowIndex;parts.push(`${afterLyrics}px`);rowIndex++;}
      if(hasVocal){positions.vocal=rowIndex;parts.push('64px');rowIndex++;positions.afterVocal=rowIndex;parts.push(`${afterVocal}px`);}
      row.system.style.gridTemplateRows=parts.join(' ');
      row.system.style.margin='0';
      row.system.style.minHeight='0px';
      row.score.style.gridRow=positions.score;
      const labels=row.system.querySelector('.string-labels');if(labels)labels.style.gridRow=positions.score;
      if(row.lyrics){row.lyrics.style.gridRow=positions.lyrics;const lab=row.system.querySelector('.lyrics-label');if(lab)lab.style.gridRow=positions.lyrics;}
      if(row.vocal){row.vocal.style.gridRow=positions.vocal;const lab=row.system.querySelector('.vocal-label');if(lab)lab.style.gridRow=positions.vocal;}
      for(const [lane,track] of Object.entries(positions)){
        const spacer=row.system.querySelector(`[data-annotation-boundary="${lane}"]`);
        if(!spacer)continue;
        spacer.style.gridRow=track;
        spacer.style.height=(lane==='beforeScore'?before:lane==='afterScore'?afterScore:lane==='afterLyrics'?afterLyrics:afterVocal)+'px';
      }
    });
    return {geometry:g,gaps:effective.gaps};
  }
  function mapper(paper,legacy){
    const g=geometry(paper);
    if(!g)return legacy;
    return {
      ...legacy,
      mapItemPoint(item,x,y){return mapFromAnchor(item,x,y,g)||legacy.mapItemPoint(item,x,y);},
      commentTop(item){return placementTop(item,g);},
      usesCreatorGeometry:true
    };
  }
  global.CreatorAnnotationPort={geometry,clientFromAnchor,sourcePoints,mapFromAnchor,placementTop,reserve,mapper};
})(window);
