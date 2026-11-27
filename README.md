# DSH 侧边追问

面向 DeepSeek Harness 桌面版 0.2.1-rc.3 的原型。在 DSH 的「插件 → 添加插件」中填入 `github:obvious3460/dsh-side-conversation`，安装后重启 DSH。也可以先检出源码，再将完整目录作为本地插件添加。

如果使用桌面版附带的 CLI，请先完全退出 DSH，再运行以下命令。

```powershell
$dsh = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile desktop add 'github:obvious3460/dsh-side-conversation'
```

右侧栏「开始」页的工具列表中有「侧边追问」入口。也可以直接在主聊天选中同一轮 AI 回答中的一段文字，再点击浮出的「侧边追问」按钮。主聊天空闲且所选轮次已经结束时，插件创建原生分支，并在当前聊天右侧打开追问标签页。首次发送会把选中文字作为引用附上，后续消息继续发往同一个分支。

新建的侧边分支会在发送消息前归档，因此默认不出现在左侧会话列表。DSH 的归档筛选仍能显示这些会话，插件不提供追问历史入口。此前创建的分支请通过 DSH 手动归档。

追问页随 DSH 主题显示纯文本问答。附件、Markdown 格式、工具明细和审批请通过「打开完整会话」处理。无需 Atlas，无需构建。
