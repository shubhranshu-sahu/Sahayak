/**
 * Sahayak — API Wrapper  (api.js)
 * Centralized fetch with JWT, error handling, and standardized responses.
 */

const Api = (() => {
    'use strict';

    /**
     * Core request function
     * @param {string} endpoint - path after API_BASE (e.g. '/auth/login')
     * @param {object} options  - { method, body, base }
     * @returns {Promise<{success, message, data}>}
     */
    async function request(endpoint, options = {}) {
        const {
            method = 'GET',
            body = null,
            base = CONFIG.API_BASE,       // default to Node backend
            headers: extraHeaders = {},
        } = options;

        const url = `${base}${endpoint}`;

        const headers = {
            'Content-Type': 'application/json',
            ...extraHeaders,
        };

        // Attach JWT if present
        const token = localStorage.getItem(CONFIG.TOKEN_KEY);
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const fetchOpts = { method, headers };
        if (body && method !== 'GET') {
            fetchOpts.body = JSON.stringify(body);
        }

        try {
            const res = await fetch(url, fetchOpts);

            // Handle 401 — token expired / invalid
            if (res.status === 401) {
                const data = await res.json().catch(() => ({}));
                const pathname = window.location.pathname;
                const isAuthPage = pathname.includes('login') || pathname.includes('register');

                // Only clear tokens & redirect for authenticated endpoint failures
                // Don't redirect if already on an auth page
                if (token && !isAuthPage) {
                    localStorage.removeItem(CONFIG.TOKEN_KEY);
                    localStorage.removeItem(CONFIG.USER_KEY);
                    window.location.href = '/pages/login.html';
                }

                return {
                    success: false,
                    message: data.message || 'Session expired. Please log in again.',
                    data: null,
                };
            }

            const data = await res.json();
            return data;

        } catch (err) {
            console.error('[Api] Network error:', err);
            return {
                success: false,
                message: 'Network error. Please check your connection.',
                data: null,
            };
        }
    }

    /* ── Convenience methods ── */
    function get(endpoint, opts = {}) {
        return request(endpoint, { ...opts, method: 'GET' });
    }

    function post(endpoint, body, opts = {}) {
        return request(endpoint, { ...opts, method: 'POST', body });
    }

    function put(endpoint, body, opts = {}) {
        return request(endpoint, { ...opts, method: 'PUT', body });
    }

    function patch(endpoint, body, opts = {}) {
        return request(endpoint, { ...opts, method: 'PATCH', body });
    }

    function del(endpoint, opts = {}) {
        return request(endpoint, { ...opts, method: 'DELETE' });
    }

    /* ── AI Service Helpers (FastAPI on CONFIG.AI_BASE) ── */
    function aiGet(endpoint, opts = {}) {
        return request(endpoint, { ...opts, base: CONFIG.AI_BASE, method: 'GET' });
    }

    function aiPost(endpoint, body, opts = {}) {
        return request(endpoint, { ...opts, base: CONFIG.AI_BASE, method: 'POST', body });
    }

    /**
     * Stream response from AI Service via Server-Sent Events (SSE)
     * @param {object} params - { message, society_name, secretary_name, onStart, onToken, onDone, onError, signal }
     */
    async function aiStreamChat({
        message,
        society_name = 'the Society',
        secretary_name = 'Secretary',
        onStart = null,
        onToken = null,
        onDone = null,
        onError = null,
        signal = null,
    }) {
        const token = localStorage.getItem(CONFIG.TOKEN_KEY);
        const url = `${CONFIG.AI_BASE}/chat/message`;

        const headers = {
            'Content-Type': 'application/json',
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    message,
                    society_name,
                    secretary_name,
                }),
                signal,
            });

            if (!res.ok) {
                let errorMsg = `Server returned status ${res.status}`;
                try {
                    const errJson = await res.json();
                    errorMsg = errJson.detail || errJson.message || errorMsg;
                } catch (_) {}
                throw new Error(errorMsg);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Retain incomplete line

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data:')) continue;

                    const jsonStr = trimmed.slice(5).trim();
                    if (!jsonStr) continue;

                    try {
                        const event = JSON.parse(jsonStr);
                        if (event.type === 'start') {
                            if (onStart) onStart(event);
                        } else if (event.type === 'token') {
                            if (onToken) onToken(event.content);
                        } else if (event.type === 'done') {
                            if (onDone) onDone(event);
                        } else if (event.type === 'error') {
                            if (onError) onError(new Error(event.message || 'Stream error'));
                        }
                    } catch (parseErr) {
                        console.warn('[Api] Failed to parse SSE event:', jsonStr, parseErr);
                    }
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('[Api] Chat stream aborted by user');
                return;
            }
            console.error('[Api] aiStreamChat failed:', err);
            if (onError) onError(err);
        }
    }

    /* ── Phase 1B Domain Helpers ── */
    function getDashboardStats() {
        return get('/secretary/dashboard/stats');
    }

    function getAllResidents(status = '') {
        const query = status ? `?status=${encodeURIComponent(status)}` : '';
        return get(`/secretary/residents/all${query}`);
    }

    function revokeResident(residentId) {
        return post(`/secretary/residents/${residentId}/revoke`);
    }

    function validateSocietyCode(code) {
        return get(`/public/validate-code/${encodeURIComponent(code)}`);
    }

    function renameBlock(blockId, block_name) {
        return put(`/society/blocks/${blockId}`, { block_name });
    }

    function deleteBlock(blockId) {
        return del(`/society/blocks/${blockId}`);
    }

    function deleteFloor(blockId, floorId) {
        return del(`/blocks/${blockId}/floors/${floorId}`);
    }

    function deleteUnit(unitId) {
        return del(`/units/${unitId}`);
    }

    function editUnit(unitId, data) {
        return put(`/units/${unitId}`, data);
    }

    return {
        request,
        get,
        post,
        put,
        patch,
        del,
        aiGet,
        aiPost,
        aiStreamChat,
        // Phase 1B additions
        getDashboardStats,
        getAllResidents,
        revokeResident,
        validateSocietyCode,
        renameBlock,
        deleteBlock,
        deleteFloor,
        deleteUnit,
        editUnit,
    };
})();
