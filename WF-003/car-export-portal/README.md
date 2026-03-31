# 汇驰智联二手车出海素材提交页

这套页面和本地转发服务都在 `car-export-portal` 目录内。

主要文件：

- [index.html](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/index.html)
- [style.css](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/style.css)
- [script.js](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/script.js)
- [server.js](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/server.js)
- [ui-assets](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/ui-assets)
- [ASSET_MAP.md](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/ASSET_MAP.md)
- [asset-map.json](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/asset-map.json)

## 启动方式

进入目录：

```powershell
cd C:\Users\27256\Documents\Codex\项目测试\car-export-portal
```

配置 N8N webhook 地址：

```powershell
$env:CAR_EXPORT_WEBHOOK_URL="你的 n8n webhook 地址"
```

如果不显式设置环境变量，服务默认转发到正式版地址：

```text
https://n8n.deepsix.store/webhook/bda7b6ac-10b6-4467-b6fd-83dd68c0bbd9
```

先安装依赖：

```powershell
npm install
```

启动：

```powershell
node server.js
```

默认访问地址：

```text
http://localhost:3001
```

局域网访问：

```text
http://你的局域网IP:3001
```

## 当前前端字段

前端提交到本地服务 `/api/car-export-submit` 的字段是：

- `car_name`
- `exterior_images`
- `interior_images`
- `logo`

说明：

- `exterior_images` 是重复提交的多文件字段
- `interior_images` 是重复提交的多文件字段

## 本地服务转发规则

[server.js](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/server.js) 会自动把前端字段转换后再转发给 N8N：

- `exterior_images` -> `exterior_1`, `exterior_2`, `exterior_3` ...
- `interior_images` -> `interior_1`, `interior_2`, `interior_3` ...
- `car_name` 原样转发
- `logo` 原样转发

这样做的目的，是让前端支持不限数量上传，同时兼容当前 N8N 工作流按编号识别图片字段的逻辑。

## 服务器图片 URL

当前服务会先把上传图片保存到服务器本地目录：

- `car-export-portal/uploads`

然后返回你自己服务器的图片地址。

返回结构里主要看：

- `uploaded.exteriorImages`
- `uploaded.interiorImages`
- `uploaded.logo`
- `uploaded.allFiles`

每一项都会带：

- `fieldName`
- `originalName`
- `savedName`
- `url`

例如：

```json
{
  "ok": true,
  "uploaded": {
    "exteriorImages": [
      {
        "fieldName": "exterior_images",
        "originalName": "car-1.jpg",
        "savedName": "1710000000000-ab12cd-car-1.jpg",
        "url": "http://your-domain/uploads/1710000000000-ab12cd-car-1.jpg"
      }
    ]
  }
}
```

前端提交成功后，浏览器控制台可以直接看：

- `window.lastUploadResult`

## 当前页面交互

- 输入车名
- 选择汽车主图
- 选择汽车内饰图
- 检查缩略图
- 点击“提交运行”

页面效果：

- 选图后显示缩略图
- 点击缩略图查看原图
- 点击右上角叉号删除图片
- 提交时缩略图显示转圈状态
- 成功后弹出“已经提交运行”
- 确认后自动清空，方便下一轮提交

## Logo 和 UI 素材

Logo 文件：

- [logo.png](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/logo/logo.png)

UI 可替换素材：

- [scene-grid.svg](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/ui-assets/scene-grid.svg)
- [scene-wave.svg](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/ui-assets/scene-wave.svg)
- [upload-plus.svg](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/ui-assets/upload-plus.svg)

给开发同事同步素材位置时，直接看：

- [ASSET_MAP.md](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/ASSET_MAP.md)
- [asset-map.json](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/asset-map.json)
