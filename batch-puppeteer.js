const puppeteer = require('puppeteer');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const fs = require('fs').promises;
const path = require('path');

// 常见技术文档的正文选择器优先级
const CONTENT_SELECTORS = [
    '.doc-content',
    'article',
    '#doc-content',
    '.markdown-body',
    '.main-content',
    'main'
];

async function main() {
    // 1. 读取或自动生成配置文件 (config.json)
    const configPath = path.join(__dirname, 'config.json');
    let config = {};

    const configContent = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(configContent);

    const { urls, outputDir, urlMapping } = config;
    const OUTPUT_DIR = outputDir || './output';
    const URL_MAPPING = urlMapping || {};

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        console.log('⚠️  config.json 中没有链接，请添加链接后重试。');
        return;
    }

    // 1. 配置 Turndown
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        emDelimiter: '*'
    });

    // 启用表格支持
    turndownService.use(gfm);

    // 🔥 关键配置：强制保留 <br> 标签
    turndownService.addRule('keep-br-in-table', {
        filter: 'br',
        replacement: function (content, node) {
            if (node.closest('table')) {
                return '<br>';
            }
            return '\n';
        }
    });

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox'],
        defaultViewport: { width: 1920, height: 1080 }
    });

    try { await fs.mkdir(OUTPUT_DIR, { recursive: true }); } catch (e) { }

    console.log('🚀 开始抓取 (URL映射分类 + 面包屑层级)...');

    for (const url of urls) {
        const page = await browser.newPage();
        try {
            console.log(`\n正在处理: ${url}`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
            try { await page.waitForSelector('.doc-content, #article-content, article, .main-content, table', { timeout: 5000 }); } catch (e) { }

            // 2. 🔥 浏览器内执行：提取文件名 + 深度清洗
            const data = await page.evaluate((selectors) => {

                // --- 面包屑提取 ---
                let breadcrumbList = [];
                try {
                    const breadcrumbEl = document.querySelector('.bread-crumb, .breadcrumb, nav[aria-label="breadcrumb"], .breadcrumbs, #breadcrumbs');
                    if (breadcrumbEl) {
                        const text = breadcrumbEl.innerText;
                        breadcrumbList = text.split(/[\n\r>|/]+/)
                            .map(item => item.trim())
                            .filter(item => item.length > 0);
                    }
                } catch (e) { console.log('面包屑提取失败', e); }

                // 兜底方案：如果找不到面包屑，尝试从 Title 解析
                if (breadcrumbList.length === 0 && document.title) {
                    let titleParts = document.title.split(/[-|—]+/).map(t => t.trim());
                    titleParts = titleParts.filter(t => !t.includes('华为') && !t.includes('Huawei'));
                    if (titleParts.length > 1) {
                        breadcrumbList = titleParts.reverse();
                    }
                }

                // --- 1. 强力噪音鉴定器 ---
                const isPureNoise = (el) => {
                    if (!el) return false;
                    if (el.style.display === 'none' || el.style.visibility === 'hidden') return true;
                    let text = el.innerText.trim();
                    if (!text) return false;
                    const NOISE_WORDS = ['收起', '展开', '自动换行', '深色代码主题', '复制'];
                    if (NOISE_WORDS.includes(text)) return true;
                    let cleanText = text;
                    NOISE_WORDS.forEach(word => { cleanText = cleanText.split(word).join(''); });
                    cleanText = cleanText.replace(/[\s\r\n\t|·\-]/g, '');
                    return cleanText.length === 0;
                };

                // --- 2. 回溯式清理函数 ---
                const cleanPreviousSiblings = (node, maxLevels = 3) => {
                    let current = node;
                    let level = 0;
                    while (current && level < maxLevels) {
                        let prev = current.previousElementSibling;
                        while (prev) {
                            const isSafeTag = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI'].includes(prev.tagName);
                            if (isPureNoise(prev)) {
                                const nextPrev = prev.previousElementSibling;
                                prev.remove();
                                prev = nextPrev;
                            } else { return; }
                        }
                        current = current.parentElement;
                        level++;
                        if (!current || current.tagName === 'BODY' || current.classList.contains('doc-content')) break;
                    }
                };

                // --- 3. 全局地毯式扫除 ---
                const candidates = document.querySelectorAll('div, span, button, a, i, li');
                candidates.forEach(el => {
                    if (el.innerText.length > 50) return;
                    if (isPureNoise(el)) el.remove();
                });

                // --- 4. 常规清理 ---
                const useless = document.querySelectorAll('script, style, nav, header, footer, .side-menu, .bread-crumb, .toc, .feedback, .universal_header, .universal_footer, .dev-header, .dev-footer, #header, #footer, .header, .footer, .top-nav, .bottom-nav, .sidebar, .left-nav, .right-nav, .menu, #sidebar');
                useless.forEach(el => el.remove());

                // --- 5. 修复表格 ---
                document.querySelectorAll('table').forEach(table => {
                    table.querySelectorAll('script, style').forEach(el => el.remove());
                    cleanPreviousSiblings(table);
                    table.querySelectorAll('td, th').forEach(cell => {
                        const flattenBlock = (el) => {
                            const br = document.createElement('br');
                            el.appendChild(br);
                            const parent = el.parentNode;
                            while (el.firstChild) parent.insertBefore(el.firstChild, el);
                            parent.removeChild(el);
                        };
                        let blocks;
                        do {
                            blocks = cell.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, blockquote');
                            if (blocks.length > 0) blocks.forEach(block => flattenBlock(block));
                        } while (cell.querySelectorAll('p, div, li').length > 0);
                        cell.querySelectorAll('ul, ol').forEach(list => {
                            const parent = list.parentNode;
                            while (list.firstChild) parent.insertBefore(list.firstChild, list);
                            parent.removeChild(list);
                        });
                        cell.innerHTML = cell.innerHTML.replace(/[\r\n]+/g, ' ');

                        // 替换表格中的 | 为占位符，防止破坏 Markdown 表格结构
                        const replacePipe = (node) => {
                            if (node.nodeType === 3) { // Text node
                                node.nodeValue = node.nodeValue.replace(/\|/g, 'SHELLPIPEMARKER');
                            } else if (node.nodeType === 1) {
                                node.childNodes.forEach(replacePipe);
                            }
                        };
                        replacePipe(cell);
                    });
                });

                // --- 6. 修复代码块 ---
                const codeContainers = document.querySelectorAll('pre, .code-snippet, .hljs, .code-toolbar, .brush, .syntaxhighlighter');
                codeContainers.forEach(container => {
                    container.querySelectorAll('svg').forEach(el => el.remove());
                    Array.from(container.children).forEach(child => { if (isPureNoise(child)) child.remove(); });
                    cleanPreviousSiblings(container);
                    let codeText = '';
                    const list = container.querySelector('ol, ul');
                    if (list) {
                        const lines = [];
                        list.querySelectorAll('li').forEach(li => {
                            if (!isPureNoise(li)) lines.push(li.innerText.replace(/^\s*\d+\.?\s*/, ''));
                        });
                        codeText = lines.join('\n');
                    } else if (container.querySelector('table')) {
                        container.querySelectorAll('td.code, td:last-child').forEach(td => codeText += td.innerText + '\n');
                    } else {
                        codeText = container.innerText || container.textContent;
                    }
                    if (codeText.trim()) {
                        const pre = document.createElement('pre');
                        const code = document.createElement('code');
                        const langMatch = container.className.match(/lang(?:uage)?-(\w+)/);
                        if (langMatch) code.className = `language-${langMatch[1]}`;
                        code.textContent = codeText;
                        pre.appendChild(code);
                        container.replaceWith(pre);
                    }
                });

                // --- 7. 提取正文 ---
                let contentEl = null;
                for (const selector of selectors) {
                    const el = document.querySelector(selector);
                    if (el && el.innerText.length > 50) {
                        contentEl = el;
                        break;
                    }
                }

                return {
                    breadcrumbs: breadcrumbList,
                    fallbackTitle: document.title,
                    html: contentEl ? contentEl.innerHTML : null
                };
            }, CONTENT_SELECTORS);

            if (!data.html) {
                console.log(`⚠️  跳过: ${url} (未识别到正文容器，可能是目录或非文档页)`);
                continue;
            }

            // 3. 转换内容
            let markdown = turndownService.turndown(data.html);
            // 还原表格中的 | (转义后)
            markdown = markdown.replace(/SHELLPIPEMARKER/g, '\\|');

            // 🆕 修改点：Node.js 端处理 URL 映射 + 文件夹自动创建
            let targetDir = OUTPUT_DIR;
            let fileName = '';

            // 步骤 A: 准备文件名和基础路径
            let pathSegments = [];

            // 1. 先尝试从 URL 中识别根目录
            // 遍历映射表，看 URL 是否包含关键词
            let rootFolder = '';
            for (const [key, folderName] of Object.entries(URL_MAPPING)) {
                if (url.includes(key)) {
                    rootFolder = folderName;
                    break;
                }
            }

            // 2. 获取面包屑路径 (作为子目录)
            if (data.breadcrumbs && data.breadcrumbs.length > 0) {
                // 清洗非法字符
                let safePath = data.breadcrumbs.map(s => s.replace(/[\/\\?%*:|"<>]/g, '').trim());

                // 提取文件名 (最后一个元素)
                const namePart = safePath.pop();
                fileName = `${namePart}.md`;

                // 剩下的就是中间目录
                pathSegments = safePath;
            } else {
                // 没有面包屑，使用 Title
                const safeTitle = data.fallbackTitle.replace(/[\/\\?%*:|"<>]/g, '-').trim().slice(0, 100);
                fileName = `${safeTitle}.md`;
            }

            // 3. 组合最终路径
            // 如果识别到了 URL 根目录 (比如 '指南')
            if (rootFolder) {
                // 检查面包屑的第一层是否已经包含了这个名字 (防止重复，如 output/指南/指南/NDK)
                if (pathSegments.length > 0 && pathSegments[0] === rootFolder) {
                    // 如果面包屑自带根目录，就不插手了
                } else {
                    // 否则，强制把它插到最前面
                    pathSegments.unshift(rootFolder);
                }
            }

            // 构建完整目录路径
            if (pathSegments.length > 0) {
                targetDir = path.join(OUTPUT_DIR, ...pathSegments);
            }

            // 🔥 自动递归创建多级文件夹
            await fs.mkdir(targetDir, { recursive: true });

            const filePath = path.join(targetDir, fileName);
            const fileContent = `# ${fileName.replace('.md', '')}\n\nOriginal: ${url}\n\n${markdown}`;

            await fs.writeFile(filePath, fileContent);
            console.log(`✅ 已保存: ${filePath}`);

        } catch (error) {
            console.error(`❌ 失败 [${url}]:`, error.message);
        } finally {
            await page.close();
        }
    }

    await browser.close();
    console.log('\n✨ 全部完成!');
}

main();