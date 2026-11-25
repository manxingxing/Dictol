/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
// Run with Electron: electron tests/main/window-position-only.cjs
const { app, BrowserWindow } = require('electron')
const os = require('node:os')
const path = require('node:path')
app.setPath('userData', path.join(os.tmpdir(), `dictol-position-only-${process.pid}`))
app.on('window-all-closed', (event) => event.preventDefault())
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  for (const method of ['setBounds-position-only', 'setPosition']) {
    const window = new BrowserWindow({
      width: 520, height: 600, frame: false, show: false,
      resizable: true, backgroundMaterial: 'mica',
      webPreferences: { sandbox: true }
    })
    await window.loadURL('data:text/html,<body>Position-only API diagnostic</body>')
    window.showInactive()
    const sizes = [window.getSize()]
    for (let i = 0; i < 20; i++) {
      const x = 500 + (i % 2) * 80
      const y = 100
      if (method === 'setBounds-position-only') window.setBounds({ x, y }, false)
      else window.setPosition(x, y, false)
      await wait(20)
      sizes.push(window.getSize())
    }
    console.log(JSON.stringify({ method, sizes }))
    window.destroy()
  }
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
