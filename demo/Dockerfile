FROM node:20-alpine AS frontend-build

WORKDIR /frontend
COPY case-前端页面设计/login-app/package*.json ./
RUN npm ci
COPY case-前端页面设计/login-app/ ./
RUN npm run build

FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends default-libmysqlclient-dev build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY auth.py ./
COPY database.py ./
COPY main.py ./
COPY models.py ./
COPY schemas.py ./
COPY init.sql ./
COPY fristlog.html ./
COPY static ./static
COPY .env.example ./.env.example
COPY case-前端页面设计/login-app/package.json ./case-前端页面设计/login-app/package.json
COPY --from=frontend-build /frontend/build ./case-前端页面设计/login-app/build

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
