/**
 * Sahayak — Society Setup Wizard Page Logic
 * Manages 4-step wizard:
 * 1. Society Profile (with live debounced society_code validation & auto-population)
 * 2. Block Creation (with block rename & delete actions)
 * 3. Bulk Floor & Unit Generator (with existing floor detection & unitsSkipped feedback)
 * 4. Visual Interactive Structure Hierarchy Tree (with floor deletion & unit edit/delete modals)
 */

let currentStep = 1;
let createdBlocks = [];
let societyData = null;
let codeValidationTimeout = null;
let isCodeAvailable = false;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Authenticate user (Secretary only)
    const user = await Router.requireAuth('secretary');
    if (!user) return;

    // 2. Initialize Layout
    Components.initSidebar('society-setup');
    Components.initTopbar({
        title: 'Society Setup Wizard',
        subtitle: 'Define your society profile, blocks, floors, and residential units',
    });

    // 3. Setup real-time society code validator
    setupCodeValidation();

    // 4. Setup modal dialog handlers (Rename/Delete Block, Delete Floor, Edit/Delete Unit)
    setupModals();

    // 5. Check if user already has a society registered
    if (user.societyId || (user.society && user.society.id)) {
        // Fetch full society configuration
        const res = await Api.get('/society/setup');
        if (res.success && res.data) {
            societyData = res.data;
            isCodeAvailable = true; // Already registered
            
            // Show registered banner
            const banner = document.getElementById('society-registered-banner');
            if (banner) {
                banner.style.display = 'flex';
                const titleEl = document.getElementById('exists-banner-title');
                const descEl = document.getElementById('exists-banner-desc');
                if (titleEl) titleEl.textContent = `Society '${societyData.name || 'My Society'}' is Active`;
                if (descEl) descEl.textContent = `Registered with unique code ${societyData.society_code || societyData.societyCode || 'SAVED'}. You can update details below or proceed.`;
            }

            // Populate Step 1 with existing info
            const nameInput = document.getElementById('soc-name');
            if (nameInput) nameInput.value = societyData.name || '';

            const codeInput = document.getElementById('soc-code');
            if (codeInput) {
                codeInput.value = societyData.society_code || societyData.societyCode || '';
                codeInput.disabled = true;
                codeInput.title = 'Society code is unique and cannot be modified once registered.';
            }

            const feedback = document.getElementById('soc-code-feedback');
            if (feedback) {
                feedback.innerHTML = `
                    <span style="color: #2E7D32; display: inline-flex; align-items: center; gap: 4px;">
                        <i data-lucide="check-circle-2" style="width: 13px; height: 13px;"></i>
                        Registered society identifier (locked).
                    </span>
                `;
            }

            const addressInput = document.getElementById('soc-address');
            if (addressInput) addressInput.value = societyData.address || '';
            const cityInput = document.getElementById('soc-city');
            if (cityInput) cityInput.value = societyData.city || '';
            const stateInput = document.getElementById('soc-state');
            if (stateInput) stateInput.value = societyData.state || '';
            const pincodeInput = document.getElementById('soc-pincode');
            if (pincodeInput) pincodeInput.value = societyData.pincode || '';
            
            const regNoInput = document.getElementById('soc-reg-no');
            if (regNoInput && societyData.metadata && societyData.metadata.registration_number) {
                regNoInput.value = societyData.metadata.registration_number;
            }

            // Update Step 1 button text
            const btnStep1 = document.getElementById('btn-submit-step1');
            if (btnStep1) {
                const txt = btnStep1.querySelector('.btn-text');
                if (txt) txt.textContent = 'Update & Proceed to Blocks';
            }

            // Auto-load blocks and structure
            await loadExistingStructure();
        }
    }

    const skeleton = document.getElementById('setup-skeleton');
    const mainView = document.getElementById('setup-main-view');
    if (skeleton) skeleton.style.display = 'none';
    if (mainView) mainView.style.display = 'block';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // ══════════ Step 1: Submit Society Setup ══════════
    const formStep1 = document.getElementById('form-create-society');
    if (formStep1) {
        formStep1.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('soc-name').value.trim();
            const society_code = document.getElementById('soc-code').value.trim().toUpperCase();
            const address = document.getElementById('soc-address').value.trim();
            const city = document.getElementById('soc-city').value.trim();
            const state = document.getElementById('soc-state').value.trim();
            const pincode = document.getElementById('soc-pincode').value.trim();
            const regNo = document.getElementById('soc-reg-no').value.trim();

            if (!name || (!societyData && !society_code) || !address || !city || !state || !pincode) {
                Toast.error('Please fill in all required fields.');
                return;
            }

            if (!societyData) {
                // Format validation: Uppercase A-Z and hyphens only (3-20 chars)
                const codeRegex = /^[A-Z][A-Z-]{2,19}$/;
                if (!codeRegex.test(society_code)) {
                    Toast.error('Society code must be 3-20 characters: uppercase letters A-Z and hyphens (-) only, starting with a letter.');
                    return;
                }

                // Final check if code is confirmed available
                if (!isCodeAvailable) {
                    const check = await Api.validateSocietyCode(society_code);
                    if (!check.success || !check.data?.available) {
                        Toast.error(check.data?.message || 'This society code is already in use. Please pick another.');
                        return;
                    }
                    isCodeAvailable = true;
                }
            }

            const submitBtn = document.getElementById('btn-submit-step1');
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;

            const payload = {
                name,
                address,
                city,
                state,
                pincode,
                metadata: { registration_number: regNo }
            };
            
            if (!societyData) {
                payload.society_code = society_code;
            }

            let res;
            if (societyData && (societyData.id || societyData.societyId)) {
                res = await Api.put('/society/setup', payload);
            } else {
                res = await Api.post('/society/setup', payload);
            }

            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;

            if (res.success && res.data) {
                societyData = res.data;
                Toast.success(societyData ? 'Society profile saved successfully!' : 'Society profile created successfully!');
                await Router.validateAndGetUser();
                Components.initSidebar('society-setup');
                goToStep(2);
            } else {
                Toast.error(res.message || 'Failed to save society profile.');
            }
        });
    }

    // ══════════ Step 2: Add Block ══════════
    const formBlock = document.getElementById('form-add-block');
    if (formBlock) {
        formBlock.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('block-name-input');
            const block_name = input.value.trim().toUpperCase();

            if (!block_name) return;

            const btn = document.getElementById('btn-add-block');
            btn.classList.add('loading');
            btn.disabled = true;

            const res = await Api.post('/society/blocks', { block_name });

            btn.classList.remove('loading');
            btn.disabled = false;

            if (res.success && res.data) {
                Toast.success(`Block ${block_name} created!`);
                input.value = '';
                // Reload complete structure to sync IDs
                await loadExistingStructure();
            } else {
                Toast.error(res.message || 'Failed to add block.');
            }
        });
    }

    // ══════════ Step 3: Interactive Floor/Unit Setup ══════════
    setupStep3Listeners();
});

