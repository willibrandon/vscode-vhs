# Development container

Use **Dev Containers: Rebuild and Reopen in Container**, then run:

```sh
bash .devcontainer/verify.sh
```

The container pins Node.js, npm, VHS, ttyd, and the upstream source revisions. The verification
script tests source and packaged desktop, browser, and Remote SSH hosts.

Named volumes keep generated files and editor downloads out of the host checkout. The host Docker
socket is mounted for Remote SSH tests, so the container can control that Docker host.
