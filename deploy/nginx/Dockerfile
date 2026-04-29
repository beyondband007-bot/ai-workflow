ARG NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:20.20.0-bookworm
ARG NGINX_BASE_IMAGE=docker.m.daocloud.io/library/nginx:1.24.0
ARG WF002_NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:24-alpine
ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM ${NODE_BASE_IMAGE} AS auth-build

WORKDIR /build/auth

COPY demo/case-前端页面设计/login-app/package*.json ./
RUN npm config set registry ${NPM_REGISTRY} \
    && npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm install

COPY demo/case-前端页面设计/login-app/ ./
RUN npm run build

FROM ${WF002_NODE_BASE_IMAGE} AS wf002-build

WORKDIR /build/wf002

COPY WF_002/BaoyuSkill/ ./
RUN npm config set registry ${NPM_REGISTRY} \
    && npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm ci
RUN VITE_BASE_PATH=/portal/wf002/ npm run build -w apps/web

FROM ${NGINX_BASE_IMAGE}

COPY deploy/nginx/ai-workflow.docker.conf /etc/nginx/conf.d/default.conf
COPY demo/fristlog.html /srv/landing/fristlog.html
COPY client-portal /srv/portal
COPY --from=auth-build /build/auth/build /srv/auth
COPY --from=wf002-build /build/wf002/apps/web/dist /srv/wf002