/**
 * Real-time debounced society code validation using GET /public/validate-code/:code
 */
function setupCodeValidation() {
    const codeInput = document.getElementById('soc-code');
    const feedback = document.getElementById('soc-code-feedback');
    const spinner = document.getElementById('soc-code-spinner');
    if (!codeInput || !feedback) return;

    codeInput.addEventListener('input', () => {
        if (codeInput.disabled) return;
        clearTimeout(codeValidationTimeout);

        const val = codeInput.value.trim().toUpperCase();
        codeInput.value = val;

        if (!val) {
            feedback.innerHTML = '';
            if (spinner) spinner.style.display = 'none';
            isCodeAvailable = false;
            return;
        }

        const codeRegex = /^[A-Z][A-Z-]{2,19}$/;
        if (!codeRegex.test(val)) {
            if (spinner) spinner.style.display = 'none';
            feedback.innerHTML = `
                <span style="color: #C62828; display: inline-flex; align-items: center; gap: 4px;">
                    <i data-lucide="alert-circle" style="width: 13px; height: 13px;"></i>
                    Must be 3-20 characters: letters A-Z & hyphens only, start with a letter.
                </span>
            `;
            if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [feedback] });
            isCodeAvailable = false;
            return;
        }

        if (spinner) spinner.style.display = 'block';
        feedback.innerHTML = `
            <span style="color: var(--clr-text-secondary); display: inline-flex; align-items: center; gap: 4px;">
                Checking availability...
            </span>
        `;

        codeValidationTimeout = setTimeout(async () => {
            try {
                const res = await Api.validateSocietyCode(val);
                if (spinner) spinner.style.display = 'none';

                if (res.success && res.data) {
                    if (res.data.available) {
                        feedback.innerHTML = `
                            <span style="color: #2E7D32; display: inline-flex; align-items: center; gap: 4px;">
                                <i data-lucide="check-circle-2" style="width: 13px; height: 13px;"></i>
                                Society code "<strong>${val}</strong>" is available!
                            </span>
                        `;
                        isCodeAvailable = true;
                    } else {
                        feedback.innerHTML = `
                            <span style="color: #C62828; display: inline-flex; align-items: center; gap: 4px;">
                                <i data-lucide="x-circle" style="width: 13px; height: 13px;"></i>
                                ${res.data.message || `Code "${val}" is already taken.`}
                            </span>
                        `;
                        isCodeAvailable = false;
                    }
                } else {
                    feedback.innerHTML = `
                        <span style="color: #C62828; display: inline-flex; align-items: center; gap: 4px;">
                            <i data-lucide="alert-circle" style="width: 13px; height: 13px;"></i>
                            ${res.message || 'Unable to verify code availability.'}
                        </span>
                    `;
                    isCodeAvailable = false;
                }
                if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [feedback] });
            } catch (err) {
                if (spinner) spinner.style.display = 'none';
                isCodeAvailable = false;
            }
        }, 350);
    });
}

