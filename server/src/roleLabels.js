/** 角色键（DB/API）与中文展示名；权限键 warehouse 不变，仅展示为「财务部管理员」。 */
export const ROLE_DISPLAY_NAMES = {
  warehouse: '财务部管理员',
  statistics: '统计部',
};

export function getRoleDisplayName(role) {
  const key = role === 'statistics' ? 'statistics' : 'warehouse';
  return ROLE_DISPLAY_NAMES[key] || key;
}

export function enrichUserWithRoleLabel(user) {
  if (!user || typeof user !== 'object') return user;
  return { ...user, roleDisplayName: getRoleDisplayName(user.role) };
}
