/**
 * Sahayak — Society Setup Wizard Page Logic
 * Manages 4-step wizard:
 * 1. Society Profile (auto-populated & skipped if society already exists)
 * 2. Block Creation
 * 3. Bulk Floor & Unit Generator (with existing floor detection & append prevention)
 * 4. Visual Interactive Structure Hierarchy Tree
 */

let currentStep = 1;
let createdBlocks = [];
let societyData = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Authenticate user (Secretary only)
    const user = await Router.requireAuth('secretary');
    if (!user) return;

    // 2. Initialize Layout
    Components.initSidebar('society-setup');
    Components.initTopbar({
        title: 'Society Setup Wizard',
        subtitle: 'Define your society profile and residential blocks',
    });

    // 3. Check if user already has a society
    if (user.societyId || (user.society && user.society.id)) {
        // Fetch full society configuration
        const res = await Api.get('/society/setup');
        if (res.success && res.data) {
            societyData = res.data;
            
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
                Toast.success(societyData ? 'Society profile updated successfully!' : 'Society profile created successfully!');
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
 * Handle Step 3 submission without unwanted duplicate floor appends
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

            Toast.success(`${totalFloors} floors created! Fetching structure...`);

            // 2. Fetch updated structure to find the newly created floors
            const structRes = await Api.get('/society/structure');
            if (structRes.success && structRes.data && Array.isArray(structRes.data.blocks)) {
                createdBlocks = structRes.data.blocks;
                const updatedBlock = createdBlocks.find(b => String(b.id) === String(blockId));
                if (updatedBlock && updatedBlock.floors) {
                    // Filter to only new floors (or all if brand new)
                    targetFloors = updatedBlock.floors.filter(f => Number(f.floorNumber) > maxFloorBefore);
                }
            }
        }

        // 3. Populate units for the target floors
        if (targetFloors.length > 0) {
            Toast.info(`Adding units to ${targetFloors.length} floors...`);
            for (const floor of targetFloors) {
                await Api.post(`/floors/${floor.id}/units/bulk`, {
                    start_unit: startUnit,
                    end_unit: endUnit,
                    unit_type: unitType,
                    area_sqft: areaSqft
                });
            }
        }

        // 4. Refresh structure and advance
        await loadExistingStructure();
        Toast.success('Floors & Units successfully configured!');
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

    if (step === 3) {
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
        }
    } catch (err) {
        console.warn('Failed to load existing structure:', err);
    }
}

function renderBlocksList() {
    const list = document.getElementById('created-blocks-list');
    if (!list) return;

    if (!createdBlocks || createdBlocks.length === 0) {
        list.innerHTML = '<span style="font-size: var(--fs-xs); color: var(--clr-text-secondary);">No blocks added yet. Use the form above to add your first block.</span>';
        return;
    }

    list.innerHTML = createdBlocks.map(b => {
        const floorCount = (b.floors || []).length;
        return `
            <div style="background: var(--clr-surface-dim); border: 1px solid var(--clr-border); padding: 6px 14px; border-radius: var(--radius-full); font-weight: 600; font-size: var(--fs-sm); display: inline-flex; align-items: center; gap: 6px; color: var(--clr-primary);">
                <i data-lucide="building" style="width: 14px;"></i>
                <span>Block ${b.blockName || b.block_name}</span>
                <span style="font-size: 11px; font-weight: 500; color: var(--clr-text-secondary); background: rgba(92, 26, 51, 0.08); padding: 2px 6px; border-radius: 10px;">${floorCount} floors</span>
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

function renderFullTree(blocks) {
    const container = document.getElementById('full-structure-tree');
    if (!container) return;

    container.innerHTML = blocks.map(block => `
        <div class="block-node">
            <div class="block-node-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="building-2" style="width: 18px;"></i>
                    <span>Block ${block.blockName}</span>
                </div>
                <span style="font-size: 11px; color: var(--clr-text-secondary); font-weight: 500;">
                    ${(block.floors || []).length} Floors Total
                </span>
            </div>

            <div class="floors-container">
                ${(block.floors || []).map(floor => `
                    <div class="floor-row">
                        <span class="floor-badge">Floor ${floor.floorNumber}</span>
                        <div class="units-flow">
                            ${(floor.units || []).map(unit => `
                                <span class="unit-chip ${unit.status === 'occupied' ? 'occupied' : 'vacant'}" title="${unit.displayLabel} - ${unit.status}">
                                    <i data-lucide="${unit.status === 'occupied' ? 'user-check' : 'home'}" style="width: 11px;"></i>
                                    <span>${unit.displayLabel}</span>
                                </span>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });
}

// Expose navigation functions to global scope for HTML onclick attributes
window.goToStep = goToStep;
window.refreshStructureTree = refreshStructureTree;
window.loadExistingStructure = loadExistingStructure;
