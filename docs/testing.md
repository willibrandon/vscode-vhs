# Testing

```sh
npm ci
npm run verify
```

| Command                    | Scope                                                        |
| -------------------------- | ------------------------------------------------------------ |
| `npm test`                 | Core, server, runner, grammar, policy, and package contracts |
| `npm run test:integration` | Desktop extension host                                       |
| `npm run test:web`         | Browser Worker extension host                                |
| `npm run test:vsix`        | Clean install and activation of the exact VSIX               |
| `npm run test:remote`      | Exact VSIX through Remote SSH                                |
| `npm run test:docs`        | Site, packaged grammar, and popup viewport matrix            |

CI covers Linux, macOS, Windows, minimum and current VS Code, Insiders, browser, Remote SSH, the
development container, pinned upstream data, CodeQL, dependency review, Picket, and artifact
reproduction.

`bash .devcontainer/verify.sh` runs the full Linux matrix with real VHS, ttyd, and ffmpeg.
