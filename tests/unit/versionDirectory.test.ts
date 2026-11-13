import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { collection } from '../../server/store'

it('creates per-project version storage before the first list and save', async () => {
  const root=await mkdtemp(join(tmpdir(),'xiumi-version-directory-'))
  try {
    const versions=collection<{id:string;label:string}>(join(root,'versions','new-project'))
    expect(await versions.list()).toEqual([])
    await versions.put({id:'first-version',label:'initial snapshot'})
    expect(await versions.list()).toEqual([{id:'first-version',label:'initial snapshot'}])
    expect(await versions.get('first-version')).toEqual({id:'first-version',label:'initial snapshot'})
  } finally { await rm(root,{recursive:true,force:true}) }
})
