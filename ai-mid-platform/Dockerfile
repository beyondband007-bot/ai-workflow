FROM python:3.12.3-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN ARCH="$(dpkg --print-architecture)" \
    && case "${ARCH}" in \
      amd64) NODE_ARCH='x64' ;; \
      arm64) NODE_ARCH='arm64' ;; \
      armhf) NODE_ARCH='armv7l' ;; \
      *) echo "Unsupported architecture: ${ARCH}" && exit 1 ;; \
    esac \
    && curl -fsSLO "https://nodejs.org/dist/v20.20.0/node-v20.20.0-linux-${NODE_ARCH}.tar.xz" \
    && tar -xJf "node-v20.20.0-linux-${NODE_ARCH}.tar.xz" -C /usr/local --strip-components=1 \
    && rm "node-v20.20.0-linux-${NODE_ARCH}.tar.xz" \
    && node -v \
    && npm -v

COPY ai-mid-platform/package*.json ./ai-mid-platform/
WORKDIR /app/ai-mid-platform
RUN npm ci

WORKDIR /app
COPY ai-mid-platform ./ai-mid-platform
COPY WF_001 ./WF_001
COPY WF-003 ./WF-003

WORKDIR /app/ai-mid-platform
RUN npm run build

EXPOSE 3002

CMD ["npm", "run", "start:prod"]
