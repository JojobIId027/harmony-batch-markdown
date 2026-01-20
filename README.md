# harmony-batch-markdown(HarmonyOS开发者文档转MD格式脚本)

这是一个基于Node.js的自动化脚本，使用**Puppeteer**抓取鸿蒙开发者官网文档内容，并利用**Turndown**将其转换为Markdown格式文档。

## ✨ 主要功能

1.  **批量抓取**：支持通过配置文件批量处理多个 URL。
2.  **智能目录结构**：
    *   自动解析网页的面包屑导航（Breadcrumbs），生成对应的本地文件夹层级。
    *   支持 URL 关键字映射（`urlMapping`），可自定义根目录名称。
3.  **深度内容清洗**：
    *   **去噪**：自动移除广告、侧边栏、导航栏、脚本、样式表以及包含“收起/展开/复制”等无关词汇的元素。
    *   **智能提取**：根据预定义的优先级选择器（如 `.doc-content`, `article` 等）自动定位正文区域。
4.  **格式优化**：
    *   **表格增强**：保留表格结构，强制保留单元格内的换行符 (`<br>`)，并展平单元格内的复杂嵌套（如列表、标题）。
    *   **代码块修复**：自动识别并修复常见的代码高亮容器（如 `pre`, `.hljs`, `.code-snippet`），移除行号和多余的 SVG 图标，还原纯净代码。
5.  **Markdown 转换**：使用 GFM（GitHub Flavored Markdown）风格，支持表格和围栏代码块。

## 🛠️ 安装依赖

在使用前，请确保已安装 Node.js，并在项目根目录下安装所需的依赖包：

```bash
npm install
```

## ⚙️ 配置文件 (config.json)

在脚本同级目录下创建一个 `config.json` 文件，格式如下：

```json
{
  "urls": [
    "https://example.com/docs/guide/introduction",
    "https://example.com/docs/api/reference"
  ],
  "outputDir": "./output",
  "urlMapping": {
    "guide": "开发指南",
    "api": "API文档"
  }
}
```

### 配置项说明

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `urls` | `Array<string>` | **必填**。需要抓取的网页链接列表。 |
| `outputDir` | `string` | 输出目录路径。默认为 `./output`。 |
| `urlMapping` | `Object` | URL 关键字映射。如果 URL 中包含 `key`，则将生成的文档放入名为 `value` 的根文件夹中。 |

## 🚀 使用方法

1.  配置好 `config.json`。
2.  运行脚本：

```bash
node batch-puppeteer.js
```

或

```bash
npm run batch
```

脚本启动后，将自动启动无头浏览器，依次访问链接，处理完成后会在 `outputDir` 下生成对应的 `.md` 文件。

## ⚠️ 注意事项

*   脚本默认使用 `headless: "new"` 模式运行 Puppeteer。
*   默认视口大小为 1920x1080。
*   网络超时设置为 90秒。
*   如果遇到反爬虫机制严格的网站，可能需要调整 Puppeteer 的启动参数（如 User-Agent）。

---

**License**: MIT
