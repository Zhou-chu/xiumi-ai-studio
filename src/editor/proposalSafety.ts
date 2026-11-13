import type { Doc, DocOp } from '../core/types'
import type { Proposal } from './store'
import { applyOp, validateOp } from '../core/ops'
import { findBlock } from '../core/tree'
import { skeleton, slotRawTexts } from '../core/slots'

const same = (a: unknown,b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const changed = '对应内容已变化，请重新生成修改建议'
type Path = (string | number)[]
function leaves(before: any,after: any,path: Path = []): Path[] {
  if (same(before,after)) return []
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after) && (!Array.isArray(after) || before.length === after.length)) {
    const keys = new Set([...Object.keys(before),...Object.keys(after)])
    return [...keys].flatMap(key=>leaves(before[key],after[key],[...path,key]))
  }
  return [path]
}
const at = (value:any,path:Path):any => path.reduce((v,k)=>v?.[k],value)
/** A matching undefined leaf is insufficient when its parent was removed.
 * Arrays are positional: require shape and stable identities, and reject detected
 * permutations. Primitive arrays have no identity, so conservatively require equality.
 */
function ancestorsMatch(before:any,current:any,path:Path):boolean {
  let a=before,b=current
  for(const key of path) {
    if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false
    if(Array.isArray(a)) {
      if(a.length!==b.length)return false
      if(a.some(item=>!item||typeof item!=='object')) { if(!same(a,b))return false }
      else {
        if(a.some((item,i)=>!b[i]||typeof b[i]!=='object'||['id','image'].some(k=>!same(item[k],b[i][k]))))return false
        // Detect reordering even for records without a stable ID (e.g. empty photos).
        if(a.some((item,i)=>!same(item,b[i])&&b.some((other:any,j:number)=>j!==i&&same(item,other))))return false
      }
    }
    a=a[key];b=b[key]
  }
  return true
}
function put(value:any,path:Path,next:any) {
  if (!path.length) return structuredClone(next)
  const copy=structuredClone(value)
  let cursor=copy
  for(const key of path.slice(0,-1)) cursor=cursor[key]
  const key=path[path.length-1]
  if(next===undefined) delete cursor[key]
  else cursor[key]=structuredClone(next)
  return copy
}

/** Field-level guards shared by the UI and the authoritative store resolver. */
export function getProposalItemIssue(proposal:Proposal,doc:Doc,index:number):string|null {
  const item=proposal.items[index]
  if(!Number.isInteger(index)||!item) return '修改建议不存在'
  if(item.status!=='pending') return item.error ?? '此建议已处理'
  if(doc.id!==proposal.base.id) return '当前文稿已切换'
  const op=item.op, base=proposal.base
  if(op.op==='update'||op.op==='remove'||op.op==='move') {
    const old=findBlock(base.blocks,op.id)?.block,now=findBlock(doc.blocks,op.id)?.block
    if(!old||!now||old.type!==now.type) return '对应内容已删除或更换'
    if(op.op!=='update') {
      if(!same(old,now)) return changed
    } else if(old.type==='html' && now.type==='html') {
      if(skeleton(old.props.html)!==skeleton(now.props.html)) return changed
      const a=slotRawTexts(old.props.html),b=slotRawTexts(now.props.html)
      if(!same(Object.keys(a),Object.keys(b))) return changed
      if(Object.keys(op.slots??{}).some(key=>!(key in a)||a[key]!==b[key]))return changed
    } else {
      for(const key of Object.keys(op.props)) {
        const a=(old.props as any)[key], b=(now.props as any)[key]
        if(leaves(a,op.props[key]).some(path=>!ancestorsMatch(a,b,path)||!same(at(a,path),at(b,path)))) return changed
      }
    }
  }
  if(op.op==='insert'||op.op==='move') {
    const acceptedInserts=new Set(proposal.items.filter(i=>i.status==='accepted'&&i.op.op==='insert').map(i=>(i.op as Extract<DocOp,{op:'insert'}>).block.id))
    if(!same(doc.blocks.filter(b=>!acceptedInserts.has(b.id)).map(b=>b.id),base.blocks.map(b=>b.id)))return '文稿顺序已变化，请重新生成建议'
  }
  if(op.op==='setMeta') for(const key of ['title','digest','author'] as const) {
    if(op[key]!==undefined&&!same(base[key],doc[key]))return changed
  }
  if(op.op==='setTheme'&&(!same(base.themeId,doc.themeId)||!same(base.themeOverrides,doc.themeOverrides)))return changed
  return null
}

/** Preserve independently edited leaves while applying only this proposal's delta. */
export function rebaseProposalOp(proposal:Proposal,doc:Doc,index:number):DocOp {
  const op=proposal.items[index].op
  if(op.op==='insert') {
    const next=proposal.base.blocks[op.index]
    return {...op,index:next?doc.blocks.findIndex(b=>b.id===next.id):doc.blocks.length}
  }
  if(op.op!=='update')return op
  const old=findBlock(proposal.base.blocks,op.id)!.block,now=findBlock(doc.blocks,op.id)!.block
  if(old.type==='html')return op // validateOp fills slots against current HTML.
  const props:Record<string,any>={}
  for(const key of Object.keys(op.props)) {
    const before=(old.props as any)[key]
    let value=(now.props as any)[key]
    for(const path of leaves(before,op.props[key]))value=put(value,path,at(op.props[key],path))
    props[key]=value
  }
  return {...op,props}
}

/** Side-effect-free preview of the exact sequential acceptance rules used by the store.
 * Never apply cached raw HTML/props: validation must refill slots against current content.
 */
export function previewProposal(proposal:Proposal,doc:Doc):Doc {
  const items=proposal.items.map(item=>({...item}))
  let next=doc
  for(let index=0;index<items.length;index++) {
    if(items[index].status!=='pending')continue
    const working={...proposal,items}
    const issue=getProposalItemIssue(working,next,index)
    if(issue) {items[index]={...items[index],status:'stale',error:issue};continue}
    const rebased=rebaseProposalOp(working,next,index)
    const {op,error}=validateOp(next,rebased)
    if(!op) {items[index]={...items[index],status:'stale',error};continue}
    if(op.op==='insert'&&rebased.op==='insert')op.block.id=rebased.block.id
    next=applyOp(next,op)
    items[index]={...items[index],status:'accepted'}
  }
  return next
}
