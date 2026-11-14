import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { sharpNativePackage } from '../../scripts/verificationRuntime'
function fixture() {
 const base=mkdtempSync(join(tmpdir(),'xiumi-native-verifier-'))
 const root=join(base,'unpacked'),sharp=join(root,'app/node_modules/sharp')
 mkdirSync(sharp,{recursive:true});writeFileSync(join(sharp,'package.json'),JSON.stringify({name:'sharp'}))
 return {base,root,sharp}
}
function native(dir:string) {mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'package.json'),JSON.stringify({name:'@img/sharp-win32-x64',exports:{'./package':'./package.json'}}))}
it('resolves native package from the actual nested Sharp dependency',()=>{
 const f=fixture();try {const dir=join(f.sharp,'node_modules/@img/sharp-win32-x64');native(dir);expect(sharpNativePackage(f.root)).toBe(join(dir,'package.json'))}finally{rmSync(f.base,{recursive:true,force:true})}
})
it('continues supporting flat native dependencies',()=>{
 const f=fixture();try {const dir=join(f.root,'app/node_modules/@img/sharp-win32-x64');native(dir);expect(sharpNativePackage(f.root)).toBe(join(dir,'package.json'))}finally{rmSync(f.base,{recursive:true,force:true})}
})
it('rejects resolved packages outside the unpacked root',()=>{
 const f=fixture();try {const outside=join(f.base,'outside');native(outside);const parent=join(f.root,'app/node_modules/@img');mkdirSync(parent,{recursive:true});symlinkSync(outside,join(parent,'sharp-win32-x64'),'junction');expect(()=>sharpNativePackage(f.root)).toThrow('outside unpacked root')}finally{rmSync(f.base,{recursive:true,force:true})}
})
it('rejects missing native dependencies',()=>{
 const f=fixture();try{expect(()=>sharpNativePackage(f.root)).toThrow()}finally{rmSync(f.base,{recursive:true,force:true})}
})
