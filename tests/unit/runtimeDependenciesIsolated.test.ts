import { beforeEach, expect, it, vi } from 'vitest'
import { dirname, join, resolve } from 'node:path'
const h=vi.hoisted(()=>({exists:vi.fn(),real:vi.fn(),read:vi.fn(),mkdir:vi.fn(),copy:vi.fn()}))
vi.mock('node:fs',()=>({existsSync:h.exists,realpathSync:h.real,readFileSync:h.read,mkdirSync:h.mkdir}))
vi.mock('../../scripts/fsutil',()=>({copyDir:h.copy}))
import { copyRuntimeDependencies } from '../../scripts/runtimeDependencies'
const source=resolve('/virtual-runtime'), modules=join(source,'node_modules')
const mirror=join(resolve('/virtual-packaged'),'node_modules')
const packages=new Map<string,{dir:string;manifest:string}>()
const packageAt=(path:string,meta:object|string={},real=path)=>{
  packages.set(join(path,'package.json'),{dir:real,manifest:typeof meta==='string'?meta:JSON.stringify(meta)})
}
beforeEach(()=>{
  packages.clear()
  for(const stub of Object.values(h))stub.mockReset()
  h.exists.mockImplementation((path:string)=>packages.has(path))
  h.real.mockImplementation((path:string)=>{
    const fixture=packages.get(join(path,'package.json'))
    if(!fixture)throw Error('Unexpected realpath fixture probe')
    return fixture.dir
  })
  h.read.mockImplementation((path:string,encoding:string)=>{
    if(encoding!=='utf8')throw Error('Unexpected fixture encoding')
    const fixture=packages.get(path)
    if(!fixture)throw Error('Unexpected fixture read')
    return fixture.manifest
  })
})
const excludes=new Set(['node_modules','.git'])

it('rejects a non-node_modules destination before filesystem access',()=>{
  expect(()=>copyRuntimeDependencies(['a'],source,dirname(mirror))).toThrow('Runtime destination must be a node_modules directory')
  expect(h.exists).not.toHaveBeenCalled(); expect(h.copy).not.toHaveBeenCalled(); expect(h.mkdir).not.toHaveBeenCalled()
})
it('preserves independent resolutions for nested dependencies, including scoped package paths',()=>{
  const alpha=join(modules,'alpha'), beta=join(modules,'beta'), x=join(alpha,'node_modules','@scope','shared'), y=join(beta,'node_modules','@scope','shared')
  packageAt(alpha,{dependencies:{'@scope/shared':'1'}})
  packageAt(beta,{dependencies:{'@scope/shared':'2'}})
  packageAt(x); packageAt(y)
  expect([...copyRuntimeDependencies(['alpha','beta'],source,mirror)]).toEqual(['alpha','@scope/shared','beta'])
  const paths=[[alpha,join(mirror,'alpha')],[x,join(mirror,'alpha','node_modules','@scope','shared')],[beta,join(mirror,'beta')],[y,join(mirror,'beta','node_modules','@scope','shared')]]
  expect(h.copy.mock.calls).toEqual(paths.map(([from,to])=>[from,to,excludes]))
  expect(h.mkdir.mock.calls).toEqual(paths.map(([,to])=>[to,{recursive:true}]))
})
it('uses an ancestor sibling and stops a realpath cycle without copying it again',()=>{
  const a=join(modules,'a'), b=join(modules,'b')
  packageAt(a,{dependencies:{b:'1'}});packageAt(b,{dependencies:{a:'1'}})
  expect([...copyRuntimeDependencies(['a'],source,mirror)]).toEqual(['a','b'])
  expect(h.copy.mock.calls).toEqual([[a,join(mirror,'a'),excludes],[b,join(mirror,'a','node_modules','b'),excludes]])
})
it('skips an absent optional package but still copies an available optional package',()=>{
  const a=join(modules,'a'), native=join(modules,'native-fixture')
  packageAt(a,{optionalDependencies:{'other-platform':'1','native-fixture':'1'}});packageAt(native)
  expect([...copyRuntimeDependencies(['a'],source,mirror)]).toEqual(['a','native-fixture'])
  expect(h.copy.mock.calls).toEqual([[a,join(mirror,'a'),excludes],[native,join(mirror,'a','node_modules','native-fixture'),excludes]])
})
it('reports a missing required dependency and does not swallow a resolved optional copy error',()=>{
  const a=join(modules,'a'), native=join(modules,'native-fixture')
  packageAt(a,{dependencies:{missing:'1'}})
  expect(()=>copyRuntimeDependencies(['a'],source,mirror)).toThrow('Missing runtime dependency: missing')
  packageAt(a,{optionalDependencies:{'native-fixture':'1'}});packageAt(native)
  const denied=Error('synthetic copy error')
  h.copy.mockImplementationOnce(()=>{}).mockImplementationOnce(()=>{throw denied})
  expect(()=>copyRuntimeDependencies(['a'],source,mirror)).toThrow(denied)
})
