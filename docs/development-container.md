# Development container

Choose **Dev Containers: Rebuild and Reopen in Container**, then run:

```sh
bash .devcontainer/verify.sh
```

The image pins Node.js, npm, VHS 0.11.0, ttyd 1.7.7, and the reviewed upstream sources. It includes
ffmpeg, Chromium, Docker CLI, and Remote SSH test tools.

Generated files and caches use container volumes. The host Docker socket is mounted for Remote SSH
tests, so the container can control that Docker host. CI scans the built image with Picket.
