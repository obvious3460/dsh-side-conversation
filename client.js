window.__ModuleLoader__.load({
  id: 'dsh-side-conversation',
  factory(require) {
    const React = require('react')
    const { createElement: h, useEffect, useState, useSyncExternalStore, useRef } = React
    const id = 'dsh-side-conversation'
    const seat = 'sidebar.right.pane.tab'
    const answer = '[data-chat-flow-kind="assistant-step"][data-chat-turn]'
    const empty = Object.freeze([])
    const noopSubscribe = () => () => {}
    const emptySnapshot = () => null
    const panelStyle = `
      .dsh-side-chat { height: 100%; min-height: 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; padding: 16px; color: var(--dsw-alias-label-primary); font-size: var(--dsh-content-font-size, 14px); }
      .dsh-side-chat header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .dsh-side-chat details { max-height: 22%; overflow: auto; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md, 10px); color: var(--dsw-alias-label-secondary); }
      .dsh-side-chat summary { cursor: pointer; }
      .dsh-side-chat details p { margin-top: 8px; }
      .dsh-side-chat p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
      .dsh-side-chat-log { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 16px; line-height: 1.65; }
      .dsh-side-chat-user { align-self: flex-end; max-width: 88%; box-sizing: border-box; padding: 8px 12px; border-radius: var(--dsw-radius-xl, 16px); background: var(--dsw-specific-bubble, var(--dsw-alias-bg-layer-1)); }
      .dsh-side-chat-muted { color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .dsh-side-chat [role="status"]:empty { display: none; }
      .dsh-side-chat form { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-xl, 16px); background: var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1)); }
      .dsh-side-chat form:focus-within { border-color: var(--dsw-focus-ring-color, Highlight); }
      .dsh-side-chat textarea { width: 100%; box-sizing: border-box; resize: vertical; border: 0; outline: none; background: transparent; color: inherit; font: inherit; }
      .dsh-side-chat textarea::placeholder { color: var(--dsw-alias-label-tertiary); }
      .dsh-side-chat button { border: 0; border-radius: var(--dsw-radius-md, 10px); padding: 6px 10px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
      .dsh-side-chat button:hover:enabled { background: var(--dsw-alias-interactive-bg-hover); }
      .dsh-side-chat button[type="submit"] { align-self: flex-end; background: var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-layer-1)); }
      .dsh-side-chat button:disabled { opacity: .45; cursor: default; }
    `
    const errorText = error => error?.message || String(error)

    function submitOnEnter(event) {
      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }

    function activeSession(sessions) {
      const list = sessions.list.getSnapshot()
      const active = Object.values(list.byId).filter(item => item.retainedBy?.mainView > 0)
      if (active.length === 1) return active[0].id
      if (active.length === 0) return list.current
    }

    function completedTurn(binding, turn) {
      return binding?.eventSource.getSnapshot().entries.find(({ event }) =>
        event.type === 'turn/end' && String(event.data?.turn) === turn)?.event.seq
    }

    function messageText(blocks) {
      if (!Array.isArray(blocks)) return ''
      return blocks.filter(block => block.type === 'text').map(block => block.text).join('\n')
    }

    function branchMessages(entries, atSeq) {
      return entries.flatMap(({ event }) => {
        if (event.seq <= atSeq) return []
        if (event.type === 'user/message' && (!event.data?.source?.kind || event.data.source.kind === 'user')) {
          const text = messageText(event.data?.content)
          return text ? [{ seq: event.seq, author: '你', text }] : []
        }
        if (event.type === 'assistant/message') {
          const text = messageText(event.data?.message?.content)
          return text ? [{ seq: event.seq, author: 'AI', text }] : []
        }
        return []
      })
    }

    function liveReply(entries, atSeq) {
      const blocks = new Map()
      let attempt
      for (const { event } of entries) {
        if (event.seq <= atSeq) continue
        if (event.type === 'assistant/message' || event.type === 'turn/end') blocks.clear()
        if (event.type !== 'assistant/live-chunk') continue
        if (event.data?.attemptId !== attempt) {
          blocks.clear()
          attempt = event.data?.attemptId
        }
        const chunk = event.data?.chunk
        if (chunk?.type === 'text-delta') blocks.set(chunk.index, (blocks.get(chunk.index) ?? '') + chunk.text)
      }
      return [...blocks].sort(([a], [b]) => a - b).map(([, text]) => text).join('\n')
    }

    function BranchChat({ ctx, childId, atSeq, quote }) {
      const [binding, setBinding] = useState(null)
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(false)
      const [quoted, setQuoted] = useState(false)
      const [error, setError] = useState('')
      const sending = useRef(false)
      const feed = binding?.eventSource
      const session = binding?.session
      const events = useSyncExternalStore(
        feed ? listener => feed.subscribe(listener) : noopSubscribe,
        feed ? () => feed.getSnapshot() : emptySnapshot
      )
      const state = useSyncExternalStore(
        session ? listener => session.subscribe(listener) : noopSubscribe,
        session ? () => session.getSnapshot() : emptySnapshot
      )
      const entries = events?.entries ?? empty
      const messages = branchMessages(entries, atSeq)
      const partial = state?.running ? liveReply(entries, atSeq) : ''

      useEffect(() => {
        let active = true
        let reference
        try {
          reference = ctx.sessions.retain(childId, { source: id })
          reference.ready.then(value => {
            if (active) setBinding(value)
          }).catch(error => {
            if (active) setError(errorText(error))
          })
        } catch (error) {
          setError(errorText(error))
        }
        return () => {
          active = false
          reference?.release()
        }
      }, [ctx, childId])

      async function send(event) {
        event.preventDefault()
        const question = draft.trim()
        if (!question || !session || sending.current) return
        sending.current = true
        setBusy(true)
        setError('')
        try {
          const hasPrompt = quoted || messages.some(message => message.author === '你')
          const text = hasPrompt || !quote ? question : `关于以下选中的原对话内容：\n\n${quote.split('\n').map(line => '> ' + line).join('\n')}\n\n我的问题：${question}`
          const result = await session.prompt([{ type: 'text', text }], 'queue')
          if (!result.ok) throw new Error(result.error?.message || 'DSH 未接受这条消息')
          setQuoted(true)
          setDraft(current => current.trim() === question ? '' : current)
        } catch (error) {
          setError(errorText(error))
        } finally {
          sending.current = false
          setBusy(false)
        }
      }

      async function openChild() {
        try {
          await ctx.uiWorkspace.openSession(childId)
        } catch (error) {
          setError(errorText(error))
        }
      }

      return h('section', { 'aria-label': '侧边追问', className: 'dsh-side-chat' },
        h('style', null, panelStyle),
        h('header', null,
          h('strong', null, '侧边追问'),
          h('button', { type: 'button', onClick: openChild }, '打开完整会话')
        ),
        quote ? h('details', null,
          h('summary', null, '选中的内容'), h('p', null, quote)
        ) : null,
        h('div', { role: 'log', 'aria-live': 'off', className: 'dsh-side-chat-log' },
          ...messages.map(message => h('article', {
            key: message.seq,
            className: message.author === '你' ? 'dsh-side-chat-user' : undefined,
            'aria-label': message.author
          }, h('p', null, message.text)
          )),
          partial ? h('p', { 'aria-label': 'AI' }, partial) : null,
          !messages.length && !partial && binding ? h('p', { className: 'dsh-side-chat-muted' }, '输入问题，从这段内容继续讨论。') : null
        ),
        h('div', { role: 'status', className: 'dsh-side-chat-muted' },
          error || state?.lastAgentError?.message || (!binding ? '正在加载分支…' : state?.running ? '分支正在回复。如需审批，可打开完整会话。' : '')
        ),
        h('form', { onSubmit: send },
          h('textarea', {
            'aria-label': '追问内容', placeholder: '输入追问…', value: draft, rows: 3,
            onChange: event => setDraft(event.target.value),
            onKeyDown: submitOnEnter
          }),
          h('button', { type: 'submit', disabled: !binding || busy || !draft.trim() }, busy ? '正在发送…' : '发送到分支')
        )
      )
    }

    function ChatIcon({ size = 22, className }) {
      return h('svg', { width: size, height: size, className, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M7 9h10 M7 13h6', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' })
      )
    }

    function apply(ctx) {
      const emptyTabs = new Map()

      function StartChat({ tab }) {
        const [draft, setDraft] = useState('')
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState('')
        const pending = useRef(null)
        const lock = useRef(false)

        async function start(event) {
          event.preventDefault()
          if (!draft.trim() || lock.current) return
          lock.current = true
          setBusy(true)
          setError('')
          try {
            const parentId = activeSession(ctx.sessions)
            const binding = parentId && ctx.sessions.binding(parentId)
            if (!binding) throw new Error('请先打开一个已有的主聊天')
            const state = binding.session.getSnapshot()
            if (state.running || state.pendingSubmissions?.length) throw new Error('请等待主聊天空闲后再试')
            const ends = binding.eventSource.getSnapshot().entries.filter(({ event }) => event.type === 'turn/end')
            const atSeq = ends.at(-1)?.event.seq
            if (!Number.isSafeInteger(atSeq)) throw new Error('请先完成主聊天中的一轮对话')
            if (pending.current && pending.current.parentId !== parentId) pending.current = null
            if (!pending.current) {
              const childId = await ctx.sessions.fork({ sessionId: parentId, atSeq })
              pending.current = { parentId, childId, atSeq, archived: false }
            }
            const branch = pending.current
            if (!branch.archived) {
              await ctx.uiWorkspace.archiveSession(branch.childId)
              branch.archived = true
            }
            const reference = ctx.sessions.retain(branch.childId, { source: id })
            try {
              const child = await reference.ready
              if (!branch.sent) {
                const result = await child.session.prompt([{ type: 'text', text: draft.trim() }], 'queue')
                if (!result.ok) throw new Error(result.error?.message || 'DSH 未接受这条消息')
                branch.sent = true
              }
              if (activeSession(ctx.sessions) !== parentId) throw new Error('消息已发送，请切回原主聊天后重试打开')
              ctx.sidebarRight.openTab(id, {
                replaceTab: tab.id,
                params: { childId: branch.childId, atSeq: branch.atSeq, quote: '' }
              })
            } finally {
              reference.release()
            }
          } catch (error) {
            setError(errorText(error))
          } finally {
            lock.current = false
            setBusy(false)
          }
        }

        return h('section', { className: 'dsh-side-chat', 'aria-label': '侧边追问' },
          h('style', null, panelStyle),
          h('div', { className: 'dsh-side-chat-log' },
            h('p', { className: 'dsh-side-chat-muted' }, '输入问题，从当前主聊天继续追问。')
          ),
          h('div', { role: 'status', className: 'dsh-side-chat-muted' }, error),
          h('form', { onSubmit: start },
            h('textarea', { 'aria-label': '追问内容', placeholder: '输入追问，Enter 发送，Shift+Enter 换行', rows: 3, value: draft, onChange: event => setDraft(event.target.value), onKeyDown: submitOnEnter }),
            h('button', { type: 'submit', disabled: busy || !draft.trim() }, busy ? '正在发送…' : '发送')
          )
        )
      }

      function SideTab({ useTabInfo }) {
        const { tab } = useTabInfo()
        const params = tab.navigation.params
        useEffect(() => {
          if (params?.childId || !tab.visible) return
          const parentId = activeSession(ctx.sessions)
          if (!parentId) return
          emptyTabs.set(parentId, tab.id)
          return () => {
            if (emptyTabs.get(parentId) === tab.id) emptyTabs.delete(parentId)
          }
        }, [params?.childId, tab.id, tab.visible])
        if (!params?.childId) return h(StartChat, { tab })
        return h(BranchChat, { key: params.childId, ctx, ...params })
      }

      ctx.effect(() => ctx.sidebarRightTabs.register({
        id, kind: id, multiple: true, title: () => '侧边追问',
        guide: [{
          id: 'open',
          order: 40,
          title: () => '侧边追问',
          description: () => '从主聊天选中一段回答，在侧边继续聊',
          icon: ChatIcon
        }]
      }))
      ctx.slots.inject(seat, () => ctx.slots.register({ name: seat, key: id }, SideTab))

      ctx.effect(() => {
        let selected
        let opening = false
        let disposed = false
        let timer
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = '侧边追问'
        button.hidden = true
        Object.assign(button.style, {
          position: 'fixed', zIndex: '9999', padding: '6px 12px', borderRadius: '8px',
          border: '1px solid var(--dsw-alias-border-l3, GrayText)',
          background: 'var(--dsw-alias-bg-layer-1, Canvas)',
          color: 'var(--dsw-alias-label-primary, CanvasText)', cursor: 'pointer'
        })
        document.body.append(button)

        function dismiss() {
          if (opening) return
          selected = undefined
          button.hidden = true
        }

        function showSelection() {
          if (opening) return
          const selection = window.getSelection()
          if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return dismiss()
          const parent = node => node?.nodeType === 1 ? node : node?.parentElement
          const start = parent(selection.anchorNode)?.closest(answer)
          const end = parent(selection.focusNode)?.closest(answer)
          const turn = start?.dataset.chatTurn
          const scroll = start?.closest('[data-conversation-scroll]')
          if (!turn || !scroll || end?.closest('[data-conversation-scroll]') !== scroll || end?.dataset.chatTurn !== turn) return dismiss()
          const quote = selection.toString().trim()
          const parentId = activeSession(ctx.sessions)
          if (!quote || !parentId) return dismiss()
          const rect = selection.getRangeAt(0).getBoundingClientRect()
          selected = { parentId, turn, quote: quote.slice(0, 6000) }
          button.textContent = '侧边追问'
          button.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 170)) + 'px'
          button.style.top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 46)) + 'px'
          button.hidden = false
        }

        async function openBranch() {
          if (!selected || opening) return
          const selection = selected
          const { parentId, turn, quote } = selection
          if (activeSession(ctx.sessions) !== parentId) return dismiss()
          const binding = ctx.sessions.binding(parentId)
          const atSeq = completedTurn(binding, turn)
          if (!Number.isSafeInteger(atSeq)) {
            button.textContent = '请等待这轮回答结束'
            return
          }
          const source = binding.session.getSnapshot()
          if (source.running || source.pendingSubmissions?.length) {
            button.textContent = '请等待主聊天空闲'
            return
          }
          opening = true
          button.disabled = true
          button.textContent = '正在创建分支…'
          try {
            const childId = selection.childId ?? await ctx.sessions.fork({ sessionId: parentId, atSeq })
            selection.childId = childId
            if (!selection.archived) {
              button.textContent = '正在隐藏侧边分支…'
              await ctx.uiWorkspace.archiveSession(childId)
              selection.archived = true
            }
            if (disposed || activeSession(ctx.sessions) !== parentId) return
            const emptyTab = emptyTabs.get(parentId)
            ctx.sidebarRight.openTab(id, {
              ...(emptyTab === undefined ? {} : { replaceTab: emptyTab }),
              params: { childId, atSeq, quote }
            })
            selected = undefined
            button.hidden = true
          } catch (error) {
            button.textContent = '创建失败，点击重试'
            button.title = errorText(error)
            console.warn('[dsh-side-conversation]', error)
          } finally {
            button.disabled = false
            opening = false
            if (activeSession(ctx.sessions) !== parentId) dismiss()
          }
        }

        function scheduleSelection() {
          window.clearTimeout(timer)
          timer = window.setTimeout(showSelection, 90)
        }
        const preserve = event => event.preventDefault()
        const escape = event => { if (event.key === 'Escape') dismiss() }
        button.addEventListener('mousedown', preserve)
        button.addEventListener('click', openBranch)
        document.addEventListener('selectionchange', scheduleSelection)
        document.addEventListener('keydown', escape)
        document.addEventListener('scroll', dismiss, true)
        return () => {
          disposed = true
          window.clearTimeout(timer)
          document.removeEventListener('selectionchange', scheduleSelection)
          document.removeEventListener('keydown', escape)
          document.removeEventListener('scroll', dismiss, true)
          button.remove()
        }
      })
    }

    return { inject: ['sessions', 'slots', 'sidebarRightTabs', 'sidebarRight', 'uiWorkspace'], apply }
  }
})
