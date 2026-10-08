# tetris.ts Asset Manager

A local workspace app for inspecting and replacing game assets.

```sh
pnpm dev:assets
```

The UI runs at `http://localhost:5175`; its local asset API binds to loopback only (`http://127.0.0.1:4010`), and
writes are refused unless the request's Host is `localhost`, `127.0.0.1`, or `::1`.

## Registered types

- **Sounds**: `.ogg` effects and voice cues in `apps/tetris/resources/sounds`, mirrored to
  `packages/renderer/public/sounds`; usage is read from `packages/renderer/src/audio/manifest.ts`.
- **Music**: `.ogg` tracks (see below).
- **Images**: `.png` files in `apps/tetris/resources` (no mirrors).

## Using it

- **Play** previews audio; the row shows the track duration after the first hover or play.
- **Replace** swaps a file in place. You can also drop a single file onto a row.
- **Add** uploads a new file under its own name; **Delete** removes it from the source and every mirror.

Rows carry badges:

- **Unused**: the type's `usageSource` does not cite the filename.
- **Modified**: git reports uncommitted changes to the source or a mirror.
- **Out of sync**: a mirror is missing or differs from the source (size, then sha1). The content heading
  shows how many items are out of sync; replacing the asset rewrites every copy.

## Adding an asset type

Add one entry to `server/asset-registry.ts` (typed by `AssetTypeDefinition` in `server/types.ts`) with:

- a stable id and display metadata;
- the source directory and any generated/package mirrors;
- allowed extensions, content type, preview mode, and size limit;
- optional validation, filtering, badge functions, and a `usageSource`.

The shared store and UI catalogue use that registration automatically. Additions, replacements, and
deletions update the source plus every mirror together.

## Music tracks

The Music type stores `.ogg` tracks in `apps/tetris/resources/music` (mirrored to
`packages/renderer/public/music`). Adding a track here does **not** wire it into the game: edit
`MUSIC_TRACKS` in `packages/renderer/src/audio/manifest.ts` by hand to reference the new file.
