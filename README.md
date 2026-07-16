# pi-code-blocks

从会话里的 assistant 回答中挑选围栏代码块，弹层选择并复制到剪贴板。

Pick fenced code blocks from assistant replies in a fixed-height TUI overlay, preview them, and copy to the clipboard.

## Install

```bash
# GitHub (recommended)
pi install git:github.com/SuperJeason/pi-code-blocks

# HTTPS URL also works
pi install https://github.com/SuperJeason/pi-code-blocks

# Local path
pi install /absolute/path/to/pi-code-blocks
```

临时试用（不写入 settings）：

```bash
pi -e git:github.com/SuperJeason/pi-code-blocks
```

安装后重启 pi，或执行 `/reload`。

## Usage

在 pi TUI 中输入：

```text
/code
```

### Keys

| Key | Action |
|-----|--------|
| ↑↓ / j k | 列表移动；预览聚焦时滚动预览 |
| → / f | 聚焦下方预览窗格 |
| ← | 回到列表 |
| Ctrl+F | 列表/预览切换 |
| Tab / s | last ↔ all 范围切换 |
| l / a | 直接切到 last / all（未搜索时） |
| 1-9 | 快速跳到第 N 项 |
| Enter | 复制当前代码块 |
| type | 过滤语言/内容 |
| Backspace / Ctrl+U | 删除/清空过滤 |
| Esc | 关闭 |

### Scope

- **last**（默认）：只显示最后一条 assistant 回答里的代码块
- **all**：显示本会话全部 assistant 回答里的代码块

### Layout

- 弹层贴在输入框上方（`bottom-center`），不垂直居中
- 面板使用半透明感的 frosted 底（主题 `toolPendingBg`）；选中行用 `selectedBg`
- 终端无法真·高斯模糊，此为最接近的主题色毛玻璃效果
- 宽度约 68%，列表/预览行数随终端高度自适应

## Requirements

- [pi](https://github.com/badlogic/pi-mono) (`@earendil-works/pi-coding-agent`) with TUI support
- Peer packages: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`

## License

MIT
