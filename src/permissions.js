
const isAdmin = (u) => u?.role === 'admin';
const canEdit = (u, s) => isAdmin(u) || s.owner_id == null || u.id === s.owner_id || s.edit_mode === 'team' || (s.edit_mode === 'person' && s.editor_id === u.id);
const canManage = (u, s) => isAdmin(u) || s.owner_id == null || u.id === s.owner_id;

module.exports = { isAdmin, canEdit, canManage };
