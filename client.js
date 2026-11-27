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
    const smallText = { fontSize: 12, opacity: 0.8 }
    const breakText = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 }
    const errorText = error => error?.message || String(error)

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
          const text = hasPrompt ? question : `关于以下选中的原对话内容：\n\n${quote.split('\n').map(line => '> ' + line).join('\n')}\n\n我的问题：${question}`
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

      return h('section', { 'aria-label': '侧边追问', style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10, boxSizing: 'border-box' } },
        h('header', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 } },
          h('strong', null, '侧边追问'),
          h('button', { type: 'button', onClick: openChild, style: smallText }, '打开完整会话')
        ),
        h('details', { style: { ...smallText, maxHeight: '22%', overflow: 'auto' } },
          h('summary', null, '选中的内容'), h('p', { style: breakText }, quote)
        ),
        h('div', { role: 'log', 'aria-live': 'off', style: { flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', alignContent: 'start', gap: 12 } },
          ...messages.map(message => h('article', { key: message.seq },
            h('strong', { style: smallText }, message.author), h('p', { style: breakText }, message.text)
          )),
          partial ? h('p', { style: breakText }, partial) : null,
          !messages.length && !partial && binding ? h('p', { style: smallText }, '输入问题，从这段内容继续讨论。') : null
        ),
        h('div', { role: 'status', style: smallText },
          error || state?.lastAgentError?.message || (!binding ? '正在加载分支…' : state?.running ? '分支正在回复。如需审批，可打开完整会话。' : '')
        ),
        h('form', { onSubmit: send, style: { display: 'grid', gap: 6 } },
          h('textarea', {
            'aria-label': '追问内容', placeholder: '输入追问…', value: draft, rows: 3,
            onChange: event => setDraft(event.target.value),
            style: { width: '100%', boxSizing: 'border-box', padding: 8, resize: 'vertical' }
          }),
          h('button', { type: 'submit', disabled: !binding || busy || !draft.trim() }, busy ? '正在发送…' : '发送到分支')
        )
      )
    }

    function apply(ctx) {
      function SideTab({ useTabInfo }) {
        const params = useTabInfo().tab.navigation.params
        if (!params?.childId) return h('p', { style: { padding: 12 } }, '在主聊天中选中一段回答，然后点击「侧边追问」。')
        return h(BranchChat, { key: params.childId, ctx, ...params })
      }

      ctx.effect(() => ctx.sidebarRightTabs.register({
        id, kind: id, multiple: true, title: () => '侧边追问'
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
          border: '1px solid GrayText', background: 'Canvas', color: 'CanvasText', cursor: 'pointer'
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
          const { parentId, turn, quote } = selected
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
            const childId = await ctx.sessions.fork({ sessionId: parentId, atSeq })
            if (disposed || activeSession(ctx.sessions) !== parentId) return
            ctx.sidebarRight.openTab(id, { params: { childId, atSeq, quote } })
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
