<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
specs/006-double-click-open-model/plan.md
<!-- SPECKIT END -->

## Key Commands

```bash
npm run build-all        # Build Angular client + extension bundle
npm run build:extension  # esbuild bundle only
npm run package:vsix     # Package as VSIX → extension/dist/*.vsix
npm run lint             # ESLint on extension/src
npm run test             # Extension tests
```

### Packaging and Release

- VSIX output: `extension/dist/ontograph-editor-extension-{version}.vsix`
- Publish manually: `(cd extension && npx vsce publish --pat $VSCE_PAT)`
- CI auto-publish: push a version tag — `.github/workflows/release.yml` triggers on `v*.*.*` tags
- Set `VSCE_PAT` as a GitHub repository secret before CI publishing works
