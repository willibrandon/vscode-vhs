FROM node:24.19.0-trixie-slim@sha256:ab3eebe934147fee049b5eb83c570f68c849a13c930bdfa482de99fcdfa3b3de AS node-toolchain

RUN npm install --global npm@12.0.2 \
    && rm -rf -- /root/.npm

FROM docker:29.7.2-cli@sha256:000bb62ff495f986c9f5578eb67cc2cb98b91138eda81d7762d5371eb8a497fe AS docker-toolchain

FROM mcr.microsoft.com/devcontainers/base:2-trixie@sha256:025b74bb5f7ac53edd77e01aa7188c359aab100e23a2f6220bde50bbb9fd31dd

ARG TARGETARCH

COPY --from=node-toolchain /usr/local/bin/node /usr/local/bin/node
COPY --from=node-toolchain /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=docker-toolchain /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-toolchain /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx

RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update \
    && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install --yes --no-install-recommends \
        ca-certificates \
        chromium \
        curl \
        ffmpeg \
        git \
        jq \
        openssh-client \
        socat \
        xauth \
        xvfb \
    && case "$TARGETARCH" in \
        amd64) \
            vhs_arch=x86_64; \
            vhs_sha=99cb634587eaae0473c1ea377db80c3a048c27f99fe0a7febb1a1e8cb7ee5009; \
            ttyd_arch=x86_64; \
            ttyd_sha=8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55 ;; \
        arm64) \
            vhs_arch=arm64; \
            vhs_sha=af782cddbf844a377df6ea41c0e72339393fa021be3f6cb70a2f47d48675d92b; \
            ttyd_arch=aarch64; \
            ttyd_sha=b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165 ;; \
        *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
       esac \
    && curl --fail --location --silent --show-error \
        "https://github.com/charmbracelet/vhs/releases/download/v0.11.0/vhs_0.11.0_Linux_${vhs_arch}.tar.gz" \
        --output /tmp/vhs.tar.gz \
    && echo "${vhs_sha}  /tmp/vhs.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/vhs.tar.gz --strip-components 1 \
        --directory /usr/local/bin "vhs_0.11.0_Linux_${vhs_arch}/vhs" \
    && curl --fail --location --silent --show-error \
        "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.${ttyd_arch}" \
        --output /usr/local/bin/ttyd \
    && echo "${ttyd_sha}  /usr/local/bin/ttyd" | sha256sum --check --strict \
    && chmod 0755 /usr/local/bin/vhs /usr/local/bin/ttyd \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/vhs.tar.gz
