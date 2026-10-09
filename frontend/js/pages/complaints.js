/**
 * Sahayak — Complaints & Helpdesk Page Controller  (complaints.js)
 * Manages full lifecycle of tickets: Resident reporting, Secretary status workflow,
 * real-time discussion threads, resolution confirmations, and analytics.
 */

document.addEventListener('DOMContentLoaded', async () => {
    'use strict';

    // 1. Guard & Authentication
    const user = await Router.requireAuth(['secretary', 'resident']);
    if (!user) return;

    const isSecretary = user.role === 'secretary';
    const isResident = user.role === 'resident';

    // 2. Initialize Layout
    Components.initSidebar('complaints');
    Components.initTopbar({
        title: isSecretary ? 'Complaints Command Center' : 'Helpdesk & Complaints',
        subtitle: isSecretary ? 'Monitor, update, and resolve society maintenance tickets' : 'Report flat issues, view updates, and verify resolutions'
    });

    // 3. State
    let currentTab = 'all';
    let currentPage = 1;
    let currentCategory = '';
    let currentSearch = '';
    let activeComplaint = null;

    // Real-Time Auto-Sync & Optimistic Chat State (Approach 1)
    let pollIntervalId = null;
    let isPolling = false;
    let lastKnownReplyIds = new Set();

    // 4. DOM References
    const skeleton = document.getElementById('complaints-skeleton');
    const secretaryView = document.getElementById('secretary-view');
    const residentView = document.getElementById('resident-view');

    // Drawer references
    const drawerBackdrop = document.getElementById('drawer-backdrop');
    const btnCloseDrawer = document.getElementById('btn-close-drawer');
    const drawerTitle = document.getElementById('drawer-title');
    const drawerCategoryTag = document.getElementById('drawer-category-tag');
    const drawerStatusPill = document.getElementById('drawer-status-pill');
    const drawerMetaCreated = document.getElementById('drawer-meta-created');
    const drawerMetaUnit = document.getElementById('drawer-meta-unit');
    const drawerMetaResident = document.getElementById('drawer-meta-resident');
    const drawerDescription = document.getElementById('drawer-description');
    const drawerAttachmentBox = document.getElementById('drawer-attachment-box');
    const drawerAttachmentImg = document.getElementById('drawer-attachment-img');
    const drawerPendingClosureAlert = document.getElementById('drawer-pending-closure-alert');
    const threadMessagesList = document.getElementById('thread-messages-list');
    const secDrawerActions = document.getElementById('sec-drawer-actions');
    const resDrawerActions = document.getElementById('res-drawer-actions');
    const replyForm = document.getElementById('reply-form');
    const replyMessage = document.getElementById('reply-message');
    const replyAttachmentUrl = document.getElementById('reply-attachment-url');
    const drawerClosedNotice = document.getElementById('drawer-closed-notice');

    // Secretary specific DOM
    const secContainer = document.getElementById('sec-complaints-container');
    const secComplaintsListView = document.getElementById('sec-complaints-list-view');
    const secAnalyticsView = document.getElementById('sec-analytics-view');
    const secSearchInput = document.getElementById('sec-search-input');
    const secBtnClearSearch = document.getElementById('sec-btn-clear-search');
    const secCategorySelect = document.getElementById('sec-category-select');
    const btnRefreshSec = document.getElementById('btn-refresh-secretary');
    const iconRefreshSec = document.getElementById('icon-refresh-sec');
    const secPagination = document.getElementById('sec-pagination');
    const secPageInfo = document.getElementById('sec-page-info');
    const secBtnPrev = document.getElementById('sec-btn-prev');
    const secBtnNext = document.getElementById('sec-btn-next');

    // Resident specific DOM
    const resContainer = document.getElementById('res-complaints-container');
    const btnOpenRaiseModal = document.getElementById('btn-open-raise-modal');
    const raiseModal = document.getElementById('raise-modal');
    const btnCloseRaiseModal = document.getElementById('btn-close-raise-modal');
    const btnCancelRaise = document.getElementById('btn-cancel-raise');
    const raiseComplaintForm = document.getElementById('raise-complaint-form');
    const complaintCategorySelect = document.getElementById('complaint-category');
    const categoryLabelWrapper = document.getElementById('category-label-wrapper');
    const complaintCategoryLabelInput = document.getElementById('complaint-category-label');
    const resPagination = document.getElementById('res-pagination');
    const resPageInfo = document.getElementById('res-page-info');
    const resBtnPrev = document.getElementById('res-btn-prev');
    const resBtnNext = document.getElementById('res-btn-next');

    // Action Modals
    const confirmResolveModal = document.getElementById('confirm-resolve-modal');
    const btnCloseResolveModal = document.getElementById('btn-close-resolve-modal');
    const btnCancelResolve = document.getElementById('btn-cancel-resolve');
    const btnConfirmResolveAction = document.getElementById('btn-confirm-resolve-action');
    const resolveModalTitle = document.getElementById('resolve-modal-title');
    const resolveFeedback = document.getElementById('resolve-feedback');

    const reopenModal = document.getElementById('reopen-modal');
    const btnCloseReopenModal = document.getElementById('btn-close-reopen-modal');
    const btnCancelReopen = document.getElementById('btn-cancel-reopen');
    const btnConfirmReopenAction = document.getElementById('btn-confirm-reopen-action');
    const reopenModalTitle = document.getElementById('reopen-modal-title');
    const reopenReason = document.getElementById('reopen-reason');

    const rejectComplaintModal = document.getElementById('reject-complaint-modal');
    const btnCloseRejectCompModal = document.getElementById('btn-close-reject-comp-modal');
    const btnCancelRejectComp = document.getElementById('btn-cancel-reject-comp');
    const btnConfirmRejectCompAction = document.getElementById('btn-confirm-reject-comp-action');
    const rejectCompTitle = document.getElementById('reject-comp-title');
    const rejectCompReason = document.getElementById('reject-comp-reason');

    // 5. Initial View Setup
    if (isSecretary) {
        secretaryView.style.display = 'block';
    } else {
        residentView.style.display = 'block';
    }

    // Load initial data
    await loadData();

    // Reveal view and hide skeleton
    if (skeleton) skeleton.style.display = 'none';
    if (window.lucide) lucide.createIcons();

    // Check if URL has hash #raise (e.g., from quick action on resident dashboard)
    if (isResident && window.location.hash === '#raise') {
        openRaiseModal();
    }

    // ════════════════════════════════════════════════════════════
    // Event Listeners: Secretary
    // ════════════════════════════════════════════════════════════
    if (isSecretary) {
        // Tab click
        secretaryView.querySelectorAll('.c-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                secretaryView.querySelectorAll('.c-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentTab = btn.dataset.tab;
                currentPage = 1;

                if (currentTab === 'analytics') {
                    secComplaintsListView.style.display = 'none';
                    secAnalyticsView.style.display = 'block';
                    loadSecretaryAnalytics();
                } else {
                    secAnalyticsView.style.display = 'none';
                    secComplaintsListView.style.display = 'block';
                    loadSecretaryComplaints();
                }
            });
        });

        // Search Input with debounce
        secSearchInput.addEventListener('input', debounce((e) => {
            currentSearch = e.target.value.trim();
            secBtnClearSearch.style.display = currentSearch ? 'flex' : 'none';
            currentPage = 1;
            loadSecretaryComplaints();
        }, 350));

        secBtnClearSearch.addEventListener('click', () => {
            secSearchInput.value = '';
            currentSearch = '';
            secBtnClearSearch.style.display = 'none';
            currentPage = 1;
            loadSecretaryComplaints();
        });

        // Category filter
        secCategorySelect.addEventListener('change', (e) => {
            currentCategory = e.target.value;
            currentPage = 1;
            loadSecretaryComplaints();
        });

        // Refresh
        btnRefreshSec.addEventListener('click', async () => {
            if (iconRefreshSec) iconRefreshSec.classList.add('spin-anim');
            btnRefreshSec.disabled = true;
            if (currentTab === 'analytics') {
                await loadSecretaryAnalytics();
            } else {
                await loadSecretaryComplaints();
            }
            if (iconRefreshSec) iconRefreshSec.classList.remove('spin-anim');
            btnRefreshSec.disabled = false;
        });

        // Pagination
        secBtnPrev.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadSecretaryComplaints();
            }
        });

        secBtnNext.addEventListener('click', () => {
            currentPage++;
            loadSecretaryComplaints();
        });

        // Secretary Action Buttons inside Drawer
        const btnStatusInProgress = document.getElementById('btn-status-in-progress');
        const btnStatusPendingClosure = document.getElementById('btn-status-pending-closure');
        const btnStatusReject = document.getElementById('btn-status-reject');

        if (btnStatusInProgress) {
            btnStatusInProgress.addEventListener('click', () => handleSecretaryStatusChange('in_progress'));
        }
        if (btnStatusPendingClosure) {
            btnStatusPendingClosure.addEventListener('click', () => handleSecretaryStatusChange('pending_closure'));
        }
        if (btnStatusReject) {
            btnStatusReject.addEventListener('click', () => openRejectComplaintModal());
        }
    }

    // ════════════════════════════════════════════════════════════
    // Event Listeners: Resident
    // ════════════════════════════════════════════════════════════
    if (isResident) {
        // Tab click
        residentView.querySelectorAll('.c-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                residentView.querySelectorAll('.c-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentTab = btn.dataset.tab;
                currentPage = 1;
                loadResidentComplaints();
            });
        });

        // Raise Modal triggers
        if (btnOpenRaiseModal) btnOpenRaiseModal.addEventListener('click', openRaiseModal);
        if (btnCloseRaiseModal) btnCloseRaiseModal.addEventListener('click', closeRaiseModal);
        if (btnCancelRaise) btnCancelRaise.addEventListener('click', closeRaiseModal);
        if (raiseModal) {
            raiseModal.addEventListener('click', (e) => {
                if (e.target === raiseModal) closeRaiseModal();
            });
        }

        // Toggle 'other' category custom label input
        if (complaintCategorySelect) {
            complaintCategorySelect.addEventListener('change', (e) => {
                if (e.target.value === 'other') {
                    categoryLabelWrapper.style.display = 'block';
                    complaintCategoryLabelInput.required = true;
                } else {
                    categoryLabelWrapper.style.display = 'none';
                    complaintCategoryLabelInput.required = false;
                    complaintCategoryLabelInput.value = '';
                }
            });
        }

        // Submit new complaint
        if (raiseComplaintForm) {
            raiseComplaintForm.addEventListener('submit', handleRaiseComplaintSubmit);
        }

        // Pagination
        if (resBtnPrev) {
            resBtnPrev.addEventListener('click', () => {
                if (currentPage > 1) {
                    currentPage--;
                    loadResidentComplaints();
                }
            });
        }

        if (resBtnNext) {
            resBtnNext.addEventListener('click', () => {
                currentPage++;
                loadResidentComplaints();
            });
        }

        // Resident Actions inside Drawer
        const btnResidentConfirm = document.getElementById('btn-resident-confirm');
        const btnResidentReopen = document.getElementById('btn-resident-reopen');

        if (btnResidentConfirm) {
            btnResidentConfirm.addEventListener('click', () => openConfirmResolveModal());
        }
        if (btnResidentReopen) {
            btnResidentReopen.addEventListener('click', () => openReopenModal());
        }
    }

    // ════════════════════════════════════════════════════════════
    // Drawer & Shared Thread Listeners
    // ════════════════════════════════════════════════════════════
    if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeComplaintDrawer);
    if (drawerBackdrop) {
        drawerBackdrop.addEventListener('click', (e) => {
            if (e.target === drawerBackdrop) closeComplaintDrawer();
        });
    }

    // Reply form submission & keyboard shortcut
    if (replyForm) {
        replyForm.addEventListener('submit', handleReplySubmit);
    }
    if (replyMessage) {
        replyMessage.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleReplySubmit();
            }
        });
    }

    // Auto-sync immediately when returning to tab
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && activeComplaint && drawerBackdrop && drawerBackdrop.classList.contains('active')) {
            syncComplaintThread(activeComplaint.id);
        }
    });

    // Resolve Modal Events
    if (btnCloseResolveModal) btnCloseResolveModal.addEventListener('click', closeConfirmResolveModal);
    if (btnCancelResolve) btnCancelResolve.addEventListener('click', closeConfirmResolveModal);
    if (confirmResolveModal) {
        confirmResolveModal.addEventListener('click', (e) => {
            if (e.target === confirmResolveModal) closeConfirmResolveModal();
        });
    }
    if (btnConfirmResolveAction) btnConfirmResolveAction.addEventListener('click', handleConfirmResolution);

    // Reopen Modal Events
    if (btnCloseReopenModal) btnCloseReopenModal.addEventListener('click', closeReopenModal);
    if (btnCancelReopen) btnCancelReopen.addEventListener('click', closeReopenModal);
    if (reopenModal) {
        reopenModal.addEventListener('click', (e) => {
            if (e.target === reopenModal) closeReopenModal();
        });
    }
    if (btnConfirmReopenAction) btnConfirmReopenAction.addEventListener('click', handleReopenComplaint);

    // Reject Modal Events (Secretary)
    if (btnCloseRejectCompModal) btnCloseRejectCompModal.addEventListener('click', closeRejectComplaintModal);
    if (btnCancelRejectComp) btnCancelRejectComp.addEventListener('click', closeRejectComplaintModal);
    if (rejectComplaintModal) {
        rejectComplaintModal.addEventListener('click', (e) => {
            if (e.target === rejectComplaintModal) closeRejectComplaintModal();
        });
    }
    if (btnConfirmRejectCompAction) btnConfirmRejectCompAction.addEventListener('click', handleConfirmRejection);

    // Escape key closes open modals/drawer
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeComplaintDrawer();
            closeRaiseModal();
            closeConfirmResolveModal();
            closeReopenModal();
            closeRejectComplaintModal();
        }
    });

    // ════════════════════════════════════════════════════════════
    // Data Loading Functions
    // ════════════════════════════════════════════════════════════
    async function loadData() {
        if (isSecretary) {
            await loadSecretaryComplaints();
        } else {
            await loadResidentComplaints();
        }
    }

    // ── Secretary: Load Complaints ──
    async function loadSecretaryComplaints() {
        try {
            const statusParam = (currentTab === 'all' || currentTab === 'analytics') ? '' : currentTab;
            const res = await Api.getSecretaryComplaints({
                status: statusParam,
                category: currentCategory,
                search: currentSearch,
                page: currentPage,
                limit: 15
            });

            if (!res.success || !res.data) {
                Toast.error(res.message || 'Failed to load society complaints.');
                return;
            }

            const { counts, complaints, pagination } = res.data;

            // Update top metric counts
            updateSecretaryMetrics(counts);

            // Render list
            renderSecretaryComplaints(complaints);

            // Render pagination
            renderPagination(pagination, secPagination, secPageInfo, secBtnPrev, secBtnNext);

        } catch (err) {
            console.error('Error fetching secretary complaints:', err);
            Toast.error('Network error loading complaints.');
        }
    }

    function updateSecretaryMetrics(counts) {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val || 0;
        };

        setVal('sec-stat-total', counts.total);
        setVal('sec-stat-open', counts.open);
        setVal('sec-stat-progress', counts.inProgress);
        setVal('sec-stat-pending-closure', counts.pendingClosure);
        setVal('sec-stat-closed', counts.closed);
        setVal('sec-stat-rejected', counts.rejected);

        // Update badge counts on tabs
        setVal('sec-badge-all', counts.total);
        setVal('sec-badge-open', counts.open);
        setVal('sec-badge-progress', counts.inProgress);
        setVal('sec-badge-closure', counts.pendingClosure);
        setVal('sec-badge-closed', counts.closed);
        setVal('sec-badge-rejected', counts.rejected);
    }

    function renderSecretaryComplaints(complaints) {
        if (!secContainer) return;

        if (!complaints || complaints.length === 0) {
            secContainer.innerHTML = `
                <div class="empty-state" style="padding: var(--sp-12) var(--sp-6);">
                    <div class="empty-state-icon">
                        <i data-lucide="inbox"></i>
                    </div>
                    <h4>No Complaints Found</h4>
                    <p>${currentSearch ? `No complaints match "${currentSearch}".` : 'There are no complaints matching the selected filter.'}</p>
                </div>
            `;
            if (window.lucide) lucide.createIcons({ nodes: [secContainer] });
            return;
        }

        secContainer.innerHTML = '';
        complaints.forEach(c => {
            const card = createComplaintCardElement(c, true);
            secContainer.appendChild(card);
        });

        if (window.lucide) lucide.createIcons({ nodes: [secContainer] });
    }

    // ── Secretary: Load Analytics Tab ──
    async function loadSecretaryAnalytics() {
        try {
            const res = await Api.getComplaintStats();
            if (!res.success || !res.data) {
                Toast.error(res.message || 'Failed to load analytics.');
                return;
            }

            const { summary, byCategory, performance, topUnits } = res.data;

            // Performance numbers
            const avgHoursEl = document.getElementById('stat-avg-hours');
            const avgDaysEl = document.getElementById('stat-avg-days');
            if (avgHoursEl) avgHoursEl.textContent = performance.avgResolutionHours || '0';
            if (avgDaysEl) avgDaysEl.textContent = performance.avgResolutionDays || '0';

            // Category Distribution Bars
            const barsContainer = document.getElementById('category-bars-container');
            if (barsContainer) {
                const totalComp = summary.total || 1;
                const entries = Object.entries(byCategory || {});
                if (entries.length === 0) {
                    barsContainer.innerHTML = '<span style="font-size: 12px; color: var(--clr-text-muted);">No complaint categories recorded yet.</span>';
                } else {
                    barsContainer.innerHTML = entries.map(([cat, count]) => {
                        const pct = Math.round((count / totalComp) * 100);
                        return `
                            <div class="category-bar-row">
                                <div class="category-bar-label">
                                    <span style="text-transform: capitalize;">${cat}</span>
                                    <span>${count} tickets (${pct}%)</span>
                                </div>
                                <div class="category-progress-bg">
                                    <div class="category-progress-fill" style="width: ${pct}%;"></div>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }

            // Top Units
            const topUnitsContainer = document.getElementById('top-units-container');
            if (topUnitsContainer) {
                if (!topUnits || topUnits.length === 0) {
                    topUnitsContainer.innerHTML = '<span style="font-size: 12px; color: var(--clr-text-muted);">No units with logged complaints.</span>';
                } else {
                    topUnitsContainer.innerHTML = topUnits.map(u => `
                        <div style="flex: 1; min-width: 140px; background: var(--clr-surface-dim); border: 1px solid var(--clr-border); border-radius: var(--radius-md); padding: var(--sp-3); text-align: center;">
                            <span style="font-size: 11px; color: var(--clr-text-secondary); display: block;">Flat</span>
                            <strong style="font-size: var(--fs-base); color: var(--clr-primary);">${escapeHtml(u.displayLabel)}</strong>
                            <span style="display: block; font-size: 11px; color: var(--clr-danger); font-weight: 600; margin-top: 4px;">
                                ${u.complaintCount} ${u.complaintCount === 1 ? 'ticket' : 'tickets'}
                            </span>
                        </div>
                    `).join('');
                }
            }

        } catch (err) {
            console.error('Analytics load error:', err);
            Toast.error('Failed to load complaint statistics.');
        }
    }

    // ── Resident: Load Complaints ──
    async function loadResidentComplaints() {
        try {
            const statusParam = currentTab === 'all' ? '' : currentTab;
            const res = await Api.getMyComplaints({
                status: statusParam,
                page: currentPage,
                limit: 15
            });

            if (!res.success || !res.data) {
                Toast.error(res.message || 'Failed to load your complaints.');
                return;
            }

            const { complaints, pagination } = res.data;

            // Compute summary metrics for resident
            updateResidentMetrics(complaints, pagination.total);

            // Render list
            renderResidentComplaints(complaints);

            // Render pagination
            renderPagination(pagination, resPagination, resPageInfo, resBtnPrev, resBtnNext);

        } catch (err) {
            console.error('Error fetching resident complaints:', err);
            Toast.error('Network error loading your complaints.');
        }
    }

    function updateResidentMetrics(complaints, totalCount) {
        const totalEl = document.getElementById('res-stat-total');
        const activeEl = document.getElementById('res-stat-active');
        const closureEl = document.getElementById('res-stat-closure');
        const closedEl = document.getElementById('res-stat-closed');

        if (totalEl) totalEl.textContent = totalCount || 0;

        // Count current page categories as indicator
        let activeCount = 0;
        let closureCount = 0;
        let closedCount = 0;

        (complaints || []).forEach(c => {
            if (c.status === 'open' || c.status === 'in_progress') activeCount++;
            else if (c.status === 'pending_closure') closureCount++;
            else if (c.status === 'closed') closedCount++;
        });

        if (activeEl) activeEl.textContent = activeCount;
        if (closureEl) closureEl.textContent = closureCount;
        if (closedEl) closedEl.textContent = closedCount;
    }

    function renderResidentComplaints(complaints) {
        if (!resContainer) return;

        if (!complaints || complaints.length === 0) {
            resContainer.innerHTML = `
                <div class="empty-state" style="padding: var(--sp-12) var(--sp-6);">
                    <div class="empty-state-icon">
                        <i data-lucide="check-circle-2" style="color: var(--clr-success);"></i>
                    </div>
                    <h4>No Complaints Lodged</h4>
                    <p>You have no tickets matching this filter. Have a maintenance issue in your flat or block?</p>
                    <button type="button" class="btn-raise-complaint" onclick="document.getElementById('btn-open-raise-modal').click();" style="margin-top: var(--sp-4);">
                        <i data-lucide="plus-circle"></i>
                        <span>Raise Maintenance Request</span>
                    </button>
                </div>
            `;
            if (window.lucide) lucide.createIcons({ nodes: [resContainer] });
            return;
        }

        resContainer.innerHTML = '';
        complaints.forEach(c => {
            const card = createComplaintCardElement(c, false);
            resContainer.appendChild(card);
        });

        if (window.lucide) lucide.createIcons({ nodes: [resContainer] });
    }

    // ── Universal Complaint Card Generator ──
    function createComplaintCardElement(c, isSecretaryView) {
        const card = document.createElement('div');
        card.className = 'complaint-card';
        card.id = `complaint-card-${c.id}`;

        const cat = c.category || 'other';
        const catLabel = c.categoryLabel ? `${cat}: ${c.categoryLabel}` : cat;
        const statusClass = `status-pill-${c.status.replace('_', '-')}`;
        const statusLabel = formatStatusLabel(c.status);
        const timeStr = c.createdAt ? timeAgo(c.createdAt) : 'Recently';
        const unitLabel = c.unit ? c.unit.displayLabel : 'Flat';
        const residentName = c.resident ? c.resident.name : (user.name || 'Resident');
        const replyCount = c.replyCount !== undefined ? c.replyCount : 0;

        const iconMap = {
            plumbing: 'droplet',
            electrical: 'zap',
            lift: 'arrow-up-down',
            cleanliness: 'sparkles',
            security: 'shield',
            parking: 'car',
            noise: 'volume-2',
            other: 'alert-circle'
        };

        card.innerHTML = `
            <div class="complaint-card-left">
                <div class="complaint-avatar">
                    <i data-lucide="${iconMap[cat] || 'alert-circle'}"></i>
                </div>
                <div class="complaint-info-block">
                    <div class="complaint-title-row">
                        <span class="category-tag ${cat}">${escapeHtml(catLabel)}</span>
                        <span class="status-pill ${statusClass}">${statusLabel}</span>
                        <span style="font-size: 11px; color: var(--clr-text-muted); font-family: monospace;">#${c.id}</span>
                    </div>
                    <h4 class="complaint-card-title">${escapeHtml(c.title)}</h4>
                    ${c.description ? `<p class="complaint-desc-snippet">${escapeHtml(c.description)}</p>` : ''}
                    <div class="complaint-meta-chips">
                        <span class="complaint-meta-item">
                            <i data-lucide="home" style="width: 12px;"></i>
                            <span>${escapeHtml(unitLabel)}</span>
                        </span>
                        ${isSecretaryView ? `
                            <span class="complaint-meta-item">
                                <i data-lucide="user" style="width: 12px;"></i>
                                <span>${escapeHtml(residentName)}</span>
                            </span>
                        ` : ''}
                        <span class="complaint-meta-item">
                            <i data-lucide="clock" style="width: 12px;"></i>
                            <span>${timeStr}</span>
                        </span>
                        ${c.rejectionReason ? `
                            <span class="complaint-meta-item" style="color: var(--clr-danger);" title="Rejection Reason: ${escapeHtml(c.rejectionReason)}">
                                <i data-lucide="alert-octagon" style="width: 12px;"></i>
                                <span>Rejected</span>
                            </span>
                        ` : ''}
                    </div>
                </div>
            </div>

            <div class="complaint-card-right">
                <button type="button" class="btn-open-thread">
                    <i data-lucide="message-square" style="width: 13px;"></i>
                    <span>Thread ${replyCount > 0 ? `(${replyCount})` : ''}</span>
                </button>
                ${replyCount > 0 ? `
                    <span class="unread-replies-badge">
                        <i data-lucide="messages-square" style="width: 11px;"></i>
                        <span>${replyCount} ${replyCount === 1 ? 'message' : 'messages'}</span>
                    </span>
                ` : ''}
            </div>
        `;

        card.addEventListener('click', () => openComplaintDrawer(c.id));
        return card;
    }

    function formatStatusLabel(st) {
        switch (st) {
            case 'open': return 'Open';
            case 'in_progress': return 'In Progress';
            case 'pending_closure': return 'Pending Closure';
            case 'closed': return 'Closed';
            case 'rejected': return 'Rejected';
            default: return st;
        }
    }

    function renderPagination(pg, container, infoEl, prevBtn, nextBtn) {
        if (!container) return;
        if (pg.totalPages <= 1) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';
        infoEl.textContent = `Page ${pg.page} of ${pg.totalPages} (${pg.total} total)`;
        prevBtn.disabled = pg.page <= 1;
        nextBtn.disabled = pg.page >= pg.totalPages;
    }

    // ════════════════════════════════════════════════════════════
    // Drawer & Discussion Thread (Approach 1: Optimistic + Auto-Sync)
    // ════════════════════════════════════════════════════════════
    async function openComplaintDrawer(complaintId) {
        try {
            // Stop any existing sync loop before opening
            stopThreadAutoSync();

            // Fetch fresh complaint details and thread
            const res = await Api.getComplaintById(complaintId);
            if (!res.success || !res.data) {
                Toast.error(res.message || 'Failed to load complaint details.');
                return;
            }

            const { complaint, thread } = res.data;
            activeComplaint = complaint;

            // Populate header
            drawerTitle.textContent = complaint.title;
            drawerCategoryTag.className = `category-tag ${complaint.category}`;
            drawerCategoryTag.textContent = complaint.categoryLabel ? `${complaint.category}: ${complaint.categoryLabel}` : complaint.category;
            
            drawerStatusPill.className = `status-pill status-pill-${complaint.status.replace('_', '-')}`;
            drawerStatusPill.textContent = formatStatusLabel(complaint.status);

            drawerMetaCreated.textContent = `Raised: ${complaint.createdAt ? formatDateTime(complaint.createdAt) : '--'}`;
            drawerMetaUnit.textContent = complaint.unit ? `Flat ${complaint.unit.displayLabel} (Block ${complaint.unit.blockName})` : 'Flat --';
            drawerMetaResident.textContent = complaint.resident ? `${complaint.resident.name} (${complaint.resident.phone || complaint.resident.email})` : 'Resident';

            drawerDescription.textContent = complaint.description || 'No description provided.';

            // Attachment photo
            if (complaint.attachmentUrl) {
                drawerAttachmentBox.style.display = 'block';
                drawerAttachmentImg.src = complaint.attachmentUrl;
                drawerAttachmentImg.onclick = () => window.open(complaint.attachmentUrl, '_blank');
            } else {
                drawerAttachmentBox.style.display = 'none';
                drawerAttachmentImg.src = '';
            }

            // Status alerts
            if (complaint.status === 'pending_closure' && isResident) {
                drawerPendingClosureAlert.style.display = 'block';
            } else {
                drawerPendingClosureAlert.style.display = 'none';
            }

            // Action bars
            if (isSecretary) {
                secDrawerActions.style.display = 'flex';
                resDrawerActions.style.display = 'none';

                // Toggle visibility based on current status
                const btnStatusInProgress = document.getElementById('btn-status-in-progress');
                const btnStatusPendingClosure = document.getElementById('btn-status-pending-closure');
                const btnStatusReject = document.getElementById('btn-status-reject');

                if (complaint.status === 'open') {
                    if (btnStatusInProgress) btnStatusInProgress.style.display = 'inline-flex';
                    if (btnStatusPendingClosure) btnStatusPendingClosure.style.display = 'inline-flex';
                    if (btnStatusReject) btnStatusReject.style.display = 'inline-flex';
                } else if (complaint.status === 'in_progress') {
                    if (btnStatusInProgress) btnStatusInProgress.style.display = 'none';
                    if (btnStatusPendingClosure) btnStatusPendingClosure.style.display = 'inline-flex';
                    if (btnStatusReject) btnStatusReject.style.display = 'inline-flex';
                } else {
                    // pending_closure, closed, rejected
                    if (btnStatusInProgress) btnStatusInProgress.style.display = 'none';
                    if (btnStatusPendingClosure) btnStatusPendingClosure.style.display = 'none';
                    if (btnStatusReject) btnStatusReject.style.display = 'none';
                }
            } else {
                secDrawerActions.style.display = 'none';
                if (complaint.status === 'pending_closure') {
                    resDrawerActions.style.display = 'flex';
                } else {
                    resDrawerActions.style.display = 'none';
                }
            }

            // Terminal state checks for reply form
            if (complaint.status === 'closed' || complaint.status === 'rejected') {
                replyForm.style.display = 'none';
                drawerClosedNotice.style.display = 'block';
                drawerClosedNotice.textContent = complaint.status === 'closed'
                    ? `🔒 This complaint was closed on ${complaint.closedAt ? formatDate(complaint.closedAt) : 'recent date'}.`
                    : `🚫 This complaint was rejected: "${complaint.rejectionReason || 'No reason provided'}".`;
            } else {
                replyForm.style.display = 'flex';
                drawerClosedNotice.style.display = 'none';
            }

            // Render Thread with initial message set
            renderThreadMessages(thread);

            // Open Drawer
            drawerBackdrop.classList.add('active');
            document.body.style.overflow = 'hidden';
            if (window.lucide) lucide.createIcons({ nodes: [drawerBackdrop] });

            // Start 3-second smart background auto-sync polling
            startThreadAutoSync(complaint.id);

        } catch (err) {
            console.error('Drawer open error:', err);
            Toast.error('Failed to open complaint details.');
        }
    }

    function closeComplaintDrawer() {
        stopThreadAutoSync();
        lastKnownReplyIds.clear();
        if (drawerBackdrop) drawerBackdrop.classList.remove('active');
        document.body.style.overflow = '';
        activeComplaint = null;
        if (replyMessage) replyMessage.value = '';
        if (replyAttachmentUrl) replyAttachmentUrl.value = '';
    }

    // ── Single Message Bubble Creator ──
    function createMessageBubbleElement(msg, isNewArrival = false, isOptimistic = false) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-bubble-wrapper ${msg.senderRole}${isNewArrival ? ' new-arrival' : ''}`;
        if (msg.id) {
            wrapper.id = `msg-${msg.id}`;
            wrapper.dataset.replyId = msg.id;
        }

        const timeStr = msg.createdAt ? timeAgo(msg.createdAt) : 'Just now';
        const isMyRole = (isSecretary && msg.senderRole === 'secretary') || (isResident && msg.senderRole === 'resident');

        if (msg.senderRole === 'system') {
            wrapper.innerHTML = `
                <div class="message-bubble">
                    <span>📢 ${escapeHtml(msg.message)}</span>
                    ${timeStr ? `<span style="font-size: 10px; opacity: 0.7; margin-left: 6px;">· ${timeStr}</span>` : ''}
                </div>
            `;
        } else {
            const isSec = msg.senderRole === 'secretary';
            const tickHtml = isMyRole ? (
                isOptimistic 
                    ? `<span class="message-status-tick pending" id="tick-${msg.id}" title="Sending..."><i data-lucide="clock" style="width: 10px; height: 10px;"></i></span>`
                    : `<span class="message-status-tick delivered" title="Delivered"><i data-lucide="check" style="width: 10px; height: 10px;"></i></span>`
            ) : '';

            wrapper.innerHTML = `
                <div class="message-header">
                    <strong>${escapeHtml(msg.senderName || (isSec ? 'Secretary' : 'Resident'))}</strong>
                    ${isSec ? '<span style="font-size: 10px; background: rgba(242, 212, 184, 0.25); color: var(--clr-primary); padding: 1px 5px; border-radius: 3px;">Official</span>' : ''}
                    <span>· ${timeStr}</span>
                    ${tickHtml}
                </div>
                <div class="message-bubble">
                    ${msg.message ? `<div>${escapeHtml(msg.message)}</div>` : ''}
                    ${msg.attachmentUrl ? `
                        <img src="${escapeHtml(msg.attachmentUrl)}" alt="Attachment" class="message-attachment-img" onclick="window.open('${escapeHtml(msg.attachmentUrl)}', '_blank')">
                    ` : ''}
                </div>
            `;
        }

        return wrapper;
    }

    // ── Append Bubble to Thread ──
    function appendMessageBubble(msg, isNewArrival = false, isOptimistic = false) {
        if (!threadMessagesList) return null;

        // Remove placeholder empty state if present
        const emptyPlaceholder = document.getElementById('thread-empty-placeholder');
        if (emptyPlaceholder) emptyPlaceholder.remove();

        const bubbleEl = createMessageBubbleElement(msg, isNewArrival, isOptimistic);
        threadMessagesList.appendChild(bubbleEl);

        if (window.lucide) {
            lucide.createIcons({ nodes: [bubbleEl] });
        }

        // Smooth scroll to bottom
        const drawerBody = document.getElementById('drawer-body');
        if (drawerBody) {
            drawerBody.scrollTop = drawerBody.scrollHeight;
        }

        return bubbleEl;
    }

    // ── Render Full Initial Thread Messages ──
    function renderThreadMessages(thread) {
        if (!threadMessagesList) return;

        lastKnownReplyIds.clear();

        if (!thread || thread.length === 0) {
            threadMessagesList.innerHTML = `
                <div id="thread-empty-placeholder" style="text-align: center; padding: var(--sp-4); font-size: var(--fs-xs); color: var(--clr-text-muted);">
                    No replies in this thread yet. Send a message below to start communication.
                </div>
            `;
            return;
        }

        threadMessagesList.innerHTML = '';
        thread.forEach(msg => {
            if (msg.id) lastKnownReplyIds.add(Number(msg.id));
            const bubbleEl = createMessageBubbleElement(msg, false, false);
            threadMessagesList.appendChild(bubbleEl);
        });

        if (window.lucide) {
            lucide.createIcons({ nodes: [threadMessagesList] });
        }

        // Scroll to bottom of drawer
        const drawerBody = document.getElementById('drawer-body');
        if (drawerBody) {
            setTimeout(() => {
                drawerBody.scrollTop = drawerBody.scrollHeight;
            }, 60);
        }
    }

    // ── Adaptive Real-Time Auto-Sync (Approach 1) ──
    function startThreadAutoSync(complaintId) {
        stopThreadAutoSync();
        pollIntervalId = setInterval(() => {
            if (drawerBackdrop && drawerBackdrop.classList.contains('active')) {
                syncComplaintThread(complaintId);
            }
        }, 2500);
    }

    function stopThreadAutoSync() {
        if (pollIntervalId) {
            clearInterval(pollIntervalId);
            pollIntervalId = null;
        }
        isPolling = false;
    }

    async function syncComplaintThread(complaintId) {
        if (isPolling) return;
        if (!drawerBackdrop || !drawerBackdrop.classList.contains('active')) return;
        if (!activeComplaint || Number(activeComplaint.id) !== Number(complaintId)) return;

        isPolling = true;
        try {
            const res = await Api.getComplaintById(complaintId);
            if (!res.success || !res.data) return;
            if (!activeComplaint || Number(activeComplaint.id) !== Number(complaintId)) return;

            const { complaint: freshComplaint, thread: freshThread } = res.data;

            // 1. Process thread updates
            if (Array.isArray(freshThread)) {
                let incomingCount = 0;
                for (const msg of freshThread) {
                    const numId = Number(msg.id);
                    if (numId && !lastKnownReplyIds.has(numId)) {
                        // Check if an existing optimistic bubble matches this message
                        const matchingTemp = threadMessagesList.querySelector(`[data-temp-msg="${encodeURIComponent(msg.message || '')}"]`);
                        if (matchingTemp) {
                            matchingTemp.removeAttribute('data-temp-msg');
                            matchingTemp.id = `msg-${numId}`;
                            matchingTemp.dataset.replyId = numId;
                            const tick = matchingTemp.querySelector('.message-status-tick');
                            if (tick) {
                                tick.className = 'message-status-tick delivered';
                                tick.title = 'Delivered';
                                tick.innerHTML = '<i data-lucide="check" style="width: 10px; height: 10px;"></i>';
                                if (window.lucide) lucide.createIcons({ nodes: [tick] });
                            }
                            lastKnownReplyIds.add(numId);
                        } else {
                            // Truly new incoming message from the other party!
                            lastKnownReplyIds.add(numId);
                            appendMessageBubble(msg, true, false);
                            incomingCount++;
                        }
                    }
                }
                if (incomingCount > 0) {
                    updateCardReplyCount(complaintId, freshThread.length, true);
                }
            }

            // 2. Check if status updated in background
            if (freshComplaint && freshComplaint.status !== activeComplaint.status) {
                activeComplaint.status = freshComplaint.status;
                activeComplaint.closedAt = freshComplaint.closedAt;
                activeComplaint.rejectionReason = freshComplaint.rejectionReason;

                if (drawerStatusPill) {
                    drawerStatusPill.className = `status-pill status-pill-${freshComplaint.status.replace('_', '-')}`;
                    drawerStatusPill.textContent = formatStatusLabel(freshComplaint.status);
                }

                if (drawerPendingClosureAlert) {
                    drawerPendingClosureAlert.style.display = (freshComplaint.status === 'pending_closure' && isResident) ? 'block' : 'none';
                }

                if (isSecretary) {
                    const btnStatusInProgress = document.getElementById('btn-status-in-progress');
                    const btnStatusPendingClosure = document.getElementById('btn-status-pending-closure');
                    const btnStatusReject = document.getElementById('btn-status-reject');

                    if (freshComplaint.status === 'open') {
                        if (btnStatusInProgress) btnStatusInProgress.style.display = 'inline-flex';
                        if (btnStatusPendingClosure) btnStatusPendingClosure.style.display = 'inline-flex';
                        if (btnStatusReject) btnStatusReject.style.display = 'inline-flex';
                    } else if (freshComplaint.status === 'in_progress') {
                        if (btnStatusInProgress) btnStatusInProgress.style.display = 'none';
                        if (btnStatusPendingClosure) btnStatusPendingClosure.style.display = 'inline-flex';
                        if (btnStatusReject) btnStatusReject.style.display = 'inline-flex';
                    } else {
                        if (btnStatusInProgress) btnStatusInProgress.style.display = 'none';
                        if (btnStatusPendingClosure) btnStatusPendingClosure.style.display = 'none';
                        if (btnStatusReject) btnStatusReject.style.display = 'none';
                    }
                } else if (isResident) {
                    if (resDrawerActions) {
                        resDrawerActions.style.display = freshComplaint.status === 'pending_closure' ? 'flex' : 'none';
                    }
                }

                if (freshComplaint.status === 'closed' || freshComplaint.status === 'rejected') {
                    if (replyForm) replyForm.style.display = 'none';
                    if (drawerClosedNotice) {
                        drawerClosedNotice.style.display = 'block';
                        drawerClosedNotice.textContent = freshComplaint.status === 'closed'
                            ? `🔒 This complaint was closed on ${freshComplaint.closedAt ? formatDate(freshComplaint.closedAt) : 'recent date'}.`
                            : `🚫 This complaint was rejected: "${freshComplaint.rejectionReason || 'No reason provided'}".`;
                    }
                }

                Toast.info(`Complaint status updated: ${formatStatusLabel(freshComplaint.status)}`);

                if (isSecretary) loadSecretaryComplaints();
                else loadResidentComplaints();
            }

        } catch (e) {
            // Silently swallow polling errors
        } finally {
            isPolling = false;
        }
    }

    // ── Helper to update card reply count in background list ──
    function updateCardReplyCount(complaintId, countOrDelta, isAbsolute = false) {
        const card = document.getElementById(`complaint-card-${complaintId}`);
        if (!card) return;

        const threadBtnSpan = card.querySelector('.btn-open-thread span');
        let unreadBadge = card.querySelector('.unread-replies-badge');

        let currentCount = 0;
        if (threadBtnSpan) {
            const match = threadBtnSpan.textContent.match(/\((\d+)\)/);
            if (match) currentCount = parseInt(match[1], 10);
        }

        const newCount = isAbsolute ? countOrDelta : (currentCount + countOrDelta);
        if (newCount > 0) {
            if (threadBtnSpan) threadBtnSpan.textContent = `Thread (${newCount})`;
            if (unreadBadge) {
                const badgeText = unreadBadge.querySelector('span');
                if (badgeText) badgeText.textContent = `${newCount} ${newCount === 1 ? 'message' : 'messages'}`;
            } else {
                const rightCol = card.querySelector('.complaint-card-right');
                if (rightCol) {
                    const badge = document.createElement('span');
                    badge.className = 'unread-replies-badge';
                    badge.innerHTML = `<i data-lucide="messages-square" style="width: 11px;"></i><span>${newCount} ${newCount === 1 ? 'message' : 'messages'}</span>`;
                    rightCol.appendChild(badge);
                    if (window.lucide) lucide.createIcons({ nodes: [badge] });
                }
            }
        }
    }

    // ── Handle Reply Submission (Optimistic UI + Background Dispatch) ──
    async function handleReplySubmit(e) {
        if (e && e.preventDefault) e.preventDefault();
        if (!activeComplaint) return;

        const message = replyMessage.value.trim();
        const attachment_url = replyAttachmentUrl.value.trim();

        if (!message && !attachment_url) {
            Toast.warning('Please enter a message or provide an image attachment.');
            return;
        }

        // 1. Optimistic UI update (0ms lag!)
        const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        const optimisticMsg = {
            id: tempId,
            senderId: user.id || user.userId,
            senderRole: user.role,
            senderName: user.name || (isSecretary ? 'Secretary' : 'Resident'),
            message: message,
            attachmentUrl: attachment_url,
            createdAt: new Date().toISOString()
        };

        // Reset input immediately for instant responsiveness
        replyMessage.value = '';
        replyAttachmentUrl.value = '';
        replyMessage.focus();

        // Render bubble optimistically with slide-in animation & pending tick
        const bubbleEl = appendMessageBubble(optimisticMsg, true, true);
        if (bubbleEl) {
            bubbleEl.dataset.tempMsg = encodeURIComponent(message || '');
        }

        // 2. Dispatch to backend in background
        try {
            const res = await Api.addComplaintReply(activeComplaint.id, {
                message: message || undefined,
                attachment_url: attachment_url || undefined
            });

            const tickEl = document.getElementById(`tick-${tempId}`);
            const el = document.getElementById(`msg-${tempId}`);

            if (res.success && res.data) {
                const realId = Number(res.data.replyId);
                lastKnownReplyIds.add(realId);

                if (el) {
                    el.removeAttribute('data-temp-msg');
                    el.id = `msg-${realId}`;
                    el.dataset.replyId = realId;
                }

                if (tickEl) {
                    tickEl.id = `tick-${realId}`;
                    tickEl.className = 'message-status-tick delivered';
                    tickEl.title = 'Delivered';
                    tickEl.innerHTML = '<i data-lucide="check" style="width: 10px; height: 10px;"></i>';
                    if (window.lucide) lucide.createIcons({ nodes: [tickEl] });
                }

                updateCardReplyCount(activeComplaint.id, 1, false);
            } else {
                if (tickEl) {
                    tickEl.className = 'message-status-tick error';
                    tickEl.title = 'Delivery failed: ' + (res.message || 'Error');
                    tickEl.innerHTML = '<i data-lucide="alert-circle" style="width: 10px; height: 10px;"></i> Failed';
                    if (window.lucide) lucide.createIcons({ nodes: [tickEl] });
                }
                Toast.error(res.message || 'Failed to send reply.');
            }
        } catch (err) {
            console.error('Send reply error:', err);
            const tickEl = document.getElementById(`tick-${tempId}`);
            if (tickEl) {
                tickEl.className = 'message-status-tick error';
                tickEl.title = 'Network error sending reply';
                tickEl.innerHTML = '<i data-lucide="alert-circle" style="width: 10px; height: 10px;"></i> Failed';
                if (window.lucide) lucide.createIcons({ nodes: [tickEl] });
            }
            Toast.error('Network error sending reply.');
        }
    }

    // ════════════════════════════════════════════════════════════
    // Raise Complaint Modal & Form (Resident)
    // ════════════════════════════════════════════════════════════
    function openRaiseModal() {
        if (raiseModal) {
            raiseModal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            if (window.lucide) lucide.createIcons({ nodes: [raiseModal] });
            const titleInput = document.getElementById('complaint-title');
            if (titleInput) titleInput.focus();
        }
    }

    function closeRaiseModal() {
        if (raiseModal) raiseModal.style.display = 'none';
        document.body.style.overflow = '';
        if (raiseComplaintForm) raiseComplaintForm.reset();
        if (categoryLabelWrapper) categoryLabelWrapper.style.display = 'none';
        if (window.location.hash === '#raise') {
            history.replaceState(null, '', window.location.pathname);
        }
    }

    async function handleRaiseComplaintSubmit(e) {
        e.preventDefault();

        const title = document.getElementById('complaint-title').value.trim();
        const category = document.getElementById('complaint-category').value;
        const category_label = document.getElementById('complaint-category-label').value.trim();
        const description = document.getElementById('complaint-description').value.trim();
        const attachment_url = document.getElementById('complaint-attachment').value.trim();

        if (title.length < 3 || title.length > 200) {
            Toast.warning('Title must be between 3 and 200 characters.');
            return;
        }

        if (description.length < 10) {
            Toast.warning('Description must be at least 10 characters.');
            return;
        }

        if (category === 'other' && category_label.length < 2) {
            Toast.warning('Please specify your custom category.');
            return;
        }

        const submitBtn = document.getElementById('btn-submit-raise');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.querySelector('.btn-text').innerHTML = `<span class="spinner" style="width:14px; height:14px; border-width:2px; vertical-align:middle; display:inline-block;"></span> Submitting...`;
        }

        try {
            const payload = {
                title,
                category,
                category_label: category === 'other' ? category_label : undefined,
                description,
                attachment_url: attachment_url || undefined
            };

            const res = await Api.createComplaint(payload);

            if (res.success && res.data) {
                Toast.success(`Complaint #${res.data.complaintId} submitted successfully!`);
                closeRaiseModal();
                currentTab = 'all';
                currentPage = 1;
                await loadResidentComplaints();
            } else {
                Toast.error(res.message || 'Failed to submit complaint.');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.querySelector('.btn-text').textContent = 'Submit Complaint';
                }
            }
        } catch (err) {
            console.error('Raise complaint error:', err);
            Toast.error('An unexpected error occurred.');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.querySelector('.btn-text').textContent = 'Submit Complaint';
            }
        }
    }

    // ════════════════════════════════════════════════════════════
    // Confirm Resolution Workflow (Resident)
    // ════════════════════════════════════════════════════════════
    function openConfirmResolveModal() {
        if (!activeComplaint) return;
        if (resolveModalTitle) resolveModalTitle.textContent = activeComplaint.title;
        if (resolveFeedback) resolveFeedback.value = '';
        if (confirmResolveModal) {
            confirmResolveModal.style.display = 'flex';
            if (window.lucide) lucide.createIcons({ nodes: [confirmResolveModal] });
        }
    }

    function closeConfirmResolveModal() {
        if (confirmResolveModal) confirmResolveModal.style.display = 'none';
        if (btnConfirmResolveAction) {
            btnConfirmResolveAction.disabled = false;
            btnConfirmResolveAction.querySelector('.btn-text').textContent = 'Confirm & Close Ticket';
        }
    }

    async function handleConfirmResolution() {
        if (!activeComplaint) return;

        const feedback = resolveFeedback.value.trim();
        if (btnConfirmResolveAction) {
            btnConfirmResolveAction.disabled = true;
            btnConfirmResolveAction.querySelector('.btn-text').innerHTML = `<span class="spinner" style="width:14px; height:14px; border-width:2px; vertical-align:middle; display:inline-block;"></span> Closing...`;
        }

        try {
            const res = await Api.confirmComplaintResolution(activeComplaint.id, feedback);
            if (res.success) {
                Toast.success('Thank you! Complaint verified resolved and closed.');
                closeConfirmResolveModal();
                closeComplaintDrawer();
                await loadResidentComplaints();
            } else {
                Toast.error(res.message || 'Failed to confirm resolution.');
                if (btnConfirmResolveAction) {
                    btnConfirmResolveAction.disabled = false;
                    btnConfirmResolveAction.querySelector('.btn-text').textContent = 'Confirm & Close Ticket';
                }
            }
        } catch (err) {
            console.error('Confirm resolve error:', err);
            Toast.error('An error occurred during confirmation.');
            if (btnConfirmResolveAction) {
                btnConfirmResolveAction.disabled = false;
                btnConfirmResolveAction.querySelector('.btn-text').textContent = 'Confirm & Close Ticket';
            }
        }
    }

    // ════════════════════════════════════════════════════════════
    // Reopen Complaint Workflow (Resident)
    // ════════════════════════════════════════════════════════════
    function openReopenModal() {
        if (!activeComplaint) return;
        if (reopenModalTitle) reopenModalTitle.textContent = activeComplaint.title;
        if (reopenReason) reopenReason.value = '';
        if (reopenModal) {
            reopenModal.style.display = 'flex';
            if (window.lucide) lucide.createIcons({ nodes: [reopenModal] });
        }
    }

    function closeReopenModal() {
        if (reopenModal) reopenModal.style.display = 'none';
        if (btnConfirmReopenAction) {
            btnConfirmReopenAction.disabled = false;
            btnConfirmReopenAction.querySelector('.btn-text').textContent = 'Reopen Ticket';
        }
    }

    async function handleReopenComplaint() {
        if (!activeComplaint) return;

        const reason = reopenReason.value.trim();
        if (reason.length < 5) {
            Toast.warning('Please provide a specific reason (min 5 characters).');
            return;
        }

        if (btnConfirmReopenAction) {
            btnConfirmReopenAction.disabled = true;
            btnConfirmReopenAction.querySelector('.btn-text').innerHTML = `<span class="spinner" style="width:14px; height:14px; border-width:2px; vertical-align:middle; display:inline-block;"></span> Reopening...`;
        }

        try {
            const res = await Api.reopenComplaint(activeComplaint.id, reason);
            if (res.success) {
                Toast.success('Complaint reopened and moved back to In Progress.');
                closeReopenModal();
                closeComplaintDrawer();
                await loadResidentComplaints();
            } else {
                Toast.error(res.message || 'Failed to reopen complaint.');
                if (btnConfirmReopenAction) {
                    btnConfirmReopenAction.disabled = false;
                    btnConfirmReopenAction.querySelector('.btn-text').textContent = 'Reopen Ticket';
                }
            }
        } catch (err) {
            console.error('Reopen error:', err);
            Toast.error('An error occurred during reopen.');
            if (btnConfirmReopenAction) {
                btnConfirmReopenAction.disabled = false;
                btnConfirmReopenAction.querySelector('.btn-text').textContent = 'Reopen Ticket';
            }
        }
    }

    // ════════════════════════════════════════════════════════════
    // Secretary Status Advance Workflow
    // ════════════════════════════════════════════════════════════
    async function handleSecretaryStatusChange(targetStatus) {
        if (!activeComplaint) return;

        const confirmMsg = targetStatus === 'pending_closure'
            ? 'Mark this complaint as Pending Closure? The resident will be requested to verify resolution.'
            : 'Mark this complaint as In Progress?';

        if (!confirm(confirmMsg)) return;

        try {
            const res = await Api.updateComplaintStatus(activeComplaint.id, { status: targetStatus });
            if (res.success) {
                Toast.success(`Complaint status moved to ${formatStatusLabel(targetStatus)}.`);
                await openComplaintDrawer(activeComplaint.id);
                loadSecretaryComplaints();
            } else {
                Toast.error(res.message || 'Failed to update status.');
            }
        } catch (err) {
            console.error('Status update error:', err);
            Toast.error('An error occurred updating status.');
        }
    }

    // ════════════════════════════════════════════════════════════
    // Secretary Reject Complaint Workflow
    // ════════════════════════════════════════════════════════════
    function openRejectComplaintModal() {
        if (!activeComplaint) return;
        if (rejectCompTitle) rejectCompTitle.textContent = activeComplaint.title;
        if (rejectCompReason) rejectCompReason.value = '';
        if (rejectComplaintModal) {
            rejectComplaintModal.style.display = 'flex';
            if (window.lucide) lucide.createIcons({ nodes: [rejectComplaintModal] });
        }
    }

    function closeRejectComplaintModal() {
        if (rejectComplaintModal) rejectComplaintModal.style.display = 'none';
        if (btnConfirmRejectCompAction) {
            btnConfirmRejectCompAction.disabled = false;
            btnConfirmRejectCompAction.querySelector('.btn-text').textContent = 'Confirm Rejection';
        }
    }

    async function handleConfirmRejection() {
        if (!activeComplaint) return;

        const reason = rejectCompReason.value.trim();
        if (reason.length < 5) {
            Toast.warning('Official rejection reason is required (min 5 characters).');
            return;
        }

        if (btnConfirmRejectCompAction) {
            btnConfirmRejectCompAction.disabled = true;
            btnConfirmRejectCompAction.querySelector('.btn-text').innerHTML = `<span class="spinner" style="width:14px; height:14px; border-width:2px; vertical-align:middle; display:inline-block;"></span> Rejecting...`;
        }

        try {
            const res = await Api.updateComplaintStatus(activeComplaint.id, {
                status: 'rejected',
                rejection_reason: reason
            });

            if (res.success) {
                Toast.success('Complaint rejected and closed with official reason.');
                closeRejectComplaintModal();
                closeComplaintDrawer();
                loadSecretaryComplaints();
            } else {
                Toast.error(res.message || 'Failed to reject complaint.');
                if (btnConfirmRejectCompAction) {
                    btnConfirmRejectCompAction.disabled = false;
                    btnConfirmRejectCompAction.querySelector('.btn-text').textContent = 'Confirm Rejection';
                }
            }
        } catch (err) {
            console.error('Reject complaint error:', err);
            Toast.error('An error occurred during rejection.');
            if (btnConfirmRejectCompAction) {
                btnConfirmRejectCompAction.disabled = false;
                btnConfirmRejectCompAction.querySelector('.btn-text').textContent = 'Confirm Rejection';
            }
        }
    }

    // Helper: HTML escape
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
});
