import { compileBlock, compileDoc, rootStyle } from '../core/compiler'
import { applyOp, validateOp } from '../core/ops'
import { resolveTheme } from '../core/themes'
import { findBlock } from '../core/tree'
import type { Doc } from '../core/types'
import type { Proposal } from './store'
import { getProposalItemIssue, rebaseProposalOp } from './proposalSafety'

export function reviewInsertionAnchor(doc:Doc,index:number):string|null { return doc.blocks[index]?.id ?? null }
const escape=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
/** Pure display projection. Only the store's resolveProposal can mutate the real draft. */
export function buildReviewDisplay(proposal:Proposal,doc:Doc,index:number,inBox=false) {
 const item=proposal.items[index]
 const issue=getProposalItemIssue(proposal,doc,index)
 const current=issue?proposal.base:doc
 const raw=issue?item.op:rebaseProposalOp(proposal,doc,index)
 const {op,error}=validateOp(current,raw)
 const base={kind:item.op.op,issue:issue||error||null,applicable:!issue&&!error&&item.status==='pending'}
 if(!op||op.op==='remove')return {...base,html:null}
 const next=applyOp(current,op)
 if(op.op==='setTheme')return {...base,html:compileDoc(next).html}
 if(op.op==='setMeta')return {...base,html:`<section style="${rootStyle(resolveTheme(next))}"><h2>${escape(next.title)}</h2><p>${escape(next.author)}</p><p>${escape(next.digest)}</p></section>`}
 const block=op.op==='insert'?op.block:findBlock(next.blocks,op.id)?.block
 if(!block)return {...base,html:null}
 const theme=resolveTheme(next)
 return {...base,html:`<section style="${rootStyle(theme)}">${compileBlock(block,theme,{hints:true,inBox})}</section>`}
}
