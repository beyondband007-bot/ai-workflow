ARG NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:20.20.0-bookworm

FROM ${NODE_BASE_IMAGE}

WORKDIR /app

COPY WF-003/car-export-portal/package*.json ./
RUN npm ci --omit=dev

COPY WF-003/car-export-portal/ ./

EXPOSE 3001

CMD ["npm", "start"]
