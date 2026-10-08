import { createApp } from './app.ts'
import { assetRegistry } from './asset-registry.ts'
import { createAssetStore } from './asset-store.ts'

const app = createApp(createAssetStore(assetRegistry))
const port = Number(process.env.ASSET_MANAGER_PORT ?? 4010)

app.listen(port, '127.0.0.1', () => {
  console.log(`tetris.ts asset manager API listening on http://127.0.0.1:${port}`)
})
