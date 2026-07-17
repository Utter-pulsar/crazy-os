<div align="center">
  <img src="./imgs/title.svg" alt="Crazy OS" width="560" />

  <h3>你心里怎么想，系统就怎么生长。</h3>
  <p>一个由 Crazy 助手管理的手绘 Agent OS：说出你的想法，剩下的交给它。</p>

  <p>
    <a href="./LICENSE"><img alt="GNU GPL v3" src="https://img.shields.io/badge/license-GPLv3-F4512A.svg" /></a>
    <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2B2B2B.svg" />
    <img alt="Electron 42" src="https://img.shields.io/badge/Electron-42-47848F.svg?logo=electron&logoColor=white" />
    <img alt="Status" src="https://img.shields.io/badge/status-growing-FFD23F.svg" />
  </p>
</div>

<br />

<table>
  <tr>
    <td width="50%" align="center">
      <img src="./imgs/open_apps.gif" alt="让 Crazy 助手创建和打开应用" width="100%" /><br />
      <b>一句话创建应用</b>
    </td>
    <td width="50%" align="center">
      <img src="./imgs/system_operation.gif" alt="让 Crazy 助手控制系统和文件" width="100%" /><br />
      <b>管理系统与文件</b>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="./imgs/time_changing.gif" alt="让 Crazy 助手调整桌面时间" width="100%" /><br />
      <b>按想法调整桌面</b>
    </td>
    <td width="50%" align="center">
      <img src="./imgs/search_app.gif" alt="Crazy 浏览器与多标签页" width="100%" /><br />
      <b>浏览与生成内容</b>
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <img src="./imgs/change_app.gif" alt="按用户想法修改app" width="70%" /><br />
      <b>按用户想法修改应用</b>
    </td>
  </tr>
</table>

<br />

Crazy OS 是我心目中 **Agent OS 应该长的样子**。用户使用OS无非是处理信息、整理文件、浏览内容。你和OS的所有交互本质都是Crazy助手在背后偷偷的支持。Crazy 助手可以陪你一起管理：它可以替你整理文件、改变系统设置、展示任何想看的内容，也可以根据一句描述创造一个新应用。应用会随着你的使用继续变化，按钮、页面和内容都能在原来的界面上自然生长。

Crazy OS是一个信息文件、Crazy助手、展示界面和平共处的地方~

> 请注意：本项目不具备任何生产力，单纯是个人对AgentOS的畅想~ 哈哈

## 功能特性

- 🧠&nbsp;&nbsp;**Crazy 助手掌管整个桌面** — 用聊天控制系统、文件和应用，并随时看到它正在做什么。
- 🗂️&nbsp;&nbsp;**随口安排文件** — 创建、读取、改名、移动、删除和恢复文件或文件夹，也能在任意位置放置快捷方式。
- ✨&nbsp;&nbsp;**需要什么就创造什么** — 第一次打开新应用时，Crazy 会现场完成安装，并把首页与可用的交互一起准备好。
- 🪄&nbsp;&nbsp;**界面会实时生长** — 新内容会逐步出现在原来的页面中，已经显示的部分会尽量保留，不会突然闪成空白。
- 🏠&nbsp;&nbsp;**每次打开都有熟悉的首页** — 应用会记住稳定的首页和长期数据，临时浏览与一次性变化会在关闭后收好。
- 🌐&nbsp;&nbsp;**会思考的多标签浏览器** — 每个标签页各自保留页面、历史和生成进度，搜索、跳转与页内内容都能继续交给 Crazy。
- 💬&nbsp;&nbsp;**固定界面也能快速对话** — 聊天窗口等应用可以只生成新回复，保持原来的布局，减少等待。
- 🧭&nbsp;&nbsp;**工作途中也能改变主意** — Crazy 忙碌时仍可追加新要求，它会把新的想法接进正在进行的任务。
- 🎨&nbsp;&nbsp;**手绘风格无处不在** — Excalidraw 字体、纸张网格、涂鸦边框、弹性动效，以及浅色与深色模式。
- 🔌&nbsp;&nbsp;**自由选择 Crazy 模型** — 可以保存并切换多个模型配置，兼容常见的 OpenAI、Responses 与 Anthropic 接口。
- 🔄&nbsp;&nbsp;**一键检查更新** — 在版本界面检查 `Utter-pulsar/crazy-os`；发现新版本后会继续下载、安装并重新打开应用。
- 🖥️&nbsp;&nbsp;**跨平台** — 支持 Windows、macOS 与 Linux。

## 为什么要做 Crazy OS？

我一直希望电脑能够更直接地理解人。想整理文件时，只需要说清楚想放在哪里；想看某种内容时，它可以立刻做出合适的窗口；想到一个从未安装过的工具时，桌面也能当场把它创造出来。

