ARG NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:20.20.0-bookworm
ARG NGINX_BASE_IMAGE=docker.m.daocloud.io/library/nginx:1.24.0
ARG WF002_NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:24-alpine

FROM ${NODE_BASE_IMAGE} AS auth-build

WORKDIR /build/auth

COPY demo/case-前端页面设计/login-app/package*.json ./
RUN npm install

COPY demo/case-前端页面设计/login-app/ ./
RUN npm run build

FROM ${WF002_NODE_BASE_IMAGE} AS wf002-build

WORKDIR /build/wf002

COPY WF_002/BaoyuSkill/ ./
RUN npm install
RUN VITE_BASE_PATH=/portal/wf002/ npm run build -w apps/web

FROM ${NGINX_BASE_IMAGE}

COPY deploy/nginx/ai-workflow.docker.conf /etc/nginx/conf.d/default.conf
COPY demo/fristlog.html /srv/landing/fristlog.html
COPY demo/favicon.ico /srv/landing/favicon.ico
COPY demo/logo.png /srv/landing/logo.png
COPY client-portal /srv/portal
COPY --from=auth-build /build/auth/build /srv/auth
COPY --from=wf002-build /build/wf002/apps/web/dist /srv/wf002
RUN set -eu; \
    latest_wf002_js="$(find /srv/wf002/assets -maxdepth 1 -type f -name 'index-*.js' | sort | tail -n 1)"; \
    cp "$latest_wf002_js" /srv/wf002/assets/index-DvQbKf2n.js
