import { pool } from '../../config/db.js';

const ALLOWED_CATEGORIES = [
  'plumbing',
  'electrical',
  'lift',
  'cleanliness',
  'security',
  'parking',
  'noise',
  'other',
];

/**
 * 1. Create a new complaint (Resident)
 */
export const createComplaint = async (societyId, residentId, unitId, payload) => {
  const { title, category, category_label, description, attachment_url } = payload;

  if (!title || typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 200) {
    throw { status: 400, message: 'Title is required (3 to 200 characters).' };
  }

  if (!description || typeof description !== 'string' || description.trim().length < 10) {
    throw { status: 400, message: 'Description is required (at least 10 characters).' };
  }

  if (!category || !ALLOWED_CATEGORIES.includes(category)) {
    throw { status: 400, message: `Invalid category. Must be one of: ${ALLOWED_CATEGORIES.join(', ')}` };
  }

  let finalCategoryLabel = null;
  if (category === 'other') {
    if (!category_label || typeof category_label !== 'string' || category_label.trim().length < 2) {
      throw { status: 400, message: 'category_label is required when category is "other".' };
    }
    finalCategoryLabel = category_label.trim();
  }

  if (!unitId) {
    throw { status: 400, message: 'Resident does not have an assigned unit. Contact your secretary.' };
  }

  const [result] = await pool.execute(
    `INSERT INTO complaints 
      (society_id, unit_id, resident_id, title, category, category_label, description, attachment_url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
    [
      societyId,
      unitId,
      residentId,
      title.trim(),
      category,
      finalCategoryLabel,
      description.trim(),
      attachment_url || null,
    ]
  );

  return {
    complaintId: result.insertId,
    title: title.trim(),
    category,
    status: 'open',
  };
};

