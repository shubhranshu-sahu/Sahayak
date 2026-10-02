/**
 * Sahayak — AI Assistant Co-Pilot Page Logic (chat.js)
 * Implements chat UI, LangGraph persistent history, SSE real-time token streaming,
 * markdown parsing, health verification, and secretary-only authentication.
 */

document.addEventListener('DOMContentLoaded', async () => {
    // ════════════════════════════════════════════════════════
    // 1. Guard Check: Secretary Authentication
    // ════════════════════════════════════════════════════════
    const user = await Router.requireAuth();
    if (!user) return;

    const chatSkeleton = document.getElementById('chat-skeleton');
    const residentCard = document.getElementById('resident-restricted-card');
    const chatWorkspace = document.getElementById('chat-workspace-main');

    // If resident accesses page, display restricted access notice
    if (user.role !== 'secretary') {
        if (chatSkeleton) chatSkeleton.style.display = 'none';
        if (residentCard) residentCard.style.display = 'block';
        if (window.lucide) lucide.createIcons();
        return;
    }

    // ════════════════════════════════════════════════════════
    // 2. Initialize Shared Shell Components
    // ════════════════════════════════════════════════════════
    Components.initSidebar('chat');
    Components.initTopbar({
        title: 'Sahayak AI Assistant',
        subtitle: 'Intelligent secretary co-pilot powered by Gemini & LangGraph',
        actionBtn: {
            text: 'Dashboard',
            icon: 'layout-dashboard',
            href: 'dashboard.html'
        }
    });

    // ════════════════════════════════════════════════════════
    // 3. State Management
    // ════════════════════════════════════════════════════════
    const secretaryName = user.name || 'Secretary';
    const societyName = (user.society && user.society.name) || user.societyName || 'Your Society';

    let isStreaming = false;
    let currentAbortController = null;
    let isAiServiceOnline = false;
    let messagesCount = 0;

    // ════════════════════════════════════════════════════════
    // 4. DOM Elements
    // ════════════════════════════════════════════════════════
    const statusPill = document.getElementById('ai-status-pill');
    const statusText = document.getElementById('ai-status-text');
    const modelTag = document.getElementById('ai-model-name');
    const societyLabel = document.getElementById('chat-society-name');
    const offlineBanner = document.getElementById('ai-offline-banner');
    const btnRetryConnection = document.getElementById('btn-retry-connection');
    const btnRefreshHistory = document.getElementById('btn-refresh-history');
    const iconRefreshHistory = document.getElementById('icon-refresh-history');
    const btnClearChat = document.getElementById('btn-clear-chat');

    const messagesList = document.getElementById('chat-messages-list');
    const welcomeState = document.getElementById('chat-welcome-state');
    const welcomeHeading = document.getElementById('welcome-secretary-heading');
    const btnScrollBottom = document.getElementById('btn-scroll-bottom');

    const chatForm = document.getElementById('chat-form');
    const promptInput = document.getElementById('chat-prompt-input');
    const btnSendChat = document.getElementById('btn-send-chat');
    const btnStopGeneration = document.getElementById('btn-stop-generation');

    // Clear Modal
    const clearModal = document.getElementById('clear-confirm-modal');
    const btnCloseClearModal = document.getElementById('btn-close-clear-modal');
    const btnCancelClear = document.getElementById('btn-cancel-clear');
    const btnConfirmClear = document.getElementById('btn-confirm-clear');

    // Configure Context Labels
    if (societyLabel) societyLabel.textContent = societyName;
    if (welcomeHeading) welcomeHeading.textContent = `Hello, ${secretaryName}! I'm your Sahayak AI Co-Pilot`;

    // ════════════════════════════════════════════════════════
    // 5. Initial Data Load & Service Health Check
    // ════════════════════════════════════════════════════════
    await checkServiceHealth();
    await loadHistory();

    // Reveal Workspace & Hide Skeleton
    if (chatSkeleton) chatSkeleton.style.display = 'none';
    if (chatWorkspace) chatWorkspace.style.display = 'flex';
    if (window.lucide) lucide.createIcons();

    // Focus input field or process incoming ?prompt= query param
    const urlParams = new URLSearchParams(window.location.search);
    const initialPrompt = urlParams.get('prompt');
    if (initialPrompt && promptInput) {
        promptInput.value = initialPrompt;
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
        btnSendChat.disabled = false;
        window.history.replaceState({}, document.title, window.location.pathname);
        if (isAiServiceOnline) {
            handleSendMessage();
        } else {
            promptInput.focus();
        }
    } else if (promptInput) {
        promptInput.focus();
    }

    // ════════════════════════════════════════════════════════
    // 6. Service Health Check Function
    // ════════════════════════════════════════════════════════
    async function checkServiceHealth() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3500);

            const res = await fetch(`${CONFIG.AI_BASE}/health`, {
                method: 'GET',
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                isAiServiceOnline = true;
                if (statusPill) {
                    statusPill.className = 'ai-status-pill online';
                }
                if (statusText) {
                    statusText.textContent = data.status === 'healthy' ? 'AI Core Ready' : 'AI Core Active';
                }
                if (modelTag && data.gemini && data.gemini.model) {
                    modelTag.textContent = data.gemini.model;
                }
                if (offlineBanner) offlineBanner.style.display = 'none';
            } else {
                setServiceOfflineState();
            }
        } catch (err) {
            console.warn('[Chat] AI Service health check failed:', err);
            setServiceOfflineState();
        }
    }

    function setServiceOfflineState() {
        isAiServiceOnline = false;
        if (statusPill) {
            statusPill.className = 'ai-status-pill offline';
        }
        if (statusText) {
            statusText.textContent = 'Service Offline';
        }
        if (offlineBanner) {
            offlineBanner.style.display = 'flex';
            if (window.lucide) lucide.createIcons({ nodes: [offlineBanner] });
        }
    }

    // ════════════════════════════════════════════════════════
    // 7. Load Conversation History from MongoDB
    // ════════════════════════════════════════════════════════
    async function loadHistory() {
        if (!isAiServiceOnline) return;

        try {
            const res = await Api.aiGet('/chat/history?limit=100');
            if (res && res.messages && Array.isArray(res.messages)) {
                // Clear existing message bubbles (except welcome state)
                const existingRows = messagesList.querySelectorAll('.message-row');
                existingRows.forEach(r => r.remove());

                if (res.messages.length > 0) {
                    if (welcomeState) welcomeState.style.display = 'none';
                    messagesCount = res.messages.length;

                    res.messages.forEach(msg => {
                        appendMessageToUI({
                            role: msg.role === 'assistant' ? 'assistant' : 'user',
                            content: msg.content,
                            timestamp: msg.timestamp || new Date(),
                            messageId: msg.message_id
                        });
                    });

                    scrollToBottom();
                } else {
                    if (welcomeState) welcomeState.style.display = 'block';
                }
            }
        } catch (err) {
            console.error('[Chat] Failed to load chat history:', err);
        }
    }

    // ════════════════════════════════════════════════════════
    // 8. Message Submission & SSE Streaming
    // ════════════════════════════════════════════════════════
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleSendMessage();
    });

    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // Auto-resize textarea
    promptInput.addEventListener('input', () => {
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
        btnSendChat.disabled = !promptInput.value.trim() || isStreaming;
    });

    // Suggestion Cards Click
    document.querySelectorAll('.suggestion-card').forEach(card => {
        card.addEventListener('click', () => {
            const prompt = card.dataset.prompt;
            if (prompt && !isStreaming) {
                promptInput.value = prompt;
                promptInput.style.height = 'auto';
                promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
                btnSendChat.disabled = false;
                handleSendMessage();
            }
        });
    });

    async function handleSendMessage() {
        const text = promptInput.value.trim();
        if (!text || isStreaming) return;

        // Reset input immediately
        promptInput.value = '';
        promptInput.style.height = 'auto';
        btnSendChat.disabled = true;

        // Hide welcome state
        if (welcomeState) welcomeState.style.display = 'none';

        // 1. Append User Message
        appendMessageToUI({
            role: 'user',
            content: text,
            timestamp: new Date()
        });
        messagesCount++;
        scrollToBottom();

        // 2. Prepare Assistant Streaming Bubble
        const assistantPlaceholder = createAssistantStreamingPlaceholder();
        messagesList.appendChild(assistantPlaceholder.row);
        scrollToBottom();

        // 3. Initiate SSE Streaming
        isStreaming = true;
        chatForm.classList.add('streaming');
        btnStopGeneration.style.display = 'inline-flex';
        currentAbortController = new AbortController();

        let accumulatedContent = '';

        try {
            await Api.aiStreamChat({
                message: text,
                society_name: societyName,
                secretary_name: secretaryName,
                signal: currentAbortController.signal,

                onStart: (startEvent) => {
                    // Start event received
                },

                onToken: (token) => {
                    accumulatedContent += token;
                    assistantPlaceholder.bubble.innerHTML = renderMarkdown(accumulatedContent) + '<span class="streaming-cursor"></span>';
                    scrollToBottom();
                },

                onDone: (doneEvent) => {
                    finalizeAssistantBubble(assistantPlaceholder, accumulatedContent, doneEvent.message_id);
                },

                onError: (err) => {
                    console.error('[Chat] Stream error:', err);
                    const errorMsg = accumulatedContent
                        ? accumulatedContent + `\n\n*(Stream interrupted: ${err.message})*`
                        : `I encountered an issue connecting to the AI core: ${err.message}. Please ensure the Python service is running on port 8001.`;
                    finalizeAssistantBubble(assistantPlaceholder, errorMsg);
                    Toast.error('AI response was interrupted.');
                }
            });
        } catch (err) {
            console.error('[Chat] Send message exception:', err);
            if (err.name !== 'AbortError') {
                finalizeAssistantBubble(assistantPlaceholder, `Error: ${err.message}`);
                Toast.error('Could not reach Sahayak AI service.');
            }
        } finally {
            isStreaming = false;
            chatForm.classList.remove('streaming');
            btnStopGeneration.style.display = 'none';
            btnSendChat.disabled = !promptInput.value.trim();
            currentAbortController = null;
            promptInput.focus();
        }
    }

    // ════════════════════════════════════════════════════════
    // 9. Stop Generation Handler
    // ════════════════════════════════════════════════════════
    btnStopGeneration.addEventListener('click', () => {
        if (currentAbortController && isStreaming) {
            currentAbortController.abort();
            Toast.info('Generation stopped');
        }
    });

    // ════════════════════════════════════════════════════════
    // 10. UI Helpers: Rendering & Formatting
    // ════════════════════════════════════════════════════════

    function appendMessageToUI({ role, content, timestamp, messageId }) {
        const row = document.createElement('div');
        row.className = `message-row ${role}`;
        if (messageId) row.dataset.messageId = messageId;

        const timeStr = formatMessageTime(timestamp);
        const userInitial = secretaryName.charAt(0).toUpperCase();

        if (role === 'user') {
            row.innerHTML = `
                <div class="message-avatar user-avatar" title="${escapeHtml(secretaryName)}">${userInitial}</div>
                <div class="message-content-wrapper">
                    <div class="message-sender-name">You</div>
                    <div class="message-bubble">${escapeHtml(content).replace(/\n/g, '<br>')}</div>
                    <div class="message-meta-bar">
                        <span>${timeStr}</span>
                    </div>
                </div>
            `;
        } else {
            const parsedHtml = renderMarkdown(content);
            row.innerHTML = `
                <div class="message-avatar ai-avatar" title="Sahayak AI">
                    <i data-lucide="bot" style="width: 18px; height: 18px;"></i>
                </div>
                <div class="message-content-wrapper">
                    <div class="message-sender-name">
                        <span>Sahayak AI</span>
                        <span class="model-tag" style="font-size: 9px; padding: 1px 6px;">AI</span>
                    </div>
                    <div class="message-bubble">${parsedHtml}</div>
                    <div class="message-meta-bar">
                        <span>${timeStr}</span>
                        <span>·</span>
                        <button type="button" class="btn-msg-copy" title="Copy response text">
                            <i data-lucide="copy" style="width: 12px; height: 12px;"></i>
                            <span>Copy</span>
                        </button>
                    </div>
                </div>
            `;

            // Attach copy action
            const copyBtn = row.querySelector('.btn-msg-copy');
            if (copyBtn) {
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(content).then(() => {
                        Toast.success('AI reply copied to clipboard!');
                    }).catch(() => {
                        Toast.info('Copied text');
                    });
                });
            }
        }

        messagesList.appendChild(row);
        if (window.lucide) lucide.createIcons({ nodes: [row] });
    }

    function createAssistantStreamingPlaceholder() {
        const row = document.createElement('div');
        row.className = 'message-row assistant';
        row.innerHTML = `
            <div class="message-avatar ai-avatar" title="Sahayak AI">
                <i data-lucide="bot" style="width: 18px; height: 18px;"></i>
            </div>
            <div class="message-content-wrapper">
                <div class="message-sender-name">
                    <span>Sahayak AI</span>
                    <span class="model-tag" style="font-size: 9px; padding: 1px 6px;">Thinking...</span>
                </div>
                <div class="message-bubble">
                    <span class="streaming-cursor"></span>
                </div>
                <div class="message-meta-bar">
                    <span>Just now</span>
                </div>
            </div>
        `;

        if (window.lucide) lucide.createIcons({ nodes: [row] });
        const bubble = row.querySelector('.message-bubble');
        const metaBar = row.querySelector('.message-meta-bar');
        return { row, bubble, metaBar };
    }

    function finalizeAssistantBubble(placeholder, fullContent, messageId) {
        if (!placeholder || !placeholder.bubble) return;

        // Render full sanitized markdown
        placeholder.bubble.innerHTML = renderMarkdown(fullContent);

        // Update tag
        const senderTag = placeholder.row.querySelector('.model-tag');
        if (senderTag) senderTag.textContent = 'AI';

        // Update meta bar with copy button
        if (placeholder.metaBar) {
            placeholder.metaBar.innerHTML = `
                <span>${formatMessageTime(new Date())}</span>
                <span>·</span>
                <button type="button" class="btn-msg-copy" title="Copy response text">
                    <i data-lucide="copy" style="width: 12px; height: 12px;"></i>
                    <span>Copy</span>
                </button>
            `;

            const copyBtn = placeholder.metaBar.querySelector('.btn-msg-copy');
            if (copyBtn) {
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(fullContent).then(() => {
                        Toast.success('AI reply copied to clipboard!');
                    });
                });
            }
            if (window.lucide) lucide.createIcons({ nodes: [placeholder.metaBar] });
        }

        scrollToBottom();
    }

    function renderMarkdown(rawText) {
        if (!rawText) return '';
        try {
            if (window.marked) {
                const rawHtml = marked.parse(rawText, { gfm: true, breaks: true });
                return window.DOMPurify ? DOMPurify.sanitize(rawHtml) : rawHtml;
            }
        } catch (e) {
            console.warn('[Chat] Markdown parsing failed:', e);
        }
        // Fallback plain text with basic formatting
        return escapeHtml(rawText).replace(/\n/g, '<br>');
    }

    function formatMessageTime(dateInput) {
        try {
            const d = new Date(dateInput);
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return 'Recently';
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function scrollToBottom() {
        messagesList.scrollTop = messagesList.scrollHeight;
    }

    // ════════════════════════════════════════════════════════
    // 11. Scroll-To-Bottom Floating Button Logic
    // ════════════════════════════════════════════════════════
    messagesList.addEventListener('scroll', () => {
        const threshold = 180;
        const isNearBottom = messagesList.scrollHeight - messagesList.scrollTop - messagesList.clientHeight < threshold;
        btnScrollBottom.style.display = isNearBottom ? 'none' : 'flex';
    });

    btnScrollBottom.addEventListener('click', () => {
        scrollToBottom();
    });

    // ════════════════════════════════════════════════════════
    // 12. Topbar Actions: Reload & Clear Chat
    // ════════════════════════════════════════════════════════
    btnRefreshHistory.addEventListener('click', async () => {
        if (iconRefreshHistory) iconRefreshHistory.classList.add('spin-anim');
        btnRefreshHistory.disabled = true;
        await checkServiceHealth();
        await loadHistory();
        if (iconRefreshHistory) iconRefreshHistory.classList.remove('spin-anim');
        btnRefreshHistory.disabled = false;
        Toast.success('Conversation synced with database');
    });

    btnRetryConnection.addEventListener('click', async () => {
        btnRetryConnection.textContent = 'Checking...';
        btnRetryConnection.disabled = true;
        await checkServiceHealth();
        if (isAiServiceOnline) {
            await loadHistory();
            Toast.success('AI Service is now online!');
        } else {
            Toast.error('Service still unreachable on port 8001');
        }
        btnRetryConnection.textContent = 'Retry Connection';
        btnRetryConnection.disabled = false;
    });

    btnClearChat.addEventListener('click', () => {
        clearModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    });

    function closeClearModal() {
        clearModal.style.display = 'none';
        document.body.style.overflow = '';
    }

    btnCloseClearModal.addEventListener('click', closeClearModal);
    btnCancelClear.addEventListener('click', closeClearModal);
    clearModal.addEventListener('click', (e) => {
        if (e.target === clearModal) closeClearModal();
    });

    btnConfirmClear.addEventListener('click', () => {
        // Clear message rows from DOM
        const rows = messagesList.querySelectorAll('.message-row');
        rows.forEach(r => r.remove());
        if (welcomeState) welcomeState.style.display = 'block';
        closeClearModal();
        Toast.info('Chat window cleared. Reload anytime to restore history.');
    });
});
