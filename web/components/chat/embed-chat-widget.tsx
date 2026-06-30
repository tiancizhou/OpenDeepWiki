"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { X, Send, Loader2, Trash2, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * 嵌入对话组件属性
 */
export interface EmbedChatWidgetProps {
  /** 应用ID */
  appId: string
  /** 自定义图标URL */
  iconUrl?: string
  /** 位置 */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  /** 主题 */
  theme?: 'light' | 'dark'
  /** API基础URL */
  apiBaseUrl?: string
  /** 欢迎标题 */
  welcomeTitle?: string
  /** 欢迎副标题 */
  welcomeSubtitle?: string
  /** 快捷问题 */
  suggestedQuestions?: string[]
}

/**
 * 嵌入配置响应
 */
interface EmbedConfig {
  valid: boolean
  errorCode?: string
  errorMessage?: string
  appName?: string
  iconUrl?: string
}

/**
 * 对话消息
 */
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

/**
 * SSE事件
 */
interface SSEEvent {
  type: 'content' | 'thinking' | 'tool_call' | 'tool_result' | 'done' | 'error'
  data: unknown
}

function getSSEContent(data: unknown, rawData?: string): string | null {
  if (typeof data === 'string') {
    return data
  }

  if (data && typeof data === 'object' && 'data' in data) {
    const nestedData = (data as { data?: unknown }).data
    return typeof nestedData === 'string' ? nestedData : null
  }

  if (rawData !== undefined) {
    return rawData
  }

  return null
}

/**
 * 错误信息
 */
interface ErrorInfo {
  code?: string
  message: string
  retryable?: boolean
  retryAfterMs?: number
}

/**
 * 默认超时时间（毫秒）
 */
const DEFAULT_TIMEOUT_MS = 30000

/**
 * 默认重试次数
 */
const DEFAULT_MAX_RETRIES = 2

/**
 * 默认重试延迟（毫秒）
 */
const DEFAULT_RETRY_DELAY_MS = 1000

function AssistantAvatar() {
  return (
    <span className="inline-flex animate-[odw-assistant-float_2.8s_ease-in-out_infinite]" aria-hidden="true">
      <svg width="62" height="62" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="40" cy="40" r="38" fill="rgba(255,255,255,0.18)" />
        <path d="M23 38c0-10.5 7.5-18 17-18s17 7.5 17 18v10c0 8.5-7 15-17 15s-17-6.5-17-15V38z" fill="white" />
        <path d="M27 35c1.5-8 6.5-12 13-12s11.5 4 13 12c-4.2-3-8.4-4.4-13-4.4S31.2 32 27 35z" fill="#dbeafe" />
        <rect x="29" y="37" width="22" height="13" rx="6.5" fill="#eef6ff" />
        <circle cx="35" cy="43" r="2.4" fill="#1d4ed8" />
        <circle cx="45" cy="43" r="2.4" fill="#1d4ed8" />
        <path d="M36 50c2.4 2 5.6 2 8 0" stroke="#0f766e" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M22 41h-3.5A4.5 4.5 0 0 1 14 36.5v-2A4.5 4.5 0 0 1 18.5 30H22" stroke="white" strokeWidth="5" strokeLinecap="round" />
        <path d="M58 41h3.5A4.5 4.5 0 0 0 66 36.5v-2A4.5 4.5 0 0 0 61.5 30H58" stroke="white" strokeWidth="5" strokeLinecap="round" />
        <circle cx="58" cy="21" r="8" fill="#fbbf24" />
        <path d="M55 21h6M58 18v6" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </span>
  )
}

/**
 * 嵌入对话组件
 * 
 * 独立的悬浮球和对话面板，用于嵌入到外部网站
 * 使用应用配置的模型进行对话
 * 支持错误处理、超时和重试
 * 
 * Requirements: 14.5, 14.6, 11.1, 11.2, 11.3, 11.4
 */
