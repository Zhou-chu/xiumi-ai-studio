import type { DocOp } from '../core/types'
export interface ReviewRect { left:number; top:number; right:number; bottom:number }
export interface ReviewPoint { index:number; x:number; y:number; slot?:string }
export function placeReviewBubble(anchor: ReviewRect, viewport: {width:number;height:number}, size: {width:number;height:number}) {
 const pad=8
 const left=Math.max(pad,Math.min(anchor.right+8,viewport.width-size.width-pad))
 const below=anchor.bottom+8
 const top=Math.max(pad,Math.min(below+size.height<=viewport.height-pad?below:anchor.top-size.height-8,viewport.height-size.height-pad))
 return {left,top}
}
export function groupReviewMarkers(points: ReviewPoint[]) {
 const groups:Array<{x:number;y:number;indices:number[];slot?:string}>=[]
 for(const p of points){
  const near=groups.find(g=>Math.abs(g.x-p.x)<28&&Math.abs(g.y-p.y)<28)
  if(near){if(!near.indices.includes(p.index))near.indices.push(p.index)}
  else groups.push({x:p.x,y:p.y,indices:[p.index],slot:p.slot})
 }
 return groups
}

export function selectReviewAnchor<T extends ReviewPoint>(anchors:T[], index:number | null, slot:string | null):T | undefined {
 return anchors.find(anchor=>anchor.index===index && (slot===null || anchor.slot===slot))
}
export function reviewHeading(op:DocOp,index:number,total:number):string {
 const role = op.op==='update' ? (op.slots || 'content' in op.props ? '文字修改' : '内容修改') :
  ({insert:'插入模块',remove:'删除模块',move:'移动模块',setMeta:'文章信息',setTheme:'主题调整'} as const)[op.op]
 return `${role} · ${index+1}/${total}`
}
