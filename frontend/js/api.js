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

    return { request, get, post, put, patch, del };
})();