export function EmbedChatWidget({
  appId,
  iconUrl: propIconUrl,
  position = 'bottom-right',
  theme = 'light',
  apiBaseUrl = '',
  welcomeTitle,
  welcomeSubtitle,
  suggestedQuestions = [],
}: EmbedChatWidgetProps) {
  const t = useTranslations("chat")
  const [isOpen, setIsOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isEnabled, setIsEnabled] = React.useState(false)
  const [config, setConfig] = React.useState<EmbedConfig | null>(null)
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState("")
  const [isSending, setIsSending] = React.useState(false)
  const [error, setError] = React.useState<ErrorInfo | null>(null)
  const [lastRequest, setLastRequest] = React.useState<{
    content: string
    userMessageId: string
    assistantMessageId: string
  } | null>(null)
  
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = React.useRef<AbortController | null>(null)

  // 获取图标URL
  const iconUrl = propIconUrl || config?.iconUrl

  // 加载配置
  React.useEffect(() => {
    const loadConfig = async () => {
      try {
        const url = `${apiBaseUrl}/api/v1/embed/config?appId=${encodeURIComponent(appId)}`
        const response = await fetch(url)
        const data: EmbedConfig = await response.json()
        
        if (data.valid) {
          setIsEnabled(true)
          setConfig(data)
        } else {
          console.error('[EmbedChatWidget] ' + t("embed.configInvalid"), data.errorMessage)
          setIsEnabled(false)
        }
      } catch (err) {
        console.error('[EmbedChatWidget] ' + t("embed.loadConfigFailed"), err)
        setIsEnabled(false)
      } finally {
        setIsLoading(false)
      }
    }

    loadConfig()
  }, [appId, apiBaseUrl])

  // 滚动到底部
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 聚焦输入框
  React.useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // 组件卸载时取消请求
  React.useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  // 生成消息ID
  const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

  // 切换面板
  const handleToggle = React.useCallback(() => {
    setIsOpen(prev => !prev)
  }, [])

  // 清空对话
  const handleClear = React.useCallback(() => {
    setMessages([])
    setError(null)
    setLastRequest(null)
  }, [])

  /**
   * 带超时的fetch请求
   */
  const fetchWithTimeout = async (
    url: string,
    options: RequestInit,
    timeoutMs: number
  ): Promise<Response> => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      return response
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * 延迟函数
   */
  const delay = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // 发送消息
  const handleSend = React.useCallback(async (overrideContent?: string) => {
    const content = (overrideContent ?? input).trim()
    if (!content || isSending) return

    setError(null)
    setIsSending(true)

    // 创建新的AbortController
    abortControllerRef.current = new AbortController()

    // 添加用户消息
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMessage])
    setInput("")

    // 添加助手消息占位
    const assistantMessage: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, assistantMessage])

    // 保存请求信息以便重试
    setLastRequest({
      content,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
    })

    let retryCount = 0
    const maxRetries = DEFAULT_MAX_RETRIES
    const retryDelayMs = DEFAULT_RETRY_DELAY_MS

    while (retryCount <= maxRetries) {
      try {
        const url = `${apiBaseUrl}/api/v1/embed/stream`
        const allMessages = [...messages, userMessage]
        
        const response = await fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              appId,
              messages: allMessages.map(m => ({
                role: m.role,
                content: m.content,
              })),
            }),
          },
          DEFAULT_TIMEOUT_MS
        )

        if (!response.ok) {
          const isRetryable = response.status >= 500 || response.status === 429
          
          if (isRetryable && retryCount < maxRetries) {
            retryCount++
            await delay(retryDelayMs * retryCount)
            continue
          }
          
          throw new Error(`Request failed: ${response.status}`)
        }

        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('Unable to read response')
        }

        const decoder = new TextDecoder()
        let buffer = ''
        let assistantContent = ''
        let currentEventType = ''
        let receivedDone = false

        const updateAssistantMessage = (content: string) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMessage.id
                ? { ...m, content }
                : m
            )
          )
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmedLine = line.trim()
            if (!trimmedLine) continue

            if (trimmedLine.startsWith('event:')) {
              currentEventType = trimmedLine.substring(6).trim()
              continue
            }

            if (trimmedLine.startsWith('data: ')) {
              const dataStr = trimmedLine.substring(6)
              let event: SSEEvent | null = null
              try {
                const data = JSON.parse(dataStr)
                event = {
                  type: (currentEventType || data.type) as SSEEvent['type'],
                  data: data.data ?? data,
                }
              } catch {
                if (currentEventType === 'content' && typeof dataStr === 'string' && dataStr.trim()) {
                  event = {
                    type: 'content',
                    data: dataStr,
                  }
                }
              }

              if (event) {
                if (event.type === 'content') {
                  const contentChunk = getSSEContent(event.data, dataStr)
                  if (contentChunk !== null) {
                    assistantContent += contentChunk
                    updateAssistantMessage(assistantContent)
                  }
                } else if (event.type === 'thinking') {
                  if (!assistantContent) {
                    updateAssistantMessage('正在思考...')
                  }
                } else if (event.type === 'tool_call') {
                  if (!assistantContent) {
                    const toolCall = event.data as { name?: string }
                    updateAssistantMessage(toolCall.name ? `正在查阅资料：${toolCall.name}` : '正在查阅资料...')
                  }
                } else if (event.type === 'done') {
                  // 对话完成，清除重试信息
                  receivedDone = true
                  setLastRequest(null)
                } else if (event.type === 'error') {
                  const errorData = event.data as ErrorInfo
                  throw new Error(errorData.message || 'Chat request failed')
                }
              }
            }
          }
        }

        if (!receivedDone) {
          throw new Error('响应流已中断，请重试')
        }
        
        // 成功完成，退出重试循环
        break
        
      } catch (err) {
        // 处理超时错误
        if (err instanceof Error && err.name === 'AbortError') {
          if (retryCount < maxRetries) {
            retryCount++
            await delay(retryDelayMs * retryCount)
            continue
          }
          
          setError({
            message: 'Request timed out. Please retry.',
            code: 'REQUEST_TIMEOUT',
            retryable: true,
            retryAfterMs: retryDelayMs,
          })
          // 移除空的助手消息
          setMessages(prev => prev.filter(m => m.id !== assistantMessage.id))
          break
        }
        
        // 处理网络错误
        if (err instanceof TypeError && err.message.includes('fetch')) {
          if (retryCount < maxRetries) {
            retryCount++
            await delay(retryDelayMs * retryCount)
            continue
          }
          
          setError({
            message: 'Connection failed. Please check your network.',
            code: 'CONNECTION_FAILED',
            retryable: true,
            retryAfterMs: retryDelayMs,
          })
          // 移除空的助手消息
          setMessages(prev => prev.filter(m => m.id !== assistantMessage.id))
          break
        }
        
        console.error('[EmbedChatWidget] Send failed:', err)
        setError({
          message: err instanceof Error ? err.message : 'Send failed. Please retry.',
          retryable: true,
        })
        // 移除空的助手消息
        setMessages(prev => prev.filter(m => m.id !== assistantMessage.id))
        break
      }
    }
    
    setIsSending(false)
    abortControllerRef.current = null
  }, [input, isSending, messages, appId, apiBaseUrl])

  const handleQuickQuestion = React.useCallback((question: string) => {
    if (!question.trim() || isSending) return
    void handleSend(question)
  }, [handleSend, isSending])

  // 重试发送
  const handleRetry = React.useCallback(() => {
    if (!lastRequest) return
    
    // 恢复输入状态
    setInput(lastRequest.content)
    setError(null)
    
    // 重新发送
    void handleSend(lastRequest.content)
  }, [lastRequest, handleSend])

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  // 获取位置样式
  const getPositionClasses = () => {
    const positions = {
      'bottom-right': 'right-6 bottom-6',
      'bottom-left': 'left-6 bottom-6',
      'top-right': 'right-6 top-6',
      'top-left': 'left-6 top-6',
    }
    return positions[position]
  }

  // 获取面板位置样式
  const getPanelPositionClasses = () => {
    const positions = {
      'bottom-right': 'right-6 bottom-24',
      'bottom-left': 'left-6 bottom-24',
      'top-right': 'right-6 top-24',
      'top-left': 'left-6 top-24',
    }
    return positions[position]
  }

  // 加载中或未启用时不显示
  if (isLoading || !isEnabled) {
    return null
  }

  const isDark = theme === 'dark'
  const canSend = input.trim() && !isSending

  return (
    <>
      <style jsx global>{`
        @keyframes odw-assistant-pulse {
          0% {
            transform: scale(0.86);
            opacity: 0.45;
          }
          70%,
          100% {
            transform: scale(1.28);
            opacity: 0;
          }
        }

        @keyframes odw-assistant-float {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-2px);
          }
        }
      `}</style>

      {/* 悬浮球 */}
      {!isOpen && (
        <button
          type="button"
          onClick={handleToggle}
          className={cn(
            "fixed z-[99999] flex items-center justify-center overflow-hidden",
            "h-[72px] w-[72px] rounded-full",
            "bg-gradient-to-br from-emerald-400 via-blue-600 to-violet-600",
            "text-white shadow-[0_16px_34px_rgba(37,99,235,0.34),0_4px_12px_rgba(15,23,42,0.18)]",
            "transition-all duration-200 ease-in-out",
            "hover:-translate-y-0.5 hover:scale-[1.06] hover:shadow-[0_20px_42px_rgba(37,99,235,0.42),0_8px_18px_rgba(15,23,42,0.22)]",
            "active:scale-95",
            "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
            "before:absolute before:-inset-[7px] before:rounded-full before:border-2 before:border-blue-600/30 before:content-[''] before:animate-[odw-assistant-pulse_2.2s_ease-out_infinite]",
            getPositionClasses()
          )}
          aria-label={t("assistant.title")}
          aria-expanded={false}
        >
          {iconUrl ? (
            <img
              src={iconUrl}
              alt={t("assistant.title")}
              className="h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <AssistantAvatar />
          )}
        </button>
      )}

      {/* 对话面板 */}
      {isOpen && (
        <div
          className={cn(
            "fixed z-[99998] flex flex-col",
            "w-[380px] h-[600px] max-h-[calc(100vh-120px)]",
            "rounded-xl shadow-2xl overflow-hidden",
            "transition-all duration-300 ease-in-out",
            isDark ? "bg-gray-900 text-white" : "bg-white text-gray-900",
            getPanelPositionClasses()
          )}
        >
          {/* 头部 */}
          <div
            className={cn(
              "flex items-center justify-between px-4 py-3 border-b",
              isDark ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-200"
            )}
          >
            <div className="flex items-center gap-3">
              <span className="font-semibold">
                {config?.appName || t("embed.title")}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleClear}
                disabled={messages.length === 0}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  isDark 
                    ? "hover:bg-gray-700 disabled:opacity-50" 
                    : "hover:bg-gray-200 disabled:opacity-50"
                )}
                title={t("panel.clearHistory")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleToggle}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  isDark ? "hover:bg-gray-700" : "hover:bg-gray-200"
                )}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center text-gray-500">
                <div className="mb-3 text-4xl">👋</div>
                <div className="mb-2 text-lg font-semibold text-gray-700">
                  {welcomeTitle || t("embed.greeting")}
                </div>
                <div className="text-sm">{welcomeSubtitle || t("embed.greetingSubtitle")}</div>
                {suggestedQuestions.length > 0 && (
                  <div className="mt-7 flex w-full max-w-[300px] flex-col gap-2.5">
                    {suggestedQuestions.slice(0, 6).map((question) => (
                      <button
                        key={question}
                        type="button"
                        disabled={isSending}
                        onClick={() => handleQuickQuestion(question)}
                        className={cn(
                          "rounded-md border border-transparent px-2 py-1 text-center text-lg font-medium leading-snug text-red-500",
                          "transition hover:-translate-y-0.5 hover:border-red-200 hover:bg-red-50",
                          "disabled:cursor-not-allowed disabled:opacity-60",
                          isDark && "text-red-300 hover:border-red-900/60 hover:bg-red-950/30"
                        )}
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words",
                    message.role === 'user'
                      ? "ml-auto max-w-[80%] bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-br-sm"
                      : cn(
                          "mr-auto max-w-[92%] rounded-bl-sm",
                          isDark ? "bg-gray-700 text-gray-100" : "bg-gray-100 text-gray-900"
                        )
                  )}
                >
                  {message.role === 'assistant' && !message.content && isSending ? (
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  ) : (
                    <MessageContent content={message.content} isDark={isDark} />
                  )}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="mx-4 mb-2 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg">
              <div className="flex items-center justify-between">
                <span>{error.message}</span>
                <div className="flex items-center gap-2">
                  {error.retryable && lastRequest && (
                    <button
                      className="flex items-center gap-1 underline hover:no-underline"
                      onClick={handleRetry}
                      disabled={isSending}
                    >
                      <RefreshCw className="h-3 w-3" />
                      {t("panel.retry")}
                    </button>
                  )}
                  <button
                    className="underline hover:no-underline"
                    onClick={() => setError(null)}
                  >
                    {t("panel.closeError")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 输入区域 */}
          <div
            className={cn(
              "p-4 border-t flex items-end gap-2",
              isDark ? "border-gray-700" : "border-gray-200"
            )}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("embed.inputPlaceholder")}
              rows={1}
              disabled={isSending}
              className={cn(
                "flex-1 min-h-[40px] max-h-[120px] px-3 py-2.5",
                "border rounded-lg resize-none text-sm",
                "focus:outline-none focus:ring-2 focus:ring-indigo-500",
                isDark 
                  ? "bg-gray-800 border-gray-600 text-white placeholder-gray-400" 
                  : "bg-white border-gray-300 placeholder-gray-500"
              )}
              style={{
                height: 'auto',
                minHeight: '40px',
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = 'auto'
                target.style.height = Math.min(target.scrollHeight, 120) + 'px'
              }}
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!canSend}
              className={cn(
                "w-10 h-10 flex items-center justify-center rounded-lg",
                "bg-gradient-to-br from-indigo-500 to-purple-600 text-white",
                "transition-opacity",
                canSend ? "opacity-100" : "opacity-50 cursor-not-allowed"
              )}
            >
              {isSending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function escapeMarkdownHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isSafeMarkdownUrl(url: string) {
  return /^(https?:\/\/|mailto:|tel:|#|\/(?!\/))/i.test(url.trim())
}

function renderInlineMarkdown(text: string, isDark: boolean) {
  const codeClass = isDark
    ? 'bg-gray-600 text-gray-50'
    : 'bg-gray-200 text-gray-950'
  const codeBlocks: string[] = []
  let html = escapeMarkdownHtml(text).replace(/`([^`]+)`/g, (_, code) => {
    const index = codeBlocks.length
    codeBlocks.push(`<code class="px-1.5 py-0.5 rounded text-xs font-mono ${codeClass}">${code}</code>`)
    return `\u0001INLINE_CODE_${index}\u0001`
  })

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    if (!isSafeMarkdownUrl(url)) return label
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-indigo-500 underline underline-offset-2">${label}</a>`
  })
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')

  return html.replace(/\u0001INLINE_CODE_(\d+)\u0001/g, (_, index) => codeBlocks[Number(index)] ?? '')
}

