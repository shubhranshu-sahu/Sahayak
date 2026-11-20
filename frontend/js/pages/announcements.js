/**
 * Sahayak — Announcements & Digital Notice Board Page Controller (announcements.js)
 * Manages Secretary broadcast console, dynamic target resolution, read receipts roster,
 * and Resident personalized notice board with automatic read dispatching.
 */

document.addEventListener('DOMContentLoaded', async () => {
    'use strict';

    // 1. Guard check: Require authentication for secretary or resident
    const user = await Router.requireAuth(['secretary', 'resident']);
    if (!user) return;

    const isResident = user.role === 'resident';

    // 2. Initialize Shared Components
    Components.initSidebar('announcements');
    Components.initTopbar({
        title: isResident ? 'Notice Board' : 'Announcements',
        subtitle: isResident
            ? `Flat ${user.unit ? user.unit.displayLabel : '--'} · Society Bulletins`
            : `${(user.society && user.society.name) || 'My Society'} · Broadcast Console`,
    });

    // 3. Hide skeleton and show respective view
    const skeleton = document.getElementById('announcements-skeleton');
    if (skeleton) skeleton.style.display = 'none';

    if (isResident) {
        const resView = document.getElementById('resident-view');
        if (resView) resView.style.display = 'block';
        initResidentView(user);
    } else {
        const secView = document.getElementById('secretary-view');
        if (secView) secView.style.display = 'block';
        initSecretaryView(user);
    }

    if (window.lucide) {
        lucide.createIcons();
    }
});

let globalStructure = null;
let globalResidents = [];

/* ════════════════════════════════════════════════════════════════
   SECRETARY MODULE
   ════════════════════════════════════════════════════════════════ */
