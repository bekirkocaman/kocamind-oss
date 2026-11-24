// Firebase Auth + Firestore emülatörlerini başlatır; ikisi de cevap verince 4401 portunda
// "hazır" sinyali açar (Playwright webServer tek bir adresi bekleyebildiği için).
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const cli = path.join(root, 'kocamind-web', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js')
const child = spawn(process.execPath, [cli, 'emulators:start', '--only', 'auth,firestore', '--project', 'demo-kocamind'], { cwd: root, stdio: 'inherit' })
child.on('exit', code => process.exit(code ?? 1))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))

const up = url => fetch(url).then(() => true, () => false)
while (!(await up('http://127.0.0.1:9099/')) || !(await up('http://127.0.0.1:8080/'))) {
  await new Promise(resolve => setTimeout(resolve, 500))
}
http.createServer((req, res) => res.end('hazır')).listen(4401, '127.0.0.1')