于是我开始做 Crazy OS，把自己对 Agent OS 的想象一点点放进这个手绘桌面里。Crazy 助手是整个系统的中心，也是系统本身。它负责理解、行动、展示过程，也负责陪着应用持续变化。这里的每个功能都在靠近同一个目标：**用户只需描述，Crazy助手负责完成所有功能。**

这是一个非常个人化、也仍在成长的项目。如果你有新的想法、希望 Crazy 学会的能力，或者遇到了奇怪的问题，欢迎提交 [Issue](https://github.com/Utter-pulsar/crazy-os/issues)。我也很想知道你心目中的 Agent OS 会是什么样子嘿嘿。

## 开始使用

Crazy OS 使用 Electron + Vite + React 构建，需要 Node.js 22.12.0 或更高版本。

```bash
# 安装依赖
npm ci

# 启动开发模式
npm run dev

# 检查代码并生成生产版本
npm run typecheck
npm run build
```

第一次进入后，打开底部 Dock 的「系统设置」，进入「**Crazy 模型**」，填写你使用的 API 地址、模型名称与 API Key，测试连接后启用即可。可以保存多个模型配置，并在 Crazy 助手中随时切换。

为不同系统制作安装包：

```bash
npm run package       # 当前平台的未打包版本
npm run dist:win      # Windows x64 安装程序
npm run dist:mac      # macOS Intel + Apple Silicon
npm run dist:linux    # Linux x64 AppImage + deb
```

安装包会出现在 `dist/`。Windows、macOS 和 Linux 安装包需要在各自的系统上构建。

**macOS 安装说明**

打开 DMG 后，将 `Crazy OS.app` 拖进「应用程序」。目前手动构建的 macOS 安装包可能没有 Apple 开发者签名；如果系统确认应用已损坏或无法验证开发者，请先确认安装包来自本项目的正式 Release，再在终端执行：

```bash
# 清除下载文件的隔离属性
sudo xattr -cr "/Applications/Crazy OS.app"

# 如果仍然无法打开，可以补一份本地临时签名
sudo codesign --force --deep --sign - "/Applications/Crazy OS.app"
```

**Linux 安装说明**

AppImage 不需要安装，赋予执行权限后即可打开：

```bash
chmod +x ./Crazy-OS-*-linux-x64.AppImage
./Crazy-OS-*-linux-x64.AppImage
```

使用 DEB 安装包时，可以执行：

```bash
DEB=./Crazy-OS-x.x.x-linux-x64.deb
sudo apt install -y "$DEB"
```

如果启动时提示 `chrome-sandbox` 权限不正确，再修复它的所有者和 setuid 权限，并刷新桌面图标缓存：

```bash
sudo chown root:root "/opt/Crazy OS/chrome-sandbox"
sudo chmod 4755 "/opt/Crazy OS/chrome-sandbox"
sudo gtk-update-icon-cache -f /usr/share/icons/hicolor
```

发布版可以从左上角三条杠进入「版本」，点击「检查更新」。Crazy OS 会检查 [Utter-pulsar/crazy-os](https://github.com/Utter-pulsar/crazy-os) 的正式 Release；如果发现更高版本，会自动下载、安装并重启。开发模式不会检查更新。macOS 自动更新需要经过有效签名，Linux 推荐使用 AppImage 版本。


## 技术栈

Electron 42 · electron-vite 5 · React 19 · TypeScript 6 · Zustand 5 · Tailwind CSS 3 · Framer Motion · Rough.js

## 状态与计划

Crazy OS 还在积极生长。目前已经可以通过 Crazy 助手管理桌面、文件与应用，也建立了应用首页、临时页面、实时更新和浏览器标签隔离等基础体验。

接下来我会继续让应用生成得更快、更自然，扩展 Crazy 能管理的系统能力，改善浏览器与复杂应用的连续使用体验。这个项目会保持开放，也会一直保留最初那份自由想象的感觉。

## 参与 / 想法

这是一个个人项目，但非常欢迎新的想法。你可以通过 [Issue](https://github.com/Utter-pulsar/crazy-os/issues) 提议功能、分享界面草图，或者告诉我某个地方没有按照你期待的方式工作。

如果要提交代码，请先运行：

```bash
npm run typecheck
npm run test:runtime
npm run build
```

## 许可证

Crazy OS 使用 [GNU General Public License v3.0](./LICENSE) 开源。

任何对本项目的修改版本或衍生作品，在对外分发时都需要继续使用 GNU GPL v3.0，并保留原始版权与许可证声明、清楚说明所做的修改，同时向接收者提供对应源代码。完整条款请阅读 [LICENSE](./LICENSE)。
