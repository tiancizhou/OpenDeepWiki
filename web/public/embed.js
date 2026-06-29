/**
 * OpenDeepWiki 嵌入脚本
 * 
 * 用于将对话助手悬浮球嵌入到外部网站
 * 
 * 使用方式:
 * <script 
 *   src="https://your-domain.com/embed.js"
 *   data-app-id="app_xxxxx"
 *   data-icon="https://example.com/icon.png"
 * ></script>
 * 
 * Requirements: 14.2, 14.3, 14.4, 14.7
 */
(function() {
  'use strict';

  // 获取当前脚本元素
  var script = document.currentScript;
  if (!script) {
    console.error('[OpenDeepWiki] 无法获取脚本元素');
    return;
  }

  // 读取配置属性
  var appId = script.getAttribute('data-app-id');
  var iconUrl = script.getAttribute('data-icon');
  var position = script.getAttribute('data-position') || 'bottom-right';
  var theme = script.getAttribute('data-theme') || 'light';

  // 验证必需参数
  if (!appId) {
    console.error('[OpenDeepWiki] data-app-id 是必需的');
    return;
  }

  // API基础URL - 从脚本src中提取
  var scriptSrc = script.src;
  var apiBaseUrl = scriptSrc.substring(0, scriptSrc.lastIndexOf('/'));
  // 移除 /embed.js 或类似路径，获取根URL
  apiBaseUrl = apiBaseUrl.replace(/\/public$/, '').replace(/\/$/, '');

  // 配置对象
  var config = {
    appId: appId,
    iconUrl: iconUrl,
    position: position,
    theme: theme,
    apiBaseUrl: apiBaseUrl
  };

  // 状态
  var state = {
    isOpen: false,
    isLoading: true,
    isEnabled: false,
    isResizing: false,
    startX: 0,
    startWidth: 400,
    appConfig: null,
    messages: []
  };

  // 样式定义
  var styles = {
    container: [
      'position: fixed',
      'z-index: 999999',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    ].join(';'),
    backdrop: [
      'position: fixed',
      'top: 0',
      'left: 0',
      'right: 0',
      'bottom: 0',
      'background: rgba(0, 0, 0, 0.2)',
      'transition: opacity 0.3s ease',
      'z-index: 999998'
    ].join(';'),
    floatingBall: [
      'position: fixed',
      'width: 72px',
      'height: 72px',
      'border-radius: 50%',
      'background: linear-gradient(145deg, #20d3a2 0%, #2563eb 62%, #7c3aed 100%)',
      'border: none',
      'cursor: pointer',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'box-shadow: 0 16px 34px rgba(37, 99, 235, 0.34), 0 4px 12px rgba(15, 23, 42, 0.18)',
      'transition: transform 0.2s ease, box-shadow 0.2s ease',
      'outline: none',
      'overflow: visible',
      'right: 24px',
      'bottom: 24px',
      'z-index: 999999'
    ].join(';'),
    floatingBallHover: 'transform: translateY(-3px) scale(1.06); box-shadow: 0 20px 42px rgba(37, 99, 235, 0.42), 0 8px 18px rgba(15, 23, 42, 0.22);',
    panel: [
      'position: fixed',
      'top: 0',
      'right: 0',
      'width: 400px',
      'height: 100%',
      'max-width: 100vw',
      'background: #ffffff',
      'box-shadow: -4px 0 24px rgba(0, 0, 0, 0.15)',
      'display: flex',
      'flex-direction: column',
      'overflow: hidden',
      'transition: transform 0.3s ease',
      'z-index: 999999'
    ].join(';'),
    panelDark: 'background: #1a1a2e; color: #ffffff;',
    header: [
      'display: flex',
      'align-items: center',
      'justify-content: space-between',
      'padding: 16px',
      'border-bottom: 1px solid #e5e7eb',
      'background: #f9fafb'
    ].join(';'),
    headerDark: 'background: #16213e; border-bottom-color: #374151;',
    messagesContainer: [
      'flex: 1',
      'overflow-y: auto',
      'overflow-x: hidden',
      'padding: 16px',
      'display: flex',
      'flex-direction: column',
      'gap: 12px',
      'min-height: 0',
      'scrollbar-width: thin',
      'scrollbar-color: #d1d5db transparent'
    ].join(';'),
    inputContainer: [
      'padding: 16px',
      'border-top: 1px solid #e5e7eb',
      'display: flex',
      'gap: 8px',
      'align-items: flex-end'
    ].join(';'),
    inputContainerDark: 'border-top-color: #374151;',
    textarea: [
      'flex: 1',
      'min-height: 40px',
      'max-height: 120px',
      'padding: 10px 12px',
      'border: 1px solid #d1d5db',
      'border-radius: 8px',
      'resize: none',
      'font-size: 14px',
      'line-height: 1.5',
      'outline: none',
      'transition: border-color 0.2s ease'
    ].join(';'),
    textareaDark: 'background: #1e293b; border-color: #475569; color: #ffffff;',
    sendButton: [
      'width: 40px',
      'height: 40px',
      'border-radius: 8px',
      'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'border: none',
      'cursor: pointer',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'transition: opacity 0.2s ease'
    ].join(';'),
    userMessage: [
      'align-self: flex-end',
      'max-width: 80%',
      'padding: 10px 14px',
      'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'color: #ffffff',
      'border-radius: 16px 16px 4px 16px',
      'font-size: 14px',
      'line-height: 1.5',
      'word-wrap: break-word'
    ].join(';'),
    assistantMessage: [
      'align-self: flex-start',
      'max-width: min(92%, 960px)',
      'padding: 10px 14px',
      'background: #f3f4f6',
      'color: #1f2937',
      'border-radius: 16px 16px 16px 4px',
      'font-size: 14px',
      'line-height: 1.5',
      'word-wrap: break-word'
    ].join(';'),
    assistantMessageDark: 'background: #374151; color: #f3f4f6;',
    welcomeMessage: [
      'text-align: center',
      'color: #6b7280',
      'padding: 40px 20px'
    ].join(';'),
    errorMessage: [
      'padding: 12px 16px',
      'background: #fef2f2',
      'color: #dc2626',
      'border-radius: 8px',
      'font-size: 14px',
      'margin: 8px 16px'
    ].join(';'),
    loadingDots: [
      'display: inline-flex',
      'gap: 4px'
    ].join(';'),
    loadingDot: [
      'width: 8px',
      'height: 8px',
      'background: #9ca3af',
      'border-radius: 50%',
      'animation: odw-bounce 1.4s infinite ease-in-out both'
    ].join(';'),
  };

  // 图标SVG
  var icons = {
    assistant: [
      '<span class="odw-assistant-avatar" aria-hidden="true">',
      '<svg width="62" height="62" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">',
      '<circle cx="40" cy="40" r="38" fill="rgba(255,255,255,0.18)"/>',
      '<path d="M23 38c0-10.5 7.5-18 17-18s17 7.5 17 18v10c0 8.5-7 15-17 15s-17-6.5-17-15V38z" fill="white"/>',
      '<path d="M27 35c1.5-8 6.5-12 13-12s11.5 4 13 12c-4.2-3-8.4-4.4-13-4.4S31.2 32 27 35z" fill="#dbeafe"/>',
      '<rect x="29" y="37" width="22" height="13" rx="6.5" fill="#eef6ff"/>',
      '<circle cx="35" cy="43" r="2.4" fill="#1d4ed8"/>',
      '<circle cx="45" cy="43" r="2.4" fill="#1d4ed8"/>',
      '<path d="M36 50c2.4 2 5.6 2 8 0" stroke="#0f766e" stroke-width="2.4" stroke-linecap="round"/>',
      '<path d="M22 41h-3.5A4.5 4.5 0 0 1 14 36.5v-2A4.5 4.5 0 0 1 18.5 30H22" stroke="white" stroke-width="5" stroke-linecap="round"/>',
      '<path d="M58 41h3.5A4.5 4.5 0 0 0 66 36.5v-2A4.5 4.5 0 0 0 61.5 30H58" stroke="white" stroke-width="5" stroke-linecap="round"/>',
      '<path d="M55 50c6 0 9 3 9 7s-3 7-9 7" stroke="white" stroke-width="4" stroke-linecap="round"/>',
      '<path d="M58 63l4 4 8-9" stroke="#34d399" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
      '<circle cx="58" cy="21" r="8" fill="#fbbf24"/>',
      '<path d="M55 21h6M58 18v6" stroke="white" stroke-width="2.2" stroke-linecap="round"/>',
      '</svg>',
      '</span>'
    ].join(''),
    close: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    send: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>'
  };

  // 注入CSS动画
  function injectStyles() {
    var styleEl = document.createElement('style');
    styleEl.textContent = [
      '@keyframes odw-bounce {',
      '  0%, 80%, 100% { transform: scale(0); }',
      '  40% { transform: scale(1); }',
      '}',
      '@keyframes odw-assistant-pulse {',
      '  0% { transform: scale(0.86); opacity: 0.45; }',
      '  70% { transform: scale(1.28); opacity: 0; }',
      '  100% { transform: scale(1.28); opacity: 0; }',
      '}',
      '@keyframes odw-assistant-float {',
      '  0%, 100% { transform: translateY(0); }',
      '  50% { transform: translateY(-2px); }',
      '}',
      '#odw-floating-ball:not([data-open="true"])::before {',
      '  content: "";',
      '  position: absolute;',
      '  inset: -7px;',
      '  border-radius: 999px;',
      '  border: 2px solid rgba(37, 99, 235, 0.28);',
      '  animation: odw-assistant-pulse 2.2s ease-out infinite;',
      '}',
      '#odw-floating-ball:not([data-open="true"]) .odw-assistant-avatar {',
      '  display: inline-flex;',
      '  animation: odw-assistant-float 2.8s ease-in-out infinite;',
      '}',
      '.odw-dot-1 { animation-delay: -0.32s; }',
      '.odw-dot-2 { animation-delay: -0.16s; }',
      '.odw-dot-3 { animation-delay: 0s; }',
      '#odw-messages::-webkit-scrollbar { width: 6px; }',
      '#odw-messages::-webkit-scrollbar-track { background: transparent; }',
      '#odw-messages::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }',
      '#odw-messages::-webkit-scrollbar-thumb:hover { background: #9ca3af; }',
      '@media (max-width: 480px) {',
      '  #odw-panel { width: 100% !important; }',
      '}'
    ].join('\n');
    document.head.appendChild(styleEl);
  }


  // 生成唯一ID
  function generateId() {
    return 'odw-' + Math.random().toString(36).substr(2, 9);
  }

  // 创建DOM元素
  function createElement(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function(key) {
        if (key === 'style') {
          el.style.cssText = attrs[key];
        } else if (key === 'className') {
          el.className = attrs[key];
        } else if (key.startsWith('on')) {
          el.addEventListener(key.substring(2).toLowerCase(), attrs[key]);
        } else {
          el.setAttribute(key, attrs[key]);
        }
      });
    }
    if (children) {
      if (typeof children === 'string') {
        el.innerHTML = children;
      } else if (Array.isArray(children)) {
        children.forEach(function(child) {
          if (child) el.appendChild(child);
        });
      } else {
        el.appendChild(children);
      }
    }
    return el;
  }

  // 验证配置并获取应用信息
  function validateAndGetConfig(callback) {
    var url = config.apiBaseUrl + '/api/v1/embed/config?appId=' + encodeURIComponent(config.appId);
    
    fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    })
    .then(function(response) {
      return response.json();
    })
    .then(function(data) {
      if (data.valid) {
        state.isEnabled = true;
        state.appConfig = data;
        callback(null, data);
      } else {
        console.error('[OpenDeepWiki] 配置验证失败:', data.errorMessage);
        callback(new Error(data.errorMessage || '配置验证失败'));
      }
    })
    .catch(function(error) {
      console.error('[OpenDeepWiki] 获取配置失败:', error);
      callback(error);
    });
  }

  // SSE流式对话
  function streamChat(messages, onContent, onDone, onError) {
    var url = config.apiBaseUrl + '/api/v1/embed/stream';
    
    var requestBody = {
      appId: config.appId,
      messages: messages.map(function(msg) {
        return {
          role: msg.role,
          content: msg.content
        };
      })
    };

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('请求失败: ' + response.status);
      }
      
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      function processStream() {
        reader.read().then(function(result) {
          if (result.done) {
            onDone();
            return;
          }

          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop() || '';

          lines.forEach(function(line) {
            line = line.trim();
            if (!line) return;

            // 解析SSE事件
            if (line.startsWith('event: ')) {
              // 事件类型行，暂存
              return;
            }
            
            if (line.startsWith('data: ')) {
              var dataStr = line.substring(6);
              try {
                var event = JSON.parse(dataStr);
                if (event.type === 'content') {
                  onContent(event.data);
                } else if (event.type === 'done') {
                  // 完成事件会在流结束时处理
                } else if (event.type === 'error') {
                  onError(new Error(event.data.message || '对话失败'));
                }
              } catch (e) {
                // 可能是纯文本内容
                onContent(dataStr);
              }
            }
          });

          processStream();
        }).catch(function(error) {
          onError(error);
        });
      }

      processStream();
    })
    .catch(function(error) {
      onError(error);
    });
  }

  // 渲染悬浮球
  function renderFloatingBall(container) {
    var ballStyle = styles.floatingBall;

    var iconContent;
    if (config.iconUrl) {
      iconContent = '<img src="' + config.iconUrl + '" alt="Chat" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover;">';
    } else {
      iconContent = icons.assistant;
    }

    var ball = createElement('button', {
      id: 'odw-floating-ball',
      style: ballStyle,
      'aria-label': '打开对话助手',
      onClick: function() {
        togglePanel();
      },
      onMouseenter: function() {
        this.style.cssText = ballStyle + ';' + styles.floatingBallHover;
      },
      onMouseleave: function() {
        this.style.cssText = ballStyle;
      }
    }, iconContent);

    ball.setAttribute('data-open', 'false');
    container.appendChild(ball);
    return ball;
  }

  // 渲染背景遮罩
  function renderBackdrop(container) {
    var backdrop = createElement('div', {
      id: 'odw-backdrop',
      style: styles.backdrop + '; opacity: 0; pointer-events: none;',
      onClick: function() {
        togglePanel();
      }
    });
    container.appendChild(backdrop);
    return backdrop;
  }

  // 渲染对话面板
  function renderPanel(container) {
    var isDark = config.theme === 'dark';
    var panelStyle = styles.panel;
    if (isDark) {
      panelStyle += ';' + styles.panelDark;
    }
    // 初始状态：隐藏在右侧
    panelStyle += '; transform: translateX(100%);';

    var panel = createElement('div', {
      id: 'odw-panel',
      style: panelStyle
    });

    // 拖动调整宽度的手柄
    var resizeHandle = createElement('div', {
      id: 'odw-resize-handle',
      style: [
        'position: absolute',
        'left: 0',
        'top: 0',
        'width: 6px',
        'height: 100%',
        'cursor: ew-resize',
        'background: transparent',
        'transition: background 0.2s ease',
        'z-index: 10'
      ].join(';'),
      onMouseenter: function() {
        this.style.background = 'rgba(102, 126, 234, 0.3)';
      },
      onMouseleave: function() {
        if (!state.isResizing) {
          this.style.background = 'transparent';
        }
      },
      onMousedown: function(e) {
        e.preventDefault();
        state.isResizing = true;
        state.startX = e.clientX;
        state.startWidth = panel.offsetWidth;
        this.style.background = 'rgba(102, 126, 234, 0.5)';

        document.addEventListener('mousemove', handleResize);
        document.addEventListener('mouseup', stopResize);
      }
    });

    function handleResize(e) {
      if (!state.isResizing) return;
      var diff = state.startX - e.clientX;
      var newWidth = Math.min(Math.max(state.startWidth + diff, 320), window.innerWidth * 0.8);
      panel.style.width = newWidth + 'px';
    }

    function stopResize() {
      state.isResizing = false;
      var handle = document.getElementById('odw-resize-handle');
      if (handle) {
        handle.style.background = 'transparent';
      }
      document.removeEventListener('mousemove', handleResize);
      document.removeEventListener('mouseup', stopResize);
    }

    panel.appendChild(resizeHandle);

    // 头部
    var headerStyle = styles.header;
    if (isDark) headerStyle += styles.headerDark;
    
    var header = createElement('div', { style: headerStyle }, [
      createElement('div', { style: 'display: flex; align-items: center; gap: 12px;' }, [
        createElement('span', { style: 'font-weight: 600; font-size: 16px;' }, state.appConfig ? state.appConfig.appName || '对话助手' : '对话助手')
      ]),
      createElement('button', {
        style: 'background: none; border: none; cursor: pointer; padding: 4px; color: inherit;',
        onClick: function() { togglePanel(); }
      }, icons.close)
    ]);
    panel.appendChild(header);

    // 消息容器
    var messagesContainer = createElement('div', {
      id: 'odw-messages',
      style: styles.messagesContainer
    });
    
    // 欢迎消息
    messagesContainer.appendChild(createElement('div', {
      style: styles.welcomeMessage
    }, [
      createElement('div', { style: 'font-size: 24px; margin-bottom: 8px;' }, '👋'),
      createElement('div', { style: 'font-weight: 500; margin-bottom: 4px;' }, '你好！'),
      createElement('div', { style: 'font-size: 14px;' }, '有什么可以帮助你的吗？')
    ]));
    
    panel.appendChild(messagesContainer);

    // 输入区域
    var inputStyle = styles.inputContainer;
    if (isDark) inputStyle += styles.inputContainerDark;
    
    var textareaStyle = styles.textarea;
    if (isDark) textareaStyle += styles.textareaDark;

    var textarea = createElement('textarea', {
      id: 'odw-input',
      style: textareaStyle,
      placeholder: '输入消息...',
      rows: '1',
      onKeydown: function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      },
      onInput: function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      }
    });

    var sendBtn = createElement('button', {
      id: 'odw-send-btn',
      style: styles.sendButton,
      onClick: function() { sendMessage(); }
    }, '<span style="color: white;">' + icons.send + '</span>');

    var inputContainer = createElement('div', { style: inputStyle }, [textarea, sendBtn]);
    panel.appendChild(inputContainer);

    container.appendChild(panel);
    return panel;
  }

  // 切换面板显示
  function togglePanel() {
    state.isOpen = !state.isOpen;
    var panel = document.getElementById('odw-panel');
    var ball = document.getElementById('odw-floating-ball');
    var backdrop = document.getElementById('odw-backdrop');

    if (panel) {
      if (state.isOpen) {
        // 展开：从右侧滑入
        panel.style.transform = 'translateX(0)';
        // 聚焦输入框
        setTimeout(function() {
          var input = document.getElementById('odw-input');
          if (input) input.focus();
        }, 300);
      } else {
        // 收起：滑出到右侧
        panel.style.transform = 'translateX(100%)';
      }
    }

    if (backdrop) {
      if (state.isOpen) {
        backdrop.style.opacity = '1';
        backdrop.style.pointerEvents = 'auto';
      } else {
        backdrop.style.opacity = '0';
        backdrop.style.pointerEvents = 'none';
      }
    }

    if (ball) {
      ball.innerHTML = state.isOpen
        ? '<span style="color: white;">' + icons.close + '</span>'
        : (config.iconUrl
            ? '<img src="' + config.iconUrl + '" alt="Chat" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover;">'
            : icons.assistant);
      ball.setAttribute('data-open', state.isOpen ? 'true' : 'false');
      ball.setAttribute('aria-label', state.isOpen ? '关闭对话助手' : '打开对话助手');
    }
  }

  // 添加消息到UI
  function addMessageToUI(role, content) {
    var messagesContainer = document.getElementById('odw-messages');
    if (!messagesContainer) return;

    // 移除欢迎消息
    var welcomeMsg = messagesContainer.querySelector('[style*="text-align: center"]');
    if (welcomeMsg) {
      welcomeMsg.remove();
    }

    var isDark = config.theme === 'dark';
    var messageStyle = role === 'user' ? styles.userMessage : styles.assistantMessage;
    if (role === 'assistant' && isDark) {
      messageStyle += styles.assistantMessageDark;
    }

    var messageEl = createElement('div', {
      style: messageStyle,
      'data-role': role
    }, escapeHtml(content));

    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    return messageEl;
  }

  // 更新最后一条助手消息
  function updateLastAssistantMessage(content) {
    var messagesContainer = document.getElementById('odw-messages');
    if (!messagesContainer) return;

    var messages = messagesContainer.querySelectorAll('[data-role="assistant"]');
    var lastMessage = messages[messages.length - 1];
    
    if (lastMessage) {
      lastMessage.innerHTML = formatMarkdown(content);
    }
  }

  // 显示加载指示器
  function showLoading() {
    var messagesContainer = document.getElementById('odw-messages');
    if (!messagesContainer) return;

    var isDark = config.theme === 'dark';
    var messageStyle = styles.assistantMessage;
    if (isDark) messageStyle += styles.assistantMessageDark;

    var loadingEl = createElement('div', {
      id: 'odw-loading',
      style: messageStyle
    }, [
      createElement('div', { style: styles.loadingDots }, [
        createElement('span', { style: styles.loadingDot, className: 'odw-dot-1' }),
        createElement('span', { style: styles.loadingDot, className: 'odw-dot-2' }),
        createElement('span', { style: styles.loadingDot, className: 'odw-dot-3' })
      ])
    ]);

    messagesContainer.appendChild(loadingEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // 隐藏加载指示器
  function hideLoading() {
    var loadingEl = document.getElementById('odw-loading');
    if (loadingEl) {
      loadingEl.remove();
    }
  }

  // 显示错误消息
  function showError(message) {
    var messagesContainer = document.getElementById('odw-messages');
    if (!messagesContainer) return;

    var errorEl = createElement('div', {
      style: styles.errorMessage
    }, escapeHtml(message));

    messagesContainer.appendChild(errorEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // 3秒后自动移除
    setTimeout(function() {
      errorEl.remove();
    }, 5000);
  }

  // 发送消息
  function sendMessage() {
    var input = document.getElementById('odw-input');
    var sendBtn = document.getElementById('odw-send-btn');
    if (!input || !sendBtn) return;

    var content = input.value.trim();
    if (!content) return;

    // 禁用输入
    input.disabled = true;
    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.5';

    // 添加用户消息
    state.messages.push({ role: 'user', content: content });
    addMessageToUI('user', content);

    // 清空输入框
    input.value = '';
    input.style.height = 'auto';

    // 显示加载
    showLoading();

    // 准备助手消息
    var assistantContent = '';
    addMessageToUI('assistant', '');

    // 发送请求
    streamChat(
      state.messages,
      function(chunk) {
        // 内容回调
        hideLoading();
        assistantContent += chunk;
        updateLastAssistantMessage(assistantContent);
      },
      function() {
        // 完成回调
        hideLoading();
        state.messages.push({ role: 'assistant', content: assistantContent });
        
        // 恢复输入
        input.disabled = false;
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
        input.focus();
      },
      function(error) {
        // 错误回调
        hideLoading();
        showError(error.message || '发送失败，请重试');
        
        // 移除空的助手消息
        var messagesContainer = document.getElementById('odw-messages');
        var messages = messagesContainer.querySelectorAll('[data-role="assistant"]');
        var lastMessage = messages[messages.length - 1];
        if (lastMessage && !lastMessage.textContent.trim()) {
          lastMessage.remove();
        }
        
        // 恢复输入
        input.disabled = false;
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
        input.focus();
      }
    );
  }

  // HTML转义
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function isSafeMarkdownUrl(url) {
    return /^(https?:\/\/|mailto:|tel:|#|\/(?!\/))/i.test(url.trim());
  }

  function renderInlineMarkdown(text, isDark) {
    var codeStyle = [
      'background: ' + (isDark ? '#4b5563' : '#e5e7eb'),
      'color: ' + (isDark ? '#f9fafb' : '#111827'),
      'padding: 2px 6px',
      'border-radius: 4px',
      'font-size: 13px',
      'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    ].join(';');
    var codes = [];
    var html = escapeHtml(text).replace(/`([^`]+)`/g, function(match, code) {
      var index = codes.length;
      codes.push('<code style="' + codeStyle + '">' + code + '</code>');
      return '\u0001INLINE_CODE_' + index + '\u0001';
    });

    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function(match, label, url) {
      if (!isSafeMarkdownUrl(url)) return label;
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" style="color: #4f46e5; text-decoration: underline; text-underline-offset: 2px;">' + label + '</a>';
    });
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    return html.replace(/\u0001INLINE_CODE_(\d+)\u0001/g, function(match, index) {
      return codes[Number(index)] || '';
    });
  }

  function isMarkdownTableSeparator(line) {
    var cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    return cells.length > 0 && cells.every(function(cell) {
      return /^\s*:?-{3,}:?\s*$/.test(cell);
    });
  }

  function isMarkdownTableStart(lines, index) {
    return index + 1 < lines.length &&
      lines[index].indexOf('|') !== -1 &&
      isMarkdownTableSeparator(lines[index + 1]);
  }

  function splitMarkdownTableRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function(cell) {
      return cell.trim();
    });
  }

  function renderMarkdownTable(lines, isDark) {
    var borderColor = isDark ? '#4b5563' : '#d1d5db';
    var headBg = isDark ? '#475569' : '#e5e7eb';
    var rows = lines.map(splitMarkdownTableRow);
    var header = rows[0] || [];
    var body = rows.slice(2);
    var table = [
      '<div style="overflow-x: auto; margin: 10px 0;">',
      '<table style="border-collapse: collapse; width: 100%; min-width: 360px; font-size: 13px; line-height: 1.45;">',
      '<thead><tr>'
    ];

    header.forEach(function(cell) {
      table.push('<th style="border: 1px solid ' + borderColor + '; background: ' + headBg + '; padding: 7px 9px; text-align: left; font-weight: 600;">' + renderInlineMarkdown(cell, isDark) + '</th>');
    });
    table.push('</tr></thead><tbody>');

    body.forEach(function(row) {
      table.push('<tr>');
      header.forEach(function(_, index) {
        table.push('<td style="border: 1px solid ' + borderColor + '; padding: 7px 9px; vertical-align: top;">' + renderInlineMarkdown(row[index] || '', isDark) + '</td>');
      });
      table.push('</tr>');
    });

    table.push('</tbody></table></div>');
    return table.join('');
  }

  function renderMarkdownList(lines, tagName, isDark) {
    var items = lines.map(function(line) {
      var content = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
      return '<li style="margin: 0 0 4px 0; padding-left: 2px;">' + renderInlineMarkdown(content, isDark) + '</li>';
    });
    return '<' + tagName + ' style="margin: 8px 0 10px 18px; padding: 0;">' + items.join('') + '</' + tagName + '>';
  }

  function isMarkdownBlockStart(lines, index) {
    var line = lines[index];
    return !line.trim() ||
      /^@@ODW_CODE_BLOCK_\d+@@$/.test(line.trim()) ||
      /^(#{1,4})\s+/.test(line) ||
      /^\s*[-*+]\s+/.test(line) ||
      /^\s*\d+[.)]\s+/.test(line) ||
      isMarkdownTableStart(lines, index);
  }

  // Markdown格式化
  function formatMarkdown(text) {
    if (!text) return '';

    var isDark = config.theme === 'dark';
    var codeBlocks = [];
    text = text.replace(/\r\n?/g, '\n').replace(/```([^\n`]*)\n?([\s\S]*?)```/g, function(match, lang, code) {
      var index = codeBlocks.length;
      var label = lang && lang.trim()
        ? '<div style="color: #94a3b8; font-size: 12px; margin-bottom: 6px;">' + escapeHtml(lang.trim()) + '</div>'
        : '';
      codeBlocks.push(
        '<pre style="background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 13px; line-height: 1.55; margin: 10px 0; white-space: pre;"><code>' +
        label +
        escapeHtml(code.replace(/\n$/, '')) +
        '</code></pre>'
      );
      return '\n\n@@ODW_CODE_BLOCK_' + index + '@@\n\n';
    });

    var lines = text.split('\n');
    var output = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      if (!trimmed) continue;

      var codeMatch = trimmed.match(/^@@ODW_CODE_BLOCK_(\d+)@@$/);
      if (codeMatch) {
        output.push(codeBlocks[Number(codeMatch[1])] || '');
        continue;
      }

      if (isMarkdownTableStart(lines, i)) {
        var tableLines = [lines[i], lines[i + 1]];
        i += 2;
        while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim()) {
          tableLines.push(lines[i]);
          i++;
        }
        i--;
        output.push(renderMarkdownTable(tableLines, isDark));
        continue;
      }

      var headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        var level = Math.min(headingMatch[1].length, 4);
        var fontSize = level === 1 ? '18px' : level === 2 ? '16px' : '15px';
        output.push('<h' + level + ' style="font-size: ' + fontSize + '; line-height: 1.35; font-weight: 700; margin: 12px 0 8px;">' + renderInlineMarkdown(headingMatch[2], isDark) + '</h' + level + '>');
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
        var ordered = /^\s*\d+[.)]\s+/.test(line);
        var listLines = [line];
        while (i + 1 < lines.length && (ordered ? /^\s*\d+[.)]\s+/.test(lines[i + 1]) : /^\s*[-*+]\s+/.test(lines[i + 1]))) {
          listLines.push(lines[++i]);
        }
        output.push(renderMarkdownList(listLines, ordered ? 'ol' : 'ul', isDark));
        continue;
      }

      var paragraph = [line];
      while (i + 1 < lines.length && !isMarkdownBlockStart(lines, i + 1)) {
        paragraph.push(lines[++i]);
      }
      output.push('<p style="margin: 0 0 10px;">' + paragraph.map(function(part) {
        return renderInlineMarkdown(part, isDark);
      }).join('<br>') + '</p>');
    }

    return output.join('');
  }

  // 初始化
  function init() {
    // 注入样式
    injectStyles();

    // 创建容器
    var container = createElement('div', {
      id: 'odw-container',
      style: styles.container
    });
    document.body.appendChild(container);

    // 验证配置
    state.isLoading = true;
    validateAndGetConfig(function(error, appConfig) {
      state.isLoading = false;

      if (error) {
        console.error('[OpenDeepWiki] 初始化失败:', error.message);
        return;
      }

      // 渲染UI - 先渲染背景遮罩，再渲染面板，最后渲染悬浮球
      renderBackdrop(container);
      renderPanel(container);
      renderFloatingBall(container);

      console.log('[OpenDeepWiki] 初始化成功');
    });
  }

  // 等待DOM加载完成
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 暴露API供外部调用
  window.OpenDeepWiki = {
    open: function() {
      if (!state.isOpen) togglePanel();
    },
    close: function() {
      if (state.isOpen) togglePanel();
    },
    toggle: function() {
      togglePanel();
    },
    sendMessage: function(content) {
      var input = document.getElementById('odw-input');
      if (input) {
        input.value = content;
        sendMessage();
      }
    }
  };

})();
