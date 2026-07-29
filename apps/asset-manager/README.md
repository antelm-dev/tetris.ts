# tetris.ts Asset Manager

A local workspace app for inspecting and replacing game assets.

```sh
pnpm dev:assets
```

The UI runs at `http://localhost:5175`; its local asset API runs at `http://localhost:4010`.

## Adding an asset type

Add one entry to `server/asset-registry.mjs` with:

- a stable id and display metadata;
- the source directory and any generated/package mirrors;
- allowed extensions, content type, preview mode, and size limit;
- optional validation, filtering, and badge functions.

The shared store and UI catalogue use that registration automatically. Replacements are restricted to
localhost and update the source plus every mirror together.