/**
 * Setup Step 3 form dynamic updates and submission
 */
function setupStep3Listeners() {
    const selectBlock = document.getElementById('select-block');
    const inputFloors = document.getElementById('total-floors');
    const inputStart = document.getElementById('unit-start');
    const inputEnd = document.getElementById('unit-end');

    if (selectBlock) selectBlock.addEventListener('change', updateBlockStatusAndPreview);
    if (inputFloors) inputFloors.addEventListener('input', updateBlockStatusAndPreview);
    if (inputStart) inputStart.addEventListener('input', updateBlockStatusAndPreview);
    if (inputEnd) inputEnd.addEventListener('input', updateBlockStatusAndPreview);

    const modeRadios = document.querySelectorAll('input[name="floor-action-mode"]');
    modeRadios.forEach(radio => {
        radio.addEventListener('change', updateBlockStatusAndPreview);
    });

    const formUnits = document.getElementById('form-generate-units');
    if (formUnits) {
        formUnits.addEventListener('submit', handleStep3Submit);
    }
}

/**
 * Live updates block status card, mode visibility, and preview calculations
 */
function updateBlockStatusAndPreview() {
    const selectBlock = document.getElementById('select-block');
    const statusCard = document.getElementById('block-status-card');
    const statusTitle = document.getElementById('block-status-title');
    const statusDesc = document.getElementById('block-status-desc');
    const modeContainer = document.getElementById('existing-floors-mode');
    const floorsGroup = document.getElementById('total-floors-group');
    const calcPreview = document.getElementById('floor-calc-preview');
    const calcText = document.getElementById('floor-calc-text');

    if (!selectBlock || !statusCard) return;

    const blockId = selectBlock.value;
    if (!blockId) {
        statusCard.style.display = 'none';
        calcPreview.style.display = 'none';
        return;
    }

    const block = createdBlocks.find(b => String(b.id) === String(blockId));
    if (!block) return;

    const floors = block.floors || [];
    const hasExistingFloors = floors.length > 0;
    const maxFloor = hasExistingFloors ? Math.max(...floors.map(f => Number(f.floorNumber) || 0)) : 0;
    const totalUnits = floors.reduce((acc, f) => acc + ((f.units || []).length), 0);

    statusCard.style.display = 'block';

    const selectedMode = document.querySelector('input[name="floor-action-mode"]:checked')?.value || 'units-only';
    const totalFloorsInput = parseInt(document.getElementById('total-floors')?.value) || 1;
    const unitStart = parseInt(document.getElementById('unit-start')?.value) || 1;
    const unitEnd = parseInt(document.getElementById('unit-end')?.value) || 4;
    const unitsPerFloor = Math.max(0, unitEnd - unitStart + 1);

    if (hasExistingFloors) {
        statusTitle.textContent = `Block ${block.blockName || block.block_name}: ${floors.length} Floors Already in Database`;
        statusDesc.innerHTML = `This block currently has <strong>Floors 1 to ${maxFloor}</strong> with <strong>${totalUnits} units</strong> configured.<br>Because floors already exist in the database, select whether to populate existing floors or append more.`;
        modeContainer.style.display = 'block';

        if (selectedMode === 'units-only') {
            if (floorsGroup) floorsGroup.style.display = 'none';
            calcPreview.style.display = 'block';
            calcText.innerHTML = `<strong>Safe Mode:</strong> Generating units for existing <strong>Floors 1 to ${maxFloor}</strong> (approx ${floors.length * unitsPerFloor} units total). <strong>Zero new floors will be added.</strong>`;
        } else {
            if (floorsGroup) floorsGroup.style.display = 'block';
            const nextStart = maxFloor + 1;
            const nextEnd = maxFloor + totalFloorsInput;
            calcPreview.style.display = 'block';
            calcText.innerHTML = `<strong>Append Mode:</strong> Appending <strong>${totalFloorsInput} new floors</strong>. The database will create <strong>Floors ${nextStart} to ${nextEnd}</strong> (starting after current max Floor ${maxFloor}).`;
        }
    } else {
        statusTitle.textContent = `Block ${block.blockName || block.block_name}: New Block (0 Floors)`;
        statusDesc.textContent = `No floors exist in this block yet. Entering ${totalFloorsInput} floors will create Floors 1 to ${totalFloorsInput}.`;
        modeContainer.style.display = 'none';
        if (floorsGroup) floorsGroup.style.display = 'block';
        calcPreview.style.display = 'block';
        calcText.innerHTML = `<strong>Initial Setup:</strong> Will create <strong>Floors 1 to ${totalFloorsInput}</strong> (${unitsPerFloor} units per floor, e.g. 101 to 10${unitEnd}).`;
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Handle Step 3 submission with informative unitsSkipped feedback
 */
async function handleStep3Submit(e) {
    e.preventDefault();
    const blockId = document.getElementById('select-block').value;
    const totalFloors = parseInt(document.getElementById('total-floors').value) || 1;
    const startUnit = parseInt(document.getElementById('unit-start').value);
    const endUnit = parseInt(document.getElementById('unit-end').value);
    const unitType = document.getElementById('unit-type').value;
    const areaSqft = parseInt(document.getElementById('unit-area').value) || 1200;

    if (!blockId) {
        Toast.error('Please select a block first.');
        return;
    }

    const blockObj = createdBlocks.find(b => String(b.id) === String(blockId));
    const existingFloors = blockObj ? (blockObj.floors || []) : [];
    const hasExistingFloors = existingFloors.length > 0;
    const selectedMode = document.querySelector('input[name="floor-action-mode"]:checked')?.value || 'units-only';

    const btn = document.getElementById('btn-generate-units');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
        let targetFloors = [];

        // CASE A: Block already has floors and user wants to generate units for existing floors
        if (hasExistingFloors && selectedMode === 'units-only') {
            Toast.info(`Generating units for ${existingFloors.length} existing floors...`);
            targetFloors = existingFloors;
        } 
        // CASE B: Block is new OR user explicitly wants to append more floors
        else {
            if (totalFloors < 1) {
                Toast.error('Please enter at least 1 floor.');
                btn.classList.remove('loading');
                btn.disabled = false;
                return;
            }

            const maxFloorBefore = hasExistingFloors ? Math.max(...existingFloors.map(f => Number(f.floorNumber) || 0)) : 0;

            // 1. Bulk create floors
            const floorRes = await Api.post(`/blocks/${blockId}/floors/bulk`, {
                total_floors: totalFloors
            });

            if (!floorRes.success) {
                Toast.error(floorRes.message || 'Failed to create floors.');
                btn.classList.remove('loading');
                btn.disabled = false;
                return;
            }

            Toast.success(`${totalFloors} floors created! Fetching updated structure...`);

            // 2. Fetch updated structure to find the newly created floors
            const structRes = await Api.get('/society/structure');
            if (structRes.success && structRes.data && Array.isArray(structRes.data.blocks)) {
                createdBlocks = structRes.data.blocks;
                const updatedBlock = createdBlocks.find(b => String(b.id) === String(blockId));
                if (updatedBlock && updatedBlock.floors) {
                    targetFloors = updatedBlock.floors.filter(f => Number(f.floorNumber) > maxFloorBefore);
                }
            }
        }

        // 3. Populate units for the target floors and collect skipped units feedback
        let totalUnitsCreated = 0;
        let totalUnitsSkipped = 0;
        const skippedUnitNumbers = [];

        if (targetFloors.length > 0) {
            Toast.info(`Adding units to ${targetFloors.length} floors...`);
            for (const floor of targetFloors) {
                const uRes = await Api.post(`/floors/${floor.id}/units/bulk`, {
                    start_unit: startUnit,
                    end_unit: endUnit,
                    unit_type: unitType,
                    area_sqft: areaSqft
                });
                if (uRes.success && uRes.data) {
                    totalUnitsCreated += (uRes.data.createdCount || 0);
                    if (Array.isArray(uRes.data.unitsSkipped) && uRes.data.unitsSkipped.length > 0) {
                        totalUnitsSkipped += uRes.data.unitsSkipped.length;
                        skippedUnitNumbers.push(...uRes.data.unitsSkipped);
                    }
                }
            }
        }

        // 4. Refresh structure and advance
        await loadExistingStructure();

        if (totalUnitsSkipped > 0) {
            Toast.warning(`${totalUnitsCreated} units created. ${totalUnitsSkipped} existing units preserved (${skippedUnitNumbers.slice(0, 4).join(', ')}${skippedUnitNumbers.length > 4 ? '...' : ''}).`);
        } else {
            Toast.success(`${totalUnitsCreated} units successfully configured across ${targetFloors.length} floors!`);
        }
        goToStep(4);
    } catch (err) {
        console.error('Error in step 3:', err);
        Toast.error('An error occurred while generating structure.');
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

/**
 * Step navigation with clean panel toggling
 */
function goToStep(step) {
    currentStep = step;

    // Update stepper active states and panel visibility
    for (let i = 1; i <= 4; i++) {
        const node = document.getElementById(`step-node-${i}`);
        const panel = document.getElementById(`panel-step-${i}`);
        if (node) {
            node.classList.remove('active', 'completed');
            if (i < step) node.classList.add('completed');
            else if (i === step) node.classList.add('active');
        }
        if (panel) {
            if (i === step) {
                panel.classList.add('active');
            } else {
                panel.classList.remove('active');
            }
        }
    }

    if (step === 2) {
        renderBlocksList();
    } else if (step === 3) {
        populateBlockDropdown();
        updateBlockStatusAndPreview();
    } else if (step === 4) {
        refreshStructureTree();
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadExistingStructure() {
    try {
        const res = await Api.get('/society/structure');
        if (res.success && res.data && Array.isArray(res.data.blocks)) {
            createdBlocks = res.data.blocks;
            renderBlocksList();
            populateBlockDropdown();
            updateBlockStatusAndPreview();
            if (currentStep === 4) {
                renderFullTree(createdBlocks);
            }
        }
    } catch (err) {
        console.warn('Failed to load existing structure:', err);
    }
}

/**
 * Render created blocks list in Step 2 with Rename & Delete triggers
 */
function renderBlocksList() {
    const list = document.getElementById('created-blocks-list');
    if (!list) return;

    if (!createdBlocks || createdBlocks.length === 0) {
        list.innerHTML = '<span style="font-size: var(--fs-xs); color: var(--clr-text-secondary);">No blocks added yet. Use the form above to add your first block.</span>';
        return;
    }

    list.innerHTML = createdBlocks.map(b => {
        const floorCount = (b.floors || []).length;
        const blockName = b.blockName || b.block_name;
        return `
            <div style="background: var(--clr-surface-dim); border: 1px solid var(--clr-border); padding: 5px 12px; border-radius: var(--radius-full); font-weight: 600; font-size: var(--fs-sm); display: inline-flex; align-items: center; gap: 8px; color: var(--clr-primary);">
                <i data-lucide="building" style="width: 14px;"></i>
                <span>Block ${blockName}</span>
                <span style="font-size: 11px; font-weight: 500; color: var(--clr-text-secondary); background: rgba(92, 26, 51, 0.08); padding: 2px 6px; border-radius: 10px;">${floorCount} floors</span>
                <button type="button" class="btn-chip-action" title="Rename Block ${blockName}" onclick="openRenameBlockModal('${b.id}', '${blockName}')">
                    <i data-lucide="edit-2" style="width: 12px; height: 12px;"></i>
                </button>
                <button type="button" class="btn-chip-action text-danger" title="Delete Block ${blockName}" onclick="openDeleteBlockModal('${b.id}', '${blockName}')">
                    <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
                </button>
            </div>
        `;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [list] });
}

function populateBlockDropdown() {
    const select = document.getElementById('select-block');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="" disabled selected>Select a block</option>';
    createdBlocks.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        const floorCount = (b.floors || []).length;
        opt.textContent = `Block ${b.blockName || b.block_name} (${floorCount} floors)`;
        if (String(b.id) === String(currentVal)) opt.selected = true;
        select.appendChild(opt);
    });

    if (currentVal) {
        updateBlockStatusAndPreview();
    }
}

async function refreshStructureTree() {
    const container = document.getElementById('full-structure-tree');
    if (!container) return;

    container.innerHTML = `
        <div class="empty-state">
            <div class="loader-spinner" style="margin: 0 auto var(--sp-3);"></div>
            <h4>Loading live structure tree...</h4>
        </div>
    `;

    const res = await Api.get('/society/structure');
    if (res.success && res.data && Array.isArray(res.data.blocks) && res.data.blocks.length > 0) {
        createdBlocks = res.data.blocks;
        renderFullTree(res.data.blocks);
    } else {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="layers"></i></div>
                <h4>No Structure Found</h4>
                <p>Generate some blocks, floors, and units in Steps 2 & 3 to view the structure tree.</p>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });
    }
}

/**
 * Render visual structure tree in Step 4 with block actions, floor delete, and interactive unit chips
 */
function renderFullTree(blocks) {
    const container = document.getElementById('full-structure-tree');
    if (!container) return;

    container.innerHTML = blocks.map(block => {
        const blockName = block.blockName || block.block_name;
        const floors = block.floors || [];
        return `
        <div class="block-node">
            <div class="block-node-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="building-2" style="width: 18px;"></i>
                    <span style="font-weight: 700;">Block ${blockName}</span>
                    <button type="button" class="btn-icon-subtle" title="Rename Block ${blockName}" onclick="openRenameBlockModal('${block.id}', '${blockName}')">
                        <i data-lucide="edit-2" style="width: 13px; height: 13px;"></i>
                    </button>
                    <button type="button" class="btn-icon-subtle text-danger" title="Delete Block ${blockName}" onclick="openDeleteBlockModal('${block.id}', '${blockName}')">
                        <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
                    </button>
                </div>
                <span style="font-size: 11px; color: var(--clr-text-secondary); font-weight: 500;">
                    ${floors.length} Floors Total
                </span>
            </div>

            <div class="floors-container">
                ${floors.length === 0 ? `
                    <div style="padding: 10px; font-size: var(--fs-xs); color: var(--clr-text-muted); font-style: italic;">
                        No floors yet. You can add floors in Step 3 or delete this empty block.
                    </div>
                ` : floors.map(floor => `
                    <div class="floor-row">
                        <div style="display: flex; align-items: center; gap: 6px; width: 95px; flex-shrink: 0;">
                            <span class="floor-badge" style="width: auto;">Floor ${floor.floorNumber}</span>
                            <button type="button" class="btn-floor-delete" title="Delete Floor ${floor.floorNumber}" onclick="openDeleteFloorModal('${block.id}', '${floor.id}', '${floor.floorNumber}', '${blockName}')">
                                <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
                            </button>
                        </div>
                        <div class="units-flow">
                            ${(floor.units || []).length === 0 ? `
                                <span style="font-size: 11px; color: var(--clr-text-muted); font-style: italic;">No units</span>
                            ` : (floor.units || []).map(unit => `
                                <span class="unit-chip ${unit.status === 'occupied' ? 'occupied' : 'vacant'}" 
                                      title="Click to view or edit Unit ${unit.displayLabel}"
                                      onclick="openUnitModal('${unit.id}', '${unit.displayLabel}', '${unit.unitType || 'apartment'}', ${unit.areaSqft || 1200}, '${unit.status}')">
                                    <i data-lucide="${unit.status === 'occupied' ? 'user-check' : 'home'}" style="width: 11px;"></i>
                                    <span>${unit.displayLabel}</span>
                                </span>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        `;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });
}

// ══════════ Modal Dialogs Logic (Rename Block, Delete Block/Floor, Edit/Delete Unit) ══════════

function setupModals() {
    // 1. Rename Block Modal
    const renameModal = document.getElementById('rename-block-modal');
    const btnCloseRename = document.getElementById('btn-close-rename-block-modal');
    const btnCancelRename = document.getElementById('btn-cancel-rename-block');
    const formRename = document.getElementById('form-rename-block');

    function closeRenameModal() {
        if (renameModal) renameModal.style.display = 'none';
    }

    if (btnCloseRename) btnCloseRename.addEventListener('click', closeRenameModal);
    if (btnCancelRename) btnCancelRename.addEventListener('click', closeRenameModal);
    if (formRename) {
        formRename.addEventListener('submit', async (e) => {
            e.preventDefault();
            const blockId = document.getElementById('rename-block-id').value;
            const newName = document.getElementById('rename-block-input').value.trim().toUpperCase();

            if (!blockId || !newName) return;

            const submitBtn = document.getElementById('btn-submit-rename-block');
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;

            const res = await Api.renameBlock(blockId, newName);

            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;

            if (res.success) {
                Toast.success(`Block renamed to ${newName}. Unit labels synchronized!`);
                closeRenameModal();
                await loadExistingStructure();
                if (currentStep === 4) refreshStructureTree();
            } else {
                Toast.error(res.message || 'Failed to rename block.');
            }
        });
    }

    // 2. Delete Block Modal
    const deleteBlockModal = document.getElementById('delete-block-modal');
    const btnCloseDeleteBlock = document.getElementById('btn-close-delete-block-modal');
    const btnCancelDeleteBlock = document.getElementById('btn-cancel-delete-block');
    const btnConfirmDeleteBlock = document.getElementById('btn-confirm-delete-block');

    function closeDeleteBlockModal() {
        if (deleteBlockModal) deleteBlockModal.style.display = 'none';
    }

    if (btnCloseDeleteBlock) btnCloseDeleteBlock.addEventListener('click', closeDeleteBlockModal);
    if (btnCancelDeleteBlock) btnCancelDeleteBlock.addEventListener('click', closeDeleteBlockModal);
    if (btnConfirmDeleteBlock) {
        btnConfirmDeleteBlock.addEventListener('click', async () => {
            const blockId = document.getElementById('delete-block-id').value;
            if (!blockId) return;

            btnConfirmDeleteBlock.classList.add('loading');
            btnConfirmDeleteBlock.disabled = true;

            const res = await Api.deleteBlock(blockId);

            btnConfirmDeleteBlock.classList.remove('loading');
            btnConfirmDeleteBlock.disabled = false;

            if (res.success) {
                Toast.success('Block deleted successfully!');
                closeDeleteBlockModal();
                await loadExistingStructure();
                if (currentStep === 4) refreshStructureTree();
            } else {
                Toast.error(res.message || 'Cannot delete block with existing floors. Remove floors first.');
            }
        });
    }

    // 3. Delete Floor Modal
    const deleteFloorModal = document.getElementById('delete-floor-modal');
    const btnCloseDeleteFloor = document.getElementById('btn-close-delete-floor-modal');
    const btnCancelDeleteFloor = document.getElementById('btn-cancel-delete-floor');
    const btnConfirmDeleteFloor = document.getElementById('btn-confirm-delete-floor');

    function closeDeleteFloorModal() {
        if (deleteFloorModal) deleteFloorModal.style.display = 'none';
    }

    if (btnCloseDeleteFloor) btnCloseDeleteFloor.addEventListener('click', closeDeleteFloorModal);
    if (btnCancelDeleteFloor) btnCancelDeleteFloor.addEventListener('click', closeDeleteFloorModal);
    if (btnConfirmDeleteFloor) {
        btnConfirmDeleteFloor.addEventListener('click', async () => {
            const blockId = document.getElementById('delete-floor-block-id').value;
            const floorId = document.getElementById('delete-floor-id').value;
            if (!blockId || !floorId) return;

            btnConfirmDeleteFloor.classList.add('loading');
            btnConfirmDeleteFloor.disabled = true;

            const res = await Api.deleteFloor(blockId, floorId);

            btnConfirmDeleteFloor.classList.remove('loading');
            btnConfirmDeleteFloor.disabled = false;

            if (res.success) {
                Toast.success('Floor deleted successfully!');
                closeDeleteFloorModal();
                await loadExistingStructure();
                if (currentStep === 4) refreshStructureTree();
            } else {
                Toast.error(res.message || 'Cannot delete floor with existing units. Remove units first.');
            }
        });
    }

    // 4. Edit / Delete Unit Modal
    const unitModal = document.getElementById('unit-modal');
    const btnCloseUnit = document.getElementById('btn-close-unit-modal');
    const btnCancelUnit = document.getElementById('btn-cancel-unit');
    const formEditUnit = document.getElementById('form-edit-unit');
    const btnDeleteUnit = document.getElementById('btn-delete-unit');

    function closeUnitModal() {
        if (unitModal) unitModal.style.display = 'none';
    }

    if (btnCloseUnit) btnCloseUnit.addEventListener('click', closeUnitModal);
    if (btnCancelUnit) btnCancelUnit.addEventListener('click', closeUnitModal);

    if (formEditUnit) {
        formEditUnit.addEventListener('submit', async (e) => {
            e.preventDefault();
            const unitId = document.getElementById('edit-unit-id').value;
            const unit_type = document.getElementById('edit-unit-type').value;
            const area_sqft = parseInt(document.getElementById('edit-unit-area').value) || 1200;
            const status = document.getElementById('edit-unit-status').value;

            if (!unitId) return;

            const saveBtn = document.getElementById('btn-save-unit');
            saveBtn.classList.add('loading');
            saveBtn.disabled = true;

            const res = await Api.editUnit(unitId, { unit_type, area_sqft, status });

            saveBtn.classList.remove('loading');
            saveBtn.disabled = false;

            if (res.success) {
                Toast.success('Unit updated successfully!');
                closeUnitModal();
                await loadExistingStructure();
                if (currentStep === 4) refreshStructureTree();
            } else {
                Toast.error(res.message || 'Failed to update unit.');
            }
        });
    }

    if (btnDeleteUnit) {
        btnDeleteUnit.addEventListener('click', async () => {
            const unitId = document.getElementById('edit-unit-id').value;
            if (!unitId) return;

            if (!confirm('Are you sure you want to permanently delete this unit?')) return;

            btnDeleteUnit.disabled = true;
            const res = await Api.deleteUnit(unitId);
            btnDeleteUnit.disabled = false;

            if (res.success) {
                Toast.success('Unit deleted successfully!');
                closeUnitModal();
                await loadExistingStructure();
                if (currentStep === 4) refreshStructureTree();
            } else {
                Toast.error(res.message || 'Cannot delete unit linked to resident or occupied.');
            }
        });
    }

    // Close on backdrop click
    [renameModal, deleteBlockModal, deleteFloorModal, unitModal].forEach(modal => {
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.style.display = 'none';
            });
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeRenameModal();
            closeDeleteBlockModal();
            closeDeleteFloorModal();
            closeUnitModal();
        }
    });
}

