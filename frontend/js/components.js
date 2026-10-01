/**
 * Sahayak — Shared Layout Components  (components.js)
 * Injects dynamic sidebar, topbar, and page loaders across pages.
 */

const Components = (() => {
    'use strict';

    /**
     * Render and mount the unified Sidebar into #app-sidebar
     */
    function initSidebar(activePage = 'dashboard') {
        const container = document.getElementById('app-sidebar');
        if (!container) return;

        const user = JSON.parse(localStorage.getItem(CONFIG.USER_KEY) || '{}');
        const userName = user.name || 'User';
        const userInitial = userName.charAt(0).toUpperCase();
        const role = user.role || 'secretary';

        // Society info
        const societyName = (user.society && user.society.name) || (user.societyName) || (user.societyId ? 'My Society' : 'Setup Required');
        const societyCode = (user.society && user.society.societyCode) || (user.societyCode) || (user.societyId ? `ID: ${user.societyId}` : 'No Society');
        const needsSetup = !user.societyId && (!user.society || !user.society.id);

        container.className = 'sidebar';
        container.innerHTML = `
            <!-- Sidebar Header -->
            <div class="sidebar-header">
                <a href="${activePage === 'dashboard' ? '#' : 'dashboard.html'}" class="sidebar-brand">
                    <img src="../assets/images/logo.png" alt="Sahayak" class="sidebar-logo" onerror="this.src='https://images.unsplash.com/photo-1541888946425-d0fbb18086f6?w=80&q=80'">
                    <div class="sidebar-brand-text">
                        <h1>Sahayak</h1>
                        <span>Management</span>
                    </div>
                </a>

                <!-- Society Context Badge -->
                <div class="sidebar-society-badge">
                    <div class="society-badge-icon">
                        <i data-lucide="building-2"></i>
                    </div>
                    <div class="society-badge-info">
                        <div class="society-badge-name">${societyName}</div>
                        <div class="society-badge-code">${societyCode}</div>
                    </div>
                    ${needsSetup ? '<span class="nav-badge nav-badge-pending" title="Complete Setup">!</span>' : ''}
                </div>
            </div>

            <!-- Navigation Links -->
            <nav class="sidebar-nav">
                <div>
                    <div class="nav-group-title">Overview</div>
                    <ul class="nav-list">
                        <li>
                            <a href="dashboard.html" class="nav-link ${activePage === 'dashboard' ? 'active' : ''}">
                                <i data-lucide="layout-dashboard"></i>
                                <span>Dashboard</span>
                            </a>
                        </li>
                        <li>
                            <a href="society-setup.html" class="nav-link ${activePage === 'society-setup' ? 'active' : ''}">
                                <i data-lucide="building"></i>
                                <span>Society Setup</span>
                                ${needsSetup ? '<span class="nav-badge nav-badge-pending">Setup</span>' : ''}
                            </a>
                        </li>
                    </ul>
                </div>

                <div>
                    <div class="nav-group-title">Management</div>
                    <ul class="nav-list">
                        <li>
                            <a href="residents.html" class="nav-link ${activePage === 'residents' ? 'active' : ''}">
                                <i data-lucide="users"></i>
                                <span>Residents</span>
                                <span class="nav-badge nav-badge-pending" id="sidebar-pending-badge" style="display: none;">0</span>
                            </a>
                        </li>
                        <li>
                            <a href="feedback.html" class="nav-link ${activePage === 'feedback' ? 'active' : ''}">
                                <i data-lucide="clipboard-list"></i>
                                <span>Complaints</span>
                            </a>
                        </li>
                        <li>
                            <a href="analysis.html" class="nav-link ${activePage === 'analysis' ? 'active' : ''}">
                                <i data-lucide="pie-chart"></i>
                                <span>Analytics</span>
                            </a>
                        </li>
                    </ul>
                </div>

                <div>
                    <div class="nav-group-title">Intelligence</div>
                    <ul class="nav-list">
                        <li>
                            <a href="chat.html" class="nav-link ${activePage === 'chat' ? 'active' : ''}">
                                <i data-lucide="bot"></i>
                                <span>Sahayak AI</span>
                                <span class="nav-badge nav-badge-ai">AI</span>
                            </a>
                        </li>
                    </ul>
                </div>

                <div>
                    <div class="nav-group-title">Settings</div>
                    <ul class="nav-list">
                        <li>
                            <a href="settings.html" class="nav-link ${activePage === 'settings' ? 'active' : ''}">
                                <i data-lucide="settings"></i>
                                <span>Settings</span>
                            </a>
                        </li>
                    </ul>
                </div>
            </nav>

            <!-- User Profile & Logout Footer -->
            <div class="sidebar-footer">
                <div class="user-avatar">${userInitial}</div>
                <div class="user-info">
                    <div class="user-name" title="${userName}">${userName}</div>
                    <div class="user-role-tag">${role}</div>
                </div>
                <button type="button" class="btn-logout" id="btn-sidebar-logout" title="Log Out">
                    <i data-lucide="log-out"></i>
                </button>
            </div>
        `;

        // Handle Logout
        const logoutBtn = document.getElementById('btn-sidebar-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to log out?')) {
                    Router.logout();
                }
            });
        }

        // Render Lucide icons
        if (window.lucide) {
            lucide.createIcons({ nodes: [container] });
        }
    }

    /**
     * Render and mount Topbar into #app-topbar
     */
    function initTopbar({ title = 'Dashboard', subtitle = 'Welcome to Sahayak', actionBtn = null }) {
        const container = document.getElementById('app-topbar');
        if (!container) return;

        container.className = 'topbar';
        container.innerHTML = `
            <div class="topbar-left">
                <button type="button" class="btn-mobile-toggle" id="btn-mobile-sidebar-toggle" aria-label="Toggle Navigation">
                    <i data-lucide="menu"></i>
                </button>
                <div>
                    <h2 class="topbar-title">${title}</h2>
                    <span class="topbar-subtitle">${subtitle}</span>
                </div>
            </div>

            <div class="topbar-right">
                <div class="server-status-pill" id="server-status-pill" title="Sahayak Render Backend">
                    <span class="status-dot"></span>
                    <span>API Connected</span>
                </div>

                ${actionBtn ? `
                    <a href="${actionBtn.href}" class="btn-quick-action" id="${actionBtn.id || ''}">
                        <i data-lucide="${actionBtn.icon || 'plus'}"></i>
                        <span>${actionBtn.text}</span>
                    </a>
                ` : ''}
            </div>
        `;

        // Initialize mobile menu overlay & listeners
        initMobileMenu();

        if (window.lucide) {
            lucide.createIcons({ nodes: [container] });
        }
    }

    /**
     * Setup mobile menu overlay & toggle handlers
     */
    function initMobileMenu() {
        let overlay = document.getElementById('app-sidebar-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'app-sidebar-overlay';
            overlay.className = 'sidebar-overlay';
            document.body.appendChild(overlay);
        }

        const sidebar = document.getElementById('app-sidebar');
        const toggleBtn = document.getElementById('btn-mobile-sidebar-toggle');

        function toggleSidebar(open) {
            if (!sidebar || !overlay) return;
            const isOpen = typeof open === 'boolean' ? open : !sidebar.classList.contains('open');
            sidebar.classList.toggle('open', isOpen);
            overlay.classList.toggle('active', isOpen);
            document.body.style.overflow = isOpen ? 'hidden' : '';
        }

        if (toggleBtn) {
            toggleBtn.onclick = (e) => {
                e.stopPropagation();
                toggleSidebar();
            };
        }

        if (overlay) {
            overlay.onclick = () => toggleSidebar(false);
        }

        // Close on ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) {
                toggleSidebar(false);
            }
        });

        // Close on mobile nav click
        if (sidebar) {
            sidebar.querySelectorAll('.nav-link').forEach(link => {
                link.addEventListener('click', () => {
                    if (window.innerWidth <= 768) {
                        toggleSidebar(false);
                    }
                });
            });
        }
    }

    /**
     * Show / Hide Page Loader
     */
    function showPageLoader(msg = 'Loading society data...') {
        let loader = document.getElementById('app-page-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'app-page-loader';
            loader.className = 'page-loader';
            loader.innerHTML = `
                <div class="loader-spinner"></div>
                <div class="loader-text" id="app-page-loader-text">${msg}</div>
            `;
            document.body.appendChild(loader);
        } else {
            const txt = document.getElementById('app-page-loader-text');
            if (txt) txt.textContent = msg;
            loader.classList.remove('hidden');
        }
    }

    function hidePageLoader() {
        const loader = document.getElementById('app-page-loader');
        if (loader) {
            loader.classList.add('hidden');
        }
    }

    return {
        initSidebar,
        initTopbar,
        showPageLoader,
        hidePageLoader,
    };
})();
