# 登录系统 Demo（FastAPI + MySQL）

## 项目结构

```
demo/
├── main.py          # 主程序，API 路由
├── database.py      # 数据库连接
├── models.py        # 数据表模型
├── schemas.py       # 请求/响应结构
├── auth.py          # 密码加密 & JWT
├── init.sql         # 数据库初始化 SQL
├── requirements.txt # 依赖列表
└── .env.example     # 环境变量示例
```

---

## 快速启动

### 第一步：创建数据库

在 MySQL 中执行：
```sql
CREATE DATABASE auth_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```
或直接运行：
```bash
mysql -u root -p < init.sql
```

---

### 第二步：配置环境变量

```bash
# 复制示例文件
cp .env.example .env

# 编辑 .env，填入你的 MySQL 密码
DATABASE_URL=mysql+pymysql://root:你的密码@localhost:3306/auth_demo
SECRET_KEY=随便一个长字符串
```

---

### 第三步：安装依赖

```bash
pip install -r requirements.txt
```

---

### 第四步：启动服务

```bash
uvicorn main:app --reload
```

服务启动后访问：
- 接口文档：http://127.0.0.1:8000/docs
- 健康检查：http://127.0.0.1:8000/

---

## 接口说明

| 方法 | 路径 | 说明 | 是否需要登录 |
|------|------|------|------------|
| GET  | `/` | 健康检查 | 否 |
| POST | `/register` | 用户注册 | 否 |
| POST | `/login` | 用户登录 | 否 |
| GET  | `/me` | 获取当前用户信息 | ✅ 是 |

---

## 接口示例

### 注册
```bash
curl -X POST http://localhost:8000/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","username":"testuser","password":"123456"}'
```

### 登录
```bash
curl -X POST http://localhost:8000/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"123456"}'                                                                                                                                                                                                                                                                                   

  

# 返回：{"access_token": "eyJ...", "token_type": "bearer"}
```

### 获取用户信息
```bash
curl http://localhost:8000/me \
  -H "Authorization: Bearer 你的token"
```

---

## 技术栈

| 组件 | 说明 |
|------|------|
| FastAPI | Web 框架，自动生成 API 文档 |
| SQLAlchemy | ORM，自动建表 |
| PyMySQL | MySQL 驱动 |
| bcrypt | 密码哈希（安全存储） |
| PyJWT | JWT Token 生成与验证 |
| python-dotenv | 环境变量管理 |

---

## Docker 部署

项目里已经补了一套 Docker 配置，目标是让本地和服务器尽量使用同一套环境。

### 包含的文件

```text
demo/
├── Dockerfile
├── docker-compose.yml
├── .env.docker.example
└── .dockerignore
```

### 这套 Docker 是怎么工作的

- `db` 服务：使用 `mysql:8.0`，自动执行 [init.sql](/home/zzq/workspace/ai-workflow/demo/init.sql)
- `app` 服务：先在 Node 环境里构建 React 登录页，再在 Python 环境里启动 FastAPI
- FastAPI 容器会直接提供：
  - `/auth`：React 登录页
  - `/portal`：门户静态页
  - `/login`、`/register`、`/me`：后端接口

也就是说，容器启动后你只需要访问：

- `http://127.0.0.1:8000/auth`
- `http://127.0.0.1:8000/docs`

### 本地启动步骤

1. 复制 Docker 环境变量模板

```bash
cp .env.docker.example .env.docker
```

2. 按需修改 `.env.docker`

重点是这几个变量：

```bash
MYSQL_ROOT_PASSWORD=root_password
MYSQL_USER=app_user
MYSQL_PASSWORD=app_password
DATABASE_URL=mysql+pymysql://app_user:app_password@db:3306/auth_demo
SECRET_KEY=replace-with-a-long-random-string
```

注意：
- `DATABASE_URL` 里的主机名必须是 `db`
- 不能写 `localhost`
- 因为 Docker Compose 内部是通过服务名互相访问

3. 构建并启动

```bash
docker compose up -d --build
```

4. 查看运行状态

```bash
docker compose ps
docker compose logs -f app
docker compose logs -f db
```

5. 停止服务

```bash
docker compose down
```

如果你还想连数据库数据一起清掉：

```bash
docker compose down -v
```

### 服务器部署步骤

服务器上也使用完全一样的流程：

1. 安装 Docker 和 Docker Compose
2. 拉取最新代码

```bash
git pull
```

3. 准备服务器专用环境变量

```bash
cp .env.docker.example .env.docker
```

然后把密码、密钥改成服务器自己的值。

4. 启动或更新

```bash
docker compose up -d --build
```

以后更新代码时，流程就是：

```bash
git pull
docker compose up -d --build
```

### 为什么这样能尽量保证和服务器一致

- 本地和服务器都使用同一个 `Dockerfile`
- 本地和服务器都使用同一个 `docker-compose.yml`
- MySQL 版本固定为 `8.0`
- Python 和 Node 版本固定在镜像里
- 前端构建和后端启动都在容器内完成

这样你本地不需要依赖宿主机的 Python、Node、MySQL 版本。

### 常用命令

重新构建应用：

```bash
docker compose build app
docker compose up -d app
```

进入应用容器：

```bash
docker compose exec app bash
```

进入数据库容器：

```bash
docker compose exec db mysql -uroot -p
```

查看接口是否正常：

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/auth
```
