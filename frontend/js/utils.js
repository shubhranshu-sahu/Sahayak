/**
 * Sahayak — Utility Helpers  (utils.js)
 * Toasts, formatters, DOM helpers
 */

/* ══════════ Toast Notifications ══════════ */
const Toast = (() => {
    let container = null;

    function getContainer() {
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    function show(message, type = 'info', duration = 4000) {
        const c = getContainer();
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        // Pick icon based on type
        const iconMap = {
            success: 'check-circle',
            error: 'x-circle',
            warning: 'alert-triangle',
            info: 'info',
        };

        toast.innerHTML = `
            <i data-lucide="${iconMap[type] || 'info'}"></i>
            <span>${message}</span>
        `;

        c.appendChild(toast);

        // Initialize Lucide icons inside toast
        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ nodes: [toast] });
        }

        // Auto-remove
        setTimeout(() => {
            toast.classList.add('toast-exit');
            toast.addEventListener('animationend', () => toast.remove());
        }, duration);
    }

    return {
        success: (msg, dur) => show(msg, 'success', dur),
        error: (msg, dur) => show(msg, 'error', dur),
        warning: (msg, dur) => show(msg, 'warning', dur),
        info: (msg, dur) => show(msg, 'info', dur),
    };
})();


/* ══════════ Date Formatters ══════════ */
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function timeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return formatDate(dateString);
}


/* ══════════ DOM Helpers ══════════ */
function $(selector, parent = document) {
    return parent.querySelector(selector);
}

function $$(selector, parent = document) {
    return [...parent.querySelectorAll(selector)];
}

function createElement(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, val]) => {
        if (key === 'className') el.className = val;
        else if (key === 'innerHTML') el.innerHTML = val;
        else if (key === 'textContent') el.textContent = val;
        else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), val);
        else el.setAttribute(key, val);
    });
    children.forEach(child => {
        if (typeof child === 'string') el.appendChild(document.createTextNode(child));
        else el.appendChild(child);
    });
    return el;
}


/* ══════════ Debounce ══════════ */
function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}
