<div align="center">
  <img src="./imgs/title.svg" alt="Crazy OS" width="560" />

  <h3>Whatever you want to do, the system makes it happen.</h3>
  <p>A hand-drawn Agent OS managed by the Crazy assistant.</p>

  <p>
    <a href="./LICENSE"><img alt="GNU GPL v3" src="https://img.shields.io/badge/license-GPLv3-F4512A.svg" /></a>
    <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2B2B2B.svg" />
    <img alt="Electron 42" src="https://img.shields.io/badge/Electron-42-47848F.svg?logo=electron&logoColor=white" />
    <img alt="Status" src="https://img.shields.io/badge/status-growing-FFD23F.svg" />
  </p>

  <h4>
    English &nbsp;|&nbsp; <a href="./README.zh-CN.md">简体中文</a>
  </h4>
</div>

<br />

<table>
  <tr>
    <td width="50%" align="center">
      <img src="./imgs/open_apps.gif" alt="Let the Crazy assistant create and open apps" width="100%" /><br />
      <b>Create an app with one sentence</b>
    </td>
    <td width="50%" align="center">
      <img src="./imgs/system_operation.gif" alt="Let the Crazy assistant control the system and files" width="100%" /><br />
      <b>Manage the system and files</b>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="./imgs/time_changing.gif" alt="Let the Crazy assistant adjust the desktop time" width="100%" /><br />
      <b>Adjust the desktop to match your ideas</b>
    </td>
    <td width="50%" align="center">
      <img src="./imgs/search_app.gif" alt="Crazy browser and multiple tabs" width="100%" /><br />
      <b>Browse and generate content</b>
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <img src="./imgs/change_app.gif" alt="Modify an app based on the user's ideas" width="70%" /><br />
      <b>Modify apps based on the user's ideas</b>
    </td>
  </tr>
</table>

<br />

Crazy OS is **what I think an Agent OS should look like**. In the end, people use an OS to handle information, organize files, and browse content. Every interaction you have with the OS is essentially supported behind the scenes by the Crazy assistant. The Crazy assistant can manage things alongside you: it can organize files for you, change system settings, show any content you want to see, and create a brand-new app from a single sentence of description. Apps continue to change as you use them, and buttons, pages, and content can all grow naturally on the existing interface.

Crazy OS is a place where information and files, the Crazy assistant, and visual interfaces coexist peacefully~

> Please note: this project is not practical in any productive sense. It is purely my personal imagination of an Agent OS~ haha

## Features

- 🧠&nbsp;&nbsp;**The Crazy assistant runs the entire desktop** — Control the system, files, and apps through chat, and always see what it is doing.
- 🗂️&nbsp;&nbsp;**Handle files however you ask** — Create, read, rename, move, delete, and restore files or folders, and place shortcuts anywhere.
- ✨&nbsp;&nbsp;**If you need it, create it** — The first time you open a new app, Crazy finishes the installation on the spot and prepares the home page and available interactions for you.
- 🪄&nbsp;&nbsp;**The interface grows in real time** — New content appears gradually on the original page, and the parts that are already visible are preserved as much as possible instead of suddenly flashing blank.
- 🏠&nbsp;&nbsp;**A familiar home page every time you open it** — Apps remember stable home pages and long-term data, while temporary browsing and one-off changes are tucked away after closing.
- 🌐&nbsp;&nbsp;**A multi-tab browser that can think** — Each tab keeps its own page, history, and generation progress, and searches, jumps, and in-page content can all continue to be handled by Crazy.
- 💬&nbsp;&nbsp;**Fixed interfaces can still chat quickly** — Apps such as chat windows can generate only new replies while keeping the original layout, reducing waiting.
- 🧭&nbsp;&nbsp;**You can still change your mind mid-task** — Even while Crazy is busy, you can add new requests, and it will weave the new ideas into the task already in progress.
- 🎨&nbsp;&nbsp;**The hand-drawn style is everywhere** — Excalidraw fonts, paper grids, doodled borders, elastic motion, plus light and dark modes.
- 🔌&nbsp;&nbsp;**Freely choose the Crazy model** — You can save and switch between multiple model configurations, with compatibility for common OpenAI, Responses, and Anthropic APIs.
- 🔄&nbsp;&nbsp;**Check for updates with one click** — From the Version screen, check `Utter-pulsar/crazy-os`; when a new version is found, the app will download, install, and reopen itself.
- 🖥️&nbsp;&nbsp;**Cross-platform** — Supports Windows, macOS, and Linux.

## Why build Crazy OS?