// ══════════ Global Expositions for Inline Triggers ══════════

window.openRenameBlockModal = function (blockId, currentName) {
    const modal = document.getElementById('rename-block-modal');
    const input = document.getElementById('rename-block-input');
    const idInput = document.getElementById('rename-block-id');
    if (!modal) return;

    if (idInput) idInput.value = blockId;
    if (input) {
        input.value = currentName;
        setTimeout(() => input.focus(), 50);
    }
    modal.style.display = 'flex';
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [modal] });
};

window.openDeleteBlockModal = function (blockId, blockName) {
    const modal = document.getElementById('delete-block-modal');
    const idInput = document.getElementById('delete-block-id');
    const label = document.getElementById('delete-block-label');
    if (!modal) return;

    if (idInput) idInput.value = blockId;
    if (label) label.textContent = `Block ${blockName}`;
    modal.style.display = 'flex';
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [modal] });
};

window.openDeleteFloorModal = function (blockId, floorId, floorNumber, blockName) {
    const modal = document.getElementById('delete-floor-modal');
    const blockIdInput = document.getElementById('delete-floor-block-id');
    const floorIdInput = document.getElementById('delete-floor-id');
    const label = document.getElementById('delete-floor-label');
    if (!modal) return;

    if (blockIdInput) blockIdInput.value = blockId;
    if (floorIdInput) floorIdInput.value = floorId;
    if (label) label.textContent = `Floor ${floorNumber} of Block ${blockName}`;
    modal.style.display = 'flex';
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [modal] });
};

window.openUnitModal = function (unitId, displayLabel, unitType, areaSqft, status) {
    const modal = document.getElementById('unit-modal');
    const idInput = document.getElementById('edit-unit-id');
    const title = document.getElementById('unit-modal-title');
    const typeSelect = document.getElementById('edit-unit-type');
    const areaInput = document.getElementById('edit-unit-area');
    const statusSelect = document.getElementById('edit-unit-status');
    if (!modal) return;

    if (idInput) idInput.value = unitId;
    if (title) title.textContent = `Unit ${displayLabel}`;
    if (typeSelect) typeSelect.value = unitType || 'apartment';
    if (areaInput) areaInput.value = areaSqft || 1200;
    if (statusSelect) statusSelect.value = status || 'vacant';

    modal.style.display = 'flex';
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [modal] });
};

window.goToStep = goToStep;
window.refreshStructureTree = refreshStructureTree;
window.loadExistingStructure = loadExistingStructure;
