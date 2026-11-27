window.__ModuleLoader__.load({
  id: 'dsh-side-conversation',
  factory(require) {
    const React = require('react')
    const { createElement: h, useEffect, useState, useRef } = React
    const id = 'dsh-side-conversation'
    const seat = 'sidebar.right.pane.tab'
    const answer = '[data-chat-flow-kind="assistant-step"][data-chat-turn]'
    // DSH 0.2.1 hides its TurnNavigator in narrow conversation containers.
    // Match the navigator's structure without tying the override to a CSS build hash.
    const turnRail = '[data-dsh-side-chat] div[class$="_slot"] > nav[class$="_frame"]:has(> div[class*="_scroller"] > div[class$="_marks"])'
    const turnRailStyles = `
      ${turnRail} { display: block !important; right: 4px; width: 22px; }
      ${turnRail} > [role="tooltip"] { width: min(300px, max(0px, calc(100cqw - 48px))); }
    `
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

    function ChatIcon({ size = 22, className }) {
      return h('svg', { width: size, height: size, className, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M7 9h10 M7 13h6', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' })
      )
    }

    function apply(ctx) {
      const emptyTabs = new Map()
      const trackedTabs = new WeakSet()
      const storageKey = 'dsh-side-conversation.hidden-branches'
      const hiddenBranches = new Set()
      const rowStyle = document.createElement('style')
      document.head.append(rowStyle)

      function updateHiddenRows() {
        rowStyle.textContent = [...hiddenBranches]
          .filter(childId => typeof childId === 'string' && /^[a-z0-9_-]+$/i.test(childId))
          .map(childId => `[data-row-key="session:${childId}"] { display: none !important; }`)
          .join('\n')
      }

      try {
        const saved = JSON.parse(window.localStorage.getItem(storageKey) || '[]')
        if (Array.isArray(saved)) saved.forEach(childId => hiddenBranches.add(childId))
      } catch {}
      updateHiddenRows()
      ctx.effect(() => () => rowStyle.remove())

      function hideBranch(childId) {
        if (hiddenBranches.has(childId)) return
        hiddenBranches.add(childId)
        updateHiddenRows()
        try {
          window.localStorage.setItem(storageKey, JSON.stringify([...hiddenBranches]))
        } catch {}
      }

      function archiveWhenClosed(signal, childId) {
        if (!signal || trackedTabs.has(signal)) return
        trackedTabs.add(signal)
        signal.addEventListener('abort', async () => {
          for (let attempt = 0; attempt < 60; attempt += 1) {
            try {
              await ctx.uiWorkspace.archiveSession(childId)
              return
            } catch (error) {
              if ((error.rpcError?.code ?? error.code) !== 'workspace/session-active') {
                console.warn('[dsh-side-conversation] 归档失败', error)
                return
              }
              await new Promise(resolve => window.setTimeout(resolve, 5000))
            }
          }
        }, { once: true })
      }

      function NativeChat({ childId, SessionProvider, renderFactorySlot }) {
        const [reference, setReference] = useState(null)
        const [error, setError] = useState('')
        useEffect(() => {
          let active = true
          let retained
          try {
            retained = ctx.sessions.retain(childId, { source: id })
            retained.ready.then(() => {
              if (!active) return
              setReference(retained)
            }).catch(error => { if (active) setError(errorText(error)) })
          } catch (error) {
            setError(errorText(error))
          }
          return () => {
            active = false
            retained?.release()
          }
        }, [childId])

        if (!reference) return h('p', { role: 'status', style: { padding: 12 } }, error || '正在打开侧边会话…')
        return h('section', { 'aria-label': '侧边追问', 'data-dsh-side-chat': '', style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' } },
          h(SessionProvider, { session: reference },
            renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false },
              { fallback: h('p', { role: 'status' }, '当前 DSH 版本未提供原生聊天输入栏') })
          ),
          h('style', null, turnRailStyles)
        )
      }

      function StartChat({ tab }) {
        const [error, setError] = useState('')
        const [busy, setBusy] = useState(false)
        const opening = useRef(false)

        async function start() {
          if (opening.current || !tab.visible || tab.signal.aborted) return
          opening.current = true
          setBusy(true)
          setError('')
          try {
            const parentId = activeSession(ctx.sessions)
            const binding = parentId && ctx.sessions.binding(parentId)
            if (!binding) throw new Error('请先打开一个已有的主聊天')
            const state = binding.session.getSnapshot()
            if (state.running || state.pendingSubmissions?.length) throw new Error('请等待主聊天空闲后重试')
            const ends = binding.eventSource.getSnapshot().entries.filter(({ event }) => event.type === 'turn/end')
            const atSeq = ends.at(-1)?.event.seq
            if (!Number.isSafeInteger(atSeq)) throw new Error('请先完成主聊天中的一轮对话')
            const childId = await ctx.sessions.fork({ sessionId: parentId, atSeq })
            hideBranch(childId)
            if (tab.signal.aborted) {
              await ctx.uiWorkspace.archiveSession(childId)
              return
            }
            tab.actions.openTab(id, { replaceTab: true, params: { childId } })
          } catch (error) {
            if (!tab.signal.aborted) setError(errorText(error))
          } finally {
            opening.current = false
            if (!tab.signal.aborted) setBusy(false)
          }
        }

        useEffect(() => { void start() }, [tab.visible, tab.signal])
        return h('section', { 'aria-label': '侧边追问', style: { padding: 12 } },
          h('p', { role: 'status' }, error || '正在创建侧边会话…'),
          error ? h('button', { type: 'button', disabled: busy, onClick: start }, '重试') : null
        )
      }
      function SideTab({ useTabInfo, SessionProvider, renderFactorySlot }) {
        const { tab } = useTabInfo()
        const params = tab.navigation.params
        useEffect(() => {
          if (params?.childId) {
            hideBranch(params.childId)
            archiveWhenClosed(tab.signal, params.childId)
          }
        }, [params?.childId, tab.signal])
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
        return h(NativeChat, { key: params.childId, childId: params.childId, SessionProvider, renderFactorySlot })
      }

      ctx.effect(() => ctx.sidebarRightTabs.register({
        id, kind: id, multiple: true, title: () => '侧边追问',
        guide: [{
          id: 'open',
          order: 40,
          title: () => '侧边追问',
          description: () => '从主聊天创建分支，在侧边继续聊',
          icon: ChatIcon
        }]
      }))
      ctx.slots.inject(seat, () => ctx.slots.register({
        name: seat,
        key: id,
        children: { 'dsh-side-conversation.scope': { kind: 'single', scope: 'session' } }
      }, SideTab))
      ctx.effect(() => {
        let selected
        let opening = false
        let disposed = false
        let timer
        const actions = document.createElement('div')
        actions.hidden = true
        actions.setAttribute('role', 'group')
        actions.setAttribute('aria-label', '所选文字操作')
        const button = document.createElement('button')
        button.textContent = '侧边追问'
        Object.assign(actions.style, {
          position: 'fixed', zIndex: '9999', borderRadius: '8px',
          border: '1px solid var(--dsw-alias-border-l3, GrayText)',
          background: 'var(--dsw-alias-bg-layer-1, Canvas)',
          color: 'var(--dsw-alias-label-primary, CanvasText)'
        })
        button.type = 'button'
        Object.assign(button.style, {
          padding: '6px 10px', border: '0', background: 'transparent', color: 'inherit', cursor: 'pointer'
        })
        actions.append(button)
        document.body.append(actions)

        function dismiss() {
          if (opening) return
          selected = undefined
          actions.hidden = true
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
          const conversation = scroll.closest('[data-conversation-session]')
          const parentId = conversation?.dataset.conversationSession
          if (!parentId || conversation.closest('[data-dsh-side-chat]') || !selection.toString().trim()) return dismiss()
          const range = selection.getRangeAt(0)
          const rect = range.getBoundingClientRect()
          selected = { parentId, turn }
          button.textContent = '侧边追问'
          button.title = ''
          actions.hidden = false
          actions.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - actions.offsetWidth - 8)) + 'px'
          actions.style.top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 46)) + 'px'
        }

        async function openBranch() {
          if (!selected || opening) return
          const selection = selected
          const { parentId, turn } = selection
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
            hideBranch(childId)
            selection.childId = childId
            if (disposed || activeSession(ctx.sessions) !== parentId) return
            const emptyTab = emptyTabs.get(parentId)
            ctx.sidebarRight.openTab(id, {
              ...(emptyTab === undefined ? {} : { replaceTab: emptyTab }),
              params: { childId }
            })
            selected = undefined
            actions.hidden = true
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
        actions.addEventListener('mousedown', preserve)
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
          actions.remove()
        }
      })
    }

    return { inject: ['sessions', 'slots', 'sidebarRightTabs', 'sidebarRight', 'uiWorkspace'], apply }
  }
})
