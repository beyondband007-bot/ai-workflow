# UI 素材位置清单

这个文件用于给开发同事同步当前前端页面的素材位置、用途和替换规则。

## 项目入口

- 页面入口：
  [index.html](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/index.html)
- 样式文件：
  [style.css](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/style.css)
- 交互脚本：
  [script.js](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/script.js)
- 本地提交服务：
  [server.js](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/server.js)

## Logo 文件

- 文件：
  [logo.png](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/logo/logo.png)
- 页面用途：
  顶部品牌展示
- 提交用途：
  随表单一起提交给工作流，字段名为 `logo`

## UI 素材文件夹

- 文件夹：
  [ui-assets](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/ui-assets)

当前素材说明：

1. [scene-grid.svg](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/ui-assets/scene-grid.svg)
   用途：页面背景网格线
   页面引用：`style.css` 中 `.scene-grid`

2. [scene-wave.svg](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/ui-assets/scene-wave.svg)
   用途：页面底部红色流线背景
   页面引用：`style.css` 中 `.scene-wave`

3. [upload-plus.svg](C:/Users/27256/Documents/Codex/项目测试/car-export-portal/ui-assets/upload-plus.svg)
   用途：上传按钮加号图标
   页面引用：`index.html` 中主图、内饰图两个上传按钮

## 替换规则

- 如果只换视觉图，不改代码：
  直接替换 `ui-assets` 目录下同名文件即可
- 如果换 Logo：
  直接替换 `logo/logo.png`
- 如果文件名改变了：
  需要同步修改 `index.html` 或 `style.css` 中对应路径

## 前端页面当前主要区域

1. 顶部品牌区
   位置：`index.html` 中 `.hero`

2. 左侧上传区
   位置：`index.html` 中 `.form-panel`

3. 右侧提交说明区
   位置：`index.html` 中 `.side-panel`

## 建议发给开发同事的最小信息

把下面这些路径发给开发同事即可：

- 页面目录：
  `C:\Users\27256\Documents\Codex\项目测试\car-export-portal`
- Logo：
  `C:\Users\27256\Documents\Codex\项目测试\car-export-portal\logo\logo.png`
- UI 素材目录：
  `C:\Users\27256\Documents\Codex\项目测试\car-export-portal\ui-assets`
- 素材说明文件：
  `C:\Users\27256\Documents\Codex\项目测试\car-export-portal\ASSET_MAP.md`
