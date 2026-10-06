/**
 * Sahayak — Residents & Approvals Management (residents.js)
 * Implements Secretary approval/rejection flow, resident directory, search, and occupancy stats.
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Guard check: Must be authenticated and a secretary
    const user = await Router.requireAuth();
    if (!user) return;

    if (user.role !== 'secretary') {
        Toast.error('Access restricted to society secretaries');
        Router.redirectToDashboard(user);
        return;
    }

    // 2. Initialize Shared Components
    Components.initSidebar('residents');
    Components.initTopbar({
        title: 'Resident Approvals',
        subtitle: 'Review pending requests and manage society members',
        actionBtn: {
            text: 'Dashboard',
            icon: 'layout-dashboard',
            href: 'dashboard.html'
        }
    });
    // 3. Page State
    let pendingResidents = [];
    let activeResidents = [];
    let inactiveResidents = [];
    let rejectedResidents = [];
    let allResidents = [];
    let societyBlocks = [];
    let currentTab = 'pending'; // 'pending' | 'active' | 'inactive' | 'rejected' | 'all'
    let searchQuery = '';
    let selectedBlock = '';
    let targetedRejectResident = null;
    let targetedRevokeResident = null;

    // 4. DOM Elements
    const pageLoader = document.getElementById('app-page-loader');
    const tabBtnPending = document.getElementById('tab-btn-pending');
    const tabBtnActive = document.getElementById('tab-btn-active');
    const tabBtnInactive = document.getElementById('tab-btn-inactive');
    const tabBtnRejected = document.getElementById('tab-btn-rejected');
    const tabBtnAll = document.getElementById('tab-btn-all');

    const viewPending = document.getElementById('view-pending');
    const viewActive = document.getElementById('view-active');
    const searchInput = document.getElementById('search-input');
    const btnClearSearch = document.getElementById('btn-clear-search');
    const blockFilterSelect = document.getElementById('filter-block-select');
    const btnRefresh = document.getElementById('btn-refresh-residents');
    const iconRefresh = document.getElementById('icon-refresh');

    // Reject Modal elements
    const rejectModal = document.getElementById('reject-modal');
    const btnCloseRejectModal = document.getElementById('btn-close-reject-modal');
    const btnCancelReject = document.getElementById('btn-cancel-reject');
    const btnConfirmReject = document.getElementById('btn-confirm-reject');
    const modalResidentName = document.getElementById('modal-resident-name');
    const modalResidentUnit = document.getElementById('modal-resident-unit');

    // Revoke Modal elements
    const revokeModal = document.getElementById('revoke-modal');
    const btnCloseRevokeModal = document.getElementById('btn-close-revoke-modal');
    const btnCancelRevoke = document.getElementById('btn-cancel-revoke');
    const btnConfirmRevoke = document.getElementById('btn-confirm-revoke');
    const revokeModalResidentName = document.getElementById('revoke-modal-resident-name');
    const revokeModalResidentUnit = document.getElementById('revoke-modal-resident-unit');

    // 5. Initial Data Loading
    await loadAllData();

    // Reveal real view and hide skeleton
    const skeleton = document.getElementById('residents-skeleton');
    const mainView = document.getElementById('residents-main-view');
    if (skeleton) skeleton.style.display = 'none';
    if (mainView) mainView.style.display = 'block';
    if (window.lucide) lucide.createIcons();

    // ════════════════════════════════════════════════════════
    // Event Listeners
    // ════════════════════════════════════════════════════════

    // Tab Switching
    if (tabBtnPending) tabBtnPending.addEventListener('click', () => switchTab('pending'));
    if (tabBtnActive) tabBtnActive.addEventListener('click', () => switchTab('active'));
    if (tabBtnInactive) tabBtnInactive.addEventListener('click', () => switchTab('inactive'));
    if (tabBtnRejected) tabBtnRejected.addEventListener('click', () => switchTab('rejected'));
    if (tabBtnAll) tabBtnAll.addEventListener('click', () => switchTab('all'));

    // Search Input
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        btnClearSearch.style.display = searchQuery ? 'flex' : 'none';
        renderCurrentView();
    });

    btnClearSearch.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        btnClearSearch.style.display = 'none';
        renderCurrentView();
        searchInput.focus();
    });

    // Block Filter
    blockFilterSelect.addEventListener('change', (e) => {
        selectedBlock = e.target.value;
        renderCurrentView();
    });

    // Refresh Button
    btnRefresh.addEventListener('click', async () => {
        if (iconRefresh) iconRefresh.classList.add('spin-anim');
        btnRefresh.disabled = true;
        await loadAllData();
        if (iconRefresh) iconRefresh.classList.remove('spin-anim');
        btnRefresh.disabled = false;
        Toast.success('Data refreshed successfully');
    });

    // Reject Modal Events
    if (btnCloseRejectModal) btnCloseRejectModal.addEventListener('click', closeRejectModal);
    if (btnCancelReject) btnCancelReject.addEventListener('click', closeRejectModal);
    if (rejectModal) {
        rejectModal.addEventListener('click', (e) => {
            if (e.target === rejectModal) closeRejectModal();
        });
    }
    if (btnConfirmReject) btnConfirmReject.addEventListener('click', handleConfirmReject);

    // Revoke Modal Events
    if (btnCloseRevokeModal) btnCloseRevokeModal.addEventListener('click', closeRevokeModal);
    if (btnCancelRevoke) btnCancelRevoke.addEventListener('click', closeRevokeModal);
    if (revokeModal) {
        revokeModal.addEventListener('click', (e) => {
            if (e.target === revokeModal) closeRevokeModal();
        });
    }
    if (btnConfirmRevoke) btnConfirmRevoke.addEventListener('click', handleConfirmRevoke);
ener('click', closeRejectModal);
    rejectModal.addEventListener('click', (e) => {
        if (e.target === rejectModal) closeRejectModal();
    });

    btnConfirmReject.addEventListener('click', handleConfirmReject);

    // ════════════════════════════════════════════════════════
    // Data Loading Functions
    // ════════════════════════════════════════════════════════

    async function loadAllData() {
        try {
            // Parallel fetch for speed
            const [allRes, pendingRes, structRes, statsRes] = await Promise.allSettled([
                Api.getAllResidents(),
                Api.get('/secretary/residents/pending'),
                Api.get('/society/structure'),
                Api.getDashboardStats()
            ]);

            // Handle All Residents (Unified Phase 1B API)
            if (allRes.status === 'fulfilled' && allRes.value.success && Array.isArray(allRes.value.data)) {
                allResidents = allRes.value.data;
                activeResidents = allResidents.filter(r => r.status === 'active');
                inactiveResidents = allResidents.filter(r => r.status === 'inactive');
                rejectedResidents = allResidents.filter(r => r.status === 'rejected');
            } else {
                allResidents = [];
                activeResidents = [];
                inactiveResidents = [];
                rejectedResidents = [];
            }

            // Handle Pending Residents (for full approval card actions)
            if (pendingRes.status === 'fulfilled' && pendingRes.value.success && Array.isArray(pendingRes.value.data)) {
                pendingResidents = pendingRes.value.data;
            } else {
                pendingResidents = allResidents.filter(r => r.status === 'pending');
            }

            // Handle Structure (for occupancy and block filter options)
            let totalUnits = 0;
            let occupiedUnits = 0;
            let vacantUnits = 0;
            let occupancyRate = 0;

            if (structRes.status === 'fulfilled' && structRes.value.success && structRes.value.data) {
                const struct = structRes.value.data;
                societyBlocks = struct.blocks || [];
                populateBlockDropdown(societyBlocks);
            }

            if (statsRes.status === 'fulfilled' && statsRes.value.success && statsRes.value.data) {
                const stats = statsRes.value.data;
                const sStruct = stats.structure || {};
                totalUnits = sStruct.totalUnits || 0;
                occupiedUnits = sStruct.occupiedUnits || 0;
                vacantUnits = sStruct.vacantUnits || 0;
                occupancyRate = sStruct.occupancyRate !== undefined ? sStruct.occupancyRate : 0;
            } else if (societyBlocks.length > 0) {
                societyBlocks.forEach(b => {
                    (b.floors || []).forEach(f => {
                        (f.units || []).forEach(u => {
                            totalUnits++;
                            if (u.status === 'occupied') occupiedUnits++;
                            else vacantUnits++;
                        });
                    });
                });
                occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;
            }

            // Update stats & tab badges
            updateMetrics(totalUnits, occupiedUnits, vacantUnits, occupancyRate);

            // Render active view
            renderCurrentView();

        } catch (err) {
            console.error('Error loading resident management data:', err);
            Toast.error('Failed to load some data. Please check connection.');
        }
    }

    function populateBlockDropdown(blocks) {
        const currentVal = blockFilterSelect.value;
        blockFilterSelect.innerHTML = '<option value="">All Blocks</option>';
        blocks.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.blockName || b.block_name;
            opt.textContent = `Block ${b.blockName || b.block_name}`;
            blockFilterSelect.appendChild(opt);
        });
        if (currentVal) blockFilterSelect.value = currentVal;
    }

    function updateMetrics(total, occupied, vacant, rate) {
        // Pending Metric & Badges
        const pendEl = document.getElementById('stat-pending-count');
        const pendBadge = document.getElementById('badge-pending-count');
        const pendInfo = document.getElementById('pending-queue-info');
        const pendSub = document.getElementById('stat-pending-sub');
        if (pendEl) pendEl.textContent = pendingResidents.length;
        if (pendBadge) pendBadge.textContent = pendingResidents.length;
        if (pendInfo) pendInfo.textContent = `${pendingResidents.length} requests waiting`;
        if (pendSub) {
            pendSub.textContent = pendingResidents.length > 0 ? 'Requires Secretary Action' : 'All Clear';
            pendSub.className = `stat-badge ${pendingResidents.length > 0 ? 'amber' : 'positive'}`;
        }

        // Active Metric & Badges
        const actEl = document.getElementById('stat-active-count');
        const actBadge = document.getElementById('badge-active-count');
        const actInfo = document.getElementById('active-dir-info');
        if (actEl) actEl.textContent = activeResidents.length;
        if (actBadge) actBadge.textContent = activeResidents.length;
        if (actInfo) actInfo.textContent = `${activeResidents.length} verified members`;

        // Other Status Badges
        const inactBadge = document.getElementById('badge-inactive-count');
        if (inactBadge) inactBadge.textContent = inactiveResidents.length;

        const rejBadge = document.getElementById('badge-rejected-count');
        if (rejBadge) rejBadge.textContent = rejectedResidents.length;

        const allBadge = document.getElementById('badge-all-count');
        if (allBadge) allBadge.textContent = allResidents.length;

        // Occupancy Metric
        const occRateEl = document.getElementById('stat-occupancy-rate');
        const occEl = document.getElementById('stat-occupied-units');
        const vacEl = document.getElementById('stat-vacant-units');
        if (occRateEl) occRateEl.textContent = `${rate}%`;
        if (occEl) occEl.textContent = `${occupied} Occupied`;
        if (vacEl) vacEl.textContent = `· ${vacant} Vacant`;

        // Sidebar pending badge
        const sidebarPendingBadge = document.getElementById('sidebar-pending-badge');
        if (sidebarPendingBadge) {
            if (pendingResidents.length > 0) {
                sidebarPendingBadge.textContent = pendingResidents.length;
                sidebarPendingBadge.style.display = 'inline-block';
            } else {
                sidebarPendingBadge.style.display = 'none';
            }
        }
    }

    // ════════════════════════════════════════════════════════
    // View Rendering
    // ════════════════════════════════════════════════════════

    function switchTab(tab) {
        currentTab = tab;
        [tabBtnPending, tabBtnActive, tabBtnInactive, tabBtnRejected, tabBtnAll].forEach(btn => {
            if (btn) btn.classList.remove('active');
        });

        if (tab === 'pending') {
            if (tabBtnPending) tabBtnPending.classList.add('active');
            viewPending.style.display = 'block';
            viewActive.style.display = 'none';
        } else {
            if (tab === 'active' && tabBtnActive) tabBtnActive.classList.add('active');
            else if (tab === 'inactive' && tabBtnInactive) tabBtnInactive.classList.add('active');
            else if (tab === 'rejected' && tabBtnRejected) tabBtnRejected.classList.add('active');
            else if (tab === 'all' && tabBtnAll) tabBtnAll.classList.add('active');

            viewActive.style.display = 'block';
            viewPending.style.display = 'none';
        }
        renderCurrentView();
    }

    function renderCurrentView() {
        if (currentTab === 'pending') {
            renderPendingList();
        } else {
            renderActiveTable();
        }
    }

    // Filter Helper
    function matchesFilter(item) {
        const query = searchQuery;
        const block = selectedBlock;

        const nameMatch = (item.name || '').toLowerCase().includes(query);
        const emailMatch = (item.email || '').toLowerCase().includes(query);
        const phoneMatch = (item.phone || '').toLowerCase().includes(query);
        const unitLabel = item.unit ? (item.unit.displayLabel || '').toLowerCase() : '';
        const unitMatch = unitLabel.includes(query);

        const searchOk = !query || nameMatch || emailMatch || phoneMatch || unitMatch;

        const itemBlock = item.unit ? (item.unit.block || item.unit.blockName || '') : '';
        const blockOk = !block || itemBlock.toUpperCase() === block.toUpperCase();

        return searchOk && blockOk;
    }

    // ════════════════════════════════════════════════════════
    // 1. Render Pending Approvals Cards
    // ════════════════════════════════════════════════════════

    function renderPendingList() {
        const container = document.getElementById('pending-cards-container');
        if (!container) return;

        const filtered = pendingResidents.filter(matchesFilter);

        if (filtered.length === 0) {
            if (pendingResidents.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="padding: var(--sp-12) var(--sp-6);">
                        <div class="empty-state-icon" style="background: rgba(46, 125, 50, 0.1); color: #2E7D32;">
                            <i data-lucide="check-circle"></i>
                        </div>
                        <h4 style="font-size: var(--fs-lg); margin-top: var(--sp-3);">All Clear! No Pending Approvals</h4>
                        <p style="max-width: 480px; margin: var(--sp-2) auto 0; color: var(--clr-text-secondary);">
                            There are currently no new resident registration requests awaiting review. When residents register for your society, their verification details will appear here.
                        </p>
                    </div>
                `;
            } else {
                container.innerHTML = `
                    <div class="empty-state" style="padding: var(--sp-8) var(--sp-6);">
                        <div class="empty-state-icon">
                            <i data-lucide="search-x"></i>
                        </div>
                        <h4>No Results Found</h4>
                        <p>No pending applications match "${searchQuery}"${selectedBlock ? ` in Block ${selectedBlock}` : ''}.</p>
                    </div>
                `;
            }
            if (window.lucide) lucide.createIcons({ nodes: [container] });
            return;
        }

        container.innerHTML = '';
        filtered.forEach(resident => {
            const initial = (resident.name || 'R').charAt(0).toUpperCase();
            const unitLabel = (resident.unit && resident.unit.displayLabel) || 'Unit Pending';
            const blockName = (resident.unit && resident.unit.block) || '--';
            const floorNo = (resident.unit && resident.unit.floor) !== undefined ? resident.unit.floor : '--';
            const dateStr = resident.registeredAt ? formatDate(resident.registeredAt) : 'Recently';

            const card = document.createElement('div');
            card.className = 'pending-approval-card';
            card.id = `pending-card-${resident.userId}`;
            card.innerHTML = `
                <div class="pending-card-left">
                    <div class="resident-avatar-lg">${initial}</div>
                    <div class="resident-details">
                        <div class="resident-primary-row">
                            <h4 class="resident-full-name">${escapeHtml(resident.name)}</h4>
                            <span class="status-pill status-pill-pending">
                                <span class="pulse-dot amber"></span>
                                Pending Review
                            </span>
                        </div>
                        <div class="resident-contact-row">
                            <a href="mailto:${escapeHtml(resident.email)}" class="contact-chip" title="Send email">
                                <i data-lucide="mail"></i>
                                <span>${escapeHtml(resident.email)}</span>
                            </a>
                            ${resident.phone ? `
                                <a href="tel:${escapeHtml(resident.phone)}" class="contact-chip" title="Call resident">
                                    <i data-lucide="phone"></i>
                                    <span>${escapeHtml(resident.phone)}</span>
                                </a>
                            ` : ''}
                            <span class="contact-chip registered-date" title="Registration timestamp">
                                <i data-lucide="calendar"></i>
                                <span>Applied: ${dateStr}</span>
                            </span>
                        </div>
                    </div>
                </div>

                <div class="pending-card-middle">
                    <div class="unit-alloc-box">
                        <span class="unit-alloc-label">Requested Flat</span>
                        <div class="unit-alloc-badge">
                            <i data-lucide="home"></i>
                            <span class="unit-number-bold">${unitLabel}</span>
                        </div>
                        <span class="unit-meta-sub">Block ${blockName} · Floor ${floorNo}</span>
                    </div>
                </div>

                <div class="pending-card-actions">
                    <button type="button" class="btn-action-approve" data-id="${resident.userId}" data-name="${escapeHtml(resident.name)}" data-unit="${unitLabel}">
                        <i data-lucide="check"></i>
                        <span>Approve Resident</span>
                    </button>
                    <button type="button" class="btn-action-reject" data-id="${resident.userId}" data-name="${escapeHtml(resident.name)}" data-unit="${unitLabel}">
                        <i data-lucide="x"></i>
                        <span>Reject</span>
                    </button>
                </div>
            `;

            container.appendChild(card);
        });

        // Attach action handlers
        container.querySelectorAll('.btn-action-approve').forEach(btn => {
            btn.addEventListener('click', () => handleApproveClick(btn));
        });

        container.querySelectorAll('.btn-action-reject').forEach(btn => {
            btn.addEventListener('click', () => handleRejectClick(btn));
        });

        if (window.lucide) lucide.createIcons({ nodes: [container] });
    }

    // ════════════════════════════════════════════════════════
    // 2. Render Residents Directory Table (Multi-Status)
    // ════════════════════════════════════════════════════════

    function renderActiveTable() {
        const tbody = document.getElementById('active-residents-tbody');
        if (!tbody) return;

        // Select dataset based on active tab
        let dataset = activeResidents;
        let emptyTitle = 'No Approved Residents Yet';
        let emptyDesc = 'When you approve resident signups, they will be listed in this active directory.';

        if (currentTab === 'inactive') {
            dataset = inactiveResidents;
            emptyTitle = 'No Revoked / Inactive Members';
            emptyDesc = 'Residents whose access has been revoked or deactivated will appear here.';
        } else if (currentTab === 'rejected') {
            dataset = rejectedResidents;
            emptyTitle = 'No Rejected Applications';
            emptyDesc = 'Applications that were rejected during verification will appear here.';
        } else if (currentTab === 'all') {
            dataset = allResidents;
            emptyTitle = 'No Residents Found';
            emptyDesc = 'No resident records found in this society.';
        }

        const filtered = dataset.filter(matchesFilter);

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="padding: var(--sp-10) var(--sp-4); text-align: center;">
                        <div class="empty-state" style="padding: 0;">
                            <div class="empty-state-icon">
                                <i data-lucide="${dataset.length === 0 ? 'users' : 'search-x'}"></i>
                            </div>
                            <h4>${dataset.length === 0 ? emptyTitle : 'No Residents Match Filter'}</h4>
                            <p>${dataset.length === 0 ? emptyDesc : `No records found matching "${searchQuery}".`}</p>
                        </div>
                    </td>
                </tr>
            `;
            if (window.lucide) lucide.createIcons({ nodes: [tbody] });
            return;
        }

        tbody.innerHTML = '';
        filtered.forEach(resident => {
            const initial = (resident.name || 'R').charAt(0).toUpperCase();
            const hasUnit = resident.unit && (resident.unit.displayLabel || resident.unit.id);
            const unitLabel = hasUnit ? (resident.unit.displayLabel || `Unit #${resident.unit.id}`) : '—';
            const blockName = hasUnit ? (resident.unit.block || resident.unit.blockName || '--') : '—';
            const floorNo = (hasUnit && resident.unit.floor !== undefined) ? resident.unit.floor : '—';

            // Status Badge Formatting
            let statusBadge = `
                <span class="status-pill status-pill-active">
                    <span class="pulse-dot green"></span>
                    Active
                </span>
            `;

            if (resident.status === 'inactive') {
                statusBadge = `
                    <span class="status-pill" style="background: #ECEFF1; color: #546E7A; border: 1px solid #CFD8DC;">
                        <i data-lucide="user-x" style="width: 12px; margin-right: 4px;"></i>
                        Revoked / Inactive
                    </span>
                `;
            } else if (resident.status === 'rejected') {
                statusBadge = `
                    <span class="status-pill" style="background: #FFEBEE; color: #C62828; border: 1px solid #FFCDD2;">
                        <i data-lucide="user-minus" style="width: 12px; margin-right: 4px;"></i>
                        Rejected
                    </span>
                `;
            } else if (resident.status === 'pending') {
                statusBadge = `
                    <span class="status-pill status-pill-pending">
                        <span class="pulse-dot amber"></span>
                        Pending
                    </span>
                `;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div class="table-user-cell">
                        <div class="resident-avatar-sm">${initial}</div>
                        <div>
                            <div class="table-user-name">${escapeHtml(resident.name)}</div>
                            <div class="table-user-email">${escapeHtml(resident.email)}</div>
                        </div>
                    </div>
                </td>
                <td>
                    ${hasUnit ? `
                        <div class="table-unit-pill">
                            <i data-lucide="home" style="width: 13px;"></i>
                            <span>${unitLabel}</span>
                        </div>
                    ` : `
                        <span style="font-size: 11px; color: var(--clr-text-secondary); background: rgba(0,0,0,0.05); padding: 2px 8px; border-radius: 4px;">Flat Released</span>
                    `}
                </td>
                <td>
                    <span class="table-text-muted">${hasUnit ? `Block ${blockName} · Floor ${floorNo}` : '—'}</span>
                </td>
                <td>
                    <div class="table-contact-cell">
                        ${resident.phone ? `
                            <a href="tel:${escapeHtml(resident.phone)}" class="table-phone-link" title="Call">
                                <i data-lucide="phone"></i>
                                <span>${escapeHtml(resident.phone)}</span>
                            </a>
                        ` : '<span class="table-text-muted">—</span>'}
                    </div>
                </td>
                <td>
                    ${statusBadge}
                </td>
                <td style="text-align: right;">
                    <div style="display: inline-flex; gap: 6px; align-items: center;">
                        <button type="button" class="btn-copy-contact" title="Copy contact info" data-email="${escapeHtml(resident.email)}" data-phone="${escapeHtml(resident.phone || '')}">
                            <i data-lucide="copy" style="width: 13px;"></i>
                            <span>Copy</span>
                        </button>
                        ${resident.status === 'active' ? `
                            <button type="button" class="btn-revoke-resident" title="Revoke resident access & release flat" data-id="${resident.userId}" data-name="${escapeHtml(resident.name)}" data-unit="${unitLabel}" style="background: rgba(198, 40, 40, 0.08); color: #C62828; border: 1px solid rgba(198, 40, 40, 0.2); padding: 4px 10px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s;">
                                <i data-lucide="user-x" style="width: 13px;"></i>
                                <span>Revoke</span>
                            </button>
                        ` : ''}
                    </div>
                </td>
            `;

            tbody.appendChild(tr);
        });

        // Attach copy handlers
        tbody.querySelectorAll('.btn-copy-contact').forEach(btn => {
            btn.addEventListener('click', () => {
                const email = btn.dataset.email;
                const phone = btn.dataset.phone;
                const info = [email, phone].filter(Boolean).join(' | ');
                navigator.clipboard.writeText(info).then(() => {
                    Toast.success('Contact info copied to clipboard!');
                }).catch(() => {
                    Toast.info(`Contact: ${info}`);
                });
            });
        });

        // Attach revoke handlers
        tbody.querySelectorAll('.btn-revoke-resident').forEach(btn => {
            btn.addEventListener('click', () => handleRevokeClick(btn));
        });

        if (window.lucide) lucide.createIcons({ nodes: [tbody] });
    }

    // ════════════════════════════════════════════════════════
    // Revocation Flow (Revoke Modal + Confirmation)
    // ════════════════════════════════════════════════════════

    function handleRevokeClick(btn) {
        targetedRevokeResident = {
            id: btn.dataset.id,
            name: btn.dataset.name,
            unit: btn.dataset.unit || 'Assigned Flat'
        };

        if (revokeModalResidentName) revokeModalResidentName.textContent = targetedRevokeResident.name;
        if (revokeModalResidentUnit) revokeModalResidentUnit.textContent = targetedRevokeResident.unit;

        if (revokeModal) {
            revokeModal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            if (window.lucide) lucide.createIcons({ nodes: [revokeModal] });
        }
    }

    function closeRevokeModal() {
        if (revokeModal) revokeModal.style.display = 'none';
        document.body.style.overflow = '';
        targetedRevokeResident = null;
        if (btnConfirmRevoke) {
            btnConfirmRevoke.disabled = false;
            const txt = btnConfirmRevoke.querySelector('.btn-text');
            if (txt) txt.textContent = 'Confirm Revocation';
        }
    }

    async function handleConfirmRevoke() {
        if (!targetedRevokeResident) return;

        btnConfirmRevoke.disabled = true;
        const txt = btnConfirmRevoke.querySelector('.btn-text');
        if (txt) {
            txt.innerHTML = `<span class="spinner" style="width:14px; height:14px; border-width:2px; vertical-align:middle; display:inline-block;"></span> Revoking...`;
        }

        const { id, name, unit } = targetedRevokeResident;

        try {
            const res = await Api.revokeResident(id);
            if (res.success) {
                Toast.success(`Access revoked for ${name}. Flat ${unit} has been released back to vacant.`);
                closeRevokeModal();
                await loadAllData();
            } else {
                Toast.error(res.message || 'Revocation failed.');
                btnConfirmRevoke.disabled = false;
                if (txt) txt.textContent = 'Confirm Revocation';
            }
        } catch (err) {
            console.error('Revocation error:', err);
            Toast.error('An error occurred during revocation.');
            btnConfirmRevoke.disabled = false;
            if (txt) txt.textContent = 'Confirm Revocation';
        }
    }

    // ════════════════════════════════════════════════════════
    // Approval Flow (Approve Action)
    // ════════════════════════════════════════════════════════

    async function handleApproveClick(btn) {
        const residentId = btn.dataset.id;
        const residentName = btn.dataset.name;
        const unitLabel = btn.dataset.unit;

        btn.disabled = true;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<span class="spinner" style="width:14px; height:14px; border-width:2px; vertical-align:middle; display:inline-block;"></span> Approving...`;

        try {
            const res = await Api.post(`/secretary/residents/${residentId}/approve`);
            if (res.success) {
                Toast.success(`Approved ${residentName} for ${unitLabel}! Account activated.`);

                // Find resident in pending
                const idx = pendingResidents.findIndex(r => r.userId == residentId);
                if (idx !== -1) {
                    const approved = pendingResidents.splice(idx, 1)[0];
                    approved.status = 'active';
                    activeResidents.unshift(approved);
                }

                // Smoothly animate card removal
                const card = document.getElementById(`pending-card-${residentId}`);
                if (card) {
                    card.style.transition = 'all 0.3s ease';
                    card.style.opacity = '0';
                    card.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                        renderPendingList();
                    }, 300);
                } else {
                    renderPendingList();
                }

                // Update metric badges
                updateMetrics(
                    societyBlocks.reduce((acc, b) => acc + (b.floors || []).reduce((facc, f) => facc + (f.units || []).length, 0), 0),
                    activeResidents.length,
                    0
                );
            } else {
                Toast.error(res.message || 'Approval failed.');
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        } catch (err) {
            console.error('Approval error:', err);
            Toast.error('An error occurred while approving resident.');
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }

    // ════════════════════════════════════════════════════════
    // Rejection Flow (Reject Modal + Confirmation)
    // ════════════════════════════════════════════════════════

    function handleRejectClick(btn) {
        targetedRejectResident = {
            id: btn.dataset.id,
            name: btn.dataset.name,
            unit: btn.dataset.unit,
            cardId: `pending-card-${btn.dataset.id}`
        };

        if (modalResidentName) modalResidentName.textContent = targetedRejectResident.name;
        if (modalResidentUnit) modalResidentUnit.textContent = targetedRejectResident.unit;

        rejectModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeRejectModal() {
        rejectModal.style.display = 'none';
        document.body.style.overflow = '';
        targetedRejectResident = null;
        btnConfirmReject.disabled = false;
        btnConfirmReject.querySelector('.btn-text').textContent = 'Confirm Rejection';
    }

    async function handleConfirmReject() {
        if (!targetedRejectResident) return;

        btnConfirmReject.disabled = true;
        btnConfirmReject.querySelector('.btn-text').innerHTML = `<span class="spinner" style="width:14px; height:14px; border-width:2px; vertical-align:middle; display:inline-block;"></span> Rejecting...`;

        const { id, name, unit, cardId } = targetedRejectResident;

        try {
            const res = await Api.post(`/secretary/residents/${id}/reject`);
            if (res.success) {
                Toast.success(`Registration rejected. Flat ${unit} has been released to vacant.`);
                closeRejectModal();

                // Remove from pending
                const idx = pendingResidents.findIndex(r => r.userId == id);
                if (idx !== -1) {
                    pendingResidents.splice(idx, 1);
                }

                // Smoothly animate card removal
                const card = document.getElementById(cardId);
                if (card) {
                    card.style.transition = 'all 0.3s ease';
                    card.style.opacity = '0';
                    card.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                        renderPendingList();
                    }, 300);
                } else {
                    renderPendingList();
                }

                // Refresh structure & metrics in background
                loadAllData();
            } else {
                Toast.error(res.message || 'Rejection failed.');
                btnConfirmReject.disabled = false;
                btnConfirmReject.querySelector('.btn-text').textContent = 'Confirm Rejection';
            }
        } catch (err) {
            console.error('Rejection error:', err);
            Toast.error('An error occurred during rejection.');
            btnConfirmReject.disabled = false;
            btnConfirmReject.querySelector('.btn-text').textContent = 'Confirm Rejection';
        }
    }

    // ════════════════════════════════════════════════════════
    // Utilities
    // ════════════════════════════════════════════════════════

    function formatDate(isoStr) {
        try {
            const date = new Date(isoStr);
            return date.toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
        } catch {
            return isoStr;
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
});
