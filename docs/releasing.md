# Releasing

Releases are stable. The exact same VSIX goes to the Visual Studio Marketplace, Open VSX, and
GitHub.

Before tagging:

```sh
npm run verify
npm run test:docs
npm run package
npm run check:release-reproducibility
npm run test:vsix:prepared
```

The final VSIX must be tested and approved. Required checks on `main` must pass. `CHANGELOG.md` must
match the package version and date.

Create an annotated tag and push it:

```sh
release_version=$(node -p "require('./package.json').version")
git tag -a "v$release_version" -m "VHS $release_version"
git push origin "v$release_version"
```

The release workflow reproduces and tests the artifacts, creates checksums, a CycloneDX SBOM, and
attestations, publishes both registries, verifies them, then publishes the GitHub release. Never
move or reuse a published tag or version.