function isMarkdownTableSeparator(line: string) {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))
}

function isMarkdownTableStart(lines: string[], index: number) {
  return index + 1 < lines.length &&
    lines[index].includes('|') &&
    isMarkdownTableSeparator(lines[index + 1])
}

function normalizeMarkdownBlocks(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\s*\|\|\s*/g, '\n|')
    .replace(/([^\n])(-{3,})(?=#{1,6}\s*)/g, '$1\n\n$2\n\n')
    .replace(/(^|\n)\s*(-{3,})\s*(?=#{1,6}\s*)/g, '$1$2\n\n')
    .replace(/([^\n])((?:#{2,6})\s+)/g, '$1\n\n$2')
    .replace(/([。！？；;:：])\s+((?:[-*+])\s+)/g, '$1\n$2')
    .replace(/([。！？；;:：])\s+(\d+[.)]\s+)/g, '$1\n$2')
    .replace(/\n{3,}/g, '\n\n')
}

function splitMarkdownTableRow(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function renderMarkdownTable(lines: string[], isDark: boolean) {
  const borderClass = isDark ? 'border-gray-500' : 'border-gray-300'
  const headerClass = isDark ? 'bg-slate-600' : 'bg-gray-200'
  const rows = lines.map(splitMarkdownTableRow)
  const header = rows[0] ?? []
  const body = rows.slice(2)

  const headerCells = header
    .map((cell) => `<th class="border ${borderClass} ${headerClass} px-2 py-1.5 text-left font-semibold">${renderInlineMarkdown(cell, isDark)}</th>`)
    .join('')
  const bodyRows = body
    .map((row) => `<tr>${header.map((_, index) => `<td class="border ${borderClass} px-2 py-1.5 align-top">${renderInlineMarkdown(row[index] ?? '', isDark)}</td>`).join('')}</tr>`)
    .join('')

  return `<div class="my-2.5 overflow-x-auto"><table class="w-full min-w-[360px] border-collapse text-[13px] leading-snug"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`
}

function renderMarkdownList(lines: string[], tagName: 'ul' | 'ol', isDark: boolean) {
  const listClass = tagName === 'ol' ? 'list-decimal' : 'list-disc'
  const items = lines
    .map((line) => {
      const content = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      return `<li class="mb-1 pl-0.5">${renderInlineMarkdown(content, isDark)}</li>`
    })
    .join('')

  return `<${tagName} class="my-2 ml-5 ${listClass} p-0">${items}</${tagName}>`
}

function isMarkdownBlockStart(lines: string[], index: number) {
  const line = lines[index]
  return !line.trim() ||
    /^@@ODW_CODE_BLOCK_\d+@@$/.test(line.trim()) ||
    /^-{3,}$/.test(line.trim()) ||
    /^(#{1,4})\s+/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    isMarkdownTableStart(lines, index)
}

function renderMarkdown(content: string, isDark: boolean) {
  const fencedCodeBlocks: string[] = []
  const normalizedContent = normalizeMarkdownBlocks(content)
    .replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const index = fencedCodeBlocks.length
      const language = lang?.trim()
      const languageLabel = language
        ? `<div class="mb-1.5 text-xs text-slate-400">${escapeMarkdownHtml(language)}</div>`
        : ''
      fencedCodeBlocks.push(
        `<pre class="my-2.5 overflow-x-auto whitespace-pre rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"><code>${languageLabel}${escapeMarkdownHtml(code.replace(/\n$/, ''))}</code></pre>`
      )
      return `\n\n@@ODW_CODE_BLOCK_${index}@@\n\n`
    })

  const lines = normalizedContent.split('\n')
  const output: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) continue

    const codeMatch = trimmed.match(/^@@ODW_CODE_BLOCK_(\d+)@@$/)
    if (codeMatch) {
      output.push(fencedCodeBlocks[Number(codeMatch[1])] ?? '')
      continue
    }

    if (/^-{3,}$/.test(trimmed)) {
      output.push(`<hr class="my-3 border-0 border-t ${isDark ? 'border-gray-500' : 'border-gray-300'}" />`)
      continue
    }

    if (isMarkdownTableStart(lines, i)) {
      const tableLines = [lines[i], lines[i + 1]]
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        tableLines.push(lines[i])
        i++
      }
      i--
      output.push(renderMarkdownTable(tableLines, isDark))
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s*(.+)$/)
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 4)
      const sizeClass = level === 1 ? 'text-lg' : level === 2 ? 'text-base' : 'text-[15px]'
      output.push(`<h${level} class="mb-2 mt-3 ${sizeClass} font-bold leading-snug">${renderInlineMarkdown(headingMatch[2], isDark)}</h${level}>`)
      continue
    }

    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const listLines = [line]
      while (i + 1 < lines.length && (ordered ? /^\s*\d+[.)]\s+/.test(lines[i + 1]) : /^\s*[-*+]\s+/.test(lines[i + 1]))) {
        listLines.push(lines[++i])
      }
      output.push(renderMarkdownList(listLines, ordered ? 'ol' : 'ul', isDark))
      continue
    }

    const paragraph = [line]
    while (i + 1 < lines.length && !isMarkdownBlockStart(lines, i + 1)) {
      paragraph.push(lines[++i])
    }
    output.push(`<p class="mb-2.5 last:mb-0">${paragraph.map((part) => renderInlineMarkdown(part, isDark)).join('<br>')}</p>`)
  }

  return output.join('')
}

/**
 * 消息内容组件 - Markdown渲染
 */
function MessageContent({ content, isDark }: { content: string; isDark: boolean }) {
  const processedContent = React.useMemo(() => renderMarkdown(content, isDark), [content, isDark])

  if (!content) return null

  return (
    <div
      className="max-w-none"
      dangerouslySetInnerHTML={{ __html: processedContent }}
    />
  )
}
