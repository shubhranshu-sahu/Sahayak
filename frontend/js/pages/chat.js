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

    // Fix Bug-5: Scroll down to newest message once container is visible and rendered
    forceScrollBottom();

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

                    forceScrollBottom();
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
        forceScrollBottom();

        // 2. Prepare Assistant Streaming Bubble with Thinking & Progress UI (Bug-4)
        const assistantPlaceholder = createAssistantStreamingPlaceholder();
        messagesList.appendChild(assistantPlaceholder.row);
        forceScrollBottom();

        // 3. Initiate SSE Streaming
        isStreaming = true;
        chatForm.classList.add('streaming');
        btnStopGeneration.style.display = 'inline-flex';
        currentAbortController = new AbortController();

        let accumulatedContent = '';
        let firstTokenReceived = false;
        let stepCounter = 0;
        let currentActiveStepId = 'step-initial';
        const stepsRecord = [];

        try {
            await Api.aiStreamChat({
                message: text,
                society_name: societyName,
                secretary_name: secretaryName,
                signal: currentAbortController.signal,

                onStart: (startEvent) => {
                    assistantPlaceholder.setModelTag('Thinking...');
                },

                onStatus: (statusEvent) => {
                    const msg = statusEvent.message || 'Processing request...';
                    assistantPlaceholder.addStatusNotice(msg);
                    if (statusEvent.model) {
                        assistantPlaceholder.setModelTag(statusEvent.model);
                    }
                    scrollToBottom();
                },

                onToolStart: (toolEvent) => {
                    // Mark previous step as completed
                    if (currentActiveStepId) {
                        assistantPlaceholder.completeStep(currentActiveStepId);
                        const prevRec = stepsRecord.find(s => s.id === currentActiveStepId);
                        if (prevRec) prevRec.status = 'completed';
                    }

                    stepCounter++;
                    const toolName = toolEvent.tool || 'operation';
                    const toolInfo = getToolInfo(toolName, toolEvent.args || {});
                    const stepId = `tool-step-${stepCounter}`;
                    currentActiveStepId = stepId;

                    stepsRecord.push({
                        id: stepId,
                        tool: toolName,
                        title: toolInfo.title,
                        desc: toolInfo.desc,
                        icon: toolInfo.icon,
                        status: 'running'
                    });

                    assistantPlaceholder.addStep({
                        id: stepId,
                        title: toolInfo.title,
                        desc: toolInfo.desc,
                        icon: toolInfo.icon,
                        stepNumber: stepCounter
                    });

                    assistantPlaceholder.setModelTag(`${toolInfo.title.split(' ')[0]}...`);
                    scrollToBottom();
                },

                onToolResult: (resultEvent) => {
                    if (currentActiveStepId) {
                        assistantPlaceholder.completeStep(currentActiveStepId);
                        const rec = stepsRecord.find(s => s.id === currentActiveStepId);
                        if (rec) rec.status = 'completed';
                        currentActiveStepId = null;
                    }
                    assistantPlaceholder.setModelTag('Analyzing data...');
                    scrollToBottom();
                },

                onToken: (token) => {
                    if (!firstTokenReceived) {
                        firstTokenReceived = true;
                        if (currentActiveStepId) {
                            assistantPlaceholder.completeStep(currentActiveStepId);
                            const rec = stepsRecord.find(s => s.id === currentActiveStepId);
                            if (rec) rec.status = 'completed';
                            currentActiveStepId = null;
                        }
                        assistantPlaceholder.startStreamingTokens(stepsRecord.length);
                    }

                    accumulatedContent += token;
                    assistantPlaceholder.appendTokenContent(renderMarkdown(accumulatedContent));
                    scrollToBottom();
                },

                onDone: (doneEvent) => {
                    finalizeAssistantBubble(assistantPlaceholder, accumulatedContent, doneEvent.message_id, stepsRecord);
                },

                onError: (err) => {
                    console.error('[Chat] Stream error:', err);
                    if (currentActiveStepId) {
                        assistantPlaceholder.failStep(currentActiveStepId, err.message);
                        const rec = stepsRecord.find(s => s.id === currentActiveStepId);
                        if (rec) rec.status = 'failed';
                    }
                    const errorMsg = accumulatedContent
                        ? accumulatedContent + `\n\n*(Stream interrupted: ${err.message})*`
                        : `I encountered an issue connecting to the AI core: ${err.message}. Please ensure the Python service is running on port 8001.`;
                    finalizeAssistantBubble(assistantPlaceholder, errorMsg, null, stepsRecord);
                    Toast.error('AI response was interrupted.');
                }
            });
        } catch (err) {
            console.error('[Chat] Send message exception:', err);
            if (err.name !== 'AbortError') {
                finalizeAssistantBubble(assistantPlaceholder, `Error: ${err.message}`, null, stepsRecord);
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

    // ════════════════════════════════════════════════════════
    // Tool Metadata & Human-Readable Labels (Bug-4)
    // ════════════════════════════════════════════════════════
    const TOOL_META = {
        get_society_info: {
            title: 'Checking society configuration',
            desc: 'Fetching society details & settings',
            icon: 'building'
        },
        get_society_structure: {
            title: 'Loading building layout',
            desc: 'Retrieving blocks, floors & apartments breakdown',
            icon: 'layers'
        },
        get_dashboard_stats: {
            title: 'Loading dashboard metrics',
            desc: 'Fetching occupancy, units & resident stats',
            icon: 'bar-chart-2'
        },
        get_residents_list: {
            title: 'Querying resident directory',
            desc: 'Retrieving registered residents',
            icon: 'users'
        },
        add_blocks: {
            title: 'Creating building blocks',
            desc: 'Registering new blocks',
            icon: 'plus-square'
        },
        add_floors: {
            title: 'Adding floors to block',
            desc: 'Configuring floor structure',
            icon: 'layers'
        },
        add_units: {
            title: 'Generating apartment units',
            desc: 'Creating residential apartments',
            icon: 'home'
        },
        approve_resident: {
            title: 'Approving resident registration',
            desc: 'Validating and granting resident access',
            icon: 'user-check'
        },
        reject_resident: {
            title: 'Rejecting resident application',
            desc: 'Processing rejection notice',
            icon: 'user-x'
        },
        revoke_resident: {
            title: 'Revoking resident access',
            desc: 'Deactivating resident membership',
            icon: 'shield-alert'
        },
        reactivate_resident: {
            title: 'Reactivating resident account',
            desc: 'Restoring apartment access',
            icon: 'user-plus'
        },
        rename_block: {
            title: 'Renaming block',
            desc: 'Updating block identifier',
            icon: 'edit-3'
        },
        delete_block: {
            title: 'Removing building block',
            desc: 'Deleting block from society',
            icon: 'trash-2'
        },
        delete_floor: {
            title: 'Removing floor',
            desc: 'Deleting floor level & apartments',
            icon: 'trash'
        },
        edit_unit: {
            title: 'Editing unit details',
            desc: 'Updating unit specifications',
            icon: 'edit'
        },
        delete_unit: {
            title: 'Removing apartment unit',
            desc: 'Deleting apartment record',
            icon: 'trash'
        },
        update_society_info: {
            title: 'Updating society profile',
            desc: 'Saving updated settings',
            icon: 'save'
        }
    };

    function getToolInfo(toolName, args = {}) {
        const base = TOOL_META[toolName] || {
            title: (toolName || 'operation').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            desc: 'Executing specialized assistant operation',
            icon: 'cpu'
        };

        let customDesc = base.desc;
        if (toolName === 'add_blocks' && args.block_names) {
            const names = Array.isArray(args.block_names) ? args.block_names.join(', ') : args.block_names;
            customDesc = `Adding: ${names}`;
        } else if (toolName === 'rename_block' && args.new_name) {
            customDesc = `Renaming to: ${args.new_name}`;
        } else if (toolName === 'get_residents_list' && args.status) {
            customDesc = `Filter: ${args.status} residents`;
        } else if (args.block_name) {
            customDesc = `${base.desc} for ${args.block_name}`;
        } else if (args.resident_name) {
            customDesc = `${base.desc} for ${args.resident_name}`;
        }

        return {
            title: base.title,
            desc: customDesc,
            icon: base.icon
        };
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
                    <div class="ai-thought-container" id="streaming-thought-container">
                        <div class="ai-thought-header">
                            <div class="ai-thought-header-left">
                                <span class="ai-thought-pulse-dot"></span>
                                <span class="ai-thought-title">Thinking & Working</span>
                            </div>
                            <span class="ai-thought-step-counter">Starting</span>
                        </div>
                        <div class="ai-thought-steps-list">
                            <div class="ai-step-item active" id="step-initial">
                                <div class="ai-step-icon-wrapper">
                                    <span class="ai-step-spinner"></span>
                                </div>
                                <div class="ai-step-text-col">
                                    <div class="ai-step-title">Analyzing request...</div>
                                    <div class="ai-step-desc">Understanding context & planning actions</div>
                                </div>
                                <span class="ai-step-badge running">Active</span>
                            </div>
                        </div>
                    </div>
                    <div class="ai-stream-response" style="display: none;"></div>
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
        const thoughtContainer = row.querySelector('.ai-thought-container');
        const stepsList = row.querySelector('.ai-thought-steps-list');
        const stepCounter = row.querySelector('.ai-thought-step-counter');
        const streamResponse = row.querySelector('.ai-stream-response');
        const cursor = row.querySelector('.streaming-cursor');
        const modelTag = row.querySelector('.model-tag');

        return {
            row,
            bubble,
            metaBar,
            thoughtContainer,
            stepsList,
            stepCounter,
            streamResponse,
            cursor,
            modelTag,

            setModelTag(text) {
                if (modelTag) modelTag.textContent = text;
            },

            addStatusNotice(message) {
                if (!stepsList) return;
                const notice = document.createElement('div');
                notice.className = 'ai-status-notice';
                notice.innerHTML = `
                    <i data-lucide="info" style="width: 14px; height: 14px;"></i>
                    <span>${escapeHtml(message)}</span>
                `;
                stepsList.appendChild(notice);
                if (window.lucide) lucide.createIcons({ nodes: [notice] });
            },

            addStep({ id, title, desc, icon, stepNumber }) {
                if (!stepsList) return;
                if (stepCounter) stepCounter.textContent = `Step ${stepNumber}`;

                const step = document.createElement('div');
                step.className = 'ai-step-item active';
                step.id = id;
                step.innerHTML = `
                    <div class="ai-step-icon-wrapper">
                        <span class="ai-step-spinner"></span>
                    </div>
                    <div class="ai-step-text-col">
                        <div class="ai-step-title">${escapeHtml(title)}</div>
                        <div class="ai-step-desc">${escapeHtml(desc)}</div>
                    </div>
                    <span class="ai-step-badge running">Running</span>
                `;
                stepsList.appendChild(step);
            },

            completeStep(id) {
                const step = document.getElementById(id);
                if (!step) return;
                step.classList.remove('active');
                step.classList.add('completed');
                const iconWrapper = step.querySelector('.ai-step-icon-wrapper');
                if (iconWrapper) {
                    iconWrapper.innerHTML = '<i data-lucide="check" style="width: 13px; height: 13px;"></i>';
                    if (window.lucide) lucide.createIcons({ nodes: [iconWrapper] });
                }
                const badge = step.querySelector('.ai-step-badge');
                if (badge) {
                    badge.className = 'ai-step-badge done';
                    badge.textContent = 'Done';
                }
            },

            failStep(id, errMsg) {
                const step = document.getElementById(id);
                if (!step) return;
                step.classList.remove('active');
                step.classList.add('failed');
                const iconWrapper = step.querySelector('.ai-step-icon-wrapper');
                if (iconWrapper) {
                    iconWrapper.innerHTML = '<i data-lucide="alert-circle" style="width: 13px; height: 13px;"></i>';
                    if (window.lucide) lucide.createIcons({ nodes: [iconWrapper] });
                }
                const badge = step.querySelector('.ai-step-badge');
                if (badge) {
                    badge.className = 'ai-step-badge failed';
                    badge.textContent = 'Error';
                }
            },

            startStreamingTokens(toolStepsCount) {
                if (toolStepsCount === 0) {
                    if (thoughtContainer) thoughtContainer.style.display = 'none';
                } else {
                    if (stepCounter) stepCounter.textContent = `${toolStepsCount} Done`;
                    const pulseDot = thoughtContainer ? thoughtContainer.querySelector('.ai-thought-pulse-dot') : null;
                    if (pulseDot) pulseDot.style.display = 'none';
                    const titleEl = thoughtContainer ? thoughtContainer.querySelector('.ai-thought-title') : null;
                    if (titleEl) titleEl.textContent = 'Actions & Reasoning Completed';
                    if (thoughtContainer) thoughtContainer.style.opacity = '0.9';
                }
                if (modelTag) modelTag.textContent = 'AI';
                if (streamResponse) streamResponse.style.display = 'block';
            },

            appendTokenContent(parsedHtml) {
                if (streamResponse) {
                    streamResponse.innerHTML = parsedHtml;
                }
            }
        };
    }

    function finalizeAssistantBubble(placeholder, fullContent, messageId, stepsRecord = []) {
        if (!placeholder || !placeholder.bubble) return;

        let html = '';
        if (stepsRecord && stepsRecord.length > 0) {
            const completedCount = stepsRecord.filter(s => s.status === 'completed').length;
            html += `
                <details class="ai-thought-accordion">
                    <summary class="ai-thought-summary">
                        <div class="ai-thought-summary-left">
                            <i data-lucide="sparkles" style="width: 14px; height: 14px; color: var(--ai-purple);"></i>
                            <span>Completed ${completedCount} action${completedCount === 1 ? '' : 's'} & reasoning</span>
                        </div>
                        <i data-lucide="chevron-down" class="ai-thought-accordion-arrow"></i>
                    </summary>
                    <div class="ai-thought-accordion-body">
                        ${stepsRecord.map(s => `
                            <div class="ai-step-item ${s.status === 'completed' ? 'completed' : 'failed'}">
                                <div class="ai-step-icon-wrapper">
                                    <i data-lucide="${s.status === 'completed' ? 'check' : 'alert-circle'}" style="width: 13px; height: 13px;"></i>
                                </div>
                                <div class="ai-step-text-col">
                                    <div class="ai-step-title">${escapeHtml(s.title)}</div>
                                    <div class="ai-step-desc">${escapeHtml(s.desc)}</div>
                                </div>
                                <span class="ai-step-badge ${s.status === 'completed' ? 'done' : 'failed'}">${s.status === 'completed' ? 'Done' : 'Failed'}</span>
                            </div>
                        `).join('')}
                    </div>
                </details>
            `;
        }

        html += `<div class="ai-stream-response">${renderMarkdown(fullContent)}</div>`;
        placeholder.bubble.innerHTML = html;

        // Reset model tag to AI
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
        }

        if (window.lucide) lucide.createIcons({ nodes: [placeholder.row] });
        forceScrollBottom();
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
            if (!dateInput) return 'Recently';
            let d;
            if (typeof dateInput === 'string') {
                // If timestamp string lacks timezone designator ('Z' or offset), treat as UTC
                const hasTimezone = dateInput.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateInput);
                const utcStr = hasTimezone ? dateInput : `${dateInput}Z`;
                d = new Date(utcStr);
            } else {
                d = new Date(dateInput);
            }
            if (isNaN(d.getTime())) return 'Recently';
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

    function scrollToBottom(behavior = 'auto') {
        if (!messagesList) return;
        if (behavior === 'smooth') {
            messagesList.scrollTo({ top: messagesList.scrollHeight, behavior: 'smooth' });
        } else {
            messagesList.scrollTop = messagesList.scrollHeight;
        }
    }

    function forceScrollBottom() {
        scrollToBottom();
        requestAnimationFrame(() => {
            scrollToBottom();
            setTimeout(scrollToBottom, 50);
            setTimeout(scrollToBottom, 150);
        });
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
        scrollToBottom('smooth');
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
        forceScrollBottom();
        Toast.success('Conversation synced with database');
    });

    btnRetryConnection.addEventListener('click', async () => {
        btnRetryConnection.textContent = 'Checking...';
        btnRetryConnection.disabled = true;
        await checkServiceHealth();
        if (isAiServiceOnline) {
            await loadHistory();
            forceScrollBottom();
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