function initSecretaryView(user) {
    let currentStatus = 'active'; // 'active' | 'expired' | 'all'
    let currentCategory = '';
    let currentPriority = '';
    let currentTargetType = '';
    let currentPage = 1;
    const limit = 20;

    let societyStructure = null;
    let activeResidents = [];
    let pendingDeleteAction = null; // { type: 'single' | 'bulk', id: null }

    // DOM Elements
    const listContainer = document.getElementById('sec-announcements-list');
    const paginationContainer = document.getElementById('sec-pagination');
    const tabActive = document.getElementById('sec-tab-active');
    const tabExpired = document.getElementById('sec-tab-expired');
    const tabAll = document.getElementById('sec-tab-all');
    const filterCategory = document.getElementById('sec-filter-category');
    const filterPriority = document.getElementById('sec-filter-priority');
    const filterTarget = document.getElementById('sec-filter-target');
    const btnRefresh = document.getElementById('btn-sec-refresh');
    const btnNewAnnouncement = document.getElementById('btn-sec-new-announcement');
    const btnCleanExpired = document.getElementById('btn-sec-clean-expired');

    // Stats Elements
    const statActive = document.getElementById('sec-stat-active');
    const statExpired = document.getElementById('sec-stat-expired');
    const statTotal = document.getElementById('sec-stat-total');
    const badgeActive = document.getElementById('sec-badge-active');
    const badgeExpired = document.getElementById('sec-badge-expired');
    const badgeAll = document.getElementById('sec-badge-all');

    // Create Modal Elements
    const createModal = document.getElementById('modal-create-announcement');
    const btnCloseCreate = document.getElementById('btn-close-create-modal');
    const btnCancelCreate = document.getElementById('btn-cancel-create');
    const formCreate = document.getElementById('form-create-announcement');
    const targetTypeSelect = document.getElementById('ann-select-target-type');
    const targetDetailsContainer = document.getElementById('target-details-container');
    const targetBlockPicker = document.getElementById('target-block-picker');
    const targetFloorPicker = document.getElementById('target-floor-picker');
    const targetUnitPicker = document.getElementById('target-unit-picker');
    const targetUserPicker = document.getElementById('target-user-picker');
    const targetRolePicker = document.getElementById('target-role-picker');
    const targetBlockSelect = document.getElementById('ann-target-block');
    const targetFloorBlockSelect = document.getElementById('ann-target-floor-block');
    const targetFloorSelect = document.getElementById('ann-target-floor');
    const targetUnitSelect = document.getElementById('ann-target-unit');
    const targetUserSelect = document.getElementById('ann-target-user');
    const targetRoleSelect = document.getElementById('ann-target-role');
    const inputExpires = document.getElementById('ann-input-expires');
    const textareaContent = document.getElementById('ann-textarea-content');
    const charCounter = document.getElementById('char-counter');

    // Details Modal Elements
    const detailModal = document.getElementById('modal-announcement-details');
    const btnCloseDetail = document.getElementById('btn-close-detail-modal');
    const btnCloseDetailBottom = document.getElementById('btn-close-detail-bottom');

    // Delete Modal Elements
    const deleteModal = document.getElementById('modal-delete-confirm');
    const btnCloseDelete = document.getElementById('btn-close-delete-modal');
    const btnCancelDelete = document.getElementById('btn-cancel-delete');
    const btnConfirmDelete = document.getElementById('btn-confirm-delete');

    // ── Initial Data Load ──
    loadSecretaryAnnouncements();
    preloadTargetingMetadata();

    // ── Event Listeners ──
    if (tabActive) tabActive.addEventListener('click', () => switchTab('active'));
    if (tabExpired) tabExpired.addEventListener('click', () => switchTab('expired'));
    if (tabAll) tabAll.addEventListener('click', () => switchTab('all'));

    if (filterCategory) filterCategory.addEventListener('change', (e) => {
        currentCategory = e.target.value;
        currentPage = 1;
        loadSecretaryAnnouncements();
    });

    if (filterPriority) filterPriority.addEventListener('change', (e) => {
        currentPriority = e.target.value;
        currentPage = 1;
        loadSecretaryAnnouncements();
    });

    if (filterTarget) filterTarget.addEventListener('change', (e) => {
        currentTargetType = e.target.value;
        currentPage = 1;
        loadSecretaryAnnouncements();
    });

    if (btnRefresh) btnRefresh.addEventListener('click', () => {
        rotateRefreshIcon('icon-refresh-sec');
        loadSecretaryAnnouncements();
    });

    // Create Modal Listeners
    if (btnNewAnnouncement) btnNewAnnouncement.addEventListener('click', openCreateModal);
    if (btnCloseCreate) btnCloseCreate.addEventListener('click', closeCreateModal);
    if (btnCancelCreate) btnCancelCreate.addEventListener('click', closeCreateModal);

    if (targetTypeSelect) targetTypeSelect.addEventListener('change', handleTargetTypeChange);
    if (targetFloorBlockSelect) targetFloorBlockSelect.addEventListener('change', handleFloorBlockChange);

    // Preset expiry chips
    document.querySelectorAll('.preset-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const hours = parseInt(chip.dataset.hours, 10);
            if (hours) {
                const date = new Date(Date.now() + hours * 3600 * 1000);
                inputExpires.value = formatForDateTimeLocal(date);
            }
        });
    });

    // Content char counter
    if (textareaContent && charCounter) {
        textareaContent.addEventListener('input', () => {
            charCounter.textContent = `${textareaContent.value.length} / 5000`;
        });
    }

    if (formCreate) formCreate.addEventListener('submit', handleCreateSubmit);

    // Details Modal Listeners
    if (btnCloseDetail) btnCloseDetail.addEventListener('click', closeDetailModal);
    if (btnCloseDetailBottom) btnCloseDetailBottom.addEventListener('click', closeDetailModal);

    // Delete Modal Listeners
    if (btnCloseDelete) btnCloseDelete.addEventListener('click', closeDeleteModal);
    if (btnCancelDelete) btnCancelDelete.addEventListener('click', closeDeleteModal);
    if (btnConfirmDelete) btnConfirmDelete.addEventListener('click', handleConfirmDelete);

    if (btnCleanExpired) {
        btnCleanExpired.addEventListener('click', () => {
            pendingDeleteAction = { type: 'bulk', id: null };
            document.getElementById('delete-modal-title').textContent = 'Bulk Clean Expired Notices?';
            document.getElementById('delete-modal-text').textContent =
                'Are you sure you want to soft-delete all expired announcements in the society? Active notices will remain untouched.';
            document.getElementById('delete-btn-label').textContent = 'Clean All Expired';
            deleteModal.classList.add('active');
        });
    }

    // ── Functions ──

    function switchTab(status) {
        currentStatus = status;
        currentPage = 1;

        [tabActive, tabExpired, tabAll].forEach(t => t.classList.remove('active'));
        if (status === 'active') tabActive.classList.add('active');
        else if (status === 'expired') tabExpired.classList.add('active');
        else if (status === 'all') tabAll.classList.add('active');

        loadSecretaryAnnouncements();
    }

    async function preloadTargetingMetadata() {
        try {
            const [structRes, resRes] = await Promise.all([
                Api.getSocietyStructure(),
                Api.getActiveResidents(),
            ]);

            if (structRes.success && structRes.data) {
                societyStructure = structRes.data;
                globalStructure = structRes.data;
                populateBlockDropdowns();
            }
            if (resRes.success && Array.isArray(resRes.data)) {
                activeResidents = resRes.data;
                globalResidents = resRes.data;
                populateResidentDropdown();
            }
        } catch (err) {
            console.warn('[Announcements] Preload metadata warning:', err);
        }
    }

    function populateBlockDropdowns() {
        if (!societyStructure || !Array.isArray(societyStructure.blocks)) return;

        // Block options
        targetBlockSelect.innerHTML = '<option value="">-- Choose Block --</option>';
        targetFloorBlockSelect.innerHTML = '<option value="">-- Choose Block --</option>';
        targetUnitSelect.innerHTML = '<option value="">-- Choose Unit --</option>';

        societyStructure.blocks.forEach(block => {
            const blockName = block.blockName || block.block_name || `Block ${block.id}`;
            const opt1 = document.createElement('option');
            opt1.value = block.id;
            opt1.textContent = `Block ${blockName}`;
            targetBlockSelect.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = block.id;
            opt2.textContent = `Block ${blockName}`;
            targetFloorBlockSelect.appendChild(opt2);

            // Units
            if (Array.isArray(block.floors)) {
                block.floors.forEach(fl => {
                    const floorNo = fl.floorNumber !== undefined ? fl.floorNumber : (fl.floor_number !== undefined ? fl.floor_number : fl.id);
                    if (Array.isArray(fl.units)) {
                        fl.units.forEach(u => {
                            const uOpt = document.createElement('option');
                            uOpt.value = u.id;
                            const unitLabel = u.displayLabel || u.display_label || `${blockName}-${u.unitNumber || u.unit_number || u.id}`;
                            uOpt.textContent = `Unit ${unitLabel} (Floor ${floorNo})`;
                            targetUnitSelect.appendChild(uOpt);
                        });
                    }
                });
            }
        });
    }

    function handleFloorBlockChange() {
        const blockId = parseInt(targetFloorBlockSelect.value, 10);
        targetFloorSelect.innerHTML = '<option value="">-- Choose Floor --</option>';
        if (!blockId || !societyStructure) return;

        const block = societyStructure.blocks.find(b => b.id === blockId);
        if (block && Array.isArray(block.floors)) {
            block.floors.forEach(fl => {
                const floorNo = fl.floorNumber !== undefined ? fl.floorNumber : (fl.floor_number !== undefined ? fl.floor_number : fl.id);
                const fOpt = document.createElement('option');
                fOpt.value = fl.id;
                fOpt.textContent = `Floor ${floorNo}`;
                targetFloorSelect.appendChild(fOpt);
            });
        }
    }

    function populateResidentDropdown() {
        targetUserSelect.innerHTML = '<option value="">-- Choose Active Resident --</option>';
        activeResidents.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id;
            const flat = r.displayLabel || r.unitLabel || r.unitNumber || (r.unit ? (r.unit.displayLabel || r.unit.unitNumber) : 'Unit');
            opt.textContent = `${r.name} (${flat})`;
            targetUserSelect.appendChild(opt);
        });
    }

    function handleTargetTypeChange() {
        const type = targetTypeSelect.value;
        targetDetailsContainer.style.display = type === 'all' ? 'none' : 'block';

        targetBlockPicker.style.display = type === 'block' ? 'block' : 'none';
        targetFloorPicker.style.display = type === 'floor' ? 'block' : 'none';
        targetUnitPicker.style.display = type === 'unit' ? 'block' : 'none';
        targetUserPicker.style.display = type === 'user' ? 'block' : 'none';
        targetRolePicker.style.display = type === 'role' ? 'block' : 'none';
    }

    async function loadSecretaryAnnouncements() {
        listContainer.innerHTML = `
            <div style="text-align: center; padding: var(--sp-8); color: var(--clr-text-secondary);">
                <i data-lucide="loader" class="animate-spin" style="width: 32px; height: 32px; margin: 0 auto var(--sp-2);"></i>
                <p>Loading announcements...</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();

        try {
            const params = {
                status: currentStatus,
                page: currentPage,
                limit,
            };
            if (currentCategory) params.category = currentCategory;
            if (currentPriority) params.priority = currentPriority;
            if (currentTargetType) params.target_type = currentTargetType;

            const res = await Api.listAnnouncements(params);

            if (res.success && res.data) {
                const { summary = {}, announcements = [], pagination = {} } = res.data;

                // Update metric cards
                if (statActive) statActive.textContent = summary.total_active || 0;
                if (statExpired) statExpired.textContent = summary.total_expired || 0;
                if (statTotal) statTotal.textContent = summary.total_all || 0;
                if (badgeActive) badgeActive.textContent = summary.total_active || 0;
                if (badgeExpired) badgeExpired.textContent = summary.total_expired || 0;
                if (badgeAll) badgeAll.textContent = summary.total_all || 0;

                renderSecretaryCards(announcements);
                renderPagination(pagination);
            } else {
                listContainer.innerHTML = `
                    <div class="announcements-empty">
                        <div class="empty-icon"><i data-lucide="alert-circle"></i></div>
                        <h4 class="empty-title">Failed to Load Notices</h4>
                        <p class="empty-desc">${res.message || 'Server returned an error'}</p>
                    </div>
                `;
            }
        } catch (err) {
            console.error('[Announcements] loadSecretaryAnnouncements error:', err);
            listContainer.innerHTML = `
                <div class="announcements-empty">
                    <div class="empty-icon"><i data-lucide="wifi-off"></i></div>
                    <h4 class="empty-title">Network Error</h4>
                    <p class="empty-desc">Could not connect to the server. Please check your network.</p>
                </div>
            `;
        }
        if (window.lucide) lucide.createIcons();
    }

    function renderSecretaryCards(announcements) {
        if (!announcements.length) {
            listContainer.innerHTML = `
                <div class="announcements-empty">
                    <div class="empty-icon"><i data-lucide="inbox"></i></div>
                    <h4 class="empty-title">No Announcements Found</h4>
                    <p class="empty-desc">There are no announcements matching your selected status and filters.</p>
                    <button type="button" class="btn-create-announcement" onclick="document.getElementById('btn-sec-new-announcement').click()">
                        <i data-lucide="plus-circle"></i>
                        <span>Post First Notice</span>
                    </button>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = announcements.map(ann => {
            const isExpired = !ann.is_active;
            const priorityClass = `priority-${ann.priority || 'normal'}`;
            const targetLabel = formatTargetLabel(ann.target_type, ann.target_id, ann.target_role);

            return `
                <div class="announcement-card ${priorityClass} ${isExpired ? 'is-expired' : ''}" data-id="${ann.id}">
                    <div class="announcement-card-header">
                        <div class="announcement-badges">
                            <span class="badge-priority ${ann.priority}">
                                <i data-lucide="${ann.priority === 'urgent' ? 'alert-octagon' : 'info'}"></i>
                                ${ann.priority}
                            </span>
                            <span class="badge-category">
                                <i data-lucide="${getCategoryIcon(ann.category)}"></i>
                                ${ann.category}
                            </span>
                            <span class="badge-target">
                                <i data-lucide="target"></i>
                                ${targetLabel}
                            </span>
                        </div>

                        <div class="announcement-time-info">
                            <span title="Created: ${formatDateTime(ann.created_at)}">
                                <i data-lucide="calendar"></i>
                                ${formatDate(ann.created_at)}
                            </span>
                            <span>·</span>
                            <span style="color: ${isExpired ? '#DC2626' : 'var(--clr-text-muted)'};">
                                <i data-lucide="clock"></i>
                                ${isExpired ? 'Expired' : `Expires ${timeAgo(ann.expires_at)}`}
                            </span>
                        </div>
                    </div>

                    <div class="announcement-title-row">
                        <h3 class="announcement-title-text">${escapeHtml(ann.title)}</h3>
                    </div>

                    <div class="announcement-card-footer">
                        <div class="card-footer-meta">
                            <span>
                                <i data-lucide="check-check" style="color: #10B981;"></i>
                                <strong>${ann.read_count || 0}</strong> read receipts recorded
                            </span>
                        </div>

                        <div class="card-footer-actions">
                            <button type="button" class="btn-card-action primary btn-view-stats" data-id="${ann.id}">
                                <i data-lucide="bar-chart-2"></i>
                                <span>View Roster & Stats</span>
                            </button>
                            <button type="button" class="btn-card-action danger btn-delete-ann" data-id="${ann.id}">
                                <i data-lucide="trash-2"></i>
                                <span>Delete</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Attach action handlers
        document.querySelectorAll('.btn-view-stats').forEach(btn => {
            btn.addEventListener('click', () => openDetailModal(parseInt(btn.dataset.id, 10)));
        });

        document.querySelectorAll('.btn-delete-ann').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id, 10);
                pendingDeleteAction = { type: 'single', id };
                document.getElementById('delete-modal-title').textContent = 'Delete Announcement?';
                document.getElementById('delete-modal-text').textContent =
                    'Are you sure you want to delete this announcement? It will be soft-deleted immediately from all resident feeds.';
                document.getElementById('delete-btn-label').textContent = 'Delete Notice';
                deleteModal.classList.add('active');
            });
        });
    }

    function renderPagination(pagination) {
        if (!paginationContainer) return;
        if (!pagination.total_pages || pagination.total_pages <= 1) {
            paginationContainer.innerHTML = '';
            return;
        }

        let html = '';
        if (currentPage > 1) {
            html += `<button type="button" class="btn-card-action" id="page-prev"><i data-lucide="chevron-left"></i> Prev</button>`;
        }
        html += `<span style="font-size: var(--fs-xs); color: var(--clr-text-secondary);">Page ${pagination.page} of ${pagination.total_pages} (${pagination.total} total)</span>`;
        if (currentPage < pagination.total_pages) {
            html += `<button type="button" class="btn-card-action" id="page-next">Next <i data-lucide="chevron-right"></i></button>`;
        }

        paginationContainer.innerHTML = html;
        const btnPrev = document.getElementById('page-prev');
        const btnNext = document.getElementById('page-next');
        if (btnPrev) btnPrev.addEventListener('click', () => { currentPage--; loadSecretaryAnnouncements(); });
        if (btnNext) btnNext.addEventListener('click', () => { currentPage++; loadSecretaryAnnouncements(); });
    }

    function openCreateModal() {
        formCreate.reset();
        charCounter.textContent = '0 / 5000';
        handleTargetTypeChange();

        // Default expiry to +72 hours (3 days)
        const defaultExpiry = new Date(Date.now() + 72 * 3600 * 1000);
        inputExpires.value = formatForDateTimeLocal(defaultExpiry);
        inputExpires.min = formatForDateTimeLocal(new Date());

        createModal.classList.add('active');
    }

    function closeCreateModal() {
        createModal.classList.remove('active');
    }

    async function handleCreateSubmit(e) {
        e.preventDefault();

        const title = document.getElementById('ann-input-title').value.trim();
        const category = document.getElementById('ann-select-category').value;
        const priority = document.getElementById('ann-select-priority').value;
        const target_type = targetTypeSelect.value;
        const expires_at = inputExpires.value;
        const content = textareaContent.value.trim();

        let target_id = null;
        let target_role = null;

        if (target_type === 'block') {
            const val = targetBlockSelect.value;
            if (!val) { Toast.error('Please select a target block.'); return; }
            target_id = parseInt(val, 10);
        } else if (target_type === 'floor') {
            const val = targetFloorSelect.value;
            if (!val) { Toast.error('Please select a target floor.'); return; }
            target_id = parseInt(val, 10);
        } else if (target_type === 'unit') {
            const val = targetUnitSelect.value;
            if (!val) { Toast.error('Please select a target unit.'); return; }
            target_id = parseInt(val, 10);
        } else if (target_type === 'user') {
            const val = targetUserSelect.value;
            if (!val) { Toast.error('Please select an active resident.'); return; }
            target_id = parseInt(val, 10);
        } else if (target_type === 'role') {
            target_role = targetRoleSelect.value;
        }

        const submitBtn = document.getElementById('btn-submit-announcement');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> <span>Publishing...</span>';
        if (window.lucide) lucide.createIcons();

        try {
            const payload = {
                title,
                content,
                category,
                priority,
                target_type,
                target_id,
                target_role,
                expires_at: new Date(expires_at).toISOString(),
            };

            const res = await Api.createAnnouncement(payload);

            if (res.success) {
                Toast.success('Announcement published successfully!');
                closeCreateModal();
                loadSecretaryAnnouncements();
            } else {
                Toast.error(res.message || 'Failed to publish announcement.');
            }
        } catch (err) {
            console.error('[Announcements] Create announcement error:', err);
            Toast.error('An unexpected error occurred while creating announcement.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i data-lucide="send"></i> <span>Publish Announcement</span>';
            if (window.lucide) lucide.createIcons();
        }
    }

    async function openDetailModal(announcementId) {
        detailModal.classList.add('active');

        // Reset fields
        document.getElementById('detail-title').textContent = 'Loading details...';
        document.getElementById('detail-content').textContent = '';
        document.getElementById('detail-sec-stats-section').style.display = 'block';
        document.getElementById('detail-readers-tbody').innerHTML = `
            <tr><td colspan="3" style="text-align: center; color: var(--clr-text-muted);">Loading read receipts...</td></tr>
        `;

        try {
            const res = await Api.getAnnouncementById(announcementId);

            if (res.success && res.data) {
                const ann = res.data;
                document.getElementById('detail-title').textContent = ann.title;
                document.getElementById('detail-content').textContent = ann.content;

                // Priority Badge
                const pBadge = document.getElementById('detail-badge-priority');
                pBadge.className = `badge-priority ${ann.priority}`;
                pBadge.textContent = ann.priority;

                // Category Badge
                const cBadge = document.getElementById('detail-badge-category');
                cBadge.textContent = ann.category;

                // Target badge
                const tBadge = document.getElementById('detail-target');
                tBadge.innerHTML = `<i data-lucide="target"></i> ${formatTargetLabel(ann.target_type, ann.target_id, ann.target_role)}`;

                // Dates
                document.getElementById('detail-created-at').textContent = `Posted on ${formatDateTime(ann.created_at)}`;
                document.getElementById('detail-expires-at').textContent = `Expires ${formatDateTime(ann.expires_at)}`;

                // Stats
                const stats = ann.read_stats || {};
                const readCount = stats.read_count || 0;
                const totalTargeted = stats.total_targeted || 0;
                const percent = stats.read_percentage !== undefined ? stats.read_percentage : 0;

                document.getElementById('detail-read-badge-ratio').textContent =
                    `${readCount} / ${totalTargeted} Read (${percent}%)`;
                document.getElementById('detail-progress-fill').style.width = `${percent}%`;

                // Readers Table
                const tbody = document.getElementById('detail-readers-tbody');
                const readers = ann.readers || [];
                if (!readers.length) {
                    tbody.innerHTML = `
                        <tr><td colspan="3" style="text-align: center; color: var(--clr-text-muted); padding: var(--sp-4);">No read receipts recorded yet. Residents have not viewed this notice.</td></tr>
                    `;
                } else {
                    tbody.innerHTML = readers.map(r => `
                        <tr>
                            <td><strong>${escapeHtml(r.resident_name || 'Resident')}</strong></td>
                            <td>${escapeHtml(r.unit_label || '--')}</td>
                            <td style="color: var(--clr-text-muted);">${formatDateTime(r.read_at)}</td>
                        </tr>
                    `).join('');
                }
            } else {
                Toast.error(res.message || 'Failed to fetch announcement details.');
                closeDetailModal();
            }
        } catch (err) {
            console.error('[Announcements] openDetailModal error:', err);
            Toast.error('Network error loading notice details.');
            closeDetailModal();
        }
        if (window.lucide) lucide.createIcons();
    }

    function closeDetailModal() {
        detailModal.classList.remove('active');
    }

    function closeDeleteModal() {
        deleteModal.classList.remove('active');
        pendingDeleteAction = null;
    }

    async function handleConfirmDelete() {
        if (!pendingDeleteAction) return;

        btnConfirmDelete.disabled = true;
        btnConfirmDelete.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> <span>Deleting...</span>';

        try {
            if (pendingDeleteAction.type === 'single') {
                const res = await Api.deleteAnnouncement(pendingDeleteAction.id);
                if (res.success) {
                    Toast.success('Announcement deleted successfully.');
                } else {
                    Toast.error(res.message || 'Failed to delete announcement.');
                }
            } else if (pendingDeleteAction.type === 'bulk') {
                const res = await Api.deleteExpiredAnnouncements();
                if (res.success) {
                    Toast.success(`Deleted ${res.data?.deleted_count || 0} expired announcements.`);
                } else {
                    Toast.error(res.message || 'Failed to clean expired announcements.');
                }
            }
            closeDeleteModal();
            loadSecretaryAnnouncements();
        } catch (err) {
            console.error('[Announcements] Delete error:', err);
            Toast.error('An error occurred during deletion.');
        } finally {
            btnConfirmDelete.disabled = false;
            btnConfirmDelete.innerHTML = '<i data-lucide="trash-2"></i> <span>Delete</span>';
            if (window.lucide) lucide.createIcons();
        }
    }
}

/* ════════════════════════════════════════════════════════════════
   RESIDENT MODULE
   ════════════════════════════════════════════════════════════════ */
function initResidentView(user) {
    let currentTab = 'active'; // 'active' | 'archived'
    let currentCategory = '';
    let residentNotices = [];

    // DOM Elements
    const listContainer = document.getElementById('res-announcements-list');
    const tabActive = document.getElementById('res-tab-active');
    const tabArchived = document.getElementById('res-tab-archived');
    const filterCategory = document.getElementById('res-filter-category');
    const btnRefresh = document.getElementById('btn-res-refresh');
    const unreadBanner = document.getElementById('res-unread-banner');
    const unreadText = document.getElementById('res-unread-text');
    const unreadBadgeCount = document.getElementById('res-unread-badge-count');

    // Details Modal Elements
    const detailModal = document.getElementById('modal-announcement-details');
    const btnCloseDetail = document.getElementById('btn-close-detail-modal');
    const btnCloseDetailBottom = document.getElementById('btn-close-detail-bottom');

    // ── Initial Load ──
    loadResidentFeed();

    // ── Event Listeners ──
    if (tabActive) tabActive.addEventListener('click', () => switchResidentTab('active'));
    if (tabArchived) tabArchived.addEventListener('click', () => switchResidentTab('archived'));

    if (filterCategory) filterCategory.addEventListener('change', (e) => {
        currentCategory = e.target.value;
        loadResidentFeed();
    });

    if (btnRefresh) btnRefresh.addEventListener('click', () => {
        rotateRefreshIcon('icon-refresh-res');
        loadResidentFeed();
    });

    if (btnCloseDetail) btnCloseDetail.addEventListener('click', () => detailModal.classList.remove('active'));
    if (btnCloseDetailBottom) btnCloseDetailBottom.addEventListener('click', () => detailModal.classList.remove('active'));

    // ── Functions ──

    function switchResidentTab(tab) {
        currentTab = tab;
        [tabActive, tabArchived].forEach(t => t.classList.remove('active'));
        if (tab === 'active') tabActive.classList.add('active');
        else tabArchived.classList.add('active');
        loadResidentFeed();
    }

    async function loadResidentFeed() {
        listContainer.innerHTML = `
            <div style="text-align: center; padding: var(--sp-8); color: var(--clr-text-secondary);">
                <i data-lucide="loader" class="animate-spin" style="width: 32px; height: 32px; margin: 0 auto var(--sp-2);"></i>
                <p>Loading notice board...</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();

        try {
            const params = {
                include_expired: currentTab === 'archived' ? 'true' : 'false',
            };
            if (currentCategory) params.category = currentCategory;

            const res = await Api.getMyAnnouncements(params);

            if (res.success && res.data) {
                const { active = [], archived = [], unread_count = 0 } = res.data;

                // Update unread notification banner
                if (unread_count > 0) {
                    unreadBanner.style.display = 'flex';
                    unreadText.textContent = `You have ${unread_count} unread notice${unread_count > 1 ? 's' : ''} addressed to your residence.`;
                    unreadBadgeCount.textContent = `${unread_count} Unread`;

                    // Update sidebar badge
                    const sidebarBadge = document.getElementById('sidebar-notices-badge');
                    if (sidebarBadge) {
                        sidebarBadge.style.display = 'inline-block';
                        sidebarBadge.textContent = unread_count;
                    }
                } else {
                    unreadBanner.style.display = 'none';
                    const sidebarBadge = document.getElementById('sidebar-notices-badge');
                    if (sidebarBadge) sidebarBadge.style.display = 'none';
                }

                residentNotices = currentTab === 'active' ? active : (archived.length ? archived : []);
                renderResidentCards(residentNotices);
            } else {
                listContainer.innerHTML = `
                    <div class="announcements-empty">
                        <div class="empty-icon"><i data-lucide="alert-circle"></i></div>
                        <h4 class="empty-title">Notice Board Offline</h4>
                        <p class="empty-desc">${res.message || 'Could not fetch notices.'}</p>
                    </div>
                `;
            }
        } catch (err) {
            console.error('[Announcements] loadResidentFeed error:', err);
            listContainer.innerHTML = `
                <div class="announcements-empty">
                    <div class="empty-icon"><i data-lucide="wifi-off"></i></div>
                    <h4 class="empty-title">Connection Lost</h4>
                    <p class="empty-desc">Check your internet connection.</p>
                </div>
            `;
        }
        if (window.lucide) lucide.createIcons();
    }

    function renderResidentCards(notices) {
        if (!notices.length) {
            listContainer.innerHTML = `
                <div class="announcements-empty">
                    <div class="empty-icon"><i data-lucide="check-circle-2" style="color: #10B981;"></i></div>
                    <h4 class="empty-title">${currentTab === 'active' ? 'You\'re All Caught Up!' : 'No Past Notices'}</h4>
                    <p class="empty-desc">${currentTab === 'active' ? 'There are no active notices for your flat or community.' : 'Archived notice history is empty.'}</p>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = notices.map(notice => {
            const isRead = Boolean(notice.is_read);
            const priorityClass = `priority-${notice.priority || 'normal'}`;

            return `
                <div class="announcement-card ${priorityClass}" id="card-notice-${notice.id}" data-id="${notice.id}">
                    <div class="announcement-card-header">
                        <div class="announcement-badges">
                            <span class="badge-priority ${notice.priority}">
                                <i data-lucide="${notice.priority === 'urgent' ? 'alert-octagon' : 'info'}"></i>
                                ${notice.priority}
                            </span>
                            <span class="badge-category">
                                <i data-lucide="${getCategoryIcon(notice.category)}"></i>
                                ${notice.category}
                            </span>
                            <span class="resident-read-badge ${isRead ? 'read' : 'unread'}" id="read-badge-${notice.id}">
                                <i data-lucide="${isRead ? 'check' : 'bell'}"></i>
                                <span>${isRead ? 'Read' : 'NEW'}</span>
                            </span>
                        </div>

                        <div class="announcement-time-info">
                            <span><i data-lucide="calendar"></i> ${formatDate(notice.created_at)}</span>
                            <span>·</span>
                            <span><i data-lucide="clock"></i> ${timeAgo(notice.expires_at)}</span>
                        </div>
                    </div>

                    <div class="announcement-title-row">
                        <h3 class="announcement-title-text">${escapeHtml(notice.title)}</h3>
                    </div>

                    <div class="announcement-body-text truncated" id="body-text-${notice.id}">
                        ${escapeHtml(notice.content)}
                    </div>

                    <div class="announcement-card-footer">
                        <div class="card-footer-meta">
                            <span id="read-meta-${notice.id}">
                                ${isRead && notice.read_at ? `<i data-lucide="check-check" style="color: #10B981;"></i> Read on ${formatDate(notice.read_at)}` : '<span style="color: #EA580C; font-weight: 600;">Unread Notice</span>'}
                            </span>
                        </div>

                        <div class="card-footer-actions">
                            <button type="button" class="btn-card-action primary btn-read-notice" data-id="${notice.id}">
                                <i data-lucide="book-open"></i>
                                <span>Read Full Notice</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Attach Read Click Handlers
        document.querySelectorAll('.btn-read-notice').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id, 10);
                const notice = notices.find(n => n.id === id);
                if (notice) {
                    openResidentNoticeModal(notice);
                }
            });
        });
    }

    async function openResidentNoticeModal(notice) {
        detailModal.classList.add('active');

        // Populate Content
        document.getElementById('detail-title').textContent = notice.title;
        document.getElementById('detail-content').textContent = notice.content;
        document.getElementById('detail-sec-stats-section').style.display = 'none'; // hide secretary analytics

        const pBadge = document.getElementById('detail-badge-priority');
        pBadge.className = `badge-priority ${notice.priority}`;
        pBadge.textContent = notice.priority;

        const cBadge = document.getElementById('detail-badge-category');
        cBadge.textContent = notice.category;

        document.getElementById('detail-target').style.display = 'none';
        document.getElementById('detail-created-at').textContent = `Posted ${formatDateTime(notice.created_at)}`;
        document.getElementById('detail-expires-at').textContent = `Expires ${formatDateTime(notice.expires_at)}`;

        if (window.lucide) lucide.createIcons();

        // If not marked as read yet, automatically dispatch read receipt to backend!
        if (!notice.is_read) {
            try {
                const res = await Api.markAnnouncementRead(notice.id);
                if (res.success) {
                    notice.is_read = true;
                    notice.read_at = new Date().toISOString();

                    // Update UI card dynamically
                    const badge = document.getElementById(`read-badge-${notice.id}`);
                    if (badge) {
                        badge.className = 'resident-read-badge read';
                        badge.innerHTML = '<i data-lucide="check"></i> <span>Read</span>';
                    }
                    const meta = document.getElementById(`read-meta-${notice.id}`);
                    if (meta) {
                        meta.innerHTML = `<i data-lucide="check-check" style="color: #10B981;"></i> Read just now`;
                    }
                    if (window.lucide) lucide.createIcons();
                }
            } catch (err) {
                console.warn('[Announcements] Auto-read receipt failed:', err);
            }
        }
    }
}

