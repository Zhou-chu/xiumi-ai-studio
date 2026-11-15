import {expect,it} from 'vitest'
import sharp from 'sharp'
import {MAX_INPUT_PIXELS,withImageBudget} from '../../server/imageBudget'
it('uses the actual Sharp header pixel limit without decoding an oversized SVG',async()=>{
 const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8001" height="8000"></svg>')
 await expect(withImageBudget(()=>sharp(svg,{limitInputPixels:MAX_INPUT_PIXELS}).metadata())).rejects.toMatchObject({status:413})
 const meta=await withImageBudget(()=>sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="6000"></svg>'),{limitInputPixels:MAX_INPUT_PIXELS}).metadata());expect(meta.width! * meta.height!).toBe(48_000_000)
})
