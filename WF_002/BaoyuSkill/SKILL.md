# 图像生成（AI SDK）

官方基于 API 的图像生成工具。支持 OpenAI、Google、DashScope（阿里通义万象）和 Replicate 提供商。

支持：文本生成图像、参考图、宽高比、批量生成（通过保存的 prompt 文件）。

默认是**顺序生成**；如果你有多个 prompt，可以使用**批量并行生成**。

---

## 脚本目录

**Agent 执行流程：**

1. `{baseDir}` = 当前 SKILL.md 文件所在目录  
2. 脚本路径 = `{baseDir}/scripts/main.ts`  
3. 运行环境 `${BUN_X}`：
   - 如果安装了 `bun` → 使用 `bun`
   - 否则如果有 `npx` → 使用 `npx -y bun`
   - 否则建议安装 bun

---

## Step 0：加载配置（⛔ 必须执行）

⚠️ **这个步骤必须在任何图像生成之前完成，不能跳过**

---

## 使用方式

### 基础命令

```bash
bun scripts/main.ts --prompt "一只猫" --image cat.png
```

### 指定宽高比

```bash
--ar 16:9
```

### 高质量

```bash
--quality 2k
```

### 从文件读取 prompt

```bash
--promptfiles system.md content.md
```

### 使用参考图

```bash
--ref source.png
```

---

## 批量生成

```bash
bun scripts/main.ts --batchfile batch.json
```

### batch.json 示例

```json
{
  "jobs": 4,
  "tasks": [
    {
      "id": "hero",
      "promptFiles": ["prompts/hero.md"],
      "image": "out/hero.png",
      "provider": "replicate",
      "model": "google/nano-banana-pro",
      "ar": "16:9",
      "quality": "2k"
    }
  ]
}
```

---

## 参数说明

| 参数 | 说明 |
|------|------|
| --prompt | 文本提示 |
| --image | 输出路径 |
| --batchfile | 批量文件 |
| --provider | 指定服务商 |
| --model | 指定模型 |
| --ar | 宽高比 |
| --quality | 质量 |

---

## 环境变量

| 变量 | 说明 |
|------|------|
| OPENAI_API_KEY | OpenAI Key |
| GOOGLE_API_KEY | Google Key |
| DASHSCOPE_API_KEY | 阿里 Key |
| REPLICATE_API_TOKEN | Replicate Key |

---

## 模型选择优先级

1. CLI 参数  
2. EXTEND.md  
3. 环境变量  
4. 默认值  

---

## Provider 选择规则

1. 有参考图 → 优先 Google  
2. 指定 provider → 使用指定  
3. 只有一个 API → 用它  
4. 多个 API → 默认 Google  

---

## 质量设置

| 模式 | 分辨率 |
|------|--------|
| normal | 1K |
| 2k（默认） | 2K |

---

## 宽高比支持

- 1:1  
- 16:9  
- 9:16  
- 4:3  
- 3:4  

---

## 生成模式

### 默认：顺序生成

### 批量模式：并行生成

---

## 错误处理

- 缺少 API Key → 报错  
- 生成失败 → 自动重试 3 次  
- 比例错误 → 使用默认值  

---

## 扩展配置

通过 EXTEND.md 自定义：

- 默认模型  
- 默认质量  
- 并发数  
- 输出路径  
