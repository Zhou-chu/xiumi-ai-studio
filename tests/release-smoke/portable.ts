import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { readFile, realpath } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import process from 'node:process'

async function freePort() {
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const address = probe.address()
  await new Promise<void>((done, reject) => probe.close(error => error ? reject(error) : done()))
  if (!address || typeof address === 'string') throw new Error('Missing smoke port')
  return address.port
}

async function sha256(file: string) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

export async function exercisePortable(
  root: string,
  data: string | undefined,
  provide: (origin: string, distPath: string) => Promise<void>,
  launchCwd = data ?? tmpdir(),
  localAppData?: string,
) {
  if (process.platform !== 'win32') throw new Error('Windows portable smoke cannot substitute a non-Windows runner')
  const checkout = (await realpath(process.cwd())).toLowerCase()
  const unpacked = await realpath(root)
  if (unpacked.toLowerCase() === checkout || unpacked.toLowerCase().startsWith(checkout + sep)) {
    throw new Error('Run the extracted archive outside the source tree')
  }
  const receipt = JSON.parse(await readFile(join(unpacked, 'build.json'), 'utf8'))
  const expected = process.env.XIUMI_PORTABLE_EXPECTED_SHA
  const trackedTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim()
  const executable = join(unpacked, 'XIUMI AI Studio.exe')
  if (!expected || receipt.commit !== expected || receipt.tree !== trackedTree ||
      receipt.launcherSha256 !== await sha256(executable) ||
      receipt.runtimeSha256 !== await sha256(join(unpacked, 'runtime', 'node.exe'))) {
    throw new Error('The unpacked artifact does not match the pinned candidate')
  }

  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  const env: NodeJS.ProcessEnv = { ...process.env, API_PORT: String(port) }
  for (const key of Object.keys(env)) {
    if (/^(?:AI_|WECHAT_|NODE_(?:PATH|OPTIONS)$|DATA_DIR$)/i.test(key)) delete env[key]
  }
  if (localAppData !== undefined) {
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'LOCALAPPDATA') delete env[key]
    env.LOCALAPPDATA = localAppData
  }
  if (data !== undefined) env.DATA_DIR = resolve(data)
  const child = spawn(executable, [], { cwd: launchCwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const stderrLimit = 2048
  let stderr = Buffer.alloc(0)
  child.stderr.on('data', (chunk: Buffer) => {
    const remaining = stderrLimit - stderr.length
    if (remaining > 0) stderr = Buffer.concat([stderr, chunk.subarray(0, remaining)])
  })
  try {
    await new Promise<void>((done, reject) => {
      const lines = createInterface({ input: child.stdout })
      const timeout = setTimeout(() => finish(new Error('Packaged EXE did not announce its loopback listener')), 12_000)
      const onClose = (code: number | null) => {
        // Keep launcher failures legible without leaking arbitrary child stderr.
        const category = /^XIUMI_PORTABLE_APPDATA:(profile-path|application-directory-preflight|application-directory-create|application-directory-verification)\r?$/m
          .exec(stderr.toString('utf8'))?.[1]
        finish(new Error(`Packaged EXE exited before ready (exit ${code ?? 'unknown'}${category ? ', AppData ' + category : ''})`))
      }
      const onError = () => finish(new Error('Could not start the packaged EXE'))
      function finish(error?: Error) {
        clearTimeout(timeout)
        child.off('close', onClose).off('error', onError)
        lines.close()
        if (error) reject(error)
        else done()
      }
      lines.on('line', line => {
        if (line.startsWith(`XIUMI AI Studio API ${origin} `)) finish()
      })
      child.once('close', onClose).once('error', onError)
    })
    await provide(origin, join(unpacked, 'app', 'dist', 'index.html'))
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      try {
        const taskkill = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'taskkill.exe')
        execFileSync(taskkill, ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', timeout: 8_000 })
      } catch {
        if (child.exitCode === null && child.signalCode === null) child.kill()
      }
      await exited
    }
  }
}