I have always hoped that computers could understand people more directly. When you want to organize files, you should only need to say clearly where you want them to go. When you want to see a certain kind of content, it should be able to immediately create a suitable window. And when you think of a tool that has never been installed before, the desktop should be able to create it right on the spot.

So I started building Crazy OS, little by little placing my imagination of an Agent OS into this hand-drawn desktop. The Crazy assistant is the center of the entire system, and also the system itself. It is responsible for understanding, acting, showing the process, and staying with apps as they continue to change. Every feature here moves toward the same goal: **the user only needs to describe what they want, and the Crazy assistant is responsible for making everything happen.**

This is a very personal project, and it is still growing. If you have new ideas, capabilities you want Crazy to learn, or strange problems you run into, feel free to open an [Issue](https://github.com/Utter-pulsar/crazy-os/issues). I would also really love to know what the Agent OS in your mind would look like, hehe.

## Getting Started

Crazy OS is built with Electron + Vite + React and requires Node.js 22.12.0 or later.

```bash
# Install dependencies
npm ci

# Start development mode
npm run dev

# Check the code and build the production version
npm run typecheck
npm run build
```

After launching it for the first time, open "System Settings" from the bottom Dock, go to "**Crazy Model**", fill in the API endpoint, model name, and API key you use, then test the connection and enable it. You can save multiple model configurations and switch between them in the Crazy assistant at any time.

Build installers for different systems:

```bash
npm run package       # Unpacked version for the current platform
npm run dist:win      # Windows x64 installer
npm run dist:mac      # macOS Intel + Apple Silicon
npm run dist:linux    # Linux x64 AppImage + deb
```

The installers will appear in `dist/`. Windows, macOS, and Linux installers need to be built on their respective systems.

**macOS installation notes**

After opening the DMG, drag `Crazy OS.app` into Applications. Manually built macOS installers may not currently have an Apple developer signature. If the system says the app is damaged or the developer cannot be verified, first make sure the installer came from this project's official Release, then run the following in Terminal:

```bash
# Clear the quarantine attribute from the downloaded app
sudo xattr -cr "/Applications/Crazy OS.app"

# If it still will not open, add a temporary local signature
sudo codesign --force --deep --sign - "/Applications/Crazy OS.app"
```

**Linux installation notes**

AppImage does not require installation. After granting execute permission, you can open it directly:

```bash
chmod +x ./Crazy-OS-*-linux-x64.AppImage
./Crazy-OS-*-linux-x64.AppImage
```

When using the DEB installer, you can run:

```bash
DEB=./Crazy-OS-x.x.x-linux-x64.deb
sudo apt install -y "$DEB"
```

If startup reports that the `chrome-sandbox` permissions are incorrect, fix its owner and setuid permissions, then refresh the desktop icon cache:

```bash
sudo chown root:root "/opt/Crazy OS/chrome-sandbox"
sudo chmod 4755 "/opt/Crazy OS/chrome-sandbox"
sudo gtk-update-icon-cache -f /usr/share/icons/hicolor
```

In the release build, open "Version" from the three-line menu in the upper-left corner and click "Check for Updates". Crazy OS will check the official Release of [Utter-pulsar/crazy-os](https://github.com/Utter-pulsar/crazy-os). If it finds a newer version, it will automatically download, install, and relaunch. Development mode does not check for updates. macOS auto-update requires valid signing, and on Linux the AppImage version is recommended.


## Tech Stack

Electron 42 · electron-vite 5 · React 19 · TypeScript 6 · Zustand 5 · Tailwind CSS 3 · Framer Motion · Rough.js

## Status and Plans

Crazy OS is still actively growing. Right now it can already use the Crazy assistant to manage the desktop, files, and apps, and it has established foundational experiences such as app home pages, temporary pages, real-time updates, and browser tab isolation.

Next, I will continue making app generation faster and more natural, expand the system capabilities that Crazy can manage, and improve the continuous-use experience for browsers and complex apps. This project will stay open, and it will always keep that original sense of free imagination.

## Contributing / Ideas

This is a personal project, but new ideas are very welcome. You can use [Issue](https://github.com/Utter-pulsar/crazy-os/issues) to propose features, share interface sketches, or tell me where something did not work the way you expected.

If you want to submit code, please run:

```bash
npm run typecheck
npm run test:runtime
npm run build
```

## License

Crazy OS is open source under the [GNU General Public License v3.0](./LICENSE).

Any modified versions or derivative works of this project that are distributed externally must continue to use GNU GPL v3.0, preserve the original copyright and license notices, clearly explain the changes that were made, and provide the corresponding source code to recipients. For the full terms, please read [LICENSE](./LICENSE).