/* ════════════════════════════════════════════════════════════════
   SHARED HELPER UTILITIES
   ════════════════════════════════════════════════════════════════ */
function formatTargetLabel(targetType, targetId, targetRole) {
    if (targetType === 'all') return 'All Society Residents';
    if (targetType === 'role') return `All ${targetRole === 'owner' ? 'Owners' : 'Tenants'}`;
    if (targetType === 'block') {
        const b = globalStructure?.blocks?.find(x => x.id === targetId);
        if (b) {
            const bName = b.blockName || b.block_name || targetId;
            return `Block ${bName}`;
        }
        return `Block (ID: ${targetId})`;
    }
    if (targetType === 'floor') {
        if (globalStructure?.blocks) {
            for (const b of globalStructure.blocks) {
                const fl = b.floors?.find(x => x.id === targetId);
                if (fl) {
                    const bName = b.blockName || b.block_name || '';
                    const fNo = fl.floorNumber !== undefined ? fl.floorNumber : (fl.floor_number !== undefined ? fl.floor_number : targetId);
                    return `Block ${bName} - Floor ${fNo}`;
                }
            }
        }
        return `Floor (ID: ${targetId})`;
    }
    if (targetType === 'unit') {
        if (globalStructure?.blocks) {
            for (const b of globalStructure.blocks) {
                if (b.floors) {
                    for (const fl of b.floors) {
                        const u = fl.units?.find(x => x.id === targetId);
                        if (u) {
                            return `Unit ${u.displayLabel || u.display_label || u.unitNumber || targetId}`;
                        }
                    }
                }
            }
        }
        return `Unit (ID: ${targetId})`;
    }
    if (targetType === 'user') {
        const r = globalResidents?.find(x => x.id === targetId);
        if (r) {
            const flat = r.displayLabel || r.unitLabel || r.unitNumber || (r.unit ? (r.unit.displayLabel || r.unit.unitNumber) : '');
            return `${r.name}${flat ? ` (${flat})` : ''} (Personal)`;
        }
        return `Resident (ID: ${targetId})`;
    }
    return 'Targeted Audience';
}

function getCategoryIcon(cat) {
    const map = {
        general: 'info',
        maintenance: 'wrench',
        security: 'shield-alert',
        event: 'calendar',
        emergency: 'alert-triangle',
        financial: 'credit-card',
    };
    return map[cat] || 'bell';
}

function formatForDateTimeLocal(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const h = pad(date.getHours());
    const min = pad(date.getMinutes());
    return `${y}-${m}-${d}T${h}:${min}`;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function rotateRefreshIcon(id) {
    const icon = document.getElementById(id);
    if (!icon) return;
    icon.classList.add('animate-spin');
    setTimeout(() => icon.classList.remove('animate-spin'), 600);
}
