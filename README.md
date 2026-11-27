# DSH 侧边追问

面向 DeepSeek Harness 桌面版 0.2.1-rc.3 的原型。在 DSH 的「插件 → 添加插件」中填入 `github:obvious3460/dsh-side-conversation`，安装后重启 DSH。也可以先检出源码，再将完整目录作为本地插件添加。

如果使用桌面版附带的 CLI，请先完全退出 DSH，再运行以下命令。

```powershell
$dsh = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile desktop add 'github:obvious3460/dsh-side-conversation'
```

右侧栏「开始」页的「侧边追问」入口可以直接输入问题，发送时从当前主聊天的最后一轮创建分支。也可以在主聊天选中同一轮 AI 回答中的一段文字，再点击浮出的「侧边追问」按钮。主聊天需空闲且至少完成一轮。选中文字的方式会在首次发送时附上引用。

按 Enter 发送，Shift+Enter 换行，也可以点击「发送」按钮。

插件创建的侧边分支会从当前 DSH 客户端的左侧会话列表隐藏。关闭侧边标签后，插件会在分支空闲时尝试归档。旧版已关闭的分支需要在 DSH 中手动归档。

侧边回复使用 DSH 的 Markdown 渲染器，并随当前主题显示标题、列表、粗体和代码块。附件、工具明细和审批请通过「打开完整会话」处理。无需 Atlas，无需构建。
